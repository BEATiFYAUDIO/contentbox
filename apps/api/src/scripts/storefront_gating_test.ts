import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { stableStringify } from "../lib/proof.js";
import { finalizePurchase } from "../payments/finalizePurchase.js";

const baseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
if (process.env.DEV_ALLOW_SIMULATE_PAYMENTS !== "1") {
  throw new Error("DEV_ALLOW_SIMULATE_PAYMENTS=1 is required to run storefront_gating_test");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run storefront_gating_test");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

function sha256Json(json: any): string {
  return crypto.createHash("sha256").update(stableStringify(json)).digest("hex");
}

async function postJson(url: string, body: any, token?: string | null) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function getJson(url: string) {
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function run() {
  let ownerId: string | null = null;
  let authUserId: string | null = null;
  let contentId: string | null = null;
  let splitId: string | null = null;
  let manifestId: string | null = null;
  const title = `[test] storefront_gating ${Date.now()}`;

  try {
    const owner = await prisma.user.create({
      data: {
        email: `test+${Date.now()}@contentbox.local`
      }
    });
    ownerId = owner.id;

    const content = await prisma.contentItem.create({
      data: {
        ownerUserId: owner.id,
        title,
        type: "file",
        status: "published",
        storefrontStatus: "DISABLED"
      }
    });
    contentId = content.id;

    const split = await prisma.splitVersion.create({
      data: {
        contentId: content.id,
        versionNumber: 1,
        status: "locked",
        createdByUserId: owner.id,
        lockedAt: new Date()
      }
    });
    splitId = split.id;

    await prisma.splitParticipant.create({
      data: {
        splitVersionId: split.id,
        participantEmail: owner.email,
        participantUserId: owner.id,
        role: "writer",
        roleCode: "writer",
        percent: "100",
        bps: 10000
      }
    });

    const manifestJson = {
      contentId: content.id,
      title: content.title,
      description: null,
      type: content.type,
      status: content.status,
      createdAt: new Date().toISOString(),
      files: []
    };
    const manifestSha256 = sha256Json(manifestJson);

    const manifest = await prisma.manifest.create({
      data: {
        contentId: content.id,
        json: manifestJson as any,
        sha256: manifestSha256
      }
    });
    manifestId = manifest.id;

    await prisma.contentItem.update({
      where: { id: content.id },
      data: { manifestId: manifest.id, currentSplitId: split.id }
    });

    // TEST 1: unauth intent fails when storefront disabled
    const payload = {
      purpose: "CONTENT_PURCHASE",
      subjectType: "CONTENT",
      subjectId: content.id,
      manifestSha256,
      amountSats: "1000"
    };

    const disabledRes = await postJson(`${baseUrl}/api/payments/intents`, payload);
    assert.ok([403, 404].includes(disabledRes.status), `expected 403/404, got ${disabledRes.status}`);

    await prisma.contentItem.update({ where: { id: content.id }, data: { storefrontStatus: "UNLISTED" } });

    const enabledRes = await postJson(`${baseUrl}/api/payments/intents`, payload);
    assert.equal(enabledRes.status, 200, `expected 200, got ${enabledRes.status}`);
    assert.ok(enabledRes.json?.intentId, "intentId should be returned when storefront enabled");

    // TEST 2: public access blocked when storefront disabled even with receiptToken
    if (process.env.NODE_ENV === "production") {
      throw new Error("NODE_ENV must not be production for storefront_gating_test");
    }

    const intentId = enabledRes.json.intentId as string;
    await prisma.paymentIntent.update({
      where: { id: intentId },
      data: { status: "paid", paidVia: "onchain", paidAt: new Date(), confirmations: 1, onchainTxid: "devtx", onchainVout: 0 }
    });
    await finalizePurchase(intentId, prisma);
    const updated = await prisma.paymentIntent.findUnique({ where: { id: intentId } });
    const receiptToken = updated?.receiptToken;
    assert.ok(receiptToken, "receiptToken should be minted for storefront-enabled content");

    const accessOk = await getJson(
      `${baseUrl}/public/content/${content.id}/access?manifestSha256=${encodeURIComponent(manifestSha256)}&receiptToken=${encodeURIComponent(receiptToken)}`
    );
    assert.equal(accessOk.status, 200, `public access expected 200, got ${accessOk.status}`);
    assert.ok(accessOk.json?.ok, "public access should return ok payload");

    await prisma.contentItem.update({ where: { id: content.id }, data: { storefrontStatus: "DISABLED" } });

    const accessBlocked = await getJson(
      `${baseUrl}/public/content/${content.id}/access?manifestSha256=${encodeURIComponent(manifestSha256)}&receiptToken=${encodeURIComponent(receiptToken)}`
    );
    assert.ok([403, 404].includes(accessBlocked.status), `expected 403/404, got ${accessBlocked.status}`);

    // TEST 3: authenticated intent succeeds even when storefront disabled
    const signup = await postJson(`${baseUrl}/auth/signup`, {
      email: `auth+${Date.now()}@contentbox.local`,
      password: "password123"
    });
    authUserId = signup.json?.user?.id || null;
    const authToken = signup.json?.token || null;
    assert.ok(authToken, "signup should return token");

    const authRes = await postJson(`${baseUrl}/api/payments/intents`, payload, authToken);
    assert.equal(authRes.status, 200, `auth intent expected 200, got ${authRes.status}`);
    assert.ok(authRes.json?.intentId, "auth intent should return intentId");
  } finally {
    if (contentId) {
      await prisma.settlementLine.deleteMany({ where: { settlement: { contentId } } }).catch(() => {});
      await prisma.settlement.deleteMany({ where: { contentId } }).catch(() => {});
      await prisma.entitlement.deleteMany({ where: { contentId } }).catch(() => {});
      await prisma.paymentIntent.deleteMany({ where: { contentId } }).catch(() => {});
      if (splitId) await prisma.splitParticipant.deleteMany({ where: { splitVersionId: splitId } }).catch(() => {});
      await prisma.splitVersion.deleteMany({ where: { contentId } }).catch(() => {});
      if (manifestId) await prisma.manifest.deleteMany({ where: { contentId } }).catch(() => {});
      await prisma.contentItem.delete({ where: { id: contentId } }).catch(() => {});
    }
    if (ownerId) {
      await prisma.user.deleteMany({ where: { id: ownerId } }).catch(() => {});
    }
    if (authUserId) {
      await prisma.user.deleteMany({ where: { id: authUserId } }).catch(() => {});
    }
  }
}

run()
  .then(() => {
    console.log("storefront_gating_test OK");
    return prisma.$disconnect();
  })
  .catch((err) => {
    console.error("storefront_gating_test FAILED", err);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
