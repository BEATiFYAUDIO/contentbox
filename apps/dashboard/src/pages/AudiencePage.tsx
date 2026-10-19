import { useEffect, useState } from "react";
import { api, getApiBase } from "../lib/api";
import { getToken } from "../lib/auth";
import CloudflareAudiencePanel from "./CloudflareAudiencePanel";

type Range = "7d" | "30d" | "90d" | "all";
type Coverage = "unknown" | "partial" | "observed";
type Point = { bucket: string; views: number | null; viewCoverage: Coverage; purchases: number | null; conversionRate: number | null };
type Item = { contentId: string; title: string; status: string; rank: number; views: number; legacyOpens: number; purchases: number | null; conversionRate: number | null; series: Point[] };
type Report = {
  posture: "basic" | "sovereign"; supportsCommerceMetrics: boolean; range: Range;
  totalViews: number; totalLegacyOpens: number; totalPurchases: number | null; undatedPaidPurchases: number | null;
  conversionRate: number | null; viewWindowDays: number; series: Point[]; items: Item[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  metadata: { earliestAvailableBuyPageViewAt: string | null; viewCoverage: "unknown" | "incomplete" | "observed_after_boundary"; granularity: "day" | "month" };
};
const ranges: { value: Range; label: string }[] = [
  { value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" }, { value: "all", label: "All time" }
];
const panel = "rounded-xl border border-neutral-800 bg-neutral-950";
const button = "rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50";
const number = (value: number) => new Intl.NumberFormat().format(value);
const percent = (value: number | null) => value === null ? "—" : `${value.toFixed(2)}%`;
function savedRange(): Range {
  try { const saved = sessionStorage.getItem("certifyd.audience.range"); return ranges.some((r) => r.value === saved) ? saved as Range : "all"; }
  catch { return "all"; }
}
function Metric({ title, value, note }: { title: string; value: string; note: string }) {
  return <div className={`${panel} min-w-0 p-4`}><div className="text-xs uppercase tracking-wide text-neutral-400">{title}</div>
    <div className="mt-2 text-3xl font-semibold text-neutral-100">{value}</div><p className="mt-1 text-xs text-neutral-500">{note}</p></div>;
}
function Trend({ title, points, measure, color }: { title: string; points: Point[]; measure: "views" | "purchases" | "conversionRate"; color: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const values = points.map((p) => p[measure]);
  const max = Math.max(1, ...values.filter((v): v is number => v !== null));
  const current = selected !== null && points[selected] ? points[selected] : points.at(-1);
  const value = current?.[measure] ?? null;
  return <section className={`${panel} min-w-0 p-4`} aria-label={title}>
    <div className="flex items-baseline justify-between gap-2"><h3 className="font-semibold text-neutral-100">{title}</h3><span className="text-xs text-neutral-500">{points[0]?.bucket.length === 7 ? "Monthly" : "Daily"}</span></div>
    {!points.length ? <p className="mt-3 text-sm text-neutral-400">No reporting periods available.</p> : <>
      <div className="mt-3 overflow-x-auto pb-2"><div className="relative flex h-40 w-full items-end gap-1 border-b border-neutral-700 pt-4" style={{ minWidth: `${Math.max(420, points.length * 19)}px` }} role="group" aria-label={`${title} by period`}>
        <span className="pointer-events-none absolute left-0 top-0 text-[10px] text-neutral-500">{measure === "conversionRate" ? percent(max) : number(max)}</span>
        {points.map((p, i) => {
          const v = values[i];
          const unknown = (measure === "views" || measure === "conversionRate") && p.viewCoverage !== "observed";
          const label = `${p.bucket}: ${unknown || v === null ? "unknown" : measure === "conversionRate" ? percent(v) : number(v)}${p.viewCoverage === "partial" ? ", partial view coverage" : ""}`;
          return <button key={p.bucket} type="button" title={label} aria-label={label} onFocus={() => setSelected(i)} onMouseEnter={() => setSelected(i)} onClick={() => setSelected(i)}
            className="group flex h-full min-w-[15px] flex-1 items-end focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400">
            <span className={`block w-full rounded-t-sm group-hover:opacity-75 ${unknown || v === null ? "border border-dashed border-neutral-600 bg-neutral-900" : color}`}
              style={{ height: unknown || v === null ? "26%" : v === 0 ? "2px" : `${Math.max(3, v / max * 88)}%` }} /></button>;
        })}
      </div><div className="flex justify-between pt-1 text-[10px] text-neutral-500"><span>{points[0].bucket}</span><span>{points.at(-1)?.bucket}</span></div></div>
      <p className="mt-1 text-xs text-neutral-300" role="status">{current?.bucket}: {value === null || ((measure === "views" || measure === "conversionRate") && current?.viewCoverage !== "observed") ? "Unknown or incomplete" : measure === "conversionRate" ? percent(value) : number(value)}</p>
      {measure === "views" && <p className="mt-1 text-xs text-neutral-500">Dashed bars: unknown or partial history. Thin lines: recorded zero.</p>}
    </>}
  </section>;
}
export default function AudiencePage() {
  const [range, setRange] = useState<Range>(savedRange);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<"csv" | "json">("csv");
  const [exporting, setExporting] = useState<"page" | "all" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api<Report>(`/audience/summary?range=${range}&page=${page}`)
      .then((result) => { if (active) setReport(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Audience data could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range, page, refresh]);
  const beginLoad = () => { setLoading(true); setError(null); setReport(null); };
  const reload = () => { beginLoad(); setRefresh((v) => v + 1); };
  const selectPage = (next: number) => { beginLoad(); setPage(next); setExpanded(null); };
  const selectRange = (next: Range) => {
    if (next === range) return;
    beginLoad();
    setRange(next); setPage(1); setExpanded(null);
    try { sessionStorage.setItem("certifyd.audience.range", next); } catch { /* Optional persistence. */ }
  };
  const downloadExport = async (scope: "page" | "all") => {
    if (!report || exporting) return;
    setExporting(scope); setExportError(null);
    try {
      const endpoint = scope === "all" ? "export-all" : "export";
      const pageQuery = scope === "page" ? `&page=${page}` : "";
      const response = await fetch(`${getApiBase()}/audience/${endpoint}?range=${range}${pageQuery}&format=${exportFormat}`, {
        headers: { Authorization: `Bearer ${getToken() || ""}` }
      });
      if (!response.ok) throw new Error(`Export failed (${response.status}). Please try again.`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `certifyd-audience-${range}-${scope === "all" ? "all" : `page-${page}`}-${new Date().toISOString().slice(0, 10)}.${exportFormat}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) { setExportError(cause instanceof Error ? cause.message : "Audience export failed."); }
    finally { setExporting(null); }
  };
  const commerce = report?.supportsCommerceMetrics === true && report.posture !== "basic";
  const comparable = report?.metadata.viewCoverage === "observed_after_boundary";
  return <div className="space-y-4 pb-8 text-neutral-100">
    <header className={`${panel} flex flex-wrap items-center justify-between gap-3 p-4`}><div><h2 className="text-2xl font-semibold">Audience</h2><p className="mt-1 text-sm text-neutral-400">Understand how people find and buy your work.</p></div>
      <div className="flex flex-wrap items-center gap-2"><button type="button" className={button} disabled={loading} onClick={reload}>Refresh</button>
        <label className="text-sm text-neutral-300">Format <select className={button} value={exportFormat} disabled={!!exporting} onChange={(event) => setExportFormat(event.target.value as "csv" | "json")}><option value="csv">CSV</option><option value="json">JSON</option></select></label>
        <button type="button" className={button} disabled={!report || loading || !!exporting} onClick={() => void downloadExport("page")}>{exporting === "page" ? "Exporting…" : "Export current page"}</button>
        <button type="button" className={button} disabled={!report || loading || !!exporting} onClick={() => void downloadExport("all")}>{exporting === "all" ? "Preparing full export…" : "Export all Audience data"}</button></div></header>
    <p className="text-xs text-neutral-400">Native reports use the selected date range. Full exports include every owned work, account totals once, and all locally cached Cloudflare aggregate dates. Current-page exports contain native data only. Reports are not restorable Core backups.</p>
    {exportError && <p className="text-sm text-rose-300" role="alert">{exportError}</p>}
    <div className="flex flex-wrap gap-2" role="group" aria-label="Audience date range">{ranges.map((r) => <button key={r.value} type="button" aria-pressed={range === r.value} onClick={() => selectRange(r.value)} className={`${button} ${range === r.value ? "border-sky-500 bg-sky-950 text-sky-100" : ""}`}>{r.label}</button>)}</div>
    {loading && <div className={`${panel} p-6 text-sm text-neutral-400`} role="status">Loading audience data…</div>}
    {error && <div className={`${panel} p-6 text-sm text-rose-300`} role="alert">{error} <button type="button" className={`ml-2 ${button}`} onClick={reload}>Try again</button></div>}
    {report && <>
      <div className={`grid gap-3 ${commerce ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2"}`}>
        <Metric title="Recorded Buy-page views" value={report.metadata.viewCoverage === "unknown" ? "—" : number(report.totalViews)} note={report.metadata.viewCoverage === "unknown" ? "No measured view coverage for this range" : "Recorded within available view history"} />
        {commerce && <Metric title="Completed content purchases" value={number(report.totalPurchases ?? 0)} note={range === "all" ? `Lifetime paid purchases${report.undatedPaidPurchases ? `; ${number(report.undatedPaidPurchases)} have no purchase date` : ""}` : "Paid content purchases in this range"} />}
        {commerce && <Metric title="Indicative view-to-purchase ratio" value={percent(comparable ? report.conversionRate : null)} note={comparable && report.conversionRate !== null ? "Purchases within comparable view history ÷ recorded views; not unique visitors" : "Unavailable for incomplete or incomparable view history"} />}
        {!commerce && <div className={`${panel} p-4 text-sm text-neutral-400`}>Purchase reporting is available in Sovereign mode. Your Buy-page views remain available here.</div>}
      </div>
      <section className={`${panel} p-4 text-sm text-neutral-300`} aria-label="Measurement notes"><p><b>Legacy content opens:</b> {number(report.totalLegacyOpens)}. These used an older definition and are not added to Buy-page views.</p>
        <p className="mt-2">{report.metadata.earliestAvailableBuyPageViewAt ? `First available Buy-page view: ${new Date(report.metadata.earliestAvailableBuyPageViewAt).toLocaleDateString(undefined, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" })}. This does not establish when tracking began.` : "No new Buy-page views have been observed. Earlier view activity is unknown, not zero."}</p>
        <p className="mt-2">Buy-page views are retained for {report.viewWindowDays} days. {report.metadata.viewCoverage === "incomplete" ? "This range includes incomplete view history." : report.metadata.viewCoverage === "unknown" ? "View coverage for this range is unknown." : "Activity after the first available view is shown where observed."}{range === "all" && commerce ? " The purchase total includes all historical paid purchases; the monthly chart shows only the retained view-history window." : ""}</p>
        <p className="mt-2 text-xs text-neutral-400">A signed browser-session cookie helps count a visit to each work's Buy page at most once per 30 minutes. The cookie lasts up to 30 days; new view events are kept up to {report.viewWindowDays} days. Exports contain aggregate counts and work details, not visitor or buyer identifiers.</p></section>
      <div className="grid min-w-0 gap-3 xl:grid-cols-2"><Trend title="Buy-page views over time" points={report.series} measure="views" color="bg-sky-500" />
        {commerce && <Trend title={range === "all" ? "Recent completed purchases over time" : "Completed purchases over time"} points={report.series} measure="purchases" color="bg-emerald-500" />}
        {commerce && <div className="xl:col-span-2"><Trend title="Indicative ratio over time" points={report.series} measure="conversionRate" color="bg-violet-500" /></div>}</div>
      <section className={panel}><div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 p-4"><div><h3 className="text-lg font-semibold">Per content</h3><p className="text-xs text-neutral-500">Ranked by Buy-page views, then purchases. Up to {report.pagination.pageSize} works per page.</p></div><span className="text-xs text-neutral-400">{number(report.pagination.totalItems)} works</span></div>
        {!report.items.length ? <p className="p-6 text-sm text-neutral-400">No owned content to report yet.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm text-neutral-200"><thead className="text-xs uppercase tracking-wide text-neutral-400"><tr><th className="px-4 py-3 font-medium">Rank / content</th><th className="px-4 py-3 font-medium">Buy-page views</th>{commerce && <th className="px-4 py-3 font-medium">Purchases</th>}{commerce && <th className="px-4 py-3 font-medium">Indicative ratio</th>}<th className="px-4 py-3 font-medium">Legacy opens</th><th className="px-4 py-3 font-medium">Trend</th></tr></thead><tbody>
          {report.items.map((item) => <tr key={item.contentId} className="border-t border-neutral-800 align-top"><td className="px-4 py-3"><span className="font-medium">#{item.rank} {item.title}</span><div className="text-xs text-neutral-500">{item.status}</div></td><td className="px-4 py-3">{report.metadata.viewCoverage === "unknown" ? "—" : number(item.views)}</td>{commerce && <td className="px-4 py-3">{number(item.purchases ?? 0)}</td>}{commerce && <td className="px-4 py-3">{percent(comparable ? item.conversionRate : null)}</td>}<td className="px-4 py-3">{number(item.legacyOpens)}</td><td className="px-4 py-3"><button type="button" className={button} aria-expanded={expanded === item.contentId} onClick={() => setExpanded(expanded === item.contentId ? null : item.contentId)}>{expanded === item.contentId ? "Hide" : "View"}</button>{expanded === item.contentId && <div className="mt-3 min-w-[320px] space-y-3"><Trend title={`${item.title} views`} points={item.series} measure="views" color="bg-sky-500" />{commerce && <Trend title={`${item.title} purchases`} points={item.series} measure="purchases" color="bg-emerald-500" />}</div>}</td></tr>)}
        </tbody></table></div>}
        {report.pagination.totalPages > 1 && <div className="flex items-center justify-between gap-3 border-t border-neutral-800 p-4 text-sm"><button type="button" className={button} disabled={page <= 1} onClick={() => selectPage(page - 1)}>Previous</button><span>Page {page} of {report.pagination.totalPages}</span><button type="button" className={button} disabled={page >= report.pagination.totalPages} onClick={() => selectPage(page + 1)}>Next</button></div>}
      </section>
    </>}
    <CloudflareAudiencePanel range={range} refresh={refresh} />
  </div>;
}
