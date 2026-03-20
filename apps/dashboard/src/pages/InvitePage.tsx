import { useEffect, useState } from "react";
import { api, getApiBase } from "../lib/api";
import HistoryFeed, { type HistoryEvent } from "../components/HistoryFeed";
import AuditPanel from "../components/AuditPanel";
import LockedFeaturePanel from "../components/LockedFeaturePanel";
import type { FeatureMatrix, CapabilitySet, NodeMode } from "../lib/identity";
import { looksLikeInternalUserId, resolveParticipantDisplayLabel } from "../lib/participantDisplay";

type InvitePageProps = {
  token?: string;
  onAccepted: (contentId?: string | null) => void;
  identityLevel?: string | null;
  features?: FeatureMatrix;
  lockReasons?: Record<string, string>;
  capabilities?: CapabilitySet;
  capabilityReasons?: Record<string, string>;
  nodeMode?: NodeMode | null;
};

type InviteGetResponse = {
  ok: true;
  found?: boolean;
  status?: "pending" | "accepted" | "declined" | "revoked" | "expired" | "tombstoned";
  targetType?: "email" | "local_user" | "identity_ref";
  targetValue?: string;
  inviterUserId?: string | null;
  authContext?: {
    authenticated: boolean;
    authHeaderPresent: boolean;
    userId: string | null;
    email: string | null;
    keyVerified: boolean | null;
    targetMatch: boolean | null;
    mismatchCode: "INVITE_TARGET_MISMATCH" | "INVITE_EMAIL_MISMATCH" | null;
  };
  invitation: {
    id: string;
    expiresAt: string;
    acceptedAt: string | null;
    targetDisplayName?: string | null;
  };
  splitParticipant: {
    id: string;
    participantEmail: string;
    participantUserId?: string | null;
    targetType?: "email" | "local_user" | "identity_ref" | null;
    targetValue?: string | null;
    participantDisplayName?: string | null;
    role: string;
    percent: any; // Decimal may serialize as string
    payoutIdentityId: string | null;
    acceptedAt: string | null;
  };
  splitVersion: {
    id: string;
    contentId: string;
    versionNumber: number;
    status: "draft" | "locked";
    lockedAt: string | null;
    lockedFileObjectKey: string | null;
    lockedFileSha256: string | null;
    createdAt: string;
    participants: any[];
  };
  content: {
    id: string;
    title: string;
    type: "song" | "book" | "video" | "file";
    status: "draft" | "published";
    createdAt: string;
  };
};

type AcceptResponse =
  | { ok: true; acceptedAt: string | null; alreadyAccepted?: boolean }
  | { ok: boolean; [k: string]: any };

type RemoteRoyaltyRow = {
  id: string;
  remoteOrigin?: string | null;
  inviteUrl?: string | null;
  contentId?: string | null;
  contentTitle?: string | null;
  contentType?: string | null;
  contentStatus?: string | null;
  splitVersionNum?: number | null;
  role?: string | null;
  percent?: number | string | null;
  status?: string | null;
  participantEmail?: string | null;
  acceptedAt?: string | null;
  remoteUserId?: string | null;
  remoteNodeUrl?: string | null;
  remoteVerified?: boolean;
  createdAt?: string | null;
};

type CreatedInviteRow = {
  invitationId: string;
  participantEmail: string;
  targetType?: "email" | "local_user" | "identity_ref";
  targetValue?: string;
  status?: "pending" | "accepted" | "declined" | "revoked" | "expired" | "tombstoned";
  deliveryMethod?: "none" | "email" | "link" | "internal";
  splitParticipantId: string;
  participantState?: "invited" | "active";
  participantDisplayName?: string | null;
  targetDisplayName?: string | null;
  token: string;
  expiresAt: string;
  inviteUrl: string | null;
  inviteLinkShareable?: boolean;
  acceptedAt?: string | null;
};

function num(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function titleCase(s?: string | null) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function statusLabel(value?: string | null) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "—";
}

