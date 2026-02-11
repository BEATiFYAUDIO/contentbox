import assert from "node:assert/strict";
import { mapLightningErrorMessage } from "../lib/railHealth.js";

function run() {
  const res = mapLightningErrorMessage("verification failed: signature mismatch after caveat verification");
  assert.equal(res.status, "degraded");
  assert.ok(res.reason.toLowerCase().includes("macaroon"));
  assert.ok(res.hint && res.hint.toLowerCase().includes("macaroon"));

  const locked = mapLightningErrorMessage("wallet is locked");
  assert.equal(locked.status, "locked");

  const tls = mapLightningErrorMessage("certificate signed by unknown authority");
  assert.equal(tls.status, "degraded");

  const down = mapLightningErrorMessage("connect ECONNREFUSED 127.0.0.1:8080");
  assert.equal(down.status, "disconnected");

  console.log("rail_health_test ok");
}

run();
