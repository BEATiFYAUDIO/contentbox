import React from "react";
import { DEFAULT_HEALTH_PATH, buildHostCandidates, probeHealth, shouldProxyHealthProbe } from "../lib/p2pHostDiagnostics";

function guessApiBase() {
  const raw = ((import.meta as any).env?.VITE_API_URL || window.location.origin) as string;
  return raw.replace(/\/$/, "");
}

function isLocalApiBase(base: string): boolean {
  try {
    const h = new URL(base).hostname.toLowerCase();
    if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
    if (h.startsWith("10.") || h.startsWith("192.168.")) return true;
    const m = h.match(/^172\.(\d+)\./);
    if (m) {
      const n = Number(m[1]);
      return n >= 16 && n <= 31;
    }
    return false;
  } catch {
    return false;
  }
}

function isLikelyUrl(s: string) {
  return /^https?:\/\//i.test(s.trim());
}

function extractReceiptToken(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (v.length >= 16 && !v.includes("/") && !v.includes(" ")) return v;
  const m = v.match(/\/public\/receipts\/([^/?#]+)/i);
  if (m) return m[1];
  return null;
}

function extractBuyUrl(input: string): string | null {
  const v = input.trim();
  if (!isLikelyUrl(v)) return null;
  return v;
}

function copyText(value: string) {
  if (!value) return;
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(value).catch(() => {
      // ignore
    });
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

type BuyLinkV1 = {
  manifestHash: string;
  primaryFileId: string;
  sellerPeerId: string;
  host?: string | null;
  port?: string | null;
  token?: string | null;
};

type Endpoint = {
  host: string;
  port: string;
  scheme: "http" | "https";
};

type ResolverMethod =
  | "linkHost"
  | "linkFallback"
  | "sharedFallback"
  | "cache"
  | "mdns"
  | "manual";

type ConnectionState =
  | "IDLE"
  | "RESOLVING"
  | "CONNECTING"
  | "READY"
  | "RECONNECTING"
  | "OFFLINE";

function parseBuyLinkV1(input: string): BuyLinkV1 | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const params = url.searchParams;
    const manifestHash = params.get("manifestHash") || "";
    const primaryFileId = params.get("primaryFileId") || "";
    const sellerPeerId = params.get("sellerPeerId") || "";
    if (!manifestHash || !primaryFileId || !sellerPeerId) return null;
    return {
      manifestHash,
      primaryFileId,
      sellerPeerId,
      host: params.get("host"),
      port: params.get("port"),
      token: params.get("token") || params.get("t")
    };
  } catch {
    return null;
  }
}

function classifyLinkType(link: BuyLinkV1 | null): "Tunnel" | "Direct" | "LAN" | "—" {
  if (!link) return "—";
  if (link.host) {
    const host = String(link.host || "").toLowerCase();
    if (host.includes("trycloudflare.com") || host.endsWith(".ts.net")) return "Tunnel";
    return "Direct";
  }
  return "LAN";
}

type PeerCacheEntry = {
  lastOkHost: string;
  lastOkPort: number;
  lastOkAt: number;
  lastErrorAt?: number;
  lastErrorReason?: string;
  fingerprint?: string;
  scheme?: "http" | "https";
  sourceMethod?: ResolverMethod;
  expiresAt?: number;
};

const PEER_CACHE_KEY = "contentbox:peerHostMap";
const PER_SELLER_PREFIX = "contentbox.peerCache.";

function loadPeerCache(): Record<string, PeerCacheEntry> {
  try {
    const raw = localStorage.getItem(PEER_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePeerCache(map: Record<string, PeerCacheEntry>) {
  try {
    localStorage.setItem(PEER_CACHE_KEY, JSON.stringify(map));
  } catch {}
}

function loadPeerCacheEntry(sellerPeerId: string): PeerCacheEntry | null {
  try {
    const raw = localStorage.getItem(`${PER_SELLER_PREFIX}${sellerPeerId}`);
    if (raw) {
      const entry = JSON.parse(raw) as PeerCacheEntry;
      if (entry?.expiresAt && Date.now() > entry.expiresAt) return null;
      return entry;
    }
  } catch {}
  const cache = loadPeerCache();
  const entry = cache[sellerPeerId];
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) return null;
  return entry;
}

function writePeerCacheEntry(sellerPeerId: string, entry: PeerCacheEntry) {
  const cache = loadPeerCache();
  cache[sellerPeerId] = entry;
  savePeerCache(cache);
  try {
    localStorage.setItem(`${PER_SELLER_PREFIX}${sellerPeerId}`, JSON.stringify(entry));
  } catch {}
}

function invalidatePeerCacheEntry(sellerPeerId: string) {
  const cache = loadPeerCache();
  if (cache[sellerPeerId]) {
    delete cache[sellerPeerId];
    savePeerCache(cache);
  }
  try {
    localStorage.removeItem(`${PER_SELLER_PREFIX}${sellerPeerId}`);
  } catch {}
}

function normalizeEndpoint(hostInput?: string | null, portInput?: string | null): Endpoint | null {
  const host = String(hostInput || "").trim();
  if (!host) return null;
  let scheme: "http" | "https" = "http";
  let hostname = host;
  let port = String(portInput || "").trim();
  try {
    if (/^https?:\/\//i.test(host)) {
      const url = new URL(host);
      scheme = url.protocol === "https:" ? "https" : "http";
      hostname = url.hostname;
      port = port || url.port || (scheme === "https" ? "443" : "80");
    }
  } catch {}
  if (!port) {
    port = scheme === "https" ? "443" : "80";
  }
  return { host: hostname, port, scheme };
}

function getSharedFallbackHost(): string | null {
  try {
    const raw = localStorage.getItem("contentbox:sharedFallbackHost");
    const trimmed = String(raw || "").trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function endpointBaseUrl(endpoint: Endpoint): string {
  const portPart = endpoint.port ? `:${endpoint.port}` : "";
  return `${endpoint.scheme}://${endpoint.host}${portPart}`;
}

async function probeHealthMaybeProxy(apiBase: string, origin: string) {
  const isHttps = origin.trim().toLowerCase().startsWith("https://");
  if (isHttps && (shouldProxyHealthProbe() || isLocalApiBase(apiBase))) {
    const url = `${apiBase.replace(/\/$/, "")}/public/diag/probe-health?url=${encodeURIComponent(
      `${origin.replace(/\/$/, "")}${DEFAULT_HEALTH_PATH}`
    )}`;
    try {
      const res = await fetch(url, { method: "GET", headers: { "x-contentbox-dev-probe": "1" } });
      const json = await res.json();
      return {
        ok: Boolean(json?.ok),
        url: origin,
        status: typeof json?.status === "number" ? json.status : undefined,
        latencyMs: typeof json?.latencyMs === "number" ? json.latencyMs : undefined,
        errorType: json?.errorType || (json?.ok ? undefined : "FETCH_FAILED"),
        errorMessage: json?.message
      };
    } catch (e: any) {
      return { ok: false, url: origin, errorType: "FETCH_FAILED", errorMessage: e?.message || String(e) };
    }
  }
  return probeHealth({ origin, path: DEFAULT_HEALTH_PATH, timeoutMs: 3500 });
}

const CACHE_TTL_MS = 10 * 60 * 1000;

function expiryFor(_method: ResolverMethod): number {
  return Date.now() + CACHE_TTL_MS;
}

type ResolveAttempt = any & {
  method: ResolverMethod;
  label?: string;
  derivedFrom?: string;
};

async function resolveSellerEndpoint(
  apiBase: string,
  link: BuyLinkV1,
  manualHost: string | null,
  opts?: { sharedFallbackHost?: string | null; healthPathCache?: Record<string, any> }
): Promise<{
  endpoint: Endpoint | null;
  method?: ResolverMethod;
  diagnostics: string[];
  attempts: ResolveAttempt[];
  lastErrorType?: any;
  healthMs?: number;
}> {
  const diagnostics: string[] = [];
  const attempts: ResolveAttempt[] = [];
  const candidates: Array<{
    endpoint: Endpoint;
    method: ResolverMethod;
    label?: string;
    derivedFrom?: string;
  }> = [];

  if (link.host) {
    const hostCandidates = buildHostCandidates(link.host, link.port, {
      sharedFallbackHost: opts?.sharedFallbackHost || null
    });
    hostCandidates.forEach((c: any) => {
      const label = String(c.label || "").toLowerCase();
      const method: ResolverMethod =
        label === "primary" ? "linkHost" : label === "fallback" ? "linkFallback" : "sharedFallback";
      try {
        const url = new URL(c.origin);
        candidates.push({
          endpoint: {
            host: url.hostname,
            port: url.port || (url.protocol === "https:" ? "443" : "80"),
            scheme: url.protocol === "https:" ? "https" : "http"
          },
          method,
          label: c.label,
          derivedFrom: c.derivedFrom
        });
      } catch {
        // ignore invalid origin
      }
    });
  }

  const cached = loadPeerCacheEntry(link.sellerPeerId);
  if (cached?.lastOkHost && cached.lastOkPort) {
    candidates.push({
      endpoint: {
        host: cached.lastOkHost,
        port: String(cached.lastOkPort),
        scheme: cached.scheme || "http"
      },
      method: "cache",
      label: "cache"
    });
  }

  try {
    const res = await fetch(`${apiBase}/p2p/peers`);
    const data = await res.json();
    const match = (data?.peers || []).find((p: any) => String(p.peerId || "") === link.sellerPeerId);
    if (match?.host && match?.port) {
      candidates.push({
        endpoint: { host: String(match.host), port: String(match.port), scheme: "http" },
        method: "mdns",
        label: "mdns"
      });
    }
  } catch {
    diagnostics.push("mdns: failed to fetch peers");
  }

  if (manualHost) {
    const ep = normalizeEndpoint(manualHost, null);
    if (ep) candidates.push({ endpoint: ep, method: "manual", label: "manual" });
  }

  const seen = new Set<string>();
  let lastErrorType: any | undefined;
  let healthMs: number | undefined;
  for (const c of candidates) {
    const key = `${c.endpoint.scheme}://${c.endpoint.host}:${c.endpoint.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const baseUrl = endpointBaseUrl(c.endpoint);
    const result = {
      ...(await probeHealthMaybeProxy(apiBase, baseUrl)),
      data: {} as any
    };
    attempts.push({ ...result, method: c.method, label: c.label, derivedFrom: c.derivedFrom });
    if (!result.ok) {
      lastErrorType = result.errorType;
      diagnostics.push(`${c.method}: health failed (${result.errorType || "unknown"})`);
      if (c.method === "cache") invalidatePeerCacheEntry(link.sellerPeerId);
      continue;
    }
    const peerId = String(result.data?.peerId || "");
    if (peerId && peerId !== link.sellerPeerId) {
      lastErrorType = "unknown";
      diagnostics.push(`${c.method}: peerId mismatch`);
      attempts[attempts.length - 1].ok = false;
      attempts[attempts.length - 1].errorType = "unknown";
      attempts[attempts.length - 1].error = "peerId mismatch";
      continue;
    }

    const cacheEntry: PeerCacheEntry = {
      lastOkHost: c.endpoint.host,
      lastOkPort: Number(c.endpoint.port),
      lastOkAt: Date.now(),
      scheme: c.endpoint.scheme,
      sourceMethod: c.method,
      fingerprint: String(result.data?.fingerprint || cached?.fingerprint || ""),
      expiresAt: expiryFor(c.method)
    };
    writePeerCacheEntry(link.sellerPeerId, cacheEntry);
    healthMs = result.latencyMs ?? undefined;
    return { endpoint: c.endpoint, method: c.method, diagnostics, attempts, lastErrorType, healthMs };
  }

  return { endpoint: null, diagnostics, attempts, lastErrorType };
}

function formatResolveError(type?: any | null): string {
  if (type === "dns") return "DNS could not resolve. Trying fallback hosts…";
  if (type === "timeout") return "Timed out reaching seller. Retrying…";
  if (type === "refused") return "Connection refused. Seller might be offline.";
  if (type === "tls") return "TLS/cert error. Check HTTPS host.";
  if (type === "cloudflare") return "Cloudflare edge/tunnel error. Try again.";
  if (type === "http") return "Host reachable but /health failed.";
  if (type === "network") return "Network error. Check connectivity.";
  return "Seller offline or port not reachable.";
}

function formatAttemptReason(attempt: ResolveAttempt): string {
  if (attempt.ok) return "ok";
  if (attempt.errorType === "http" && attempt.status) return `HTTP ${attempt.status}`;
  if (attempt.errorType === "cloudflare" && attempt.status) return `Cloudflare HTTP ${attempt.status}`;
  if (attempt.errorType) return attempt.errorType;
  return "unknown";
}

export default function StorePage(props: { onOpenReceipt: (token: string) => void; onOpenDiagnostics?: () => void }) {
  const [input, setInput] = React.useState("");
  const [sellerHost, setSellerHost] = React.useState(() => guessApiBase());
  const [msg, setMsg] = React.useState<string | null>(null);
  const [resolving, setResolving] = React.useState(false);
  const [resolverPath, setResolverPath] = React.useState<string | null>(null);
  const [healthMs, setHealthMs] = React.useState<number | null>(null);
  const [healthOk, setHealthOk] = React.useState<boolean | null>(null);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [lastErrorType, setLastErrorType] = React.useState<any | null>(null);
  const [healthStatus, setHealthStatus] = React.useState<string | null>(null);
  const [lanPeers, setLanPeers] = React.useState<any[]>([]);
  const [connectionMode, setConnectionMode] = React.useState<"auto" | "lan" | "remote">("auto");
  const [metrics, setMetrics] = React.useState<any | null>(null);
  const [connState, setConnState] = React.useState<ConnectionState>("IDLE");
  const [currentEndpoint, setCurrentEndpoint] = React.useState<Endpoint | null>(null);
  const [resolverMethod, setResolverMethod] = React.useState<ResolverMethod | null>(null);
  const [lastOkAt, setLastOkAt] = React.useState<number | null>(null);
  const [retryCount, setRetryCount] = React.useState(0);
  const [nextRetryAt, setNextRetryAt] = React.useState<number | null>(null);
  const [diagnostics, setDiagnostics] = React.useState<string[]>([]);
  const [resolveAttempts, setResolveAttempts] = React.useState<ResolveAttempt[]>([]);
  const [showConnDetails, setShowConnDetails] = React.useState(false);
  const retryTimerRef = React.useRef<number | null>(null);
  const healthTimerRef = React.useRef<number | null>(null);
  const healthPathCacheRef = React.useRef<Record<string, any>>({});
  const debugEnabled =
    typeof window !== "undefined" &&
    (window.location.search.includes("cbDebug=1") || Boolean((import.meta as any).env?.DEV));

  React.useEffect(() => {
    if (!(import.meta as any).env?.DEV) return;
    let alive = true;
    const loadPeers = async () => {
      try {
        const res = await fetch(`${guessApiBase()}/p2p/peers`);
        const data = await res.json();
        if (alive) setLanPeers(Array.isArray(data?.peers) ? data.peers : []);
      } catch {
        if (alive) setLanPeers([]);
      }
    };
    loadPeers();
    const timer = window.setInterval(loadPeers, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  React.useEffect(() => {
    if (!debugEnabled) return;
    let alive = true;
    const loadMetrics = async () => {
      try {
        const res = await fetch(`${guessApiBase()}/p2p/metrics`);
        const data = await res.json();
        if (alive) setMetrics(data);
      } catch {
        if (alive) setMetrics(null);
      }
    };
    loadMetrics();
    const timer = window.setInterval(loadMetrics, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [debugEnabled]);

  React.useEffect(() => {
    return () => {
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
      if (healthTimerRef.current) window.clearInterval(healthTimerRef.current);
    };
  }, []);

  React.useEffect(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    try {
      localStorage.setItem("contentbox:lastBuyLink", trimmed);
    } catch {}
  }, [input]);

  const linkRef = React.useRef<BuyLinkV1 | null>(null);
  const manualRef = React.useRef<string | null>(null);

  const retryDelays = [0, 1000, 2000, 5000, 10000, 20000, 30000];
  const jitter = (ms: number) => Math.round(ms * (0.8 + Math.random() * 0.4));

  const scheduleRetry = (count: number) => {
    if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    const base = retryDelays[Math.min(count, retryDelays.length - 1)];
    const delay = jitter(base);
    setRetryCount(count);
    setNextRetryAt(Date.now() + delay);
    retryTimerRef.current = window.setTimeout(() => resolveOnce(count), delay);
  };

  const methodLabel = classifyLinkType(parseBuyLinkV1(input || ""));
  const endpointLabel = currentEndpoint
    ? `${currentEndpoint.scheme}://${currentEndpoint.host}:${currentEndpoint.port}`
    : "—";
  const lastOkLabel = lastOkAt ? new Date(lastOkAt).toLocaleTimeString() : "—";
  const healthLabel = healthOk == null ? "—" : healthOk ? "OK" : "Fail";
  const discoveryLabel = lanPeers.length ? `${lanPeers.length} peer${lanPeers.length === 1 ? "" : "s"}` : "None";
  const lastAttempt = resolveAttempts.length ? resolveAttempts[resolveAttempts.length - 1] : null;
  const lastAttemptSummary = lastAttempt
    ? `${lastAttempt.host}:${lastAttempt.port} • ${lastAttempt.method} • ${formatAttemptReason(lastAttempt)}`
    : "—";
  const scrubbedReport = [
    `connectionState=${connState}`,
    `method=${methodLabel}`,
    `resolverPath=${resolverPath || "—"}`,
    `endpoint=${endpointLabel}`,
    `health=${healthLabel}`,
    `healthMs=${healthMs ?? "—"}`,
    `lastOkAt=${lastOkAt ? new Date(lastOkAt).toISOString() : "—"}`,
    `retryCount=${retryCount}`,
    `attempts=${resolveAttempts.length}`,
    `lanPeers=${lanPeers.length}`,
    lastError ? `lastError=${lastError}` : null,
    lastErrorType ? `lastErrorType=${String(lastErrorType)}` : null,
    diagnostics.length ? `notes=${diagnostics.slice(-3).join(" | ")}` : null
  ].filter(Boolean).join("\n");

  const startHealthWatch = (endpoint: Endpoint) => {
    if (healthTimerRef.current) window.clearInterval(healthTimerRef.current);
    healthTimerRef.current = window.setInterval(async () => {
      try {
        const baseUrl = endpointBaseUrl(endpoint);
        const result = await probeHealthMaybeProxy(guessApiBase(), baseUrl);
        if (!result.ok) {
          setHealthOk(false);
          setLastErrorType(result.errorType || null);
          setLastError(formatResolveError(result.errorType));
          invalidatePeerCacheEntry(linkRef.current?.sellerPeerId || "");
          setConnState("RECONNECTING");
          scheduleRetry(Math.min(retryCount + 1, retryDelays.length - 1));
          return;
        }
        setHealthOk(true);
        setHealthMs(result.latencyMs ?? null);
        setLastOkAt(Date.now());
      } catch {}
    }, 10000);
  };

  const resolveOnce = async (count = 0) => {
    const link = linkRef.current;
    if (!link) return null;
    setConnState(count > 0 ? "RECONNECTING" : "RESOLVING");
    setHealthStatus("checking");
    setLastError(null);
    setLastErrorType(null);
    const manual = manualRef.current;
    const res = await resolveSellerEndpoint(guessApiBase(), link, manual, {
      sharedFallbackHost: getSharedFallbackHost(),
      healthPathCache: healthPathCacheRef.current
    });
    setDiagnostics(res.diagnostics || []);
    setResolveAttempts(res.attempts || []);
    setLastErrorType(res.lastErrorType || null);
    if (!res.endpoint) {
      setConnState("OFFLINE");
      setHealthStatus(null);
      setResolverPath(null);
      setResolverMethod(null);
      setCurrentEndpoint(null);
      setHealthOk(false);
      setHealthMs(null);
      setLastError(formatResolveError(res.lastErrorType));
      scheduleRetry(Math.min(count + 1, retryDelays.length - 1));
      return null;
    }
    setConnState("READY");
    setHealthStatus(null);
    setCurrentEndpoint(res.endpoint);
    setResolverMethod(res.method || null);
    setResolverPath(res.method || null);
    setLastOkAt(Date.now());
    setRetryCount(0);
    setNextRetryAt(null);
    setHealthOk(true);
    setHealthMs(res.healthMs ?? null);
    startHealthWatch(res.endpoint);
    return res.endpoint;
  };

  React.useEffect(() => {
    const v1 = parseBuyLinkV1(input || "");
    linkRef.current = v1;
    manualRef.current = sellerHost ? sellerHost.trim() : null;
    if (!v1) {
      setConnState("IDLE");
      setCurrentEndpoint(null);
      setResolverMethod(null);
      setResolverPath(null);
      setRetryCount(0);
      setNextRetryAt(null);
      setResolveAttempts([]);
      setDiagnostics([]);
      setLastError(null);
      setLastErrorType(null);
      return;
    }
    resolveOnce(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, sellerHost]);

  function onOpen() {
    setMsg(null);
    setLastError(null);
    const buyUrl = extractBuyUrl(input);
    if (buyUrl) {
      window.location.assign(buyUrl);
      return;
    }

    const token = extractReceiptToken(input);
    if (token) {
      props.onOpenReceipt(token);
      return;
    }

    const v1 = parseBuyLinkV1(input);
    if (v1) {
      setResolving(true);
      resolveOnce(retryCount).then((endpoint) => {
        if (!endpoint) {
          setMsg("Seller offline or port not reachable. Try host override or check port forward.");
          return;
        }
        const qs = new URLSearchParams({
          manifestHash: v1.manifestHash,
          primaryFileId: v1.primaryFileId,
          sellerPeerId: v1.sellerPeerId
        });
        if (v1.token) qs.set("token", v1.token);
        const baseUrl = endpointBaseUrl(endpoint);
        window.location.assign(`${baseUrl}/buy?${qs.toString()}`);
      }).finally(() => setResolving(false));
      return;
    }

    const contentId = input.trim();
    if (!contentId) {
      setMsg("Paste a link, receipt token, or content ID.");
      return;
    }
    if (!sellerHost) {
      setMsg("Enter the seller host to open this content.");
      return;
    }
    const host = sellerHost.replace(/\/$/, "");
    window.location.assign(`${host}/buy/${contentId}`);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Store (Direct link)</div>
        <div className="text-sm text-neutral-400 mt-1">
          Buy directly from a creator link. No marketplace required.
        </div>

        <div className="mt-4 space-y-2">
          <div className="text-sm font-medium">Buy from a link</div>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a ContentBox link, receipt link/token, or content ID"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
          />
          <div className="text-xs text-neutral-500">
            Paste any of these:
            <div>• https://seller.site/buy/CONTENT_ID</div>
            <div>• https://seller.site/public/receipts/TOKEN</div>
            <div>• TOKEN (receipt)</div>
            <div>• https://link?manifestHash=...&primaryFileId=...&sellerPeerId=...</div>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <div className="text-xs text-neutral-500">Manual host (only if you paste a content ID)</div>
              <div className="text-[11px] text-neutral-600">If you pasted a full link, you can ignore this field.</div>
              <input
                value={sellerHost}
                onChange={(e) => setSellerHost(e.target.value)}
                placeholder="https://seller.site"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={onOpen}
                className="w-full text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-60"
                disabled={resolving}
              >
                {resolving ? "Resolving…" : "Open"}
              </button>
            </div>
          </div>
          {msg ? <div className="text-xs text-amber-300">{msg}</div> : null}
          {parseBuyLinkV1(input || "") ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
              <span>Connection Mode:</span>
              <button
                type="button"
                className={`rounded-full border px-2 py-0.5 ${
                  connectionMode === "lan"
                    ? "border-emerald-900 text-emerald-200 bg-emerald-950/30"
                    : "border-neutral-800"
                }`}
                onClick={() => setConnectionMode("lan")}
              >
                LAN
              </button>
              <button
                type="button"
                className={`rounded-full border px-2 py-0.5 ${
                  connectionMode === "remote"
                    ? "border-amber-900 text-amber-200 bg-amber-950/30"
                    : "border-neutral-800"
                }`}
                onClick={() => setConnectionMode("remote")}
              >
                Remote
              </button>
              <button
                type="button"
                className={`rounded-full border px-2 py-0.5 ${
                  connectionMode === "auto"
                    ? "border-neutral-700 text-neutral-300 bg-neutral-950/60"
                    : "border-neutral-800"
                }`}
                onClick={() => setConnectionMode("auto")}
              >
                Auto
              </button>
              <span>
                Detected:{" "}
                {(() => {
                  const v1 = parseBuyLinkV1(input || "");
                  if (v1?.host) return "Remote";
                  if (v1) return "LAN";
                  return "—";
                })()}
              </span>
              <span>
                Link type: {classifyLinkType(parseBuyLinkV1(input || ""))}
              </span>
              <span className="text-neutral-600">Auto-detects LAN vs Remote from the link.</span>
            </div>
          ) : null}
          <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3 text-xs text-neutral-300">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium text-neutral-200">Connection status</div>
              <div className="flex items-center gap-2">
                {props.onOpenDiagnostics ? (
                  <button
                    className="rounded border border-neutral-800 px-2 py-1 text-[11px] hover:bg-neutral-900"
                    onClick={props.onOpenDiagnostics}
                  >
                    Open full diagnostics
                  </button>
                ) : null}
                <button
                  className="rounded border border-neutral-800 px-2 py-1 text-[11px] hover:bg-neutral-900"
                  onClick={() => setShowConnDetails((v) => !v)}
                >
                  {showConnDetails ? "Hide details" : "Details"}
                </button>
              </div>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>Connection: <span className="text-neutral-100">{connState}</span></div>
              <div>Method: <span className="text-neutral-100">{methodLabel}</span></div>
              <div>Endpoint: <span className="text-neutral-100">{endpointLabel}</span></div>
              <div>
                Health: <span className="text-neutral-100">{healthLabel}</span>
                {healthMs != null ? ` • ${healthMs}ms` : ""}
                {lastOkAt ? ` • last ok ${lastOkLabel}` : ""}
              </div>
              <div>Discovery: <span className="text-neutral-100">{discoveryLabel}</span></div>
              {nextRetryAt ? (
                <div>Retry: <span className="text-neutral-100">in {Math.max(0, Math.round((nextRetryAt - Date.now()) / 1000))}s</span></div>
              ) : null}
            </div>
            {showConnDetails ? (
              <div className="mt-3 border-t border-neutral-800 pt-2 text-[11px] text-neutral-400 space-y-1">
                <div>Resolver path: {resolverPath || "—"}</div>
                <div>Resolver method: {resolverMethod || "—"}</div>
                <div>Health status: {healthStatus || "—"}</div>
                <div>Retry count: {retryCount}</div>
                <div>Attempts recorded: {resolveAttempts.length}</div>
                <div>Last attempt: {lastAttemptSummary}</div>
                <div>Last error: {lastError || "—"}</div>
                {metrics?.lastHealthAt ? <div>Last health: {metrics.lastHealthAt}</div> : null}
                {diagnostics.length ? <div>Notes: {diagnostics.slice(-3).join(" • ")}</div> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className="rounded border border-neutral-800 px-2 py-1 text-[11px] hover:bg-neutral-900"
                    onClick={() => copyText(scrubbedReport)}
                  >
                    Copy debug info
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {connState === "OFFLINE" ? (
            <div className="mt-3 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-200">
              <div className="font-semibold">Couldn’t reach the seller.</div>
              <div className="mt-1 text-amber-300">{formatResolveError(lastErrorType)}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="rounded border border-amber-800 px-2 py-1 text-[11px] hover:bg-amber-950/40"
                  onClick={() => copyText(scrubbedReport)}
                >
                  Copy debug info
                </button>
                {props.onOpenDiagnostics ? (
                  <button
                    className="rounded border border-amber-800 px-2 py-1 text-[11px] hover:bg-amber-950/40"
                    onClick={props.onOpenDiagnostics}
                  >
                    Open full diagnostics
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6 opacity-80">
        <div className="text-lg font-semibold">Discovery (Coming soon)</div>
        <div className="text-sm text-neutral-400 mt-1">
          Discovery is coming soon. Creators opt-in by listing content. Direct links work today.
        </div>
        <div className="mt-4 grid gap-3">
          <input
            disabled
            placeholder="Search"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 opacity-50"
          />
          <div className="grid grid-cols-2 gap-2">
            <button disabled className="rounded-lg border border-neutral-800 px-3 py-2 text-xs opacity-50">
              Music
            </button>
            <button disabled className="rounded-lg border border-neutral-800 px-3 py-2 text-xs opacity-50">
              Video
            </button>
            <button disabled className="rounded-lg border border-neutral-800 px-3 py-2 text-xs opacity-50">
              Books
            </button>
            <button disabled className="rounded-lg border border-neutral-800 px-3 py-2 text-xs opacity-50">
              Files
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
