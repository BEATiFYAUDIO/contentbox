import assert from "node:assert/strict";
import {
  canAdvancedSplits,
  canDerivatives,
  canMultiUser,
  canPublicShare,
  getNodeMode,
  lockReason,
  shouldBlockAdditionalUser
} from "../lib/nodeMode.js";

function withEnv(next: Record<string, string | undefined>, fn: () => void) {
  const before = {
    DB_MODE: process.env.DB_MODE,
    CONTENTBOX_LAN: process.env.CONTENTBOX_LAN,
    CONTENTBOX_ALLOW_MULTI_USER: process.env.CONTENTBOX_ALLOW_MULTI_USER
  };
  Object.assign(process.env, next);
  try {
    fn();
  } finally {
    process.env.DB_MODE = before.DB_MODE;
    process.env.CONTENTBOX_LAN = before.CONTENTBOX_LAN;
    process.env.CONTENTBOX_ALLOW_MULTI_USER = before.CONTENTBOX_ALLOW_MULTI_USER;
  }
}

withEnv({ DB_MODE: "", CONTENTBOX_LAN: "" }, () => {
  const mode = getNodeMode();
  assert.equal(mode, "basic");
  assert.equal(canPublicShare(mode), false);
  assert.equal(canDerivatives(mode), false);
  assert.equal(canAdvancedSplits(mode), false);
  assert.equal(canMultiUser(mode), false);
  assert.ok(lockReason("advanced_splits", mode).length > 0);
});

withEnv({ DB_MODE: "advanced", CONTENTBOX_LAN: "" }, () => {
  const mode = getNodeMode();
  assert.equal(mode, "advanced");
  assert.equal(canPublicShare(mode), true);
  assert.equal(canDerivatives(mode), true);
  assert.equal(canAdvancedSplits(mode), true);
  assert.equal(canMultiUser(mode), false);
});

withEnv({ DB_MODE: "advanced", CONTENTBOX_LAN: "1" }, () => {
  const mode = getNodeMode();
  assert.equal(mode, "lan");
  assert.equal(canPublicShare(mode), false);
  assert.equal(canDerivatives(mode), true);
  assert.equal(canAdvancedSplits(mode), true);
  assert.equal(canMultiUser(mode), true);
});

withEnv({ DB_MODE: "weird", CONTENTBOX_LAN: "" }, () => {
  const mode = getNodeMode();
  assert.equal(mode, "basic");
});

assert.equal(shouldBlockAdditionalUser("advanced", false, true), true);
assert.equal(shouldBlockAdditionalUser("advanced", true, true), false);
assert.equal(shouldBlockAdditionalUser("lan", false, true), false);

console.log("node_mode_test OK");
