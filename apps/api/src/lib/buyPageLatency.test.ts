import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import vm from "node:vm";
import ts from "typescript";
import { inspectWindowsCloudflared, runInspectionCommand, TunnelInspectionCache, tunnelStartBlocker } from "./tunnelInspection.js";
import { classifyNamedControlOwnership } from "./namedTunnelSafety.js";
import { TunnelManager } from "./tunnelManager.js";

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const options = { freshMs: 30, staleMs: 120, failureBackoffMs: 50 };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason?: any) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test("Windows inventory is asynchronous, distinguishes an empty successful inventory, and has a bounded deadline", async () => {
  let calls = 0;
  const result = await inspectWindowsCloudflared(50, async (_command, args, ms) => {
    calls++; assert.ok(ms > 0 && ms <= 50); assert.ok(args.includes("-NonInteractive"));
    await pause(5); return JSON.stringify({ services: [], processes: [] });
  });
  assert.equal(calls, 1); assert.deepEqual(result, { services: [], processes: [] });
});

test("missing PowerShell tries locations only, errors and malformed inventories never assert absence", async () => {
  let calls = 0;
  await assert.rejects(inspectWindowsCloudflared(100, async () => { calls++; throw Object.assign(Error(), { code: "ENOENT" }); }));
  assert.equal(calls, 3);
  for (const output of ["", "{}", '{"services":[],"processes":[{"ProcessId":12,"CommandLine":null}]}']) {
    await assert.rejects(inspectWindowsCloudflared(100, async () => output));
  }
  calls = 0;
  await assert.rejects(inspectWindowsCloudflared(100, async () => { calls++; throw Object.assign(Error(), { code: "INSPECTION_TIMEOUT" }); }));
  assert.equal(calls, 1);
});

test("Windows service and external process inventory retains ownership evidence", async () => {
  const result = await inspectWindowsCloudflared(100, async () => JSON.stringify({
    services: [{ Name: "cloudflared", State: "Running", ProcessId: 22, PathName: "cloudflared tunnel run exact" }],
    processes: [{ ProcessId: 22, CommandLine: "cloudflared tunnel run exact" }, { ProcessId: 33, CommandLine: "cloudflared tunnel run other" }]
  }));
  assert.equal(result.services[0].state, "running"); assert.equal(result.processes[1].pid, 33);
  const service = { ...result.services[0], serviceManaged: true };
  assert.equal(classifyNamedControlOwnership({ configuredIdentities: ["exact"], ownedPid: 44, processes: [service] }), "service-external");
  assert.equal(classifyNamedControlOwnership({ configuredIdentities: ["exact"], ownedPid: 22, processes: result.processes }), "app-managed");
  assert.equal(classifyNamedControlOwnership({ configuredIdentities: ["exact"], ownedPid: 44, processes: result.processes }), "service-external");
  assert.equal(classifyNamedControlOwnership({ configuredIdentities: ["missing"], processes: result.processes }), "unknown");
});

test("concurrent reads and control callers share one inspection", async () => {
  let calls = 0; const work = deferred<number>();
  const cache = new TunnelInspectionCache(() => { calls++; return work.promise; }, options);
  for (let i = 0; i < 30; i++) assert.equal(cache.read(), null);
  const first = cache.refresh(); assert.strictEqual(cache.refresh(), first);
  await pause(0); assert.equal(calls, 1); work.resolve(42);
  assert.equal(await first, 42); assert.equal(cache.read(), 42);
});

test("stale results remain usable during refresh; failure never renews their expiry and actions get unknown", async () => {
  let now = 0; let work = deferred<number>();
  const cache = new TunnelInspectionCache(() => work.promise, { ...options, now: () => now });
  work.resolve(7); await cache.refresh(); now = 31; work = deferred();
  assert.equal(cache.read(), 7); work.reject(Error("unavailable"));
  assert.equal(await cache.refresh(), null); assert.equal(cache.read(), 7);
  now = 121; work = deferred(); assert.equal(cache.read(), null); work.resolve(9);
  assert.equal(await cache.refresh(), 9); assert.equal(cache.read(), 9);
});

