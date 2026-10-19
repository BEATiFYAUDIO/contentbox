/** Optional, aggregate-only Cloudflare reporting. Never requests visitor records. */
export const CLOUDFLARE_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_GROUPS = 1000;
const DAY_MS = 86_400_000;

export type CloudflareAudienceScope = { zoneId: string; accountId?: string | null; hostname: string };
export type CloudflareAudienceSnapshot = {
  source: "cloudflare_http" | "cloudflare_web_analytics";
  metric: "traffic" | "buy_page_requests" | "country" | "device" | "browser" | "os" | "referrer";
  day: string;
  rows: { label: string; count: number }[];
  sampleInterval: number | null;
  coverage: "observed" | "partial_day" | "truncated" | "no_data" | "unknown";
};

export class CloudflareAudienceError extends Error {
  constructor(public readonly code: "unauthorized" | "rate_limited" | "unavailable" | "invalid_response") {
    super(code);
  }
}

export function normalizeCloudflareAudienceScope(value: unknown): CloudflareAudienceScope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const zoneId = typeof input.zoneId === "string" ? input.zoneId.trim().toLowerCase() : "";
  const accountId = typeof input.accountId === "string" ? input.accountId.trim().toLowerCase() : "";
  const hostname = typeof input.hostname === "string" ? input.hostname.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{32}$/.test(zoneId) || (accountId && !/^[a-f0-9]{32}$/.test(accountId)) ||
      hostname.length > 253 || !hostname.includes(".") ||
      hostname.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  return { zoneId, accountId: accountId || null, hostname };
}

async function boundedJson(response: Response): Promise<any> {
  if (!response.body) throw new CloudflareAudienceError("invalid_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new CloudflareAudienceError("invalid_response");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    await reader.cancel().catch(() => {});
    throw new CloudflareAudienceError("invalid_response");
  } finally {
    reader.releaseLock();
  }
}

async function graphql(token: string, query: string, variables: Record<string, unknown>, fetcher: typeof fetch): Promise<any> {
  let response: Response;
  try {
    response = await fetcher(CLOUDFLARE_GRAPHQL_URL, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(12_000)
    });
  } catch { throw new CloudflareAudienceError("unavailable"); }
  if (response.status === 401 || response.status === 403) throw new CloudflareAudienceError("unauthorized");
  if (response.status === 429) throw new CloudflareAudienceError("rate_limited");
  if (!response.ok) throw new CloudflareAudienceError("unavailable");
  const result = await boundedJson(response);
  if (Array.isArray(result?.errors) && result.errors.length) {
    const codes = result.errors.map((entry: any) => String(entry?.extensions?.code || "").toLowerCase());
    if (codes.includes("budget")) throw new CloudflareAudienceError("rate_limited");
    const text = result.errors.map((entry: any) => String(entry?.message || "")).join(" ").toLowerCase();
    throw new CloudflareAudienceError(text.includes("permission") || text.includes("unauthorized") ? "unauthorized" : "unavailable");
  }
  return result?.data;
}

export async function verifyCloudflareAudienceAccess(
  token: string, scope: CloudflareAudienceScope, fetcher: typeof fetch = fetch
) {
  const zone = await graphql(token,
    `query($zoneTag: string) { viewer { zones(filter: { zoneTag: $zoneTag }) { settings { httpRequestsAdaptiveGroups { enabled notOlderThan maxDuration } } } } }`,
    { zoneTag: scope.zoneId }, fetcher);
  const http = zone?.viewer?.zones?.[0]?.settings?.httpRequestsAdaptiveGroups;
  if (http?.enabled !== true) throw new CloudflareAudienceError("unauthorized");
  let webAnalytics = false;
  if (scope.accountId) {
    try {
      const account = await graphql(token,
        `query($accountTag: string) { viewer { accounts(filter: { accountTag: $accountTag }) { settings { rumPageloadEventsAdaptiveGroups { enabled notOlderThan maxDuration } } } } }`,
        { accountTag: scope.accountId }, fetcher);
      webAnalytics = account?.viewer?.accounts?.[0]?.settings?.rumPageloadEventsAdaptiveGroups?.enabled === true;
    } catch (error) {
      if (!(error instanceof CloudflareAudienceError)) throw error;
    }
  }
  return { http: true, webAnalytics, httpRetentionDays: Math.floor(Number(http.notOlderThan || 0) / 86400),
    httpMaxQueryDays: Math.floor(Number(http.maxDuration || 0) / 86400) };
}

type Metric = { source: CloudflareAudienceSnapshot["source"]; metric: CloudflareAudienceSnapshot["metric"];
  dimension: string | null; days: number; scope: "zones" | "accounts"; filterHost: string };
