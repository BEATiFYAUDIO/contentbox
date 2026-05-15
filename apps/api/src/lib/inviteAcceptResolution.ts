export function mapRemoteInviteAcceptErrorCode(status: number, existingCode?: string | null): string {
  const explicit = String(existingCode || "").trim();
  if (explicit) return explicit;
  if (status === 400) return "INVITE_BAD_REQUEST";
  if (status === 401) return "INVITE_AUTH_REQUIRED";
  if (status === 403) return "INVITE_REMOTE_ACCEPT_DENIED";
  if (status === 404) return "INVITE_NOT_FOUND";
  if (status === 409) return "INVITE_CONFLICT";
  return "INVITE_REMOTE_ACCEPT_FAILED";
}

export function mapTerminalInviteStatusToCode(status: string): string {
  const s = String(status || "").trim().toLowerCase();
  if (s === "revoked") return "INVITE_REVOKED";
  if (s === "tombstoned") return "INVITE_TOMBSTONED";
  if (s === "declined") return "INVITE_DECLINED";
  if (s === "expired") return "INVITE_EXPIRED";
  return "INVITE_INVALID_STATUS";
}

export type ForwardedInviteTimestampValidation = {
  ok: boolean;
  raw: string;
  parsedMs: number | null;
  nowMs: number;
  deltaMs: number | null;
  allowedSkewMs: number;
  format: "iso" | "seconds" | "milliseconds" | "invalid";
};

export function validateForwardedInviteTimestamp(
  value: unknown,
  opts?: { nowMs?: number; allowedSkewMs?: number }
): ForwardedInviteTimestampValidation {
  const raw = String(value ?? "").trim();
  const nowMs = Number.isFinite(opts?.nowMs) ? Number(opts?.nowMs) : Date.now();
  const allowedSkewMs = Number.isFinite(opts?.allowedSkewMs) ? Number(opts?.allowedSkewMs) : 15 * 60 * 1000;
  let parsedMs: number | null = null;
  let format: ForwardedInviteTimestampValidation["format"] = "invalid";

  if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      if (Math.abs(numeric) < 1_000_000_000_000) {
        parsedMs = numeric * 1000;
        format = "seconds";
      } else {
        parsedMs = numeric;
        format = "milliseconds";
      }
    }
  } else if (raw) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
      parsedMs = parsed;
      format = "iso";
    }
  }

  const deltaMs = parsedMs === null ? null : nowMs - parsedMs;
  const ok = parsedMs !== null && Math.abs(deltaMs || 0) <= allowedSkewMs;
  return { ok, raw, parsedMs, nowMs, deltaMs, allowedSkewMs, format };
}

export type InviteRecipientMatchInput = {
  authMode: "local_auth" | "remote_signature" | "none";
  targetType: "email" | "local_user" | "identity_ref";
  targetValue: string;
  attemptedUserId: string;
  effectiveEmail?: string | null;
  effectiveOwnerEmail?: string | null;
  participantEmail?: string | null;
  inviteTargetEmail?: string | null;
  targetLocalUserEmail?: string | null;
  contentOwnerEmail?: string | null;
  remoteNodeUrl?: string | null;
};

export type InviteRecipientMatchResult = {
  ok: boolean;
  reason:
    | "matched_local_user"
    | "matched_identity_ref"
    | "matched_remote_identity_ref"
    | "matched_email"
    | "matched_participant_email"
    | "matched_target_local_user_email"
    | "matched_legacy_local_user_email_recovery"
    | "matched_legacy_owner_email_recovery"
    | "target_mismatch"
    | "identity_ref_mismatch"
    | "email_mismatch";
};

export type InviteAcceptanceIdentityWritesInput = {
  authMode: "local_auth" | "remote_signature" | "none";
  userId: string;
  remoteNodeUrl?: string | null;
  existingParticipantEmail?: string | null;
  effectiveEmail?: string | null;
};

