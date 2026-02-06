import React from "react";

function guessApiBase() {
  const raw = ((import.meta as any).env?.VITE_API_URL || window.location.origin) as string;
  return raw.replace(/\/$/, "");
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

type BuyLinkV1 = {
  manifestHash: string;
  primaryFileId: string;
  sellerPeerId: string;
  host?: string | null;
  port?: string | null;
  token?: string | null;
};

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

type PeerCacheEntry = {
  lastOkHost: string;
  lastOkPort: number;
  lastOkAt: number;
  lastErrorAt?: number;
  lastErrorReason?: string;
  fingerprint?: string;
};

const PEER_CACHE_KEY = "contentbox:peerHostMap";

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

async function pingHealth(
  baseUrl: string,
  timeoutMs = 1500,
  retries = 2,
  onAttempt?: (attempt: number, total: number) => void
): Promise<{ ok: boolean; ms: number; data?: any; error?: string; errorType?: string }> {
  const delays = [0, 300, 800];
  for (let i = 0; i < Math.max(1, retries); i += 1) {
    const delay = delays[i] || 0;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      onAttempt?.(i + 1, Math.max(1, retries));
      const start = performance.now();
      const res = await fetch(`${baseUrl}/health`, { signal: controller.signal, cache: "no-store" });
      const ms = Math.round(performance.now() - start);
      if (res.ok) {
        const data = await res.json().catch(() => null);
        return { ok: true, ms, data };
      }
      return { ok: false, ms, error: `HTTP_${res.status}`, errorType: "http" };
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      if (msg.toLowerCase().includes("failed to fetch")) {
        return { ok: false, ms: timeoutMs, error: msg, errorType: "network" };
      }
      if (msg.toLowerCase().includes("abort")) {
        return { ok: false, ms: timeoutMs, error: "timeout", errorType: "timeout" };
      }
      return { ok: false, ms: timeoutMs, error: msg, errorType: "unknown" };
    } finally {
      window.clearTimeout(timer);
    }
  }
  return { ok: false, ms: timeoutMs, error: "timeout", errorType: "timeout" };
}

async function resolveSellerBaseUrl(
  apiBase: string,
  link: BuyLinkV1,
  manualHost: string | null,
  onHealthAttempt?: (attempt: number, total: number) => void
): Promise<{
  baseUrl: string | null;
  path: "linkHost" | "cache" | "lan" | "manual" | "none";
  healthMs: number | null;
  healthOk: boolean;
  error?: string | null;
  errorType?: string | null;
}> {
  const candidates: Array<{ base: string; path: "linkHost" | "cache" | "lan" | "manual" }> = [];

  if (link.host) {
    const port = link.port ? String(link.port).trim() : "";
    const host = link.host.trim().replace(/\/$/, "");
    if (host) {
      if (/^https?:\/\//i.test(host)) {
        candidates.push({ base: port ? `${host}:${port}` : host, path: "linkHost" });
      } else {
        const hostPort = port ? `${host}:${port}` : host;
        candidates.push({ base: `http://${hostPort}`, path: "linkHost" });
      }
    }
  }

  const cache = loadPeerCache();
  const cached = cache[link.sellerPeerId];
  if (cached?.lastOkHost) {
    candidates.push({ base: `http://${cached.lastOkHost}:${cached.lastOkPort}`, path: "cache" });
  }

  try {
    const res = await fetch(`${apiBase}/p2p/peers`);
    const data = await res.json();
    const match = (data?.peers || []).find((p: any) => String(p.peerId || "") === link.sellerPeerId);
    if (match?.host && match?.port) {
      candidates.push({ base: `http://${match.host}:${match.port}`, path: "lan" });
    }
  } catch {}

  if (manualHost) {
    const clean = manualHost.trim().replace(/\/$/, "");
    if (clean) {
      candidates.push({ base: clean, path: "manual" });
    }
  }

  const seen = new Set<string>();
  let lastResult: any = null;
  for (const candidate of candidates) {
    const normalized = candidate.base.replace(/\/$/, "");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const result = await pingHealth(normalized, 1200, 3, onHealthAttempt);
    lastResult = result;
    if (result.ok) {
      const hostUrl = new URL(normalized);
      const peerId = String(result.data?.peerId || "");
      const fingerprint = String(result.data?.fingerprint || "");
      if (peerId && peerId !== link.sellerPeerId) {
        const confirmed = window.confirm(
          "Warning: Seller identity mismatch for this link. Continue anyway?"
        );
        if (!confirmed) {
          return { baseUrl: null, path: candidate.path, healthMs: result.ms, healthOk: true, error: "Seller identity mismatch" };
        }
      }
      if (cached?.fingerprint && fingerprint && cached.fingerprint !== fingerprint) {
        const confirmed = window.confirm(
          "Warning: Seller fingerprint changed for this peer. Continue anyway?"
        );
        if (!confirmed) {
          return { baseUrl: null, path: candidate.path, healthMs: result.ms, healthOk: true, error: "Seller fingerprint changed" };
        }
      }
      const entry: PeerCacheEntry = {
        lastOkHost: hostUrl.hostname,
        lastOkPort: Number(hostUrl.port || 80),
        lastOkAt: Date.now(),
        fingerprint: fingerprint || cached?.fingerprint
      };
      const next = { ...cache, [link.sellerPeerId]: entry };
      savePeerCache(next);
      return { baseUrl: normalized, path: candidate.path, healthMs: result.ms, healthOk: true };
    }
  }

  const next: Record<string, PeerCacheEntry> = { ...cache };
  if (link.sellerPeerId) {
    const prev = next[link.sellerPeerId];
    next[link.sellerPeerId] = {
      lastOkHost: prev?.lastOkHost || "",
      lastOkPort: prev?.lastOkPort || 0,
      lastOkAt: prev?.lastOkAt || 0,
      fingerprint: prev?.fingerprint,
      lastErrorAt: Date.now(),
      lastErrorReason: lastResult?.errorType || "health check failed"
    };
    savePeerCache(next);
  }
  const errorMsg =
    lastResult?.errorType === "timeout"
      ? "Seller not responding (timeout). Check port forward or firewall."
      : lastResult?.errorType === "network"
        ? "DNS/host unreachable. Check hostname, IP, or network."
        : lastResult?.errorType === "http"
          ? "Host reachable but /health failed. Check server status and port."
          : "Seller offline or port not reachable. Try host override or check port forward.";
  return { baseUrl: null, path: "none", healthMs: null, healthOk: false, error: errorMsg, errorType: lastResult?.errorType };
}

