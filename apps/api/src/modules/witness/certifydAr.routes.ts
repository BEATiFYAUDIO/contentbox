import crypto from "node:crypto";
import { getActiveWitnessIdentityKey } from "./witness.service.js";

const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_ACTIVE_CONNECTIONS = 8;

type PendingChallenge = {
  userId: string;
  arPublicKey: string;
  witnessPublicKey: string;
  witnessIdentityId: string;
  authorizationText: string;
  expiresAt: number;
};

export function isCanonicalEd25519PublicKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64");
  return bytes.length === 32 && bytes.toString("base64") === value;
}

function verifySignature(publicKey: string, message: string, signature: string): boolean {
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signature)) return false;
  const bytes = Buffer.from(signature, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== signature) return false;
  try {
    const key = crypto.createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKey, "base64").toString("base64url") },
      format: "jwk"
    });
    return crypto.verify(null, Buffer.from(message, "utf8"), key, bytes);
  } catch {
    return false;
  }
}

export function publicCertifydArConnection(row: any) {
  return {
    publicKey: row.publicKey,
    authorizationText: row.authorizationText,
    signature: row.signature,
    connectedAt: row.createdAt.toISOString()
  };
}

export async function getPublicCertifydArConnections(prisma: any, userId: string, witness: { id: string; publicKey: string } | null) {
  if (!witness) return [];
  const rows = await prisma.certifydArConnection.findMany({
    where: { userId, witnessIdentityId: witness.id, witnessPublicKey: witness.publicKey, revokedAt: null },
    orderBy: { createdAt: "desc" }
  });
  return rows.map(publicCertifydArConnection);
}

export function registerCertifydArRoutes(app: any, deps: { prisma: any; requireAuth: any }) {
  const { prisma, requireAuth } = deps;
  const challenges = new Map<string, PendingChallenge>();
  const base = "/api/profile/connected-apps/certifyd-ar";

  function pruneChallenges() {
    const now = Date.now();
    for (const [id, challenge] of challenges) {
      if (challenge.expiresAt <= now) challenges.delete(id);
    }
  }

  app.get(base, { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req.user?.sub || "");
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const witness = await getActiveWitnessIdentityKey(prisma, userId);
    if (!witness) return reply.send({ connections: [] });
    const rows = await prisma.certifydArConnection.findMany({
      where: { userId, witnessIdentityId: witness.witnessIdentityId, witnessPublicKey: witness.publicKey, revokedAt: null },
      orderBy: { createdAt: "desc" }
    });
    return reply.send({ connections: rows.map((row: any) => ({ id: row.id, ...publicCertifydArConnection(row) })) });
  });

  app.post(`${base}/challenge`, { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req.user?.sub || "");
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const arPublicKey = req.body?.publicKey;
    if (!isCanonicalEd25519PublicKey(arPublicKey)) {
      return reply.code(400).send({ error: "INVALID_PUBLIC_KEY", message: "Enter a valid Certifyd AR connection code." });
    }
    const witness = await getActiveWitnessIdentityKey(prisma, userId);
    if (!witness || witness.algorithm !== "ed25519" || !isCanonicalEd25519PublicKey(witness.publicKey)) {
      return reply.code(409).send({ error: "CREATOR_IDENTITY_UNAVAILABLE" });
    }
    if (witness.publicKey === arPublicKey) {
      return reply.code(400).send({ error: "INVALID_PUBLIC_KEY" });
    }
    const existing = await prisma.certifydArConnection.findUnique({ where: { publicKey: arPublicKey }, select: { id: true } });
    if (existing) return reply.code(409).send({ error: "ALREADY_CONNECTED" });
    const activeCount = await prisma.certifydArConnection.count({
      where: { userId, witnessIdentityId: witness.witnessIdentityId, witnessPublicKey: witness.publicKey, revokedAt: null }
    });
    if (activeCount >= MAX_ACTIVE_CONNECTIONS) return reply.code(409).send({ error: "TOO_MANY_CONNECTIONS" });

    pruneChallenges();
    const challengeId = crypto.randomUUID();
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;
    const authorizationText = [
      "Certifyd AR authorization v1",
      `Creator: ${userId}`,
      `Creator key: ${witness.publicKey}`,
      `AR key: ${arPublicKey}`,
      "Purpose: Certifyd AR publishing",
      `Challenge: ${challengeId}`
    ].join("\n");
    challenges.set(challengeId, {
      userId, arPublicKey, witnessPublicKey: witness.publicKey,
      witnessIdentityId: witness.witnessIdentityId, authorizationText, expiresAt
    });
    return reply.send({ challengeId, authorizationText, expiresAt: new Date(expiresAt).toISOString() });
  });

  app.post(`${base}/connect`, { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req.user?.sub || "");
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const challengeId = String(req.body?.challengeId || "");
    const signature = String(req.body?.signature || "");
    pruneChallenges();
    const challenge = challenges.get(challengeId);
    if (!challenge || challenge.userId !== userId) {
      return reply.code(400).send({ error: "INVALID_CHALLENGE" });
    }
    // Consume before persistence so a captured approval cannot be replayed.
    challenges.delete(challengeId);
    const witness = await getActiveWitnessIdentityKey(prisma, userId);
    if (!witness || witness.witnessIdentityId !== challenge.witnessIdentityId || witness.publicKey !== challenge.witnessPublicKey) {
      return reply.code(409).send({ error: "CREATOR_IDENTITY_CHANGED" });
    }
    if (!verifySignature(witness.publicKey, challenge.authorizationText, signature)) {
      return reply.code(403).send({ error: "INVALID_SIGNATURE" });
    }
    const existing = await prisma.certifydArConnection.findUnique({ where: { publicKey: challenge.arPublicKey }, select: { id: true } });
    if (existing) return reply.code(409).send({ error: "ALREADY_CONNECTED" });
    const activeCount = await prisma.certifydArConnection.count({
      where: { userId, witnessIdentityId: witness.witnessIdentityId, witnessPublicKey: witness.publicKey, revokedAt: null }
    });
    if (activeCount >= MAX_ACTIVE_CONNECTIONS) return reply.code(409).send({ error: "TOO_MANY_CONNECTIONS" });
    try {
      const row = await prisma.certifydArConnection.create({
        data: {
          userId, witnessIdentityId: witness.witnessIdentityId, witnessPublicKey: witness.publicKey,
          publicKey: challenge.arPublicKey, authorizationText: challenge.authorizationText, signature
        }
      });
      return reply.code(201).send({ connection: { id: row.id, ...publicCertifydArConnection(row) } });
    } catch (error: any) {
      if (error?.code === "P2002") return reply.code(409).send({ error: "ALREADY_CONNECTED" });
      throw error;
    }
  });

  app.delete(`${base}/:id`, { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req.user?.sub || "");
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const id = String(req.params?.id || "");
    const result = await prisma.certifydArConnection.updateMany({
      where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() }
    });
    if (result.count !== 1) return reply.code(404).send({ error: "CONNECTION_NOT_FOUND" });
    return reply.send({ ok: true });
  });
}
