import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = `receipt-test-${Date.now()}@example.com`;
  const user = await prisma.user.create({ data: { email, displayName: "Receipt Test" } });

  const purchase = await prisma.creditPurchase.create({
    data: {
      userId: user.id,
      proofHash: "proofhash_test",
      contentId: "content_test",
      splitVersion: 1,
      rateSatsPerUnit: 100,
      unitsPurchased: 1,
      amountSats: 100,
      invoiceId: "invoice_test",
      paymentHash: "paymenthash_test",
      provider: "lnd",
      status: "paid",
      expiresAt: new Date(Date.now() + 60_000),
      paidAt: new Date()
    }
  });

  const r1 = await prisma.creditReceiptRef.create({
    data: {
      purchaseId: purchase.id,
      receiptId: `receipt-${Date.now()}`,
      receiptPath: "receipts/receipt-test.json",
      issuedAt: new Date()
    }
  });

  let dupOk = false;
  try {
    await prisma.creditReceiptRef.create({
      data: {
        purchaseId: purchase.id,
        receiptId: `receipt-${Date.now()}-dup`,
        receiptPath: "receipts/receipt-test-dup.json",
        issuedAt: new Date()
      }
    });
  } catch {
    dupOk = true;
  }
  assert.ok(dupOk, "duplicate receipt creation should be rejected by unique constraint");
  assert.ok(r1.receiptId, "receiptId created");

  console.log("receipt_idempotent_test OK");
}

main()
  .catch((e) => {
    console.error("receipt_idempotent_test failed", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