const METRICS: Metric[] = [
  { source: "cloudflare_http", metric: "traffic", dimension: null, days: 29, scope: "zones", filterHost: "clientRequestHTTPHost" },
  { source: "cloudflare_http", metric: "buy_page_requests", dimension: null, days: 29, scope: "zones", filterHost: "clientRequestHTTPHost" },
  { source: "cloudflare_http", metric: "country", dimension: "clientCountryName", days: 29, scope: "zones", filterHost: "clientRequestHTTPHost" },
  { source: "cloudflare_http", metric: "device", dimension: "clientDeviceType", days: 29, scope: "zones", filterHost: "clientRequestHTTPHost" },
  { source: "cloudflare_http", metric: "browser", dimension: "userAgentBrowser", days: 29, scope: "zones", filterHost: "clientRequestHTTPHost" },
  { source: "cloudflare_http", metric: "os", dimension: "userAgentOS", days: 29, scope: "zones", filterHost: "clientRequestHTTPHost" },
  { source: "cloudflare_web_analytics", metric: "referrer", dimension: "refererHost", days: 89, scope: "accounts", filterHost: "requestHost" }
];

function dateRange(now: Date, days: number) {
  const utcToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { start: new Date(utcToday - days * DAY_MS).toISOString(), end: now.toISOString(), today: new Date(utcToday).toISOString().slice(0, 10) };
}

export async function fetchCloudflareAudienceAggregates(
  token: string, scope: CloudflareAudienceScope, options: { now?: Date; fetcher?: typeof fetch; webAnalytics?: boolean } = {}
): Promise<CloudflareAudienceSnapshot[]> {
  const now = options.now || new Date();
  const fetcher = options.fetcher || fetch;
  const snapshots: CloudflareAudienceSnapshot[] = [];
  for (const metric of METRICS) {
    if (metric.scope === "accounts" && (!scope.accountId || !options.webAnalytics)) continue;
    const { start, end, today } = dateRange(now, metric.days);
    const group = metric.scope === "zones" ? "zones" : "accounts";
    const tag = metric.scope === "zones" ? "zoneTag" : "accountTag";
    const field = metric.scope === "zones" ? "httpRequestsAdaptiveGroups" : "rumPageloadEventsAdaptiveGroups";
    const dimension = metric.dimension ? ` ${metric.dimension}` : "";
    const filter = [`datetime_geq: ${JSON.stringify(start)}`, `datetime_lt: ${JSON.stringify(end)}`,
      `${metric.filterHost}: ${JSON.stringify(scope.hostname)}`,
      ...(metric.scope === "zones" ? ['requestSource: "eyeball"'] : []),
      ...(metric.metric === "buy_page_requests" ? ['clientRequestPath_like: "/buy/%"'] : [])].join(", ");
    const query = `query { viewer { ${group}(filter: { ${tag}: ${JSON.stringify(metric.scope === "zones" ? scope.zoneId : scope.accountId)} }) { rows: ${field}(filter: { ${filter} }, limit: ${MAX_GROUPS}, orderBy: [date_ASC]) { count avg { sampleInterval } dimensions { date${dimension} } } } } }`;
    let groups: any;
    try {
      const data = await graphql(token, query, {}, fetcher);
      groups = data?.viewer?.[group]?.[0]?.rows;
    } catch (error) {
      if (metric.scope !== "accounts" || !(error instanceof CloudflareAudienceError)) throw error;
      // Web Analytics is optional; retain the last cached referrers on a failed query.
      continue;
    }
    if (!Array.isArray(groups) || groups.length > MAX_GROUPS) throw new CloudflareAudienceError("invalid_response");
    const truncated = groups.length === MAX_GROUPS;
    const byDay = new Map<string, { label: string; count: number; sample: number }[]>();
    for (const row of groups) {
      const day = String(row?.dimensions?.date || "");
      const label = metric.dimension ? String(row?.dimensions?.[metric.dimension] ?? "Unknown").slice(0, 120) : "all";
      const count = Number(row?.count);
      const sample = Number(row?.avg?.sampleInterval || 1);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < start.slice(0, 10) || day > today ||
          !Number.isFinite(count) || count < 0 || !Number.isFinite(sample) || sample < 1) {
        throw new CloudflareAudienceError("invalid_response");
      }
      const current = byDay.get(day) || [];
      current.push({ label, count, sample });
      byDay.set(day, current);
    }
    for (let offset = 0; offset <= metric.days; offset++) {
      const day = new Date(Date.parse(start.slice(0, 10) + "T00:00:00Z") + offset * DAY_MS).toISOString().slice(0, 10);
      const rows = byDay.get(day) || [];
      snapshots.push({ source: metric.source, metric: metric.metric, day,
        rows: rows.map(({ label, count }) => ({ label, count })),
        sampleInterval: rows.length ? Math.max(...rows.map((row) => row.sample)) : null,
        coverage: truncated ? "truncated" : !rows.length && metric.scope === "accounts" ? "unknown" :
          !rows.length ? "no_data" : day === today ? "partial_day" : "observed" });
    }
  }
  return snapshots;
}
