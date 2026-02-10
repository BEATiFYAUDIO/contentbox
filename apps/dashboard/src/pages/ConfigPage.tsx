
import { useEffect, useMemo, useState } from "react";
import { clearToken, getToken } from "../lib/auth";
import { DEFAULT_HEALTH_PATH } from "../lib/p2pHostDiagnostics";

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

export default function ConfigPage() {
  const apiBase = useMemo(() => getApiBase(), []);
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

  return (
    <div style={{ padding: 16, maxWidth: 980 }}>
      <h2 style={{ margin: "8px 0 12px" }}>Config</h2>
      <p style={{ opacity: 0.7, marginBottom: 16 }}>Networking + system settings used across ContentBox.</p>

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
            <div><b>OK</b>: {health.ok ? "yes" : "no"}</div>
            <div><b>Buy origin</b>: {health.publicBuyOrigin || "—"}</div>
            <div><b>Studio origin</b>: {health.publicStudioOrigin || "—"}</div>
            <div><b>Contentbox origin</b>: {health.publicOrigin || "—"}</div>
            <div><b>Last seen</b>: {health.ts || "—"}</div>
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
