
import { useEffect, useMemo, useState } from "react";
import { clearToken, getToken } from "../lib/auth";

const DEFAULT_HEALTH_PATH = "/health";

type Health = {
  ok: boolean;
  peerId?: string;
  fingerprint?: string;
  httpPort?: number;
  publicOrigin?: string;
  publicBuyOrigin?: string;
  publicStudioOrigin?: string;
  ts?: string;
};

const STORAGE_PUBLIC_ORIGIN = "contentbox.publicOrigin";
const STORAGE_PUBLIC_BUY_ORIGIN = "contentbox.publicBuyOrigin";
const STORAGE_PUBLIC_STUDIO_ORIGIN = "contentbox.publicStudioOrigin";
const STORAGE_PUBLIC_ORIGIN_FALLBACK = "contentbox.publicOriginFallback";
const STORAGE_PUBLIC_BUY_ORIGIN_FALLBACK = "contentbox.publicBuyOriginFallback";
const STORAGE_PUBLIC_STUDIO_ORIGIN_FALLBACK = "contentbox.publicStudioOriginFallback";
const STORAGE_TUNNEL_CONFIG_ENABLED = "contentbox.tunnelConfig.enabled";
const STORAGE_API_BASE = "contentbox.apiBase";

function getApiBase(): string {
  const env = (import.meta as any).env || {};
  const v = String(env.VITE_API_URL || "").trim();
  return (v || "http://127.0.0.1:4000").replace(/\/+$/, "");
}

function readStoredValue(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeStoredValue(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (!value) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, value);
  } catch {}
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function safeHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

