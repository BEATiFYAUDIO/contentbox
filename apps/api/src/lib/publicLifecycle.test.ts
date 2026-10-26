import assert from "node:assert/strict";
import test from "node:test";
import {
  AsyncLifecycleMutex,
  startAutomaticQuickRuntime,
  startNamedRuntimeAtStartup,
  startQuickTransaction,
  type QuickStartDependencies
} from "./publicLifecycle.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(overrides: Partial<QuickStartDependencies> = {}) {
  const state = {
    mode: null as "off" | "quick" | "named" | null,
    autoStart: false,
    consent: false,
    listener: false,
    tunnel: false,
    spawns: 0,
    tunnelStops: 0,
    listenerStarts: 0,
    listenerStops: 0
  };
  const deps: QuickStartDependencies = {
    validate: async () => ({ ok: true }),
    hasConsent: () => state.consent,
    grantConsent: () => {
      state.consent = true;
    },
    snapshot: () => ({ mode: state.mode, autoStart: state.autoStart }),
    setMode: (mode) => {
      state.mode = mode;
    },
    setAutoStart: (enabled) => {
      state.autoStart = enabled;
    },
    startListener: async () => {
      if (!state.listener) state.listenerStarts += 1;
      state.listener = true;
    },
    stopListener: async () => {
      state.listenerStops += 1;
      state.listener = false;
    },
    prepareTunnel: async () => ({ ok: true }),
    startTunnel: async () => {
      if (!state.tunnel) {
        state.spawns += 1;
        state.tunnel = true;
      }
      return { status: "ACTIVE", publicOrigin: "https://owned.trycloudflare.com" };
    },
    stopTunnel: async () => {
      state.tunnelStops += 1;
      state.tunnel = false;
    },
    ...overrides
  };
  return { state, deps };
}

async function stopQuick(mutex: AsyncLifecycleMutex, h: ReturnType<typeof harness>) {
  return mutex.runExclusive(async () => {
    await h.deps.stopTunnel();
    h.deps.setMode("off");
    h.deps.setAutoStart(false);
    await h.deps.stopListener();
  });
}

test("named configuration rejection performs no Quick mutation", async () => {
  const h = harness({ validate: async () => ({ ok: false, code: "named_configured" }) });
  h.state.consent = true;
  const result = await startQuickTransaction(h.deps, {});
  assert.deepEqual(result, { ok: false, code: "named_configured" });
  assert.deepEqual(h.state, {
    mode: null,
    autoStart: false,
    consent: true,
    listener: false,
    tunnel: false,
    spawns: 0,
    tunnelStops: 0,
    listenerStarts: 0,
    listenerStops: 0
  });
});

test("consent is required even when a system cloudflared is assumed available", async () => {
  let prepared = false;
  const h = harness({ prepareTunnel: async () => ((prepared = true), { ok: true }) });
  const result = await startQuickTransaction(h.deps, {});
  assert.deepEqual(result, { ok: false, code: "consent_required" });
  assert.equal(prepared, false);
  assert.equal(h.state.spawns, 0);
});

test("manual Start grants consent, starts Quick, and enables established autostart behavior", async () => {
  const h = harness();
  const result = await startQuickTransaction(h.deps, { consent: true });
  assert.equal(result.ok, true);
  assert.equal(h.state.consent, true);
  assert.equal(h.state.mode, "quick");
  assert.equal(h.state.autoStart, true);
  assert.equal(h.state.listener, true);
  assert.equal(h.state.spawns, 1);
  assert.equal(h.state.listenerStarts, 1);
});

test("preparation failure leaves state and listener untouched", async () => {
  const h = harness({ prepareTunnel: async () => ({ ok: false, error: "download failed" }) });
  h.state.consent = true;
  const result = await startQuickTransaction(h.deps, {});
  assert.equal(result.ok, false);
  assert.equal(result.ok ? "" : result.code, "cloudflared_download_failed");
  assert.equal(h.state.mode, null);
  assert.equal(h.state.listener, false);
  assert.equal(h.state.spawns, 0);
});

