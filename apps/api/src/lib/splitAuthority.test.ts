import test from "node:test";
import assert from "node:assert/strict";

import {
  filterCommerceEligibleParticipants,
  isCommerceEligibleLockedParticipant,
  pickLatestDraftSplitVersion,
  pickLockedSplitVersionForCommerce,
  requireDerivativeParentSplitSnapshotId
} from "./splitAuthority.js";

test("commerce participant eligibility requires bound user + accepted + verified", () => {
  assert.equal(
    isCommerceEligibleLockedParticipant({
      participantUserId: "user_1",
      acceptedAt: new Date(),
      verifiedAt: new Date(),
      invitation: { status: "accepted" }
    }),
    true
  );
  assert.equal(
    isCommerceEligibleLockedParticipant({
      participantUserId: "user_1",
      acceptedAt: new Date(),
      verifiedAt: null,
      invitation: { status: "accepted" }
    }),
    false
  );
  assert.equal(
    isCommerceEligibleLockedParticipant({
      participantUserId: null,
      acceptedAt: new Date(),
      verifiedAt: new Date(),
      invitation: { status: "accepted" }
    }),
    false
  );
});

test("filtering excludes pending/unbound participants from commerce authority set", () => {
  const participants = [
    { id: "active", participantUserId: "u1", acceptedAt: new Date(), verifiedAt: new Date(), invitation: { status: "accepted" } },
    { id: "pending", participantUserId: null, acceptedAt: null, verifiedAt: null, invitation: { status: "pending" } },
    { id: "unverified", participantUserId: "u2", acceptedAt: new Date(), verifiedAt: null, invitation: { status: "accepted" } }
  ];
  const eligible = filterCommerceEligibleParticipants(participants);
  assert.deepEqual(
    eligible.map((row) => row.id),
    ["active"]
  );
});

test("latest draft selection ignores locked versions", () => {
  const versions = [
    { id: "v1", versionNumber: 1, status: "locked" },
    { id: "v2", versionNumber: 2, status: "draft" },
    { id: "v3", versionNumber: 3, status: "draft" }
  ];
  const latestDraft = pickLatestDraftSplitVersion(versions);
  assert.equal(latestDraft?.id, "v3");
});

test("locked split selection prefers current locked split and is stable vs newer drafts", () => {
  const versions = [
    { id: "v1", versionNumber: 1, status: "locked" },
    { id: "v2", versionNumber: 2, status: "draft" },
    { id: "v3", versionNumber: 3, status: "draft" },
    { id: "v4", versionNumber: 4, status: "locked" }
  ];
  const selectedCurrent = pickLockedSplitVersionForCommerce(versions, "v1");
  assert.equal(selectedCurrent?.id, "v1");

  const selectedLatestLocked = pickLockedSplitVersionForCommerce(versions, null);
  assert.equal(selectedLatestLocked?.id, "v4");
});

test("derivative allocation requires explicit parent split snapshot id", () => {
  assert.equal(
    requireDerivativeParentSplitSnapshotId({
      id: "link_1",
      parentContentId: "parent_1",
      parentSplitVersionId: "split_123"
    }),
    "split_123"
  );
  assert.throws(
    () =>
      requireDerivativeParentSplitSnapshotId({
        id: "link_2",
        parentContentId: "parent_2",
        parentSplitVersionId: null
      }),
    (err: any) => err?.code === "PARENT_SPLIT_SNAPSHOT_REQUIRED"
  );
});
