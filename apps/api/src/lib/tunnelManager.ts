import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, execFile } from "node:child_process";
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
  quickConfigPath?: string | null;
  logger?: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
  healthIntervalMs?: number;
  healthFailureThreshold?: number;
  protocolPreference?: "auto" | "http2" | "quic";
  onProtocolSuggestion?: (protocol: "http2" | "quic") => void;
  resolveBinary?: (signal?: AbortSignal) => Promise<string>;
  readVersion?: (binPath: string, signal?: AbortSignal) => Promise<string | null>;
  spawnProcess?: typeof spawn;
  killProcess?: (pid: number, signal?: NodeJS.Signals | number) => void;
  stopTimeoutMs?: number;
  stopEscalationTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  execFileRunner?: ExecFileRunner;
  downloadSpec?: DownloadSpec;
};

type ExecFileRunner = (
  cmd: string,
  args: string[],
  options?: { signal?: AbortSignal; timeoutMs?: number }
) => Promise<{ stdout: string; stderr: string }>;

type DownloadSpec = {
  url: string;
  isTgz: boolean;
  binaryName: string;
};

function parseQuickTunnelUrl(text: string): string | null {
  const m = String(text || "").match(
    /Your quick Tunnel has been created![\s\S]{0,1024}?\b(https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com)\b/i
  );
  return m ? m[1] : null;
}

