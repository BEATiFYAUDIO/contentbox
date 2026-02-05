import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = `spend-test-${Date.now()}@example.com`;
  const user = await prisma.user.create({ data: { email, displayName: "Spend Test" } });

  const purchase = await prisma.creditPurchase.create({
    data: {
      userId: user.id,
      proofHash: "proofhash_test",
      contentId: "content_test",
      splitVersion: 1,
      rateSatsPerUnit: 100,
      unitsPurchased: 2,
      amountSats: 200,
      invoiceId: "invoice_test",
      paymentHash: "paymenthash_test",
      provider: "lnd",
      status: "paid",
      expiresAt: new Date(Date.now() + 60_000),
      paidAt: new Date()
    }
  });

  const receipt = await prisma.creditReceiptRef.create({
    data: {
      purchaseId: purchase.id,
      receiptId: `receipt-${Date.now()}`,
      receiptPath: "receipts/receipt-test.json",
      issuedAt: new Date()
    }
  });

  await prisma.creditSpend.create({ data: { receiptId: receipt.receiptId, unitIndex: 0 } });
  let dupOk = false;
  try {
    await prisma.creditSpend.create({ data: { receiptId: receipt.receiptId, unitIndex: 0 } });
  } catch {
    dupOk = true;
  }
  assert.ok(dupOk, "duplicate spend should be rejected by unique constraint");

  console.log("spend_unique_test OK");
}

main()
  .catch((e) => {
    console.error("spend_unique_test failed", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
