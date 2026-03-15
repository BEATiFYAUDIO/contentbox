import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { resolveContentboxRoot } from "../lib/contentboxRoot.js";

type RuntimeStatus = "running" | "stopped" | "degraded";
type RuntimeReason =
  | "normal_start"
  | "manual_restart"
  | "crash_restart"
  | "startup_probe_timeout"
  | "health_probe_failed"
  | "startup_failure"
  | "uncaught_exception"
  | "unhandled_rejection"
  | "port_bind_failed"
  | `api_exit_code_${number}`;

const CONTENTBOX_ROOT = resolveContentboxRoot();
const STATE_DIR = path.join(CONTENTBOX_ROOT, "state");
const LOG_DIR = path.join(CONTENTBOX_ROOT, "logs");
const HEALTH_FILE = path.join(STATE_DIR, "health.json");
const RUNTIME_LOG_FILE = path.join(LOG_DIR, "runtime.log");
const STARTED_AT = new Date().toISOString();
const MAX_RESTARTS_PER_HOUR = 30;
const RESTART_WINDOW_MS = 60 * 60 * 1000;
const RESTART_BACKOFF_MS = 2500;
const READY_PROBE_TIMEOUT_MS = 1000;
const READY_PROBE_MAX_WAIT_MS = 15000;
const NPM_CMD = process.platform === "win32" ? "npm.cmd" : "npm";
const API_PORT = Number(process.env.PORT || 4000);
const API_HEALTH_URL = `http://127.0.0.1:${API_PORT}/api/health`;

let child: ChildProcess | null = null;
let shuttingDown = false;
let restartTimestamps: number[] = [];
let pendingExitReason: RuntimeReason | null = null;
let apiReadyObserved = false;