test("failure backoff limits ordinary request work and force refresh does not bypass it", async () => {
  let calls = 0, now = 0;
  const cache = new TunnelInspectionCache(async () => { calls++; throw Error(); }, { ...options, now: () => now });
  await cache.refresh(); for (let i = 0; i < 30; i++) { assert.equal(cache.read(true), null); await cache.refresh(); }
  assert.equal(calls, 1); now = 51; await cache.refresh(); assert.equal(calls, 2);
});

test("invalidation discards in-flight evidence without overlapping inspections", async () => {
  const work = deferred<number>(); let calls = 0;
  const cache = new TunnelInspectionCache(() => { calls++; return work.promise; }, options);
  const first = cache.refresh(); cache.invalidate(); assert.strictEqual(cache.refresh(), first);
  work.resolve(4); assert.equal(await first, null); assert.equal(calls, 1);
  assert.equal(cache.read(), null); assert.equal(await cache.refresh(), 4); assert.equal(calls, 2);
});

test("slow real child inspection leaves concurrent HTTP requests responsive", async t => {
  const cache = new TunnelInspectionCache(() => runInspectionCommand(process.execPath,
    ["-e", "setTimeout(()=>console.log('done'),600)"], 2000), options);
  const server = createServer((_req, res) => { res.end(JSON.stringify({ result: cache.read() })); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const started = performance.now(); const responses = await Promise.all(Array.from({ length: 12 }, () => fetch(base).then(async r => await r.json() as { result: string | null })));
  assert.ok(performance.now() - started < 500); assert.ok(responses.every(r => r.result === null));
  assert.equal((await cache.refresh())?.trim(), "done");
});

test("timeout terminates the directly launched real child (Unix execution, not native PowerShell)", { skip: process.platform === "win32" }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inspection-child-")); const file = path.join(dir, "pid");
  try {
    const result = runInspectionCommand(process.execPath, ["-e", "require('fs').writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)", file], 400);
    await assert.rejects(result);
    const pid = Number(await fs.readFile(file, "utf8"));
    for (let i = 0; i < 50; i++) {
      try { process.kill(pid, 0); } catch { return; }
      await pause(10);
    }
    assert.fail("inspection child survived timeout");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

for (const kind of ["quick", "named"] as const) {
  test(`${kind} spawn refuses unknown and external ownership without killing any process`, async () => {
    for (const inspection of [{ inspectionAvailable: false, externalProcessRunning: false }, { inspectionAvailable: true, externalProcessRunning: true }]) {
      let spawned = 0, killed = 0;
      const manager = new TunnelManager({ targetPort: 1, binDir: "/unused", protocolPreference: "http2",
        resolveBinary: async () => "/unused", readVersion: async () => null,
        beforeSpawn: async () => { const result = tunnelStartBlocker(inspection); if (!result.ok) throw Error(result.code); },
        spawnProcess: (() => { spawned++; throw Error("unexpected spawn"); }) as any,
        killProcess: () => { killed++; }
      });
      if (kind === "quick") await assert.rejects(manager.startQuick());
      else await manager.startNamed({ publicOrigin: "https://fixture.invalid", tunnelName: "fixture" });
      assert.equal(manager.status().status, "ERROR"); assert.equal(spawned, 0); assert.equal(killed, 0);
    }
    assert.equal(tunnelStartBlocker({ inspectionAvailable: true, externalProcessRunning: false }).ok, true);
  });
}

test("automatic named restart repeats the fresh ownership guard", async () => {
  let checks = 0, spawned = 0;
  const child = new EventEmitter() as any; child.pid = 9876; child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const manager = new TunnelManager({ targetPort: 1, binDir: "/unused", healthIntervalMs: 10, healthFailureThreshold: 1,
    resolveBinary: async () => "/unused", readVersion: async () => null,
    beforeSpawn: async () => { if (++checks > 1) throw Error("ownership unknown"); },
    spawnProcess: (() => { spawned++; return child; }) as any,
    killProcess: () => { queueMicrotask(() => child.emit("exit", 0)); },
    fetchImpl: async () => new Response("{}", { status: 503 })
  });
  let healthCalls = 0;
  (manager as any).verifyWithRetries = async () => ++healthCalls === 1;
  (manager as any).verify = async () => false;
  try {
    await manager.startNamed({ publicOrigin: "https://fixture.invalid", tunnelName: "fixture" });
    for (let i = 0; i < 100 && checks < 2; i++) await pause(10);
    assert.equal(checks, 2); assert.equal(spawned, 1);
  } finally { await manager.stop(); }
});

test("stopping during ownership inspection cancels a pending spawn", async () => {
  for (const kind of ["quick", "named"]) {
    const gate = deferred<void>(); let checking = false, spawned = 0;
    const manager = new TunnelManager({ targetPort: 1, binDir: "/unused", protocolPreference: "http2",
      resolveBinary: async () => "/unused", readVersion: async () => null,
      beforeSpawn: () => { checking = true; return gate.promise; },
      spawnProcess: (() => { spawned++; throw Error("unexpected spawn"); }) as any
    });
    const pending = (kind === "quick" ? manager.startQuick() : manager.startNamed({ publicOrigin: "https://fixture.invalid", tunnelName: "fixture" })).catch(() => null);
    for (let i = 0; i < 100 && !checking; i++) await pause(1);
    assert.equal(checking, true); await manager.stop(); gate.resolve(); await pending; assert.equal(spawned, 0);
  }
});

// Execute the production browser bootstrap with presentation/transport doubles.
// The real browser acceptance also renders the complete production HTML template.
const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true);
const handler = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "handleBuyPage")!;
const template = (handler as any).body.statements.find((node: any) => ts.isVariableStatement(node) && (node.declarationList.declarations[0]?.name as any)?.text === "html").declarationList.declarations[0].initializer;
// Template literal contents are cooked just as they are by the route; fixture
// values do not authorize anything in production.
const html = vm.runInNewContext("(" + template.getText(ast) + ")", new Proxy({}, { has: () => true, get: (_t, key) => {
  if (typeof key === 'string' && key in globalThis) return (globalThis as any)[key];
  if (key === 'ownerAppearance') return { theme: {}, css: '', wallpaperUrl: null };
  if (key === 'content') return { id: 'fixture', title: 'Fixture' };
  if (key === 'escHtml' || key === 'buildPublicUrlFromOrigin') return (v: any) => String(v || '');
  return '';
}}));
const begin = html.indexOf('  if (productTier === "basic") {\n    logAudienceView();');
const end = html.indexOf('\n})();', begin);
assert.ok(begin > 0 && end > begin);
const bootstrap = html.slice(begin, end);
for (const tier of ["basic", "advanced"]) {
  test(`${tier} offer does not wait for attribution; advanced still waits for buyer proof`, async () => {
    const attribution = deferred<void>(), buyer = deferred<void>(); let rendered = false;
    const context: any = { productTier: tier, logAudienceView() {}, contentId: "fixture", loadAttribution: () => attribution.promise,
      fetchJson: async () => ({ commerceAuthorityAvailable: false }), hydrateFromDurableReceipt: () => buyer.promise,
      fetchBuyerMe: async () => {}, renderBasicOffer: () => { rendered = true; }, app: {}, console };
    vm.runInNewContext('(function(){'+bootstrap+'})()', context);
    await pause(5); assert.equal(rendered, tier === "basic"); buyer.resolve(); await pause(5); assert.equal(rendered, true);
    attribution.resolve();
  });
}

test("an inactive init script is configuration, not an externally running tunnel", async () => {
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "detectTunnelControlMode")!;
  const compiled = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const ctx: any = { process: { platform: "linux", env: {} }, Date, path, os,
    fsSync: { existsSync: (p: string) => p === "/etc/init.d/cloudflared", readFileSync: () => "cloudflared tunnel run exact" },
    getConfiguredNamedIdentityAliases: () => ["exact"], inspectCloudflaredServices: async () => [],
    serviceInspectionSummary: () => ({ serviceRunning: false }), runInspectionCommand: async () => "",
    NAMED_CONTROL_COMMAND_TIMEOUT_MS: 100, tunnelManager: { status: () => ({ pid: null }) }, classifyNamedControlOwnership };
  vm.runInNewContext(compiled, ctx); const result = await ctx.detectTunnelControlMode();
  assert.equal(result.inspectionAvailable, true); assert.equal(result.externalProcessRunning, false);
  assert.equal(tunnelStartBlocker(result).ok, true);
});
