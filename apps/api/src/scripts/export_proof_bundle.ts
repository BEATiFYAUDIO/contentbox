import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  buildBundle,
  computeSplitsHash,
  sortLines,
  sortParticipants,
  type ParentPublishAnchor,
  type ProofBundleV1,
  type PublishAnchor,
  type SettlementLine,
  type SettlementReceipt,
  type SplitAnchor,
  type SplitParticipantRef
} from "../lib/proofs/proofBundle.js";
import { stableStringify } from "../lib/proof.js";

const prisma = new PrismaClient();

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
}

function recipientRefForParticipant(p: {
  participantUserId?: string | null;
  participantEmail?: string | null;
  id?: string | null;
}): string {
  if (p.participantUserId) return `user:${p.participantUserId}`;
  if (p.participantEmail) return `email:${String(p.participantEmail).trim().toLowerCase()}`;
  if (p.id) return `participant:${p.id}`;
  return "unknown";
}

function recipientDisplayForParticipant(p: { participantEmail?: string | null; participantUserId?: string | null }): string | undefined {
  if (p.participantEmail) return String(p.participantEmail).trim();
  if (p.participantUserId) return `user:${p.participantUserId}`;
  return undefined;
}

function toSatsNumber(value: bigint | number | null | undefined): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Math.floor(value);
  return 0;
}

async function buildSplitAnchorFromVersion(split: any): Promise<{ anchor: SplitAnchor; participants: SplitParticipantRef[] }> {
  const participants: SplitParticipantRef[] = (split?.participants || []).map((p: any) => ({
    recipientRef: recipientRefForParticipant(p),
    bps: Math.floor(Number(p.bps || 0)),
    recipientDisplay: recipientDisplayForParticipant(p)
  }));
  const sortedParticipants = sortParticipants(participants);
  const splitsHash = computeSplitsHash({
    splitVersionId: String(split.id),
    contentId: String(split.contentId),
    lockedManifestSha256: split.lockedManifestSha256 || null,
    lockedFileSha256: split.lockedFileSha256 || null,
    participants: sortedParticipants
  });
  return {
    anchor: {
      contentId: String(split.contentId),
      splitVersionId: String(split.id),
      lockedManifestSha256: split.lockedManifestSha256 || null,
      lockedFileSha256: split.lockedFileSha256 || null,
      splitsHash,
      lockedAt: split.lockedAt ? new Date(split.lockedAt).toISOString() : null,
      participants: sortedParticipants
    },
    participants: sortedParticipants
  };
}

function buildPublishAnchor(content: any, splitAnchor: SplitAnchor, manifest: any): PublishAnchor {
  return {
    contentId: String(content.id),
    manifestSha256: String(manifest.sha256),
    splitVersionId: splitAnchor.splitVersionId,
    splitsHash: splitAnchor.splitsHash,
    publishedAt: manifest.createdAt ? new Date(manifest.createdAt).toISOString() : null
  };
}

async function buildParentPublishAnchor(contentId: string): Promise<ParentPublishAnchor | undefined> {
  const link = await prisma.contentLink.findFirst({
    where: { childContentId: contentId },
    orderBy: { parentContentId: "asc" },
    include: {
      parentContent: {
        include: {
          manifest: true,
          splitVersions: { include: { participants: true } }
        }
      }
    }
  });
  if (!link?.parentContent) return undefined;
  const parent = link.parentContent;
  const manifest = parent.manifest;
  if (!manifest) return undefined;
  const split =
    parent.splitVersions.find((s: any) => s.id === parent.currentSplitId) ||
    parent.splitVersions.sort((a: any, b: any) => b.versionNumber - a.versionNumber)[0];
  if (!split) return undefined;
  const parentSplit = await buildSplitAnchorFromVersion(split);
  return {
    parentContentId: String(parent.id),
    parentManifestSha256: String(manifest.sha256),
    parentSplitVersionId: parentSplit.anchor.splitVersionId,
    parentSplitsHash: parentSplit.anchor.splitsHash
  };
}

