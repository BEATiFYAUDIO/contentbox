import crypto from "node:crypto";
import bcrypt from "bcrypt";
import {
  completeWitnessLegacyRecovery,
  createWitnessRecoveryChallenge,
  getWitnessIdentity,
  registerWitnessIdentity
} from "./witness.service.js";
import { registerWitnessProofRoutes } from "./proof.routes.js";
import type { WitnessRegisterBody } from "./witness.types.js";

function isWitnessStoreSchemaError(err: any): boolean {
  const code = String((err as any)?.code || "");
  const message = String((err as any)?.message || "");
  if (code === "P2021" || code === "P2022") return true;
  return /WitnessIdentity|WitnessIdentityKey|WitnessIdentityEvent|WitnessIdentityRecoveryChallenge/i.test(message) && /does not exist|Unknown field/i.test(message);
}

const WITNESS_LOGIN_CHALLENGE_TTL_MS = 5 * 60_000;
const RECOVERY_CONFIRMATION = "RECOVER CREATOR IDENTITY";
const witnessLoginChallenges = new Map<string, {
  challengeId: string;
  publicKey: string;
  userId: string;
  challengeText: string;
  expiresAt: number;
  usedAt: number | null;
}>();
const recoveryRateLimits = new Map<string, { count: number; resetAt: number }>();

function pruneExpiredWitnessChallenges(now = Date.now()) {
  for (const [id, entry] of witnessLoginChallenges.entries()) {
    if (entry.expiresAt <= now || entry.usedAt) {
      witnessLoginChallenges.delete(id);
    }
  }
}

function toBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function verifyWitnessSignature(publicKey: string, challengeText: string, signatureBase64: string): boolean {
  try {
    const pubBytes = Buffer.from(String(publicKey || "").trim(), "base64");
    const sigBytes = Buffer.from(String(signatureBase64 || "").trim(), "base64");
    if (pubBytes.length !== 32 || sigBytes.length !== 64) return false;
    const key = crypto.createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: toBase64Url(pubBytes)
      },
      format: "jwk"
    });
    return crypto.verify(null, Buffer.from(challengeText, "utf8"), key, sigBytes);
  } catch {
    return false;
  }
}

function recoveryRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const existing = recoveryRateLimits.get(key);
  if (!existing || existing.resetAt <= now) {
    recoveryRateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  existing.count += 1;
  return existing.count <= max;
}