export default function StorePage(props: { onOpenReceipt: (token: string) => void }) {
  const [input, setInput] = React.useState("");
  const [sellerHost, setSellerHost] = React.useState(() => guessApiBase());
  const [msg, setMsg] = React.useState<string | null>(null);
  const [resolving, setResolving] = React.useState(false);
  const [resolverPath, setResolverPath] = React.useState<string | null>(null);
  const [healthMs, setHealthMs] = React.useState<number | null>(null);
  const [healthOk, setHealthOk] = React.useState<boolean | null>(null);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [healthStatus, setHealthStatus] = React.useState<string | null>(null);
  const [lanPeers, setLanPeers] = React.useState<any[]>([]);
  const [connectionMode, setConnectionMode] = React.useState<"auto" | "lan" | "remote">("auto");

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
      const manual = sellerHost ? sellerHost.trim() : "";
      setResolving(true);
      setHealthStatus("checking");
      resolveSellerBaseUrl(guessApiBase(), v1, manual || null, (attempt, total) => {
        setHealthStatus(`checking ${attempt}/${total}`);
      })
        .then((result) => {
          setResolverPath(result.path);
          setHealthMs(result.healthMs);
          setHealthOk(result.healthOk);
          setHealthStatus(null);
          if (!result.baseUrl) {
            setLastError(result.error || "Seller offline or not found");
            setMsg("Seller offline or port not reachable. Try host override or check port forward.");
            return;
          }
          const qs = new URLSearchParams({
            manifestHash: v1.manifestHash,
            primaryFileId: v1.primaryFileId,
            sellerPeerId: v1.sellerPeerId
          });
          if (v1.token) qs.set("token", v1.token);
          window.location.assign(`${result.baseUrl}/buy?${qs.toString()}`);
        })
        .finally(() => {
          setResolving(false);
          setHealthStatus(null);
        });
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
          <div className="text-sm">Buy from a link</div>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a ContentBox link, receipt link/token, or content ID"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
          />
          <div className="text-xs text-neutral-500">
            Examples: https://seller.site/buy/CONTENT_ID · https://seller.site/public/receipts/TOKEN · TOKEN ·
            https://link?manifestHash=...&primaryFileId=...&sellerPeerId=...
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <div className="text-xs text-neutral-500">Seller host (content ID or manual fallback)</div>
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
            </div>
          ) : null}
          <div className="text-[11px] text-neutral-500">
            Resolver: {resolverPath || "—"}
            {healthOk != null ? ` · health ${healthOk ? "ok" : "fail"}${healthMs != null ? ` (${healthMs}ms)` : ""}` : ""}
            {healthStatus ? ` · ${healthStatus}` : ""}
            {lastError ? ` · ${lastError}` : ""}
          </div>
        </div>
      </div>

      {Boolean((import.meta as any).env?.DEV) && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
          <div className="text-lg font-semibold">P2P Test (Dev)</div>
          <div className="text-xs text-neutral-500 mt-1">Resolver path: {resolverPath || "—"}</div>
          <div className="text-xs text-neutral-500 mt-1">
            Health: {healthOk === null ? "—" : healthOk ? "ok" : "fail"}{" "}
            {healthMs != null ? `(${healthMs}ms)` : ""}
            {healthStatus ? ` · ${healthStatus}` : ""}
            {lastError ? ` · ${lastError}` : ""}
          </div>
          <div className="mt-3 text-xs text-neutral-400">
            {(() => {
              const v1 = parseBuyLinkV1(input || "");
              if (!v1) return "Link fields: —";
              return `Link fields: sellerPeerId=${v1.sellerPeerId} host=${v1.host || "—"} port=${v1.port || "—"}`;
            })()}
          </div>
          <div className="mt-3 text-xs text-neutral-400">LAN peers:</div>
          <div className="mt-1 space-y-1 text-xs text-neutral-500">
            {lanPeers.length === 0 ? (
              <div>No peers discovered.</div>
            ) : (
              lanPeers.map((p) => (
                <div key={`${p.peerId}-${p.host}-${p.port}`}>
                  {p.peerId} · {p.host}:{p.port} · {Math.round((p.ageMs || 0) / 1000)}s ago
                </div>
              ))
            )}
          </div>
        </div>
      )}

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
