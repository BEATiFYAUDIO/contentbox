import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { validatePublicDeliveryTokenClaims } from "./deliverySecurity.js";

async function createJwtApp() {
  const app = Fastify({ logger: false });
  await app.register(jwt, { secret: "delivery-test-secret" });
  await app.ready();
  return app;
}

test("delivery JWT integration rejects random, expired, and modified tokens", async () => {
  const app = await createJwtApp();
  try {
    await assert.rejects(async () => app.jwt.verify("not-a-token"));

    const expired = app.jwt.sign(
      {
        scope: "public_delivery",
        contentId: "content_a",
        objectKey: "files/master.mp3",
        access: "full",
        exp: Math.floor(Date.now() / 1000) - 1
      }
    );
    await assert.rejects(async () => app.jwt.verify(expired));

    const valid = app.jwt.sign(
      {
        scope: "public_delivery",
        contentId: "content_a",
        objectKey: "files/master.mp3",
        access: "full"
      },
      { expiresIn: "120s" }
    );
    const parts = valid.split(".");
    const modified = `${parts[0]}.${Buffer.from(JSON.stringify({
      scope: "public_delivery",
      contentId: "content_b",
      objectKey: "files/master.mp3",
      access: "full"
    })).toString("base64url")}.${parts[2]}`;
    await assert.rejects(async () => app.jwt.verify(modified));
  } finally {
    await app.close();
  }
});

test("delivery JWT integration binds verified claims to exact asset and session", async () => {
  const app = await createJwtApp();
  try {
    const token = app.jwt.sign(
      {
        scope: "public_delivery",
        contentId: "content_a",
        objectKey: "files/master.mp3",
        access: "full",
        buyerSessionId: "session_a"
      },
      { expiresIn: "120s" }
    );
    const claims = await app.jwt.verify(token);
    assert.deepEqual(
      validatePublicDeliveryTokenClaims(claims, {
        contentId: "content_a",
        objectKey: "files/master.mp3",
        paidContent: true,
        requestBuyerSessionId: "session_a"
      }),
      { ok: true, access: "full" }
    );
    assert.equal(
      validatePublicDeliveryTokenClaims(claims, {
        contentId: "content_b",
        objectKey: "files/master.mp3",
        paidContent: true,
        requestBuyerSessionId: "session_a"
      }).ok,
      false
    );
    assert.equal(
      validatePublicDeliveryTokenClaims(claims, {
        contentId: "content_a",
        objectKey: "files/other.mp3",
        paidContent: true,
        requestBuyerSessionId: "session_a"
      }).ok,
      false
    );
    assert.equal(
      validatePublicDeliveryTokenClaims(claims, {
        contentId: "content_a",
        objectKey: "files/master.mp3",
        paidContent: true,
        requestBuyerSessionId: "session_b"
      }).ok,
      false
    );
  } finally {
    await app.close();
  }
});