export function registerWitnessRoutes(app: any, deps: {
  prisma: any;
  requireAuth: any;
}) {
  const { prisma, requireAuth } = deps;
  app.log.info("Witness routes registered");
  registerWitnessProofRoutes(app, deps);

  app.post("/auth/witness/challenge", async (req: any, reply: any) => {
    const body = (req.body || {}) as { publicKey?: string; algorithm?: string };
    const algorithm = String(body.algorithm || "").trim().toLowerCase();
    const publicKey = String(body.publicKey || "").trim();
    if (algorithm !== "ed25519") {
      return reply.code(400).send({ error: "INVALID_ALGORITHM", message: "algorithm must be ed25519" });
    }
    if (!publicKey) {
      return reply.code(400).send({ error: "PUBLIC_KEY_REQUIRED", message: "publicKey is required" });
    }

    pruneExpiredWitnessChallenges();

    const matches = await prisma.witnessIdentityKey.findMany({
      where: {
        publicKey,
        status: "active",
        revokedAt: null
      },
      select: {
        witnessIdentity: { select: { revokedAt: true } },
        user: { select: { id: true, tokenVersion: true } }
      },
      take: 2
    });

    if (matches.length !== 1 || !matches[0]?.user?.id || matches[0]?.witnessIdentity?.revokedAt) {
      return reply.code(404).send({ error: "WITNESS_IDENTITY_NOT_FOUND", message: "Creator identity is not available for sign-in." });
    }

    const challengeId = crypto.randomUUID();
    const nonce = crypto.randomBytes(16).toString("hex");
    const expiresAt = Date.now() + WITNESS_LOGIN_CHALLENGE_TTL_MS;
    const challengeText = [
      "Certifyd Creator Identity Login",
      `Challenge ID: ${challengeId}`,
      `Nonce: ${nonce}`,
      `Expires At: ${new Date(expiresAt).toISOString()}`
    ].join("\n");

    witnessLoginChallenges.set(challengeId, {
      challengeId,
      publicKey,
      userId: matches[0].user.id,
      challengeText,
      expiresAt,
      usedAt: null
    });

    return reply.send({
      challengeId,
      challengeText,
      expiresAt: new Date(expiresAt).toISOString(),
      algorithm: "ed25519"
    });
  });

  app.post("/auth/witness/login", async (req: any, reply: any) => {
    const body = (req.body || {}) as { challengeId?: string; publicKey?: string; signature?: string };
    const challengeId = String(body.challengeId || "").trim();
    const publicKey = String(body.publicKey || "").trim();
    const signature = String(body.signature || "").trim();
    if (!challengeId || !publicKey || !signature) {
      return reply.code(400).send({ error: "INVALID_WITNESS_LOGIN", message: "challengeId, publicKey, and signature are required" });
    }

    pruneExpiredWitnessChallenges();
    const challenge = witnessLoginChallenges.get(challengeId);
    if (!challenge) {
      return reply.code(400).send({ error: "INVALID_CHALLENGE", message: "Challenge is invalid or expired." });
    }
    if (challenge.usedAt) {
      witnessLoginChallenges.delete(challengeId);
      return reply.code(409).send({ error: "CHALLENGE_USED", message: "Challenge has already been used." });
    }
    if (challenge.expiresAt <= Date.now()) {
      witnessLoginChallenges.delete(challengeId);
      return reply.code(400).send({ error: "CHALLENGE_EXPIRED", message: "Challenge has expired." });
    }
    if (challenge.publicKey !== publicKey) {
      return reply.code(403).send({ error: "PUBLIC_KEY_MISMATCH", message: "Challenge does not match this local key." });
    }
    if (!verifyWitnessSignature(publicKey, challenge.challengeText, signature)) {
      return reply.code(403).send({ error: "INVALID_SIGNATURE", message: "Creator identity signature was rejected." });
    }

    const witness = await prisma.witnessIdentityKey.findFirst({
      where: {
        userId: challenge.userId,
        publicKey,
        status: "active",
        revokedAt: null
      },
      select: {
        witnessIdentity: { select: { revokedAt: true } },
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            createdAt: true,
            tokenVersion: true
          }
        }
      }
    });

    if (!witness?.user?.id || witness?.witnessIdentity?.revokedAt) {
      witnessLoginChallenges.delete(challengeId);
      return reply.code(404).send({ error: "WITNESS_IDENTITY_NOT_FOUND", message: "Creator identity is not available for sign-in." });
    }

    challenge.usedAt = Date.now();
    witnessLoginChallenges.set(challengeId, challenge);

    const token = app.jwt.sign({ sub: witness.user.id, tokenVersion: witness.user.tokenVersion ?? 0 });
    witnessLoginChallenges.delete(challengeId);
    return reply.send({
      ok: true,
      token,
      user: {
        id: witness.user.id,
        email: witness.user.email,
        displayName: witness.user.displayName,
        createdAt: witness.user.createdAt
      }
    });
  });

  app.get("/api/profile/verification/key", { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req?.user?.sub || "").trim();
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    try {
      const identity = await getWitnessIdentity(prisma, userId);
      return reply.send({ identity });
    } catch (e: any) {
      if (isWitnessStoreSchemaError(e)) {
        req.log.warn({ err: e }, "witness.get.store_not_ready");
        return reply.code(503).send({
          error: "WITNESS_STORE_NOT_READY",
          message: "Creator identity storage is not ready on this node. Run: npx prisma db push --schema prisma/schema.prisma"
        });
      }
      req.log.error({ err: e }, "witness.get.failed");
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  app.post("/api/profile/verification/key/register", { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req?.user?.sub || "").trim();
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const body = (req.body || {}) as WitnessRegisterBody;
    try {
      const identity = await registerWitnessIdentity(prisma, {
        userId,
        algorithm: String(body.algorithm || ""),
        publicKey: String(body.publicKey || "")
      });
      return reply.send({ identity });
    } catch (e: any) {
      const message = String(e?.message || "");
      if (message === "WITNESS_IDENTITY_EXISTS") {
        return reply.code(409).send({
          error: "WITNESS_IDENTITY_EXISTS",
          message: "An active creator identity is already registered for this account."
        });
      }
      if (message === "INVALID_ALGORITHM") {
        return reply.code(400).send({ error: "INVALID_ALGORITHM", message: "algorithm must be ed25519" });
      }
      if (message === "PUBLIC_KEY_REQUIRED") {
        return reply.code(400).send({ error: "PUBLIC_KEY_REQUIRED", message: "publicKey is required" });
      }
      if (isWitnessStoreSchemaError(e)) {
        req.log.warn({ err: e }, "witness.register.store_not_ready");
        return reply.code(503).send({
          error: "WITNESS_STORE_NOT_READY",
          message: "Creator identity storage is not ready on this node. Run: npx prisma db push --schema prisma/schema.prisma"
        });
      }
      req.log.error({ err: e }, "witness.register.failed");
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  app.post("/api/profile/verification/key/recovery/challenge", { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req?.user?.sub || "").trim();
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const rateKey = `${userId}:${req.ip || "unknown"}:witness-recovery`;
    if (!recoveryRateLimit(rateKey, 5, 5 * 60_000)) {
      return reply.code(429).send({ error: "RATE_LIMITED", message: "Too many recovery attempts. Try again shortly." });
    }
    const body = (req.body || {}) as { password?: string; confirmation?: string; publicKey?: string; algorithm?: string };
    const password = String(body.password || "");
    const confirmation = String(body.confirmation || "").trim();
    if (confirmation !== RECOVERY_CONFIRMATION) {
      return reply.code(400).send({ error: "CONFIRMATION_REQUIRED", message: `Type ${RECOVERY_CONFIRMATION} to recover creator identity.` });
    }
    if (!password) return reply.code(400).send({ error: "PASSWORD_REQUIRED", message: "Password is required." });
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
      if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
        return reply.code(403).send({ error: "INVALID_PASSWORD", message: "Password confirmation failed." });
      }
      const challenge = await createWitnessRecoveryChallenge(prisma, {
        userId,
        algorithm: String(body.algorithm || ""),
        publicKey: String(body.publicKey || "")
      });
      return reply.send(challenge);
    } catch (e: any) {
      const message = String(e?.message || "");
      if (message === "INVALID_ALGORITHM") return reply.code(400).send({ error: message, message: "algorithm must be ed25519" });
      if (message === "PUBLIC_KEY_REQUIRED") return reply.code(400).send({ error: message, message: "A valid Ed25519 publicKey is required." });
      if (message === "WITNESS_IDENTITY_REQUIRED") return reply.code(409).send({ error: message, message: "An active creator identity is required before recovery." });
      if (message === "RECOVERY_KEY_ALREADY_ACTIVE") return reply.code(409).send({ error: message, message: "This key is already active." });
      if (isWitnessStoreSchemaError(e)) {
        req.log.warn({ err: e }, "witness.recovery.challenge.store_not_ready");
        return reply.code(503).send({
          error: "WITNESS_STORE_NOT_READY",
          message: "Creator identity recovery storage is not ready on this node. Run: npx prisma db push --schema prisma/schema.prisma"
        });
      }
      req.log.error({ err: e }, "witness.recovery.challenge.failed");
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  app.post("/api/profile/verification/key/recovery/complete", { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req?.user?.sub || "").trim();
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const rateKey = `${userId}:${req.ip || "unknown"}:witness-recovery-complete`;
    if (!recoveryRateLimit(rateKey, 10, 5 * 60_000)) {
      return reply.code(429).send({ error: "RATE_LIMITED", message: "Too many recovery attempts. Try again shortly." });
    }
    const body = (req.body || {}) as { challengeId?: string; publicKey?: string; signature?: string };
    const challengeId = String(body.challengeId || "").trim();
    const publicKey = String(body.publicKey || "").trim();
    const signature = String(body.signature || "").trim();
    if (!challengeId || !publicKey || !signature) {
      return reply.code(400).send({ error: "INVALID_RECOVERY_COMPLETION", message: "challengeId, publicKey, and signature are required." });
    }
    try {
      const challenge = await prisma.witnessIdentityRecoveryChallenge.findUnique({
        where: { id: challengeId },
        select: { userId: true, candidatePublicKey: true, challengeText: true }
      });
      if (!challenge || challenge.userId !== userId) {
        return reply.code(404).send({ error: "RECOVERY_CHALLENGE_NOT_FOUND", message: "Recovery challenge not found." });
      }
      if (challenge.candidatePublicKey !== publicKey) {
        return reply.code(403).send({ error: "RECOVERY_PUBLIC_KEY_MISMATCH", message: "Recovery challenge does not match this local key." });
      }
      const identity = await completeWitnessLegacyRecovery(prisma, {
        userId,
        challengeId,
        publicKey,
        signatureValid: verifyWitnessSignature(publicKey, challenge.challengeText, signature)
      });
      return reply.send({ ok: true, identity, sessionInvalidated: true });
    } catch (e: any) {
      const message = String(e?.message || "");
      if (message === "PUBLIC_KEY_REQUIRED") return reply.code(400).send({ error: message });
      if (message === "INVALID_SIGNATURE") return reply.code(403).send({ error: message, message: "Creator identity recovery signature was rejected." });
      if (message === "RECOVERY_CHALLENGE_NOT_FOUND") return reply.code(404).send({ error: message });
      if (message === "RECOVERY_CHALLENGE_USED") return reply.code(409).send({ error: message, message: "Recovery challenge has already been used." });
      if (message === "RECOVERY_CHALLENGE_EXPIRED") return reply.code(400).send({ error: message, message: "Recovery challenge has expired." });
      if (message === "RECOVERY_PUBLIC_KEY_MISMATCH") return reply.code(403).send({ error: message });
      if (message === "WITNESS_IDENTITY_REQUIRED" || message === "ACTIVE_WITNESS_KEY_REQUIRED") return reply.code(409).send({ error: message });
      if (message === "RECOVERY_KEY_ALREADY_ACTIVE") return reply.code(409).send({ error: message });
      if (isWitnessStoreSchemaError(e)) {
        req.log.warn({ err: e }, "witness.recovery.complete.store_not_ready");
        return reply.code(503).send({
          error: "WITNESS_STORE_NOT_READY",
          message: "Creator identity recovery storage is not ready on this node. Run: npx prisma db push --schema prisma/schema.prisma"
        });
      }
      req.log.error({ err: e }, "witness.recovery.complete.failed");
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });
}
