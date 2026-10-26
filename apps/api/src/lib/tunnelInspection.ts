import { execFile } from "node:child_process";
import type { CloudflaredServiceRecord } from "./cloudflaredServiceInspection.js";

// No shell, no inherited console and no command lines in errors: a tunnel
// command line may contain a connector credential.
export function runInspectionCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
  timeoutMs = Math.min(10_000, Math.max(1, Number.isFinite(timeoutMs) ? timeoutMs : 10_000));
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024,
      timeout: timeoutMs, killSignal: "SIGKILL"
    }, (error, stdout) => {
      clearTimeout(timer);
      if (error) reject(Object.assign(new Error("Tunnel inspection unavailable"), { code: error.code }));
      else resolve(stdout);
    });
    // Explicitly terminate the directly launched process, including PowerShell
    // on Windows. This does not claim termination of arbitrary descendants.
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* The child may already have exited. */ }
      reject(Object.assign(new Error("Tunnel inspection timed out"), { code: "INSPECTION_TIMEOUT" }));
    }, timeoutMs);
  });
}

type RunCommand = typeof runInspectionCommand;
export async function inspectWindowsCloudflared(timeoutMs: number, run: RunCommand = runInspectionCommand) {
  timeoutMs = Math.min(10_000, Math.max(1, Number.isFinite(timeoutMs) ? timeoutMs : 10_000));
  const script = `$ErrorActionPreference = 'Stop';
    try {
      $services = @(Get-CimInstance Win32_Service -Filter "Name LIKE '%cloudflared%' OR PathName LIKE '%cloudflared%'");
      $processes = @(Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'");
    } catch {
      $services = @(Get-WmiObject Win32_Service -Filter "Name LIKE '%cloudflared%' OR PathName LIKE '%cloudflared%'");
      $processes = @(Get-WmiObject Win32_Process -Filter "Name='cloudflared.exe'");
    }
    @{ services = @($services | Select-Object Name,State,ProcessId,PathName);
       processes = @($processes | Select-Object ProcessId,CommandLine) } | ConvertTo-Json -Depth 4 -Compress`;
  const deadline = Date.now() + timeoutMs;
  for (const command of ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "powershell.exe", "powershell"]) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Tunnel inspection timed out");
    try {
      const output = await run(command, ["-NoProfile", "-NonInteractive", "-Command", script], remaining);
      const data = JSON.parse(output.replace(/^\uFEFF/, ""));
      if (!Array.isArray(data?.services) || !Array.isArray(data?.processes)) throw new Error("Incomplete tunnel inspection");
      const pid = (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
      const services: CloudflaredServiceRecord[] = data.services.map((row: any) => {
        if (!row.Name || !["Running", "Stopped"].includes(row.State) || typeof row.PathName !== "string") throw new Error("Incomplete service inspection");
        return { platform: "win32", name: row.Name,
          state: row.State === "Running" ? "running" : row.State === "Stopped" ? "stopped" : "unknown",
          pid: pid(row.ProcessId), commandLine: row.PathName };
      });
      const processes: Array<{ pid: number; commandLine: string }> = data.processes.map((row: any) => {
        if (!pid(row.ProcessId)) throw new Error("Incomplete process inspection");
        // Non-admin Core cannot always read a SYSTEM process's command line.
        // Keep the service inventory and the process PID; do not invent ownership.
        const service = services.find((entry) => entry.pid === pid(row.ProcessId));
        return { pid: pid(row.ProcessId)!, commandLine: String(row.CommandLine || service?.commandLine || "") };
      });
      return { services, processes };
    } catch (error: any) {
      // An empty successful inventory is authoritative; do not run repeated
      // fallback queries. Only a missing executable tries the next location.
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error("PowerShell unavailable");
}

export class TunnelInspectionCache<T> {
  private cached: { value: T; at: number } | null = null;
  private inFlight: Promise<T | null> | null = null;
  private retryAfter = 0;
  private epoch = 0;
  constructor(private inspect: () => Promise<T>, private options: {
    freshMs: number; staleMs: number; failureBackoffMs: number; now?: () => number;
  }) {
    const bounded = (value: number, fallback: number, max: number) => Math.min(max, Math.max(1, Number.isFinite(value) ? value : fallback));
    this.options = { ...options, freshMs: bounded(options.freshMs, 30_000, 30_000),
      staleMs: bounded(options.staleMs, 120_000, 120_000),
      failureBackoffMs: bounded(options.failureBackoffMs, 5_000, 30_000) };
  }
  private now() { return this.options.now?.() ?? Date.now(); }
  invalidate() { this.epoch++; this.cached = null; this.retryAfter = 0; }
  read(forceRefresh = false): T | null {
    const age = this.cached ? this.now() - this.cached.at : Infinity;
    if (forceRefresh || age >= this.options.freshMs) void this.refresh();
    return this.cached && age < this.options.staleMs ? this.cached.value : null;
  }
  // Control-plane callers await this, never the stale display cache. Failed or
  // invalidated inspection is unknown even if a display snapshot still exists.
  refresh(): Promise<T | null> {
    if (this.inFlight) return this.inFlight;
    if (this.now() < this.retryAfter) return Promise.resolve(null);
    const epoch = this.epoch;
    this.inFlight = Promise.resolve().then(this.inspect).then(value => {
      if (epoch !== this.epoch) return null;
      this.cached = { value, at: this.now() };
      this.retryAfter = 0;
      return value;
    }).catch(() => {
      if (epoch === this.epoch) this.retryAfter = this.now() + this.options.failureBackoffMs;
      return null;
    }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
}

export function tunnelStartBlocker(inspection: { inspectionAvailable: boolean; externalProcessRunning: boolean }) {
  if (!inspection.inspectionAvailable) return { ok: false as const, code: "tunnel_inspection_unavailable",
    message: "Tunnel ownership could not be checked. Retry after inspection is available; no connector was started." };
  if (inspection.externalProcessRunning) return { ok: false as const, code: "external_tunnel_running",
    message: "An externally managed connector is running. Certifyd will not start a duplicate or stop the external connector." };
  return { ok: true as const };
}
