import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function run() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "contentbox-node-mode-"));
  const stateDir = path.join(tmp, "state");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(
    path.join(stateDir, "node_config.json"),
    JSON.stringify({ nodeMode: "lan", updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );

  process.env.CONTENTBOX_ROOT = tmp;
  process.env.NODE_MODE = "";
  process.env.STORAGE = "";
  process.env.DB_MODE = "basic";
  process.env.CONTENTBOX_LAN = "";

  const { resolveRuntimeConfig } = await import("../lib/nodeMode.js");
  let cfg = resolveRuntimeConfig();
  assert.equal(cfg.nodeMode, "lan");
  assert.equal(cfg.nodeModeSource, "file");

  process.env.NODE_MODE = "basic";
  cfg = resolveRuntimeConfig();
  assert.equal(cfg.nodeMode, "basic");
  assert.equal(cfg.nodeModeSource, "env");

  process.env.NODE_MODE = "";
  process.env.CONTENTBOX_LAN = "1";
  await fs.unlink(path.join(stateDir, "node_config.json"));
  cfg = resolveRuntimeConfig();
  assert.equal(cfg.nodeMode, "lan");
  assert.equal(cfg.nodeModeSource, "legacy");

  console.log("node_mode_persist_test OK");
}

run().catch((err) => {
  console.error("node_mode_persist_test FAILED", err);
  process.exit(1);
});
