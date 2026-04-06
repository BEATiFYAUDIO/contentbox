import test from "node:test";
import assert from "node:assert/strict";
import { deriveActivationStatusMessageFromNetwork, deriveUserNetworkStatusFromState } from "./userNetworkStatus.js";

const baseInput = {
  runtimeReady: true,
  participationMode: "sovereign_creator_with_provider" as const,
  nodeMode: "advanced" as const,
  sovereignReady: false,
  namedTunnelDetected: true,
  localBitcoinReady: false,
  localLndReady: false,
  localCommerceReady: false,
  trustReadiness: "blocked" as const,
  ackReadiness: "blocked" as const,
  permitReadiness: "blocked" as const,
  chainReady: false,
  chainMessage: "Provider execution prerequisites are not satisfied.",
  ackMessage: "Valid provider acknowledgment is required for this action.",
  permitMessage: "Valid provider execution permit is required for this action."
};

test("provider unreachable maps to offline with explicit reason", () => {
  const status = deriveUserNetworkStatusFromState({
    ...baseInput,
    trustReadiness: "unreachable",
    ackReadiness: "blocked",
    permitReadiness: "blocked",
    chainReady: false
  });
  assert.equal(status.status, "offline");
  assert.equal(status.reason, "provider_unreachable");
});

test("provider verified + ack + permit ready maps to ready (not offline)", () => {
  const status = deriveUserNetworkStatusFromState({
    ...baseInput,
    trustReadiness: "ready",
    ackReadiness: "ready",
    permitReadiness: "ready",
    chainReady: true
  });
  assert.equal(status.status, "ready");
  assert.equal(status.reason, "provider_ready");
});

test("activation message tracks network status coherently", () => {
  const readyStatus = deriveUserNetworkStatusFromState({
    ...baseInput,
    trustReadiness: "ready",
    ackReadiness: "ready",
    permitReadiness: "ready",
    chainReady: true
  });
  const blockedStatus = deriveUserNetworkStatusFromState({
    ...baseInput,
    trustReadiness: "blocked",
    ackReadiness: "not_current",
    permitReadiness: "not_current",
    chainReady: false,
    ackMessage: "Stored provider acknowledgment is for a different provider target.",
    permitMessage: "Stored provider execution permit is for a different provider target."
  });
  assert.match(deriveActivationStatusMessageFromNetwork(readyStatus), /Setup is ready/i);
  assert.equal(deriveActivationStatusMessageFromNetwork(blockedStatus), blockedStatus.message);
});
