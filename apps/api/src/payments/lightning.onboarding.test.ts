import test from "node:test";
import assert from "node:assert/strict";
import {
  interpretLightningDiscoveryHttpProbe,
  interpretLightningDiscoveryError,
  mapLightningReadinessFromLnd
} from "./lightning.js";

test("discovery parser recognizes LND REST macaroon-missing response", () => {
  const out = interpretLightningDiscoveryHttpProbe({
    restUrl: "https://127.0.0.1:8080",
    status: 401,
    text: '{"message":"expected 1 macaroon, got 0"}'
  });
  assert.ok(out);
  assert.equal(out?.restUrl, "https://127.0.0.1:8080");
  assert.match(String(out?.notes || ""), /upload macaroon/i);
});

test("discovery parser flags self-signed TLS errors", () => {
  const out = interpretLightningDiscoveryError("https://localhost:8080", new Error("self signed certificate"));
  assert.ok(out);
  assert.equal(out?.restUrl, "https://localhost:8080");
  assert.equal(Boolean(out?.requiresTlsCertHint), true);
});

test("readiness mapping reports not receive-ready when zero channels", () => {
  const readiness = mapLightningReadinessFromLnd({
    getinfo: {
      synced_to_chain: true,
      synced_to_graph: true,
      block_height: 900001
    },
    channels: { channels: [] }
  });

  assert.equal(readiness.ok, true);
  assert.equal(readiness.configured, true);
  assert.equal(readiness.nodeReachable, true);
  assert.equal(readiness.wallet.syncedToChain, true);
  assert.equal(readiness.wallet.syncedToGraph, true);
  assert.equal(readiness.channels.count, 0);
  assert.equal(readiness.receiveReady, false);
  assert.ok(readiness.hints.some((h) => /no channels/i.test(h)));
});

