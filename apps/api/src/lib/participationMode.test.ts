import assert from "node:assert/strict";
import test from "node:test";
import { resolveSelectedParticipationMode } from "./participationMode.js";

test("a verified named route does not implicitly upgrade Basic Creator", () => {
  assert.equal(
    resolveSelectedParticipationMode({ nodeMode: "basic", productTier: "basic", providerConnected: true }),
    "basic_creator"
  );
});

test("explicit Sovereign Creator selection controls participation and provider variant", () => {
  assert.equal(
    resolveSelectedParticipationMode({ nodeMode: "advanced", productTier: "advanced", providerConnected: false }),
    "sovereign_creator"
  );
  assert.equal(
    resolveSelectedParticipationMode({ nodeMode: "advanced", productTier: "advanced", providerConnected: true }),
    "sovereign_creator_with_provider"
  );
});

test("explicit Sovereign Node selection remains separate from route and local readiness", () => {
  assert.equal(
    resolveSelectedParticipationMode({ nodeMode: "lan", productTier: "lan", providerConnected: true }),
    "sovereign_node"
  );
});

test("partial or mismatched posture state fails closed to Basic Creator", () => {
  assert.equal(
    resolveSelectedParticipationMode({ nodeMode: "advanced", productTier: "basic", providerConnected: true }),
    "basic_creator"
  );
  assert.equal(
    resolveSelectedParticipationMode({ nodeMode: "basic", productTier: "advanced", providerConnected: true }),
    "basic_creator"
  );
});
