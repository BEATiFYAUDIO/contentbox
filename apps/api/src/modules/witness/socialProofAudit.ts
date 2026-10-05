import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { verifySocialProofDryRun } from "./proof.service.js";

export type SocialProofAuditClassification =
  | "PASS"
  | "LEGACY_PASS"
  | "NEEDS_REVERIFY"
  | "BROKEN"
  | "UNREACHABLE_PLATFORM_GATED";

export type SocialProofAuditResult = {
  proofId: string;
  creatorUserId: string;
  creatorProfileHandle: string | null;
  coreProfileUrl: string | null;
  provider: string;
  normalizedAccount: string;
  proofLocation: string | null;
  currentStoredStatus: string;
  verifiedAt: string | null;
  challengeText: string | null;
  currentCanonicalFormat: string;
  publicProofStillResolves: boolean;
  verificationSucceeds: boolean;
  successRequiredLegacyCompatibility: boolean;
  failureReason: string | null;
  finalClassification: SocialProofAuditClassification;
  recommendedHumanAction: string | null;
};

export type SocialProofAuditReport = {
  generatedAt: string;
  counts: Record<SocialProofAuditClassification | "TOTAL", number>;
  results: SocialProofAuditResult[];
};

type ProofRow = {
  id: string;
  userId: string;
  proofType: string;
  subject: string;
  claimJson: unknown;
  status: string;
  location: string | null;
  verifiedAt: Date | string | null;
  revokedAt?: Date | string | null;
  failureReason?: string | null;
  user?: { displayName?: string | null; email?: string | null } | null;
};

type Claim = { provider: string; account: string; challengeText: string; profileUrl: string | null; channelUrl: string | null };

const CLASSIFICATIONS: SocialProofAuditClassification[] = [
  "PASS",
  "LEGACY_PASS",
  "NEEDS_REVERIFY",
  "BROKEN",
  "UNREACHABLE_PLATFORM_GATED"
];

function asString(value: unknown): string {
  return String(value || "").trim();
}

function compact(value: unknown): string {
  return asString(value).replace(/\s+/g, " ");
}

function normalizeAccount(provider: string, value: unknown): string {
  const text = asString(value).replace(/^@+/, "");
  if (provider === "spotify") return text;
  if (provider === "youtube" && /^UC[a-zA-Z0-9_-]{10,}$/.test(text)) return text;
  return text.toLowerCase();
}

function parseClaim(claimJson: unknown): Claim | null {
  if (!claimJson || typeof claimJson !== "object") return null;
  const c = claimJson as Record<string, unknown>;
  const provider = asString(c.provider).toLowerCase();
  const account = asString(c.account || c.username || c.channelIdentifier);
  const challengeText = asString(c.challengeText || c.challenge);
  if (!provider || !account || !challengeText) return null;
  return {
    provider,
    account,
    challengeText,
    profileUrl: asString(c.profileUrl || c.artistUrl) || null,
    channelUrl: asString(c.channelUrl) || null
  };
}

function canonicalFormat(_provider: string): string {
  return "certifyd-proof provider=<provider> account=<account> nonce=<nonce> profile=<canonical-certifyd-profile-url>";
}

function challengeIsCanonical(provider: string, account: string, challengeText: string): boolean {
  const marker = compact(challengeText);
  const normalized = normalizeAccount(provider, account);
  return new RegExp(
    `^certifyd-proof provider=${escapeRegExp(provider)} account=${escapeRegExp(normalized)} nonce=[0-9a-f]{32} profile=https://[^\\s]+/u/[^\\s]+$`,
    "i"
  ).test(marker);
}