export default function ConfigPage() {
  const apiBase = useMemo(() => getApiBase(), []);
  const uiOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const token = getToken();
  const inputClass =
    "w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-white placeholder:text-neutral-600 outline-none focus:border-neutral-600";
  const [publicOrigin, setPublicOrigin] = useState<string>(() => readStoredValue(STORAGE_PUBLIC_ORIGIN));
  const [publicBuyOrigin, setPublicBuyOrigin] = useState<string>(() => readStoredValue(STORAGE_PUBLIC_BUY_ORIGIN));
  const [publicStudioOrigin, setPublicStudioOrigin] = useState<string>(() => readStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN));
  const [publicOriginFallback, setPublicOriginFallback] = useState<string>(() => readStoredValue(STORAGE_PUBLIC_ORIGIN_FALLBACK));
  const [publicBuyOriginFallback, setPublicBuyOriginFallback] = useState<string>(() => readStoredValue(STORAGE_PUBLIC_BUY_ORIGIN_FALLBACK));
  const [publicStudioOriginFallback, setPublicStudioOriginFallback] = useState<string>(() => readStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN_FALLBACK));
  const [tunnelEnabled, setTunnelEnabled] = useState<boolean>(() => readStoredValue(STORAGE_TUNNEL_CONFIG_ENABLED) === "1");
  const [tunnelProvider, setTunnelProvider] = useState<string>("cloudflare");
  const [tunnelDomain, setTunnelDomain] = useState<string>("");
  const [tunnelName, setTunnelName] = useState<string>("");
  const [tunnelError, setTunnelError] = useState<string | null>(null);
  const [tunnelLoading, setTunnelLoading] = useState<boolean>(false);
  const [tunnelList, setTunnelList] = useState<Array<{ name?: string; id?: string }>>([]);
  const [publicStatus, setPublicStatus] = useState<any | null>(null);
  const [apiBaseOverride, setApiBaseOverride] = useState<string>(() => readStoredValue(STORAGE_API_BASE));
  const apiHost = safeHost(apiBase);
  const uiHost = safeHost(uiOrigin);
  const overrideHost = safeHost(apiBaseOverride);
  const overrideActive = Boolean(apiBaseOverride.trim());
  const apiMismatch = Boolean(uiHost && apiHost && uiHost !== apiHost);
  const overrideMismatch = Boolean(overrideActive && overrideHost && overrideHost !== apiHost);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setErr(null);
        const res = await fetch(`${apiBase}${DEFAULT_HEALTH_PATH}`, { method: "GET" });
        const json = (await res.json()) as Health;
        if (!cancelled) setHealth(json);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    if (!tunnelEnabled || !token) return;
    let cancelled = false;
    (async () => {
      try {
        setTunnelError(null);
        setTunnelLoading(true);
        const res = await fetch(`${apiBase}/api/public/config`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (!cancelled) {
          setTunnelProvider(json?.provider || "cloudflare");
          setTunnelDomain(json?.domain || "");
          setTunnelName(json?.tunnelName || "");
        }
      } catch (e: any) {
        if (!cancelled) setTunnelError(e?.message || String(e));
      } finally {
        if (!cancelled) setTunnelLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, token, tunnelEnabled]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/public/status`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (!cancelled) setPublicStatus(json || null);
      } catch {
        if (!cancelled) setPublicStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, token]);

  const buildInfo = `${(import.meta as any).env?.MODE || "unknown"} • ${
    (import.meta as any).env?.VITE_APP_VERSION || "dev"
  }`;

  const saveNetworking = () => {
    writeStoredValue(STORAGE_PUBLIC_ORIGIN, normalizeOrigin(publicOrigin));
    writeStoredValue(STORAGE_PUBLIC_BUY_ORIGIN, normalizeOrigin(publicBuyOrigin));
    writeStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN, normalizeOrigin(publicStudioOrigin));
    writeStoredValue(STORAGE_PUBLIC_ORIGIN_FALLBACK, normalizeOrigin(publicOriginFallback));
    writeStoredValue(STORAGE_PUBLIC_BUY_ORIGIN_FALLBACK, normalizeOrigin(publicBuyOriginFallback));
    writeStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN_FALLBACK, normalizeOrigin(publicStudioOriginFallback));
  };

  const clearNetworking = () => {
    setPublicOrigin("");
    setPublicBuyOrigin("");
    setPublicStudioOrigin("");
    setPublicOriginFallback("");
    setPublicBuyOriginFallback("");
    setPublicStudioOriginFallback("");
    writeStoredValue(STORAGE_PUBLIC_ORIGIN, "");
    writeStoredValue(STORAGE_PUBLIC_BUY_ORIGIN, "");
    writeStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN, "");
    writeStoredValue(STORAGE_PUBLIC_ORIGIN_FALLBACK, "");
    writeStoredValue(STORAGE_PUBLIC_BUY_ORIGIN_FALLBACK, "");
    writeStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN_FALLBACK, "");
  };

  const saveApiBaseOverride = () => {
    writeStoredValue(STORAGE_API_BASE, normalizeOrigin(apiBaseOverride));
    window.location.reload();
  };

  const clearApiBaseOverride = () => {
    setApiBaseOverride("");
    writeStoredValue(STORAGE_API_BASE, "");
    window.location.reload();
  };

  const saveTunnelConfig = async () => {
    if (!token) return;
    setTunnelError(null);
    setTunnelLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/public/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          provider: tunnelProvider,
          domain: tunnelDomain,
          tunnelName
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save tunnel config");
      setTunnelProvider(json?.provider || "cloudflare");
      setTunnelDomain(json?.domain || "");
      setTunnelName(json?.tunnelName || "");
    } catch (e: any) {
      setTunnelError(e?.message || String(e));
    } finally {
      setTunnelLoading(false);
    }
  };

  const discoverTunnels = async () => {
    if (!token) return;
    setTunnelError(null);
    setTunnelLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/public/tunnels`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to list tunnels");
      setTunnelList(Array.isArray(json?.tunnels) ? json.tunnels : []);
    } catch (e: any) {
      setTunnelError(e?.message || String(e));
    } finally {
      setTunnelLoading(false);
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 980 }}>
      <h2 style={{ margin: "8px 0 12px" }}>Config</h2>
      <p style={{ opacity: 0.7, marginBottom: 16 }}>Networking + system settings used across ContentBox.</p>

      {(apiMismatch || overrideMismatch) && (
        <div
          style={{
            border: "1px solid rgba(255,180,80,0.5)",
            background: "rgba(255,180,80,0.08)",
            borderRadius: 12,
            padding: 12,
            marginBottom: 14
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Diagnostics</div>
          {apiMismatch && (
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              This dashboard is pointed at a different machine. UI host: <b>{uiHost || "unknown"}</b> • API host:{" "}
              <b>{apiHost || "unknown"}</b>
            </div>
          )}
          {overrideMismatch && (
            <div style={{ fontSize: 13 }}>
              API override is set and does not match the current API base. Override:{" "}
              <b>{overrideHost || "invalid"}</b> • API base: <b>{apiHost || "unknown"}</b>
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <button
              onClick={clearApiBaseOverride}
              style={{ padding: "6px 10px", borderRadius: 10, cursor: "pointer" }}
            >
              Clear override & reload
            </button>
          </div>
        </div>
      )}

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>API connection</div>
        <div style={{ opacity: 0.7, marginBottom: 8 }}>
          Current API base: <b>{apiBase}</b>
        </div>
        <label>
          <div style={{ opacity: 0.7, marginBottom: 4 }}>API base override (advanced)</div>
          <input
            value={apiBaseOverride}
            onChange={(e) => setApiBaseOverride(e.target.value)}
            placeholder="http://127.0.0.1:4000"
            className={inputClass}
          />
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            onClick={saveApiBaseOverride}
            style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
          >
            Save & reload
          </button>
          <button
            onClick={clearApiBaseOverride}
            style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
          >
            Clear override
          </button>
        </div>
        <div style={{ opacity: 0.6, marginTop: 6, fontSize: 12 }}>
          If you see tunnels from another machine, your API base is pointing there.
        </div>
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Networking</div>
        <div style={{ opacity: 0.7, marginBottom: 12 }}>
          Public hosts used for buy + studio + contentbox routing.
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <label>
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Buy host (public)</div>
            <input
              value={publicBuyOrigin}
              onChange={(e) => setPublicBuyOrigin(e.target.value)}
              placeholder="https://buy.yourdomain.com"
              className={inputClass}
            />
          </label>
          <label>
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Studio host (public)</div>
            <input
              value={publicStudioOrigin}
              onChange={(e) => setPublicStudioOrigin(e.target.value)}
              placeholder="https://studio.yourdomain.com"
              className={inputClass}
            />
          </label>
          <label>
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Contentbox host (public)</div>
            <input
              value={publicOrigin}
              onChange={(e) => setPublicOrigin(e.target.value)}
              placeholder="https://contentbox.yourdomain.com"
              className={inputClass}
            />
          </label>
        </div>

        <div style={{ marginTop: 12, fontWeight: 600 }}>Fallback hosts (optional)</div>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          <label>
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Buy fallback</div>
            <input
              value={publicBuyOriginFallback}
              onChange={(e) => setPublicBuyOriginFallback(e.target.value)}
              placeholder="https://buy.fallback.com"
              className={inputClass}
            />
          </label>
          <label>
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Studio fallback</div>
            <input
              value={publicStudioOriginFallback}
              onChange={(e) => setPublicStudioOriginFallback(e.target.value)}
              placeholder="https://studio.fallback.com"
              className={inputClass}
            />
          </label>
          <label>
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Contentbox fallback</div>
            <input
              value={publicOriginFallback}
              onChange={(e) => setPublicOriginFallback(e.target.value)}
              placeholder="https://contentbox.fallback.com"
              className={inputClass}
            />
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={saveNetworking}
            style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
          >
            Save networking
          </button>
          <button
            onClick={clearNetworking}
            style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
          >
            Clear overrides
          </button>
        </div>

        <div style={{ marginTop: 12, opacity: 0.7 }}>
          Health path used: <b>{DEFAULT_HEALTH_PATH}</b>
        </div>
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Tunnel & routing</div>
        <div style={{ opacity: 0.7, marginBottom: 10 }}>
          Advanced routing for public links.
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={tunnelEnabled}
            onChange={(e) => {
              const v = e.target.checked;
              setTunnelEnabled(v);
              writeStoredValue(STORAGE_TUNNEL_CONFIG_ENABLED, v ? "1" : "");
            }}
          />
          <span>Enable advanced routing settings</span>
        </label>
        {!tunnelEnabled && (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
            Advanced routing is off — Quick tunnel will be used (no DDNS/custom domain).
          </div>
        )}

        {!token && <div style={{ marginTop: 8, opacity: 0.7 }}>Sign in to manage tunnel settings.</div>}

        {token && (
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {tunnelError && <div style={{ color: "#ff8080" }}>{tunnelError}</div>}
            {publicStatus?.mode && publicStatus.mode !== "named" ? (
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Named tunnel settings apply only when PUBLIC_MODE=named.
              </div>
            ) : null}
            <label>
              <div style={{ opacity: 0.7, marginBottom: 4 }}>Provider</div>
              <input
                value={tunnelProvider}
                onChange={(e) => setTunnelProvider(e.target.value)}
                placeholder="cloudflare"
                className={inputClass}
                disabled={!tunnelEnabled}
              />
            </label>
            <label>
              <div style={{ opacity: 0.7, marginBottom: 4 }}>Public domain (base)</div>
              <input
                value={tunnelDomain}
                onChange={(e) => setTunnelDomain(e.target.value)}
                placeholder="contentbox.link"
                className={inputClass}
                disabled={!tunnelEnabled}
              />
              <div style={{ opacity: 0.6, marginTop: 4, fontSize: 12 }}>
                Base domain for public links (e.g. <b>contentbox.link</b>). The tunnel list does not include domains.
              </div>
            </label>
            <label>
              <div style={{ opacity: 0.7, marginBottom: 4 }}>Tunnel name</div>
              <input
                value={tunnelName}
                onChange={(e) => setTunnelName(e.target.value)}
                placeholder="contentbox"
                className={inputClass}
                disabled={!tunnelEnabled}
              />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={saveTunnelConfig}
                disabled={tunnelLoading || !tunnelEnabled}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
              >
                Save tunnel config
              </button>
              <button
                onClick={discoverTunnels}
                disabled={tunnelLoading || !tunnelEnabled}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
              >
                Discover tunnels
              </button>
            </div>
            {tunnelList.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Found tunnels</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {tunnelList.map((t, i) => {
                    const label = t?.name || t?.id || String(i + 1);
                    return (
                      <button
                        key={`${t?.id || t?.name || i}`}
                        type="button"
                        onClick={() => setTunnelName(String(label))}
                        className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>System</div>
        <div><b>API base</b>: {apiBase}</div>
        <div><b>Build</b>: {buildInfo}</div>
        <div><b>Token</b>: {token ? `present (${token.slice(0, 10)}…)` : "not set"}</div>
        <div style={{ marginTop: 10 }}>
          <button
            onClick={() => { clearToken(); window.location.reload(); }}
            style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
          >
            Clear token & reload
          </button>
        </div>
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Tunnel status</div>
        {err && <div style={{ color: "#ff8080" }}>Error: {err}</div>}
        {!err && !health && <div>Checking…</div>}
        {health && (
          <div style={{ display: "grid", gap: 4 }}>
            {publicStatus ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                {(() => {
                  const isNamed = publicStatus?.mode === "named";
                  const hasNamedOrigin = Boolean(health.publicOrigin || health.publicBuyOrigin || health.publicStudioOrigin);
                  const displayState = isNamed && hasNamedOrigin ? "ACTIVE" : publicStatus?.state || "STOPPED";
                  const badge = displayState === "ACTIVE"
                    ? "border-emerald-900 bg-emerald-950/30 text-emerald-200"
                    : displayState === "STARTING"
                      ? "border-amber-900 bg-amber-950/30 text-amber-200"
                      : displayState === "ERROR"
                        ? "border-red-900 bg-red-950/30 text-red-200"
                        : "border-neutral-800 bg-neutral-950 text-neutral-400";
                  return (
                    <>
                      <span className={`text-[11px] rounded-full border px-2 py-0.5 ${badge}`}>
                        {displayState}
                      </span>
                      <span className="text-[11px] rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-neutral-500">
                        {isNamed ? "Named tunnel" : "Quick tunnel"}
                      </span>
                    </>
                  );
                })()}
              </div>
            ) : null}
            <div><b>OK</b>: {health.ok ? "yes" : "no"}</div>
            <div><b>Buy origin</b>: {health.publicBuyOrigin || "—"}</div>
            <div><b>Studio origin</b>: {health.publicStudioOrigin || "—"}</div>
            <div><b>Contentbox origin</b>: {health.publicOrigin || "—"}</div>
            <div><b>Last seen</b>: {health.ts || "—"}</div>
            {publicStatus ? (
              <div>
                <b>Last check</b>:{" "}
                {publicStatus?.lastCheckedAt ? new Date(publicStatus.lastCheckedAt).toLocaleString() : "—"}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Publishing</div>
        <div style={{ opacity: 0.75 }}>
          Use “Publish to Website” on a content item to generate embed snippets and a public buy link. No secrets are stored here.
        </div>
      </div>
    </div>
  );
}
