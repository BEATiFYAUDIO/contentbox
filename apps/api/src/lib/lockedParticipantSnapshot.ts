export type LockedParticipantSnapshotLike = {
  participantUserId?: string | null;
  participantEmail?: string | null;
  identityRef?: string | null;
  acceptedAt?: string | Date | null;
  verifiedAt?: string | Date | null;
  displayNameSnapshot?: string | null;
  handleSnapshot?: string | null;
};

function looksLikeInternalUserId(value: string | null | undefined): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return /^c[a-z0-9]{20,}$/i.test(raw);
}

export function isTopologyNeutralLockedSnapshotEligible(snapshot: LockedParticipantSnapshotLike): boolean {
  return Boolean(
    snapshot?.acceptedAt &&
      snapshot?.verifiedAt &&
      (snapshot?.participantUserId || snapshot?.identityRef || snapshot?.participantEmail)
  );
}

export function resolveLockedSnapshotAttributionLabel(snapshot: LockedParticipantSnapshotLike): string {
  const displayName = String(snapshot?.displayNameSnapshot || "").trim();
  if (displayName && !looksLikeInternalUserId(displayName)) return displayName;
  const handle = String(snapshot?.handleSnapshot || "").trim();
  if (handle) {
    const normalizedHandle = handle.replace(/^@+/, "");
    if (normalizedHandle && !looksLikeInternalUserId(normalizedHandle)) {
      return handle.startsWith("@") ? handle : `@${handle}`;
    }
  }
  // Public attribution must avoid leaking raw identity refs/emails.
  return "Contributor";
}

export function resolveLockedSnapshotAccountingState(snapshot: LockedParticipantSnapshotLike): {
  state: "ready" | "blocked";
  blockedReason: string | null;
} {
  if (snapshot?.participantUserId) {
    return { state: "ready", blockedReason: null };
  }
  return {
    state: "blocked",
    blockedReason: "IDENTITY_UNBOUND_LOCAL_USER"
  };
}
