import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { TunnelManager } from "./tunnelManager.js";

function fakeChild(pid: number) {
  const child = new EventEmitter() as any;
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

function quickTunnelAnnouncement(origin: string) {
  return `Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):\n${origin}\n`;
}

test("quick tunnel targets the public listener and stop kills only its owned child", async () => {
  const ownedPid = 4242;
  const unrelatedPid = 7777;
  const child = fakeChild(ownedPid);
  const spawned: Array<{ command: string; args: string[] }> = [];
  const killed: number[] = [];
  const manager = new TunnelManager({
    targetPort: 4010,
    binDir: "/unused",
    protocolPreference: "http2",
    resolveBinary: async () => "/mock/cloudflared",
    readVersion: async () => "cloudflared mock",
    spawnProcess: ((command: string, args: string[]) => {
      spawned.push({ command, args: [...args] });
      queueMicrotask(() => child.stderr.write(quickTunnelAnnouncement("https://owned-test.trycloudflare.com")));
      return child;
    }) as any,
    killProcess: (pid) => {
      killed.push(pid);
      queueMicrotask(() => child.emit("exit", 0, null));
    }
  });

  const started = await manager.startQuick();
  assert.equal(started.status, "ACTIVE");
  assert.equal(started.publicOrigin, "https://owned-test.trycloudflare.com");
  assert.deepEqual(spawned, [
    {
      command: "/mock/cloudflared",
      args: ["tunnel", "--url", "http://127.0.0.1:4010", "--no-autoupdate", "--protocol", "http2"]
    }
  ]);

  await manager.stop();
  assert.deepEqual(killed, [ownedPid]);
  assert.equal(killed.includes(unrelatedPid), false);

  await manager.stop();
  assert.deepEqual(killed, [ownedPid]);
});

test("stopping one manager does not terminate another Certifyd instance's cloudflared child", async () => {
  const killed: number[] = [];
  const makeManager = (pid: number, origin: string) => {
    const child = fakeChild(pid);
    return new TunnelManager({
      targetPort: 4010,
      binDir: "/unused",
      protocolPreference: "http2",
      resolveBinary: async () => "/mock/cloudflared",
      readVersion: async () => "cloudflared mock",
      spawnProcess: (() => {
        queueMicrotask(() => child.stderr.write(quickTunnelAnnouncement(origin)));
        return child;
      }) as any,
      killProcess: (ownedPid) => {
        killed.push(ownedPid);
        queueMicrotask(() => child.emit("exit", 0, null));
      }
    });
  };
  const first = makeManager(4242, "https://first.trycloudflare.com");
  const second = makeManager(7777, "https://second.trycloudflare.com");
  await Promise.all([first.startQuick(), second.startQuick()]);

  await first.stop();
  assert.deepEqual(killed, [4242]);
  assert.equal(second.status().status, "ACTIVE");
  await second.stop();
});

test("quick tunnel ignores trycloudflare URLs in error output without the creation announcement", async () => {
  const child = fakeChild(7878);
  const manager = new TunnelManager({
    targetPort: 4010,
    binDir: "/unused",
    protocolPreference: "http2",
    resolveBinary: async () => "/mock/cloudflared",
    readVersion: async () => "cloudflared mock",
    spawnProcess: (() => {
      queueMicrotask(() => {
        child.stderr.write("Unable to request quick Tunnel: Get https://api.trycloudflare.com/tunnel: certificate verify failed\n");
        child.emit("exit", 1, null);
      });
      return child;
    }) as any
  });

  const result = await manager.startQuick();
  assert.equal(result.status, "ERROR");
  assert.equal(result.publicOrigin, null);
  assert.match(String(result.lastError), /exited before URL was assigned/);
});

test("named tunnel startup arguments and owned-child stop behavior remain unchanged", async () => {
  const child = fakeChild(8181);
  const spawned: Array<{ command: string; args: string[] }> = [];
  const killed: number[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("ok", { status: 200 });
  try {
    const manager = new TunnelManager({
      targetPort: 4010,
      binDir: "/unused",
      resolveBinary: async () => "/mock/cloudflared",
      readVersion: async () => "cloudflared mock",
      spawnProcess: ((command: string, args: string[]) => {
        spawned.push({ command, args: [...args] });
        return child;
      }) as any,
      killProcess: (pid) => {
        killed.push(pid);
        queueMicrotask(() => child.emit("exit", 0, null));
      }
    });
    const status = await manager.startNamed({
      publicOrigin: "https://creator.example.com",
      tunnelName: "creator",
      token: "named-token"
    });
    assert.equal(status.status, "ACTIVE");
    assert.deepEqual(spawned, [
      {
        command: "/mock/cloudflared",
        args: ["tunnel", "run", "--token", "named-token", "--url", "http://127.0.0.1:4010"]
      }
    ]);
    await manager.stop();
    assert.deepEqual(killed, [8181]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("named Stop waits for delayed owned-child exit and remains STOPPED after late events", async () => {
  const child = fakeChild(8282);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("ok", { status: 200 });
  try {
    const manager = new TunnelManager({
      targetPort: 4010,
      binDir: "/unused",
      stopTimeoutMs: 100,
      resolveBinary: async () => "/mock/cloudflared",
      readVersion: async () => "cloudflared mock",
      spawnProcess: (() => child) as any,
      killProcess: () => setTimeout(() => child.emit("exit", 0, null), 20)
    });
    await manager.startNamed({ publicOrigin: "https://creator.example.com", tunnelName: "creator", token: "token" });
    const startedAt = Date.now();
    assert.equal((await manager.stop()).status, "STOPPED");
    assert.ok(Date.now() - startedAt >= 15);
    child.emit("exit", 0, null);
    assert.equal(manager.status().status, "STOPPED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("named Stop handles an already-exited child", async () => {
  const child = fakeChild(8383);
  child.exitCode = 0;
  let kills = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("ok", { status: 200 });
  try {
    const manager = new TunnelManager({
      targetPort: 4010,
      binDir: "/unused",
      resolveBinary: async () => "/mock/cloudflared",
      readVersion: async () => "cloudflared mock",
      spawnProcess: (() => child) as any,
      killProcess: () => { kills += 1; }
    });
    await manager.startNamed({ publicOrigin: "https://creator.example.com", tunnelName: "creator", token: "token" });
    assert.equal((await manager.stop()).status, "STOPPED");
    assert.equal(kills, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("named Stop timeout is bounded and escalates only its owned PID", async () => {
  const child = fakeChild(8484);
  const kills: Array<[number, unknown]> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("ok", { status: 200 });
  try {
    const manager = new TunnelManager({
      targetPort: 4010,
      binDir: "/unused",
      stopTimeoutMs: 10,
      stopEscalationTimeoutMs: 10,
      resolveBinary: async () => "/mock/cloudflared",
      readVersion: async () => "cloudflared mock",
      spawnProcess: (() => child) as any,
      killProcess: (pid, signal) => kills.push([pid, signal])
    });
    await manager.startNamed({ publicOrigin: "https://creator.example.com", tunnelName: "creator", token: "token" });
    const startedAt = Date.now();
    const stopped = await manager.stop();
    assert.equal(stopped.status, "ERROR");
    assert.match(String(stopped.lastError), /Timed out/);
    assert.equal(stopped.pid, 8484);
    assert.ok(Date.now() - startedAt < 250);
    assert.deepEqual(kills, [[8484, undefined], [8484, "SIGKILL"]]);
    child.exitCode = 0;
    child.emit("exit", 0, null);
    assert.equal((await manager.stop()).status, "STOPPED");
    assert.deepEqual(kills, [[8484, undefined], [8484, "SIGKILL"]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Stop cancels a delayed named self-heal before it can respawn", async () => {
  const children = [fakeChild(8585), fakeChild(8586)];
  let spawnCount = 0;
  let fetchCount = 0;
  let healthKill!: () => void;
  const healthKilled = new Promise<void>((resolve) => { healthKill = resolve; });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("ok", { status: fetchCount++ === 0 ? 200 : 503 });
  try {
    const manager = new TunnelManager({
      targetPort: 4010,
      binDir: "/unused",
      healthIntervalMs: 5,
      healthFailureThreshold: 1,
      resolveBinary: async () => "/mock/cloudflared",
      readVersion: async () => "cloudflared mock",
      spawnProcess: (() => children[spawnCount++]) as any,
      killProcess: () => {
        healthKill();
        queueMicrotask(() => children[0].emit("exit", 0, null));
      }
    });
    await manager.startNamed({ publicOrigin: "https://creator.example.com", tunnelName: "creator", token: "token" });
    await healthKilled;
    await manager.stop();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(spawnCount, 1);
    assert.equal(manager.status().status, "STOPPED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("config invalidation cancels a pending named self-heal generation", async () => {
  const child = fakeChild(8686);
  let spawnCount = 0;
  let fetchCount = 0;
  let healthKill!: () => void;
  const healthKilled = new Promise<void>((resolve) => { healthKill = resolve; });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("ok", { status: fetchCount++ === 0 ? 200 : 503 });
  try {
    const manager = new TunnelManager({
      targetPort: 4010,
      binDir: "/unused",
      healthIntervalMs: 5,
      healthFailureThreshold: 1,
      resolveBinary: async () => "/mock/cloudflared",
      readVersion: async () => "cloudflared mock",
      spawnProcess: (() => { spawnCount += 1; return child; }) as any,
      killProcess: () => {
        healthKill();
        queueMicrotask(() => child.emit("exit", 0, null));
      }
    });
    await manager.startNamed({ publicOrigin: "https://creator.example.com", tunnelName: "creator", token: "token" });
    await healthKilled;
    manager.invalidateNamedIntent();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(spawnCount, 1);
    await manager.stop();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("aborted binary preparation cannot publish late resolver results into manager state", async () => {
  const controller = new AbortController();
  let release!: (value: string) => void;
  let observedSignal: AbortSignal | undefined;
  const manager = new TunnelManager({
    targetPort: 4010,
    binDir: "/unused",
    resolveBinary: (signal) => {
      observedSignal = signal;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    },
    readVersion: async () => "late version"
  });

  const preparation = manager.ensureBinary(controller.signal);
  controller.abort();
  release("/late/cloudflared");
  const result = await preparation;
  assert.equal(result.ok, false);
  assert.equal(observedSignal?.aborted, true);
  assert.equal(manager.status().status, "STOPPED");
  assert.equal(manager.status().lastError, null);
  assert.equal(manager.status().cloudflaredPath, null);
  assert.equal(manager.status().cloudflaredVersion, null);
});

async function temporaryBinDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "certifyd-tunnel-manager-test-"));
}

test("cancelled system cloudflared probe is bounded and never starts a download", async () => {
  const binDir = await temporaryBinDir();
  const controller = new AbortController();
  let fetches = 0;
  let probeEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    probeEntered = resolve;
  });
  try {
    const manager = new TunnelManager({
      targetPort: 4010,
      binDir,
      execFileRunner: (_cmd, _args, options) =>
        new Promise((_resolve, reject) => {
          assert.equal(options?.timeoutMs, 5000);
          probeEntered();
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
      fetchImpl: (async () => {
        fetches += 1;
        throw new Error("download must not start after cancellation");
      }) as typeof fetch
    });
    const preparation = manager.ensureBinary(controller.signal);
    await entered;
    controller.abort();
    const result = await preparation;
    assert.equal(result.ok, false);
    assert.equal(fetches, 0);
    assert.equal(manager.status().cloudflaredPath, null);
    assert.equal(manager.status().cloudflaredVersion, null);
  } finally {
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test("cancelled binary download cleans partial files and cannot publish manager state", async () => {
  const binDir = await temporaryBinDir();
  const controller = new AbortController();
  let fetchEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    fetchEntered = resolve;
  });
  try {
    const manager = new TunnelManager({
      targetPort: 4010,
      binDir,
      execFileRunner: async () => {
        throw new Error("cloudflared not installed");
      },
      fetchImpl: ((_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          fetchEntered();
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })) as typeof fetch
    });
    const preparation = manager.ensureBinary(controller.signal);
    await entered;
    controller.abort();
    const result = await preparation;
    assert.equal(result.ok, false);
    assert.equal(manager.status().cloudflaredPath, null);
    await assert.rejects(fs.access(path.join(binDir, "cloudflared.download")));
    await assert.rejects(fs.access(path.join(binDir, "cloudflared")));
  } finally {
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test("cancelled stalled response stream cleans its partial download", async () => {
  const binDir = await temporaryBinDir();
  const controller = new AbortController();
  let streamStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    streamStarted = resolve;
  });
  try {
    const manager = new TunnelManager({
      targetPort: 4010,
      binDir,
      execFileRunner: async () => {
        throw new Error("cloudflared not installed");
      },
      fetchImpl: (async () => {
        const body = new PassThrough();
        streamStarted();
        return { ok: true, status: 200, body } as unknown as Response;
      }) as typeof fetch
    });
    const preparation = manager.ensureBinary(controller.signal);
    await started;
    controller.abort();
    const result = await preparation;
    assert.equal(result.ok, false);
    assert.equal(manager.status().cloudflaredPath, null);
    await assert.rejects(fs.access(path.join(binDir, "cloudflared.download")));
    await assert.rejects(fs.access(path.join(binDir, "cloudflared")));
  } finally {
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test("cancelled archive extraction is bounded and removes download and extraction artifacts", async () => {
  const binDir = await temporaryBinDir();
  const controller = new AbortController();
  let extractionDir: string | null = null;
  let extractionEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    extractionEntered = resolve;
  });
  try {
    const manager = new TunnelManager({
      targetPort: 4010,
      binDir,
      downloadSpec: { url: "https://example.invalid/cloudflared.tgz", isTgz: true, binaryName: "cloudflared" },
      execFileRunner: (cmd, args, options) => {
        if (cmd === "cloudflared") return Promise.reject(new Error("cloudflared not installed"));
        assert.equal(cmd, "tar");
        assert.equal(options?.timeoutMs, 30000);
        extractionDir = args[args.indexOf("-C") + 1] || null;
        extractionEntered();
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
      fetchImpl: (async (url: string | URL | Request) =>
        String(url).endsWith(".sha256")
          ? new Response("", { status: 404 })
          : new Response("archive bytes", { status: 200 })) as typeof fetch
    });
    const preparation = manager.ensureBinary(controller.signal);
    await entered;
    controller.abort();
    const result = await preparation;
    assert.equal(result.ok, false);
    assert.equal(manager.status().cloudflaredPath, null);
    assert.ok(extractionDir);
    await assert.rejects(fs.access(extractionDir as string));
    await assert.rejects(fs.access(path.join(binDir, "cloudflared.download")));
    await assert.rejects(fs.access(path.join(binDir, "cloudflared")));
  } finally {
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test("archive extraction failure removes download, extraction directory, and unpublished binary", async () => {
  const binDir = await temporaryBinDir();
  let extractionDir: string | null = null;
  try {
    const manager = new TunnelManager({
      targetPort: 4010,
      binDir,
      downloadSpec: { url: "https://example.invalid/cloudflared.tgz", isTgz: true, binaryName: "cloudflared" },
      execFileRunner: async (cmd, args) => {
        if (cmd === "cloudflared") throw new Error("cloudflared not installed");
        extractionDir = args[args.indexOf("-C") + 1] || null;
        throw new Error("invalid archive");
      },
      fetchImpl: (async (url: string | URL | Request) =>
        String(url).endsWith(".sha256")
          ? new Response("", { status: 404 })
          : new Response("invalid archive bytes", { status: 200 })) as typeof fetch
    });
    const result = await manager.ensureBinary();
    assert.equal(result.ok, false);
    assert.ok(extractionDir);
    await assert.rejects(fs.access(extractionDir as string));
    await assert.rejects(fs.access(path.join(binDir, "cloudflared.download")));
    await assert.rejects(fs.access(path.join(binDir, "cloudflared")));
    assert.equal(manager.status().cloudflaredPath, null);
  } finally {
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test("successful archive extraction removes its temporary archive and extraction directory", async () => {
  const binDir = await temporaryBinDir();
  const managedPath = path.join(binDir, "cloudflared");
  let extractionDir: string | null = null;
  try {
    const manager = new TunnelManager({
      targetPort: 4010,
      binDir,
      downloadSpec: { url: "https://example.invalid/cloudflared.tgz", isTgz: true, binaryName: "cloudflared" },
      execFileRunner: async (cmd, args) => {
        if (cmd === "cloudflared") throw new Error("cloudflared not installed");
        if (cmd === "tar") {
          extractionDir = args[args.indexOf("-C") + 1] || null;
          assert.ok(extractionDir);
          await fs.writeFile(path.join(extractionDir as string, "cloudflared"), "extracted binary");
          return { stdout: "", stderr: "" };
        }
        assert.equal(cmd, managedPath);
        return { stdout: "cloudflared test", stderr: "" };
      },
      fetchImpl: (async (url: string | URL | Request) =>
        String(url).endsWith(".sha256")
          ? new Response("", { status: 404 })
          : new Response("archive bytes", { status: 200 })) as typeof fetch
    });
    const result = await manager.ensureBinary();
    assert.deepEqual(result, { ok: true });
    assert.ok(extractionDir);
    await assert.rejects(fs.access(extractionDir as string));
    await assert.rejects(fs.access(path.join(binDir, "cloudflared.download")));
    assert.equal(await fs.readFile(managedPath, "utf8"), "extracted binary");
    assert.equal(manager.status().cloudflaredPath, managedPath);
    assert.equal(manager.status().cloudflaredVersion, "cloudflared test");
  } finally {
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test("binary version probing is finite and a timed-out probe does not block preparation", async () => {
  const binDir = await temporaryBinDir();
  const managedPath = path.join(binDir, "cloudflared");
  await fs.writeFile(managedPath, "test binary");
  let versionProbeTimeout: number | undefined;
  try {
    const manager = new TunnelManager({
      targetPort: 4010,
      binDir,
      execFileRunner: async (cmd, args, options) => {
        assert.equal(cmd, managedPath);
        assert.deepEqual(args, ["--version"]);
        versionProbeTimeout = options?.timeoutMs;
        throw new Error("version probe timed out");
      }
    });
    const result = await manager.ensureBinary();
    assert.deepEqual(result, { ok: true });
    assert.equal(versionProbeTimeout, 5000);
    assert.equal(manager.status().cloudflaredPath, managedPath);
    assert.equal(manager.status().cloudflaredVersion, null);
  } finally {
    await fs.rm(binDir, { recursive: true, force: true });
  }
});
