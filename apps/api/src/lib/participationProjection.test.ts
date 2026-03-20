import test from "node:test";
import assert from "node:assert/strict";

import { canHighlightParticipation, isLockedParticipationProjectionEligible } from "./participationProjection.js";

test("locked accepted verified participant is eligible for participation projection", () => {
  const eligible = isLockedParticipationProjectionEligible({
    splitStatus: "locked",
    participantUserId: "user_1",
    acceptedAt: new Date(),
    verifiedAt: new Date(),
    invitationStatus: "accepted"
  });
  assert.equal(eligible, true);
});

test("draft split and pending/unverified rows are excluded from projection", () => {
  assert.equal(
    isLockedParticipationProjectionEligible({
      splitStatus: "draft",
      participantUserId: "user_1",
      acceptedAt: new Date(),
      verifiedAt: new Date(),
      invitationStatus: "accepted"
    }),
    false
  );
  assert.equal(
    isLockedParticipationProjectionEligible({
      splitStatus: "locked",
      participantUserId: "user_1",
      acceptedAt: null,
      verifiedAt: new Date(),
      invitationStatus: "pending"
    }),
    false
  );
});

test("profile highlight can only be changed by owning participant identity", () => {
  assert.equal(canHighlightParticipation({ requesterUserId: "user_1", participantUserId: "user_1" }), true);
  assert.equal(canHighlightParticipation({ requesterUserId: "user_1", participantUserId: "user_2" }), false);
  assert.equal(canHighlightParticipation({ requesterUserId: "user_1", participantUserId: null }), false);
});

