import type { buildAudienceReport } from "./audienceAnalytics.js";

type Report = Awaited<ReturnType<typeof buildAudienceReport>>;
export type AudienceExportFormat = "csv" | "json";
export const AUDIENCE_EXPORT_MAX_BYTES = 10 * 1024 * 1024;

const point = (row: Report["series"][number], commerce: boolean) => ({
  period: row.bucket, viewCoverage: row.viewCoverage, buyPageViews: row.views,
  completedPurchases: commerce ? row.purchases : null, indicativeRatio: commerce ? row.conversionRate : null
});

export function audienceExportDocument(report: Report, generatedAt = new Date()) {
  const commerce = report.supportsCommerceMetrics && report.posture !== "basic";
  const comparable = report.metadata.viewCoverage === "observed_after_boundary";
  return {
    schemaVersion: 1,
    kind: "certifyd_audience_aggregate_export",
    notice: "An analytics report, not a restorable Certifyd Core backup.",
    generatedAt: generatedAt.toISOString(),
    range: report.range,
    scope: "Account totals and periods include all owned works. Content rows include only this page; download each page to retain every work.",
    page: report.pagination.page,
    pagination: { ...report.pagination },
    posture: report.posture,
    totals: {
      buyPageViews: report.totalViews,
      legacyContentOpens: report.totalLegacyOpens,
      completedPurchases: commerce ? report.totalPurchases : null,
      undatedCompletedPurchases: commerce ? report.undatedPaidPurchases : null,
      indicativeRatio: commerce && comparable ? report.conversionRate : null
    },
    measurement: {
      periodStart: report.metadata.periodStart,
      periodEndExclusive: report.metadata.periodEndExclusive,
      periodDefinition: report.metadata.periodDefinition,
      viewRetentionDays: report.viewWindowDays,
      viewRetentionStart: report.metadata.viewRetentionStart,
      firstAvailableBuyPageViewAt: report.metadata.earliestAvailableBuyPageViewAt,
      trackingActivationAt: report.metadata.trackingActivationAt,
      coverageFrom: report.metadata.coverageFrom,
      viewCoverage: report.metadata.viewCoverage,
      coverageNote: report.metadata.coverageNote,
      conversionStart: report.metadata.conversionStart,
      viewDefinition: report.metadata.viewDefinition,
      legacyDefinition: report.metadata.legacyDefinition,
      paidPurchaseDefinition: report.metadata.paidPurchaseDefinition
    },
    accountPeriods: report.series.map((row) => point(row, commerce)),
    content: report.items.map((item) => ({
      contentId: item.contentId, title: item.title, status: item.status, rank: item.rank,
      buyPageViews: item.views, legacyContentOpens: item.legacyOpens,
      completedPurchases: commerce ? item.purchases : null, indicativeRatio: commerce && comparable ? item.conversionRate : null,
      periods: item.series.map((row) => point(row, commerce))
    }))
  };
}

