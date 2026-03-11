import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCanArchive,
  assertCanPublish,
  assertCanRestore,
  assertCanTrash,
  assertCanUpload,
  evaluatePublicBuyAccess,
  isSaleable,
  isTrashedDraft,
  matchesScope,
  shouldTombstoneOnDelete
} from "./contentLifecycle.js";

const activeDraft = { status: "draft", deletedAt: null };
const trashedDraft = { status: "draft", deletedAt: new Date("2026-03-01T00:00:00Z") };
const activePublished = { status: "published", deletedAt: null };
const archivedPublished = { status: "published", deletedAt: new Date("2026-03-01T00:00:00Z") };

test("scope filters match lifecycle invariants", () => {
  const items = [activeDraft, trashedDraft, activePublished, archivedPublished];

  const active = items.filter((i) => matchesScope(i, "active"));
  assert.deepEqual(active, [activeDraft, activePublished]);

  const trash = items.filter((i) => matchesScope(i, "trash"));
  assert.deepEqual(trash, [trashedDraft]);
  assert.equal(trash.every((i) => isTrashedDraft(i)), true);

  const tombstones = items.filter((i) => matchesScope(i, "tombstones"));
  assert.deepEqual(tombstones, [archivedPublished]);

  const library = items.filter((i) => matchesScope(i, "library"));
  assert.deepEqual(library, [activePublished, archivedPublished]);
});

test("action guards enforce publish/trash/archive/restore semantics", () => {
  const publishBlocked = assertCanPublish(trashedDraft);
  assert.equal(publishBlocked.ok, false);
  if (!publishBlocked.ok) assert.equal(publishBlocked.code, "TRASHED_CONTENT");

  const canTrashDraft = assertCanTrash(activeDraft);
  assert.equal(canTrashDraft.ok, true);

  const cannotTrashPublished = assertCanTrash(activePublished);
  assert.equal(cannotTrashPublished.ok, false);

  const canArchivePublished = assertCanArchive(activePublished);
  assert.equal(canArchivePublished.ok, true);

  const restoreBlockedForArchived = assertCanRestore(archivedPublished);
  assert.equal(restoreBlockedForArchived.ok, false);
  if (!restoreBlockedForArchived.ok) assert.equal(restoreBlockedForArchived.code, "TOMBSTONED_CONTENT");

  const uploadBlockedForPublished = assertCanUpload(activePublished);
  assert.equal(uploadBlockedForPublished.ok, false);
  if (!uploadBlockedForPublished.ok) assert.equal(uploadBlockedForPublished.code, "PUBLISHED_IMMUTABLE");

  const coverUploadAllowedForPublished = assertCanUpload(activePublished, { allowPublished: true });
  assert.equal(coverUploadAllowedForPublished.ok, true);
});

test("delete mode for published with purchases becomes tombstone", () => {
  assert.equal(shouldTombstoneOnDelete(activePublished, 1, 0), true);
  assert.equal(shouldTombstoneOnDelete(activePublished, 0, 1), true);
  assert.equal(shouldTombstoneOnDelete(activePublished, 0, 0), false);
  assert.equal(shouldTombstoneOnDelete(activeDraft, 9, 9), false);
});

test("buy/public gating invariants hold", () => {
  assert.equal(isSaleable(activePublished), true);
  assert.equal(isSaleable(archivedPublished), false);
  assert.equal(isSaleable(activeDraft), false);

  assert.equal(evaluatePublicBuyAccess(activePublished, false), "saleable");
  assert.equal(evaluatePublicBuyAccess(archivedPublished, false), "removed");
  assert.equal(evaluatePublicBuyAccess(archivedPublished, true), "saleable");
  assert.equal(evaluatePublicBuyAccess(activeDraft, false), "not_found");
});

test("purchase-intent saleability guard equivalent", () => {
  const saleable = [activePublished].filter((i) => isSaleable(i));
  const blocked = [activeDraft, trashedDraft, archivedPublished].filter((i) => !isSaleable(i));
  assert.equal(saleable.length, 1);
  assert.equal(blocked.length, 3);
});
