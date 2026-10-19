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

export function serializeAudienceExport(report: Report, format: AudienceExportFormat, generatedAt = new Date()): string {
  if (report.items.length > report.pagination.pageSize || report.pagination.pageSize > 50 || report.series.length > 400 ||
      report.items.some((item) => Buffer.byteLength(item.title) > 4096 || item.series.length > 400)) {
    throw new Error("Audience export exceeds the per-page size limit");
  }
  const document = audienceExportDocument(report, generatedAt);
  if (format === "json") {
    const output = JSON.stringify(document, null, 2);
    if (Buffer.byteLength(output) > AUDIENCE_EXPORT_MAX_BYTES) throw new Error("Audience export exceeds the per-page size limit");
    return output;
  }
  const base = { schema_version: 1, generated_at: document.generatedAt, scope: document.scope,
    range: document.range, page: document.page,
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
  const rows: Record<string, unknown>[] = [];
  rows.push({ ...base, record_type: "account_total", view_coverage: document.measurement.viewCoverage,
    buy_page_views: document.totals.buyPageViews, legacy_content_opens: document.totals.legacyContentOpens,
    completed_purchases: document.totals.completedPurchases, indicative_ratio: document.totals.indicativeRatio });
  for (const period of document.accountPeriods) rows.push({ ...base, record_type: "account_period",
    period: period.period, view_coverage: period.viewCoverage, buy_page_views: period.buyPageViews,
    completed_purchases: period.completedPurchases, indicative_ratio: period.indicativeRatio });
  for (const item of document.content) {
    const work = { ...base, content_id: item.contentId, title: item.title, status: item.status, rank: item.rank };
    rows.push({ ...work, record_type: "content_total", view_coverage: document.measurement.viewCoverage,
      buy_page_views: item.buyPageViews, legacy_content_opens: item.legacyContentOpens,
      completed_purchases: item.completedPurchases, indicative_ratio: item.indicativeRatio });
    for (const period of item.periods) rows.push({ ...work, record_type: "content_period",
      period: period.period, view_coverage: period.viewCoverage, buy_page_views: period.buyPageViews,
      completed_purchases: period.completedPurchases, indicative_ratio: period.indicativeRatio });
  }
  const lines = [columns.join(",")];
  let bytes = Buffer.byteLength(lines[0]) + 2;
  for (const row of rows) {
    const line = columns.map((name) => csvCell(row[name])).join(",");
    bytes += Buffer.byteLength(line) + 2;
    if (bytes > AUDIENCE_EXPORT_MAX_BYTES) throw new Error("Audience export exceeds the per-page size limit");
    lines.push(line);
  }
  return lines.join("\r\n") + "\r\n";
}

export function audienceExportFilename(range: string, page: number, format: AudienceExportFormat, now = new Date()) {
  return `certifyd-audience-${range}-page-${page}-${now.toISOString().slice(0, 10)}.${format}`;
}
