import {
  cancelProofRecord,
  createNostrChallenge,
  createSocialChallenge,
  createDomainChallenge,
  deleteProofRecord,
  listProofRecords,
  revokeProofRecord,
  verifyNostrProof,
  verifySocialProof,
  verifyDomainProof
} from "./proof.service.js";
import type {
  DomainChallengeBody,
  NostrChallengeBody,
  NostrVerifyBody,
  DomainVerifyBody,
  SocialChallengeBody,
  SocialVerifyBody
} from "./proof.types.js";

function isWitnessStoreSchemaError(err: any): boolean {
  const code = String((err as any)?.code || "");
  const message = String((err as any)?.message || "");
  if (code === "P2021" || code === "P2022") return true;
  if (message === "PROOF_MODEL_MISSING") return true;
  return /ProofRecord|WitnessIdentity/i.test(message) && /does not exist|Unknown field/i.test(message);
}

export function registerWitnessProofRoutes(app: any, deps: {
  prisma: any;
  requireAuth: any;
}) {
  const { prisma, requireAuth } = deps;

  app.get("/api/profile/verification/proofs", { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req?.user?.sub || "").trim();
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    try {
      const proofs = await listProofRecords(prisma, userId);
      return reply.send({ proofs });
    } catch (e: any) {
      if (isWitnessStoreSchemaError(e)) {
        req.log.warn({ err: e }, "witness.proofs.list.store_not_ready");
        return reply.code(503).send({
          error: "WITNESS_STORE_NOT_READY",
          message: "Proof storage is not ready on this node. Run: npx prisma db push --schema prisma/schema.prisma"
        });
      }
      req.log.error({ err: e }, "witness.proofs.list.failed");
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  app.post("/api/profile/verification/proofs/:id/cancel", { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req?.user?.sub || "").trim();
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const proofId = String((req.params || {}).id || "").trim();
    if (!proofId) return reply.code(400).send({ error: "INVALID_PROOF_ID" });
    try {
      const proof = await cancelProofRecord(prisma, userId, proofId);
      return reply.send({ proof });
    } catch (e: any) {
      const message = String(e?.message || "");
      if (message === "PROOF_NOT_FOUND") return reply.code(404).send({ error: "PROOF_NOT_FOUND" });
      if (message === "INVALID_TRANSITION") return reply.code(409).send({ error: "INVALID_TRANSITION", message: "Only pending proofs can be cancelled." });
      if (isWitnessStoreSchemaError(e)) {
        req.log.warn({ err: e }, "witness.proofs.cancel.store_not_ready");
        return reply.code(503).send({
          error: "WITNESS_STORE_NOT_READY",
          message: "Proof storage is not ready on this node. Run: npx prisma db push --schema prisma/schema.prisma"
        });
      }
      req.log.error({ err: e }, "witness.proofs.cancel.failed");
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  app.post("/api/profile/verification/proofs/:id/revoke", { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req?.user?.sub || "").trim();
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const proofId = String((req.params || {}).id || "").trim();
    if (!proofId) return reply.code(400).send({ error: "INVALID_PROOF_ID" });
    try {
      const proof = await revokeProofRecord(prisma, userId, proofId);
      return reply.send({ proof });
    } catch (e: any) {
      const message = String(e?.message || "");
      if (message === "PROOF_NOT_FOUND") return reply.code(404).send({ error: "PROOF_NOT_FOUND" });
      if (message === "INVALID_TRANSITION") return reply.code(409).send({ error: "INVALID_TRANSITION", message: "Only verified proofs can be revoked." });
      if (isWitnessStoreSchemaError(e)) {
        req.log.warn({ err: e }, "witness.proofs.revoke.store_not_ready");
        return reply.code(503).send({
          error: "WITNESS_STORE_NOT_READY",
          message: "Proof storage is not ready on this node. Run: npx prisma db push --schema prisma/schema.prisma"
        });
      }
      req.log.error({ err: e }, "witness.proofs.revoke.failed");
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  app.delete("/api/profile/verification/proofs/:id", { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req?.user?.sub || "").trim();
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const proofId = String((req.params || {}).id || "").trim();
    if (!proofId) return reply.code(400).send({ error: "INVALID_PROOF_ID" });
    try {
      await deleteProofRecord(prisma, userId, proofId);
      return reply.send({ ok: true });
    } catch (e: any) {
      const message = String(e?.message || "");
      if (message === "PROOF_NOT_FOUND") return reply.code(404).send({ error: "PROOF_NOT_FOUND" });
      if (message === "INVALID_TRANSITION") return reply.code(409).send({ error: "INVALID_TRANSITION", message: "Only pending or failed proofs can be deleted." });
      if (isWitnessStoreSchemaError(e)) {
        req.log.warn({ err: e }, "witness.proofs.delete.store_not_ready");
        return reply.code(503).send({
          error: "WITNESS_STORE_NOT_READY",
          message: "Proof storage is not ready on this node. Run: npx prisma db push --schema prisma/schema.prisma"
        });
      }
      req.log.error({ err: e }, "witness.proofs.delete.failed");
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  app.post("/api/profile/verification/domain/challenge", { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req?.user?.sub || "").trim();
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const body = (req.body || {}) as DomainChallengeBody;
    try {
      const proof = await createDomainChallenge(prisma, userId, String(body.domain || ""));
      return reply.send({ proof });
    } catch (e: any) {
      const message = String(e?.message || "");
      if (message === "INVALID_DOMAIN") {
        return reply.code(400).send({ error: "INVALID_DOMAIN", message: "Enter a valid domain (example.com)." });
      }
      if (message === "WITNESS_IDENTITY_REQUIRED") {
        return reply.code(409).send({ error: "WITNESS_IDENTITY_REQUIRED", message: "Create a creator identity key before domain verification." });
      }
      if (isWitnessStoreSchemaError(e)) {
        req.log.warn({ err: e }, "witness.proofs.challenge.store_not_ready");
        return reply.code(503).send({
          error: "WITNESS_STORE_NOT_READY",
          message: "Proof storage is not ready on this node. Run: npx prisma db push --schema prisma/schema.prisma"
        });
      }
      req.log.error({ err: e }, "witness.proofs.challenge.failed");
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  app.post("/api/profile/verification/domain/verify", { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req?.user?.sub || "").trim();
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const body = (req.body || {}) as DomainVerifyBody;
    try {
      const proof = await verifyDomainProof(prisma, userId, String(body.domain || ""));
      return reply.send({ proof });
    } catch (e: any) {
      const message = String(e?.message || "");
      if (message === "INVALID_DOMAIN") {
        return reply.code(400).send({ error: "INVALID_DOMAIN", message: "Enter a valid domain (example.com)." });
      }
      if (message === "PROOF_CHALLENGE_NOT_FOUND") {
        return reply.code(404).send({ error: "PROOF_CHALLENGE_NOT_FOUND", message: "Create a challenge for this domain first." });
      }
      if (message === "PROOF_CHALLENGE_INVALID") {
        return reply.code(409).send({ error: "PROOF_CHALLENGE_INVALID", message: "Stored challenge is invalid. Create a new challenge." });
      }
      if (isWitnessStoreSchemaError(e)) {
        req.log.warn({ err: e }, "witness.proofs.verify.store_not_ready");
        return reply.code(503).send({
          error: "WITNESS_STORE_NOT_READY",
          message: "Proof storage is not ready on this node. Run: npx prisma db push --schema prisma/schema.prisma"
        });
      }
      req.log.error({ err: e }, "witness.proofs.verify.failed");
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  app.post("/api/profile/verification/social/challenge", { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req?.user?.sub || "").trim();
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const body = (req.body || {}) as SocialChallengeBody;
    try {
      const proof = await createSocialChallenge(prisma, userId, String(body.provider || ""), String(body.username || ""));
      return reply.send({ proof });
    } catch (e: any) {
      const message = String(e?.message || "");
      if (message === "INVALID_SOCIAL_PROVIDER") {
        return reply.code(400).send({ error: "INVALID_SOCIAL_PROVIDER", message: "Provider must be github, youtube, tiktok, rumble, or x." });
      }
      if (message === "SOCIAL_PROVIDER_NOT_SUPPORTED") {
        return reply.code(400).send({ error: "SOCIAL_PROVIDER_NOT_SUPPORTED", message: "This provider is not enabled yet in this build." });
      }
      if (message === "INVALID_SOCIAL_USERNAME") {
        return reply.code(400).send({ error: "INVALID_SOCIAL_USERNAME", message: "Enter a valid account username." });
      }
      if (message === "INVALID_YOUTUBE_CHANNEL_URL") {
        return reply.code(400).send({ error: "INVALID_YOUTUBE_CHANNEL_URL", message: "Enter a valid YouTube channel URL (/@handle or /channel/<id>)." });
      }
      if (message === "INVALID_INSTAGRAM_PROFILE_URL") {
        return reply.code(400).send({ error: "INVALID_INSTAGRAM_PROFILE_URL", message: "Enter a valid Instagram profile URL (https://www.instagram.com/<handle>/)." });
      }
      if (message === "INVALID_TIKTOK_PROFILE_URL") {
        return reply.code(400).send({ error: "INVALID_TIKTOK_PROFILE_URL", message: "Enter a valid TikTok profile URL (https://www.tiktok.com/@handle)." });
      }
      if (message === "INVALID_RUMBLE_PROFILE_URL") {
        return reply.code(400).send({ error: "INVALID_RUMBLE_PROFILE_URL", message: "Enter a valid Rumble profile URL (https://rumble.com/c/<handle> or https://rumble.com/user/<handle>)." });
      }
      if (message === "WITNESS_IDENTITY_REQUIRED") {
        return reply.code(409).send({ error: "WITNESS_IDENTITY_REQUIRED", message: "Create a creator identity key before social verification." });
      }
      if (isWitnessStoreSchemaError(e)) {
        req.log.warn({ err: e }, "witness.proofs.social.challenge.store_not_ready");
        return reply.code(503).send({
          error: "WITNESS_STORE_NOT_READY",
          message: "Proof storage is not ready on this node. Run: npx prisma db push --schema prisma/schema.prisma"
        });
      }
      req.log.error({ err: e }, "witness.proofs.social.challenge.failed");
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  app.post("/api/profile/verification/social/verify", { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req?.user?.sub || "").trim();
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const body = (req.body || {}) as SocialVerifyBody;
    try {
      const proof = await verifySocialProof(
        prisma,
        userId,
        String(body.provider || ""),
        String(body.username || ""),
        String(body.location || "")
      );
      return reply.send({ proof });
    } catch (e: any) {
      const message = String(e?.message || "");
      if (message === "INVALID_SOCIAL_PROVIDER") {
        return reply.code(400).send({ error: "INVALID_SOCIAL_PROVIDER", message: "Provider must be github, youtube, tiktok, rumble, or x." });
      }
      if (message === "SOCIAL_PROVIDER_NOT_SUPPORTED") {
        return reply.code(400).send({ error: "SOCIAL_PROVIDER_NOT_SUPPORTED", message: "This provider is not enabled yet in this build." });
      }
      if (message === "INVALID_SOCIAL_USERNAME") {
        return reply.code(400).send({ error: "INVALID_SOCIAL_USERNAME", message: "Enter a valid account username." });
      }
      if (message === "INVALID_YOUTUBE_CHANNEL_URL") {
        return reply.code(400).send({ error: "INVALID_YOUTUBE_CHANNEL_URL", message: "Enter a valid YouTube channel URL (/@handle or /channel/<id>)." });
      }
      if (message === "INVALID_INSTAGRAM_PROFILE_URL") {
        return reply.code(400).send({ error: "INVALID_INSTAGRAM_PROFILE_URL", message: "Enter a valid Instagram profile URL (https://www.instagram.com/<handle>/)." });
      }
      if (message === "INVALID_TIKTOK_PROFILE_URL") {
        return reply.code(400).send({ error: "INVALID_TIKTOK_PROFILE_URL", message: "Enter a valid TikTok profile URL (https://www.tiktok.com/@handle)." });
      }
      if (message === "INVALID_RUMBLE_PROFILE_URL") {
        return reply.code(400).send({ error: "INVALID_RUMBLE_PROFILE_URL", message: "Enter a valid Rumble profile URL (https://rumble.com/c/<handle> or https://rumble.com/user/<handle>)." });
      }
      if (message === "INVALID_SOCIAL_LOCATION") {
        return reply.code(400).send({ error: "INVALID_SOCIAL_LOCATION", message: "Enter a valid public proof URL." });
      }
      if (message === "SOCIAL_LOCATION_MISMATCH") {
        return reply.code(400).send({ error: "SOCIAL_LOCATION_MISMATCH", message: "The URL does not appear to belong to that account." });
      }
      if (message === "PROOF_CHALLENGE_NOT_FOUND") {
        return reply.code(404).send({ error: "PROOF_CHALLENGE_NOT_FOUND", message: "Create a social challenge first." });
      }
      if (message === "PROOF_CHALLENGE_INVALID") {
        return reply.code(409).send({ error: "PROOF_CHALLENGE_INVALID", message: "Stored social challenge is invalid. Create a new challenge." });
      }
      if (isWitnessStoreSchemaError(e)) {
        req.log.warn({ err: e }, "witness.proofs.social.verify.store_not_ready");
        return reply.code(503).send({
          error: "WITNESS_STORE_NOT_READY",
          message: "Proof storage is not ready on this node. Run: npx prisma db push --schema prisma/schema.prisma"
        });
      }
      req.log.error({ err: e }, "witness.proofs.social.verify.failed");
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  app.post("/api/profile/verification/nostr/challenge", { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req?.user?.sub || "").trim();
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const body = (req.body || {}) as NostrChallengeBody;
    try {
      const proof = await createNostrChallenge(prisma, userId, String(body.pubkey || ""));
      return reply.send({ proof });
    } catch (e: any) {
      const message = String(e?.message || "");
      if (message === "INVALID_NOSTR_PUBKEY") {
        return reply.code(400).send({ error: "INVALID_NOSTR_PUBKEY", message: "Enter a valid Nostr npub or hex pubkey." });
      }
      if (message === "WITNESS_IDENTITY_REQUIRED") {
        return reply.code(409).send({ error: "WITNESS_IDENTITY_REQUIRED", message: "Create a creator identity key before Nostr verification." });
      }
      if (isWitnessStoreSchemaError(e)) {
        req.log.warn({ err: e }, "witness.proofs.nostr.challenge.store_not_ready");
        return reply.code(503).send({
          error: "WITNESS_STORE_NOT_READY",
          message: "Proof storage is not ready on this node. Run: npx prisma db push --schema prisma/schema.prisma"
        });
      }
      req.log.error({ err: e }, "witness.proofs.nostr.challenge.failed");
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  app.post("/api/profile/verification/nostr/verify", { preHandler: requireAuth }, async (req: any, reply: any) => {
    const userId = String(req?.user?.sub || "").trim();
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const body = (req.body || {}) as NostrVerifyBody;
    try {
      const proof = await verifyNostrProof(prisma, userId, String(body.pubkey || ""), body.signedEvent);
      return reply.send({ proof });
    } catch (e: any) {
      const message = String(e?.message || "");
      if (message === "INVALID_NOSTR_PUBKEY") {
        return reply.code(400).send({ error: "INVALID_NOSTR_PUBKEY", message: "Enter a valid Nostr npub or hex pubkey." });
      }
      if (message === "INVALID_NOSTR_EVENT") {
        return reply.code(400).send({ error: "INVALID_NOSTR_EVENT", message: "Provide a valid signed Nostr event JSON." });
      }
      if (message === "PROOF_CHALLENGE_NOT_FOUND") {
        return reply.code(404).send({ error: "PROOF_CHALLENGE_NOT_FOUND", message: "Create a Nostr challenge first." });
      }
      if (message === "PROOF_CHALLENGE_INVALID") {
        return reply.code(409).send({ error: "PROOF_CHALLENGE_INVALID", message: "Stored Nostr challenge is invalid. Create a new challenge." });
      }
      if (isWitnessStoreSchemaError(e)) {
        req.log.warn({ err: e }, "witness.proofs.nostr.verify.store_not_ready");
        return reply.code(503).send({
          error: "WITNESS_STORE_NOT_READY",
          message: "Proof storage is not ready on this node. Run: npx prisma db push --schema prisma/schema.prisma"
        });
      }
      req.log.error({ err: e }, "witness.proofs.nostr.verify.failed");
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });
}
