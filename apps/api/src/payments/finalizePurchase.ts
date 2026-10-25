import { Prisma, PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import { allocateByBps } from "../lib/settlement.js";
import { resolveProductTier } from "../lib/productTier.js";
import {
  pickDerivativeParentSplitSnapshotForAuthority,
  requireDerivativeParentSplitSnapshotId
} from "../lib/splitAuthority.js";

function toBps(p: any): number {
  if (typeof p?.bps === "number" && Number.isFinite(p.bps) && p.bps > 0) return Math.floor(p.bps);
  const percent = Number(p?.percent ?? 0);
  return Math.round(percent * 100);
}

async function getLockedSplitForContent(prisma: PrismaClient | Prisma.TransactionClient, contentId: string) {
  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return null;

  if (content.currentSplitId) {
    const sv = await prisma.splitVersion.findUnique({
      where: { id: content.currentSplitId },
      include: { participants: true }
    });
    if (sv) return sv;
  }

  const sv = await prisma.splitVersion.findFirst({
    where: { contentId, status: "locked" },
    orderBy: { versionNumber: "desc" },
    include: { participants: true }
  });
  return sv;
}

export const SETTLEMENT_ALLOCATION_INVALID = "SETTLEMENT_ALLOCATION_INVALID";

function allocationIntegrityError() {
  return Object.assign(new Error(SETTLEMENT_ALLOCATION_INVALID), {
    code: SETTLEMENT_ALLOCATION_INVALID, statusCode: 409
  });
}

function assertSettlementAllocations(net: bigint, lines: Array<{ amountSats: bigint }>) {
  if (net < 0n || (net > 0n && !lines.length) || lines.some(line => line.amountSats < 0n) ||
      lines.reduce((sum, line) => sum + line.amountSats, 0n) !== net) {
    throw allocationIntegrityError();
  }
}

function derivativeAuthorityError(
  code: "DERIVATIVE_PARENT_SPLIT_AUTHORITY_MISSING" | "DERIVATIVE_PARENT_SPLIT_AUTHORITY_INVALID",
  details: Record<string, unknown>
) {
  const err: any = new Error(code);
  err.code = code;
  err.statusCode = 409;
  err.details = details;
  return err;
}

function createStableReceiptId(): string {
  return `rcpt_${crypto.randomBytes(12).toString("hex")}`;
}

export async function resolveDerivativeParentLockedSplitForFinalize(
  prisma: PrismaClient | Prisma.TransactionClient,
  link: { id?: string | null; parentContentId: string; parentSplitVersionId?: string | null }
) {
  let parentSplitVersionId = "";
  try {
    parentSplitVersionId = requireDerivativeParentSplitSnapshotId(link);
  } catch {
    throw derivativeAuthorityError("DERIVATIVE_PARENT_SPLIT_AUTHORITY_MISSING", {
      contentLinkId: String(link.id || "").trim() || null,
      parentContentId: link.parentContentId
    });
  }
  const parentSplit = await prisma.splitVersion.findUnique({
    where: { id: parentSplitVersionId },
    include: { participants: true }
  });
  try {
    pickDerivativeParentSplitSnapshotForAuthority(
      { ...link, parentSplitVersionId },
      parentSplit ? [parentSplit] : []
    );
  } catch {
    throw derivativeAuthorityError("DERIVATIVE_PARENT_SPLIT_AUTHORITY_INVALID", {
      contentLinkId: String(link.id || "").trim() || null,
      parentContentId: link.parentContentId,
      parentSplitVersionId
    });
  }
  return parentSplit as NonNullable<typeof parentSplit>;
}

export type TrackedFulfillment = {
  checkpointId: string;
  buyerId: string | null;
  rail: string;
};

export async function finalizePurchase(paymentIntentId: string, client?: PrismaClient, tracked?: TrackedFulfillment) {
  const prisma = client ?? new PrismaClient();
  const execute = async (prisma: PrismaClient | Prisma.TransactionClient) => {
    // The checkpoint and all fulfillment writes share this transaction. A completed
    // purchase is never regranted by retry (including after access was revoked).
    if (tracked) {
      const checkpoint = await prisma.auditEvent.findUnique({ where: { id: tracked.checkpointId } });
      if (!checkpoint || checkpoint.entityId !== paymentIntentId) throw new Error("FULFILLMENT_CHECKPOINT_REQUIRED");
      if ((checkpoint?.payloadJson as any)?.status === "complete") {
        const existing = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: paymentIntentId } });
        return { ok: true, receiptToken: existing.receiptToken, receiptTokenExpiresAt: existing.receiptTokenExpiresAt };
      }
      const claimed = await prisma.auditEvent.updateMany({
        where: { id: checkpoint.id, payloadJson: { equals: checkpoint.payloadJson as Prisma.InputJsonValue } },
        data: { payloadJson: { status: "fulfilling", buyerId: tracked.buyerId, rail: tracked.rail } }
      });
      if (!claimed.count) throw new Error("FULFILLMENT_IN_PROGRESS");
    }
    const skipSettlement = resolveProductTier().productTier === "basic";
    const intent = await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });
    if (!intent) throw new Error("PaymentIntent not found");
    if (intent.status !== "paid") throw new Error("PaymentIntent not paid");
    if (intent.purpose !== "CONTENT_PURCHASE") throw new Error("PaymentIntent purpose not CONTENT_PURCHASE");
    if (!intent.manifestSha256) throw new Error("manifestSha256 required");

    const contentId = intent.subjectId;
    const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
    if (!content) throw new Error("Content not found");

    const childSplit = skipSettlement ? null : await getLockedSplitForContent(prisma, contentId);
    if (!skipSettlement && !childSplit) throw new Error("Locked child split not found");

    const parentLinks = skipSettlement
      ? []
      : await prisma.contentLink.findMany({
          where: { childContentId: contentId },
          orderBy: { id: "asc" }
        });
    const distinctParentIds = Array.from(
      new Set(parentLinks.map((row) => String(row.parentContentId || "").trim()).filter(Boolean))
    );
    if (!skipSettlement && distinctParentIds.length > 1) {
      throw new Error("MULTIPLE_PARENTS_NOT_SUPPORTED");
    }
    const net = BigInt(intent.amountSats);

    const primaryParent =
      parentLinks
        .slice()
        .sort((a, b) => {
          const aHasSnapshot = String(a.parentSplitVersionId || "").trim() ? 1 : 0;
          const bHasSnapshot = String(b.parentSplitVersionId || "").trim() ? 1 : 0;
          if (aHasSnapshot !== bHasSnapshot) return bHasSnapshot - aHasSnapshot;
          const aUpstream = Math.max(0, Number(a.upstreamBps || 0));
          const bUpstream = Math.max(0, Number(b.upstreamBps || 0));
          if (aUpstream !== bUpstream) return bUpstream - aUpstream;
          return String(b.id || "").localeCompare(String(a.id || ""));
        })[0] || null;
    const upstreamRaw =
      primaryParent && primaryParent.upstreamBps > 0
        ? [
            {
              parentContentId: primaryParent.parentContentId,
              parentSplitVersionId: primaryParent.parentSplitVersionId || null,
              contentLinkId: primaryParent.id,
              upstreamBps: Math.max(0, primaryParent.upstreamBps)
            }
          ]
        : [];

    let upstreamTotal = 0n;
    const upstreamAlloc: Array<{
      parentContentId: string;
      parentSplitVersionId: string | null;
      contentLinkId: string;
      amountSats: bigint;
      upstreamBps: number;
    }> = upstreamRaw.map((p) => {
      const amt = (net * BigInt(p.upstreamBps)) / 10000n;
      upstreamTotal += amt;
      return {
        parentContentId: p.parentContentId,
        parentSplitVersionId: p.parentSplitVersionId,
        contentLinkId: p.contentLinkId,
        amountSats: amt,
        upstreamBps: p.upstreamBps
      };
    });

    const childRemainder = net - upstreamAlloc.reduce((s, a) => s + a.amountSats, 0n);

    if (!skipSettlement && upstreamAlloc.length > 0) {
      try {
        await prisma.auditEvent.create({
          data: {
            userId: content.ownerUserId,
            action: "settlement.upstream",
            entityType: "ContentItem",
            entityId: contentId,
            payloadJson: {
              parentContentId: primaryParent?.parentContentId || null,
              upstreamBps: primaryParent?.upstreamBps ?? null,
              upstreamAmountSats: upstreamAlloc[0]?.amountSats?.toString?.() ?? String(upstreamAlloc[0]?.amountSats ?? 0),
              childRemainderSats: childRemainder.toString(),
              parentCount: parentLinks.length
            } as any
          }
        });
      } catch {}
    }

    const lines: Array<{ participantId?: string | null; participantEmail?: string | null; role?: string | null; amountSats: bigint }> = [];

    if (!skipSettlement && childSplit) {
      const childItems = childSplit.participants.map((p) => ({ id: p.id, bps: toBps(p), p }));
      const childAlloc = allocateByBps(childRemainder, childItems.map((i) => ({ id: i.id, bps: i.bps })));
      for (const a of childAlloc) {
        const p = childItems.find((i) => i.id === a.id)?.p;
        const childRole = upstreamAlloc.length > 0 ? (p?.role ? `derivative:${p.role}` : "derivative") : (p?.role || null);
        lines.push({
          participantId: p?.id || null,
          participantEmail: p?.participantEmail || null,
          role: childRole,
          amountSats: a.amountSats
        });
      }
    }

    if (!skipSettlement) {
      for (const up of upstreamAlloc) {
        const parentSplit = await resolveDerivativeParentLockedSplitForFinalize(prisma, {
          id: up.contentLinkId,
          parentContentId: up.parentContentId,
          parentSplitVersionId: up.parentSplitVersionId
        });

        const parentItems = parentSplit.participants.map((p) => ({ id: p.id, bps: toBps(p), p }));
        const parentAlloc = allocateByBps(up.amountSats, parentItems.map((i) => ({ id: i.id, bps: i.bps })));
        for (const a of parentAlloc) {
          const p = parentItems.find((i) => i.id === a.id)?.p;
          lines.push({
            participantId: p?.id || null,
            participantEmail: p?.participantEmail || null,
            role: "upstream",
            amountSats: a.amountSats
          });
        }
      }
    }

    const existingSettlement = skipSettlement ? null : await prisma.settlement.findUnique({
      where: { paymentIntentId: intent.id }, include: { lines: true }
    });
    // Historical, untracked settlements are not recalculated or repaired. New
    // fulfillment must account for every sat before granting ownership.
    if (!skipSettlement && (tracked || !existingSettlement)) {
      assertSettlementAllocations(net, lines);
      if (existingSettlement) {
        if (existingSettlement.netAmountSats !== net) throw allocationIntegrityError();
        assertSettlementAllocations(net, existingSettlement.lines);
      }
    }

    if (skipSettlement) {
      console.info("skipped settlement: basic tier", { paymentIntentId: intent.id, contentId });
    } else if (childSplit && !existingSettlement) {
      try {
        await prisma.settlement.create({
          data: {
            contentId, splitVersionId: childSplit.id, netAmountSats: net, paymentIntentId: intent.id,
            lines: { create: lines.map(l => ({
              participantId: l.participantId || null, participantEmail: l.participantEmail || null,
              role: l.role || null, amountSats: l.amountSats
            })) }
          }
        });
      } catch (error) {
        if (tracked) throw error;
        await prisma.auditEvent.create({ data: {
          userId: content.ownerUserId, action: "settlement.create.failed", entityType: "PaymentIntent", entityId: intent.id,
          payloadJson: { code: SETTLEMENT_ALLOCATION_INVALID }
        } }).catch(() => {});
        // Legacy callers also must not swallow a failed allocation write and
        // proceed into ownership or payouts. Never alter the verified payment.
        throw allocationIntegrityError();
      }
      const persisted = await prisma.settlement.findUnique({
        where: { paymentIntentId: intent.id }, include: { lines: true }
      });
      if (!persisted || persisted.netAmountSats !== net) throw allocationIntegrityError();
      assertSettlementAllocations(net, persisted.lines);
    }

    if (tracked?.buyerId) {
      await prisma.entitlement.upsert({
        where: { buyerId_contentId: { buyerId: tracked.buyerId, contentId } },
        update: {},
        create: { buyerId: tracked.buyerId, buyerUserId: intent.buyerUserId, contentId,
          manifestSha256: intent.manifestSha256, paymentIntentId: intent.id }
      });
    } else if (intent.buyerUserId) {
      await prisma.entitlement.upsert({
        where: { buyerUserId_contentId_manifestSha256: { buyerUserId: intent.buyerUserId, contentId, manifestSha256: intent.manifestSha256 } },
        update: tracked ? {} : { paymentIntentId: intent.id },
        create: { buyerUserId: intent.buyerUserId, contentId, manifestSha256: intent.manifestSha256, paymentIntentId: intent.id }
      }).catch((error) => { if (tracked) throw error; });
    } else {
      const existingEntitlement = await prisma.entitlement.findFirst({
        where: tracked ? { paymentIntentId: intent.id } : { buyerUserId: null, contentId, manifestSha256: intent.manifestSha256 }
      });
      if (!existingEntitlement) {
        await prisma.entitlement.create({
          data: { buyerUserId: null, contentId, manifestSha256: intent.manifestSha256, paymentIntentId: intent.id }
        }).catch((error) => { if (tracked) throw error; });
      }
    }

    const ttlSeconds = Math.max(60 * 60 * 24 * 7, Math.floor(Number(process.env.RECEIPT_TOKEN_TTL_SECONDS || String(60 * 60 * 24 * 7))));
    const now = Date.now();
    const tokenExpired = intent.receiptTokenExpiresAt ? intent.receiptTokenExpiresAt.getTime() < now : false;
    const storefrontEnabled = content.storefrontStatus && content.storefrontStatus !== "DISABLED";
    const stableReceiptId = String((intent as any)?.receiptId || "").trim();
    if (!stableReceiptId) {
      try {
        await (prisma as any).paymentIntent.update({
          where: { id: intent.id },
          data: { receiptId: createStableReceiptId() }
        });
      } catch (error) { if (tracked) throw error; }
    }
    if (storefrontEnabled && (!intent.receiptToken || (!tracked && tokenExpired))) {
      const receiptToken = crypto.randomBytes(24).toString("hex");
      const receiptTokenExpiresAt = new Date(now + ttlSeconds * 1000);
      await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { receiptToken, receiptTokenExpiresAt }
      });
    }

    if (tracked) {
      if (!skipSettlement) await prisma.sale.upsert({
        where: { intentId: intent.id }, update: {},
        create: { intentId: intent.id, contentId, sellerUserId: content.ownerUserId,
          amountSats: intent.amountSats, currency: "SAT", rail: tracked.rail,
          memo: intent.memo, recognizedAt: intent.paidAt || new Date() }
      });
      await prisma.auditEvent.update({ where: { id: tracked.checkpointId }, data: {
        payloadJson: { status: "complete", buyerId: tracked.buyerId, rail: tracked.rail }
      } });
    }
    const updated = await prisma.paymentIntent.findUnique({ where: { id: intent.id } });
    return { ok: true, receiptToken: updated?.receiptToken || null, receiptTokenExpiresAt: updated?.receiptTokenExpiresAt || null };
  };
  try {
    return tracked ? await prisma.$transaction(execute) : await execute(prisma);
  } finally {
    if (!client) {
      await prisma.$disconnect().catch(() => {});
    }
  }
}
