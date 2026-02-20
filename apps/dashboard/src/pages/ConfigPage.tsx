
import { useEffect, useMemo, useState } from "react";
import { clearToken, getToken } from "../lib/auth";
import { getApiBase } from "../lib/api";

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

export default function ConfigPage({ showAdvanced }: { showAdvanced?: boolean }) {
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
  const [namedTokenInput, setNamedTokenInput] = useState<string>("");
  const [namedTokenBusy, setNamedTokenBusy] = useState<boolean>(false);
  const [namedTokenMsg, setNamedTokenMsg] = useState<string | null>(null);
  const [publicStatus, setPublicStatus] = useState<any | null>(null);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<any | null>(null);
  const [publicBusy, setPublicBusy] = useState(false);
  const [publicMsg, setPublicMsg] = useState<string | null>(null);
  const [publicAdvancedOpen, setPublicAdvancedOpen] = useState(false);
  const [apiBaseOverride, setApiBaseOverride] = useState<string>(() => readStoredValue(STORAGE_API_BASE));
  const apiHost = safeHost(apiBase);
  const uiHost = safeHost(uiOrigin);
  const overrideHost = safeHost(apiBaseOverride);
  const overrideActive = Boolean(apiBaseOverride.trim());
  const apiMismatch = Boolean(uiHost && apiHost && uiHost !== apiHost);
  const overrideMismatch = Boolean(overrideActive && overrideHost && overrideHost !== apiHost);
  const canForceLocal = Boolean(uiHost && (uiHost === "localhost" || uiHost === "127.0.0.1"));

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

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/diagnostics/status`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (!cancelled) setDiagnosticsStatus(json || null);
      } catch {
        if (!cancelled) setDiagnosticsStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, token]);

  const productTier = diagnosticsStatus?.productTier || "basic";
  const namedConfigured = Boolean(diagnosticsStatus?.publicStatus?.namedConfigured);
  const quickDisabled = productTier === "advanced" && namedConfigured;

  const refreshPublicStatus = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${apiBase}/api/public/status`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      setPublicStatus(json || null);
    } catch {
      setPublicStatus(null);
    }
  };

  const startPublicLink = async () => {
    if (!token) return;
    setPublicBusy(true);
    setPublicMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/public/go`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ consent: true })
      });
      const json = await res.json();
      setPublicStatus(json || null);
      if (res.ok && json?.mode === "quick" && json?.publicOrigin) {
        const ok = window.confirm(
          "Temporary link created (testing only). Use for admin access. It does not activate Advanced. Open in new tab?"
        );
        if (ok) {
          window.open(String(json.publicOrigin), "_blank", "noopener,noreferrer");
        }
      }
      if (!res.ok) {
        setPublicMsg(json?.message || json?.error || "Failed to start public link.");
      }
    } catch (e: any) {
      setPublicMsg(e?.message || "Failed to start public link.");
    } finally {
      setPublicBusy(false);
    }
  };

  const setNamedOverride = async (disabled: boolean) => {
    if (!token) return;
    setPublicBusy(true);
    setPublicMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/public/named/${disabled ? "disable" : "enable"}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to update named override.");
      await refreshPublicStatus();
    } catch (e: any) {
      setPublicMsg(e?.message || "Failed to update named override.");
    } finally {
      setPublicBusy(false);
    }
  };

  const stopPublicLink = async () => {
    if (!token) return;
    setPublicBusy(true);
    setPublicMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/public/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      setPublicStatus(json || null);
    } catch (e: any) {
      setPublicMsg(e?.message || "Failed to stop public link.");
    } finally {
      setPublicBusy(false);
    }
  };

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

  const saveNamedToken = async (autoStart?: boolean) => {
    if (!token) return;
    const trimmed = namedTokenInput.trim();
    if (!trimmed) {
      setNamedTokenMsg("Paste the connector token to continue.");
      return;
    }
    setNamedTokenBusy(true);
    setNamedTokenMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/public/named-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ token: trimmed })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save token");
      setNamedTokenInput("");
      setNamedTokenMsg("Token saved.");
      if (autoStart) await startPublicLink();
      await refreshPublicStatus();
    } catch (e: any) {
      setNamedTokenMsg(e?.message || "Failed to save token.");
    } finally {
      setNamedTokenBusy(false);
    }
  };

  const generateNamedToken = async () => {
    if (!token) return;
    setNamedTokenBusy(true);
    setNamedTokenMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/public/named-token/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to generate token");
      const tok = String(json?.token || "").trim();
      if (!tok) throw new Error("Token generation failed");
      setNamedTokenInput(tok);
      setNamedTokenMsg("Token generated. Click Save & start tunnel.");
    } catch (e: any) {
      const details = e?.message || "Failed to generate token.";
      setNamedTokenMsg(details);
    } finally {
      setNamedTokenBusy(false);
    }
  };

  const clearNamedToken = async () => {
    if (!token) return;
    setNamedTokenBusy(true);
    setNamedTokenMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/public/named-token/clear`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to clear token");
      setNamedTokenMsg("Token cleared.");
      await refreshPublicStatus();
    } catch (e: any) {
      setNamedTokenMsg(e?.message || "Failed to clear token.");
    } finally {
      setNamedTokenBusy(false);
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
            {canForceLocal && (
              <button
                onClick={() => {
                  writeStoredValue(STORAGE_API_BASE, "http://127.0.0.1:4000");
                  window.location.reload();
                }}
                style={{ padding: "6px 10px", borderRadius: 10, cursor: "pointer", marginLeft: 8 }}
              >
                Use local API
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>API connection</div>
        <div style={{ opacity: 0.7, marginBottom: 8 }}>
          Current API base: <b>{apiBase}</b>
        </div>
        {showAdvanced ? (
          <>
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
          </>
        ) : (
          <div style={{ opacity: 0.6, marginTop: 6, fontSize: 12 }}>
            Advanced mode required to override API base.
          </div>
        )}
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
        {publicStatus ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <button
              onClick={startPublicLink}
              disabled={quickDisabled || publicBusy || publicStatus?.status === "starting" || publicStatus?.status === "online"}
              style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
            >
              Start temporary link
            </button>
            {quickDisabled ? (
              <div style={{ fontSize: 12, color: "#ffb4b4", alignSelf: "center" }}>
                Temporary (testing only — admin access only). Advanced prefers named when configured.
              </div>
            ) : null}
            {productTier === "advanced" && publicStatus?.mode === "quick" && publicStatus?.publicOrigin ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={() => window.open(String(publicStatus.publicOrigin), "_blank", "noopener,noreferrer")}
                  style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
                >
                  Open temporary link
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(String(publicStatus.publicOrigin)).catch(() => {});
                  }}
                  style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
                >
                  Copy temporary link
                </button>
              </div>
            ) : null}
            <button
              onClick={stopPublicLink}
              disabled={publicBusy || publicStatus?.status !== "online"}
              style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
            >
              Stop sharing
            </button>
            <button
              onClick={refreshPublicStatus}
              disabled={publicBusy}
              style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
            >
              Refresh status
            </button>
          </div>
        ) : null}
        {publicStatus ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <button
              onClick={() => setNamedOverride(true)}
              disabled={publicBusy || publicStatus?.namedDisabled}
              style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
            >
              Disable named (override)
            </button>
            <button
              onClick={() => setNamedOverride(false)}
              disabled={publicBusy || !publicStatus?.namedDisabled}
              style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
            >
              Re-enable named
            </button>
            {publicStatus?.namedDisabled ? (
              <div style={{ fontSize: 12, color: "#ffb4b4", alignSelf: "center" }}>
                Named tunnel override is ON. Env config is ignored.
              </div>
            ) : null}
          </div>
        ) : null}
        <div style={{ opacity: 0.7, marginBottom: 10 }}>
          Advanced routing for public links.
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={tunnelEnabled}
            onChange={async (e) => {
              const v = e.target.checked;
              setTunnelEnabled(v);
              writeStoredValue(STORAGE_TUNNEL_CONFIG_ENABLED, v ? "1" : "");
              if (!v && token) {
                try {
                  const res = await fetch(`${apiBase}/api/public/config`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ provider: null, domain: null, tunnelName: null })
                  });
                  const json = await res.json();
                  if (res.ok) {
                    setTunnelProvider(json?.provider || "cloudflare");
                    setTunnelDomain(json?.domain || "");
                    setTunnelName(json?.tunnelName || "");
                    await refreshPublicStatus();
                  }
                } catch {}
              }
              if (!v && publicStatus?.mode === "named" && publicStatus?.status !== "offline") {
                setPublicMsg("Named tunnel is still running. Click Stop sharing to shut it down.");
              }
            }}
          />
          <span>Enable advanced routing settings</span>
        </label>
        {!tunnelEnabled && publicStatus?.mode === "named" && publicStatus?.status !== "offline" ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#ffb4b4" }}>
            Named tunnel still running. Use <b>Stop sharing</b> to disable it.
          </div>
        ) : null}
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
            {tunnelEnabled ? (
              <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Connect named tunnel (one‑time)</div>
                <div style={{ opacity: 0.65, fontSize: 12, marginBottom: 8 }}>
                  Paste the Cloudflare connector token once. ContentBox will reuse it to start the tunnel.
                </div>
                <input
                  value={namedTokenInput}
                  onChange={(e) => setNamedTokenInput(e.target.value)}
                  placeholder="Cloudflare connector token"
                  className={inputClass}
                  disabled={!tunnelEnabled}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={generateNamedToken}
                    disabled={namedTokenBusy || !tunnelEnabled}
                    style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
                  >
                    Generate token
                  </button>
                  <button
                    onClick={() => saveNamedToken(false)}
                    disabled={namedTokenBusy || !tunnelEnabled}
                    style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
                  >
                    Save token
                  </button>
                  <button
                    onClick={() => saveNamedToken(true)}
                    disabled={namedTokenBusy || !tunnelEnabled}
                    style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
                  >
                    Save & start tunnel
                  </button>
                  {publicStatus?.namedTokenStored ? (
                    <button
                      onClick={clearNamedToken}
                      disabled={namedTokenBusy || !tunnelEnabled}
                      style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
                    >
                      Clear saved token
                    </button>
                  ) : null}
                </div>
                {namedTokenMsg ? <div style={{ marginTop: 6, color: "#ffb4b4" }}>{namedTokenMsg}</div> : null}
              </div>
            ) : null}
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
                <span
                  className={`text-[11px] rounded-full border px-2 py-0.5 ${
                    publicStatus?.status === "online"
                      ? "border-emerald-900 bg-emerald-950/30 text-emerald-200"
                      : publicStatus?.status === "starting"
                        ? "border-amber-900 bg-amber-950/30 text-amber-200"
                        : publicStatus?.status === "error"
                          ? "border-red-900 bg-red-950/30 text-red-200"
                          : "border-neutral-800 bg-neutral-950 text-neutral-400"
                  }`}
                >
                  {publicStatus?.status === "online"
                    ? "ONLINE"
                    : publicStatus?.status === "starting"
                      ? "STARTING"
                      : publicStatus?.status === "error"
                        ? "ERROR"
                        : "OFFLINE"}
                </span>
                <span className="text-[11px] rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-neutral-500">
                  DDNS disabled
                </span>
                <span className="text-[11px] rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-neutral-400">
                  {publicStatus?.mode === "named"
                    ? `Permanent (${(publicStatus as any)?.tunnelName || "Named"})`
                    : publicStatus?.mode === "quick"
                      ? productTier === "advanced"
                        ? "Temporary (testing only — admin access only)"
                        : "Temporary (Quick)"
                      : "Local"}
                </span>
              </div>
            ) : null}
            {publicStatus ? (
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                Controls for Quick link and sharing are in <b>Tunnel &amp; routing</b>.
              </div>
            ) : null}
            {publicMsg ? <div style={{ color: "#ffb4b4" }}>{publicMsg}</div> : null}
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
            {publicStatus ? (
              <>
                <div><b>Public origin</b>: {publicStatus?.canonicalOrigin || publicStatus?.publicOrigin || "—"}</div>
                <div><b>Last error</b>: {publicStatus?.lastError || "—"}</div>
                <div><b>cloudflared</b>: {publicStatus?.cloudflared?.available ? "yes" : "no"}</div>
                <div><b>cloudflared path</b>: {publicStatus?.cloudflared?.managedPath || "—"}</div>
                <div><b>cloudflared version</b>: {publicStatus?.cloudflared?.version || "—"}</div>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(publicStatus?.autoStartEnabled)}
                    onChange={async (e) => {
                      try {
                        const res = await fetch(`${apiBase}/api/public/autostart`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ enabled: e.target.checked })
                        });
                        const json = await res.json();
                        setPublicStatus(json || null);
                      } catch {
                        setPublicMsg("Failed to update auto-start setting.");
                      }
                    }}
                  />
                  Auto-start Public Link on launch
                </label>
                <div>
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch(`${apiBase}/api/public/consent/reset`, {
                          method: "POST",
                          headers: { Authorization: `Bearer ${token}` }
                        });
                        const json = await res.json();
                        setPublicStatus(json || null);
                      } catch {
                        setPublicMsg("Failed to reset consent.");
                      }
                    }}
                    style={{ padding: "6px 10px", borderRadius: 10, cursor: "pointer" }}
                  >
                    Reset Public Link consent
                  </button>
                </div>
                <button
                  onClick={() => setPublicAdvancedOpen((v) => !v)}
                  style={{ padding: "6px 10px", borderRadius: 10, cursor: "pointer" }}
                >
                  {publicAdvancedOpen ? "Hide details" : "Show details"}
                </button>
                {publicAdvancedOpen ? (
                  <div style={{ opacity: 0.8 }}>
                    <div><b>Mode</b>: {publicStatus?.mode || "—"}</div>
                    <div><b>Consent required</b>: {publicStatus?.consentRequired ? "yes" : "no"}</div>
                  </div>
                ) : null}
              </>
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
