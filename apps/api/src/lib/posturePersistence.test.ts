import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveSelectedParticipationMode } from "./participationMode.js";

test("explicit upgrade and downgrade persist node mode and product tier across resolver reads", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "certifyd-posture-"));
  const before = {
    CONTENTBOX_ROOT: process.env.CONTENTBOX_ROOT,
    NODE_MODE: process.env.NODE_MODE,
    PRODUCT_TIER: process.env.PRODUCT_TIER,
    DB_MODE: process.env.DB_MODE,
    CONTENTBOX_LAN: process.env.CONTENTBOX_LAN
  };
  process.env.CONTENTBOX_ROOT = root;
  process.env.NODE_MODE = "";
  process.env.PRODUCT_TIER = "";
  process.env.DB_MODE = "basic";
  process.env.CONTENTBOX_LAN = "";
  try {
    const { readNodeConfig, writeNodeConfig, writeProductTier } = await import("./nodeConfig.js");
    const { resolveRuntimeConfig } = await import("./nodeMode.js");
    const { resolveProductTier } = await import("./productTier.js");

    await writeNodeConfig("advanced");
    await writeProductTier("advanced");
    assert.deepEqual(
      { nodeMode: resolveRuntimeConfig().nodeMode, productTier: resolveProductTier().productTier },
      { nodeMode: "advanced", productTier: "advanced" }
    );
    assert.equal(
      resolveSelectedParticipationMode({
        nodeMode: resolveRuntimeConfig().nodeMode,
        productTier: resolveProductTier().productTier,
        providerConnected: false
      }),
      "sovereign_creator"
    );
    assert.deepEqual(
      (({ nodeMode, productTier }) => ({ nodeMode, productTier }))(await readNodeConfig() as any),
      { nodeMode: "advanced", productTier: "advanced" }
    );

    await writeNodeConfig("basic");
    await writeProductTier("basic");
    assert.deepEqual(
      { nodeMode: resolveRuntimeConfig().nodeMode, productTier: resolveProductTier().productTier },
      { nodeMode: "basic", productTier: "basic" }
    );
    assert.equal(
      resolveSelectedParticipationMode({
        nodeMode: resolveRuntimeConfig().nodeMode,
        productTier: resolveProductTier().productTier,
        providerConnected: true
      }),
      "basic_creator"
    );
    assert.deepEqual(
      (({ nodeMode, productTier }) => ({ nodeMode, productTier }))(await readNodeConfig() as any),
      { nodeMode: "basic", productTier: "basic" }
    );
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
