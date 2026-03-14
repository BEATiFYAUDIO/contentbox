import test from "node:test";
import assert from "node:assert/strict";
import {
  canActAsCommerceHost,
  canJoinNetworkAsNode,
  classifyEndpointStability,
  isStableNode,
  type CertifydNodeDescriptor
} from "./nodeRegistry.js";

function mkNode(partial: Partial<CertifydNodeDescriptor>): CertifydNodeDescriptor {
  return {
    nodeId: "node:test",
    nodeKind: "sovereign_creator",
    endpointUrl: "https://creator.example.com",
    endpointKind: "custom",
    stability: "stable",
    canonicalCommerceOrigin: "https://creator.example.com",
    canonicalCommerceKind: "self_hosted_stable",
    commerceCapable: true,
    replayCapable: true,
    settlementCapable: true,
    publicKey: "ed25519:test",
    displayName: "Creator",
    brandLabel: "Creator",
    ...partial
  };
}

test("classifies quick/temporary endpoints as temporary", () => {
  assert.equal(classifyEndpointStability({ endpointUrl: "https://abc.trycloudflare.com", endpointKind: "quick" }), "temporary");
  assert.equal(classifyEndpointStability({ endpointUrl: "http://127.0.0.1:4000", endpointKind: "custom" }), "temporary");
  assert.equal(classifyEndpointStability({ endpointUrl: "http://192.168.1.10:4000", endpointKind: "custom" }), "temporary");
});

test("classifies named/stable domains as stable", () => {
  assert.equal(classifyEndpointStability({ endpointUrl: "https://creator.example.com", endpointKind: "named" }), "stable");
  assert.equal(classifyEndpointStability({ endpointUrl: "https://node.artistname.com", endpointKind: "custom" }), "stable");
});

test("eligibility requires stable endpoint and commerce capability", () => {
  const stable = mkNode({});
  assert.equal(isStableNode(stable), true);
  assert.equal(canActAsCommerceHost(stable), true);
  assert.equal(canJoinNetworkAsNode(stable), true);

  const temporary = mkNode({ stability: "temporary", endpointUrl: "https://abc.trycloudflare.com" });
  assert.equal(isStableNode(temporary), false);
  assert.equal(canActAsCommerceHost(temporary), false);
  assert.equal(canJoinNetworkAsNode(temporary), false);

  const noSettlement = mkNode({ settlementCapable: false });
  assert.equal(canActAsCommerceHost(noSettlement), false);
  assert.equal(canJoinNetworkAsNode(noSettlement), false);
});

