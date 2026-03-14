import test from "node:test";
import assert from "node:assert/strict";
import { resolveCapabilityRouting } from "./capabilityRouting.js";

test("keeps sovereign node effective when local infrastructure is ready", () => {
  const result = resolveCapabilityRouting({
    selectedParticipationMode: "sovereign_node_operator",
    stablePublicHostConfigured: true,
    temporaryEndpointActive: false,
    canonicalCommerceConfigured: true,
    lndReady: true,
    chainReady: true,
    replayReady: true,
    providerCapable: true,
    localCommerceHost: "https://creator.example.com",
    localSettlementHost: "https://creator.example.com",
    providerHost: "https://provider.example.com"
  });

  assert.equal(result.effectiveParticipationMode, "sovereign_node_operator");
  assert.deepEqual(result.delegatedCapabilities, []);
  assert.equal(result.effectiveCommerceHost, "https://creator.example.com");
});

test("falls back to delegated sovereign creator posture when local dependencies are missing", () => {
  const result = resolveCapabilityRouting({
    selectedParticipationMode: "sovereign_node_operator",
    stablePublicHostConfigured: false,
    temporaryEndpointActive: true,
    canonicalCommerceConfigured: false,
    lndReady: false,
    chainReady: false,
    replayReady: false,
    providerCapable: true,
    localCommerceHost: null,
    localSettlementHost: null,
    providerHost: "https://provider.example.com"
  });

  assert.equal(result.effectiveParticipationMode, "sovereign_creator_with_provider");
  assert.ok(result.delegatedCapabilities.includes("commerce_host"));
  assert.ok(result.delegatedCapabilities.includes("settlement"));
  assert.equal(result.effectiveBuyerRecoveryHost, "https://provider.example.com");
  assert.ok(result.readinessBlockers.some((v) => v.includes("Stable public host")));
});

test("marks sovereign creator unready when dependencies are missing and delegation is unavailable", () => {
  const result = resolveCapabilityRouting({
    selectedParticipationMode: "sovereign_creator",
    stablePublicHostConfigured: false,
    temporaryEndpointActive: true,
    canonicalCommerceConfigured: false,
    lndReady: false,
    chainReady: false,
    replayReady: false,
    providerCapable: false,
    localCommerceHost: null,
    localSettlementHost: null,
    providerHost: null
  });

  assert.equal(result.effectiveParticipationMode, "sovereign_creator_unready");
  assert.equal(result.effectiveCommerceHost, null);
  assert.ok(result.readinessBlockers.some((v) => v.includes("Provider delegation is required")));
});
