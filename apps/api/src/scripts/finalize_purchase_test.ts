import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { finalizePurchase } from "../payments/finalizePurchase.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run finalize_purchase_test");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function run() {
  const user = await prisma.user.create({
    data: {
      email: `test+${Date.now()}@contentbox.local`
    }
  });

  const content = await prisma.contentItem.create({
    data: {
      ownerUserId: user.id,
      title: `Test Content ${Date.now()}`,
      type: "file",
      status: "published",
      storefrontStatus: "LISTED"
    }
  });

  const split = await prisma.splitVersion.create({
    data: {
      contentId: content.id,
      versionNumber: 1,
      status: "locked",
      createdByUserId: user.id,
      lockedAt: new Date()
    }
  });

  await prisma.splitParticipant.create({
    data: {
      splitVersionId: split.id,
      participantEmail: user.email,
      participantUserId: user.id,
      role: "writer",
      roleCode: "writer",
      percent: "100",
      bps: 10000
    }
  });

  await prisma.contentItem.update({
    where: { id: content.id },
    data: { currentSplitId: split.id }
  });

  const intent = await prisma.paymentIntent.create({
    data: {
      buyerUserId: user.id,
      contentId: content.id,
      manifestSha256: "manif-test-1",
      amountSats: 1000n,
      status: "paid",
      purpose: "CONTENT_PURCHASE",
      subjectType: "CONTENT",
      subjectId: content.id,
      paidVia: "onchain"
    }
  });

  const first = await finalizePurchase(intent.id, prisma);
  const second = await finalizePurchase(intent.id, prisma);

  const settlementCount = await prisma.settlement.count({ where: { paymentIntentId: intent.id } });
  const entitlementCount = await prisma.entitlement.count({
    where: { buyerUserId: user.id, contentId: content.id, manifestSha256: "manif-test-1" }
  });

  assert.equal(settlementCount, 1, "settlement should be idempotent");
  assert.equal(entitlementCount, 1, "entitlement should be idempotent");
  assert.ok(first.receiptToken || second.receiptToken, "receiptToken should be minted for storefront content");

  const badIntent = await prisma.paymentIntent.create({
    data: {
      buyerUserId: user.id,
      contentId: content.id,
      manifestSha256: "manif-test-2",
      amountSats: 1000n,
      status: "paid",
      purpose: "TIP",
      subjectType: "CONTENT",
      subjectId: content.id
    }
  });

  let threw = false;
  try {
    await finalizePurchase(badIntent.id, prisma);
  } catch {
    threw = true;
  }
  assert.ok(threw, "finalizePurchase should reject non-CONTENT_PURCHASE intents");

  await prisma.settlement.deleteMany({ where: { paymentIntentId: intent.id } });
  await prisma.entitlement.deleteMany({ where: { contentId: content.id } });
  await prisma.paymentIntent.deleteMany({ where: { contentId: content.id } });
  await prisma.splitParticipant.deleteMany({ where: { splitVersionId: split.id } });
  await prisma.splitVersion.delete({ where: { id: split.id } });
  await prisma.contentItem.delete({ where: { id: content.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

run()
  .then(() => {
    console.log("finalize_purchase_test OK");
    return prisma.$disconnect();
  })
  .catch((err) => {
    console.error("finalize_purchase_test FAILED", err);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
