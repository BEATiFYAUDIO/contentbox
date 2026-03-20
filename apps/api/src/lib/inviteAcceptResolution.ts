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
