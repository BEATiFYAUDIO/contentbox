import assert from "node:assert/strict";
import test from "node:test";
import { PublicStateEpoch } from "./publicServingGate.js";

test("explicit OFF blocks every public route outside a scoped identity probe", () => {
  const epoch = new PublicStateEpoch("boot-a");
  assert.equal(epoch.allowsPublicRequest("off", "/"), false);
  assert.equal(epoch.allowsPublicRequest("off", "/u/creator"), false);
  assert.equal(epoch.allowsPublicRequest("off", "/public/ping"), false);

  const probe = epoch.beginProbe("config-a");
  assert.equal(epoch.allowsPublicRequest("off", "/public/ping"), true);
  assert.equal(epoch.allowsPublicRequest("off", "/health"), false);
  assert.equal(epoch.allowsPublicRequest("off", "/u/creator"), false);
  epoch.finishProbe(probe);
  assert.equal(epoch.allowsPublicRequest("off", "/public/ping"), false);
});

test("Quick and named selections continue serving public routes", () => {
  const epoch = new PublicStateEpoch("boot-a");
  assert.equal(epoch.allowsPublicRequest("quick", "/u/creator"), true);
  assert.equal(epoch.allowsPublicRequest("named", "/buy/content"), true);
});

test("OFF, hostname, or mode mutation invalidates an in-flight verification result", () => {
  const epoch = new PublicStateEpoch("boot-a");
  const old = epoch.beginProbe("config-a");
  epoch.invalidate();
  assert.equal(epoch.isCurrent(old, "config-a"), false);
  assert.equal(epoch.isCurrent(old, "config-b"), false);
  assert.equal(epoch.allowsPublicRequest("off", "/public/ping"), false);
});

test("verification snapshots cannot survive a Core restart", () => {
  const priorRuntime = new PublicStateEpoch("boot-a");
  const stale = priorRuntime.capture("config-a");
  const restartedRuntime = new PublicStateEpoch("boot-b");
  assert.equal(restartedRuntime.isCurrent(stale, "config-a"), false);
});