fs.mkdirSync(STATE_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

const runtimeLog = fs.createWriteStream(RUNTIME_LOG_FILE, { flags: "a" });

function log(message: string, meta?: Record<string, unknown>) {
  const line = `[${new Date().toISOString()}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}\n`;
  runtimeLog.write(line);
}

function readHealth(): any {
  try {
    if (!fs.existsSync(HEALTH_FILE)) return {};
    return JSON.parse(fs.readFileSync(HEALTH_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeHealth(runtime: {
  status: RuntimeStatus;
  apiReady: boolean;
  reason: RuntimeReason;
  lastRestartAt?: string | null;
  incrementRestartCount?: boolean;
  pid?: number | null;
}) {
  const prev = readHealth();
  const now = new Date();
  const prevRestartAt = Date.parse(String(prev?.runtime?.lastRestartAt || ""));
  const within24h = Number.isFinite(prevRestartAt) && now.getTime() - prevRestartAt < 24 * 60 * 60 * 1000;
  const restartCountBase = within24h ? Number(prev?.runtime?.restartCount24h || 0) : 0;
  const next = {
    ...prev,
    runtime: {
      status: runtime.status,
      apiReady: runtime.apiReady,
      startedAt: prev?.runtime?.startedAt || STARTED_AT,
      lastRestartAt: runtime.lastRestartAt ?? prev?.runtime?.lastRestartAt ?? null,
      restartCount24h: runtime.incrementRestartCount ? restartCountBase + 1 : restartCountBase,
      pid: runtime.pid ?? null,
      reason: runtime.reason
    }
  };
  const tmp = `${HEALTH_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, HEALTH_FILE);
}

async function probeApiReadyOnce(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READY_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(API_HEALTH_URL, { method: "GET", signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", (err: any) => {
      if (err?.code === "EADDRINUSE") return resolve(false);
      resolve(false);
    });
    srv.once("listening", () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, "0.0.0.0");
  });
}

async function waitForApiReady(): Promise<boolean> {
  const started = Date.now();
  while (!shuttingDown && Date.now() - started < READY_PROBE_MAX_WAIT_MS) {
    if (!child || child.exitCode !== null) return false;
    const ok = await probeApiReadyOnce();
    if (ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

function canRestart() {
  const now = Date.now();
  restartTimestamps = restartTimestamps.filter((ts) => now - ts < RESTART_WINDOW_MS);
  return restartTimestamps.length < MAX_RESTARTS_PER_HOUR;
}

async function launch(reason: RuntimeReason) {
  if (shuttingDown) return;
  pendingExitReason = null;
  apiReadyObserved = false;
  const nowIso = new Date().toISOString();
  writeHealth({
    status: "degraded",
    apiReady: false,
    reason,
    lastRestartAt: reason === "normal_start" ? null : nowIso,
    incrementRestartCount: reason !== "normal_start"
  });

  const portFree = await isPortAvailable(API_PORT);
  if (!portFree) {
    log("port_conflict_detected", { reason: "port_bind_failed", port: API_PORT });
    writeHealth({
      status: "stopped",
      apiReady: false,
      reason: "port_bind_failed",
      pid: null
    });
    return;
  }

  log("launch_api", { reason });
  const next = spawn(NPM_CMD, ["run", "start:api"], {
    cwd: path.resolve(process.cwd()),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CERTIFYD_SUPERVISOR_ACTIVE: "1" }
  });
  child = next;

  next.stdout?.on("data", (chunk) => runtimeLog.write(chunk));
  next.stderr?.on("data", (chunk) => runtimeLog.write(chunk));

  writeHealth({
    status: "degraded",
    apiReady: false,
    reason,
    pid: next.pid ?? null
  });

  void (async () => {
    const ready = await waitForApiReady();
    if (!ready || shuttingDown || !child || child.pid !== next.pid || next.exitCode !== null) {
      if (!shuttingDown && next.exitCode === null && child?.pid === next.pid) {
        pendingExitReason = "startup_probe_timeout";
        log("startup_probe_timeout", { reason: pendingExitReason, pid: next.pid ?? null, probeUrl: API_HEALTH_URL });
        writeHealth({
          status: "degraded",
          apiReady: false,
          reason: "startup_probe_timeout",
          pid: next.pid ?? null
        });
        next.kill("SIGTERM");
      }
      return;
    }
    apiReadyObserved = true;
    log("api_ready", { reason, pid: next.pid ?? null });
    writeHealth({
      status: "running",
      apiReady: true,
      reason,
      pid: next.pid ?? null
    });
  })();

  next.on("exit", (code, signal) => {
    const exitCode = Number.isFinite(Number(code)) ? Number(code) : 0;
    const exitReason =
      pendingExitReason || (!apiReadyObserved ? "startup_failure" : (`api_exit_code_${exitCode}` as RuntimeReason));
    log("api_exit", { code: exitCode, signal, reason: exitReason, pid: next.pid ?? null });
    pendingExitReason = null;
    writeHealth({
      status: shuttingDown ? "stopped" : "degraded",
      apiReady: false,
      reason: exitReason,
      pid: null
    });
    if (shuttingDown) return;
    if (!canRestart()) {
      log("restart_limit_reached", { maxPerHour: MAX_RESTARTS_PER_HOUR, reason: exitReason });
      return;
    }
    restartTimestamps.push(Date.now());
    log("restart_scheduled", { reason: "crash_restart", inMs: RESTART_BACKOFF_MS, pid: next.pid ?? null });
    setTimeout(() => {
      void launch("crash_restart");
    }, RESTART_BACKOFF_MS);
  });
}

function shutdown(signal: NodeJS.Signals) {
  shuttingDown = true;
  log("shutdown", { signal });
  writeHealth({
    status: "stopped",
    apiReady: false,
    reason: "api_exit_code_0",
    pid: null
  });
  if (!child || child.killed) {
    runtimeLog.end();
    process.exit(0);
    return;
  }
  child.once("exit", () => {
    runtimeLog.end();
    process.exit(0);
  });
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child && !child.killed) child.kill("SIGKILL");
  }, 5000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

void launch("normal_start");
