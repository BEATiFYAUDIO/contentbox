import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const baseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

process.env.DEV_ALLOW_SIMULATE_PAYOUTS = "1";

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": body.idempotencyKey || "" },
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

async function run() {
  let contentId: string | null = null;
  let splitId: string | null = null;
  let payoutId: string | null = null;
  let authorityId: string | null = null;
  let saleId: string | null = null;
  let paymentIntentId: string | null = null;
  let settlementId: string | null = null;
  let sellerId: string | null = null;
  let collaboratorId: string | null = null;
  let participantId: string | null = null;

  const token = crypto.randomBytes(24).toString("base64url");
  const tokenHash = hashToken(token);

  try {
    const seller = await prisma.user.create({ data: { email: `seller+${Date.now()}@contentbox.local` } });
    sellerId = seller.id;
    const collaborator = await prisma.user.create({ data: { email: `collab+${Date.now()}@contentbox.local` } });
    collaboratorId = collaborator.id;

    const content = await prisma.contentItem.create({
      data: {
        ownerUserId: seller.id,
        title: `Payout authority test ${Date.now()}`,
        type: "video",
        status: "published",
        storefrontStatus: "UNLISTED"
      }
    });
    contentId = content.id;

    const split = await prisma.splitVersion.create({
      data: {
        contentId: content.id,
        versionNumber: 1,
        createdByUserId: seller.id,
        status: "locked",
        lockedAt: new Date()
      }
    });
    splitId = split.id;

    const participant = await prisma.splitParticipant.create({
      data: {
        splitVersionId: split.id,
        participantUserId: collaborator.id,
        participantEmail: collaborator.email,
        role: "writer",
        roleCode: "writer",
        percent: "100",
        bps: 10000,
        acceptedAt: new Date()
      }
    });
    participantId = participant.id;

    const intent = await prisma.paymentIntent.create({
      data: {
        buyerUserId: null,
        contentId: content.id,
        amountSats: 1000,
        status: "paid",
        purpose: "CONTENT_PURCHASE",
        subjectType: "CONTENT",
        subjectId: content.id,
        paidVia: "lightning",
        paidAt: new Date()
      }
    });
    paymentIntentId = intent.id;

    const sale = await prisma.sale.create({
      data: {
        contentId: content.id,
        buyerUserId: null,
        amountSats: 1000,
        status: "paid",
        paidAt: new Date(),
        paymentIntentId: intent.id
      }
    });
    saleId = sale.id;

    const settlement = await prisma.settlement.create({
      data: {
        contentId: content.id,
        splitVersionId: split.id,
        netAmountSats: 1000,
        paymentIntentId: intent.id
      }
    });
    settlementId = settlement.id;

    const line = await prisma.settlementLine.create({
      data: {
        settlementId: settlement.id,
        participantId: participant.id,
        participantEmail: collaborator.email,
        role: "writer",
        amountSats: 1000
      }
    });

    await prisma.royalty.create({
      data: {
        saleId: sale.id,
        settlementId: settlement.id,
        settlementLineId: line.id,
        contentId: content.id,
        participantId: participant.id,
        participantEmail: collaborator.email,
        role: "writer",
        amountSats: 1000,
        status: "pending"
      }
    });

    const authority = await prisma.payoutAuthority.create({
      data: {
        tokenHash,
        splitVersionId: split.id,
        splitParticipantId: participant.id,
        sellerUserId: seller.id,
        collaboratorUserId: collaborator.id,
        participantEmail: collaborator.email,
        minWithdrawSats: 1
      }
    });
    authorityId = authority.id;

    const payload = {
      amountSats: 1000,
      payoutDestination: { type: "lightning_address", value: "demo@localhost" },
      memo: "test payout",
      idempotencyKey: "idempo-1"
    };

    const res1 = await postJson(`${baseUrl}/payout/v1/${token}/withdraw`, payload);
    assert.equal(res1.status, 200, `withdraw failed: ${res1.text}`);
    payoutId = res1.json?.payoutId || null;
    assert.ok(payoutId, "payoutId missing");

    const res2 = await postJson(`${baseUrl}/payout/v1/${token}/withdraw`, payload);
    assert.equal(res2.status, 200, `idempotent withdraw failed: ${res2.text}`);
    assert.equal(res2.json?.payoutId, payoutId, "idempotent payoutId mismatch");

    const royalties = await prisma.royalty.findMany({ where: { settlementId: settlement.id } });
    assert.equal(royalties.every((r) => r.status === "paid"), true, "royalties should be paid");

    const payout = await prisma.payout.findUnique({ where: { id: payoutId! } });
    assert.equal(payout?.status, "completed", "payout should be completed");

    console.log("payout_authority_test OK");
  } finally {
    if (authorityId) await prisma.payoutAuthority.deleteMany({ where: { id: authorityId } }).catch(() => {});
    if (payoutId) await prisma.payout.deleteMany({ where: { id: payoutId } }).catch(() => {});
    if (settlementId) await prisma.settlementLine.deleteMany({ where: { settlementId } }).catch(() => {});
    if (settlementId) await prisma.settlement.deleteMany({ where: { id: settlementId } }).catch(() => {});
    if (saleId) await prisma.sale.deleteMany({ where: { id: saleId } }).catch(() => {});
    if (paymentIntentId) await prisma.paymentIntent.deleteMany({ where: { id: paymentIntentId } }).catch(() => {});
    if (splitId) await prisma.splitParticipant.deleteMany({ where: { splitVersionId: splitId } }).catch(() => {});
    if (splitId) await prisma.splitVersion.deleteMany({ where: { id: splitId } }).catch(() => {});
    if (contentId) await prisma.contentItem.deleteMany({ where: { id: contentId } }).catch(() => {});
    if (sellerId) await prisma.user.deleteMany({ where: { id: sellerId } }).catch(() => {});
    if (collaboratorId) await prisma.user.deleteMany({ where: { id: collaboratorId } }).catch(() => {});
    await prisma.$disconnect();
  }
}

run().catch((err) => {
  console.error("payout_authority_test failed:", err);
  process.exit(1);
});
