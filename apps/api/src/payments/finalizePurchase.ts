import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import { allocateByBps } from "../lib/settlement.js";

function toBps(p: any): number {
  if (typeof p?.bps === "number" && Number.isFinite(p.bps) && p.bps > 0) return Math.floor(p.bps);
  const percent = Number(p?.percent ?? 0);
  return Math.round(percent * 100);
}

async function getLockedSplitForContent(prisma: PrismaClient, contentId: string) {
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

async function getStrictLockedSplitForContent(prisma: PrismaClient, contentId: string) {
  const sv = await getLockedSplitForContent(prisma, contentId);
  if (!sv || sv.status !== "locked") return null;
  return sv;
}

export async function finalizePurchase(paymentIntentId: string, client?: PrismaClient) {
  const prisma = client ?? new PrismaClient();
  try {
    const intent = await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });
    if (!intent) throw new Error("PaymentIntent not found");
    if (intent.status !== "paid") throw new Error("PaymentIntent not paid");
    if (intent.purpose !== "CONTENT_PURCHASE") throw new Error("PaymentIntent purpose not CONTENT_PURCHASE");
    if (!intent.manifestSha256) throw new Error("manifestSha256 required");

    const contentId = intent.subjectId;
    const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
    if (!content) throw new Error("Content not found");

    const childSplit = await getLockedSplitForContent(prisma, contentId);
    if (!childSplit) throw new Error("Locked child split not found");

    const parents = await prisma.contentLink.findMany({
      where: { childContentId: contentId },
      orderBy: { id: "asc" }
    });
    if (parents.length > 1) {
      throw new Error("MULTIPLE_PARENTS_NOT_SUPPORTED");
    }
    const net = BigInt(intent.amountSats);

    const primaryParent = parents[0] || null;
    const upstreamRaw =
      primaryParent && primaryParent.upstreamBps > 0
        ? [{ parentContentId: primaryParent.parentContentId, upstreamBps: Math.max(0, primaryParent.upstreamBps) }]
        : [];

    let upstreamTotal = 0n;
    const upstreamAlloc: Array<{ parentContentId: string; amountSats: bigint; upstreamBps: number }> = upstreamRaw.map((p) => {
      const amt = (net * BigInt(p.upstreamBps)) / 10000n;
      upstreamTotal += amt;
      return { parentContentId: p.parentContentId, amountSats: amt, upstreamBps: p.upstreamBps };
    });

    const childRemainder = net - upstreamAlloc.reduce((s, a) => s + a.amountSats, 0n);

    if (upstreamAlloc.length > 0) {
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
              parentCount: parents.length
            } as any
          }
        });
      } catch {}
    }

    const lines: Array<{ participantId?: string | null; participantEmail?: string | null; role?: string | null; amountSats: bigint }> = [];

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

    for (const up of upstreamAlloc) {
      const parentSplit = await getStrictLockedSplitForContent(prisma, up.parentContentId);
      if (!parentSplit) {
        const err: any = new Error("Parent split not locked");
        err.statusCode = 409;
        err.code = "PARENT_SPLIT_NOT_LOCKED";
        throw err;
      }

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

    if (intent.buyerUserId) {
      await prisma.entitlement.upsert({
        where: { buyerUserId_contentId_manifestSha256: { buyerUserId: intent.buyerUserId, contentId, manifestSha256: intent.manifestSha256 } },
        update: { paymentIntentId: intent.id },
        create: { buyerUserId: intent.buyerUserId, contentId, manifestSha256: intent.manifestSha256, paymentIntentId: intent.id }
      }).catch(() => {});
    } else {
      const existingEntitlement = await prisma.entitlement.findFirst({
        where: { buyerUserId: null, contentId, manifestSha256: intent.manifestSha256 }
      });
      if (!existingEntitlement) {
        await prisma.entitlement.create({
          data: { buyerUserId: null, contentId, manifestSha256: intent.manifestSha256, paymentIntentId: intent.id }
        }).catch(() => {});
      }
    }

    const existingSettlement = await prisma.settlement.findUnique({ where: { paymentIntentId: intent.id } });
    if (!existingSettlement) {
      try {
        await prisma.settlement.create({
          data: {
            contentId,
            splitVersionId: childSplit.id,
            netAmountSats: net,
            paymentIntentId: intent.id,
            lines: {
              create: lines.map((l) => ({
                participantId: l.participantId || null,
                participantEmail: l.participantEmail || null,
                role: l.role || null,
                amountSats: l.amountSats
              }))
            }
          }
        });
      } catch (e: any) {
        try {
          await prisma.auditEvent.create({
            data: {
              userId: content.ownerUserId,
              action: "settlement.create.failed",
              entityType: "PaymentIntent",
              entityId: intent.id,
              payloadJson: { error: String(e?.message || e) } as any
            }
          });
        } catch {}
      }
    }

    const ttlSeconds = Math.max(60 * 60 * 24 * 7, Math.floor(Number(process.env.RECEIPT_TOKEN_TTL_SECONDS || String(60 * 60 * 24 * 7))));
    const now = Date.now();
    const tokenExpired = intent.receiptTokenExpiresAt ? intent.receiptTokenExpiresAt.getTime() < now : false;
    const storefrontEnabled = content.storefrontStatus && content.storefrontStatus !== "DISABLED";
    if (storefrontEnabled && (!intent.receiptToken || tokenExpired)) {
      const receiptToken = crypto.randomBytes(24).toString("hex");
      const receiptTokenExpiresAt = new Date(now + ttlSeconds * 1000);
      await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { receiptToken, receiptTokenExpiresAt }
      });
    }

    const updated = await prisma.paymentIntent.findUnique({ where: { id: intent.id } });
    return { ok: true, receiptToken: updated?.receiptToken || null, receiptTokenExpiresAt: updated?.receiptTokenExpiresAt || null };
  } finally {
    if (!client) {
      await prisma.$disconnect().catch(() => {});
    }
  }
}
