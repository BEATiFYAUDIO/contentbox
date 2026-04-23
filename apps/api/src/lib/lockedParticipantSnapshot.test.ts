import test from "node:test";
import assert from "node:assert/strict";

import {
  isTopologyNeutralLockedSnapshotEligible,
  resolveLockedSnapshotAccountingState,
  resolveLockedSnapshotAttributionLabel,
  resolveLockedSnapshotDisplayLabel
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
    "test"
  );
});

test("display label uses entity/person priority for buyer attribution", () => {
  assert.equal(
    resolveLockedSnapshotDisplayLabel({
      lockedDisplayName: null,
      entityDisplayName: "Beatify Group",
      creatorDisplayName: "Darryl Hillock",
      userDisplayName: "darryl",
      handleHint: "darryl",
      participantEmail: "darryl@beatifygroup.com"
    }),
    "Beatify Group"
  );
  assert.equal(
    resolveLockedSnapshotDisplayLabel({
      lockedDisplayName: null,
      entityDisplayName: null,
      creatorDisplayName: "Darryl Hillock",
      userDisplayName: null,
      handleHint: "darryl-hillock",
      participantEmail: "darrylhillock@gmail.com"
    }),
    "Darryl Hillock"
  );
});

test("attribution never uses internal user id labels", () => {
  assert.equal(
    resolveLockedSnapshotAttributionLabel({
      displayNameSnapshot: "cmmvmg5xh0006uvh4wvhbhbsg",
      handleSnapshot: "@cmmvmg5xh0006uvh4wvhbhbsg"
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
