import test from "node:test";
import assert from "node:assert/strict";
import { classifyDelegatedPublishFailure } from "./contentPublishDelegation.js";

test("delegated publish 409 relationship-required is skippable", () => {
  const action = classifyDelegatedPublishFailure({
    providerStatus: 409,
    providerCode: "PROVIDER_CREATOR_RELATIONSHIP_REQUIRED"
  });
  assert.equal(action, "skip_relationship_required");
});

test("delegated publish 409 non-relationship is conflict", () => {
  const action = classifyDelegatedPublishFailure({
    providerStatus: 409,
    providerCode: "DELEGATED_PUBLISH_REQUIRED"
  });
  assert.equal(action, "conflict");
});

test("delegated publish non-409 is bad gateway", () => {
  const action = classifyDelegatedPublishFailure({
    providerStatus: 503,
    providerCode: "ANY"
  });
  assert.equal(action, "bad_gateway");
});