async function run() {
  const contentId = argValue("--content");
  const settlementId = argValue("--settlement");
  const outPath = argValue("--out");

  if (!contentId || !outPath) {
    console.error("Usage: npx tsx src/scripts/export_proof_bundle.ts --content <id> [--settlement <id>] --out bundle.json");
    process.exit(1);
  }

  const content = await prisma.contentItem.findUnique({
    where: { id: contentId },
    include: {
      manifest: true,
      splitVersions: { include: { participants: true } }
    }
  });
  if (!content) throw new Error("Content not found");
  if (!content.manifest) throw new Error("Manifest not found");

  const split =
    content.splitVersions.find((s: any) => s.id === content.currentSplitId) ||
    content.splitVersions.find((s: any) => s.status === "locked") ||
    content.splitVersions.sort((a: any, b: any) => b.versionNumber - a.versionNumber)[0];
  if (!split) throw new Error("Split version not found");

  const { anchor: splitAnchor, participants } = await buildSplitAnchorFromVersion(split);
  const publishAnchor = buildPublishAnchor(content, splitAnchor, content.manifest);

  let settlement: SettlementReceipt | undefined;
  let lines: SettlementLine[] | undefined;

  if (settlementId) {
    const settlementRec = await prisma.settlement.findUnique({
      where: { id: settlementId },
      include: { lines: true, payment: true }
    });
    if (!settlementRec) throw new Error("Settlement not found");

    const manifestSha256 = String(settlementRec.payment?.manifestSha256 || content.manifest.sha256);
    settlement = {
      settlementId: settlementRec.id,
      paymentRef: settlementRec.paymentIntentId,
      amountSats: toSatsNumber(settlementRec.netAmountSats),
      paidAt: settlementRec.payment?.paidAt
        ? new Date(settlementRec.payment.paidAt as any).toISOString()
        : settlementRec.createdAt.toISOString(),
      contentId: settlementRec.contentId,
      manifestSha256,
      splitVersionId: settlementRec.splitVersionId,
      splitsHash: splitAnchor.splitsHash
    };

    const byId = new Map<string, SplitParticipantRef>();
    const byEmail = new Map<string, SplitParticipantRef>();
    for (const p of participants) {
      if (p.recipientRef.startsWith("email:")) {
        byEmail.set(p.recipientRef.slice(6).toLowerCase(), p);
      }
    }
    for (const p of split.participants || []) {
      if (p.id) {
        byId.set(String(p.id), {
          recipientRef: recipientRefForParticipant(p),
          bps: Math.floor(Number(p.bps || 0)),
          recipientDisplay: recipientDisplayForParticipant(p)
        });
      }
    }

    const rawLines = (settlementRec.lines || []).map((line) => {
      let ref: SplitParticipantRef | undefined;
      if (line.participantId) ref = byId.get(String(line.participantId));
      if (!ref && line.participantEmail) ref = byEmail.get(String(line.participantEmail).toLowerCase());
      const recipientRef = ref?.recipientRef || (line.participantEmail ? `email:${String(line.participantEmail).toLowerCase()}` : "unknown");
      const recipientDisplay = ref?.recipientDisplay || (line.participantEmail ? String(line.participantEmail) : undefined);
      return {
        recipientRef,
        bps: Math.floor(Number(ref?.bps || 0)),
        amountSats: toSatsNumber(line.amountSats as any),
        recipientDisplay
      };
    });
    lines = sortLines(rawLines);
  }

  const parentPublishAnchor = await buildParentPublishAnchor(contentId);
  const canonicalOrigin = String(process.env.CONTENTBOX_PUBLIC_ORIGIN || "").trim() || null;

  const bundle: ProofBundleV1 = buildBundle({
    version: "v1",
    generatedAt: new Date().toISOString(),
    publish: publishAnchor,
    split: splitAnchor,
    settlement,
    lines,
    canonicalOrigin,
    parentPublishAnchor
  });

  const resolved = path.resolve(outPath);
  fs.writeFileSync(resolved, stableStringify(bundle, true) + "\n", "utf8");
  console.log("proof bundle exported", { out: resolved, bundleHash: bundle.bundleHash });
}

run()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error("export_proof_bundle FAILED", err);
    prisma.$disconnect().finally(() => process.exit(1));
  });
