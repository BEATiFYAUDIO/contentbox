import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { AudienceAllExportChangedError, AudienceAllExportLimitError, buildAudienceAllFile } from "./audienceExportAll.js";
import { audienceExportDocument } from "./audienceExport.js";
import type { CloudflareExportSnapshot, CloudflareExportSource } from "./audienceExportAll.js";

type Report = Parameters<typeof audienceExportDocument>[0];
const now = new Date("2026-10-19T12:00:00Z");
function page(n: number, total = 53, basic = false): Report {
  const ids = Array.from({ length: Math.max(0, Math.min(50, total - (n - 1) * 50)) }, (_, i) => `work-${(n - 1) * 50 + i + 1}`);
  return {
    posture: basic ? "basic" : "sovereign", supportsCommerceMetrics: !basic, range: "all",
    totalViews: 20, totalLegacyOpens: 3, totalPurchases: 2, undatedPaidPurchases: 1, conversionRate: 10,
    viewWindowDays: 395,
    pagination: { page: n, pageSize: 50, totalItems: total, totalPages: Math.ceil(total / 50) },
    metadata: { periodStart: null, periodEndExclusive: now.toISOString(), periodDefinition: "UTC", viewRetentionStart: now.toISOString(),
      earliestAvailableBuyPageViewAt: null, trackingActivationAt: null, coverageFrom: null, viewCoverage: "incomplete",
      coverageNote: "History incomplete", conversionStart: null, viewDefinition: "buy_page_v2", legacyDefinition: "legacy",
      paidPurchaseDefinition: "paid", granularity: "day", trendStart: now.toISOString() },
    series: [{ bucket: "2026-10-19", views: null, viewCoverage: "unknown", purchases: 2, conversionRate: null }],
    items: ids.map((contentId, i) => ({ contentId, title: i === 0 ? "=formula" : contentId, status: "published",
      rank: (n - 1) * 50 + i + 1, views: 1, legacyOpens: 0, purchases: 1, conversionRate: 100,
      series: [{ bucket: "2026-10-19", views: null, viewCoverage: "unknown", purchases: 1, conversionRate: null }],
      buyerCredential: "secret-marker" }))
  } as unknown as Report;
}

test("full JSON export includes each owned work, account aggregates once, and no private fields", async () => {
  const calls: number[] = [];
  const output = await buildAudienceAllFile(async (n) => { calls.push(n); return page(n); }, "json", { asOf: now });
  try {
    const raw = await fs.readFile(output.filePath, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.schemaVersion, 3);
    assert.deepEqual(parsed.cloudflare.aggregates, []);
    assert.deepEqual(calls, [1, 2]);
    assert.equal(parsed.content.length, 53);
    assert.equal(new Set(parsed.content.map((item: { contentId: string }) => item.contentId)).size, 53);
    assert.equal(parsed.accountPeriods.length, 1);
    assert.equal(parsed.totals.indicativeRatio, null);
    assert.equal(parsed.content[0].indicativeRatio, null);
    assert.equal(parsed.accountPeriods[0].buyPageViews, null);
    assert.doesNotMatch(raw, /buyerCredential|secret-marker/);
    assert.equal(output.size, Buffer.byteLength(raw));
  } finally { await output.cleanup(); }
  await assert.rejects(fs.access(output.filePath));
});

