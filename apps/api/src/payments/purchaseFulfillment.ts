import type { Prisma, PrismaClient } from "@prisma/client";
import { finalizePurchase, SETTLEMENT_ALLOCATION_INVALID } from "./finalizePurchase.js";

const checkpointId = (intentId: string) => `purchase-fulfillment:${intentId}`;
const buyerBindingId = (intentId: string) => `purchase-buyer:${intentId}`;
export type FulfillmentResult = {
  status: "complete" | "pending" | "legacy_untracked";
  code?: string;
  receiptToken?: string | null;
};

// The caller supplies only the Buyer from its validated session, never request
// body identity claims. Persist association without granting access or paying.
export async function bindPurchaseBuyer(prisma: PrismaClient, intentId: string, buyerId: string) {
  const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intentId }, include: { content: true } });
  await prisma.buyer.findUniqueOrThrow({ where: { id: buyerId } });
  if (intent.status !== "pending") throw new Error("PENDING_PURCHASE_REQUIRED");
  await prisma.auditEvent.upsert({
    where: { id: buyerBindingId(intentId) }, update: {},
    create: { id: buyerBindingId(intentId), userId: intent.content.ownerUserId, action: "purchase.buyer_bound",
      entityType: "PaymentIntent", entityId: intentId, payloadJson: { buyerId } }
  });
}

export async function readPurchaseBuyerBinding(prisma: PrismaClient, intentId: string): Promise<string | null> {
  const binding = await prisma.auditEvent.findUnique({ where: { id: buyerBindingId(intentId) } });
  const buyerId = (binding?.payloadJson as { buyerId?: string } | null)?.buyerId;
  return buyerId && await prisma.buyer.findUnique({ where: { id: buyerId } }) ? buyerId : null;
}

// Called inside the transaction that first records verified settlement. This is
// deliberately not a historical backfill and does not infer Buyer from User IDs.
export async function trackSettledPurchase(
  tx: Prisma.TransactionClient,
  input: { intentId: string; buyerId: string | null; rail: string }
) {
  const intent = await tx.paymentIntent.findUniqueOrThrow({ where: { id: input.intentId }, include: { content: true } });
  if (intent.status !== "paid" || intent.purpose !== "CONTENT_PURCHASE") throw new Error("SETTLED_PURCHASE_REQUIRED");
  await tx.auditEvent.upsert({
    where: { id: checkpointId(intent.id) }, update: {},
    create: {
      id: checkpointId(intent.id), userId: intent.content.ownerUserId,
      action: "purchase.fulfillment", entityType: "PaymentIntent", entityId: intent.id,
      payloadJson: { status: "pending", buyerId: input.buyerId, rail: input.rail }
    }
  });
}

// No rail lookups, receipt rotation, provider calls, or payout dependencies here.
export async function recoverPurchaseFulfillment(prisma: PrismaClient, intentId: string): Promise<FulfillmentResult> {
  const checkpoint = await prisma.auditEvent.findUnique({ where: { id: checkpointId(intentId) } });
  if (!checkpoint) return { status: "legacy_untracked" };
  const state = checkpoint.payloadJson as { status: string; buyerId: string | null; rail: string };
  const intent = await prisma.paymentIntent.findUnique({ where: { id: intentId } });
  if (!intent || intent.status !== "paid") return { status: "pending", code: "SETTLED_PURCHASE_REQUIRED" };
  if (state.status === "complete") return { status: "complete", receiptToken: intent.receiptToken };
  try {
    const result = await finalizePurchase(intentId, prisma, {
      checkpointId: checkpoint.id, buyerId: state.buyerId, rail: state.rail
    });
    return { status: "complete", receiptToken: result.receiptToken };
  } catch (error: any) {
    // A concurrent winner may have completed while this transaction was retried.
    const latest = await prisma.auditEvent.findUnique({ where: { id: checkpoint.id } });
    if ((latest?.payloadJson as any)?.status === "complete") return { status: "complete", receiptToken: intent.receiptToken };
    const known = [SETTLEMENT_ALLOCATION_INVALID, "Locked child split not found", "MULTIPLE_PARENTS_NOT_SUPPORTED",
      "DERIVATIVE_PARENT_SPLIT_AUTHORITY_MISSING", "DERIVATIVE_PARENT_SPLIT_AUTHORITY_INVALID"];
    const code = known.includes(error?.message) ? error.message : "PURCHASE_FULFILLMENT_FAILED";
    await prisma.auditEvent.create({ data: {
      userId: checkpoint.userId, action: "purchase.fulfillment_failed", entityType: "PaymentIntent", entityId: intentId,
      payloadJson: { code }
    } });
    return { status: "pending", code };
  }
}
