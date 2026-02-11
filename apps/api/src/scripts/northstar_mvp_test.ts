import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const baseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = (process.env.JWT_SECRET || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!jwtSecret) throw new Error("JWT_SECRET is required");

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function signJwt(payload: Record<string, any>, secret: string) {
  const header = { alg: "HS256", typ: "JWT" };
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
  const encoded = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  const sig = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

async function postJson(url: string, body: any, token?: string) {
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

async function getJson(url: string, token?: string) {
  const res = await fetch(url, {
    method: "GET",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
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

async function run() {
  let sellerId: string | null = null;
  let collaboratorId: string | null = null;
  let contentId: string | null = null;
  let splitId: string | null = null;
  let paymentIntentId: string | null = null;

  try {
    process.env.DEV_ALLOW_SIMULATE_PAYMENTS = "1";

    const seller = await prisma.user.create({ data: { email: `seller+${Date.now()}@contentbox.local` } });
    sellerId = seller.id;
    const collaborator = await prisma.user.create({ data: { email: `collab+${Date.now()}@contentbox.local` } });
    collaboratorId = collaborator.id;

    const content = await prisma.contentItem.create({
      data: {
        ownerUserId: seller.id,
        title: `Northstar test ${Date.now()}`,
        type: "video",
        status: "draft",
        storefrontStatus: "UNLISTED",
        priceSats: 1000n
      }
    });
    contentId = content.id;

    await prisma.contentFile.create({
      data: {
        contentId: content.id,
        objectKey: `file_${Date.now()}`,
        originalName: "test.mp4",
        mime: "video/mp4",
        sizeBytes: 100,
        sha256: crypto.randomBytes(32).toString("hex")
      }
    });

    const split = await prisma.splitVersion.create({
      data: {
        contentId: content.id,
        versionNumber: 1,
        createdByUserId: seller.id,
        status: "ready"
      }
    });
    splitId = split.id;

    await prisma.splitParticipant.createMany({
      data: [
        {
          splitVersionId: split.id,
          participantEmail: seller.email,
          participantUserId: seller.id,
          role: "writer",
          roleCode: "writer",
          percent: "60",
          bps: 6000,
          acceptedAt: new Date()
        },
        {
          splitVersionId: split.id,
          participantEmail: collaborator.email,
          participantUserId: collaborator.id,
          role: "writer",
          roleCode: "writer",
          percent: "40",
          bps: 4000,
          acceptedAt: new Date()
        }
      ]
    });

    const sellerToken = signJwt({ sub: seller.id }, jwtSecret);
    const publishRes = await postJson(`${baseUrl}/api/content/${content.id}/publish`, {}, sellerToken);
    assert.equal(publishRes.status, 200, `publish failed: ${publishRes.text}`);

    const offerRes = await getJson(`${baseUrl}/p2p/content/${content.id}/offer`);
    assert.equal(offerRes.status, 200, `offer failed: ${offerRes.text}`);
    const manifestSha256 = offerRes.json?.manifestSha256;
    assert.ok(manifestSha256, "manifestSha256 missing");

    const intentRes = await postJson(`${baseUrl}/p2p/payments/intents`, {
      contentId: content.id,
      manifestSha256,
      amountSats: "1000"
    });
    assert.equal(intentRes.status, 200, `intent create failed: ${intentRes.text}`);
    paymentIntentId = intentRes.json?.paymentIntentId || intentRes.json?.intentId || null;
    assert.ok(paymentIntentId, "paymentIntentId missing");

    const simRes = await postJson(`${baseUrl}/api/dev/simulate-pay`, { paymentIntentId, paidVia: "lightning" });
    assert.equal(simRes.status, 200, `simulate-pay failed: ${simRes.text}`);

    const refreshRes = await postJson(`${baseUrl}/api/payments/intents/${paymentIntentId}/refresh`, {});
    assert.equal(refreshRes.status, 200, `refresh failed: ${refreshRes.text}`);
    assert.equal(refreshRes.json?.status, "paid", "intent not paid");

    const royaltiesRes = await getJson(`${baseUrl}/finance/royalties`, sellerToken);
    assert.equal(royaltiesRes.status, 200, `royalties failed: ${royaltiesRes.text}`);
    const rows = royaltiesRes.json?.items || [];
    const row = rows.find((r: any) => r.contentId === content.id) || null;
    assert.ok(row, "royalty row missing");
    assert.equal(row.allocationSats, "600", "expected 60% of 1000 sats");

    console.log("northstar_mvp_test OK");
  } finally {
    if (paymentIntentId) await prisma.paymentIntent.deleteMany({ where: { id: paymentIntentId } }).catch(() => {});
    if (splitId) await prisma.splitParticipant.deleteMany({ where: { splitVersionId: splitId } }).catch(() => {});
    if (splitId) await prisma.splitVersion.deleteMany({ where: { id: splitId } }).catch(() => {});
    if (contentId) await prisma.contentFile.deleteMany({ where: { contentId } }).catch(() => {});
    if (contentId) await prisma.contentItem.deleteMany({ where: { id: contentId } }).catch(() => {});
    if (sellerId) await prisma.user.deleteMany({ where: { id: sellerId } }).catch(() => {});
    if (collaboratorId) await prisma.user.deleteMany({ where: { id: collaboratorId } }).catch(() => {});
    await prisma.$disconnect();
  }
}

run().catch((err) => {
  console.error("northstar_mvp_test failed:", err);
  process.exit(1);
});