test("full CSV export has one account total and period, and Basic exports omit commerce", async () => {
  const output = await buildAudienceAllFile(async (n) => page(n, 53, true), "csv", { asOf: now });
  try {
    const raw = await fs.readFile(output.filePath, "utf8");
    assert.equal((raw.match(/"account_total"/g) || []).length, 1);
    assert.equal((raw.match(/"account_period"/g) || []).length, 1);
    assert.equal((raw.match(/"content_total"/g) || []).length, 53);
    assert.match(raw, /'=formula/);
    assert.doesNotMatch(raw, /secret-marker/);
    const accountRow = raw.split("\r\n").find((line) => line.includes('"account_total"'))!;
    assert.match(accountRow, /"20"/);
  } finally { await output.cleanup(); }
});

test("page cap and changed pagination fail closed and clean up temporary files", async () => {
  let calls = 0;
  await assert.rejects(buildAudienceAllFile(async (n) => { calls++; return page(n, 101); }, "json", { maxPages: 2 }), AudienceAllExportLimitError);
  assert.equal(calls, 1);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "audience-export-test-"));
  try {
    await assert.rejects(buildAudienceAllFile(async (n) => n === 1 ? page(1) : page(1), "json", { tempRoot: root }), AudienceAllExportChangedError);
    assert.deepEqual(await fs.readdir(root), []);
    await assert.rejects(buildAudienceAllFile(async (n) => page(n), "json", { tempRoot: root, maxBytes: 100 }), AudienceAllExportLimitError);
    assert.deepEqual(await fs.readdir(root), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("500 owned works export in bounded sequential pages", async () => {
  const calls: number[] = [];
  const output = await buildAudienceAllFile(async (n) => { calls.push(n); return page(n, 500); }, "json", { asOf: now });
  try {
    const parsed = JSON.parse(await fs.readFile(output.filePath, "utf8"));
    assert.deepEqual(calls, Array.from({ length: 10 }, (_, i) => i + 1));
    assert.equal(parsed.content.length, 500);
    assert.equal(parsed.accountPeriods.length, 1);
  } finally { await output.cleanup(); }
});

test("empty owned library still exports one valid account report", async () => {
  const output = await buildAudienceAllFile(async () => page(1, 0), "json", { asOf: now });
  try {
    const parsed = JSON.parse(await fs.readFile(output.filePath, "utf8"));
    assert.deepEqual(parsed.content, []);
    assert.equal(parsed.pagination.totalItems, 0);
    assert.equal(parsed.accountPeriods.length, 1);
  } finally { await output.cleanup(); }
});

test("full export route authenticates and queries only the requesting creator", () => {
  const source = fsSync.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(source, /app\.get\("\/audience\/export-all", \{ preHandler: \[requireAuth\] \}/);
  assert.match(source, /const userId = \(req\.user as JwtUser\)\.sub;\s+const isBasicPosture = resolveProductTier\(\)\.productTier === "basic";\s+output = await buildAudienceAllFile\(\(page, asOf\) =>\s+buildAudienceReport\(prisma, userId, isBasicPosture, query\.range, page, asOf\)/);
  const route = source.slice(source.indexOf('app.get("/audience/export-all"'), source.indexOf('const cloudflareAudienceSyncing'));
  assert.match(route, /cloudflare: cloudflareAudienceExportSource\(prisma, userId\)/);
  assert.doesNotMatch(route, /tokenCiphertext|tokenIv|tokenTag|cloudflareAnalyticsConnection/);
});

const zoneId = "a".repeat(32);
const fetchedAt = new Date("2026-10-19T09:00:00Z");
const updatedAt = new Date("2026-10-19T09:01:00Z");
function cloudflareRows(): CloudflareExportSnapshot[] {
  return [
    { id: "new-country", zoneId, hostname: "creator.beatifygroup.com", source: "cloudflare_http",
      metric: "country", day: "2026-09-01", rowsJson: JSON.stringify([{ label: "Canada", count: 7, visitorId: "must-not-export" }]),
      sampleInterval: 10, coverage: "observed", fetchedAt },
    { id: "referrer", zoneId, hostname: "creator.beatifygroup.com", source: "cloudflare_web_analytics",
      metric: "referrer", day: "2026-10-18", rowsJson: JSON.stringify([{ label: "=spreadsheet", count: 2 }]),
      sampleInterval: 2, coverage: "partial_day", fetchedAt },
    { id: "old-country", zoneId, hostname: "creator.beatifygroup.com", source: "cloudflare_http",
      metric: "country", day: "2026-09-01", rowsJson: JSON.stringify([{ label: "Canada", count: 5 }]),
      sampleInterval: 5, coverage: "observed", fetchedAt: new Date("2026-10-18T09:00:00Z") },
    { id: "unknown", zoneId, hostname: "creator.beatifygroup.com", source: "cloudflare_http",
      metric: "traffic", day: "2026-10-17", rowsJson: "[]", sampleInterval: null,
      coverage: "no_data", fetchedAt }
  ];
}
function cloudflareSource(rows = cloudflareRows()): CloudflareExportSource {
  return {
    page: async (cursor) => cursor ? [] : rows,
    fingerprint: async () => ({ count: rows.length, latestUpdatedAt: updatedAt })
  };
}

test("full JSON includes cached Cloudflare history once, with provenance and no sensitive fields", async () => {
  const output = await buildAudienceAllFile(async () => ({ ...page(1, 1), range: "7d" }), "json",
    { asOf: now, cloudflare: cloudflareSource() });
  try {
    const raw = await fs.readFile(output.filePath, "utf8");
    const document = JSON.parse(raw);
    assert.equal(document.schemaVersion, 3);
    assert.equal(document.range, "7d");
    assert.equal(document.accountPeriods.length, 1);
    assert.equal(document.cloudflare.aggregates.length, 3);
    assert.equal(document.cloudflare.aggregates.find((row: { metric: string }) => row.metric === "country").day, "2026-09-01");
    assert.equal(document.cloudflare.aggregates.find((row: { metric: string }) => row.metric === "country").rows[0].count, 7);
    assert.equal(document.cloudflare.aggregates.find((row: { metric: string }) => row.metric === "country").sampleInterval, 10);
    assert.equal(document.cloudflare.aggregates.find((row: { metric: string }) => row.metric === "referrer").source, "cloudflare_web_analytics");
    assert.equal(document.cloudflare.aggregates.find((row: { metric: string }) => row.metric === "traffic").coverage, "no_data");
    assert.doesNotMatch(raw, /visitorId|must-not-export|tokenCiphertext|tokenIv|tokenTag|buyerCredential|secret-marker/);
    assert.equal(output.cloudflareCount, 3);
  } finally { await output.cleanup(); }
});

test("full CSV includes Cloudflare rows and escapes aggregate labels", async () => {
  const output = await buildAudienceAllFile(async () => page(1, 1), "csv", { asOf: now, cloudflare: cloudflareSource() });
  try {
    const raw = await fs.readFile(output.filePath, "utf8");
    assert.match(raw.split("\r\n")[0], /cloudflare_hostname,cloudflare_source,cloudflare_metric/);
    assert.equal((raw.match(/"account_total"/g) || []).length, 1);
    assert.equal((raw.match(/"cloudflare_aggregate"/g) || []).length, 3);
    assert.match(raw, /"'=spreadsheet"/);
    assert.match(raw, /"no_data"/);
    assert.doesNotMatch(raw, /visitorId|must-not-export|tokenCiphertext/);
  } finally { await output.cleanup(); }
});

test("Cloudflare cache changes and oversized history fail without leaving a download", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "audience-cloudflare-export-"));
  try {
    let checks = 0;
    await assert.rejects(buildAudienceAllFile(async () => page(1, 1), "json", { tempRoot: root,
      cloudflare: { page: cloudflareSource().page, fingerprint: async () =>
        ({ count: ++checks === 1 ? 4 : 5, latestUpdatedAt: updatedAt }) } }), AudienceAllExportChangedError);
    assert.deepEqual(await fs.readdir(root), []);
    await assert.rejects(buildAudienceAllFile(async () => page(1, 1), "json", { tempRoot: root,
      cloudflare: cloudflareSource(), maxCloudflareRows: 2 }), AudienceAllExportLimitError);
    assert.deepEqual(await fs.readdir(root), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("Cloudflare history streams across bounded pages with native totals written once", async () => {
  const rows = Array.from({ length: 120 }, (_, index): CloudflareExportSnapshot => ({
    id: `row-${String(index).padStart(3, "0")}`, zoneId, hostname: "creator.beatifygroup.com",
    source: "cloudflare_http", metric: "traffic",
    day: new Date(Date.UTC(2026, 9, 19 - index)).toISOString().slice(0, 10),
    rowsJson: '[{"label":"all","count":1}]', sampleInterval: 1, coverage: "observed", fetchedAt
  }));
  const cursors: Array<string | null> = [];
  const source: CloudflareExportSource = {
    fingerprint: async () => ({ count: rows.length, latestUpdatedAt: updatedAt }),
    page: async (cursor) => {
      cursors.push(cursor);
      const start = cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0;
      return rows.slice(start, start + 50);
    }
  };
  const output = await buildAudienceAllFile(async () => page(1, 1), "json", { asOf: now, cloudflare: source });
  try {
    const parsed = JSON.parse(await fs.readFile(output.filePath, "utf8"));
    assert.equal(parsed.cloudflare.aggregates.length, 120);
    assert.equal(parsed.accountPeriods.length, 1);
    assert.deepEqual(cursors, [null, rows[49].id, rows[99].id]);
  } finally { await output.cleanup(); }
});
