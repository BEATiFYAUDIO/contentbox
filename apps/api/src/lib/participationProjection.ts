import { isCommerceEligibleLockedParticipant } from "./splitAuthority.js";

type ParticipationProjectionEligibilityInput = {
  splitStatus: string | null | undefined;
  participantUserId: string | null | undefined;
  acceptedAt?: Date | string | null;
  verifiedAt?: Date | string | null;
  invitationStatus?: string | null;
};

function normalizeStatus(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

export function isLockedParticipationProjectionEligible(input: ParticipationProjectionEligibilityInput): boolean {
  if (normalizeStatus(input.splitStatus) !== "locked") return false;
  return isCommerceEligibleLockedParticipant({
    participantUserId: input.participantUserId || null,
    acceptedAt: input.acceptedAt || null,
    verifiedAt: input.verifiedAt || null,
    invitation: { status: input.invitationStatus || null }
  });
}

export function canHighlightParticipation(input: {
  requesterUserId: string | null | undefined;
  participantUserId: string | null | undefined;
}): boolean {
  const requesterUserId = String(input.requesterUserId || "").trim();
  const participantUserId = String(input.participantUserId || "").trim();
  if (!requesterUserId || !participantUserId) return false;
  return requesterUserId === participantUserId;
}

