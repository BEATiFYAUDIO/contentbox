import test from "node:test";
import assert from "node:assert/strict";

import { evaluateParticipantIdentityGate } from "./participantIdentityGate.js";

test("remote accepted participant with split snapshot verification is commerce-eligible without local witness key", () => {
  const gate = evaluateParticipantIdentityGate({
    userId: "remote_user_1",
    splitParticipantId: "sp_1",
    splitParticipantExists: true,
    splitParticipantUserId: "remote_user_1",
    signedAccepted: true,
    splitSnapshotVerified: true,
    localWitnessVerified: false
  });
  assert.deepEqual(gate, { active: true, readinessReason: null });
});

test("unaccepted participant remains unresolved", () => {
  const gate = evaluateParticipantIdentityGate({
    userId: "u1",
    splitParticipantId: "sp_1",
    splitParticipantExists: true,
    splitParticipantUserId: "u1",
    signedAccepted: false,
    splitSnapshotVerified: true,
    localWitnessVerified: true
  });
  assert.deepEqual(gate, { active: false, readinessReason: "INVITE_UNRESOLVED" });
});

test("accepted participant without snapshot verification or local witness key is key-unverified", () => {
  const gate = evaluateParticipantIdentityGate({
    userId: "u1",
    splitParticipantId: "sp_1",
    splitParticipantExists: true,
    splitParticipantUserId: "u1",
    signedAccepted: true,
    splitSnapshotVerified: false,
    localWitnessVerified: false
  });
  assert.deepEqual(gate, { active: false, readinessReason: "KEY_UNVERIFIED" });
});
