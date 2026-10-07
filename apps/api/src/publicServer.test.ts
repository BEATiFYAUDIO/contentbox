import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { AsyncLifecycleMutex, startNamedRuntimeAtStartup } from "./lib/publicLifecycle.js";
import { DEFAULT_PUBLIC_PORT, PublicServerLifecycle } from "./publicServer.js";

test("public listener can start dynamically on loopback and stop cleanly", async () => {
  const lifecycle = new PublicServerLifecycle();
  const app = await lifecycle.ensureStarted(
    (publicApp) => publicApp.get("/health", async () => ({ ok: true })),
    "127.0.0.1",
    0
  );
  try {
    assert.equal(lifecycle.isStarted(), true);
    assert.equal(await lifecycle.ensureStarted(() => undefined, "127.0.0.1", 0), app);
    const address = app.server.address();
    assert.ok(address && typeof address === "object");
    assert.equal(address.address, "127.0.0.1");
    assert.equal(DEFAULT_PUBLIC_PORT, 4010);
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
  } finally {
    await lifecycle.stop();
  }
  await lifecycle.stop();
  assert.equal(lifecycle.isStarted(), false);
});

test("public listener bind failure leaves lifecycle stopped", async () => {
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", resolve);
  });
  const address = blocker.address();
  assert.ok(address && typeof address === "object");
  const lifecycle = new PublicServerLifecycle();
  try {
    await assert.rejects(lifecycle.ensureStarted(() => undefined, "127.0.0.1", address.port));
    assert.equal(lifecycle.isStarted(), false);
    await lifecycle.stop();
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

test("named startup awaits a real listener before starting its tunnel", async () => {
  const lifecycle = new PublicServerLifecycle();
  let tunnelScheduled = false;
  try {
    await startNamedRuntimeAtStartup({
      mutex: new AsyncLifecycleMutex(),
      startListener: () =>
        lifecycle.ensureStarted((app) => app.get("/health", async () => ({ ok: true })), "127.0.0.1", 0).then(() => undefined),
      shouldStartTunnel: () => true,
      startTunnel: async () => {
        assert.equal(lifecycle.isStarted(), true);
        tunnelScheduled = true;
      }
    });
    assert.equal(tunnelScheduled, true);
  } finally {
    await lifecycle.stop();
  }
});

test("named startup propagates a real listener bind failure and never starts its tunnel", async () => {
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", resolve);
  });
  const address = blocker.address();
  assert.ok(address && typeof address === "object");
  const lifecycle = new PublicServerLifecycle();
  let tunnelScheduled = false;
  try {
    await assert.rejects(
      startNamedRuntimeAtStartup({
        mutex: new AsyncLifecycleMutex(),
        startListener: () => lifecycle.ensureStarted(() => undefined, "127.0.0.1", address.port).then(() => undefined),
        shouldStartTunnel: () => true,
        startTunnel: async () => {
          tunnelScheduled = true;
        }
      })
    );
    assert.equal(tunnelScheduled, false);
    assert.equal(lifecycle.isStarted(), false);
  } finally {
    await lifecycle.stop();
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});
