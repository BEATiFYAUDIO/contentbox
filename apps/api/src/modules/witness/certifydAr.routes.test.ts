import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { closeSync, mkdtempSync, openSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { computeWitnessFingerprint } from "./witness.service.js";
import { getPublicCertifydArConnections, isCanonicalEd25519PublicKey, registerCertifydArRoutes } from "./certifydAr.routes.js";

const cwd = path.resolve(import.meta.dirname, "../../../");

function keyPair() {
  const pair = crypto.generateKeyPairSync("ed25519");
  const publicKey = (pair.publicKey.export({ format: "jwk" }) as any).x;
  return { privateKey: pair.privateKey, publicKey: Buffer.from(publicKey, "base64url").toString("base64") };
}

test("Certifyd AR approval is signed, scoped to the owner, public, and revocable", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "certifyd-ar-test-"));
  const url = `file:${path.join(dir, "core.db")}`;
  closeSync(openSync(path.join(dir, "core.db"), "w"));
  execFileSync("npx", ["prisma", "db", "push", "--schema", "prisma/schema.prisma", "--skip-generate"], {
    cwd, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe"
  });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const app = Fastify();
  registerCertifydArRoutes(app, {
    prisma,
    requireAuth: async (req: any, reply: any) => {
      const userId = req.headers["x-test-user"];
      if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
      req.user = { sub: userId };
    }
  });
  try {
    const owner = await prisma.user.create({ data: { email: "ar-owner@example.test" } });
    const stranger = await prisma.user.create({ data: { email: "ar-stranger@example.test" } });
    const root = keyPair();
    const ar = keyPair();
    const fingerprint = computeWitnessFingerprint(root.publicKey);
    const identity = await prisma.witnessIdentity.create({ data: {
      userId: owner.id, algorithm: "ed25519", publicKey: root.publicKey, fingerprint
    } });
    await prisma.witnessIdentityKey.create({ data: {
      userId: owner.id, witnessIdentityId: identity.id, algorithm: "ed25519",
      publicKey: root.publicKey, fingerprint, status: "active", activatedAt: new Date()
    } });
    const proof = await prisma.proofRecord.create({ data: {
      userId: owner.id, witnessIdentityId: identity.id, proofType: "social",
      subject: "spotify:artist-1", claimJson: { provider: "spotify", account: "artist-1" },
      status: "verified", verificationMethod: "test", verifiedAt: new Date()
    } });
    const base = "/api/profile/connected-apps/certifyd-ar";
    assert.equal(isCanonicalEd25519PublicKey(ar.publicKey), true);
    assert.equal(isCanonicalEd25519PublicKey("AAAA"), false);
    assert.equal((await app.inject({ method: "POST", url: `${base}/challenge`, payload: { publicKey: ar.publicKey } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: `${base}/challenge`, headers: { "x-test-user": owner.id }, payload: { publicKey: "AAAA" } })).statusCode, 400);

    const challenged = await app.inject({ method: "POST", url: `${base}/challenge`, headers: { "x-test-user": owner.id }, payload: { publicKey: ar.publicKey } });
    assert.equal(challenged.statusCode, 200);
    const { challengeId, authorizationText } = challenged.json();
    assert.match(authorizationText, /Purpose: Certifyd AR publishing/);
    const signature = crypto.sign(null, Buffer.from(authorizationText), root.privateKey).toString("base64");
    assert.equal((await app.inject({ method: "POST", url: `${base}/connect`, headers: { "x-test-user": stranger.id }, payload: { challengeId, signature } })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: `${base}/connect`, headers: { "x-test-user": owner.id }, payload: { challengeId, signature: "wrong" } })).statusCode, 403);

    const retry = await app.inject({ method: "POST", url: `${base}/challenge`, headers: { "x-test-user": owner.id }, payload: { publicKey: ar.publicKey } });
    const signed = crypto.sign(null, Buffer.from(retry.json().authorizationText), root.privateKey).toString("base64");
    const connected = await app.inject({ method: "POST", url: `${base}/connect`, headers: { "x-test-user": owner.id }, payload: { challengeId: retry.json().challengeId, signature: signed } });
    assert.equal(connected.statusCode, 201);
    assert.equal((await app.inject({ method: "POST", url: `${base}/connect`, headers: { "x-test-user": owner.id }, payload: { challengeId: retry.json().challengeId, signature: signed } })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: `${base}/challenge`, headers: { "x-test-user": owner.id }, payload: { publicKey: ar.publicKey } })).statusCode, 409);

    const publicConnections = await getPublicCertifydArConnections(prisma, owner.id, identity);
    assert.equal(publicConnections.length, 1);
    assert.equal(publicConnections[0].publicKey, ar.publicKey);
    assert.equal(crypto.verify(null, Buffer.from(publicConnections[0].authorizationText), root.privateKey, Buffer.from(publicConnections[0].signature, "base64")), true);
    assert.equal((await app.inject({ method: "GET", url: base, headers: { "x-test-user": owner.id } })).json().connections.length, 1);
    assert.equal((await app.inject({ method: "DELETE", url: `${base}/${connected.json().connection.id}`, headers: { "x-test-user": stranger.id } })).statusCode, 404);
    assert.equal((await app.inject({ method: "DELETE", url: `${base}/${connected.json().connection.id}`, headers: { "x-test-user": owner.id } })).statusCode, 200);
    assert.deepEqual(await getPublicCertifydArConnections(prisma, owner.id, identity), []);
    assert.equal((await prisma.witnessIdentity.findUnique({ where: { id: identity.id } }))?.publicKey, root.publicKey);
    assert.equal((await prisma.proofRecord.findUnique({ where: { id: proof.id } }))?.status, "verified");
  } finally {
    await app.close();
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
