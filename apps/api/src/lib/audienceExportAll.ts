import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { buildAudienceReport } from "./audienceAnalytics.js";
import { assertAudiencePageBounds, audienceCsvParts, audienceExportDocument, cloudflareAudienceCsvLine, type AudienceExportFormat } from "./audienceExport.js";

type Report = Awaited<ReturnType<typeof buildAudienceReport>>;
export const AUDIENCE_ALL_MAX_PAGES = 200;
export const AUDIENCE_ALL_MAX_BYTES = 64 * 1024 * 1024;
export const AUDIENCE_ALL_MAX_CLOUDFLARE_ROWS = 20_000;
const CLOUDFLARE_PAGE_SIZE = 50;

export type CloudflareExportSnapshot = {
  id: string; zoneId: string; hostname: string; source: string; metric: string;
  day: string; rowsJson: string; sampleInterval: number | null; coverage: string;
  fetchedAt: Date;
};
export type CloudflareExportSource = {
  page: (cursor: string | null, asOf: Date) => Promise<CloudflareExportSnapshot[]>;
  fingerprint: (asOf: Date) => Promise<{ count: number; latestUpdatedAt: Date | null }>;
};

const allowedMetrics: Record<string, string> = {
  traffic: "cloudflare_http", buy_page_requests: "cloudflare_http", country: "cloudflare_http",
  device: "cloudflare_http", browser: "cloudflare_http", os: "cloudflare_http",
  referrer: "cloudflare_web_analytics"
};
function safeCloudflareSnapshot(row: CloudflareExportSnapshot) {
  if (!/^[a-f0-9]{32}$/.test(row.zoneId) || row.hostname.length > 253 || !row.hostname.includes(".") ||
      row.hostname.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      allowedMetrics[row.metric] !== row.source || !/^\d{4}-\d{2}-\d{2}$/.test(row.day) ||
      Number.isNaN(Date.parse(`${row.day}T00:00:00Z`)) ||
      new Date(`${row.day}T00:00:00Z`).toISOString().slice(0, 10) !== row.day ||
      !["observed", "partial_day", "truncated", "no_data", "unknown"].includes(row.coverage) ||
      !(row.fetchedAt instanceof Date) || !Number.isFinite(row.fetchedAt.getTime()) ||
      Buffer.byteLength(row.rowsJson) > 128 * 1024 ||
      (row.sampleInterval !== null && (!Number.isFinite(row.sampleInterval) || row.sampleInterval < 1))) {
    throw new AudienceAllExportLimitError("Cached Cloudflare aggregate is invalid");
  }
  let raw: unknown;
  try { raw = JSON.parse(row.rowsJson); } catch { throw new AudienceAllExportLimitError("Cached Cloudflare aggregate is invalid"); }
  if (!Array.isArray(raw) || raw.length > 1000 || raw.some((entry) => !entry || typeof entry !== "object" ||
      typeof entry.label !== "string" || entry.label.length > 120 || typeof entry.count !== "number" ||
      !Number.isFinite(entry.count) || entry.count < 0)) {
    throw new AudienceAllExportLimitError("Cached Cloudflare aggregate is invalid");
  }
  return { zoneId: row.zoneId, hostname: row.hostname, source: row.source, metric: row.metric,
    day: row.day, rows: raw.map((entry) => ({ label: entry.label as string, count: entry.count as number })),
    sampleInterval: row.sampleInterval, coverage: row.coverage, fetchedAt: row.fetchedAt.toISOString() };
}

export class AudienceAllExportLimitError extends Error {}
export class AudienceAllExportChangedError extends Error {}