const columns = ["schema_version", "record_type", "generated_at", "scope", "range", "page", "total_pages", "total_items",
  "content_id", "title", "status", "rank", "period", "view_coverage", "buy_page_views",
  "legacy_content_opens", "completed_purchases", "indicative_ratio", "period_start",
  "period_end_exclusive", "view_retention_days", "view_retention_start", "first_available_buy_page_view_at",
  "tracking_activation_at", "conversion_start",
  "view_definition", "legacy_definition", "paid_purchase_definition", "coverage_note"] as const;

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  // Work titles are creator-controlled. Prevent spreadsheet formula execution on open.
  const safe = /^[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

type Document = ReturnType<typeof audienceExportDocument>;
function csvParts(document: Document, full = false) {
  const base = { schema_version: full ? 2 : 1, generated_at: document.generatedAt, scope: full
      ? "Complete available Audience report for all owned works; not a Core backup."
      : document.scope,
    range: document.range, page: full ? "all" : document.page,
    total_pages: document.pagination.totalPages, total_items: document.pagination.totalItems,
    period_start: document.measurement.periodStart, period_end_exclusive: document.measurement.periodEndExclusive,
    view_retention_days: document.measurement.viewRetentionDays,
    view_retention_start: document.measurement.viewRetentionStart,
    first_available_buy_page_view_at: document.measurement.firstAvailableBuyPageViewAt,
    tracking_activation_at: document.measurement.trackingActivationAt,
    conversion_start: document.measurement.conversionStart,
    view_definition: document.measurement.viewDefinition, legacy_definition: document.measurement.legacyDefinition,
    paid_purchase_definition: document.measurement.paidPurchaseDefinition,
    coverage_note: document.measurement.coverageNote };
  const line = (row: Record<string, unknown>) => columns.map((name) => csvCell(row[name])).join(",") + "\r\n";
  const account: string[] = [];
  account.push(line({ ...base, record_type: "account_total", view_coverage: document.measurement.viewCoverage,
    buy_page_views: document.totals.buyPageViews, legacy_content_opens: document.totals.legacyContentOpens,
    completed_purchases: document.totals.completedPurchases, indicative_ratio: document.totals.indicativeRatio }));
  for (const period of document.accountPeriods) account.push(line({ ...base, record_type: "account_period",
    period: period.period, view_coverage: period.viewCoverage, buy_page_views: period.buyPageViews,
    completed_purchases: period.completedPurchases, indicative_ratio: period.indicativeRatio }));
  const content: string[] = [];
  for (const item of document.content) {
    const work = { ...(full ? { schema_version: 2, range: document.range } : base),
      content_id: item.contentId, title: item.title, status: item.status, rank: item.rank };
    content.push(line({ ...work, record_type: "content_total", view_coverage: document.measurement.viewCoverage,
      buy_page_views: item.buyPageViews, legacy_content_opens: item.legacyContentOpens,
      completed_purchases: item.completedPurchases, indicative_ratio: item.indicativeRatio }));
    for (const period of item.periods) content.push(line({ ...work, record_type: "content_period",
      period: period.period, view_coverage: period.viewCoverage, buy_page_views: period.buyPageViews,
      completed_purchases: period.completedPurchases, indicative_ratio: period.indicativeRatio }));
  }
  return { header: columns.join(",") + "\r\n", account, content };
}

export function audienceCsvParts(report: Report, generatedAt = new Date(), full = false) {
  return csvParts(audienceExportDocument(report, generatedAt), full);
}

export function assertAudiencePageBounds(report: Report) {
  if (report.items.length > report.pagination.pageSize || report.pagination.pageSize > 50 || report.series.length > 400 ||
      report.items.some((item) => Buffer.byteLength(item.title) > 4096 || item.series.length > 400)) {
    throw new Error("Audience export exceeds the per-page size limit");
  }
}

export function serializeAudienceExport(report: Report, format: AudienceExportFormat, generatedAt = new Date()): string {
  assertAudiencePageBounds(report);
  const document = audienceExportDocument(report, generatedAt);
  if (format === "json") {
    const output = JSON.stringify(document, null, 2);
    if (Buffer.byteLength(output) > AUDIENCE_EXPORT_MAX_BYTES) throw new Error("Audience export exceeds the per-page size limit");
    return output;
  }
  const parts = csvParts(document);
  const lines = [parts.header];
  let bytes = Buffer.byteLength(parts.header);
  for (const line of [...parts.account, ...parts.content]) {
    bytes += Buffer.byteLength(line);
    if (bytes > AUDIENCE_EXPORT_MAX_BYTES) throw new Error("Audience export exceeds the per-page size limit");
    lines.push(line);
  }
  return lines.join("");
}

export function audienceExportFilename(range: string, page: number, format: AudienceExportFormat, now = new Date()) {
  return `certifyd-audience-${range}-page-${page}-${now.toISOString().slice(0, 10)}.${format}`;
}