export type InviteAcceptanceIdentityWrites = {
  acceptedByUserId: string | null;
  acceptedIdentityRef: string;
  splitParticipantUpdate: {
    participantUserId?: string;
    participantEmail?: string;
  };
};

function normalizeEmail(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function looksLikeInternalUserId(value: string | null | undefined): boolean {
  return /^c[a-z0-9]{20,}$/i.test(String(value || "").trim());
}

export function resolveInviteRecipientMatch(input: InviteRecipientMatchInput): InviteRecipientMatchResult {
  const targetValue = String(input.targetValue || "").trim();
  const attemptedUserId = String(input.attemptedUserId || "").trim();
  const effectiveEmail = normalizeEmail(input.effectiveEmail);
  const effectiveOwnerEmail = normalizeEmail(input.effectiveOwnerEmail);
  const acceptedEmails = new Set([effectiveEmail, effectiveOwnerEmail].filter(Boolean));
  const participantEmail = normalizeEmail(input.participantEmail);
  const inviteTargetEmail = normalizeEmail(input.inviteTargetEmail);
  const targetLocalUserEmail = normalizeEmail(input.targetLocalUserEmail);
  const contentOwnerEmail = normalizeEmail(input.contentOwnerEmail);
  const intendedEmails = new Set([participantEmail, inviteTargetEmail, targetLocalUserEmail, contentOwnerEmail].filter(Boolean));
  const remoteNodeUrl = String(input.remoteNodeUrl || "").trim().replace(/\/+$/, "");

  if (input.targetType === "email") {
    return effectiveEmail && normalizeEmail(targetValue) === effectiveEmail
      ? { ok: true, reason: "matched_email" }
      : { ok: false, reason: "email_mismatch" };
  }

  if (input.targetType === "local_user") {
    if (targetValue === attemptedUserId) return { ok: true, reason: "matched_local_user" };
    if (
      input.authMode === "remote_signature" &&
      looksLikeInternalUserId(targetValue) &&
      !targetLocalUserEmail &&
      [...acceptedEmails].some((email) => intendedEmails.has(email))
    ) {
      return { ok: true, reason: "matched_legacy_local_user_email_recovery" };
    }
    return { ok: false, reason: "target_mismatch" };
  }

  if (targetValue === attemptedUserId) return { ok: true, reason: "matched_identity_ref" };
  if (input.authMode === "remote_signature") {
    if (remoteNodeUrl && targetValue === `remote:${remoteNodeUrl}#user:${attemptedUserId}`) {
      return { ok: true, reason: "matched_remote_identity_ref" };
    }
    if (looksLikeInternalUserId(targetValue) && participantEmail && acceptedEmails.has(participantEmail)) {
      return { ok: true, reason: "matched_participant_email" };
    }
    if (looksLikeInternalUserId(targetValue) && targetLocalUserEmail && acceptedEmails.has(targetLocalUserEmail)) {
      return { ok: true, reason: "matched_target_local_user_email" };
    }
    if (looksLikeInternalUserId(targetValue) && !targetLocalUserEmail && [...acceptedEmails].some((email) => intendedEmails.has(email))) {
      return { ok: true, reason: "matched_legacy_owner_email_recovery" };
    }
  }
  return { ok: false, reason: "identity_ref_mismatch" };
}

export function buildInviteAcceptanceIdentityWrites(input: InviteAcceptanceIdentityWritesInput): InviteAcceptanceIdentityWrites {
  const userId = String(input.userId || "").trim();
  const remoteNodeUrl = String(input.remoteNodeUrl || "").trim().replace(/\/+$/, "");

  if (input.authMode === "remote_signature") {
    return {
      acceptedByUserId: null,
      acceptedIdentityRef: `remote:${remoteNodeUrl || "unknown"}#user:${userId}`,
      splitParticipantUpdate: {}
    };
  }

  return {
    acceptedByUserId: userId || null,
    acceptedIdentityRef: `user:${userId}`,
    splitParticipantUpdate: userId ? { participantUserId: userId } : {}
  };
}
