import { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  cloudflareBreakdown, cloudflareDailyTraffic, cloudflareMetricSummary, selectCloudflareMetric,
  type CloudflareCache, type CloudflareMetric, type CloudflareRange, type CloudflareSnapshot
} from "./cloudflareAudienceReport";

const panel = "min-w-0 rounded-xl border border-neutral-800 bg-neutral-950 p-4";
const format = (value: number) => new Intl.NumberFormat().format(value);
const expectedDays = (range: CloudflareRange) => range === "all" ? null : Number(range.slice(0, -1));

function CoverageNote({ metric, rows, range, cache }: {
  metric: CloudflareMetric; rows: CloudflareSnapshot[]; range: CloudflareRange; cache: CloudflareCache
}) {
  const summary = cloudflareMetricSummary(rows, cache.truncated);
  const source = metric === "referrer" ? "Cloudflare Web Analytics" : "Cloudflare HTTP traffic";
  if (!rows.length) return <p className="mt-2 text-xs text-neutral-500">Source: {source}. No cached data for this date range.</p>;
  const freshness = summary.latestFetch ? new Date(summary.latestFetch).toLocaleString() : "Unknown";
  const missing = expectedDays(range) !== null && summary.cachedDays < expectedDays(range)!;
  return <div className="mt-2 space-y-1 text-xs text-neutral-400">
    <p>Source: {source} · {summary.firstDay} to {summary.lastDay} · {summary.daysWithData} days with reported data · Cached {freshness}</p>
    <p>{summary.maxSampleInterval > 1 ? `Cloudflare sampling interval up to ${format(summary.maxSampleInterval)}. ` : "Cloudflare sampling may apply. "}
      {summary.truncated ? "The cached result is truncated. " : ""}
      {missing || summary.incomplete ? "Coverage is incomplete; missing activity is unknown. " : ""}
      {summary.partialToday ? "Today is still in progress." : ""}</p>
  </div>;
}

