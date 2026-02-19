import assert from "node:assert/strict";
import {
  canAdvancedSplits,
  canDerivatives,
  canMultiUser,
  canPublicShare,
  getNodeMode,
  getStorageEngine,
  lockReason,
  resolveRuntimeConfig,
  shouldBlockAdditionalUser
} from "../lib/nodeMode.js";

function withEnv(next: Record<string, string | undefined>, fn: () => void) {
  const before = {
    DB_MODE: process.env.DB_MODE,
    NODE_MODE: process.env.NODE_MODE,
    STORAGE: process.env.STORAGE,
    CONTENTBOX_LAN: process.env.CONTENTBOX_LAN,
    CONTENTBOX_ALLOW_MULTI_USER: process.env.CONTENTBOX_ALLOW_MULTI_USER
  };
  Object.assign(process.env, next);
  try {
    fn();
  } finally {
    process.env.DB_MODE = before.DB_MODE;
    process.env.NODE_MODE = before.NODE_MODE;
    process.env.STORAGE = before.STORAGE;
    process.env.CONTENTBOX_LAN = before.CONTENTBOX_LAN;
    process.env.CONTENTBOX_ALLOW_MULTI_USER = before.CONTENTBOX_ALLOW_MULTI_USER;
  }
}

withEnv({ DB_MODE: "", NODE_MODE: "", STORAGE: "", CONTENTBOX_LAN: "" }, () => {
  const mode = getNodeMode();
  const storage = getStorageEngine();
  assert.equal(mode, "basic");
  assert.equal(storage, "sqlite");
  assert.equal(canPublicShare(mode), false);
  assert.equal(canDerivatives(mode), false);
  assert.equal(canAdvancedSplits(mode), false);
  assert.equal(canMultiUser(mode), false);
  assert.ok(lockReason("advanced_splits", mode).length > 0);
});

withEnv({ DB_MODE: "advanced", NODE_MODE: "", STORAGE: "", CONTENTBOX_LAN: "" }, () => {
  const mode = getNodeMode();
  const storage = getStorageEngine();
  assert.equal(mode, "advanced");
  assert.equal(storage, "postgres");
  assert.equal(canPublicShare(mode), true);
  assert.equal(canDerivatives(mode), true);
  assert.equal(canAdvancedSplits(mode), true);
  assert.equal(canMultiUser(mode), false);
});

withEnv({ DB_MODE: "advanced", NODE_MODE: "", STORAGE: "", CONTENTBOX_LAN: "1" }, () => {
  const mode = getNodeMode();
  const storage = getStorageEngine();
  assert.equal(mode, "lan");
  assert.equal(storage, "postgres");
  assert.equal(canPublicShare(mode), false);
  assert.equal(canDerivatives(mode), true);
  assert.equal(canAdvancedSplits(mode), true);
  assert.equal(canMultiUser(mode), true);
});

withEnv({ DB_MODE: "weird", NODE_MODE: "", STORAGE: "", CONTENTBOX_LAN: "" }, () => {
  const mode = getNodeMode();
  const storage = getStorageEngine();
  assert.equal(mode, "basic");
  assert.equal(storage, "sqlite");
});

withEnv({ DB_MODE: "basic", NODE_MODE: "lan", STORAGE: "sqlite", CONTENTBOX_LAN: "" }, () => {
  const cfg = resolveRuntimeConfig();
  assert.equal(cfg.nodeMode, "lan");
  assert.equal(cfg.storage, "sqlite");
});

withEnv({ DB_MODE: "advanced", NODE_MODE: "basic", STORAGE: "postgres", CONTENTBOX_LAN: "1" }, () => {
  const cfg = resolveRuntimeConfig();
  assert.equal(cfg.nodeMode, "basic");
  assert.equal(cfg.storage, "postgres");
});

assert.equal(shouldBlockAdditionalUser("advanced", false, true), true);
assert.equal(shouldBlockAdditionalUser("advanced", true, true), false);
assert.equal(shouldBlockAdditionalUser("lan", false, true), false);

console.log("node_mode_test OK");
