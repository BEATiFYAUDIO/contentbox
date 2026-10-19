export type CloudflareRange = "7d" | "30d" | "90d" | "all";
export type CloudflareSource = "cloudflare_http" | "cloudflare_web_analytics";
export type CloudflareMetric = "traffic" | "buy_page_requests" | "country" | "device" | "browser" | "os" | "referrer";
export type CloudflareSnapshot = {
  source: CloudflareSource;
  metric: CloudflareMetric;
  day: string;
  rows: { label: string; count: number }[];
  sampleInterval: number | null;
  coverage: "observed" | "partial_day" | "truncated" | "no_data" | "unknown";
  fetchedAt: string;
};
export type CloudflareCache = {
  configured: boolean;
  hostname?: string;
  lastSyncAt?: string | null;
  truncated?: boolean;
  snapshots: CloudflareSnapshot[];
};

const DAY_MS = 86_400_000;
const metricSource: Record<CloudflareMetric, CloudflareSource> = {
  traffic: "cloudflare_http", buy_page_requests: "cloudflare_http", country: "cloudflare_http",
  device: "cloudflare_http", browser: "cloudflare_http", os: "cloudflare_http",
  referrer: "cloudflare_web_analytics"
};
const rangeDays: Record<Exclude<CloudflareRange, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
const utcToday = (now: Date) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

/** Select only the requested Cloudflare measurement. Never mixes sources or native Audience events. */
export function selectCloudflareMetric(cache: CloudflareCache, metric: CloudflareMetric, range: CloudflareRange, now = new Date()) {
  const today = utcToday(now);
  const first = range === "all" ? -Infinity : today - (rangeDays[range] - 1) * DAY_MS;
  const latest = new Map<string, CloudflareSnapshot>();
  for (const row of cache.snapshots || []) {
    if (row.metric !== metric || row.source !== metricSource[metric] || !validDay(row.day)) continue;
    const time = Date.parse(`${row.day}T00:00:00Z`);
    if (time < first || time > today || !Number.isFinite(Date.parse(row.fetchedAt))) continue;
    const previous = latest.get(row.day);
    if (!previous || Date.parse(row.fetchedAt) > Date.parse(previous.fetchedAt)) latest.set(row.day, row);
  }
  return [...latest.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function cloudflareMetricSummary(rows: CloudflareSnapshot[], cacheTruncated = false) {
  const withData = rows.filter((row) => row.coverage !== "no_data" && row.coverage !== "unknown" && row.rows.length > 0);
  const total = withData.reduce((sum, row) => sum + row.rows.reduce((day, item) => day +
    (Number.isFinite(item.count) && item.count >= 0 ? item.count : 0), 0), 0);
  const maxSampleInterval = Math.max(1, ...withData.map((row) => row.sampleInterval || 1));
  const latestFetch = rows.reduce<string | null>((latest, row) => !latest || row.fetchedAt > latest ? row.fetchedAt : latest, null);
  return {
    total, daysWithData: withData.length, cachedDays: rows.length,
    firstDay: rows[0]?.day || null, lastDay: rows.at(-1)?.day || null, latestFetch,
    maxSampleInterval,
    incomplete: cacheTruncated || rows.some((row) => row.coverage === "truncated" || row.coverage === "unknown" || row.coverage === "no_data"),
    partialToday: rows.some((row) => row.coverage === "partial_day"),
    truncated: cacheTruncated || rows.some((row) => row.coverage === "truncated")
  };
}

export function cloudflareBreakdown(rows: CloudflareSnapshot[], limit = 8) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.coverage === "unknown" || row.coverage === "no_data") continue;
    for (const item of row.rows) {
      if (!Number.isFinite(item.count) || item.count < 0) continue;
      const label = item.label.trim() || "Unknown";
      totals.set(label, (totals.get(label) || 0) + item.count);
    }
  }
  return [...totals].map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit);
}

export function cloudflareDailyTraffic(rows: CloudflareSnapshot[], range: CloudflareRange, now = new Date()) {
  const today = range === "all" && rows.length ? Date.parse(`${rows.at(-1)!.day}T00:00:00Z`) : utcToday(now);
  const firstAvailable = rows.length ? Date.parse(`${rows[0].day}T00:00:00Z`) : today;
  const days = range === "all" ? Math.min(90, Math.max(1, Math.floor((today - firstAvailable) / DAY_MS) + 1)) : rangeDays[range];
  const indexed = new Map(rows.map((row) => [row.day, row]));
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(today - (days - index - 1) * DAY_MS).toISOString().slice(0, 10);
    const row = indexed.get(day);
    const count = row && row.coverage !== "unknown" && row.coverage !== "no_data" && row.rows.length ?
      row.rows.reduce((sum, item) => sum + (Number.isFinite(item.count) && item.count >= 0 ? item.count : 0), 0) : null;
    return { day, count, coverage: row?.coverage || "unknown" };
  });
}