test("listener bind failure rolls mode and autostart back", async () => {
  const h = harness({ startListener: async () => { throw new Error("EADDRINUSE"); } });
  h.state.consent = true;
  const result = await startQuickTransaction(h.deps, {});
  assert.equal(result.ok ? "" : result.code, "public_listener_start_failed");
  assert.equal(h.state.mode, null);
  assert.equal(h.state.autoStart, false);
  assert.equal(h.state.spawns, 0);
});

test("Quick startup failure stops owned runtime, closes a new listener, and rolls persistence back", async () => {
  const h = harness();
  h.deps.startTunnel = async () => {
    h.state.spawns += 1;
    h.state.tunnel = true;
    return { status: "ERROR", lastError: "no URL" };
  };
  h.state.consent = true;
  const result = await startQuickTransaction(h.deps, {});
  assert.equal(result.ok ? "" : result.code, "quick_tunnel_start_failed");
  assert.equal(h.state.mode, null);
  assert.equal(h.state.autoStart, false);
  assert.equal(h.state.listener, false);
  assert.equal(h.state.tunnelStops, 1);
  assert.equal(h.state.consent, true);
});

test("serialized Start + Start creates one listener and one cloudflared child", async () => {
  const mutex = new AsyncLifecycleMutex();
  const h = harness();
  h.state.consent = true;
  await Promise.all([
    mutex.runExclusive(() => startQuickTransaction(h.deps, {})),
    mutex.runExclusive(() => startQuickTransaction(h.deps, {}))
  ]);
  assert.equal(h.state.spawns, 1);
  assert.equal(h.state.listenerStarts, 1);
  assert.equal(h.state.listener, true);
});

test("serialized Start + Stop cannot start a tunnel after Stop completes", async () => {
  const mutex = new AsyncLifecycleMutex();
  const gate = deferred();
  const h = harness({ prepareTunnel: async () => (await gate.promise, { ok: true }) });
  h.state.consent = true;
  const start = mutex.runExclusive(() => startQuickTransaction(h.deps, {}));
  const stop = stopQuick(mutex, h);
  gate.resolve();
  await Promise.all([start, stop]);
  assert.equal(h.state.mode, "off");
  assert.equal(h.state.listener, false);
  assert.equal(h.state.tunnel, false);
  assert.equal(h.state.spawns, 1);
});

test("serialized Stop + Stop is idempotent", async () => {
  const mutex = new AsyncLifecycleMutex();
  const h = harness();
  h.state.mode = "quick";
  h.state.autoStart = true;
  h.state.listener = true;
  h.state.tunnel = true;
  h.state.consent = true;
  await Promise.all([stopQuick(mutex, h), stopQuick(mutex, h)]);
  assert.equal(h.state.mode, "off");
  assert.equal(h.state.listener, false);
  assert.equal(h.state.tunnel, false);
  assert.equal(h.state.consent, true);
});

test("shutdown queued during Start runs after Start and leaves no runtime resources", async () => {
  const mutex = new AsyncLifecycleMutex();
  const gate = deferred();
  const h = harness({ startListener: async () => { await gate.promise; h.state.listener = true; } });
  h.state.consent = true;
  const start = mutex.runExclusive(() => startQuickTransaction(h.deps, {}));
  const shutdown = mutex.runExclusive(async () => {
    await h.deps.stopTunnel();
    await h.deps.stopListener();
  });
  gate.resolve();
  await Promise.all([start, shutdown]);
  assert.equal(h.state.listener, false);
  assert.equal(h.state.tunnel, false);
});

test("stalled preparation is aborted, releases the FIFO lock, and lets queued shutdown complete", async () => {
  const mutex = new AsyncLifecycleMutex();
  let aborted = false;
  const h = harness({
    prepareTunnel: (signal) =>
      new Promise((resolve) => {
        signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve({ ok: false, error: "aborted" });
          },
          { once: true }
        );
      })
  });
  h.state.consent = true;
  const start = mutex.runExclusive(() => startQuickTransaction(h.deps, { preparationTimeoutMs: 10 }));
  let shutdownCompleted = false;
  const shutdown = mutex.runExclusive(async () => {
    await h.deps.stopTunnel();
    await h.deps.stopListener();
    shutdownCompleted = true;
  });
  const result = await start;
  await shutdown;
  assert.equal(result.ok ? "" : result.code, "cloudflared_download_failed");
  assert.equal(aborted, true);
  assert.equal(shutdownCompleted, true);
  assert.equal(h.state.mode, null);
  assert.equal(h.state.autoStart, false);
  assert.equal(h.state.consent, true);
  assert.equal(h.state.listener, false);
  assert.equal(h.state.tunnel, false);
  assert.equal(h.state.spawns, 0);
});

