
import { useEffect, useMemo, useState } from "react";
import { getToken } from "../lib/auth";
import { getApiBase } from "../lib/api";

type HealthPath = "/health" | "/api/health" | "/public/health";
const DEFAULT_HEALTH_PATH: HealthPath = "/health";

type ProbeErrorType =
  | "FETCH_FAILED"
  | "TIMEOUT"
  | "BAD_STATUS"
  | "INVALID_URL";

type ProbeResult = {
  ok: boolean;
  url: string;
  status?: number;
  latencyMs?: number;
  errorType?: ProbeErrorType;
  errorMessage?: string;
};

function isPrivateHostname(hostname: string): boolean {
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

function shouldProxyHealthProbe(hostname?: string): boolean {
  if (typeof window === "undefined") return false;
  const h = (hostname || window.location.hostname || "").toLowerCase();
  if (!h) return false;
  return isPrivateHostname(h);
}

async function probeHealth(args: {
  origin: string;
  path?: HealthPath;
  timeoutMs?: number;
}): Promise<ProbeResult> {
  const path: HealthPath = args.path || DEFAULT_HEALTH_PATH;
  const timeoutMs = args.timeoutMs ?? 3500;

  let url: string;
  try {
    url = new URL(path, args.origin.endsWith("/") ? args.origin : args.origin + "/").toString();
  } catch (e: any) {
    return {
      ok: false,
      url: `${args.origin}${path}`,
      errorType: "INVALID_URL",
      errorMessage: e?.message || "Invalid URL"
    };
  }

  const controller = new AbortController();
  const t0 = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    const latencyMs = Date.now() - t0;
    clearTimeout(timer);

    if (!res.ok) return { ok: false, url, status: res.status, latencyMs, errorType: "BAD_STATUS" };
    return { ok: true, url, status: res.status, latencyMs };
  } catch (e: any) {
    clearTimeout(timer);
    const msg = e?.message || String(e);
    const isAbort = msg.toLowerCase().includes("abort");
    return {
      ok: false,
      url,
      errorType: isAbort ? "TIMEOUT" : "FETCH_FAILED",
      errorMessage: msg
    };
  }
}

type ProbeRow = {
  ok: boolean;
  url: string;
  status?: number;
  latencyMs?: number;
  errorType?: string;
  errorMessage?: string;
  label: string;
};

type PublicStatus = {
  publicOrigin?: string | null;
  state?: string | null;
  lastCheckedAt?: number | null;
};


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
  const [publicStatus, setPublicStatus] = useState<PublicStatus | null>(null);
  const [tunnelHealth, setTunnelHealth] = useState<{ ok: boolean; ts?: string; status?: number } | null>(null);
  const [tunnelHealthErr, setTunnelHealthErr] = useState<string | null>(null);
  const [tunnelHealthBusy, setTunnelHealthBusy] = useState(false);
  const token = getToken();

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

  const checkTunnelHealth = async () => {
    const origin = String(publicStatus?.publicOrigin || "").trim();
    if (!origin) {
      setTunnelHealth(null);
      setTunnelHealthErr("No public origin available.");
      return;
    }
    const url = `${origin.replace(/\/$/, "")}/public/ping`;
    setTunnelHealthBusy(true);
    setTunnelHealthErr(null);
    try {
      const res = await fetch(url, { method: "GET" });
      const json = await res.json().catch(() => ({}));
      setTunnelHealth({ ok: Boolean(json?.ok), ts: json?.ts, status: res.status });
      if (!res.ok) {
        setTunnelHealthErr(`HTTP ${res.status}`);
      }
    } catch (e: any) {
      setTunnelHealth(null);
      setTunnelHealthErr(e?.message || String(e));
    } finally {
      setTunnelHealthBusy(false);
    }
  };

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
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Public tunnel health</div>
        {!token && <div style={{ opacity: 0.7 }}>Sign in to check tunnel health.</div>}
        {token && (
          <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
            <div><b>Status</b>: {publicStatus?.state || "—"}</div>
            <div><b>Public origin</b>: {publicStatus?.publicOrigin || "—"}</div>
            <div>
              <b>Last check</b>:{" "}
              {publicStatus?.lastCheckedAt ? new Date(publicStatus.lastCheckedAt).toLocaleString() : "—"}
            </div>
            <div>
              <b>Public ping</b>:{" "}
              {tunnelHealth ? (tunnelHealth.ok ? "ok" : "failed") : "—"}
              {tunnelHealth?.status ? ` (HTTP ${tunnelHealth.status})` : ""}
              {tunnelHealth?.ts ? ` • ${tunnelHealth.ts}` : ""}
              {tunnelHealthErr ? ` • ${tunnelHealthErr}` : ""}
            </div>
            <div>
              <button
                onClick={checkTunnelHealth}
                disabled={tunnelHealthBusy}
                className={buttonClass}
              >
                {tunnelHealthBusy ? "Checking…" : "Check tunnel health"}
              </button>
            </div>
          </div>
        )}
      </div>

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
