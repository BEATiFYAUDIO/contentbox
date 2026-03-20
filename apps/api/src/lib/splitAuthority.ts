type SplitStatusLike = string | null | undefined;

type SplitVersionLike<TParticipant = unknown> = {
  id: string;
  versionNumber: number;
  status: SplitStatusLike;
  participants?: TParticipant[];
};

type ParticipantLike = {
  participantUserId?: string | null;
  acceptedAt?: Date | string | null;
  verifiedAt?: Date | string | null;
  invitation?: { status?: string | null } | null;
};

type DerivativeParentLinkLike = {
  id?: string | null;
  parentContentId: string;
  parentSplitVersionId?: string | null;
};

const ACCEPTED_INVITE_STATUS = "accepted";

function normalizeSplitStatus(status: SplitStatusLike): string {
  return String(status || "").trim().toLowerCase();
}

function normalizeInviteStatus(status: string | null | undefined): string {
  return String(status || "").trim().toLowerCase();
}

export function isCommerceEligibleLockedParticipant(participant: ParticipantLike): boolean {
  const inviteStatus = normalizeInviteStatus(participant?.invitation?.status);
  return Boolean(
    participant?.participantUserId &&
      participant?.acceptedAt &&
      participant?.verifiedAt &&
      (inviteStatus === ACCEPTED_INVITE_STATUS || !inviteStatus)
  );
}

export function filterCommerceEligibleParticipants<T extends ParticipantLike>(participants: T[]): T[] {
  return participants.filter((participant) => isCommerceEligibleLockedParticipant(participant));
}

export function pickLatestDraftSplitVersion<T extends SplitVersionLike>(versions: T[]): T | null {
  const drafts = versions.filter((version) => normalizeSplitStatus(version.status) === "draft");
  if (!drafts.length) return null;
  return drafts.sort((a, b) => b.versionNumber - a.versionNumber)[0] || null;
}

export function pickLockedSplitVersionForCommerce<T extends SplitVersionLike>(
  versions: T[],
  currentSplitId?: string | null
): T | null {
  const locked = versions.filter((version) => normalizeSplitStatus(version.status) === "locked");
  if (!locked.length) return null;
  const preferredId = String(currentSplitId || "").trim();
  if (preferredId) {
    const preferred = locked.find((version) => version.id === preferredId);
    if (preferred) return preferred;
  }
  return locked.sort((a, b) => b.versionNumber - a.versionNumber)[0] || null;
}

export function requireDerivativeParentSplitSnapshotId(link: DerivativeParentLinkLike): string {
  const parentSplitVersionId = String(link.parentSplitVersionId || "").trim();
  if (parentSplitVersionId) return parentSplitVersionId;
  const err = new Error("PARENT_SPLIT_SNAPSHOT_REQUIRED");
  (err as any).code = "PARENT_SPLIT_SNAPSHOT_REQUIRED";
  (err as any).statusCode = 409;
  (err as any).details = {
    parentContentId: String(link.parentContentId || "").trim(),
    contentLinkId: String(link.id || "").trim() || null
  };
  throw err;
}
