/** Recover routing metadata from this node's previously verified acceptance log.
 * Never infer a payout identity from a display name, email, or caller-supplied URL.
 * The audit log is trusted local state: remoteVerified was recorded only after
 * the signed acceptance passed verification. This does not change split terms.
 */
export type AcceptanceAudit = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  payloadJson: unknown;
};

export type OriginRecovery = {
  identityRef: string | null;
  origin: string | null;
  userId: string | null;
  source: "accepted_identity" | "verified_acceptance_audit" | "unresolved" | "ambiguous";
  evidenceIds: string[];
};

function publicOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".localhost") || host.endsWith(".internal")) return null;
    // Historical public routing recovery must never introduce an IP/local target.
    if (/^[\d.]+$/.test(host) || host.includes(":")) return null;
    return url.origin;
  } catch { return null; }
}

function remoteIdentity(value: unknown): { origin: string; userId: string; identityRef: string } | null {
  if (typeof value !== "string" || !value.startsWith("remote:")) return null;
  const marker = value.lastIndexOf("#user:");
  if (marker < 0) return null;
  const origin = publicOrigin(value.slice(7, marker));
  const userId = value.slice(marker + 6).trim();
  if (!origin || !/^[A-Za-z0-9_-]+$/.test(userId)) return null;
  return { origin, userId, identityRef: `remote:${origin}#user:${userId}` };
}

export function recoverAcceptedRemoteIdentity(input: {
  splitVersionId: string;
  participantUserId: string | null;
  accepted: boolean;
  acceptedIdentityRef: string | null;
  events: AcceptanceAudit[];
}): OriginRecovery {
  const empty: OriginRecovery = { identityRef: null, origin: null, userId: null, source: "unresolved", evidenceIds: [] };
  if (!input.accepted) return empty;
  const current = remoteIdentity(input.acceptedIdentityRef);
  if (current) return { ...current, source: "accepted_identity", evidenceIds: [] };
  const userId = input.participantUserId?.trim();
  if (!userId || !input.splitVersionId) return empty;
  // A different or malformed existing binding needs explicit investigation.
  if (input.acceptedIdentityRef && input.acceptedIdentityRef !== `user:${userId}`) return empty;
  const candidates = new Map<string, { identity: NonNullable<ReturnType<typeof remoteIdentity>>; ids: string[] }>();
  for (const event of input.events) {
    if (event.action !== "invite.accept" || event.entityType !== "SplitVersion" || event.entityId !== input.splitVersionId) continue;
    const p = event.payloadJson as Record<string, any> | null;
    if (!p || p.acceptanceAuthMode !== "remote_signature" || p.remoteVerified !== true || typeof p.signature !== "string" || !p.signature.trim()) continue;
    const signed = p.signedPayload;
    const identity = remoteIdentity(p.acceptedIdentityRef);
    if (!identity || identity.userId !== userId || p.participantUserId !== userId || p.remoteUserId !== userId) continue;
    if (!signed || signed.remoteUserId !== userId || !signed.token || !signed.nonce || !signed.aud || !signed.ts) continue;
    if (publicOrigin(p.remoteNodeUrl) !== identity.origin || publicOrigin(signed.nodeUrl) !== identity.origin) continue;
    const candidate = candidates.get(identity.identityRef) || { identity, ids: [] };
    candidate.ids.push(event.id);
    candidates.set(identity.identityRef, candidate);
  }
  if (candidates.size > 1) return { ...empty, source: "ambiguous", evidenceIds: [...candidates.values()].flatMap(c => c.ids) };
  const match = [...candidates.values()][0];
  return match ? { ...match.identity, source: "verified_acceptance_audit", evidenceIds: match.ids } : empty;
}