/** Writes one page at a time; a failed or changing report is never offered as a download. */
export async function buildAudienceAllFile(
  fetchPage: (page: number, asOf: Date) => Promise<Report>,
  format: AudienceExportFormat,
  options: { tempRoot?: string; maxPages?: number; maxBytes?: number; asOf?: Date;
    cloudflare?: CloudflareExportSource; maxCloudflareRows?: number } = {}
) {
  const asOf = options.asOf || new Date();
  const maxPages = options.maxPages ?? AUDIENCE_ALL_MAX_PAGES;
  const maxBytes = options.maxBytes ?? AUDIENCE_ALL_MAX_BYTES;
  const maxCloudflareRows = options.maxCloudflareRows ?? AUDIENCE_ALL_MAX_CLOUDFLARE_ROWS;
  const cloudflareBefore = await options.cloudflare?.fingerprint(asOf);
  if (cloudflareBefore && cloudflareBefore.count > maxCloudflareRows) {
    throw new AudienceAllExportLimitError("Cached Cloudflare history exceeds the safe export row limit");
  }
  const first = await fetchPage(1, asOf);
  assertAudiencePageBounds(first);
  const totalPages = first.pagination.totalPages;
  if (first.pagination.page !== 1 || first.pagination.pageSize !== 50 || totalPages > maxPages ||
      first.pagination.totalItems > maxPages * first.pagination.pageSize) {
    throw new AudienceAllExportLimitError("Audience library exceeds the safe full-export page limit");
  }
  const dir = await fs.mkdtemp(path.join(options.tempRoot || os.tmpdir(), "certifyd-audience-all-"));
  const filePath = path.join(dir, `audience.${format}`);
  let file: fs.FileHandle | undefined;
  let size = 0;
  const write = async (chunk: string) => {
    size += Buffer.byteLength(chunk);
    if (size > maxBytes) throw new AudienceAllExportLimitError("Audience report exceeds the safe full-export size limit");
    await file!.writeFile(chunk);
  };
  const seen = new Set<string>();
  const stable = (report: Report) => {
    if (report.range !== first.range || report.posture !== first.posture ||
        report.pagination.totalItems !== first.pagination.totalItems ||
        report.pagination.totalPages !== totalPages ||
        report.totalViews !== first.totalViews || report.totalLegacyOpens !== first.totalLegacyOpens ||
        report.totalPurchases !== first.totalPurchases ||
        JSON.stringify(report.metadata) !== JSON.stringify(first.metadata) ||
        JSON.stringify(report.series) !== JSON.stringify(first.series)) {
      throw new AudienceAllExportChangedError("Audience data changed during export; please retry");
    }
    for (const item of report.items) {
      if (seen.has(item.contentId)) throw new AudienceAllExportChangedError("Audience work order changed during export; please retry");
      seen.add(item.contentId);
    }
  };
  try {
    file = await fs.open(filePath, "wx", 0o600);
    if (format === "json") {
      const { content: _content, ...header } = audienceExportDocument(first, asOf);
      const fullHeader = { ...header, schemaVersion: 3, kind: "certifyd_audience_full_export",
        scope: "All owned works and available native Audience history, plus all available cached Cloudflare aggregates; not a restorable Core backup.",
        page: null, pagination: { totalItems: first.pagination.totalItems } };
      await write(`${JSON.stringify(fullHeader).slice(0, -1)},"content":[`);
    } else {
      const parts = audienceCsvParts(first, asOf, true);
      await write(parts.header);
      await write(parts.account.join(""));
    }
    let written = 0;
    for (let page = 1; page <= totalPages; page++) {
      // Yield between bounded report queries to keep the API responsive.
      if (page > 1) await new Promise<void>((resolve) => setImmediate(resolve));
      const report = page === 1 ? first : await fetchPage(page, asOf);
      if (report.pagination.page !== page || report.items.length > 50) {
        throw new AudienceAllExportChangedError("Audience pagination changed during export; please retry");
      }
      assertAudiencePageBounds(report);
      stable(report);
      if (format === "json") {
        const items = audienceExportDocument(report, asOf).content;
        for (const item of items) {
          await write(`${written ? "," : ""}${JSON.stringify(item)}`);
          written++;
        }
      } else {
        const items = audienceCsvParts(report, asOf, true).content;
        await write(items.join(""));
        written += report.items.length;
      }
    }
    if (written !== first.pagination.totalItems || seen.size !== written) {
      throw new AudienceAllExportChangedError("Audience work count changed during export; please retry");
    }
    if (format === "json") await write(`],"cloudflare":{"definition":"Creator-owned cached Cloudflare aggregates, separate from native views and conversion. All available cached dates are included regardless of the selected native range.","aggregates":[`);
    let cloudflareWritten = 0;
    let cloudflareRead = 0;
    let cursor: string | null = null;
    const cloudflareSeen = new Set<string>();
    if (options.cloudflare) {
      while (true) {
        const rows = await options.cloudflare.page(cursor, asOf);
        if (rows.length > CLOUDFLARE_PAGE_SIZE) throw new AudienceAllExportLimitError("Cached Cloudflare export page exceeds its safe limit");
        if (!rows.length) break;
        cloudflareRead += rows.length;
        if (cloudflareRead > maxCloudflareRows) throw new AudienceAllExportLimitError("Cached Cloudflare history exceeds the safe export row limit");
        const nextCursor = rows.at(-1)!.id;
        if (nextCursor === cursor || !nextCursor) throw new AudienceAllExportChangedError("Cached Cloudflare pagination changed during export; please retry");
        cursor = nextCursor;
        for (const stored of rows) {
          const snapshot = safeCloudflareSnapshot(stored);
          const key = `${snapshot.zoneId}:${snapshot.hostname}:${snapshot.source}:${snapshot.metric}:${snapshot.day}`;
          if (cloudflareSeen.has(key)) continue;
          cloudflareSeen.add(key);
          if (format === "json") {
            await write(`${cloudflareWritten ? "," : ""}${JSON.stringify(snapshot)}`);
          } else {
            for (const value of snapshot.rows.length ? snapshot.rows : [{ label: null, count: null }]) {
              await write(cloudflareAudienceCsvLine({ ...snapshot, label: value.label,
                count: value.count }, asOf));
            }
          }
          cloudflareWritten++;
        }
        if (rows.length < CLOUDFLARE_PAGE_SIZE) break;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const cloudflareAfter = await options.cloudflare.fingerprint(asOf);
      if (cloudflareAfter.count !== cloudflareBefore?.count ||
          cloudflareAfter.latestUpdatedAt?.getTime() !== cloudflareBefore.latestUpdatedAt?.getTime()) {
        throw new AudienceAllExportChangedError("Cached Cloudflare history changed during export; please retry");
      }
    }
    if (format === "json") await write("]}}");
    await file.close();
    return { filePath, size, workCount: written, pageCount: totalPages, cloudflareCount: cloudflareWritten,
      cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
  } catch (err) {
    await file?.close();
    await fs.rm(dir, { recursive: true, force: true });
    throw err;
  }
}