test("automatic Quick preparation timeout rolls back runtime and lets queued shutdown complete", async () => {
  const mutex = new AsyncLifecycleMutex();
  let aborted = false;
  const h = harness({
    prepareTunnel: (signal) =>
      new Promise((resolve) => {
        signal?.addEventListener("abort", () => {
          aborted = true;
          resolve({ ok: false, error: "aborted" });
        }, { once: true });
      })
  });
  h.state.consent = true;
  let shutdownCompleted = false;
  const start = mutex.runExclusive(() => startAutomaticQuickRuntime(h.deps, 1));
  const shutdown = mutex.runExclusive(async () => {
    await h.deps.stopTunnel();
    await h.deps.stopListener();
    shutdownCompleted = true;
  });
  await assert.rejects(start, /timed out|aborted/);
  await shutdown;
  assert.equal(aborted, true);
  assert.equal(shutdownCompleted, true);
  assert.equal(h.state.mode, null);
  assert.equal(h.state.autoStart, false);
  assert.equal(h.state.consent, true);
  assert.equal(h.state.listener, false);
  assert.equal(h.state.tunnel, false);
  assert.equal(h.state.spawns, 0);
});

test("named startup awaits listener success and preserves enabled autostart", async () => {
  const mutex = new AsyncLifecycleMutex();
  const events: string[] = [];
  await startNamedRuntimeAtStartup({
    mutex,
    startListener: async () => {
      events.push("listener-start");
      await Promise.resolve();
      events.push("listener-ready");
    },
    shouldStartTunnel: () => true,
    startTunnel: async () => {
      events.push("tunnel-started");
    }
  });
  assert.deepEqual(events, ["listener-start", "listener-ready", "tunnel-started"]);
});

test("named startup starts its listener but suppresses cloudflared when autostart is disabled", async () => {
  const mutex = new AsyncLifecycleMutex();
  let listener = false;
  let tunnelStarts = 0;
  await startNamedRuntimeAtStartup({
    mutex,
    startListener: async () => {
      listener = true;
    },
    shouldStartTunnel: () => false,
    startTunnel: async () => {
      tunnelStarts += 1;
    }
  });
  assert.equal(listener, true);
  assert.equal(tunnelStarts, 0);
});

test("named listener bind failure rejects startup and does not start cloudflared", async () => {
  const mutex = new AsyncLifecycleMutex();
  let tunnelStarts = 0;
  await assert.rejects(
    startNamedRuntimeAtStartup({
      mutex,
      startListener: async () => {
        throw new Error("EADDRINUSE");
      },
      shouldStartTunnel: () => true,
      startTunnel: async () => {
        tunnelStarts += 1;
      }
    }),
    /EADDRINUSE/
  );
  assert.equal(tunnelStarts, 0);
});

test("named startup intent remains ahead of a queued Stop while API startup waits only for listener readiness", async () => {
  const mutex = new AsyncLifecycleMutex();
  const tunnelGate = deferred();
  let listener = false;
  let tunnel = false;
  let tunnelStartEntered = false;
  let stopCompleted = false;

  await startNamedRuntimeAtStartup({
    mutex,
    startListener: async () => {
      listener = true;
    },
    shouldStartTunnel: () => true,
    startTunnel: async () => {
      tunnelStartEntered = true;
      await tunnelGate.promise;
      tunnel = true;
    }
  });
  assert.equal(tunnelStartEntered, true);

  const stop = mutex.runExclusive(async () => {
    tunnel = false;
    listener = false;
    stopCompleted = true;
  });
  await Promise.resolve();
  assert.equal(stopCompleted, false);

  tunnelGate.resolve();
  await stop;
  assert.equal(stopCompleted, true);
  assert.equal(listener, false);
  assert.equal(tunnel, false);
});
