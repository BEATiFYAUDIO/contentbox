export type LockedParticipantSnapshotLike = {
  participantUserId?: string | null;
  participantEmail?: string | null;
  identityRef?: string | null;
  acceptedAt?: string | Date | null;
  verifiedAt?: string | Date | null;
  displayNameSnapshot?: string | null;
  handleSnapshot?: string | null;
};

export type LockedSnapshotDisplayLabelInput = {
  lockedDisplayName?: string | null;
  entityDisplayName?: string | null;
  creatorDisplayName?: string | null;
  userDisplayName?: string | null;
  handleSnapshot?: string | null;
  handleHint?: string | null;
  participantEmail?: string | null;
  userEmail?: string | null;
};

function looksLikeInternalUserId(value: string | null | undefined): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return /^c[a-z0-9]{20,}$/i.test(raw);
}

function normalizedEmailLocalPart(value: string | null | undefined): string | null {
  const email = String(value || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  const localPart = email.split("@")[0]?.trim() || "";
  if (!localPart) return null;
  const normalized = localPart
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  if (!normalized || looksLikeInternalUserId(normalized)) return null;
  return normalized;
}

function normalizeHandle(value: string | null | undefined): string | null {
  const raw = String(value || "").trim().replace(/^@+/, "");
  if (!raw || looksLikeInternalUserId(raw)) return null;
  const normalized = raw
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  if (!normalized || looksLikeInternalUserId(normalized)) return null;
  return normalized;
}

function normalizeHumanLabel(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw || looksLikeInternalUserId(raw)) return null;
  return raw;
}

export function resolveLockedSnapshotDisplayLabel(input: LockedSnapshotDisplayLabelInput): string | null {
  const ranked = [
    normalizeHumanLabel(input.lockedDisplayName),
    normalizeHumanLabel(input.entityDisplayName),
    normalizeHumanLabel(input.creatorDisplayName),
    normalizeHumanLabel(input.userDisplayName)
  ];
  for (const candidate of ranked) {
    if (candidate) return candidate;
  }
  const normalizedHandle = normalizeHandle(input.handleSnapshot) || normalizeHandle(input.handleHint);
  if (normalizedHandle) return `@${normalizedHandle}`;
  const emailHandle =
    normalizedEmailLocalPart(input.participantEmail) || normalizedEmailLocalPart(input.userEmail);
  if (emailHandle) return emailHandle;
  return null;
}

export function isTopologyNeutralLockedSnapshotEligible(snapshot: LockedParticipantSnapshotLike): boolean {
  return Boolean(
    snapshot?.acceptedAt &&
      snapshot?.verifiedAt &&
      (snapshot?.participantUserId || snapshot?.identityRef || snapshot?.participantEmail)
  );
}

export function resolveLockedSnapshotAttributionLabel(snapshot: LockedParticipantSnapshotLike): string {
  const label = resolveLockedSnapshotDisplayLabel({
    lockedDisplayName: snapshot?.displayNameSnapshot || null,
    handleSnapshot: snapshot?.handleSnapshot || null,
    participantEmail: snapshot?.participantEmail || null
  });
  if (label) return label;
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
