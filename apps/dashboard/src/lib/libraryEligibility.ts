export type LibraryAccess = "owned" | "purchased" | "preview" | "local" | "participant";
export type LibraryRelation = "owner" | "participant" | "buyer" | "preview" | "unknown";

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

export type AvailabilityState = "active" | "archived" | "trashed" | "deleted" | "inactive" | "orphaned";

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

export function getAvailabilityState(content: ContentLike | null | undefined): AvailabilityState {
  if (!content) return "orphaned";
  if (hasValue(content.archivedAt)) return "archived";
  if (hasValue(content.trashedAt)) return "trashed";
  if (hasValue(content.deletedAt) || hasValue(content.tombstonedAt)) return "deleted";
  if (!isPublished(content.status)) return "inactive";
  return "active";
}

export function isPubliclyVisible(content: ContentLike | null | undefined): boolean {
  return getAvailabilityState(content) === "active";
}

export function isActiveLibraryVisible(
  content: ContentLike | null | undefined,
  relation: LibraryRelation,
  participation?: ParticipationLike | null
): { visible: boolean; reason?: LibraryExclusionReason } {
  const availability = getAvailabilityState(content);
  if (availability !== "active") return { visible: false, reason: availability === "orphaned" ? "orphaned" : (availability as LibraryExclusionReason) };
  if (relation === "participant") {
    const participationCheck = isEligibleSplitParticipation(participation);
    return { visible: participationCheck.eligible, reason: participationCheck.reason };
  }
  if (relation === "owner" || relation === "buyer" || relation === "preview") return { visible: true };
  return { visible: false, reason: "relation_invalid" };
}

export function isEntitlementHistoryVisible(
  content: ContentLike | null | undefined,
  relation: LibraryRelation,
  participation?: ParticipationLike | null
): { visible: boolean; reason?: LibraryExclusionReason } {
  const availability = getAvailabilityState(content);
  if (availability === "orphaned") return { visible: false, reason: "orphaned" };
  if (relation === "participant") {
    const participationCheck = isEligibleSplitParticipation(participation);
    if (!participationCheck.eligible && participationCheck.reason !== "deleted" && participationCheck.reason !== "inactive") {
      return { visible: false, reason: participationCheck.reason };
    }
    return { visible: true, reason: availability === "active" ? undefined : "inactive" };
  }
  if (relation === "buyer" || relation === "owner") {
    return { visible: true, reason: availability === "active" ? undefined : "inactive" };
  }
  return { visible: false, reason: "relation_invalid" };
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
  const participantEligible = participantCheck.eligible;

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

export function logVisibilityDecision(input: {
  surface: string;
  sourceModelQuery: string;
  relation: LibraryRelation;
  content: ContentLike | null | undefined;
  included: boolean;
  reason: string;
  extra?: Record<string, unknown>;
}) {
  if (!import.meta.env.DEV) return;
  const content = input.content;
  // eslint-disable-next-line no-console
  console.debug("visibility.trace", {
    surface: input.surface,
    sourceModelQuery: input.sourceModelQuery,
    relation: input.relation,
    contentId: content?.id || null,
    status: content?.status || null,
    archivedAt: content?.archivedAt || null,
    trashedAt: content?.trashedAt || null,
    deletedAt: content?.deletedAt || null,
    tombstonedAt: content?.tombstonedAt || null,
    availability: getAvailabilityState(content),
    included: input.included,
    reason: input.reason,
    ...(input.extra || {})
  });
}
