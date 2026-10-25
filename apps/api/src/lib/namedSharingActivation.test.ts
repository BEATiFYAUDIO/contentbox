import assert from "node:assert/strict";
import test from "node:test";
import { activateVerifiedNamedSharing } from "./namedSharingActivation.js";

test("a stale or failed verification cannot activate Named sharing", () => {
  const effects: string[] = [];
  const activated = activateVerifiedNamedSharing({
    isCurrent: () => false,
    persistSelection: () => { effects.push("saved"); return true; }
  });
  assert.equal(activated, "stale");
  assert.deepEqual(effects, []);
});

test("a verified creator choice succeeds only when its combined state write succeeds", () => {
  const effects: string[] = [];
  assert.equal(activateVerifiedNamedSharing({
    isCurrent: () => true,
    persistSelection: () => { effects.push("saved"); return true; }
  }), "activated");
  assert.deepEqual(effects, ["saved"]);
  assert.equal(activateVerifiedNamedSharing({ isCurrent: () => true, persistSelection: () => false }), "save_failed");
});
