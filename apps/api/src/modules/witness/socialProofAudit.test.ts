import assert from "node:assert/strict";
import test from "node:test";
import { auditSocialProofRows } from "./socialProofAudit.js";

const createdAt = new Date("2026-04-21T00:00:00.000Z");
const nonce = "1e8c60105d37be6de8ead458602bd4b6";
const account = "certifydofficial";
const shortTikTok = `certifyd-proof account=${account} nonce=${nonce}`;
const fullTikTok = `certifyd-proof provider=tiktok account=${account} nonce=${nonce}`;
const legacyGithub = `contentbox-social-verify provider=github account=beatifyaudio nonce=${nonce}`;
const canonicalGithub = `certifyd-proof provider=github account=beatifyaudio nonce=${nonce}`;

type Fixture = { body: string; status?: number; finalUrl?: string; redirected?: boolean; contentType?: string };

function html(text: string) {
  return `<!doctype html><html><head><title>Profile</title></head><body>${text}</body></html>`;
}

function makeFetch(fixture: Fixture) {
  return async () => ({
    ok: (fixture.status || 200) >= 200 && (fixture.status || 200) < 300,
    status: fixture.status || 200,
    redirected: Boolean(fixture.redirected),
    url: fixture.finalUrl || `https://www.tiktok.com/@${account}`,
    headers: { get: (name: string) => name.toLowerCase() === "content-type" ? (fixture.contentType || "text/html; charset=utf-8") : null },
    text: async () => fixture.body
  }) as any;
}

function row(id: string, provider: string, proofAccount: string, challengeText: string, location?: string) {
  return {
    id,
    userId: "user-1",
    proofType: "social",
    subject: `${provider}:${proofAccount}`,
    claimJson: { provider, account: proofAccount, challengeText, profileUrl: location || profileUrl(provider, proofAccount) },
    status: "verified",
    signature: null,
    verificationMethod: "url_text",
    createdAt,
    updatedAt: createdAt,
    location: location || profileUrl(provider, proofAccount),
    verifiedAt: createdAt,
    revokedAt: null,
    failureReason: null,
    user: { displayName: "Beatify Group", email: "beatify@example.test" }
  };
}

function profileUrl(provider: string, proofAccount: string) {
  if (provider === "github") return `https://github.com/${proofAccount}`;
  if (provider === "youtube") return `https://www.youtube.com/@${proofAccount}`;
  if (provider === "reddit") return `https://www.reddit.com/user/${proofAccount}`;
  return `https://www.tiktok.com/@${proofAccount}`;
}

class ReadOnlyPrismaStub {
  rows: any[];
  updateCalls = 0;
  constructor(rows: any[]) { this.rows = rows; }
  proofRecord = {
    findUnique: async ({ where }: any) => {
      if (where?.id) return this.rows.find((r) => r.id === where.id) || null;
      const key = where?.userId_proofType_subject;
      return this.rows.find((r) => r.userId === key?.userId && r.proofType === key?.proofType && r.subject === key?.subject) || null;
    },
    update: async () => {
      this.updateCalls += 1;
      throw new Error("AUDIT_MUST_NOT_CALL_REAL_UPDATE");
    }
  };
}

async function runAuditWithFetch(rows: any[], fixture: Fixture) {
  const prisma = new ReadOnlyPrismaStub(rows);
  const before = JSON.stringify(rows);
  const original = globalThis.fetch;
  (globalThis as any).fetch = makeFetch(fixture);
  try {
    const report = await auditSocialProofRows(prisma as any, rows, { contentboxRoot: "/tmp/no-state", publicOrigin: "https://certifyd.example" });
    assert.equal(JSON.stringify(rows), before, "audit mutated source rows");
    assert.equal(prisma.updateCalls, 0, "audit called real update");
    return report.results[0];
  } finally {
    (globalThis as any).fetch = original;
  }
}

test("PASS classification works for canonical TikTok short marker", async () => {
  const result = await runAuditWithFetch([row("p1", "tiktok", account, shortTikTok)], { body: html(shortTikTok) });
  assert.equal(result.finalClassification, "PASS");
  assert.equal(result.verificationSucceeds, true);
  assert.equal(result.successRequiredLegacyCompatibility, false);
});

test("LEGACY_PASS classification works for old full TikTok marker", async () => {
  const result = await runAuditWithFetch([row("p1", "tiktok", account, fullTikTok)], { body: html(shortTikTok) });
  assert.equal(result.finalClassification, "LEGACY_PASS");
  assert.equal(result.verificationSucceeds, true);
  assert.equal(result.successRequiredLegacyCompatibility, true);
});

test("LEGACY_PASS classification works for legacy prefix marker", async () => {
  const result = await runAuditWithFetch([row("p1", "github", "beatifyaudio", legacyGithub)], { body: html(legacyGithub), finalUrl: "https://github.com/beatifyaudio" });
  assert.equal(result.finalClassification, "LEGACY_PASS");
});

test("NEEDS_REVERIFY classification works for missing stale nonce on otherwise correct account", async () => {
  const result = await runAuditWithFetch([row("p1", "tiktok", account, shortTikTok)], { body: html("certifyd-proof account=certifydofficial nonce=stale"), finalUrl: `https://www.tiktok.com/@${account}` });
  assert.equal(result.finalClassification, "NEEDS_REVERIFY");
});

test("BROKEN classification works for malformed records", async () => {
  const result = await runAuditWithFetch([{ ...row("p1", "tiktok", account, shortTikTok), claimJson: { provider: "tiktok" } }], { body: html(shortTikTok) });
  assert.equal(result.finalClassification, "BROKEN");
});

test("UNREACHABLE_PLATFORM_GATED classification works for gated shells", async () => {
  const result = await runAuditWithFetch([row("p1", "tiktok", account, shortTikTok)], { body: html("Log in to continue. Verify you are human captcha.") });
  assert.equal(result.finalClassification, "UNREACHABLE_PLATFORM_GATED");
});

test("wrong account and redirected account mismatch are classified correctly", async () => {
  const wrong = await runAuditWithFetch([row("p1", "tiktok", account, shortTikTok)], { body: html(shortTikTok), finalUrl: "https://www.tiktok.com/@other", redirected: true });
  assert.equal(wrong.finalClassification, "BROKEN");
});

test("audit reuses production verifier behavior and does not mutate proof records", async () => {
  const rows = [row("p1", "github", "beatifyaudio", canonicalGithub)];
  const result = await runAuditWithFetch(rows, { body: html(canonicalGithub), finalUrl: "https://github.com/beatifyaudio" });
  assert.equal(result.finalClassification, "PASS");
  assert.equal(rows[0].status, "verified");
  assert.equal(rows[0].failureReason, null);
});


test("legacy old.reddit.com path is classified LEGACY_PASS in audit", async () => {
  const redditAccount = "lopsided_horror_9957";
  const redditMarker = `certifyd-proof provider=reddit account=${redditAccount} nonce=${nonce}`;
  const result = await runAuditWithFetch(
    [row("p1", "reddit", redditAccount, redditMarker, `https://old.reddit.com/user/${redditAccount}/`)],
    { body: html(redditMarker), finalUrl: `https://www.reddit.com/user/Lopsided_Horror_9957/`, redirected: true }
  );
  assert.equal(result.finalClassification, "LEGACY_PASS");
  assert.equal(result.verificationSucceeds, true);
  assert.equal(result.successRequiredLegacyCompatibility, true);
});
