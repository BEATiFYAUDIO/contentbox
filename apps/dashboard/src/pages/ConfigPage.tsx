
import { useEffect, useMemo, useState } from "react";
import { clearToken, getToken } from "../lib/auth";

type Health = {
  ok: boolean;
  peerId?: string;
  fingerprint?: string;
  httpPort?: number;
  publicOrigin?: string;
  ts?: string;
};

function getApiBase(): string {
  const env = (import.meta as any).env || {};
  const v = String(env.VITE_API_URL || "").trim();
  return (v || "http://127.0.0.1:4000").replace(/\/+$/, "");
}

export default function ConfigPage() {
  const apiBase = useMemo(() => getApiBase(), []);
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const token = getToken();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setErr(null);
        const res = await fetch(`${apiBase}/health`, { method: "GET" });
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

  return (
    <div style={{ padding: 16, maxWidth: 900 }}>
      <h2 style={{ margin: "8px 0 12px" }}>Config</h2>
      <p style={{ opacity: 0.7, marginBottom: 12 }}>Configuration UI coming soon.</p>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Diagnostics</div>
        <div><b>API base</b>: {apiBase}</div>
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

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>/health</div>
        {err && <div style={{ color: "#ff8080" }}>Error: {err}</div>}
        {!err && !health && <div>Loading…</div>}
        {health && (
          <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
            {JSON.stringify(health, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