const execFileAsync: ExecFileRunner = (cmd, args, options = {}) => {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(cmd, args, { signal: options.signal, timeout: options.timeoutMs }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
};

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

async function maybeFetchChecksum(
  url: string,
  outerSignal?: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  const timeoutMs = Math.max(1, Number(process.env.CLOUDFLARED_CHECKSUM_TIMEOUT_MS || "15000"));
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
  if (outerSignal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: "GET", signal: controller.signal } as any);
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    if (!text) return null;
    // Accept formats like: "<sha256>  filename"
    const parts = text.split(/\s+/);
    const candidate = parts[0];
    if (/^[a-f0-9]{64}$/i.test(candidate)) return candidate.toLowerCase();
    return null;
  } catch (error: any) {
    if (controller.signal.aborted) {
      throw new Error(`cloudflared checksum request timed out after ${timeoutMs}ms`);
    }
    return null;
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
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

async function downloadCloudflared(
  destPath: string,
  logger?: TunnelManagerOptions["logger"],
  outerSignal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  execRunner: ExecFileRunner = execFileAsync,
  requestedSpec?: DownloadSpec
) {
  const spec = requestedSpec || pickDownloadSpec();
  if (!String(process.env.CLOUDFLARED_VERSION || "").trim()) {
    logger?.warn?.("CLOUDFLARED_VERSION not set; downloading latest cloudflared");
  }
  await ensureDir(path.dirname(destPath));

  const tmpFile = `${destPath}.download`;
  let installed = false;
  const timeoutMs = Math.max(1, Number(process.env.CLOUDFLARED_DOWNLOAD_TIMEOUT_MS || "120000"));
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
  if (outerSignal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(spec.url, { method: "GET", signal: controller.signal } as any);
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);

    await pipeline(res.body as any, fsSync.createWriteStream(tmpFile), { signal: controller.signal });

    const checksumUrl = `${spec.url}.sha256`;
    const expected = await maybeFetchChecksum(checksumUrl, controller.signal, fetchImpl);
    if (controller.signal.aborted) throw new Error("cloudflared download aborted");
    if (expected) {
      const actual = await sha256File(tmpFile);
      if (controller.signal.aborted) throw new Error("cloudflared download aborted");
      if (actual !== expected) {
        throw new Error("Downloaded cloudflared checksum mismatch");
      }
    } else {
      logger?.warn?.("cloudflared checksum not available; continuing without verification");
    }

    if (spec.isTgz) {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "contentbox-cloudflared-"));
      try {
        try {
          await execRunner("tar", ["-xzf", tmpFile, "-C", tmpDir], {
            signal: controller.signal,
            timeoutMs: Math.max(1, Number(process.env.CLOUDFLARED_EXTRACT_TIMEOUT_MS || "30000"))
          });
        } catch (e) {
          throw new Error("Failed to extract cloudflared archive (tar unavailable, cancelled, or timed out)");
        }
        const extracted = await findExtractedBinary(tmpDir, spec.binaryName);
        if (!extracted) throw new Error("Extracted cloudflared binary not found");
        if (controller.signal.aborted) throw new Error("cloudflared download aborted");
        await fs.copyFile(extracted, destPath);
        installed = true;
        await fs.unlink(tmpFile);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      }
    } else {
      if (controller.signal.aborted) throw new Error("cloudflared download aborted");
      await fs.rename(tmpFile, destPath).catch(async () => {
        await fs.copyFile(tmpFile, destPath);
        await fs.unlink(tmpFile).catch(() => {});
      });
      installed = true;
    }

    if (controller.signal.aborted) throw new Error("cloudflared download aborted");
    if (process.platform !== "win32") {
      await fs.chmod(destPath, 0o755);
    }
    if (controller.signal.aborted) throw new Error("cloudflared download aborted");

    logger?.info?.(`cloudflared installed at ${destPath}`);
  } catch (error: any) {
    await fs.unlink(tmpFile).catch(() => undefined);
    if (installed) await fs.unlink(destPath).catch(() => undefined);
    if (controller.signal.aborted) {
      throw new Error(`cloudflared download cancelled or timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}

async function resolveCloudflaredPath(
  binDir: string,
  logger?: TunnelManagerOptions["logger"],
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  execRunner: ExecFileRunner = execFileAsync,
  downloadSpec?: DownloadSpec
) {
  const envPath = String(process.env.CLOUDFLARED_PATH || "").trim();
  if (envPath && fsSync.existsSync(envPath)) return envPath;

  const managedName = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const managedPath = path.join(binDir, managedName);
  if (fsSync.existsSync(managedPath)) return managedPath;

  try {
    await execRunner("cloudflared", ["--version"], {
      signal,
      timeoutMs: Math.max(1, Number(process.env.CLOUDFLARED_VERSION_TIMEOUT_MS || "5000"))
    });
    return "cloudflared";
  } catch {
    // ignore
  }

  if (signal?.aborted) throw new Error("cloudflared preparation aborted");
  await downloadCloudflared(managedPath, logger, signal, fetchImpl, execRunner, downloadSpec);
  return managedPath;
}

async function readCloudflaredVersion(
  binPath: string,
  signal?: AbortSignal,
  execRunner: ExecFileRunner = execFileAsync
): Promise<string | null> {
  try {
    const { stdout } = await execRunner(binPath, ["--version"], {
      signal,
      timeoutMs: Math.max(1, Number(process.env.CLOUDFLARED_VERSION_TIMEOUT_MS || "5000"))
    });
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
  private activeMode: "quick" | "named" | null = null;
  private lastNamedInput: { publicOrigin: string; tunnelName: string; configPath?: string | null; token?: string | null } | null = null;
  private namedRestartInFlight = false;
  private namedRestartGeneration = 0;

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

  activeTransport(): "quick" | "named" | null {
    return this.activeMode;
  }

  setError(message: string) {
    this.state = { ...this.state, status: "ERROR", lastError: message };
  }

  invalidateNamedIntent() {
    this.namedRestartGeneration += 1;
    this.namedRestartInFlight = false;
    this.lastNamedInput = null;
  }

  private waitForOwnedChildExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null && child.exitCode !== undefined) return Promise.resolve(true);
    if (child.signalCode !== null && child.signalCode !== undefined) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (exited: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off("exit", onExit);
        child.off("close", onExit);
        resolve(exited);
      };
      const onExit = () => finish(true);
      child.once("exit", onExit);
      child.once("close", onExit);
      const timer = setTimeout(() => finish(false), Math.max(1, timeoutMs));
    });
  }

  private async terminateOwnedChild(): Promise<boolean> {
    const ownedChild = this.proc;
    if (!ownedChild?.pid) return true;
    if (
      (ownedChild.exitCode !== null && ownedChild.exitCode !== undefined) ||
      (ownedChild.signalCode !== null && ownedChild.signalCode !== undefined)
    ) {
      if (this.proc === ownedChild) this.proc = null;
      return true;
    }
    const exited = this.waitForOwnedChildExit(
      ownedChild,
      this.opts.stopTimeoutMs ?? Math.max(1, Number(process.env.CLOUDFLARED_STOP_TIMEOUT_MS || "5000"))
    );
    try {
      (this.opts.killProcess || process.kill)(ownedChild.pid);
    } catch {}
    let stopped = await exited;
    if (!stopped) {
      const forcedExit = this.waitForOwnedChildExit(
        ownedChild,
        this.opts.stopEscalationTimeoutMs ?? Math.max(1, Number(process.env.CLOUDFLARED_STOP_ESCALATION_TIMEOUT_MS || "1000"))
      );
      try {
        (this.opts.killProcess || process.kill)(ownedChild.pid, "SIGKILL");
      } catch {}
      stopped = await forcedExit;
    }
    if (stopped && this.proc === ownedChild) this.proc = null;
    return stopped;
  }

  async ensureBinary(signal?: AbortSignal): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const binPath = await (
        this.opts.resolveBinary?.(signal) ||
        resolveCloudflaredPath(
          this.opts.binDir,
          this.opts.logger,
          signal,
          this.opts.fetchImpl,
          this.opts.execFileRunner,
          this.opts.downloadSpec
        )
      );
      const version = await (
        this.opts.readVersion?.(binPath, signal) ||
        readCloudflaredVersion(binPath, signal, this.opts.execFileRunner)
      );
      if (signal?.aborted) throw new Error("cloudflared preparation aborted");
      this.state = {
        ...this.state,
        cloudflaredPath: binPath,
        cloudflaredVersion: version
      };
      return { ok: true };
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (!signal?.aborted) {
        this.state = { ...this.state, status: "ERROR", lastError: msg };
      }
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
    this.namedRestartGeneration += 1;
    this.namedRestartInFlight = false;
    this.clearHealthTimer();
    this.healthFailures = 0;
    const ownedPid = this.proc?.pid || null;
    const stopped = await this.terminateOwnedChild();
    if (stopped) {
      this.proc = null;
      this.activeMode = null;
    }
    this.state = {
      ...this.state,
      status: stopped ? "STOPPED" : "ERROR",
      publicOrigin: null,
      lastError: stopped ? null : "Timed out waiting for owned cloudflared process to exit",
      lastCheckedAt: null,
      startedAt: stopped ? null : this.state.startedAt,
      pid: stopped ? null : ownedPid
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
      binPath = await (
        this.opts.resolveBinary?.() ||
        resolveCloudflaredPath(
          this.opts.binDir,
          this.opts.logger,
          undefined,
          this.opts.fetchImpl,
          this.opts.execFileRunner,
          this.opts.downloadSpec
        )
      );
    } catch (e: any) {
      const msg = String(e?.message || e);
      this.state = { ...this.state, status: "ERROR", lastError: msg };
      return this.status();
    }

    this.state = {
      ...this.state,
      cloudflaredPath: binPath,
      cloudflaredVersion: await (
        this.opts.readVersion?.(binPath) || readCloudflaredVersion(binPath, undefined, this.opts.execFileRunner)
      ),
      lastError: null
    };

    const targetUrl = `http://127.0.0.1:${this.opts.targetPort}`;
    this.opts.logger?.info?.(`cloudflared path: ${binPath}`);
    this.opts.logger?.info?.(`quick tunnel target: ${targetUrl}`);

    const tryProtocol = async (protocol?: "quic" | "http2") => {
      const args = ["tunnel"];
      const quickConfigPath = String(this.opts.quickConfigPath || "").trim();
      if (quickConfigPath) args.push("--config", quickConfigPath);
      args.push("--url", targetUrl, "--no-autoupdate");
      if (protocol) args.push("--protocol", protocol);
      this.opts.logger?.info?.(`cloudflared args: ${args.join(" ")}`);
      const child = (this.opts.spawnProcess || spawn)(binPath, args, { stdio: ["ignore", "pipe", "pipe"] });
      this.proc = child;
      this.activeMode = "quick";
      this.state = { ...this.state, pid: child.pid || null, startedAt: new Date().toISOString() };

      const urlPromise = new Promise<string>((resolve, reject) => {
        let settled = false;
        let timeout: NodeJS.Timeout | null = null;
        let buffer = "";
        const settle = (callback: (value: any) => void, value: any) => {
          if (settled) return false;
          settled = true;
          if (timeout) clearTimeout(timeout);
          callback(value);
          return true;
        };
        const onData = (buf: Buffer) => {
          const txt = buf.toString("utf8");
          buffer = (buffer + txt).slice(-8000);
          const url = parseQuickTunnelUrl(buffer);
          if (url && settle(resolve, url)) {
            this.opts.logger?.info?.(`quick tunnel URL: ${url}`);
          }
        };

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        child.on("error", (err) => {
          if (settle(reject, err)) {
            this.opts.logger?.error?.(`cloudflared error: ${err?.message || err}`);
          }
        });

        child.on("exit", () => {
          if (settle(reject, new Error("cloudflared exited before URL was assigned"))) {
            this.opts.logger?.error?.("cloudflared exited before URL was assigned");
          }
        });

        timeout = setTimeout(() => {
          if (settle(reject, new Error("Timed out waiting for cloudflared quick tunnel URL"))) {
            this.opts.logger?.error?.("Timed out waiting for cloudflared quick tunnel URL");
          }
        }, 20000);
      });

      let publicOrigin: string;
      try {
        publicOrigin = await urlPromise;
      } catch (e: any) {
        this.state = { ...this.state, status: "ERROR", lastError: String(e?.message || e) };
        try {
          if (child.pid) (this.opts.killProcess || process.kill)(child.pid);
        } catch {}
        this.proc = null;
        this.activeMode = null;
        return { ok: false, error: String(e?.message || e) } as const;
      }

      // Mark active as soon as we have a URL; health checks will confirm or flip to ERROR later.
      this.healthFailures = 0;
      this.state = { ...this.state, status: "ACTIVE", publicOrigin, lastError: null };
      this.startHealthChecks();

      child.on("exit", () => {
        if (this.stopping) return;
        this.proc = null;
        this.activeMode = null;
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
    this.lastNamedInput = { ...input };
    this.namedRestartGeneration += 1;

    let binPath: string;
    try {
      binPath = await (
        this.opts.resolveBinary?.() ||
        resolveCloudflaredPath(
          this.opts.binDir,
          this.opts.logger,
          undefined,
          this.opts.fetchImpl,
          this.opts.execFileRunner,
          this.opts.downloadSpec
        )
      );
    } catch (e: any) {
      const msg = String(e?.message || e);
      this.state = { ...this.state, status: "ERROR", lastError: msg };
      return this.status();
    }

    this.state = {
      ...this.state,
      cloudflaredPath: binPath,
      cloudflaredVersion: await (
        this.opts.readVersion?.(binPath) || readCloudflaredVersion(binPath, undefined, this.opts.execFileRunner)
      ),
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

    const child = (this.opts.spawnProcess || spawn)(binPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    this.proc = child;
    this.activeMode = "named";
    this.state = { ...this.state, pid: child.pid || null, startedAt: new Date().toISOString() };

    child.on("exit", () => {
      if (this.stopping || this.proc !== child) return;
      this.proc = null;
      this.activeMode = null;
      this.state = { ...this.state, status: "ERROR", publicOrigin: null, lastError: "cloudflared exited" };
      this.clearHealthTimer();
    });

    const healthOk = await this.verifyWithRetries(input.publicOrigin, 12, 2000);
    if (!healthOk) {
      this.opts.logger?.warn?.("Named tunnel launched but initial public-origin verification is pending");
      this.healthFailures = 0;
      this.state = {
        ...this.state,
        status: "STARTING",
        publicOrigin: input.publicOrigin,
        lastError: "Public link pending verification"
      };
      this.startHealthChecks();
      return this.status();
    }

    this.healthFailures = 0;
    this.state = { ...this.state, status: "ACTIVE", publicOrigin: input.publicOrigin, lastError: null };
    this.startHealthChecks();

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
      const restartGeneration = this.namedRestartGeneration;
      this.healthInFlight = true;
      try {
        const ok = await this.verify(this.state.publicOrigin);
        if (
          restartGeneration !== this.namedRestartGeneration ||
          this.stopping
        ) return;
        if (ok) {
          this.healthFailures = 0;
          if (this.state.status !== "ACTIVE") {
            this.state = { ...this.state, status: "ACTIVE", lastError: null };
          }
        } else {
          this.healthFailures += 1;
          if (this.healthFailures >= (this.opts.healthFailureThreshold || 2)) {
            if (this.activeMode === "named") {
              // Named tunnels can appear "stuck starting" when cloudflared is alive but detached.
              // Recycle the process and relaunch with last known input to self-heal.
              this.state = {
                ...this.state,
                status: "STARTING",
                lastError: "Public link health check failed; retrying"
              };
              this.healthFailures = 0;
              if (!this.namedRestartInFlight && this.lastNamedInput) {
                this.namedRestartInFlight = true;
                const restartInput = { ...this.lastNamedInput };
                (async () => {
                  try {
                    const stopped = await this.terminateOwnedChild();
                    this.activeMode = null;
                    if (!stopped) {
                      this.state = {
                        ...this.state,
                        status: "ERROR",
                        lastError: "Timed out waiting for owned cloudflared process to exit"
                      };
                      return;
                    }
                    if (
                      restartGeneration !== this.namedRestartGeneration ||
                      this.stopping
                    ) return;
                    this.state = { ...this.state, status: "STOPPED", pid: null };
                    await this.startNamed(restartInput);
                  } catch (e: any) {
                    this.state = {
                      ...this.state,
                      status: "ERROR",
                      lastError: String(e?.message || e || "named tunnel restart failed")
                    };
                  } finally {
                    this.namedRestartInFlight = false;
                  }
                })();
              }
            } else {
              this.state = { ...this.state, status: "ERROR", lastError: "Public link health check failed" };
              try {
                if (this.proc?.pid) (this.opts.killProcess || process.kill)(this.proc.pid);
              } catch {}
              this.proc = null;
              this.activeMode = null;
              this.clearHealthTimer();
            }
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
