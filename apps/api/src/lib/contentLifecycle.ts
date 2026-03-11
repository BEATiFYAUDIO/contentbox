export type ContentLike = {
  status?: string | null;
  deletedAt?: string | Date | null;
};

export type ContentLifecycleState = "active" | "trash" | "archived";
export type ContentScope = "active" | "trash" | "tombstones" | "library";

export type GuardResult = { ok: true } | { ok: false; code: string; message: string };

function statusValue(item: ContentLike): string {
  return String(item?.status || "").trim().toLowerCase();
}

function hasDeletedAt(item: ContentLike): boolean {
  return Boolean(item?.deletedAt);
}

export function isPublished(item: ContentLike): boolean {
  return statusValue(item) === "published";
}

export function isActive(item: ContentLike): boolean {
  return !hasDeletedAt(item);
}

export function isTrashedDraft(item: ContentLike): boolean {
  return hasDeletedAt(item) && !isPublished(item);
}

export function isArchivedPublished(item: ContentLike): boolean {
  return hasDeletedAt(item) && isPublished(item);
}

export function isSaleable(item: ContentLike): boolean {
  return isPublished(item) && !hasDeletedAt(item);
}

export function lifecycleState(item: ContentLike): ContentLifecycleState {
  if (isArchivedPublished(item)) return "archived";
  if (isTrashedDraft(item)) return "trash";
  return "active";
}

export function matchesScope(item: ContentLike, scope: ContentScope): boolean {
  if (scope === "active") return isActive(item);
  if (scope === "trash") return isTrashedDraft(item);
  if (scope === "tombstones") return isArchivedPublished(item);
  return isPublished(item);
}

export function assertCanPublish(item: ContentLike): GuardResult {
  if (hasDeletedAt(item)) {
    return { ok: false, code: "TRASHED_CONTENT", message: "Restore this content before publishing." };
  }
  return { ok: true };
}

export function assertCanUpload(item: ContentLike, opts?: { allowPublished?: boolean }): GuardResult {
  if (isArchivedPublished(item)) {
    return { ok: false, code: "TOMBSTONED_CONTENT", message: "Removed from store." };
  }
  if (isTrashedDraft(item)) {
    return { ok: false, code: "TRASHED_CONTENT", message: "Restore this item from Trash before uploading." };
  }
  if (isPublished(item) && !opts?.allowPublished) {
    return {
      ok: false,
      code: "PUBLISHED_IMMUTABLE",
      message: "This published release is immutable. Create a new version to upload updated media."
    };
  }
  return { ok: true };
}

export function assertCanTrash(item: ContentLike): GuardResult {
  if (isPublished(item)) {
    return { ok: false, code: "PUBLISHED_TRASH_BLOCKED", message: "Published items cannot be trashed." };
  }
  if (hasDeletedAt(item)) {
    return { ok: false, code: "ALREADY_DELETED", message: "Item is already deleted." };
  }
  return { ok: true };
}

export function assertCanArchive(item: ContentLike): GuardResult {
  if (!isPublished(item)) {
    return { ok: false, code: "ARCHIVE_REQUIRES_PUBLISHED", message: "Only published content can be archived." };
  }
  if (hasDeletedAt(item)) {
    return { ok: false, code: "ALREADY_ARCHIVED", message: "Item is already archived." };
  }
  return { ok: true };
}

export function assertCanRestore(item: ContentLike): GuardResult {
  if (isPublished(item)) {
    return {
      ok: false,
      code: "TOMBSTONED_CONTENT",
      message: "Published tombstones cannot be restored from Trash."
    };
  }
  return { ok: true };
}

export function shouldTombstoneOnDelete(item: ContentLike, entitlementsCount: number, paidCount: number): boolean {
  if (!isPublished(item)) return false;
  return entitlementsCount > 0 || paidCount > 0;
}

export function evaluatePublicBuyAccess(item: ContentLike, entitled: boolean): "saleable" | "removed" | "not_found" {
  if (isSaleable(item)) return "saleable";
  if (isArchivedPublished(item)) return entitled ? "saleable" : "removed";
  return "not_found";
}
