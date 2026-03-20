export function looksLikeInternalUserId(value?: string | null): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return /^c[a-z0-9]{20,}$/i.test(raw);
}

type ResolveDisplayInput = {
  displayName?: string | null;
  handle?: string | null;
  targetType?: string | null;
  targetValue?: string | null;
  participantUserId?: string | null;
  participantEmail?: string | null;
  allowEmail: boolean;
  fallbackLabel?: string;
};

export function resolveParticipantDisplayLabel(input: ResolveDisplayInput): string {
  const displayName = String(input.displayName || "").trim();
  if (displayName) return displayName;
  const handle = String(input.handle || "").trim();
  if (handle) return handle.startsWith("@") ? handle : `@${handle}`;

  const targetType = String(input.targetType || "").trim().toLowerCase();
  const targetValue = String(input.targetValue || "").trim();
  const participantUserId = String(input.participantUserId || "").trim();
  const participantEmail = String(input.participantEmail || "").trim().toLowerCase();

  if (targetType === "identity_ref" && targetValue && !looksLikeInternalUserId(targetValue)) return targetValue;
  if (input.allowEmail && participantEmail) return participantEmail;
  if (targetType === "email" && input.allowEmail && targetValue) return targetValue.toLowerCase();

  if (targetType === "local_user" && targetValue && !looksLikeInternalUserId(targetValue)) return targetValue;
  if (participantUserId && !looksLikeInternalUserId(participantUserId)) return participantUserId;

  return input.fallbackLabel || "Contributor";
}
