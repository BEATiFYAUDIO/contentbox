import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { buildAudienceReport } from "./audienceAnalytics.js";
import { assertAudiencePageBounds, audienceCsvParts, audienceExportDocument, type AudienceExportFormat } from "./audienceExport.js";

type Report = Awaited<ReturnType<typeof buildAudienceReport>>;
export const AUDIENCE_ALL_MAX_PAGES = 200;
export const AUDIENCE_ALL_MAX_BYTES = 64 * 1024 * 1024;

export class AudienceAllExportLimitError extends Error {}
export class AudienceAllExportChangedError extends Error {}

/** Writes one page at a time; a failed or changing report is never offered as a download. */
export async function buildAudienceAllFile(
  fetchPage: (page: number, asOf: Date) => Promise<Report>,
  format: AudienceExportFormat,
  options: { tempRoot?: string; maxPages?: number; maxBytes?: number; asOf?: Date } = {}
) {
  const asOf = options.asOf || new Date();
  const maxPages = options.maxPages ?? AUDIENCE_ALL_MAX_PAGES;
  const maxBytes = options.maxBytes ?? AUDIENCE_ALL_MAX_BYTES;
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
      const fullHeader = { ...header, schemaVersion: 2, kind: "certifyd_audience_full_export",
        scope: "All owned works and available Audience history; not a restorable Core backup.",
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
    if (format === "json") await write("]}");
    await file.close();
    return { filePath, size, workCount: written, pageCount: totalPages,
      cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
  } catch (err) {
    await file?.close();
    await fs.rm(dir, { recursive: true, force: true });
    throw err;
  }
}
