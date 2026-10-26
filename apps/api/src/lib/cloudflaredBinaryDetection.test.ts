import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findCloudflaredBinary } from "./cloudflaredBinaryDetection.js";

test("cloudflared is found in a restricted launcher's PATH", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "certifyd-cloudflared-"));
  try {
    const binary = path.join(root, "cloudflared");
    fs.writeFileSync(binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    assert.equal(findCloudflaredBinary({ managedDir: path.join(root, "managed"), platform: "linux", pathEnv: root }), binary);
    if (process.platform !== "win32") {
      fs.chmodSync(binary, 0o644);
      assert.notEqual(findCloudflaredBinary({ managedDir: path.join(root, "managed"), platform: "linux", pathEnv: root }), binary);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("configured binary takes precedence over a PATH binary", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "certifyd-cloudflared-"));
  try {
    const configured = path.join(root, "connector");
    const inPath = path.join(root, "cloudflared");
    fs.writeFileSync(configured, "", { mode: 0o755 });
    fs.writeFileSync(inPath, "", { mode: 0o755 });
    assert.equal(findCloudflaredBinary({ configuredPath: configured, managedDir: root, platform: "linux", pathEnv: root }), configured);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