function normalizeEmail(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

function inviteTargetLabel(inv: any): string {
  return resolveParticipantDisplayLabel({
    displayName: inv?.targetDisplayName || inv?.participantDisplayName || null,
    targetType: inv?.targetType || null,
    targetValue: inv?.targetValue || null,
    participantUserId: inv?.participantUserId || null,
    participantEmail: inv?.participantEmail || null,
    allowEmail: true,
    fallbackLabel: "Invited collaborator"
  });
}

function inviteTargetLabelPublic(inv: any): string {
  return resolveParticipantDisplayLabel({
    displayName: inv?.targetDisplayName || inv?.participantDisplayName || null,
    targetType: inv?.targetType || null,
    targetValue: inv?.targetValue || null,
    participantUserId: inv?.participantUserId || null,
    participantEmail: inv?.participantEmail || null,
    allowEmail: false,
    fallbackLabel: "Contributor"
  });
}

function inviteAudienceLabel(inv: any): string {
  const targetType = String(inv?.targetType || "").trim().toLowerCase();
  if (targetType === "local_user") return "Sent to local user";
  if (targetType === "identity_ref") return "Pending identity claim";
  if (targetType === "email") return "Sent to email target";
  if (inv?.remoteOrigin) return "Received from remote node";
  return "Invite target";
}

function isActiveInviteStatus(status: string): boolean {
  return status === "pending" || status === "accepted";
}

function mapAcceptErrorMessage(raw: string): string {
  const text = String(raw || "");
  if (text.includes("INVITE_AUTH_REQUIRED")) return "Sign in to accept this invite.";
  if (text.includes("INVITE_WRONG_RECIPIENT")) return "Signed in as wrong recipient for this invite.";
  if (text.includes("INVITE_TARGET_MISMATCH")) return "You are signed in as the wrong user for this invite.";
  if (text.includes("INVITE_EMAIL_MISMATCH")) return "Signed-in email does not match this invite target.";
  if (text.includes("INVITE_SIGNATURE_REQUIRED")) return "Forwarded acceptance proof is missing. Retry from your signed-in creator node.";
  if (text.includes("INVITE_FORWARDED_IDENTITY_UNTRUSTED")) {
    if (text.includes("DISCOVERY_UNREACHABLE_OR_INVALID")) return "Remote node discovery endpoint is unreachable or invalid.";
    if (text.includes("DISCOVERY_KEY_MISSING")) return "Remote node discovery did not provide a public verification key.";
    if (text.includes("FORWARDED_PAYLOAD_MISMATCH")) return "Forwarded identity payload does not match invite token/origin context.";
    if (text.includes("FORWARDED_PAYLOAD_TS_INVALID")) return "Forwarded identity payload timestamp is invalid or expired.";
    if (text.includes("FORWARDED_SIGNATURE_INVALID")) return "Forwarded identity signature is invalid.";
    return "Forwarded identity proof was rejected by the remote node.";
  }
  if (text.includes("INVITE_IDENTITY_BIND_FAILED")) return "Invite acceptance failed while binding identity on the owner node.";
  if (text.includes("INVITE_KEY_MISSING")) return "This device cannot sign invite acceptance.";
  if (text.includes("INVITE_KEY_UNVERIFIED")) return "Verify your key before accepting this invite.";
  if (text.includes("INVITE_NODE_URL_NOT_SHAREABLE")) return "Your creator node is not advertising a shareable public origin.";
  if (text.includes("INVITE_NODE_URL_UNREACHABLE")) return "Your creator node public origin is not reachable for signature verification.";
  return text;
}

function buildInviteMailto(inv: CreatedInviteRow) {
  const to = String(inv.participantEmail || "").trim();
  const inviteUrl = String(inv.inviteUrl || "").trim();
  const subject = "You are invited to join a Certifyd split";
  const body = [
    "You have been invited to join a Certifyd revenue split.",
    "",
    inviteUrl ? `Invite link: ${inviteUrl}` : `Invite token: ${inv.token}`,
    "",
    "To accept:",
    "1) Sign in (or create) your Basic Certifyd Creator account",
    "2) Ensure your verified key is active",
    inviteUrl ? "3) Open the invite link and accept" : "3) Open your node invite page and paste the token",
    "",
    "This invite link is the source of truth for acceptance."
  ].join("\n");
  const q = new URLSearchParams({
    subject,
    body
  });
  return `mailto:${encodeURIComponent(to)}?${q.toString()}`;
}

function openExternalInNewWindow(url: string): boolean {
  const target = String(url || "").trim();
  if (!target) return false;
  try {
    // Use anchor-click to avoid dual-navigation race conditions where both tabs
    // can navigate when popup detection is inconsistent across browsers.
    const a = document.createElement("a");
    a.href = target;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch {
    return false;
  }
}

function mapRemoteRoyaltyToInviteRow(row: RemoteRoyaltyRow): any {
  return {
    id: String(row.id || "").trim(),
    remoteOrigin: String(row.remoteOrigin || "").trim() || null,
    inviteUrl: String(row.inviteUrl || "").trim() || null,
    contentId: String(row.contentId || "").trim() || null,
    contentTitle: row.contentTitle || null,
    contentType: row.contentType || null,
    contentStatus: row.contentStatus || "published",
    splitVersionNum: Number.isFinite(Number(row.splitVersionNum)) ? Number(row.splitVersionNum) : null,
    splitStatus: row.status === "accepted" ? "locked" : null,
    role: row.role || null,
    percent: row.percent ?? null,
    participantEmail: row.participantEmail || null,
    status: String(row.status || "").trim().toLowerCase() || "pending",
    expiresAt: null,
    acceptedAt: row.acceptedAt || null,
    revokedAt: null,
    tombstonedAt: null,
    remoteUserId: row.remoteUserId || null,
    remoteNodeUrl: row.remoteNodeUrl || null,
    remoteVerified: Boolean(row.remoteVerified),
    createdAt: row.createdAt || null,
    source: "remote_royalty"
  };
}

export default function InvitePage({
  token,
  onAccepted,
  features,
  lockReasons,
  capabilities,
  capabilityReasons,
  nodeMode
}: InvitePageProps) {
  const canAdvancedSplits = features?.advancedSplits ?? false;
  const splitsAllowed = capabilities?.useSplits ?? canAdvancedSplits;
  const inviteAllowed = capabilities?.sendInvite ?? true;
  const inviteReason =
    capabilityReasons?.invite ||
    capabilityReasons?.splits ||
    "You can prepare this action, but a permanent named link must be online to perform it.";
  const isBasic = nodeMode === "basic";
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<InviteGetResponse | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [me, setMe] = useState<{ id: string; email?: string | null; displayName?: string | null } | null>(null);
  const [inviteAuditEventsList, setInviteAuditEventsList] = useState<any[]>([]);
  const [showInviteAuditEvents, setShowInviteAuditEvents] = useState(false);
  const [myInvites, setMyInvites] = useState<any[] | null>(null);
  const [receivedInvites, setReceivedInvites] = useState<any[] | null>(null);
  const [remoteReceivedInvites, setRemoteReceivedInvites] = useState<any[] | null>(null);
  const [sentOpen, setSentOpen] = useState<Record<string, boolean>>({});
  const [receivedOpen, setReceivedOpen] = useState<Record<string, boolean>>({});
  const [remoteAcceptBusy, setRemoteAcceptBusy] = useState<Record<string, boolean>>({});
  const [remoteSyncBusy, setRemoteSyncBusy] = useState<Record<string, boolean>>({});
  const [showHistory, setShowHistory] = useState(false);
  const [contentList, setContentList] = useState<any[]>([]);
  const [selectedContentId, setSelectedContentId] = useState<string>("");
  const [selectedSplitId, setSelectedSplitId] = useState<string | null>(null);
  const [createdInvites, setCreatedInvites] = useState<CreatedInviteRow[]>([]);
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [pasteRaw, setPasteRaw] = useState<string>("");
  const [pasteMsg, setPasteMsg] = useState<string | null>(null);
  const [remoteOriginReachable, setRemoteOriginReachable] = useState<boolean | null>(null);
  const [localSigning, setLocalSigning] = useState<{ userId: string | null; email: string | null; canSign: boolean; keyVerified: boolean; reason: string | null } | null>(null);

  useEffect(() => {
    if (isBasic) return;
    if (!splitsAllowed && showHistory) {
      setShowHistory(false);
    }
  }, [splitsAllowed, showHistory, isBasic]);

  function extractInviteTokenFromPaste(raw: string): string | null {
    const v = String(raw || "").trim();
    if (!v) return null;
    const m1 = v.match(/\btoken=([^\s]+)/i);
    if (m1 && m1[1]) return m1[1];
    const m2 = v.match(/\/invites?\/([^?#\s]+)/i);
    if (m2 && m2[1]) return m2[1];
    if (/^[A-Za-z0-9_-]{10,}$/.test(v)) return v;
    return null;
  }

  function normalizeOrigin(raw: string | null | undefined): string | null {
    let value = String(raw || "").trim();
    if (!value) return null;
    for (let i = 0; i < 2; i++) {
      try {
        if (/%[0-9A-Fa-f]{2}/.test(value)) {
          value = decodeURIComponent(value);
        }
      } catch {
        break;
      }
    }
    try {
      return new URL(value).origin.replace(/\/+$/, "");
    } catch {
      return null;
    }
  }

  function parseInviteInput(raw: string): { token: string; remoteOrigin: string | null } | null {
    const value = String(raw || "").trim();
    if (!value) return null;

    if (/^https?:\/\//i.test(value)) {
      try {
        const u = new URL(value);
        const pathParts = u.pathname.split("/").filter(Boolean);
        const inviteIdx = pathParts.findIndex((p) => p === "invite" || p === "invites");
        const tokenFromPath =
          inviteIdx >= 0 && typeof pathParts[inviteIdx + 1] === "string"
            ? decodeURIComponent(pathParts[inviteIdx + 1])
            : null;
        const tokenFromQuery = (() => {
          const qp = u.searchParams.get("token");
          return qp ? decodeURIComponent(qp) : null;
        })();
        const token =
          tokenFromPath ||
          tokenFromQuery ||
          extractInviteTokenFromPaste(value);
        if (!token) return null;
        const remoteFromQuery =
          normalizeOrigin(u.searchParams.get("remote")) ||
          normalizeOrigin(u.searchParams.get("origin"));
        const remoteFromHash = (() => {
          const hash = String(u.hash || "");
          const m = hash.match(/(?:^|[?&])remote=([^&]+)/i);
          if (!m?.[1]) return null;
          return normalizeOrigin(decodeURIComponent(m[1]));
        })();
        const inviteOrigin = normalizeOrigin(u.origin);
        const remoteOrigin = remoteFromQuery || remoteFromHash || inviteOrigin;
        return { token, remoteOrigin };
      } catch {
        return null;
      }
    }

    const token = extractInviteTokenFromPaste(value);
    if (!token) return null;
    return { token, remoteOrigin: null };
  }

  function getRemoteOriginFromLocation(): string | null {
    try {
      const qs = new URLSearchParams(window.location.search);
      const remote =
        normalizeOrigin(qs.get("remote")) ||
        normalizeOrigin(qs.get("origin"));
      if (remote) return remote;

      const h = window.location.hash || "";
      if (h.startsWith("#")) {
        const hash = h.slice(1);
        const m = hash.match(/remote=([^&]+)/);
        if (m && m[1]) {
          const fromHash = normalizeOrigin(decodeURIComponent(m[1]));
          if (fromHash) return fromHash;
        }
      }
    } catch {}
    return null;
  }

  function getSurfaceModeFromLocation(): "accept" | "view" | null {
    try {
      const qs = new URLSearchParams(window.location.search);
      const mode = String(qs.get("surface") || "").trim().toLowerCase();
      if (mode === "accept" || mode === "view") return mode;
    } catch {}
    return null;
  }

  const remoteOriginFromLocation = getRemoteOriginFromLocation();
  const surfaceModeFromLocation = getSurfaceModeFromLocation();

  function openPastedInvite() {
    setPasteMsg(null);
    const raw = String(pasteRaw || "").trim();
    if (!raw) {
      setPasteMsg("Paste a token or an /invite/<token> link.");
      return;
    }
    const parsed = parseInviteInput(raw);
    if (!parsed?.token) {
      setPasteMsg("Paste a token or an /invite/<token> link.");
      return;
    }
    const localOrigin = normalizeOrigin(window.location.origin);
    const remote =
      parsed.remoteOrigin && parsed.remoteOrigin !== localOrigin
        ? parsed.remoteOrigin
        : null;
    const base = getApiBase();
    if (!remote && (base.includes("127.0.0.1") || base.includes("localhost")) && !/^https?:\/\//i.test(raw)) {
      setPasteMsg("For remote invites, paste the full invite link.");
      return;
    }
    const next = remote
      ? `/invite/${encodeURIComponent(parsed.token)}?remote=${encodeURIComponent(remote)}`
      : `/invite/${encodeURIComponent(parsed.token)}`;
    if (import.meta.env.DEV) {
      console.debug("[invite.openPastedInvite]", {
        raw,
        token: parsed.token,
        remoteOrigin: remote,
        next
      });
    }
    const opened = openExternalInNewWindow(next);
    if (!opened) setPasteMsg("Could not open invite.");
  }

  // Determine token to use: prop first, then parse from URL path (/invite/:token) or ?token=
  const tokenFromLocation = (() => {
    try {
      const parts = window.location.pathname.split("/").filter(Boolean);
      if ((parts[0] === "invite" || parts[0] === "invites") && typeof parts[1] === "string") return decodeURIComponent(parts[1]);
      const qp = new URLSearchParams(window.location.search).get("token");
      if (qp) return decodeURIComponent(qp);

      // support hash routes: #/invite/<token> or #token=<token>
      const h = window.location.hash || "";
      if (h.startsWith("#")) {
        const hash = h.slice(1);
        const hp = hash.split("/").filter(Boolean);
        if (hp[0] === "invite" && typeof hp[1] === "string") return decodeURIComponent(hp[1]);
        const m = hash.match(/token=([^&]+)/);
        if (m) return decodeURIComponent(m[1]);
      }
    } catch (e) {
      // ignore
    }
    return null;
  })();

  const tokenToUse = token || tokenFromLocation || "";

  const expired = new Date(data?.invitation.expiresAt ?? "").getTime() < Date.now();
  const alreadyAccepted = Boolean(data?.invitation?.acceptedAt || data?.splitParticipant?.acceptedAt);
  const authCtx = data?.authContext || null;
  const inviteAuthRequired = authCtx ? !authCtx.authenticated : !me;
  const inviteWrongIdentity = Boolean(authCtx ? authCtx.targetMatch === false : false);
  const backendKeyVerified = authCtx?.keyVerified ?? null;
  const inviteAcceptSurfaceBlocked = surfaceModeFromLocation === "view";
  const inviteTargetType = String(data?.targetType || data?.splitParticipant?.targetType || "").trim().toLowerCase();
  const inviteTargetValue = String(data?.targetValue || data?.splitParticipant?.targetValue || "").trim();
  const baseInviteTargetLabel = data
    ? inviteTargetLabelPublic({
        ...data,
        targetDisplayName: data.invitation?.targetDisplayName || data.splitParticipant?.participantDisplayName || null,
        participantUserId: data.splitParticipant?.participantUserId || null,
        participantEmail: data.splitParticipant?.participantEmail || null,
        targetType: data.targetType || data.splitParticipant?.targetType || null,
        targetValue: data.targetValue || data.splitParticipant?.targetValue || null
      })
    : "Contributor";
  const resolvedInviteTargetLabel =
    inviteTargetType === "identity_ref" && authCtx?.targetMatch === true
      ? (String(me?.displayName || "").trim() ||
          String(authCtx?.email || "").trim() ||
          String(me?.email || "").trim() ||
          (inviteTargetValue && !looksLikeInternalUserId(inviteTargetValue) ? inviteTargetValue : "") ||
          baseInviteTargetLabel)
      : baseInviteTargetLabel;

  async function fetchRemoteJson(path: string, opts?: { method?: string; body?: any; headers?: Record<string, string> }) {
    if (!remoteOriginFromLocation) throw new Error("Remote origin missing");
    const origin = encodeURIComponent(remoteOriginFromLocation);
    const url = `/api/remote${path}?origin=${origin}`;
    const res = await api<any>(url, opts?.method || "GET", opts?.body || undefined);
    return res;
  }

  async function fetchRemoteJsonFromOrigin(
    origin: string,
    path: string,
    opts?: { method?: string; body?: any; headers?: Record<string, string> }
  ) {
    const encoded = encodeURIComponent(origin);
    const url = `/api/remote${path}?origin=${encoded}`;
    const res = await api<any>(url, opts?.method || "GET", opts?.body || undefined);
    return res;
  }

  async function checkRemoteOriginReachable(origin: string): Promise<boolean> {
    const clean = String(origin || "").trim();
    if (!clean) return false;
    try {
      const res = await api<{ ok: boolean; reachable: boolean }>(
        `/api/remote/health?origin=${encodeURIComponent(clean)}`,
        "GET"
      );
      return Boolean(res?.ok && res?.reachable);
    } catch {
      return false;
    }
  }

  function isNotFoundInviteError(err: unknown): boolean {
    const msg = String((err as any)?.message || err || "").toLowerCase();
    return msg.includes("404") || msg.includes("invite not found") || msg.includes("not found");
  }

  async function ingestRemoteSnapshot(params: {
    origin: string;
    token: string;
    inviteUrl?: string | null;
    snapshot?: any | null;
    acceptedAtOverride?: string | null;
    forceStatus?: "pending" | "accepted" | "declined" | "revoked" | "expired" | "tombstoned" | null;
  }) {
    const { origin, token, inviteUrl, snapshot, acceptedAtOverride, forceStatus } = params;
    const invitation = snapshot?.invitation || null;
    const content = snapshot?.content || null;
    const splitParticipant = snapshot?.splitParticipant || null;
    const splitVersion = snapshot?.splitVersion || null;
    const acceptedAt = acceptedAtOverride || invitation?.acceptedAt || null;
    const status = forceStatus || invitation?.status || (acceptedAt ? "accepted" : "pending");
    await api(`/invites/ingest`, "POST", {
      remoteOrigin: origin,
      token,
      inviteUrl: inviteUrl || `${origin.replace(/\/+$/, "")}/invite/${encodeURIComponent(token)}`,
      invitation,
      status,
      expiresAt: invitation?.expiresAt || null,
      revokedAt: invitation?.revokedAt || null,
      tombstonedAt: invitation?.tombstonedAt || null,
      content,
      splitParticipant,
      splitVersion,
      acceptedAt,
      contentDeletedAt: content?.deletedAt || null,
      remoteNodeUrl: origin
    });
  }

  async function refreshRemoteReceivedList() {
    const [listRemote, royaltyRemote] = await Promise.all([
      api<any[]>(`/my/invitations/remote?includeHistory=${showHistory ? "1" : "0"}`, "GET").catch(() => []),
      api<RemoteRoyaltyRow[]>("/my/royalties/remote", "GET").catch(() => [])
    ]);
    const mappedRoyalty = (royaltyRemote || []).map(mapRemoteRoyaltyToInviteRow);
    const merged = new Map<string, any>();
    for (const inv of [...(listRemote || []), ...mappedRoyalty]) {
      const id = String(inv?.id || "").trim();
      if (!id) continue;
      const prev = merged.get(id);
      if (!prev) {
        merged.set(id, inv);
        continue;
      }
      const prevTs = new Date(prev?.createdAt || 0).getTime();
      const curTs = new Date(inv?.createdAt || 0).getTime();
      if (curTs >= prevTs) merged.set(id, { ...prev, ...inv });
    }
    setRemoteReceivedInvites(Array.from(merged.values()));
  }

  async function acceptRemoteInviteCanonical(params: {
    origin: string;
    token: string;
    inviteUrl?: string | null;
    seedSnapshot?: any | null;
  }) {
    const { origin, token, inviteUrl, seedSnapshot } = params;
    const res = await fetchRemoteJsonFromOrigin(origin, `/invites/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      body: {}
    });

    let snapshot = seedSnapshot || null;
    try {
      snapshot = await fetchRemoteJsonFromOrigin(origin, `/invites/${encodeURIComponent(token)}`, { method: "GET" });
    } catch {
      // keep seed snapshot fallback
    }

    await ingestRemoteSnapshot({
      origin,
      token,
      inviteUrl,
      snapshot,
      acceptedAtOverride: res?.acceptedAt || null
    });
    await refreshRemoteReceivedList();
    return { res, snapshot };
  }

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      if (!tokenToUse) {
        setData(null);
        return;
      }
      if (remoteOriginFromLocation) {
        if (import.meta.env.DEV) {
          console.debug("[invite.load]", {
            token: tokenToUse,
            mode: "remote",
            remoteOrigin: remoteOriginFromLocation
          });
        }
        const reachable = await checkRemoteOriginReachable(remoteOriginFromLocation);
        setRemoteOriginReachable(reachable);
        if (!reachable) {
          setData(null);
          setMsg("Shared invite host is not reachable. Copy token or configure a working public invite origin.");
          return;
        }
      } else {
        if (import.meta.env.DEV) {
          console.debug("[invite.load]", {
            token: tokenToUse,
            mode: "local",
            apiBase: getApiBase()
          });
        }
        setRemoteOriginReachable(null);
      }
      const res = remoteOriginFromLocation
        ? await fetchRemoteJson(`/invites/${encodeURIComponent(tokenToUse)}`)
        : await api<InviteGetResponse>(`/invites/${encodeURIComponent(tokenToUse)}`, "GET");
      setData(res);
      // If the server included related invites for this split, show them even
      // when the viewer isn't signed in (so invite pages always show sent invites).
      try {
        if (!me && (res as any)?.invites) {
          setMyInvites((res as any).invites || []);
        }
      } catch {}
      // try to load audit events for this invite (owner view)
      try {
        if (res?.invitation?.id) {
          const ev = await api<any[]>(`/invites/${encodeURIComponent(res.invitation.id)}/audit`, "GET");
          setInviteAuditEventsList(ev || []);
        } else {
          setInviteAuditEventsList([]);
        }
      } catch {
        setInviteAuditEventsList([]);
      }
    } catch (e: any) {
      setData(null);
      if (tokenToUse) {
        const base = remoteOriginFromLocation ? ` (${remoteOriginFromLocation})` : "";
        const raw = e?.message || "Failed to load invite";
        const friendly =
          raw === "Failed to fetch"
            ? `Failed to reach remote invite${base}. Make sure the tunnel is running and updated.`
            : mapAcceptErrorMessage(raw);
        setMsg(friendly);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isBasic) return;
    if (!splitsAllowed) {
      setLoading(false);
      setData(null);
      setMsg(null);
      return;
    }
    load();
    // attempt to load current user (if signed in on this node)
    (async () => {
      try {
        const m = await api<any>(`/me`, "GET");
        setMe(m || null);
        try {
          const lc = await api<{ userId: string | null; email: string | null; canSign: boolean; keyVerified: boolean; reason: string | null }>(
            "/api/local/signing-capability",
            "GET"
          );
          setLocalSigning(lc || null);
        } catch {
          setLocalSigning(null);
        }
      } catch {
        setMe(null);
        setLocalSigning(null);
      }
    })();
  }, [tokenToUse, remoteOriginFromLocation, splitsAllowed, isBasic]);

  // If this is a remote invite and the user is signed in locally, ingest it so it shows under Received invites.
  useEffect(() => {
    if (isBasic) return;
    if (!splitsAllowed) return;
    if (!me || !remoteOriginFromLocation || !tokenToUse || !data) return;
    if (remoteOriginReachable === false) return;
    (async () => {
      try {
        await ingestRemoteSnapshot({
          origin: remoteOriginFromLocation,
          token: tokenToUse,
          snapshot: data
        });
        await refreshRemoteReceivedList();
      } catch {}
    })();
  }, [me, data, remoteOriginFromLocation, tokenToUse, splitsAllowed, isBasic, remoteOriginReachable]);

  // Load outgoing invites for the signed-in owner (no token values are returned)
  useEffect(() => {
    if (isBasic) return;
    if (!splitsAllowed) return;
    if (!me) {
      setMyInvites(null);
      setReceivedInvites(null);
      setRemoteReceivedInvites(null);
      setHistoryItems([]);
      return;
    }

    // helper to load both lists so we can refresh after accept/create
    async function loadLists() {
      try {
        const list = await api<any[]>(`/my/invitations?includeHistory=${showHistory ? "1" : "0"}`, "GET");
        setMyInvites(list || []);
      } catch {
        setMyInvites([]);
      }

      try {
        const listR = await api<any[]>(`/my/invitations/received?includeHistory=${showHistory ? "1" : "0"}`, "GET");
        setReceivedInvites(listR || []);
      } catch {
        setReceivedInvites([]);
      }

      try {
        await refreshRemoteReceivedList();
      } catch {
        setRemoteReceivedInvites([]);
      }
    }

    loadLists();
    (async () => {
      try {
        setHistoryLoading(true);
        const hist = await api<HistoryEvent[]>("/me/invite-history", "GET");
        setHistoryItems(hist || []);
      } catch {
        setHistoryItems([]);
      } finally {
        setHistoryLoading(false);
      }
    })();
  }, [me, splitsAllowed, isBasic, showHistory]);

  useEffect(() => {
    if (isBasic) return;
    if (!splitsAllowed) return;
    if (!me) {
      setContentList([]);
      return;
    }
    (async () => {
      try {
        const list = await api<any[]>(`/content`, "GET");
        setContentList(list || []);
      } catch {
        setContentList([]);
      }
    })();
  }, [me, splitsAllowed, isBasic]);

  useEffect(() => {
    if (isBasic) return;
    if (!splitsAllowed) return;
    if (!selectedContentId) {
      setSelectedSplitId(null);
      return;
    }
    (async () => {
      try {
        const latest = await api<any>(`/content/${selectedContentId}/splits`, "GET");
        setSelectedSplitId(latest?.id || null);
      } catch {
        setSelectedSplitId(null);
      }
    })();
  }, [selectedContentId, splitsAllowed, isBasic]);

  // manual token loader removed — invite tab (owner view) now shows only invites lists; use direct invite URL for detail view.

  async function acceptInvite() {
    if (inviteAcceptSurfaceBlocked) {
      setMsg("This is a view-only dashboard surface. Open your signed-in creator node (port 4000) to accept.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (!tokenToUse) throw new Error("Invite token missing");

      if (remoteOriginFromLocation) {
        const { res } = await acceptRemoteInviteCanonical({
          origin: remoteOriginFromLocation,
          token: tokenToUse,
          inviteUrl: `${remoteOriginFromLocation.replace(/\/+$/, "")}/invite/${encodeURIComponent(tokenToUse)}`,
          seedSnapshot: data
        });
        setMsg(res?.alreadyAccepted ? "Already accepted on remote node." : "Accepted on remote node.");
        await load();
        onAccepted(data?.content?.id ?? null);
        return;
      }

      const res = await api<AcceptResponse>(`/invites/${encodeURIComponent(tokenToUse)}/accept`, "POST", {});
      setMsg(res?.alreadyAccepted ? "Already accepted." : "Accepted.");
      await load();
      // refresh lists so owner sees accepted state and newly created invites show up
      try {
        const list = await api<any[]>(`/my/invitations?includeHistory=${showHistory ? "1" : "0"}`, "GET");
        setMyInvites(list || []);
      } catch {
        // ignore
      }
      try {
        const listR = await api<any[]>(`/my/invitations/received?includeHistory=${showHistory ? "1" : "0"}`, "GET");
        setReceivedInvites(listR || []);
      } catch {
        // ignore
      }
      onAccepted(data?.content?.id ?? null);
    } catch (e: any) {
      setMsg(mapAcceptErrorMessage(e?.message || "Accept failed"));
    } finally {
      setBusy(false);
    }
  }

  function inviteStatus(inv: any) {
    const status = String(inv?.status || "").trim().toLowerCase();
    if (status) return status;
    const exp = new Date(inv?.expiresAt || "").getTime();
    if (inv?.acceptedAt) return "accepted";
    if (Number.isFinite(exp) && exp < Date.now()) return "expired";
    return "pending";
  }

  function groupByContent(list: any[] | null) {
    const out: Record<string, { key: string; title: string; invites: any[] }> = {};
    for (const inv of list || []) {
      const title = inv.contentTitle || inv.contentId || inviteTargetLabel(inv);
      const key = String(inv.contentId || inv.contentTitle || `${inv.targetType || "target"}:${inv.targetValue || inv.id || "unknown"}`);
      if (!out[key]) out[key] = { key, title, invites: [] };
      out[key].invites.push(inv);
    }
    return Object.values(out);
  }

  const visibleSentInvites = (myInvites || []).filter((inv) => {
    if (showHistory) return true;
    const status = inviteStatus(inv);
    return isActiveInviteStatus(status) && !inv.contentDeletedAt;
  });
  const visibleReceivedInvites = (receivedInvites || []).filter((inv) => {
    if (showHistory) return true;
    const status = inviteStatus(inv);
    return isActiveInviteStatus(status) && !inv.contentDeletedAt;
  });
  const visibleRemoteInvites = (remoteReceivedInvites || []).filter((inv) => {
    if (showHistory) return true;
    const status = inviteStatus(inv);
    return isActiveInviteStatus(status) && !inv.contentDeletedAt;
  });
  const dedupeKey = (inv: any) => {
    const inviteId = String(inv?.id || "").trim();
    if (inviteId) return `id:${inviteId}`;
    return [
      String(inv?.remoteOrigin || "").trim().toLowerCase(),
      String(inv?.contentId || "").trim(),
      String(inv?.contentTitle || "").trim(),
      String(inv?.targetType || "").trim().toLowerCase(),
      String(inv?.targetValue || "").trim().toLowerCase(),
      String(inv?.role || "").trim().toLowerCase(),
      String(inv?.percent ?? "").trim()
    ].join("|");
  };
  const localInviteKeys = new Set(visibleReceivedInvites.map(dedupeKey));
  const dedupedRemoteInvites = visibleRemoteInvites.filter((inv) => !localInviteKeys.has(dedupeKey(inv)));

  const dedupedSentInvites = Array.from(
    new Map(
      (visibleSentInvites || []).map((inv) => [
        String(inv?.id || `${inv?.contentId || ""}|${inv?.targetType || ""}|${inv?.targetValue || inv?.participantEmail || ""}|${inv?.createdAt || ""}`),
        inv
      ])
    ).values()
  ).sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime());

  async function acceptRemoteInvite(inv: any) {
    const inviteUrl = String(inv?.inviteUrl || "").trim();
    const token = extractInviteTokenFromPaste(inviteUrl || inv?.token || "");
    let origin = String(inv?.remoteOrigin || "").trim();
    if (!origin && inviteUrl) {
      try {
        origin = new URL(inviteUrl).origin;
      } catch {}
    }
    if (!token || !origin) {
      setMsg("Remote invite is missing token or origin.");
      return;
    }
    if (!me) {
      setMsg("Sign in to accept.");
      return;
    }
    if (localSigning?.canSign === false) {
      setMsg("This device cannot sign invite acceptance.");
      return;
    }
    if (localSigning?.keyVerified === false) {
      setMsg("Verify your key before accepting this invite.");
      return;
    }
    if (!(await checkRemoteOriginReachable(origin))) {
      setMsg("Shared invite host is not reachable. Copy token or configure a working public invite origin.");
      return;
    }
    try {
      const preview = await fetchRemoteJsonFromOrigin(origin, `/invites/${encodeURIComponent(token)}`, { method: "GET" });
      const targetType = String(preview?.targetType || "").trim().toLowerCase();
      const targetValue = String(preview?.targetValue || "").trim();
      if (targetType === "local_user" && targetValue && me.id && targetValue !== me.id) {
        setMsg("Signed in as wrong recipient for this invite.");
        return;
      }
      if (targetType === "email" && targetValue && me.email && normalizeEmail(targetValue) !== normalizeEmail(me.email)) {
        setMsg("Signed in as wrong recipient for this invite.");
        return;
      }
    } catch {
      // allow proxy call to return authoritative error
    }
    setRemoteAcceptBusy((m) => ({ ...m, [inv.id]: true }));
    try {
      await acceptRemoteInviteCanonical({
        origin,
        token,
        inviteUrl
      });
    } catch (e: any) {
      setMsg(mapAcceptErrorMessage(e?.message || "Remote accept failed"));
    } finally {
      setRemoteAcceptBusy((m) => ({ ...m, [inv.id]: false }));
    }
  }

  async function syncRemoteInvite(inv: any) {
    const inviteUrl = String(inv?.inviteUrl || "").trim();
    const token = extractInviteTokenFromPaste(inviteUrl || inv?.token || "");
    let origin = String(inv?.remoteOrigin || "").trim();
    if (!origin && inviteUrl) {
      try {
        origin = new URL(inviteUrl).origin;
      } catch {}
    }
    if (!token || !origin) {
      setMsg("Remote invite is missing token or origin.");
      return;
    }
    if (!(await checkRemoteOriginReachable(origin))) {
      setMsg("Shared invite host is not reachable. Copy token or configure a working public invite origin.");
      return;
    }
    setRemoteSyncBusy((m) => ({ ...m, [inv.id]: true }));
    try {
      const res = await fetchRemoteJsonFromOrigin(origin, `/invites/${encodeURIComponent(token)}`, { method: "GET" });
      await ingestRemoteSnapshot({
        origin,
        token,
        inviteUrl,
        snapshot: res
      });
      await refreshRemoteReceivedList();
    } catch (e: any) {
      if (isNotFoundInviteError(e)) {
        try {
          await ingestRemoteSnapshot({
            origin,
            token,
            inviteUrl,
            forceStatus: "tombstoned"
          });
          await refreshRemoteReceivedList();
          setMsg("Invite no longer exists on remote node. Marked as tombstoned locally.");
          return;
        } catch {
          // continue to standard error handling
        }
      }
      setMsg(mapAcceptErrorMessage(e?.message || "Remote sync failed"));
    } finally {
      setRemoteSyncBusy((m) => ({ ...m, [inv.id]: false }));
    }
  }

  if (isBasic) {
    return <LockedFeaturePanel title="Split Invites" />;
  }

  return (
    <div className="space-y-4">
      {!splitsAllowed ? (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/40 p-4 text-xs text-amber-200">
          {capabilityReasons?.splits || lockReasons?.advanced_splits || "Split invites require Advanced or LAN mode."}
        </div>
      ) : null}
      {splitsAllowed ? (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Invite</div>
        {tokenToUse ? (
          <div className="text-sm text-neutral-400 mt-1 break-all">token: {tokenToUse}</div>
        ) : null}
        {remoteOriginFromLocation ? (
          <div className="text-xs text-neutral-400 mt-1">Remote invite: {remoteOriginFromLocation}</div>
        ) : null}
        {remoteOriginFromLocation && remoteOriginReachable === false ? (
          <div className="mt-2 text-xs text-amber-300">
            Shared invite host is not reachable. Copy token or configure a working public invite origin.
          </div>
        ) : null}
        {remoteOriginFromLocation && tokenToUse && remoteOriginReachable !== false ? (
          <div className="mt-2">
            <a
              href={`${remoteOriginFromLocation.replace(/\/+$/, "")}/invite/${encodeURIComponent(tokenToUse)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-neutral-400 underline"
            >
              Open remote invite page
            </a>
          </div>
        ) : null}

        {me && (
          <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/10 p-3">
            <div className="text-sm font-medium">Create invites</div>
            <div className="text-xs text-neutral-400">Select a content item to generate invite URLs for its latest split.</div>
            <div className="text-[11px] text-neutral-500 mt-1">
              Invite links use a neutral shared host when configured (recommended for scale).
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="invite-content-select">
                Select content
              </label>
              <select
                id="invite-content-select"
                name="inviteContent"
                value={selectedContentId}
                onChange={(e) => {
                  setSelectedContentId(e.target.value);
                  setCreatedInvites([]);
                  setCreateMsg(null);
                }}
                className="text-sm rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
              >
                <option value="">Select content…</option>
                {contentList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>

              <button
                disabled={!selectedSplitId || !inviteAllowed}
                onClick={async () => {
                  if (!selectedSplitId) return;
                  setCreateMsg(null);
                  try {
                    const res = await api<{ ok: true; created: number; invites: CreatedInviteRow[] }>(
                      `/split-versions/${selectedSplitId}/invite`,
                      "POST",
                      {}
                    );
                    const invites = Array.isArray(res.invites) ? res.invites : [];
                    setCreatedInvites(invites);
                    const firstPending = invites.find(
                      (i) =>
                        (i.status || "pending") === "pending" &&
                        (i.targetType || "email") === "email" &&
                        i.participantEmail &&
                        i.inviteUrl
                    );
                    if (firstPending) {
                      openExternalInNewWindow(buildInviteMailto(firstPending));
                      setCreateMsg(
                        invites.length > 1
                          ? `Created ${res.created} invite(s). Opened email draft for ${firstPending.participantEmail}; use copy/resend for others.`
                          : `Created ${res.created} invite(s). Opened email draft.`
                      );
                    } else {
                      const hasLocalOnly = invites.some((i) => !i.inviteUrl);
                      setCreateMsg(
                        hasLocalOnly
                          ? `Created ${res.created} invite(s). No shareable public invite origin is configured yet; share token(s) only.`
                          : `Created ${res.created} invite(s)`
                      );
                    }
                  } catch (e: any) {
                    setCreateMsg(e?.message || "Create invites failed");
                  }
                }}
                className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed"
                title={!inviteAllowed ? inviteReason : "Create invites"}
              >
                Create invites
              </button>
            </div>
            {!inviteAllowed ? <div className="mt-2 text-[11px] text-amber-300">{inviteReason}</div> : null}

            {createMsg ? <div className="mt-2 text-xs text-neutral-300">{createMsg}</div> : null}

            {createdInvites.length > 0 && (
              <div className="mt-3 space-y-2">
                {createdInvites.map((inv) => (
                  <div key={inv.splitParticipantId} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-neutral-400">
                        {inv.acceptedAt ? "Accepted" : inv.participantState === "active" ? "Active" : "Invited"}
                      </div>
                      {!inv.acceptedAt ? (
                        <div className="text-xs text-neutral-200 break-all">{inv.inviteUrl || `Token: ${inv.token}`}</div>
                      ) : null}
                      <div className="text-[11px] text-neutral-400">
                        To: {inviteTargetLabel(inv)}
                      </div>
                      {!inv.acceptedAt && !inv.inviteUrl ? (
                        <div className="text-[11px] text-amber-300">
                          No shareable public invite origin is configured on this node. Share token only.
                        </div>
                      ) : null}
                      {!inv.acceptedAt && inv.inviteUrl ? (
                        <div className="text-[11px] text-neutral-500">Invite URL is shareable across machines.</div>
                      ) : null}
                      {!inv.acceptedAt ? (
                        <div className="text-[11px] text-amber-300">
                          Pending identity bind. Acceptance requires Basic account + verified key.
                        </div>
                      ) : null}
                    </div>
                    {!inv.acceptedAt ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigator.clipboard.writeText(String(inv.inviteUrl || inv.token))}
                          className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                        >
                          {inv.inviteUrl ? "Copy link" : "Copy token"}
                        </button>
                        {(inv.targetType || "email") === "email" && inv.inviteUrl ? (
                          <button
                            onClick={() => {
                              if (!inv.participantEmail) return;
                              openExternalInNewWindow(buildInviteMailto(inv));
                            }}
                            className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                            title="Open default mail client with invite link"
                          >
                            Resend email
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 border-t border-neutral-800 pt-3">
              <label className="text-xs text-neutral-400" htmlFor="invite-paste-link">
                Paste invite link or token
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  id="invite-paste-link"
                  name="invitePaste"
                  value={pasteRaw}
                  onChange={(e) => setPasteRaw(e.target.value)}
                  placeholder="https://invites.contentbox.link/invite/<token> or token"
                  className="text-sm rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 w-full md:w-[420px]"
                  autoComplete="off"
                />
                <button
                  onClick={openPastedInvite}
                  className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
                >
                  Open
                </button>
              </div>
              {pasteMsg ? <div className="mt-2 text-xs text-amber-300">{pasteMsg}</div> : null}
            </div>
          </div>
        )}

        {/* If signed in, show invite history (tokens are shown only at creation time). */}
        {me && (myInvites || receivedInvites || remoteReceivedInvites) && (
          <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/10 p-3 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs text-neutral-400">Invite lists</div>
              <button
                type="button"
                className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                onClick={() => setShowHistory((s) => !s)}
              >
                {showHistory ? "Show active only" : "Show history"}
              </button>
            </div>
            <div>
              <div className="text-sm font-medium">Collaborators & invites</div>
              <div className="text-xs text-neutral-400">
                One row per identity-targeted participant. Pending rows include the shareable invite artifact when available.
              </div>
              {dedupedSentInvites.length === 0 && <div className="mt-2 text-xs text-neutral-500">No collaborator invites yet.</div>}
              {dedupedSentInvites.length > 0 && (
                <div className="mt-2 space-y-2 text-sm text-neutral-200">
                  {groupByContent(dedupedSentInvites).map((group) => {
                    const open = sentOpen[group.key] ?? true;
                    return (
                      <div key={group.key} className="rounded-md border border-neutral-800 bg-neutral-950/40 p-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm">{group.title}</div>
                          <button
                            onClick={() => setSentOpen((m) => ({ ...m, [group.key]: !open }))}
                            className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                          >
                            {open ? "Hide" : "Show"}
                          </button>
                        </div>
                        {open && (
                          <div className="mt-2 space-y-2">
                            {group.invites.map((inv) => {
                              const status = inviteStatus(inv);
                              const pending = status === "pending";
                              return (
                                <div key={inv.id} className="flex items-center justify-between gap-2">
                                  <div className="break-all">
                                    <div className="text-[11px] text-neutral-500">{inviteAudienceLabel(inv)}</div>
                                    <div className="text-xs text-neutral-400">To: {inviteTargetLabel(inv)}</div>
                                    <div className="text-xs text-neutral-400">Role/share: {inv?.role || "participant"} • {num(inv?.percent ?? 0)}%</div>
                                    <div className="text-xs text-neutral-400">Created: {formatDate(inv.createdAt)}</div>
                                    <div className="text-xs text-neutral-400">Expires: {formatDate(inv.expiresAt)}</div>
                                    {pending ? (
                                      <div className="text-[11px] text-amber-300">
                                        Pending claim {inv?.inviteUrl ? "• invite link ready" : "• token ready"}
                                      </div>
                                    ) : null}
                                    {inv.contentDeletedAt ? (
                                      <div className="text-[11px] text-amber-300">Tombstoned</div>
                                    ) : null}
                                    {inv.acceptedAt ? <div className="text-xs text-emerald-300">Redeemed: {formatDate(inv.acceptedAt)}</div> : null}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="text-xs uppercase tracking-wide text-neutral-400">{status}</div>
                                    {pending ? (
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => navigator.clipboard.writeText(String(inv.inviteUrl || inv.token || ""))}
                                          className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                        >
                                          {inv?.inviteUrl ? "Copy link" : "Copy token"}
                                        </button>
                                        <button
                                          onClick={async () => {
                                            try {
                                              await api(`/invites/${encodeURIComponent(inv.id)}`, "DELETE");
                                              setMyInvites((list) => (list || []).filter((x) => x.id !== inv.id));
                                            } catch (e: any) {
                                              setMsg(e?.message || "Delete failed");
                                            }
                                          }}
                                          className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <div className="text-sm font-medium">Received invites</div>
              <div className="text-xs text-neutral-400">Invites addressed to your account, including remote nodes.</div>
              <div className="mt-1 text-[11px] text-neutral-500">
                Local auth: {me ? `${me.displayName || me.email || "signed in"}${me.email ? ` (${me.email})` : ""}` : "not signed in"} • Device can sign:{" "}
                {localSigning ? (localSigning.canSign ? "yes" : "no") : "unknown"} • Key verified:{" "}
                {localSigning ? (localSigning.keyVerified ? "yes" : "no") : "unknown"}
              </div>
              {visibleReceivedInvites.length === 0 && visibleRemoteInvites.length === 0 ? (
                <div className="mt-2 text-xs text-neutral-500">No received invites yet.</div>
              ) : null}
              {visibleReceivedInvites.length > 0 && (
                <div className="mt-2 space-y-2 text-sm text-neutral-200">
                  {groupByContent(visibleReceivedInvites).map((group) => {
                    const open = receivedOpen[group.key] ?? true;
                    return (
                      <div key={group.key} className="rounded-md border border-neutral-800 bg-neutral-950/40 p-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm">{group.title}</div>
                          <button
                            onClick={() => setReceivedOpen((m) => ({ ...m, [group.key]: !open }))}
                            className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                          >
                            {open ? "Hide" : "Show"}
                          </button>
                        </div>
                        {open && (
                          <div className="mt-2 space-y-2">
                            {group.invites.map((inv) => {
                              const status = inviteStatus(inv);
                              return (
                                <div key={inv.id} className="flex items-center justify-between gap-2">
                                  <div className="break-all">
                                    <div className="text-[11px] text-neutral-500">{inviteAudienceLabel(inv)}</div>
                                    <div className="text-xs text-neutral-400">Target: {inviteTargetLabel(inv)}</div>
                                    <div className="text-xs text-neutral-400">
                                      {titleCase(inv.contentType)} • {statusLabel(inv.contentStatus)} • v{inv.splitVersionNum ?? "—"} • {statusLabel(inv.splitStatus)}
                                    </div>
                                    {inv.role ? <div className="text-xs text-neutral-400">Role: {inv.role}</div> : null}
                                    {inv.percent !== null && inv.percent !== undefined ? (
                                      <div className="text-xs text-neutral-400">Percent: {num(inv.percent)}%</div>
                                    ) : null}
                                    <div className="text-xs text-neutral-400">Created: {formatDate(inv.createdAt)}</div>
                                    <div className="text-xs text-neutral-400">Expires: {formatDate(inv.expiresAt)}</div>
                                    {inv.contentDeletedAt ? <div className="text-[11px] text-amber-300">Tombstoned</div> : null}
                                    {inv.acceptedAt ? <div className="text-xs text-emerald-300">Redeemed: {formatDate(inv.acceptedAt)}</div> : null}
                                  </div>
                                  <div className="text-xs uppercase tracking-wide text-neutral-400">{status}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {dedupedRemoteInvites.length > 0 && (
                <div className="mt-2 space-y-2 text-sm text-neutral-200">
                  {groupByContent(dedupedRemoteInvites).map((group) => {
                    const open = receivedOpen[group.key] ?? true;
                    return (
                      <div key={group.key} className="rounded-md border border-neutral-800 bg-neutral-950/40 p-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm">{group.title}</div>
                          <button
                            onClick={() => setReceivedOpen((m) => ({ ...m, [group.key]: !open }))}
                            className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                          >
                            {open ? "Hide" : "Show"}
                          </button>
                        </div>
                        {open && (
                          <div className="mt-2 space-y-2">
                            {group.invites.map((inv) => {
                              const accepted = Boolean(inv.acceptedAt);
                              return (
                                <div key={inv.id} className="flex items-center justify-between gap-2">
                                  <div className="break-all">
                                    <div className="text-[11px] text-neutral-500">Received from remote node</div>
                                    <div className="text-xs text-neutral-400">
                                      {titleCase(inv.contentType)} • {statusLabel(inv.contentStatus)} • v{inv.splitVersionNum ?? "—"} • {statusLabel(inv.splitStatus)}
                                    </div>
                                    <div className="text-xs text-neutral-400">From: Remote node</div>
                                    {inv.role ? <div className="text-xs text-neutral-400">Role: {inv.role}</div> : null}
                                    {inv.percent !== null && inv.percent !== undefined ? (
                                      <div className="text-xs text-neutral-400">Percent: {num(inv.percent)}%</div>
                                    ) : null}
                                    <div className="text-xs text-neutral-400">Created: {formatDate(inv.createdAt)}</div>
                                    <div className="text-xs text-neutral-400">Expires: {formatDate(inv.expiresAt)}</div>
                                    {inv.contentDeletedAt ? <div className="text-[11px] text-amber-300">Tombstoned</div> : null}
                                    {inv.remoteOrigin ? <div className="text-[10px] text-neutral-500">Remote: {inv.remoteOrigin}</div> : null}
                                    {accepted ? <div className="text-xs text-emerald-300">Redeemed: {formatDate(inv.acceptedAt)}</div> : null}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => syncRemoteInvite(inv)}
                                      className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-50"
                                      disabled={remoteSyncBusy[inv.id]}
                                    >
                                      {remoteSyncBusy[inv.id] ? "Syncing…" : "Sync"}
                                    </button>
                                    {!accepted ? (
                                      <button
                                        onClick={() => acceptRemoteInvite(inv)}
                                        className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-50"
                                        disabled={remoteAcceptBusy[inv.id]}
                                      >
                                        {remoteAcceptBusy[inv.id] ? "Accepting…" : "Accept"}
                                      </button>
                                    ) : null}
                                    <div className="text-xs uppercase tracking-wide text-neutral-400">
                                      {accepted ? "accepted" : "pending"}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {me ? (
          <div className="mt-4">
            {remoteReceivedInvites && remoteReceivedInvites.length > 0 ? (
              <div className="mb-2 text-xs text-neutral-500">
                Remote invites do not include local history or audit events.
              </div>
            ) : null}
            <HistoryFeed
              title="Invites history"
              items={historyItems}
              loading={historyLoading}
              emptyText="No invite history yet."
              exportName="invite-history.json"
              onRefresh={async () => {
                setHistoryLoading(true);
                try {
                  const hist = await api<HistoryEvent[]>("/me/invite-history", "GET");
                  setHistoryItems(hist || []);
                } catch {
                  setHistoryItems([]);
                } finally {
                  setHistoryLoading(false);
                }
              }}
            />
            <div className="mt-2">
              <AuditPanel
                scopeType="invite"
                title="Audit"
                exportName="invite-audit.json"
              />
            </div>
          </div>
        ) : null}

        {loading && <div className="mt-4 text-sm text-neutral-300">Loading invite…</div>}

        {!loading && data && tokenToUse && (
          <>
            {/* Audit events for this invite */}
            <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/10 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Invite audit history</div>
                  <div className="text-xs text-neutral-400">Creation, acceptance, and expiry for this invite</div>
                </div>
                <button
                  onClick={() => setShowInviteAuditEvents((s) => !s)}
                  className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                >
                  {showInviteAuditEvents ? "Hide" : "Show"}
                </button>
              </div>

              {showInviteAuditEvents && (
                <div className="mt-3 space-y-3 text-sm text-neutral-200">
                  {inviteAuditEventsList.length === 0 ? (
                    <div className="text-xs text-neutral-500">No audit events yet.</div>
                  ) : (
                    inviteAuditEventsList.map((e) => (
                      <div key={e.id} className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                        <div className="text-xs text-neutral-400">
                          {e.action} • {new Date(e.createdAt).toLocaleString()}
                          {e.user?.email ? ` • ${e.user.email}` : e.userId ? ` • ${e.userId}` : ""}
                        </div>
                        <pre className="mt-2 text-xs text-neutral-300 whitespace-pre-wrap">{JSON.stringify(e.payloadJson || e.payload || {}, null, 2)}</pre>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 space-y-2">
            <div className="text-sm text-neutral-300">
              Content: <span className="text-neutral-100">{data.content.title}</span>
            </div>

            <div className="text-sm text-neutral-400">
              Split version: <span className="text-neutral-200">v{data.splitVersion.versionNumber}</span> • <span className="text-neutral-200">{data.splitVersion.status}</span>
            </div>

            <div className="text-sm text-neutral-400">
              You are invited as:{" "}
              <span className="text-neutral-200">{resolvedInviteTargetLabel}</span>
            </div>

            <div className="text-xs text-neutral-500">
              Current auth user (backend):{" "}
              <span className="text-neutral-300">
                {authCtx?.authenticated
                  ? `${authCtx.email || "signed in"}`
                  : "not signed in"}
              </span>
            </div>

            <div className="text-xs text-neutral-500">
              Expected target:{" "}
              <span className="text-neutral-300">{resolvedInviteTargetLabel}</span>
            </div>

            <div className="text-xs text-neutral-500">
              Backend key verification:{" "}
              <span className="text-neutral-300">
                {backendKeyVerified === null ? "unknown (not authenticated)" : backendKeyVerified ? "verified" : "unverified"}
              </span>
            </div>

            {me && authCtx?.authenticated && (me.id !== authCtx.userId || normalizeEmail(me.email || "") !== normalizeEmail(authCtx.email || "")) ? (
              <div className="text-xs text-amber-300">
                Session mismatch: UI identity and backend auth identity differ. Re-authenticate on this origin before accepting.
              </div>
            ) : null}

            <div className="text-sm text-neutral-400">
              Role: <span className="text-neutral-200">{data.splitParticipant.role}</span> • Percent: <span className="text-neutral-200">{num(data.splitParticipant.percent)}%</span>
            </div>

            <div className="text-xs text-neutral-500">
              Expires: {new Date(data.invitation.expiresAt).toLocaleString()}
              {expired ? <span className="ml-2 text-red-300">expired</span> : null}
              {alreadyAccepted ? <span className="ml-2 text-green-300">accepted</span> : null}
            </div>

            <div className="pt-2">
              {inviteAuthRequired ? (
                <div className="space-y-2">
                  <div className="text-xs text-amber-300">Sign in to accept this invite.</div>
                  <button
                    onClick={() => {
                      window.location.href = "/";
                    }}
                    className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
                  >
                    Sign in to accept
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    disabled={
                      busy ||
                      expired ||
                      alreadyAccepted ||
                      inviteWrongIdentity ||
                      backendKeyVerified === false ||
                      inviteAcceptSurfaceBlocked
                    }
                    onClick={acceptInvite}
                    className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-50"
                  >
                    Accept invite
                  </button>
                  {inviteAcceptSurfaceBlocked ? (
                    <div className="text-xs text-amber-300">
                      View-only surface detected. Acceptance is available on the signed-in creator surface (port 4000).
                    </div>
                  ) : null}
                </div>
              )}
              {inviteWrongIdentity ? (
                <div className="mt-2 text-xs text-amber-300">
                  Signed in as wrong identity for this invite target. Switch account and retry.
                </div>
              ) : null}
              {!inviteAuthRequired && backendKeyVerified === false ? (
                <div className="mt-2 text-xs text-amber-300">Backend verification says your key is not verified for invite acceptance.</div>
              ) : null}
            </div>
          </div>
        </>
        )}

        {msg && <div className="mt-4 text-sm text-neutral-300">{msg}</div>}
      </div>
      ) : null}
    </div>
  );
}
