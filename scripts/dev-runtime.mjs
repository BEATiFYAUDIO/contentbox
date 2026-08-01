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
const managedPorts = [4000, 4010, 5173];

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function childPids(pid) {
  if (!pid || process.platform === "win32") return [];
  const result = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  if (result.status !== 0 && !result.stdout) return [];
  return result.stdout
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function pidTree(pid, seen = new Set()) {
  if (!pid || seen.has(pid)) return [];
  seen.add(pid);
  const children = childPids(pid).flatMap((child) => pidTree(child, seen));
  return [...children, pid];
}

async function waitUntilDead(pids, timeoutMs = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (pids.every((pid) => !isAlive(pid))) return true;
    await sleep(100);
  }
  return pids.every((pid) => !isAlive(pid));
}

async function stopPid(pid) {
  if (!pid || !isAlive(pid)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  const pids = pidTree(pid);
  for (const target of pids) {
    try { process.kill(target, "SIGTERM"); } catch {}
  }
  if (await waitUntilDead(pids)) return;
  for (const target of pids) {
    try { process.kill(target, "SIGKILL"); } catch {}
  }
  await waitUntilDead(pids, 1000);
}

function pidsForPort(port) {
  if (process.platform === "win32") {
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique`
    ], { encoding: "utf8" });
    return result.stdout.split(/\s+/).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  }
  let result = spawnSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], { encoding: "utf8" });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.split(/\s+/).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  }
  result = spawnSync("ss", ["-ltnp"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return [];
  const out = new Set();
  for (const line of result.stdout.split("\n")) {
    if (!line.includes(`:${port}`)) continue;
    const match = line.match(/pid=(\d+)/);
    if (match) out.add(Number(match[1]));
  }
  return [...out];
}

async function stopPort(port) {
  const pids = pidsForPort(port);
  if (!pids.length) return;
  console.log(`[dev-runtime] Stopping listener(s) on :${port}: ${pids.join(", ")}`);
  for (const pid of pids) await stopPid(pid);
}

async function health(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1800) });
    return res.ok;
  } catch {
    return false;
  }
}

async function routeProbe(url, method = "GET") {
  try {
    const res = await fetch(url, {
      method,
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: method === "POST" ? "{}" : undefined,
      signal: AbortSignal.timeout(1800)
    });
    return { ok: true, status: res.status, body: (await res.text()).slice(0, 160) };
  } catch (error) {
    return { ok: false, status: 0, body: String(error?.message || error) };
  }
}

async function waitFor(url, label, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await health(url)) {
      console.log(`[dev-runtime] ${label} ready: ${url}`);
      return true;
    }
    await sleep(1000);
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
    const pids = pidsForPort(4000);
    if (pids[0]) writePid(apiPidFile, pids[0]);
    console.log("[dev-runtime] API already responding on :4000");
    return;
  }
  console.log("[dev-runtime] Starting API");
  const pid = spawnLogged(["--prefix", "apps/api", "run", "start:api"], apiLog);
  writePid(apiPidFile, pid);
  if (!(await waitFor("http://127.0.0.1:4000/health", "API"))) {
    console.error(`[dev-runtime] API log: ${apiLog}`);
    process.exitCode = 1;
    return;
  }
  const pids = pidsForPort(4000);
  if (pids[0]) writePid(apiPidFile, pids[0]);
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
    const pids = pidsForPort(5173);
    if (pids[0]) writePid(dashPidFile, pids[0]);
    console.log("[dev-runtime] Dashboard already responding on :5173");
    return;
  }
  console.log("[dev-runtime] Starting dashboard");
  const pid = spawnLogged(["--prefix", "apps/dashboard", "run", "dev", "--", "--host", "0.0.0.0"], dashLog);
  writePid(dashPidFile, pid);
  await waitFor("http://localhost:5173", "Dashboard", 30000);
  const pids = pidsForPort(5173);
  if (pids[0]) writePid(dashPidFile, pids[0]);
}

async function stopAll() {
  for (const [file, label] of [[apiPidFile, "API"], [dashPidFile, "Dashboard"]]) {
    const pid = readPid(file);
    if (pid) {
      console.log(`[dev-runtime] Stopping ${label} (pid ${pid})`);
      await stopPid(pid);
    }
    try { fs.rmSync(file); } catch {}
  }
  for (const port of managedPorts) await stopPort(port);
}

async function status() {
  const apiPid = readPid(apiPidFile);
  const dashPid = readPid(dashPidFile);
  const publicProbe = await routeProbe("http://127.0.0.1:4010/api/derivatives/remote-request", "POST");
  console.log(`[dev-runtime] API pid=${apiPid || "none"} alive=${apiPid ? isAlive(apiPid) : false} health=${await health("http://127.0.0.1:4000/health")} listeners=${pidsForPort(4000).join(",") || "none"}`);
  console.log(`[dev-runtime] Public pid(s)=${pidsForPort(4010).join(",") || "none"} derivative-route=${publicProbe.status} ${publicProbe.body.replace(/\s+/g, " ")}`);
  console.log(`[dev-runtime] Dashboard pid=${dashPid || "none"} alive=${dashPid ? isAlive(dashPid) : false} health=${await health("http://localhost:5173")} listeners=${pidsForPort(5173).join(",") || "none"}`);
}

if (action === "start" || action === "start-api") {
  await startApi();
  if (action === "start") await startDashboard();
} else if (action === "stop") {
  await stopAll();
} else if (action === "restart") {
  await stopAll();
  await startApi();
  await startDashboard();
} else if (action === "status") {
  await status();
} else {
  console.error("Usage: node scripts/dev-runtime.mjs start|start-api|stop|restart|status");
  process.exit(1);
}
