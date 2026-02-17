import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, spawnSync, execFile } from "node:child_process";
import { pipeline } from "node:stream/promises";

export type TunnelStatus = "STOPPED" | "STARTING" | "ACTIVE" | "ERROR";

export type TunnelState = {
  status: TunnelStatus;
  publicOrigin: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  startedAt: string | null;
  pid: number | null;
  cloudflaredPath: string | null;
  cloudflaredVersion: string | null;
};

type TunnelManagerOptions = {
  targetPort: number;
  pingPath?: string;
  binDir: string;
  logger?: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
  healthIntervalMs?: number;
  healthFailureThreshold?: number;
  protocolPreference?: "auto" | "http2" | "quic";
  onProtocolSuggestion?: (protocol: "http2" | "quic") => void;
};

type DownloadSpec = {
  url: string;
  isTgz: boolean;
  binaryName: string;
};

function parseQuickTunnelUrl(text: string): string | null {
  const m = String(text || "").match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  return m ? m[0] : null;
}

function execFileAsync(cmd: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal } as any);
  } finally {
    clearTimeout(timer);
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = fsSync.createReadStream(filePath);
  return await new Promise((resolve, reject) => {
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function maybeFetchChecksum(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "GET" } as any);
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    if (!text) return null;
    // Accept formats like: "<sha256>  filename"
    const parts = text.split(/\s+/);
    const candidate = parts[0];
    if (/^[a-f0-9]{64}$/i.test(candidate)) return candidate.toLowerCase();
    return null;
  } catch {
    return null;
  }
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function findExtractedBinary(dir: string, name: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isFile() && ent.name === name) return full;
    if (ent.isDirectory()) {
      const found = await findExtractedBinary(full, name);
      if (found) return found;
    }
  }
  return null;
}

function pickDownloadSpec(): DownloadSpec {
  const platform = process.platform;
  const arch = process.arch;
  const version = String(process.env.CLOUDFLARED_VERSION || "latest").trim() || "latest";
  const base =
    version === "latest"
      ? "https://github.com/cloudflare/cloudflared/releases/latest/download"
      : `https://github.com/cloudflare/cloudflared/releases/download/${version}`;

  if (platform === "linux") {
    if (arch === "x64") return { url: `${base}/cloudflared-linux-amd64`, isTgz: false, binaryName: "cloudflared" };
    if (arch === "arm64") return { url: `${base}/cloudflared-linux-arm64`, isTgz: false, binaryName: "cloudflared" };
  }

  if (platform === "darwin") {
    if (arch === "x64") return { url: `${base}/cloudflared-darwin-amd64.tgz`, isTgz: true, binaryName: "cloudflared" };
    if (arch === "arm64") return { url: `${base}/cloudflared-darwin-arm64.tgz`, isTgz: true, binaryName: "cloudflared" };
  }

  if (platform === "win32") {
    if (arch === "x64") return { url: `${base}/cloudflared-windows-amd64.exe`, isTgz: false, binaryName: "cloudflared.exe" };
    if (arch === "arm64") return { url: `${base}/cloudflared-windows-arm64.exe`, isTgz: false, binaryName: "cloudflared.exe" };
  }

  throw new Error(`Unsupported platform/arch for cloudflared: ${platform}/${arch}`);
}

async function downloadCloudflared(destPath: string, logger?: TunnelManagerOptions["logger"]) {
  const spec = pickDownloadSpec();
  if (!String(process.env.CLOUDFLARED_VERSION || "").trim()) {
    logger?.warn?.("CLOUDFLARED_VERSION not set; downloading latest cloudflared");
  }
  await ensureDir(path.dirname(destPath));

  const tmpFile = `${destPath}.download`;
  const res = await fetch(spec.url, { method: "GET" } as any);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);

  await pipeline(res.body as any, fsSync.createWriteStream(tmpFile));

  const checksumUrl = `${spec.url}.sha256`;
  const expected = await maybeFetchChecksum(checksumUrl);
  if (expected) {
    const actual = await sha256File(tmpFile);
    if (actual !== expected) {
      throw new Error("Downloaded cloudflared checksum mismatch");
    }
  } else {
    logger?.warn?.("cloudflared checksum not available; continuing without verification");
  }

  if (spec.isTgz) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "contentbox-cloudflared-"));
    try {
      await execFileAsync("tar", ["-xzf", tmpFile, "-C", tmpDir]);
    } catch (e) {
      throw new Error("Failed to extract cloudflared archive (tar not available?)");
    }
    const extracted = await findExtractedBinary(tmpDir, spec.binaryName);
    if (!extracted) throw new Error("Extracted cloudflared binary not found");
    await fs.copyFile(extracted, destPath);
  } else {
    await fs.rename(tmpFile, destPath).catch(async () => {
      await fs.copyFile(tmpFile, destPath);
      await fs.unlink(tmpFile).catch(() => {});
    });
  }

  if (process.platform !== "win32") {
    await fs.chmod(destPath, 0o755);
  }

  logger?.info?.(`cloudflared installed at ${destPath}`);
}

