import test from "node:test";
import assert from "node:assert/strict";
import {
  interpretLightningDiscoveryHttpProbe,
  interpretLightningDiscoveryError,
  LND_RPC_INVENTORY,
  getRequiredLndRpcPermissions,
  mapLightningReadinessFromLnd,
  mapPendingOpenChannelsFromLnd
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

test("pending channel mapping includes balances and confirmation fields", () => {
  const pending = mapPendingOpenChannelsFromLnd({
    pending_open_channels: [
      {
        channel: {
          remote_node_pub: "03abc",
          channel_point: "txid:1",
          capacity: "30000",
          local_balance: "28708",
          remote_balance: "1292",
          confirmations_until_active: 3,
          confirmation_height: 901234
        }
      }
    ]
  });

  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0], {
    status: "pending_open",
    pendingType: "opening",
    peerPubkey: "03abc",
    channelPoint: "txid:1",
    capacitySats: 30000,
    localSats: 28708,
    remoteSats: 1292,
    confirmationsUntilActive: 3,
    confirmationHeight: 901234
  });
});

test("LND RPC inventory separates invoice, read, send and operator credentials", () => {
  const invoice = getRequiredLndRpcPermissions("invoice").join("\n");
  const read = getRequiredLndRpcPermissions("read").join("\n");
  const send = getRequiredLndRpcPermissions("send").join("\n");
  const operator = getRequiredLndRpcPermissions("operator").join("\n");

  assert.match(invoice, /AddInvoice/);
  assert.match(invoice, /LookupInvoice/);
  assert.doesNotMatch(invoice, /SendPayment|OpenChannel|CloseChannel|ConnectPeer/);

  assert.match(read, /GetInfo/);
  assert.match(read, /ListChannels/);
  assert.doesNotMatch(read, /AddInvoice|SendPayment|OpenChannel|CloseChannel|ConnectPeer/);

  assert.match(send, /SendPaymentV2/);
  assert.match(send, /DecodePayReq/);
  assert.doesNotMatch(send, /OpenChannel|CloseChannel|ConnectPeer|AddInvoice/);

  assert.match(operator, /OpenChannelSync/);
  assert.match(operator, /CloseChannel/);
  assert.match(operator, /ConnectPeer/);
  assert.doesNotMatch(operator, /SendPaymentV2|AddInvoice/);
});

test("normal LND runtime inventory does not map admin-only RPCs to commerce credentials", () => {
  const commerceRoles = new Set(["invoice", "read", "send"]);
  const bad = LND_RPC_INVENTORY.filter((item) => {
    if (!commerceRoles.has(item.credentialRole)) return false;
    return /OpenChannel|CloseChannel|ConnectPeer/.test(item.rpc);
  });
  assert.deepEqual(bad, []);
});
