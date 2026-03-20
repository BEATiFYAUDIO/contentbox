export type LibraryAccess = "owned" | "purchased" | "preview" | "local" | "participant";

export type LibrarySection = "owned" | "purchased" | "preview" | "participant" | "excluded";

export type LibraryExclusionReason =
  | "archived"
  | "trashed"
  | "deleted"
  | "pending"
  | "revoked"
  | "orphaned"
  | "inactive"
  | "relation_invalid";

type ContentLike = {
  id?: string | null;
  status?: string | null;
  libraryAccess?: string | null;
  ownerUserId?: string | null;
  archivedAt?: string | null;
  trashedAt?: string | null;
  deletedAt?: string | null;
  tombstonedAt?: string | null;
};

type ParticipationLike = {
  contentId?: string | null;
  status?: string | null;
  acceptedAt?: string | null;
  verifiedAt?: string | null;
  revokedAt?: string | null;
  tombstonedAt?: string | null;
  contentStatus?: string | null;
  contentDeletedAt?: string | null;
};

export type LibraryEligibilityDecision = {
  section: LibrarySection;
  included: boolean;
  reason?: LibraryExclusionReason;
};

function hasValue(value: unknown): boolean {
  return Boolean(String(value || "").trim());
}

function normalizeStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function isPublished(value: unknown): boolean {
  return normalizeStatus(value) === "published";
}

function isAcceptedParticipation(participation: ParticipationLike | null | undefined): boolean {
  if (!participation) return false;
  if (hasValue(participation.revokedAt) || hasValue(participation.tombstonedAt)) return false;
  const status = normalizeStatus(participation.status);
  if (status === "accepted" || status === "bound" || status === "locked") return true;
  return hasValue(participation.acceptedAt) || hasValue(participation.verifiedAt);
}

export function getContentExclusionReason(content: ContentLike | null | undefined): LibraryExclusionReason | null {
  if (!content) return "orphaned";
  if (hasValue(content.archivedAt)) return "archived";
  if (hasValue(content.trashedAt)) return "trashed";
  if (hasValue(content.deletedAt) || hasValue(content.tombstonedAt)) return "deleted";
  if (!isPublished(content.status)) return "inactive";
  return null;
}

export function isEligibleSplitParticipation(participation: ParticipationLike | null | undefined): {
  eligible: boolean;
  reason?: LibraryExclusionReason;
} {
  if (!participation) return { eligible: false, reason: "orphaned" };
  if (!hasValue(participation.contentId)) return { eligible: false, reason: "orphaned" };
  if (hasValue(participation.contentDeletedAt)) return { eligible: false, reason: "deleted" };
  if (!isPublished(participation.contentStatus || "published")) return { eligible: false, reason: "inactive" };
  if (hasValue(participation.revokedAt) || hasValue(participation.tombstonedAt)) {
    return { eligible: false, reason: "revoked" };
  }
  if (!isAcceptedParticipation(participation)) return { eligible: false, reason: "pending" };
  return { eligible: true };
}

export function classifyLibraryEligibility(input: {
  item: ContentLike | null | undefined;
  meUserId?: string | null;
  participation?: ParticipationLike | null;
}): LibraryEligibilityDecision {
  const item = input.item;
  const exclusion = getContentExclusionReason(item);
  if (exclusion) return { section: "excluded", included: false, reason: exclusion };

  const access = normalizeStatus(item?.libraryAccess);
  const isOwner = Boolean(input.meUserId && item?.ownerUserId && input.meUserId === item.ownerUserId);
  const ownerEligible = isOwner || access === "owned";
  const purchasedEligible = access === "purchased";
  const previewEligible = access === "preview";
  const participantCheck = isEligibleSplitParticipation(input.participation);
  const participantEligible = access === "participant" ? participantCheck.eligible : participantCheck.eligible;

  if (ownerEligible) return { section: "owned", included: true };
  if (purchasedEligible) return { section: "purchased", included: true };
  if (participantEligible) return { section: "participant", included: true };
  if (access === "participant" && !participantEligible) {
    return { section: "excluded", included: false, reason: participantCheck.reason || "relation_invalid" };
  }
  if (previewEligible) return { section: "preview", included: true };
  return { section: "excluded", included: false, reason: "relation_invalid" };
}

export function canFeatureOnProfile(input: {
  item: ContentLike | null | undefined;
  meUserId?: string | null;
  participation?: ParticipationLike | null;
}): { allowed: boolean; reason?: LibraryExclusionReason } {
  const classified = classifyLibraryEligibility(input);
  if (!classified.included) return { allowed: false, reason: classified.reason };
  if (classified.section === "owned" || classified.section === "participant") return { allowed: true };
  return { allowed: false, reason: "relation_invalid" };
}

export function logLibraryEligibilityDecision(input: {
  scope: string;
  contentId?: string | null;
  decision: LibraryEligibilityDecision;
  extra?: Record<string, unknown>;
}) {
  if (!import.meta.env.DEV) return;
  const payload = {
    contentId: input.contentId || null,
    section: input.decision.section,
    included: input.decision.included,
    reason: input.decision.reason || null,
    ...input.extra
  };
  // eslint-disable-next-line no-console
  console.debug(`libraryEligibility.${input.scope}`, payload);
}