async function resolveCloudflaredPath(binDir: string, logger?: TunnelManagerOptions["logger"]) {
  const envPath = String(process.env.CLOUDFLARED_PATH || "").trim();
  if (envPath && fsSync.existsSync(envPath)) return envPath;

  const managedName = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const managedPath = path.join(binDir, managedName);
  if (fsSync.existsSync(managedPath)) return managedPath;

  try {
    const res = spawnSync("cloudflared", ["--version"], { stdio: "ignore" });
    if (res.status === 0) return "cloudflared";
  } catch {
    // ignore
  }

  await downloadCloudflared(managedPath, logger);
  return managedPath;
}

async function readCloudflaredVersion(binPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binPath, ["--version"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export class TunnelManager {
  private opts: TunnelManagerOptions;
  private proc: ReturnType<typeof spawn> | null = null;
  private state: TunnelState;
  private startPromise: Promise<TunnelState> | null = null;
  private stopping = false;
  private healthTimer: NodeJS.Timeout | null = null;
  private healthInFlight = false;
  private healthFailures = 0;

  constructor(opts: TunnelManagerOptions) {
    this.opts = {
      ...opts,
      pingPath: opts.pingPath || "/public/ping",
      healthIntervalMs: opts.healthIntervalMs || 60_000,
      healthFailureThreshold: opts.healthFailureThreshold || 2,
      protocolPreference: opts.protocolPreference || "auto"
    };
    this.state = {
      status: "STOPPED",
      publicOrigin: null,
      lastError: null,
      lastCheckedAt: null,
      startedAt: null,
      pid: null,
      cloudflaredPath: null,
      cloudflaredVersion: null
    };
  }

  status(): TunnelState {
    return { ...this.state };
  }

  setError(message: string) {
    this.state = { ...this.state, status: "ERROR", lastError: message };
  }

  async ensureBinary(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const binPath = await resolveCloudflaredPath(this.opts.binDir, this.opts.logger);
      this.state = {
        ...this.state,
        cloudflaredPath: binPath,
        cloudflaredVersion: await readCloudflaredVersion(binPath)
      };
      return { ok: true };
    } catch (e: any) {
      const msg = String(e?.message || e);
      this.state = { ...this.state, status: "ERROR", lastError: msg };
      return { ok: false, error: msg };
    }
  }

  async start(): Promise<TunnelState> {
    return this.startQuick();
  }

  async startQuick(): Promise<TunnelState> {
    if (this.state.status === "ACTIVE") return this.status();
    if (this.state.status === "STARTING") return this.status();
    if (this.proc?.pid && !this.stopping) return this.status();
    if (this.startPromise) return this.startPromise;

    this.opts.logger?.info?.("Starting quick tunnel");
    this.startPromise = this._startQuick();
    try {
      const res = await this.startPromise;
      return res;
    } finally {
      this.startPromise = null;
    }
  }

  async stop(): Promise<TunnelState> {
    this.stopping = true;
    this.clearHealthTimer();
    this.healthFailures = 0;
    if (this.proc?.pid) {
      try {
        process.kill(this.proc.pid);
      } catch {}
    }
    this.proc = null;
    this.state = {
      ...this.state,
      status: "STOPPED",
      publicOrigin: null,
      lastError: null,
      lastCheckedAt: null,
      startedAt: null,
      pid: null
    };
    this.stopping = false;
    return this.status();
  }

  private async _startQuick(): Promise<TunnelState> {
    if (this.proc?.pid && !this.stopping) {
      this.opts.logger?.warn?.("Quick tunnel already running; skipping spawn");
      return this.status();
    }
    this.state = { ...this.state, status: "STARTING", lastError: null };

    let binPath: string;
    try {
      binPath = await resolveCloudflaredPath(this.opts.binDir, this.opts.logger);
    } catch (e: any) {
      const msg = String(e?.message || e);
      this.state = { ...this.state, status: "ERROR", lastError: msg };
      return this.status();
    }

    this.state = {
      ...this.state,
      cloudflaredPath: binPath,
      cloudflaredVersion: await readCloudflaredVersion(binPath),
      lastError: null
    };

    const targetUrl = `http://127.0.0.1:${this.opts.targetPort}`;
    this.opts.logger?.info?.(`cloudflared path: ${binPath}`);
    this.opts.logger?.info?.(`quick tunnel target: ${targetUrl}`);

    const tryProtocol = async (protocol?: "quic" | "http2") => {
      const args = ["tunnel", "--url", targetUrl, "--no-autoupdate"];
      if (protocol) args.push("--protocol", protocol);
      this.opts.logger?.info?.(`cloudflared args: ${args.join(" ")}`);
      const child = spawn(binPath, args, { stdio: ["ignore", "pipe", "pipe"] });
      this.proc = child;
      this.state = { ...this.state, pid: child.pid || null, startedAt: new Date().toISOString() };

      const urlPromise = new Promise<string>((resolve, reject) => {
        let resolved = false;
        let buffer = "";
        const onData = (buf: Buffer) => {
          const txt = buf.toString("utf8");
          buffer = (buffer + txt).slice(-8000);
          const url = parseQuickTunnelUrl(buffer);
          if (url && !resolved) {
            resolved = true;
            this.opts.logger?.info?.(`quick tunnel URL: ${url}`);
            resolve(url);
          }
        };

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        child.on("error", (err) => {
          if (!resolved) {
            resolved = true;
            this.opts.logger?.error?.(`cloudflared error: ${err?.message || err}`);
            reject(err);
          }
        });

        child.on("exit", () => {
          if (!resolved) {
            resolved = true;
            this.opts.logger?.error?.("cloudflared exited before URL was assigned");
            reject(new Error("cloudflared exited before URL was assigned"));
          }
        });

        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this.opts.logger?.error?.("Timed out waiting for cloudflared quick tunnel URL");
            reject(new Error("Timed out waiting for cloudflared quick tunnel URL"));
          }
        }, 20000);
      });

      let publicOrigin: string;
      try {
        publicOrigin = await urlPromise;
      } catch (e: any) {
        this.state = { ...this.state, status: "ERROR", lastError: String(e?.message || e) };
        try {
          if (child.pid) process.kill(child.pid);
        } catch {}
        this.proc = null;
        return { ok: false, error: String(e?.message || e) } as const;
      }

      // Mark active as soon as we have a URL; health checks will confirm or flip to ERROR later.
      this.healthFailures = 0;
      this.state = { ...this.state, status: "ACTIVE", publicOrigin, lastError: null };
      this.startHealthChecks();

      child.on("exit", () => {
        if (this.stopping) return;
        this.proc = null;
        this.opts.logger?.error?.("cloudflared exited");
        this.state = { ...this.state, status: "ERROR", publicOrigin: null, lastError: "cloudflared exited" };
        this.clearHealthTimer();
      });

      return { ok: true } as const;
    };

    const pref = this.opts.protocolPreference || "auto";
    if (pref === "http2") {
      const only = await tryProtocol("http2");
      if (only.ok) return this.status();
      this.state = { ...this.state, status: "ERROR", lastError: only.error || "Public link health check failed" };
      return this.status();
    }
    if (pref === "quic") {
      const only = await tryProtocol("quic");
      if (only.ok) return this.status();
      this.state = { ...this.state, status: "ERROR", lastError: only.error || "Public link health check failed" };
      return this.status();
    }

    // auto: try QUIC first, then HTTP/2, and remember if HTTP/2 succeeds
    const first = await tryProtocol("quic");
    if (first.ok) return this.status();

    this.opts.logger?.warn?.("Quick tunnel health failed with QUIC; retrying with HTTP/2");
    const second = await tryProtocol("http2");
    if (second.ok) {
      this.opts.onProtocolSuggestion?.("http2");
      return this.status();
    }

    this.state = { ...this.state, status: "ERROR", lastError: second.error || first.error || "Public link health check failed" };
    return this.status();
  }

  async startNamed(input: {
    publicOrigin: string;
    tunnelName: string;
    configPath?: string | null;
    token?: string | null;
  }): Promise<TunnelState> {
    if (this.state.status === "ACTIVE") return this.status();
    if (this.state.status === "STARTING") return this.status();
    if (this.proc?.pid && !this.stopping) return this.status();
    if (this.startPromise) return this.startPromise;

    this.opts.logger?.info?.("Starting named tunnel");
    this.startPromise = this._startNamed(input);
    try {
      const res = await this.startPromise;
      return res;
    } finally {
      this.startPromise = null;
    }
  }

  private async _startNamed(input: {
    publicOrigin: string;
    tunnelName: string;
    configPath?: string | null;
    token?: string | null;
  }): Promise<TunnelState> {
    if (this.proc?.pid && !this.stopping) {
      this.opts.logger?.warn?.("Named tunnel already running; skipping spawn");
      return this.status();
    }
    this.state = { ...this.state, status: "STARTING", lastError: null };

    let binPath: string;
    try {
      binPath = await resolveCloudflaredPath(this.opts.binDir, this.opts.logger);
    } catch (e: any) {
      const msg = String(e?.message || e);
      this.state = { ...this.state, status: "ERROR", lastError: msg };
      return this.status();
    }

    this.state = {
      ...this.state,
      cloudflaredPath: binPath,
      cloudflaredVersion: await readCloudflaredVersion(binPath),
      lastError: null
    };

    this.opts.logger?.info?.(`cloudflared path: ${binPath}`);
    const args = ["tunnel", "run"];
    const token = String(input.token || "").trim();
    if (token) {
      const targetUrl = `http://127.0.0.1:${this.opts.targetPort}`;
      args.push("--token", token, "--url", targetUrl);
    } else {
      if (input.configPath) args.push("--config", input.configPath);
      args.push(input.tunnelName);
    }
    this.opts.logger?.info?.(`cloudflared args: ${args.join(" ")}`);

    const child = spawn(binPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    this.proc = child;
    this.state = { ...this.state, pid: child.pid || null, startedAt: new Date().toISOString() };

    const healthOk = await this.verifyWithRetries(input.publicOrigin, 6, 1500);
    if (!healthOk) {
      this.state = { ...this.state, status: "ERROR", lastError: "Public link health check failed" };
      try {
        if (child.pid) process.kill(child.pid);
      } catch {}
      this.proc = null;
      return this.status();
    }

    this.healthFailures = 0;
    this.state = { ...this.state, status: "ACTIVE", publicOrigin: input.publicOrigin, lastError: null };
    this.startHealthChecks();

    child.on("exit", () => {
      if (this.stopping) return;
      this.proc = null;
      this.state = { ...this.state, status: "ERROR", publicOrigin: null, lastError: "cloudflared exited" };
      this.clearHealthTimer();
    });

    return this.status();
  }

  private async verify(publicOrigin: string): Promise<boolean> {
    const url = `${publicOrigin.replace(/\/$/, "")}${this.opts.pingPath}`;
    try {
      const res = await fetchWithTimeout(url, { method: "GET" } as any, 5000);
      this.state = { ...this.state, lastCheckedAt: new Date().toISOString() };
      if (!res.ok) return false;
      return true;
    } catch {
      this.state = { ...this.state, lastCheckedAt: new Date().toISOString() };
      return false;
    }
  }

  private async verifyWithRetries(publicOrigin: string, attempts: number, delayMs: number): Promise<boolean> {
    for (let i = 0; i < attempts; i += 1) {
      const ok = await this.verify(publicOrigin);
      if (ok) return true;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    return false;
  }

  private startHealthChecks() {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(async () => {
      if (this.healthInFlight) return;
      if ((this.state.status !== "ACTIVE" && this.state.status !== "STARTING") || !this.state.publicOrigin) return;
      this.healthInFlight = true;
      try {
        const ok = await this.verify(this.state.publicOrigin);
        if (ok) {
          this.healthFailures = 0;
          if (this.state.status !== "ACTIVE") {
            this.state = { ...this.state, status: "ACTIVE", lastError: null };
          }
        } else {
          this.healthFailures += 1;
          if (this.healthFailures >= (this.opts.healthFailureThreshold || 2)) {
            this.state = { ...this.state, status: "ERROR", lastError: "Public link health check failed" };
            try {
              if (this.proc?.pid) process.kill(this.proc.pid);
            } catch {}
            this.proc = null;
            this.clearHealthTimer();
          }
        }
      } finally {
        this.healthInFlight = false;
      }
    }, this.opts.healthIntervalMs);
  }

  private clearHealthTimer() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }
}
