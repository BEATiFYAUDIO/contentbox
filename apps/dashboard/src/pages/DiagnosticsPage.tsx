
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
  canonicalOrigin?: string | null;
  status?: string | null;
  mode?: string | null;
  tunnelName?: string | null;
  lastCheckedAt?: number | null;
};

type PublicTunnel = {
  id?: string;
  name?: string;
  createdAt?: string;
  status?: string;
  connections?: number;
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

function fmtBytes(bytes?: number) {
  if (bytes === undefined || bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
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
  const [publicTunnels, setPublicTunnels] = useState<PublicTunnel[]>([]);
  const [publicTunnelsErr, setPublicTunnelsErr] = useState<string | null>(null);
  const [publicTunnelsBusy, setPublicTunnelsBusy] = useState(false);
  const [backups, setBackups] = useState<{ name: string; size: number; modifiedAt: string }[]>([]);
  const [backupsErr, setBackupsErr] = useState<string | null>(null);
  const [backupsBusy, setBackupsBusy] = useState(false);
  const [backupRunBusy, setBackupRunBusy] = useState(false);
  const [backupDir, setBackupDir] = useState<string | null>(null);
  const [backupRetentionDays, setBackupRetentionDays] = useState<number | null>(null);
  const [backupsEnabled, setBackupsEnabled] = useState(true);
  const [backupsSettingsBusy, setBackupsSettingsBusy] = useState(false);
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

  const loadPublicTunnels = async () => {
    if (!token) return;
    setPublicTunnelsBusy(true);
    setPublicTunnelsErr(null);
    try {
      const res = await fetch(`${apiBase}/api/public/tunnels`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPublicTunnels([]);
        setPublicTunnelsErr(json?.error || `HTTP ${res.status}`);
      } else {
        setPublicTunnels(Array.isArray(json?.tunnels) ? json.tunnels : []);
      }
    } catch (e: any) {
      setPublicTunnels([]);
      setPublicTunnelsErr(e?.message || String(e));
    } finally {
      setPublicTunnelsBusy(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    loadPublicTunnels().catch(() => {});
  }, [token, apiBase]);

  const loadBackups = async () => {
    if (!token) return;
    setBackupsBusy(true);
    setBackupsErr(null);
    try {
      const res = await fetch(`${apiBase}/api/diagnostics/backups`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBackups([]);
        setBackupsErr(json?.error || `HTTP ${res.status}`);
      } else {
        setBackups(Array.isArray(json?.items) ? json.items : []);
        setBackupDir(json?.dir || null);
        setBackupsEnabled(Boolean(json?.enabled));
        setBackupRetentionDays(
          typeof json?.retentionDays === "number" ? json.retentionDays : null
        );
      }
    } catch (e: any) {
      setBackups([]);
      setBackupsErr(e?.message || String(e));
    } finally {
      setBackupsBusy(false);
    }
  };

  const loadBackupSettings = async () => {
    if (!token) return;
    setBackupsSettingsBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/diagnostics/backups/settings`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setBackupsEnabled(Boolean(json?.enabled));
      }
    } finally {
      setBackupsSettingsBusy(false);
    }
  };

  const runBackup = async () => {
    if (!token) return;
    setBackupRunBusy(true);
    setBackupsErr(null);
    try {
      const res = await fetch(`${apiBase}/api/diagnostics/backups`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBackupsErr(json?.error || `HTTP ${res.status}`);
      } else {
        await loadBackups();
      }
    } catch (e: any) {
      setBackupsErr(e?.message || String(e));
    } finally {
      setBackupRunBusy(false);
    }
  };

  const toggleBackups = async (enabled: boolean) => {
    if (!token) return;
    setBackupsSettingsBusy(true);
    setBackupsErr(null);
    try {
      const res = await fetch(`${apiBase}/api/diagnostics/backups/settings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBackupsErr(json?.error || `HTTP ${res.status}`);
      } else {
        setBackupsEnabled(Boolean(json?.enabled));
      }
    } catch (e: any) {
      setBackupsErr(e?.message || String(e));
    } finally {
      setBackupsSettingsBusy(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    loadBackups().catch(() => {});
    loadBackupSettings().catch(() => {});
  }, [token, apiBase]);

  const resolveHealthOrigin = () => {
    const rawOrigin = String(publicStatus?.canonicalOrigin || publicStatus?.publicOrigin || "").trim();
    if (!rawOrigin) return "";
    try {
      const u = new URL(rawOrigin);
      const tunnelName = String(publicStatus?.tunnelName || "").trim();
      if (!tunnelName) return rawOrigin;
      const host = u.hostname.toLowerCase();
      const sub = `${tunnelName.toLowerCase()}.`;
      if (host.startsWith(sub)) return rawOrigin;
      const isRootDomain = host.split(".").length === 2;
      if (!isRootDomain) return rawOrigin;
      u.hostname = `${tunnelName}.${host}`;
      return u.origin;
    } catch {
      return rawOrigin;
    }
  };

  const checkTunnelHealth = async () => {
    const origin = resolveHealthOrigin();
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
            <div><b>Status</b>: {publicStatus?.status || "—"}</div>
            <div><b>Public origin</b>: {publicStatus?.canonicalOrigin || publicStatus?.publicOrigin || "—"}</div>
            <div><b>Health probe</b>: {resolveHealthOrigin() || "—"}</div>
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
            <div style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Named tunnels</div>
              {publicTunnelsErr ? (
                <div style={{ color: "#ffb4b4" }}>{publicTunnelsErr}</div>
              ) : publicTunnels.length === 0 ? (
                <div style={{ opacity: 0.7 }}>No named tunnels found.</div>
              ) : (
                <div style={{ display: "grid", gap: 4 }}>
                  {publicTunnels.map((t, idx) => (
                    <div key={`${t.id || t.name || idx}`} style={{ display: "flex", gap: 8 }}>
                      <div style={{ minWidth: 140 }}>{t.name || t.id || "unnamed"}</div>
                      <div style={{ opacity: 0.8 }}>{t.status || "—"}</div>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={loadPublicTunnels}
                disabled={publicTunnelsBusy}
                className={buttonClass}
                style={{ marginTop: 6 }}
              >
                {publicTunnelsBusy ? "Refreshing…" : "Refresh tunnels"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Backups (local)</div>
        {!token && <div style={{ opacity: 0.7 }}>Sign in to manage backups.</div>}
        {token && (
          <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
            <div><b>Backup directory</b>: {backupDir || "—"}</div>
            <div><b>Retention</b>: {backupRetentionDays ? `${backupRetentionDays} days` : "—"}</div>
            {backupsErr ? <div style={{ color: "#ffb4b4" }}>{backupsErr}</div> : null}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={backupsEnabled}
                  onChange={(e) => toggleBackups(e.target.checked)}
                  disabled={backupsSettingsBusy}
                />
                <span>Backups enabled</span>
              </label>
              {backupsSettingsBusy ? <span style={{ opacity: 0.6 }}>Saving…</span> : null}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={runBackup} disabled={backupRunBusy || !backupsEnabled} className={buttonClass}>
                {backupRunBusy ? "Running…" : "Run backup"}
              </button>
              <button onClick={loadBackups} disabled={backupsBusy} className={buttonClass}>
                {backupsBusy ? "Refreshing…" : "Refresh list"}
              </button>
            </div>
            {backups.length === 0 ? (
              <div style={{ opacity: 0.7 }}>No backups found yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 4 }}>
                {backups.map((b) => (
                  <div key={b.name} style={{ display: "flex", gap: 10 }}>
                    <div style={{ minWidth: 220 }}>{b.name}</div>
                    <div style={{ opacity: 0.8 }}>{fmtBytes(b.size)}</div>
                    <div style={{ opacity: 0.8 }}>{new Date(b.modifiedAt).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ opacity: 0.65, marginTop: 6 }}>
              Command line: <code>apps/api/src/scripts/backup_db.sh</code>
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
