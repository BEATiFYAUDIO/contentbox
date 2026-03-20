import test from "node:test";
import assert from "node:assert/strict";

import {
  isTopologyNeutralLockedSnapshotEligible,
  resolveLockedSnapshotAccountingState,
  resolveLockedSnapshotAttributionLabel
} from "./lockedParticipantSnapshot.js";

test("locked participant snapshot eligibility is topology-neutral", () => {
  assert.equal(
    isTopologyNeutralLockedSnapshotEligible({
      participantUserId: null,
      identityRef: "identity_ref:node:abc:user:xyz",
      acceptedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString()
    }),
    true
  );
  assert.equal(
    isTopologyNeutralLockedSnapshotEligible({
      participantUserId: null,
      identityRef: null,
      participantEmail: null,
      acceptedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString()
    }),
    false
  );
});

test("attribution prefers snapshot identity labels over generic fallback", () => {
  assert.equal(
    resolveLockedSnapshotAttributionLabel({
      displayNameSnapshot: "DHillock",
      handleSnapshot: "@dhillock",
      participantEmail: "test@example.com"
    }),
    "DHillock"
  );
  assert.equal(
    resolveLockedSnapshotAttributionLabel({
      displayNameSnapshot: null,
      handleSnapshot: "@dhillock",
      participantEmail: "test@example.com"
    }),
    "@dhillock"
  );
  assert.equal(
    resolveLockedSnapshotAttributionLabel({
      displayNameSnapshot: null,
      handleSnapshot: null,
      participantEmail: "test@example.com",
      identityRef: "user:cmmabc123"
    }),
    "Contributor"
  );
});

test("accounting state marks unresolved routing as blocked but not omitted", () => {
  assert.deepEqual(
    resolveLockedSnapshotAccountingState({
      participantUserId: null,
      identityRef: "identity_ref:node:abc:user:xyz",
      acceptedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString()
    }),
    { state: "blocked", blockedReason: "IDENTITY_UNBOUND_LOCAL_USER" }
  );
  assert.deepEqual(
    resolveLockedSnapshotAccountingState({ participantUserId: "user_1" }),
    { state: "ready", blockedReason: null }
  );
});
