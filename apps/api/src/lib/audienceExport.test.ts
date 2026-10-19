import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { audienceExportDocument, audienceExportFilename, serializeAudienceExport } from "./audienceExport.js";

type Report = Parameters<typeof audienceExportDocument>[0];
const report = {
  posture: "sovereign", supportsCommerceMetrics: true, range: "7d",
  totalViews: 2, totalLegacyOpens: 1, totalPurchases: 1, undatedPaidPurchases: 0, conversionRate: 50,
  viewWindowDays: 395,
  pagination: { page: 1, pageSize: 50, totalItems: 1, totalPages: 1 },
  metadata: {
    periodStart: "2026-10-13T00:00:00.000Z", periodEndExclusive: "2026-10-19T12:00:00.000Z",
    periodDefinition: "UTC calendar days including today", viewRetentionStart: "2025-09-19T12:00:00.000Z",
    earliestAvailableBuyPageViewAt: "2026-10-18T00:00:00.000Z", trackingActivationAt: null,
    coverageFrom: "2026-10-18T00:00:00.000Z", viewCoverage: "incomplete",
    coverageNote: "Earlier history is unknown", conversionStart: "2026-10-18T00:00:00.000Z",
    viewDefinition: "buy_page_v2", legacyDefinition: "older content opens",
    paidPurchaseDefinition: "paid content purchase intents", granularity: "day", trendStart: "2026-10-13T00:00:00.000Z"
  },
  series: [{ bucket: "2026-10-13", views: null, viewCoverage: "unknown", purchases: 0, conversionRate: null }],
  items: [{ contentId: "work-1", title: '=HYPERLINK("bad")', status: "published", rank: 1,
    views: 2, legacyOpens: 1, purchases: 1, conversionRate: 50,
    series: [{ bucket: "2026-10-13", views: null, viewCoverage: "unknown", purchases: 0, conversionRate: null }],
    sessionId: "must-not-export", buyerCredential: "must-not-export" }],
  receiptToken: "must-not-export"
} as unknown as Report;

test("JSON export is versioned, page-bounded, and omits private identifiers", () => {
  const json = serializeAudienceExport(report, "json", new Date("2026-10-19T12:00:00Z"));
  const parsed = JSON.parse(json);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.notice.includes("not a restorable"), true);
  assert.equal(parsed.totals.legacyContentOpens, 1);
  assert.equal(parsed.measurement.viewCoverage, "incomplete");
  assert.equal(parsed.totals.indicativeRatio, null, "incomplete coverage must suppress aggregate conversion");
  assert.equal(parsed.content[0].indicativeRatio, null);
  assert.equal(parsed.accountPeriods[0].buyPageViews, null, "unknown history must not become zero");
  assert.equal(parsed.content[0].contentId, "work-1");
  assert.doesNotMatch(json, /must-not-export|sessionId|buyerCredential|receiptToken/);
  assert.equal(audienceExportFilename("7d", 1, "json", new Date("2026-10-19T12:00:00Z")), "certifyd-audience-7d-page-1-2026-10-19.json");
  const comparable = { ...report, metadata: { ...report.metadata, viewCoverage: "observed_after_boundary" } } as Report;
  assert.equal(audienceExportDocument(comparable).totals.indicativeRatio, 50);
});

test("CSV export separates current views and legacy opens and escapes spreadsheet formulas", () => {
  const csv = serializeAudienceExport(report, "csv");
  assert.match(csv, /legacy_content_opens/);
  assert.match(csv, /account_total/);
  assert.match(csv, /content_period/);
  assert.match(csv, /'=HYPERLINK/);
  assert.doesNotMatch(csv, /must-not-export|sessionId|buyerCredential|receiptToken/);
});

test("Basic exports do not include commerce counts, and oversized pages fail closed", () => {
  const basic = { ...report, posture: "basic" } as Report;
  const parsed = JSON.parse(serializeAudienceExport(basic, "json"));
  assert.equal(parsed.totals.completedPurchases, null);
  assert.equal(parsed.content[0].completedPurchases, null);
  const huge = { ...report, items: [{ ...report.items[0], title: "x".repeat(11 * 1024 * 1024) }] } as Report;
  assert.throws(() => serializeAudienceExport(huge, "json"), /per-page size limit/);
});

test("export route is authenticated and delegates ownership to the existing report", () => {
  const source = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(source, /app\.get\("\/audience\/export", \{ preHandler: \[requireAuth\] \}/);
  assert.match(source, /buildAudienceReport\(prisma, userId, resolveProductTier\(\)\.productTier === "basic", query\.range, query\.page\)/);
});
