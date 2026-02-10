
import { useMemo, useState } from "react";
import { DEFAULT_HEALTH_PATH, probeHealth, shouldProxyHealthProbe } from "../lib/p2pHostDiagnostics";

type ProbeRow = {
  ok: boolean;
  url: string;
  status?: number;
  latencyMs?: number;
  errorType?: string;
  errorMessage?: string;
  label: string;
};

function getApiBase(): string {
  const env = (import.meta as any).env || {};
  const v = String(env.VITE_API_URL || "").trim();
  return (v || "http://127.0.0.1:4000").replace(/\/+$/, "");
}

function isLocalHostname(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  if (hostname.startsWith("10.") || hostname.startsWith("192.168.")) return true;
  const m = hostname.match(/^172\.(\d+)\./);
  if (m) {
    const n = Number(m[1]);
    return n >= 16 && n <= 31;
  }
  return false;
}

function isLocalApiBase(base: string): boolean {
  try {
    return isLocalHostname(new URL(base).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function fmtLatency(ms?: number) {
  if (!ms && ms !== 0) return "—";
  return `${Math.round(ms)}ms`;
}

function fmtStatus(row: ProbeRow) {
  if (row.ok) return "OK";
  if (row.status) return `HTTP ${row.status}`;
  return row.errorType || "Fail";
}

export default function DiagnosticsPage() {
  const apiBase = useMemo(() => getApiBase(), []);
  const inputClass =
    "w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-white placeholder:text-neutral-600 outline-none focus:border-neutral-600";
  const buttonClass =
    "rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white hover:border-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed";
  const [hostsText, setHostsText] = useState(() => {
    if (typeof window === "undefined") return "";
    const last = window.localStorage.getItem("contentbox:lastBuyLink") || "";
    if (!last) return "";
    try {
      const url = new URL(last);
      return url.hostname;
    } catch {
      return "";
    }
  });
  const [rows, setRows] = useState<ProbeRow[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const healthPath = DEFAULT_HEALTH_PATH;
  const useProxy = shouldProxyHealthProbe() || isLocalApiBase(apiBase);

  async function runTests() {
    const hosts = hostsText
      .split(/\s+/)
      .map((h) => h.trim())
      .filter(Boolean);

    if (!hosts.length) {
      setError("Enter one or more hosts to test.");
      return;
    }

    setError(null);
    setRunning(true);
    const results: ProbeRow[] = [];

    for (const host of hosts) {
      const origin = host.startsWith("http") ? host : `https://${host}`;
      try {
        if (useProxy) {
          const url = `${apiBase}/public/diag/probe-health?url=${encodeURIComponent(
            `${origin.replace(/\/$/, "")}${healthPath}`
          )}`;
          const res = await fetch(url, { method: "GET" });
          const json = await res.json();
          results.push({
            label: origin,
            ok: Boolean(json?.ok),
            url: origin,
            status: typeof json?.status === "number" ? json.status : undefined,
            latencyMs: typeof json?.latencyMs === "number" ? json.latencyMs : undefined,
            errorType: json?.errorType,
            errorMessage: json?.message
          });
        } else {
          const result = await probeHealth({ origin, path: healthPath, timeoutMs: 3500 });
          results.push({ label: origin, ...result });
        }
      } catch (err: any) {
        results.push({
          label: origin,
          ok: false,
          url: origin,
          errorType: "FETCH_FAILED",
          errorMessage: err?.message || String(err)
        });
      }
    }

    setRows(results);
    setRunning(false);
  }

  function copyReport() {
    const lines = rows.map((row) => {
      const status = fmtStatus(row);
      const latency = fmtLatency(row.latencyMs);
      const note = row.errorMessage ? ` • ${row.errorMessage}` : "";
      return `${row.label} | ${status} | ${latency}${note}`;
    });
    const report = [
      `Diagnostics report (${new Date().toISOString()})`,
      `healthPath=${healthPath}`,
      `mode=${useProxy ? "proxy" : "direct"}`,
      "",
      ...lines
    ].join("\n");
    navigator.clipboard.writeText(report).catch(() => {});
  }

  return (
    <div style={{ padding: 16, maxWidth: 960 }}>
      <h2 style={{ margin: "8px 0 12px" }}>Diagnostics</h2>
      <p style={{ opacity: 0.7, marginBottom: 12 }}>
        Run connectivity tests against your public hosts. This never includes secrets.
      </p>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Test hosts</div>
        <div style={{ opacity: 0.7, marginBottom: 8 }}>
          One host per line (e.g. buy.artist.com). Health path: <b>{healthPath}</b>
        </div>
        <textarea
          value={hostsText}
          onChange={(e) => setHostsText(e.target.value)}
          rows={3}
          className={inputClass}
          style={{ resize: "vertical" }}
          placeholder="buy.artist.com\nstudio.artist.com"
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            onClick={runTests}
            disabled={running}
            className={buttonClass}
          >
            {running ? "Running…" : "Run tests"}
          </button>
          <button
            onClick={copyReport}
            disabled={!rows.length}
            className={buttonClass}
          >
            Copy report
          </button>
        </div>
        {error && <div style={{ color: "#ff8080", marginTop: 8 }}>{error}</div>}
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Results</div>
        {!rows.length && <div style={{ opacity: 0.7 }}>No results yet.</div>}
        {rows.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            {rows.map((row) => (
              <div key={row.label} style={{ display: "grid", gridTemplateColumns: "1.4fr 0.6fr 0.4fr", gap: 8 }}>
                <div>{row.label}</div>
                <div>{fmtStatus(row)}</div>
                <div>{fmtLatency(row.latencyMs)}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 10, opacity: 0.6 }}>
          DNS lookup is best-effort in browsers; reachability is based on HTTPS probe results.
        </div>
      </div>
    </div>
  );
}