function challengeIsLegacy(provider: string, account: string, challengeText: string): boolean {
  const marker = compact(challengeText);
  const normalized = normalizeAccount(provider, account);
  if (provider === "spotify") return /^Certifyd proof: [0-9a-f]{32}$/i.test(marker);
  if (provider === "tiktok" && new RegExp(`^certifyd-proof account=${escapeRegExp(normalized)} nonce=\\S+$`, "i").test(marker)) return true;
  return new RegExp(`^(certifyd-proof|contentbox-social-verify) provider=${escapeRegExp(provider)} account=${escapeRegExp(normalized)} nonce=\\S+$`, "i").test(marker);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function usesLegacyProofLocation(provider: string, location: string | null): boolean {
  if (!location) return false;
  try {
    const url = new URL(location);
    return provider === "reddit" && url.hostname.toLowerCase() === "old.reddit.com";
  } catch {
    return false;
  }
}

function classifyFailure(reason: string | null): SocialProofAuditClassification {
  const r = asString(reason).toLowerCase();
  if (!r) return "UNREACHABLE_PLATFORM_GATED";
  if (
    r.includes("redirect-mismatch") ||
    r.includes("location_mismatch") ||
    r.includes("location-mismatch") ||
    r.includes("invalid_social_location") ||
    r.includes("invalid_social_username") ||
    r.includes("proof_challenge_invalid") ||
    r.includes("wrong account") ||
    r.includes("contradict")
  ) return "BROKEN";
  if (
    r.includes("dynamic-shell") ||
    r.includes("gated") ||
    r.includes("login") ||
    r.includes("timeout") ||
    r.includes("network") ||
    r.includes("http-") ||
    r.includes("non-html") ||
    r.includes("unavailable")
  ) return "UNREACHABLE_PLATFORM_GATED";
  if (
    r.includes("challenge") ||
    r.includes("nonce") ||
    r.includes("missing") ||
    r.includes("different certifyd proof") ||
    r.includes("not found")
  ) return "NEEDS_REVERIFY";
  return "UNREACHABLE_PLATFORM_GATED";
}

function recommendedAction(classification: SocialProofAuditClassification, provider: string, reason: string | null): string | null {
  if (classification === "NEEDS_REVERIFY") return `Re-run the ${provider} social proof flow or republish the current Core challenge marker.`;
  if (classification === "BROKEN") return `Inspect the ${provider} account/location binding and create a fresh proof for the correct current account.`;
  return null;
}

function profileHandleFor(row: ProofRow, handleByUserId: Map<string, string>): string | null {
  return handleByUserId.get(row.userId) || slug(row.user?.displayName || row.user?.email || row.userId) || null;
}

function slug(value: unknown): string {
  return asString(value).toLowerCase().replace(/@.*$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function loadHandleMap(contentboxRoot: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const file = path.join(contentboxRoot, "state", "profile-public-handle-map.json");
  try {
    const rows = JSON.parse(await fs.readFile(file, "utf8"));
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const handle = asString(row?.handle);
        const userId = asString(row?.userId);
        if (handle && userId && !out.has(userId)) out.set(userId, handle);
      }
    }
  } catch {}
  return out;
}

function publicOrigin(): string | null {
  return asString(process.env.CONTENTBOX_PUBLIC_ORIGIN || process.env.PUBLIC_ORIGIN || process.env.APP_PUBLIC_ORIGIN) || null;
}

export async function auditSocialProofRows(
  prisma: PrismaClient,
  rows: ProofRow[],
  options: { contentboxRoot?: string; publicOrigin?: string | null } = {}
): Promise<SocialProofAuditReport> {
  const root = options.contentboxRoot || path.resolve(process.cwd(), "../..");
  const handleByUserId = await loadHandleMap(root);
  const origin = options.publicOrigin === undefined ? publicOrigin() : options.publicOrigin;
  const results: SocialProofAuditResult[] = [];

  for (const row of rows) {
    const claim = parseClaim(row.claimJson);
    const handle = profileHandleFor(row, handleByUserId);
    const coreProfileUrl = origin && handle ? `${origin.replace(/\/+$/, "")}/u/${encodeURIComponent(handle)}` : null;
    if (!claim) {
      results.push({
        proofId: row.id,
        creatorUserId: row.userId,
        creatorProfileHandle: handle,
        coreProfileUrl,
        provider: "",
        normalizedAccount: "",
        proofLocation: row.location,
        currentStoredStatus: row.status,
        verifiedAt: dateString(row.verifiedAt),
        challengeText: null,
        currentCanonicalFormat: "unknown",
        publicProofStillResolves: false,
        verificationSucceeds: false,
        successRequiredLegacyCompatibility: false,
        failureReason: "PROOF_CHALLENGE_INVALID",
        finalClassification: "BROKEN",
        recommendedHumanAction: recommendedAction("BROKEN", "social", "PROOF_CHALLENGE_INVALID")
      });
      continue;
    }

    const provider = claim.provider;
    const normalizedAccount = normalizeAccount(provider, claim.account);
    const canonical = challengeIsCanonical(provider, normalizedAccount, claim.challengeText);
    const legacy = challengeIsLegacy(provider, normalizedAccount, claim.challengeText);
    const location = row.location || claim.profileUrl || claim.channelUrl || "";
    const legacyProofLocation = usesLegacyProofLocation(provider, location || null);
    let verificationSucceeds = false;
    let failureReason: string | null = null;
    let publicProofStillResolves = false;

    try {
      const checked = await verifySocialProofDryRun(prisma, row.userId, provider, normalizedAccount, location);
      verificationSucceeds = checked.status === "verified";
      failureReason = checked.failureReason || null;
      publicProofStillResolves = verificationSucceeds || !/network|timeout|http-|dynamic-shell|gated|login|non-html/i.test(failureReason || "");
    } catch (e: any) {
      failureReason = String(e?.message || e);
      verificationSucceeds = false;
      publicProofStillResolves = false;
    }

    const finalClassification: SocialProofAuditClassification = verificationSucceeds
      ? canonical && !legacyProofLocation ? "PASS" : "LEGACY_PASS"
      : classifyFailure(failureReason);

    results.push({
      proofId: row.id,
      creatorUserId: row.userId,
      creatorProfileHandle: handle,
      coreProfileUrl,
      provider,
      normalizedAccount,
      proofLocation: location || row.location || null,
      currentStoredStatus: row.status,
      verifiedAt: dateString(row.verifiedAt),
      challengeText: claim.challengeText,
      currentCanonicalFormat: canonicalFormat(provider),
      publicProofStillResolves,
      verificationSucceeds,
      successRequiredLegacyCompatibility: verificationSucceeds && (!canonical || legacy || legacyProofLocation),
      failureReason: verificationSucceeds ? null : failureReason,
      finalClassification,
      recommendedHumanAction: recommendedAction(finalClassification, provider, failureReason)
    });
  }

  const counts = Object.fromEntries([["TOTAL", results.length], ...CLASSIFICATIONS.map((c) => [c, 0])]) as Record<SocialProofAuditClassification | "TOTAL", number>;
  for (const result of results) counts[result.finalClassification] += 1;
  return { generatedAt: new Date().toISOString(), counts, results };
}

function dateString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export async function auditSocialProofs(prisma: PrismaClient, options: { contentboxRoot?: string; publicOrigin?: string | null } = {}) {
  const rows = await (prisma as any).proofRecord.findMany({
    where: { proofType: "social" },
    include: { user: { select: { displayName: true, email: true } } },
    orderBy: [{ userId: "asc" }, { subject: "asc" }]
  });
  return auditSocialProofRows(prisma, rows, options);
}

export async function writeSocialProofAuditReports(report: SocialProofAuditReport, outDir: string): Promise<{ markdownPath: string; jsonPath: string }> {
  await fs.mkdir(outDir, { recursive: true });
  const date = report.generatedAt.slice(0, 10);
  const jsonPath = path.join(outDir, `proof-audit-${date}.json`);
  const markdownPath = path.join(outDir, `proof-audit-${date}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");
  return { markdownPath, jsonPath };
}

export function renderMarkdown(report: SocialProofAuditReport): string {
  const lines: string[] = [];
  lines.push(`# Social proof audit ${report.generatedAt.slice(0, 10)}`);
  lines.push("");
  lines.push(`Total proofs: ${report.counts.TOTAL}`);
  for (const c of CLASSIFICATIONS) lines.push(`${c}: ${report.counts[c]}`);
  lines.push("");

  for (const c of CLASSIFICATIONS) {
    lines.push(`## ${c}`);
    lines.push("");
    const rows = report.results.filter((r) => r.finalClassification === c);
    if (!rows.length) {
      lines.push("None.");
      lines.push("");
      continue;
    }
    for (const r of rows) {
      if (c === "PASS" || c === "LEGACY_PASS") {
        lines.push(`- ${r.provider}:${r.normalizedAccount} (${r.creatorProfileHandle || r.creatorUserId})`);
      } else {
        lines.push(`- provider: ${r.provider}`);
        lines.push(`  account: ${r.normalizedAccount}`);
        lines.push(`  profile: ${r.coreProfileUrl || r.creatorProfileHandle || r.creatorUserId}`);
        lines.push(`  location: ${r.proofLocation || ""}`);
        lines.push(`  reason: ${r.failureReason || "unknown"}`);
        lines.push(`  action: ${r.recommendedHumanAction || "Engineering follow-up; no creator action yet."}`);
      }
    }
    lines.push("");
  }

  lines.push("## HUMAN ACTION REQUIRED");
  lines.push("");
  const human = report.results.filter((r) => r.finalClassification === "NEEDS_REVERIFY" || r.finalClassification === "BROKEN");
  if (!human.length) {
    lines.push("None.");
  } else {
    for (const r of human) lines.push(`- ${r.finalClassification}: ${r.provider}:${r.normalizedAccount} — ${r.recommendedHumanAction}`);
  }
  lines.push("");
  return lines.join("\n");
}
