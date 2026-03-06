import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAuthBootstrapStatus, shouldShowBootstrapCreate } from "../src/lib/authLanding.js";

test("empty DB shows bootstrap create flow", () => {
  const status = normalizeAuthBootstrapStatus({
    hasUsers: false,
    hasOwner: false,
    recoveryAvailable: false
  });
  assert.equal(shouldShowBootstrapCreate(status), true);
});

test("existing users signed out shows sign in flow", () => {
  const status = normalizeAuthBootstrapStatus({
    hasUsers: true,
    hasOwner: true,
    recoveryAvailable: true
  });
  assert.equal(shouldShowBootstrapCreate(status), false);
});

test("existing users without recovery still shows sign in flow", () => {
  const status = normalizeAuthBootstrapStatus({
    hasUsers: true,
    hasOwner: true,
    recoveryAvailable: false
  });
  assert.equal(shouldShowBootstrapCreate(status), false);
});