function RankedRows({ rows, empty }: { rows: ReturnType<typeof cloudflareBreakdown>; empty: string }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  if (!rows.length) return <p className="mt-4 text-sm text-neutral-400">{empty}</p>;
  return <ol className="mt-4 space-y-3">{rows.map((row) => <li key={row.label}>
    <div className="flex items-baseline justify-between gap-3 text-sm"><span className="min-w-0 break-all text-neutral-200">{row.label}</span><span className="shrink-0 tabular-nums text-neutral-300">{format(row.count)}</span></div>
    <div className="mt-1 h-1.5 rounded-full bg-neutral-800"><div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(2, row.count / max * 100)}%` }} /></div>
  </li>)}</ol>;
}

function TrafficTrend({ rows, range }: { rows: CloudflareSnapshot[]; range: CloudflareRange }) {
  const [selected, setSelected] = useState<number | null>(null);
  const days = cloudflareDailyTraffic(rows, range);
  const max = Math.max(1, ...days.map((day) => day.count || 0));
  const current = selected !== null && days[selected] ? days[selected] : days.at(-1);
  return <div className="mt-4 overflow-x-auto pb-2" role="group" aria-label="Cloudflare HTTP requests by UTC day">
    <div className="flex h-36 min-w-[360px] items-end gap-1 border-b border-neutral-700" style={{ width: `${Math.max(360, days.length * 18)}px` }}>
      {days.map((day, index) => <button key={day.day} type="button" className="flex h-full min-w-[8px] flex-1 items-end focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
        aria-label={`${day.day}: ${day.count === null ? "unknown" : format(day.count)} reported HTTP requests${day.coverage === "partial_day" ? " (partial day)" : ""}`}
        onFocus={() => setSelected(index)} onMouseEnter={() => setSelected(index)} onClick={() => setSelected(index)}>
        <div className={`w-full rounded-t-sm ${day.count === null ? "h-1/4 border border-dashed border-neutral-600 bg-neutral-900" : "bg-sky-500"}`}
          style={day.count === null ? undefined : { height: day.count === 0 ? "2px" : `${Math.max(3, day.count / max * 94)}%` }} />
      </button>)}
    </div>
    <div className="flex justify-between pt-1 text-[10px] text-neutral-500"><span>{days[0]?.day}</span><span>{days.at(-1)?.day}</span></div>
    <p className="mt-1 text-xs text-neutral-300" role="status">{current?.day}: {current?.count === null || current?.count === undefined ? "Unknown" : format(current.count)} reported HTTP requests</p>
    <p className="mt-2 text-xs text-neutral-500">Dashed bars indicate unknown or unavailable days; a thin line indicates a reported zero. {range === "all" ? "Chart shows at most the latest 90 days." : ""}</p>
  </div>;
}

export default function CloudflareAudiencePanel({ range, refresh }: { range: CloudflareRange; refresh: number }) {
  const [loaded, setLoaded] = useState<{ refresh: number; cache: CloudflareCache | null; error: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    void api<CloudflareCache>("/api/audience/cloudflare/cache", "GET")
      .then((result) => { if (active) setLoaded({ refresh, cache: result, error: null }); })
      .catch(() => { if (active) setLoaded({ refresh, cache: null, error: "Cloudflare analytics could not be loaded. Native Audience remains available." }); });
    return () => { active = false; };
  }, [refresh]);

  const loading = loaded?.refresh !== refresh;
  const cache = loading ? null : loaded?.cache || null;
  const error = loading ? null : loaded?.error || null;

  const metric = (name: CloudflareMetric) => cache ? selectCloudflareMetric(cache, name, range) : [];
  const traffic = metric("traffic");
  const buy = metric("buy_page_requests");
  const countries = metric("country");
  const devices = metric("device");
  const browsers = metric("browser");
  const systems = metric("os");
  const referrers = metric("referrer");

  return <section className="space-y-3" aria-label="Cloudflare traffic and geography">
    <header className={panel}><h3 className="text-lg font-semibold text-neutral-100">Traffic &amp; Geography</h3>
      <p className="mt-1 text-sm text-neutral-400">Optional Cloudflare reports for {cache?.hostname || "your creator site"}. HTTP requests are not Core Buy-page views and are never used in conversion calculations.</p>
    </header>
    {loading && <div className={`${panel} text-sm text-neutral-400`} role="status">Loading cached Cloudflare analytics…</div>}
    {error && <div className={`${panel} text-sm text-amber-300`} role="alert">{error}</div>}
    {!loading && !error && !cache?.configured && <div className={`${panel} text-sm text-neutral-400`}>Cloudflare analytics is optional. Connect an Analytics Read token in CONFIG to add traffic and geography here.</div>}
    {!loading && !error && cache?.configured && <>
      {!cache.snapshots.length && <div className={`${panel} text-sm text-neutral-400`}>No Cloudflare aggregates are cached yet. Use Refresh aggregates in CONFIG to collect the available reporting window.</div>}
      {cache.truncated && <p className="text-sm text-amber-300" role="status">The cached response reached its size limit. These sections show only the returned days.</p>}
      <div className="grid gap-3 xl:grid-cols-2">
        <section className={panel} aria-label="Geography"><h4 className="font-semibold text-neutral-100">Geography</h4><p className="mt-1 text-sm text-neutral-400">Countries by reported HTTP requests</p>
          <RankedRows rows={cloudflareBreakdown(countries)} empty="No country data is cached for this range." />
          <CoverageNote metric="country" rows={countries} range={range} cache={cache} />
        </section>
        <section className={panel} aria-label="Traffic"><h4 className="font-semibold text-neutral-100">Traffic</h4>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm"><p>Reported HTTP requests: <strong>{traffic.length && cloudflareMetricSummary(traffic).daysWithData ? format(cloudflareMetricSummary(traffic).total) : "—"}</strong></p>
            <p>Buy-page HTTP requests: <strong>{buy.length && cloudflareMetricSummary(buy).daysWithData ? format(cloudflareMetricSummary(buy).total) : "—"}</strong></p></div>
          <TrafficTrend rows={traffic} range={range} />
          <CoverageNote metric="traffic" rows={traffic} range={range} cache={cache} />
          <CoverageNote metric="buy_page_requests" rows={buy} range={range} cache={cache} />
        </section>
      </div>
      <section className={panel} aria-label="Audience technology"><h4 className="font-semibold text-neutral-100">Audience technology</h4>
        <div className="grid gap-5 md:grid-cols-3">{([
          ["Device categories", "device", devices], ["Browsers", "browser", browsers], ["Operating systems", "os", systems]
        ] as const).map(([title, name, rows]) => <div key={name} className="min-w-0"><h5 className="mt-3 text-sm font-medium text-neutral-200">{title}</h5>
          <RankedRows rows={cloudflareBreakdown(rows, 6)} empty="No cached breakdown for this range." />
          <CoverageNote metric={name} rows={rows} range={range} cache={cache} /></div>)}</div>
      </section>
      <section className={panel} aria-label="Discovery"><h4 className="font-semibold text-neutral-100">Discovery</h4><p className="mt-1 text-sm text-neutral-400">Referring websites reported by Cloudflare Web Analytics</p>
        <RankedRows rows={cloudflareBreakdown(referrers)} empty="No Web Analytics referrer data is cached for this range. An account ID and Web Analytics access are required." />
        <CoverageNote metric="referrer" rows={referrers} range={range} cache={cache} />
      </section>
    </>}
  </section>;
}
