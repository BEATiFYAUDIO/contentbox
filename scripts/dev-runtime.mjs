import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const stateDir = path.join(os.homedir(), "contentbox-data", "state");
const logDir = path.join(os.homedir(), "contentbox-data", "logs");
const apiPidFile = path.join(stateDir, "dev-api.pid");
const dashPidFile = path.join(stateDir, "dev-dashboard.pid");
const apiLog = path.join(logDir, "api-dev.log");
const dashLog = path.join(logDir, "dashboard-dev.log");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const action = process.argv[2] || "status";

fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });

function readPid(file) {
  try {
    const raw = fs.readFileSync(file, "utf8").trim();
    const pid = Number(raw);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writePid(file, pid) {
  fs.writeFileSync(file, `${pid}\n`);
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopPid(pid) {
  if (!pid || !isAlive(pid)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
}

async function health(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1800) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, label, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await health(url)) {
      console.log(`[dev-runtime] ${label} ready: ${url}`);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.error(`[dev-runtime] ${label} did not become ready in ${Math.round(timeoutMs / 1000)}s`);
  return false;
}

function spawnLogged(args, logFile) {
  const out = fs.openSync(logFile, "a");
  const child = spawn(npmCmd, args, {
    cwd: root,
    detached: true,
    stdio: ["ignore", out, out],
    shell: false,
    env: process.env
  });
  child.unref();
  return child.pid;
}

async function startApi() {
  const existing = readPid(apiPidFile);
  if (existing && isAlive(existing)) {
    console.log(`[dev-runtime] API already running (pid ${existing})`);
    return;
  }
  if (await health("http://127.0.0.1:4000/health")) {
    console.log("[dev-runtime] API already responding on :4000");
    return;
  }
  console.log("[dev-runtime] Starting API");
  const pid = spawnLogged(["--prefix", "apps/api", "run", "start:api"], apiLog);
  writePid(apiPidFile, pid);
  if (!(await waitFor("http://127.0.0.1:4000/health", "API"))) {
    console.error(`[dev-runtime] API log: ${apiLog}`);
    process.exitCode = 1;
  }
}

async function startDashboard() {
  if (process.env.DEV_RUNTIME_DASHBOARD_WATCHER !== "1") {
    console.log("[dev-runtime] Skipping dashboard watcher (set DEV_RUNTIME_DASHBOARD_WATCHER=1 to enable).");
    return;
  }
  const existing = readPid(dashPidFile);
  if (existing && isAlive(existing)) {
    console.log(`[dev-runtime] Dashboard already running (pid ${existing})`);
    return;
  }
  if (await health("http://localhost:5173")) {
    console.log("[dev-runtime] Dashboard already responding on :5173");
    return;
  }
  console.log("[dev-runtime] Starting dashboard");
  const pid = spawnLogged(["--prefix", "apps/dashboard", "run", "dev", "--", "--host", "0.0.0.0"], dashLog);
  writePid(dashPidFile, pid);
  await waitFor("http://localhost:5173", "Dashboard", 30000);
}

function stopAll() {
  for (const [file, label] of [[apiPidFile, "API"], [dashPidFile, "Dashboard"]]) {
    const pid = readPid(file);
    if (pid) {
      console.log(`[dev-runtime] Stopping ${label} (pid ${pid})`);
      stopPid(pid);
    }
    try { fs.rmSync(file); } catch {}
  }
}

async function status() {
  const apiPid = readPid(apiPidFile);
  const dashPid = readPid(dashPidFile);
  console.log(`[dev-runtime] API pid=${apiPid || "none"} alive=${apiPid ? isAlive(apiPid) : false} health=${await health("http://127.0.0.1:4000/health")}`);
  console.log(`[dev-runtime] Dashboard pid=${dashPid || "none"} alive=${dashPid ? isAlive(dashPid) : false} health=${await health("http://localhost:5173")}`);
}

if (action === "start" || action === "start-api") {
  await startApi();
  if (action === "start") await startDashboard();
} else if (action === "stop") {
  stopAll();
} else if (action === "restart") {
  stopAll();
  await startApi();
  await startDashboard();
} else if (action === "status") {
  await status();
} else {
  console.error("Usage: node scripts/dev-runtime.mjs start|start-api|stop|restart|status");
  process.exit(1);
}
