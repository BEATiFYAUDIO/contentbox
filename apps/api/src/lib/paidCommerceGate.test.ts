import test from "node:test";
import assert from "node:assert/strict";
import { canEnablePaidCommerce, isTemporaryEndpoint } from "./paidCommerceGate.js";

test("temporary endpoint helper marks non-stable as temporary", () => {
  assert.equal(isTemporaryEndpoint("temporary"), true);
  assert.equal(isTemporaryEndpoint("unknown"), true);
  assert.equal(isTemporaryEndpoint("stable"), false);
});

test("basic mode is not allowed for durable paid commerce", () => {
  const gate = canEnablePaidCommerce({
    mode: "basic",
    endpointStability: "stable",
    canonicalCommerceConfigured: true
  });
  assert.equal(gate.allowed, false);
  assert.match(String(gate.reason), /Sovereign Creator|durable paid commerce/i);
});

test("sovereign paid commerce requires stable and configured canonical host", () => {
  const missingCanonical = canEnablePaidCommerce({
    mode: "sovereign_provider",
    endpointStability: "stable",
    canonicalCommerceConfigured: false
  });
  assert.equal(missingCanonical.allowed, false);

  const temporary = canEnablePaidCommerce({
    mode: "sovereign_node",
    endpointStability: "temporary",
    canonicalCommerceConfigured: true
  });
  assert.equal(temporary.allowed, false);

  const ready = canEnablePaidCommerce({
    mode: "sovereign_provider",
    endpointStability: "stable",
    canonicalCommerceConfigured: true
  });
  assert.equal(ready.allowed, true);
  assert.equal(ready.reason, null);
});
