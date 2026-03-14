import test from "node:test";
import assert from "node:assert/strict";
import { resolveReplayMode } from "./replayResolution.js";

test("resolveReplayMode selects edge ticket when all requirements are present", () => {
  const mode = resolveReplayMode({
    edgeDeliveryEnabled: true,
    edgeTicketSecretConfigured: true,
    edgeBaseUrlConfigured: true,
    manifestSha256Present: true,
    primaryObjectKeyPresent: true
  });
  assert.equal(mode, "edge_ticket");
});

test("resolveReplayMode falls back to buy page when any requirement is missing", () => {
  const mode = resolveReplayMode({
    edgeDeliveryEnabled: true,
    edgeTicketSecretConfigured: true,
    edgeBaseUrlConfigured: false,
    manifestSha256Present: true,
    primaryObjectKeyPresent: true
  });
  assert.equal(mode, "buy_page");
});
