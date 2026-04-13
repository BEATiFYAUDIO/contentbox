import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTunnelConflictGuard, type TunnelConflictGuardState } from "./tunnelConflictGuard.js";

test("transient conflict does not become persistent before threshold", () => {
  const thresholdMs = 20_000;
  let state: TunnelConflictGuardState = { firstDetectedAtMs: null, persistent: false };

  const first = evaluateTunnelConflictGuard({
    hasConflict: true,
    nowMs: 1_000,
    thresholdMs,
    state
  });
  state = first.state;
  assert.equal(first.persistent, false);
  assert.equal(first.justBecamePersistent, false);

  const second = evaluateTunnelConflictGuard({
    hasConflict: true,
    nowMs: 20_999,
    thresholdMs,
    state
  });
  state = second.state;
  assert.equal(second.persistent, false);
  assert.equal(second.justBecamePersistent, false);
});

test("persistent conflict triggers once when threshold is crossed", () => {
  const thresholdMs = 20_000;
  let state: TunnelConflictGuardState = { firstDetectedAtMs: null, persistent: false };

  const first = evaluateTunnelConflictGuard({
    hasConflict: true,
    nowMs: 1_000,
    thresholdMs,
    state
  });
  state = first.state;

  const crossed = evaluateTunnelConflictGuard({
    hasConflict: true,
    nowMs: 21_000,
    thresholdMs,
    state
  });
  state = crossed.state;
  assert.equal(crossed.persistent, true);
  assert.equal(crossed.justBecamePersistent, true);

  const still = evaluateTunnelConflictGuard({
    hasConflict: true,
    nowMs: 40_000,
    thresholdMs,
    state
  });
  assert.equal(still.persistent, true);
  assert.equal(still.justBecamePersistent, false);
});

test("state resets when conflict clears", () => {
  const thresholdMs = 20_000;
  let state: TunnelConflictGuardState = { firstDetectedAtMs: 1_000, persistent: true };

  const cleared = evaluateTunnelConflictGuard({
    hasConflict: false,
    nowMs: 30_000,
    thresholdMs,
    state
  });
  assert.equal(cleared.persistent, false);
  assert.equal(cleared.state.firstDetectedAtMs, null);
  assert.equal(cleared.state.persistent, false);
});

