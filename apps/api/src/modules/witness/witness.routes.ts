import { getWitnessIdentity, registerWitnessIdentity } from "./witness.service.js";
import { registerWitnessProofRoutes } from "./proof.routes.js";
import type { WitnessRegisterBody } from "./witness.types.js";

function isWitnessStoreSchemaError(err: any): boolean {
  const code = String((err as any)?.code || "");
  const message = String((err as any)?.message || "");
  if (code === "P2021" || code === "P2022") return true;
  return /WitnessIdentity/i.test(message) && /does not exist|Unknown field/i.test(message);
}

export function registerWitnessRoutes(app: any, deps: {
  prisma: any;
  requireAuth: any;
}) {
  const { prisma, requireAuth } = deps;
  app.log.info("Witness routes registered");
  registerWitnessProofRoutes(app, deps);

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
}
