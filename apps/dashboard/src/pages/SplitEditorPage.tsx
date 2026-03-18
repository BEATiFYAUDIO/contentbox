import React from "react";
import { api } from "../lib/api";
import type { FeatureMatrix, CapabilitySet } from "../lib/identity";
import HistoryFeed, { type HistoryEvent } from "../components/HistoryFeed";
import AuditPanel from "../components/AuditPanel";

type ContentItem = {
  id: string;
  title: string;
  type: "song" | "book" | "video" | "file" | "remix" | "mashup" | "derivative";
  status: "draft" | "published";
  createdAt: string;
  priceSats?: string | null;
  canEdit?: boolean;
};

type SplitParticipant = {
  id: string;
  participantEmail: string;
  role: string;
  percent: any; // Decimal may serialize as string
  createdAt: string;
  participantUserId?: string | null;
  invitationId?: string | null;
  invitationStatus?: "pending" | "accepted" | "declined" | "revoked" | "expired" | "tombstoned" | null;
  invitationTargetType?: "email" | "local_user" | "identity_ref" | null;
  invitationTargetValue?: string | null;
  targetType?: "email" | "local_user" | "identity_ref" | null;
  targetValue?: string | null;
  payoutIdentityId?: string | null;
  acceptedAt?: string | null;
  verifiedAt?: string | null;
};

type SplitVersion = {
  id: string;
  contentId: string;
  versionNumber: number;
  status: "draft" | "locked";
  lockedAt?: string | null;
  createdAt: string;
  participants: SplitParticipant[];

  // proof fields (present on model; may be null until locked)
  lockedFileObjectKey?: string | null;
  lockedFileSha256?: string | null;

  // optional if you enrich server response
  lockedFileOriginalName?: string | null;
};

type Row = {
  id?: string | null;
  participantEmail: string;
  role: string;
  percent: string;
  participantUserId?: string | null;
  invitationId?: string | null;
  invitationStatus?: "pending" | "accepted" | "declined" | "revoked" | "expired" | "tombstoned" | null;
  targetType?: "email" | "local_user" | "identity_ref" | null;
  targetValue?: string | null;
  acceptedAt?: string | null;
  verifiedAt?: string | null;
  resolutionKind?: "identity" | "email_invite" | "invalid" | null;
  resolvedUserId?: string | null;
  resolvedDisplay?: string | null;
  normalizedEmail?: string | null;
  resolvedVerifiedKey?: boolean | null;
};

function mapParticipantToRow(p: SplitParticipant): Row {
  const invitationStatus = p.invitationStatus || (p.participantUserId && p.acceptedAt ? "accepted" : null);
  const canonicalTargetType =
    p.targetType || p.invitationTargetType || (p.participantUserId ? "local_user" : (p.participantEmail ? "email" : null));
  const canonicalTargetValue =
    p.targetValue || p.invitationTargetValue || p.participantUserId || p.participantEmail || null;
  const hasIdentityClaim =
    (canonicalTargetType === "local_user" || canonicalTargetType === "identity_ref") &&
    Boolean(String(canonicalTargetValue || "").trim());
  const hasEmailClaim =
    canonicalTargetType === "email" &&
    Boolean(normEmail(canonicalTargetValue || p.participantEmail || ""));
  const resolutionKind: Row["resolutionKind"] = hasIdentityClaim
    ? "identity"
    : hasEmailClaim
      ? "email_invite"
      : "invalid";

  return {
    id: p.id,
    participantEmail: p.participantEmail,
    role: p.role,
    percent: percentToString(p.percent),
    participantUserId: p.participantUserId || null,
    invitationId: p.invitationId || null,
    invitationStatus,
    targetType: canonicalTargetType,
    targetValue: canonicalTargetValue,
    acceptedAt: p.acceptedAt || null,
    verifiedAt: p.verifiedAt || null,
    resolutionKind,
    resolvedUserId: p.participantUserId || (hasIdentityClaim ? String(canonicalTargetValue) : null),
    resolvedDisplay: canonicalTargetValue || p.participantUserId || p.participantEmail || null,
    normalizedEmail: p.participantEmail || null,
    resolvedVerifiedKey: p.verifiedAt ? true : null
  };
}

type ParticipantResolveResponse =
  | { kind: "identity"; userId: string; display?: string | null; email?: string | null; verifiedKey?: boolean }
  | { kind: "email_invite"; email: string }
  | { kind: "identity_ref"; ref: string }
  | { kind: "invalid" };


type ProofData = {
  proofHash: string;
  manifestHash: string;
  splitsHash: string;
  payload: any;
  signatures?: any[];
};

function num(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function percentToString(v: any): string {
  if (v === null || v === undefined) return "0";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  try {
    if (typeof v?.toString === "function") {
      const s = v.toString();
      if (s && s !== "[object Object]") return s;
    }
    if (typeof v?.toNumber === "function") {
      const n = v.toNumber();
      if (Number.isFinite(n)) return String(n);
    }
    if (typeof v?.value === "string" || typeof v?.value === "number") {
      return String(v.value);
    }
  } catch {}
  return String(v);
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function normEmail(s: string) {
  return (s || "").trim().toLowerCase();
}

function shortHash(h?: string | null) {
  const s = (h || "").trim();
  if (!s) return "";
  if (s.length <= 18) return s;
  return `${s.slice(0, 10)}…${s.slice(-8)}`;
}

function titleCase(s?: string | null) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

function downloadJson(filename: string, data: any) {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    // ignore
  }
}

export default function SplitEditorPage(props: {
  contentId: string | null;
  onGoToPayouts?: () => void;
  onNotFound?: () => void;
  identityLevel?: string | null;
  features?: FeatureMatrix;
  lockReasons?: Record<string, string>;
  capabilities?: CapabilitySet;
  capabilityReasons?: Record<string, string>;
}) {
  const { contentId, onGoToPayouts, onNotFound, features, lockReasons, capabilities, capabilityReasons } = props;
  const canAdvancedSplits = features?.advancedSplits ?? false;
  const splitsAllowed = capabilities?.useSplits ?? canAdvancedSplits;
  const lockAllowed = capabilities?.lockSplits ?? canAdvancedSplits;
  const crossNodeAllowed = capabilities?.requestClearance ?? true;
  const lockReason =
    capabilityReasons?.lock || capabilityReasons?.splits || lockReasons?.advanced_splits || "Split editing requires Advanced or LAN mode.";
  const clearanceReason =
    capabilityReasons?.clearance ||
    "You can prepare this action, but a permanent named link must be online to perform it.";

  const [content, setContent] = React.useState<ContentItem | null>(null);
  const [versions, setVersions] = React.useState<SplitVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = React.useState<string | null>(null);
  const [upstreamInfo, setUpstreamInfo] = React.useState<{
    linkId: string;
    relation: string;
    upstreamBps: number;
    requiresApproval: boolean;
    approvedAt?: string | null;
    parent: { id: string; title: string } | null;
    canRequestApproval?: boolean;
    canVote?: boolean;
  } | null>(null);
  const [upstreamError, setUpstreamError] = React.useState<string | null>(null);
  const [upstreamMultiParent, setUpstreamMultiParent] = React.useState(false);
  const [showLinkModal, setShowLinkModal] = React.useState(false);
  const [linkParentId, setLinkParentId] = React.useState("");
  const [linkRelation, setLinkRelation] = React.useState("derivative");
  const [linkSaving, setLinkSaving] = React.useState(false);
  const [linkCandidates, setLinkCandidates] = React.useState<Array<{ id: string; title: string }>>([]);
  const [upstreamVotePct, setUpstreamVotePct] = React.useState("10");

  const selectedVersion = React.useMemo(
    () => versions.find((v) => v.id === selectedVersionId) || null,
    [versions, selectedVersionId]
  );

  const latest = versions[0] || null;
  const latestIsEditable = latest?.status === "draft";

  const [rows, setRows] = React.useState<Row[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [auditByParticipant, setAuditByParticipant] = React.useState<Record<string, { remoteVerified: boolean; remoteNodeUrl?: string | null; remoteUserId?: string | null }>>({});
  const [historyItems, setHistoryItems] = React.useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [proofByVersionId, setProofByVersionId] = React.useState<Record<string, ProofData | null>>({});
  const [proofLoadingId, setProofLoadingId] = React.useState<string | null>(null);
  const [proofView, setProofView] = React.useState<ProofData | null>(null);
  const [proofError, setProofError] = React.useState<string | null>(null);
  const [payUnits, setPayUnits] = React.useState("2");
  const [purchase, setPurchase] = React.useState<{ id: string; bolt11: string; status: "unpaid" | "paid" | "expired"; receiptId?: string | null } | null>(null);
  const [payMsg, setPayMsg] = React.useState<string | null>(null);
  const [paymentsReadiness, setPaymentsReadiness] = React.useState<{ lightning: { ready: boolean; reason?: string | null } } | null>(null);
  const [meEmail, setMeEmail] = React.useState<string>("");
  const [meUserId, setMeUserId] = React.useState<string>("");
  const [resolvingByRowKey, setResolvingByRowKey] = React.useState<Record<string, boolean>>({});

  const hasValidIdentityTarget = (r: Row) =>
    (r.targetType === "local_user" || r.targetType === "identity_ref") && Boolean(String(r.targetValue || "").trim());
  const hasValidEmailTarget = (r: Row) =>
    r.targetType === "email" && Boolean(normEmail(String(r.targetValue || r.normalizedEmail || r.participantEmail || "")));
  const hasValidTarget = (r: Row) => hasValidIdentityTarget(r) || hasValidEmailTarget(r);

  const activeRows = rows.filter(
    (r) =>
      Boolean(
        r.participantUserId &&
          r.verifiedAt &&
          (r.invitationStatus === "accepted" || (!r.invitationStatus && r.acceptedAt))
      )
  );
  const total = round3(activeRows.reduce((s, r) => s + num(r.percent), 0));
  const intendedRows = rows.filter((r) => hasValidTarget(r));
  const intendedTotal = round3(intendedRows.reduce((s, r) => s + num(r.percent), 0));
  const pendingCount = rows.filter((r) => hasValidTarget(r) && !activeRows.includes(r)).length;
  const candidateTotal = round3(
    rows.reduce((s, r) => {
      const email = normEmail(r.participantEmail || "");
      const isBoundActive = Boolean(
        r.participantUserId &&
          r.verifiedAt &&
          (r.invitationStatus === "accepted" || (!r.invitationStatus && r.acceptedAt))
      );
      const isOwnerCandidate = Boolean(
        !isBoundActive &&
          ((meUserId && r.targetType === "local_user" && r.targetValue === meUserId) || (meEmail && email === meEmail))
      );
      return s + (isBoundActive || isOwnerCandidate ? num(r.percent) : 0);
    }, 0)
  );
  const totalOk = total === 100;
  const intendedTotalOk = intendedTotal === 100;
  const readinessLoaded = paymentsReadiness !== null;
  const lightningReady = paymentsReadiness?.lightning?.ready ?? true;
  const lightningReason = paymentsReadiness?.lightning?.reason ?? "UNKNOWN";
  const lightningBlocked = readinessLoaded && !lightningReady;

  function rowKey(r: Row, idx: number) {
    return r.id ? `id:${r.id}` : `idx:${idx}`;
  }

  function isNotFoundError(err: any) {
    const msg = String(err?.message || err || "");
    return /404\b/i.test(msg) || /not found/i.test(msg);
  }

  async function loadAll(id: string) {
    setMsg(null);

    let c: ContentItem | null = null;
    let v: SplitVersion[] = [];
    try {
      [c, v] = await Promise.all([
        api<ContentItem>(`/content/${id}`, "GET"),
        api<SplitVersion[]>(`/content/${id}/split-versions`, "GET")
      ]);
    } catch (e: any) {
      setContent(null);
      setVersions([]);
      setSelectedVersionId(null);
      setRows([]);
      setMsg(e?.message || "Failed to load splits");
      if (isNotFoundError(e)) {
        onNotFound?.();
      }
      throw e;
    }

    setContent(c);
    setVersions(v);

    const pick = v[0]?.id || null;
    setSelectedVersionId(pick);

    const base = v[0] || null;
    const participants = base?.participants || [];

    setRows(
      participants.length
        ? participants.map(mapParticipantToRow)
        : [{ participantEmail: "", role: "writer", percent: "100", participantUserId: null, invitationId: null, invitationStatus: null, targetType: null, targetValue: null, acceptedAt: null, verifiedAt: null, resolutionKind: null, resolvedUserId: null, resolvedDisplay: null, normalizedEmail: null, resolvedVerifiedKey: null }]
    );

    try {
      const latestId = v[0]?.id;
      if (latestId) {
        const events = await api<any>(`/split-versions/${latestId}/audit`, "GET");
        const map: Record<string, any> = {};
        for (const ev of events || []) {
          if (ev.action === "invite.accept" && ev.payload && ev.payload.splitParticipantId) {
            map[ev.payload.splitParticipantId] = {
              remoteVerified: Boolean(ev.payload.remoteVerified),
              remoteNodeUrl: ev.payload.remoteNodeUrl || null,
              remoteUserId: ev.payload.remoteUserId || null
            };
          }
        }
        setAuditByParticipant(map);
      }
    } catch {
      setAuditByParticipant({});
    }

    try {
      setHistoryLoading(true);
      const hist = await api<HistoryEvent[]>(`/content/${id}/split-history`, "GET");
      setHistoryItems(hist || []);
    } catch {
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  React.useEffect(() => {
    if (!splitsAllowed) {
      setPaymentsReadiness(null);
      return;
    }
    api<{ lightning: { ready: boolean; reason?: string | null } }>("/api/payments/readiness", "GET")
      .then((r) => setPaymentsReadiness(r))
      .catch(() => setPaymentsReadiness(null));
  }, [splitsAllowed]);

  React.useEffect(() => {
    if (!splitsAllowed) return;
    api<{ id?: string; email?: string }>("/me", "GET")
      .then((m) => {
        setMeEmail(normEmail(m?.email || ""));
        setMeUserId(String(m?.id || "").trim());
      })
      .catch(() => {
        setMeEmail("");
        setMeUserId("");
      });
  }, [splitsAllowed]);

  React.useEffect(() => {
    if (!splitsAllowed) {
      setContent(null);
      setVersions([]);
      setSelectedVersionId(null);
      setRows([]);
      setProofByVersionId({});
      setPurchase(null);
      setPayMsg(null);
      setUpstreamInfo(null);
      return;
    }
    if (!contentId) {
      setContent(null);
      setVersions([]);
      setSelectedVersionId(null);
      setRows([]);
      setProofByVersionId({});
      setPurchase(null);
      setPayMsg(null);
      setUpstreamInfo(null);
      setMsg("Split editor requires a contentId route: /content/:contentId/splits");
      return;
    }

    loadAll(contentId).catch((e: any) => setMsg(e?.message || "Failed to load splits"));
    api(`/content/${contentId}/parent-link`, "GET")
      .then((r: any) => {
        if (r?.parentLink === null) {
          setUpstreamInfo(null);
          setUpstreamError(null);
          setUpstreamMultiParent(false);
          return;
        }
        setUpstreamInfo(r);
        setUpstreamError(null);
        setUpstreamMultiParent(false);
      })
      .catch((e: any) => {
        // Fallback to minimal parentLink from /content/:id if available
        const fallback = (content as any)?.parentLink || null;
        if (fallback) {
          setUpstreamInfo({
            linkId: fallback.linkId,
            relation: fallback.relation,
            upstreamBps: fallback.upstreamBps,
            requiresApproval: fallback.requiresApproval,
            approvedAt: fallback.approvedAt,
            parent: fallback.parentContentId ? { id: fallback.parentContentId, title: "Original work" } : null
          } as any);
          setUpstreamError("Lineage details limited (clearance info unavailable).");
          setUpstreamMultiParent(false);
          return;
        }
        setUpstreamInfo(null);
        setUpstreamError(e?.message || "Failed to load parent link.");
        setUpstreamMultiParent(Boolean(e?.message && /multiple parent/i.test(e.message)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId, splitsAllowed]);

  React.useEffect(() => {
    if (!contentId || !selectedVersion) return;
    if (selectedVersion.status !== "locked") return;
    if (Object.prototype.hasOwnProperty.call(proofByVersionId, selectedVersion.id)) return;

    (async () => {
      setProofError(null);
      setProofLoadingId(selectedVersion.id);
      try {
        const proof = await api<ProofData>(`/content/${contentId}/splits/v${selectedVersion.versionNumber}/proof`, "GET");
        setProofByVersionId((m) => ({ ...m, [selectedVersion.id]: proof }));
      } catch (e: any) {
        setProofError(e?.message || "Failed to load proof");
        setProofByVersionId((m) => ({ ...m, [selectedVersion.id]: null }));
      } finally {
        setProofLoadingId((id) => (id === selectedVersion.id ? null : id));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId, selectedVersionId]);

  React.useEffect(() => {
    if (!purchase || purchase.status !== "unpaid") return;
    if (!contentId || !selectedVersion) return;

    const id = purchase.id;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await api<{ status: "unpaid" | "paid" | "expired"; paidAt?: string | null }>(`/v1/payments/status/${id}`, "GET");
        if (cancelled) return;
        if (res.status === "paid") {
          setPurchase((p) => (p && p.id === id ? { ...p, status: "paid" } : p));
          try {
            const receiptRes = await api<{ receiptId: string }>(`/v1/payments/receipt/${id}`, "GET");
            if (!cancelled) setPurchase((p) => (p && p.id === id ? { ...p, receiptId: receiptRes.receiptId } : p));
          } catch {}
          clearInterval(interval);
        } else if (res.status === "expired") {
          setPurchase((p) => (p && p.id === id ? { ...p, status: "expired" } : p));
          clearInterval(interval);
        }
      } catch (e: any) {
        if (!cancelled) setPayMsg(e?.message || "Payment status failed");
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [purchase?.id, purchase?.status, contentId, selectedVersionId]);

  React.useEffect(() => {
    if (!selectedVersion) return;

    const participants = selectedVersion.participants || [];
    setRows(
      participants.length
        ? participants.map(mapParticipantToRow)
        : [{ participantEmail: "", role: "writer", percent: "100", participantUserId: null, invitationId: null, invitationStatus: null, targetType: null, targetValue: null, acceptedAt: null, verifiedAt: null, resolutionKind: null, resolvedUserId: null, resolvedDisplay: null, normalizedEmail: null, resolvedVerifiedKey: null }]
    );
    setPurchase(null);
    setPayMsg(null);
  }, [selectedVersionId]);

  async function resolveParticipantAt(idx: number) {
    const current = rows[idx];
    if (!current) return;
    const query = String(current.participantEmail || "").trim();
    if (!query) {
      const next = [...rows];
      next[idx] = {
        ...next[idx],
        resolutionKind: null,
        targetType: null,
        targetValue: null,
        invitationStatus: null,
        resolvedUserId: null,
        resolvedDisplay: null,
        normalizedEmail: null,
        resolvedVerifiedKey: null,
        participantUserId: null,
        acceptedAt: null,
        verifiedAt: null
      };
      setRows(next);
      return;
    }
    const key = rowKey(current, idx);
    setResolvingByRowKey((m) => ({ ...m, [key]: true }));
    try {
      const resolved = await api<ParticipantResolveResponse>("/api/participants/resolve", "POST", { query });
      const next = [...rows];
      if (!next[idx]) return;
      if (resolved.kind === "identity") {
        const resolvedEmail = normEmail(resolved.email || "");
        const isSelf = Boolean(
          (meUserId && resolved.userId === meUserId) ||
          (meEmail && resolvedEmail && resolvedEmail === meEmail)
        );
        next[idx] = {
          ...next[idx],
          participantUserId: resolved.userId,
          targetType: "local_user",
          targetValue: resolved.userId,
          invitationStatus: isSelf ? "accepted" : null,
          resolutionKind: "identity",
          resolvedUserId: resolved.userId,
          resolvedDisplay: resolved.display || resolved.email || resolved.userId,
          normalizedEmail: resolved.email ? normEmail(resolved.email) : normEmail(query),
          resolvedVerifiedKey: Boolean(resolved.verifiedKey),
          acceptedAt: isSelf ? new Date().toISOString() : null,
          verifiedAt: isSelf ? new Date().toISOString() : null
        };
      } else if (resolved.kind === "identity_ref") {
        next[idx] = {
          ...next[idx],
          participantUserId: null,
          targetType: "identity_ref",
          targetValue: String(resolved.ref || query).trim(),
          invitationStatus: null,
          resolutionKind: "identity",
          resolvedUserId: null,
          resolvedDisplay: String(resolved.ref || query).trim(),
          normalizedEmail: null,
          resolvedVerifiedKey: null,
          acceptedAt: null,
          verifiedAt: null
        };
      } else if (resolved.kind === "email_invite") {
        next[idx] = {
          ...next[idx],
          participantUserId: null,
          targetType: "email",
          targetValue: normEmail(resolved.email),
          invitationStatus: "pending",
          resolutionKind: "email_invite",
          resolvedUserId: null,
          resolvedDisplay: resolved.email,
          normalizedEmail: normEmail(resolved.email),
          resolvedVerifiedKey: null
        };
      } else {
        next[idx] = {
          ...next[idx],
          participantUserId: null,
          targetType: null,
          targetValue: null,
          invitationStatus: null,
          resolutionKind: "invalid",
          resolvedUserId: null,
          resolvedDisplay: null,
          normalizedEmail: null,
          resolvedVerifiedKey: null,
          acceptedAt: null,
          verifiedAt: null
        };
      }
      setRows(next);
    } catch {
      const next = [...rows];
      if (!next[idx]) return;
      next[idx] = {
        ...next[idx],
        participantUserId: null,
        targetType: null,
        targetValue: null,
        invitationStatus: null,
        resolutionKind: "invalid",
        resolvedUserId: null,
        resolvedDisplay: null,
        normalizedEmail: null,
        resolvedVerifiedKey: null,
        acceptedAt: null,
        verifiedAt: null
      };
      setRows(next);
    } finally {
      setResolvingByRowKey((m) => ({ ...m, [key]: false }));
    }
  }

  async function saveLatest() {
    if (!contentId) return;
    if (!latest || latest.status !== "draft") {
      setMsg("Latest split is locked. Create a new version to edit.");
      return;
    }

    const invalidRows: number[] = [];
    type SaveParticipant = {
      participantEmail: string;
      participantUserId: string | null;
      targetType: "email" | "local_user" | "identity_ref";
      targetValue: string;
      role: string;
      percent: number;
    };
    const raw = rows
      .map((r, idx): SaveParticipant | null => {
        const role = (r.role || "").trim();
        const percent = Number(String(r.percent ?? "").trim());
        const hasInput = String(r.participantEmail || "").trim().length > 0;
        const explicitType = (String(r.targetType || "").trim().toLowerCase() || null) as
          | "email"
          | "local_user"
          | "identity_ref"
          | null;
        const explicitValue = String(r.targetValue || "").trim();
        const resolvedUserId = String(r.resolvedUserId || "").trim();
        const participantUserId = String(r.participantUserId || "").trim();
        const email = normEmail(r.normalizedEmail || r.participantEmail || "");

        if (!hasInput && !explicitType && !explicitValue && !resolvedUserId && !participantUserId) return null;
        if (!role || !Number.isFinite(percent) || percent < 0 || percent > 100) {
          invalidRows.push(idx + 1);
          return null;
        }

        const boundUser = participantUserId || resolvedUserId || null;
        if (boundUser) {
          return {
            participantEmail: email.includes("@") ? email : "",
            participantUserId: boundUser,
            targetType: "local_user" as const,
            targetValue: explicitValue || boundUser,
            role,
            percent
          };
        }

        if ((explicitType === "local_user" || explicitType === "identity_ref") && explicitValue) {
          return {
            participantEmail: email.includes("@") ? email : "",
            participantUserId: null,
            targetType: explicitType,
            targetValue: explicitValue,
            role,
            percent
          };
        }

        if ((explicitType === "email" && explicitValue) || (!explicitType && email.includes("@"))) {
          const targetEmail = normEmail(explicitValue || email);
          if (!targetEmail.includes("@")) {
            invalidRows.push(idx + 1);
            return null;
          }
          return {
            participantEmail: targetEmail,
            participantUserId: null,
            targetType: "email" as const,
            targetValue: targetEmail,
            role,
            percent
          };
        }

        invalidRows.push(idx + 1);
        return null;
      })
      .filter((p): p is SaveParticipant => Boolean(p));

    if (invalidRows.length > 0) {
      setMsg(`Some rows are invalid or unresolved: ${invalidRows.join(", ")}`);
      return;
    }

    if (raw.length === 0) {
      setMsg("Add at least one participant.");
      return;
    }

    const keyOf = (p: SaveParticipant) =>
      p.participantUserId ? `u:${p.participantUserId}` : `${p.targetType}:${String(p.targetValue || p.participantEmail).toLowerCase()}`;
    const keyCounts = new Map<string, number>();
    for (const p of raw) {
      const key = keyOf(p);
      keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    }
    const hasDuplicates = Array.from(keyCounts.values()).some((n) => n > 1);
    if (hasDuplicates) {
      setMsg("Duplicate participants are not allowed.");
      return;
    }

    const deduped = Array.from(
      new Map(
        raw.map((p) => [
          keyOf(p),
          p
        ])
      ).values()
    );

    const intendedTotalForSave = round3(deduped.reduce((sum, p) => sum + num(p.percent), 0));
    if (intendedTotalForSave !== 100) {
      setMsg(`Intended participant total must be 100. Current total=${intendedTotalForSave}`);
      return;
    }

    // Save draft is based on intended split validity only.
    // Active-total enforcement is lock-readiness only.

    setBusy(true);
    setMsg(null);
    try {
      await api(`/content/${contentId}/splits`, "POST", { participants: deduped });
      await loadAll(contentId);
      setMsg("Saved.");
    } catch (e: any) {
      setMsg(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function lockLatest() {
    if (!contentId) return;
    if (!latest) return;
    if (total !== 100) {
      setMsg(
        `Cannot lock yet. Accepted participants total ${total}%. Pending invites must be accepted before locking.`
      );
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      await api(`/content/${contentId}/splits/v${latest.versionNumber}/lock`, "POST");
      await loadAll(contentId);
      setMsg("Locked.");
    } catch (e: any) {
      setMsg(e?.message || "Lock failed");
    } finally {
      setBusy(false);
    }
  }

  async function createNewVersion() {
    if (!contentId) return;

    setBusy(true);
    setMsg(null);
    try {
      await api(`/content/${contentId}/split-versions`, "POST");
      await loadAll(contentId);
      setMsg("New version created.");
    } catch (e: any) {
      setMsg(e?.message || "Create version failed");
    } finally {
      setBusy(false);
    }
  }

  const canEdit = content?.canEdit !== false;
  const viewOnly = !canEdit || !latestIsEditable || (selectedVersionId && selectedVersionId !== latest?.id);
  const invitedParticipants = rows.filter((p) => p.invitationStatus === "pending");

  if (!splitsAllowed) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/40 p-4 text-xs text-amber-200">
          {lockReason}
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
          <div className="text-lg font-semibold">Splits editor</div>
          <div className="text-sm text-neutral-400 mt-1">{lockReason}</div>
        </div>
      </div>
    );
  }

  if (!contentId) {
    return (
      <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 p-6">
        <div className="text-lg font-semibold text-rose-100">Split editor route error</div>
        <div className="text-sm text-rose-200 mt-1">
          Missing <code>contentId</code>. Use <code>/content/:contentId/splits</code>.
        </div>
      </div>
    );
  }

  const upstreamRatePct =
    upstreamInfo?.upstreamBps !== undefined
      ? (upstreamInfo.upstreamBps / 100).toFixed(
          upstreamInfo.upstreamBps % 100 ? 2 : 0
        )
      : null;
  const upstreamExampleSats =
    upstreamInfo?.upstreamBps !== undefined
      ? Math.floor((10000 * upstreamInfo.upstreamBps) / 10000)
      : null;
  function normalizeParentInput(value: string) {
    const v = (value || "").trim();
    if (!v) return "";
    const match = v.match(/c[a-z0-9]{20,}/i);
    return match ? match[0] : v;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-lg font-semibold">{content?.title || "Splits"}</div>
            <div className="text-sm text-neutral-400 mt-1">
              {titleCase(content?.type)} • {titleCase(content?.status)}
            </div>
            {!canEdit && (
              <div className="mt-2 inline-flex items-center gap-2 text-xs rounded-full border border-emerald-900 bg-emerald-950/30 px-2 py-1 text-emerald-200">
                You’re a participant
                <a href="/participations" className="text-emerald-100 underline">View your splits</a>
              </div>
            )}
            <details className="mt-2">
              <summary className="text-xs text-neutral-400 cursor-pointer select-none">Advanced</summary>
              <div className="mt-2 flex items-center gap-2 text-xs text-neutral-300">
                <span className="text-neutral-400">Content ID</span>
                <span className="font-mono text-neutral-200 break-all">{contentId}</span>
                <button
                  onClick={() => copyToClipboard(contentId)}
                  className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                >
                  Copy
                </button>
              </div>
            </details>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            <button
              disabled={busy || viewOnly || !latest || latest.status !== "draft"}
              onClick={saveLatest}
              className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-50"
            >
              Save
            </button>

            <button
              disabled={busy || viewOnly || !latest || latest.status !== "draft" || !lockAllowed || total !== 100}
              onClick={lockLatest}
              className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-50"
              title={
                !lockAllowed
                  ? lockReason
                  : total !== 100
                    ? `Cannot lock yet. Accepted participants total ${total}%. Pending invites must be accepted before locking.`
                    : "Lock split"
              }
            >
              Lock
            </button>

            <button
              disabled={busy || !latest || latest.status !== "locked"}
              onClick={createNewVersion}
              className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-50 whitespace-nowrap"
            >
              Create new version
            </button>
          </div>
        </div>
        {!lockAllowed ? <div className="mt-2 text-[11px] text-amber-300">{lockReason}</div> : null}

        {(upstreamInfo || ["derivative", "remix", "mashup"].includes(String(content?.type || ""))) && (
          <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="text-sm font-medium">Lineage / Upstream royalties</div>
            {upstreamInfo ? (
              <div className="mt-2 text-xs text-neutral-400 space-y-1">
                <div>
                  Original:{" "}
                  <a href={`/content/${upstreamInfo.parent?.id}/splits`} className="text-neutral-200 underline">
                    {upstreamInfo.parent?.title || "Original work"}
                  </a>
                </div>
                <div>Relationship: {titleCase(upstreamInfo.relation)}</div>
                <div>
                  Upstream rate:{" "}
                  {upstreamInfo.approvedAt ? `${upstreamRatePct}%` : "Set by original stakeholders during clearance"}
                </div>
                <div>
                  Clearance:{" "}
                  {upstreamInfo.requiresApproval
                    ? upstreamInfo.approvedAt
                      ? "Cleared"
                      : "Pending clearance"
                    : "Not required"}
                </div>
                {typeof upstreamExampleSats === "number" ? (
                  <div className="text-neutral-500">
                    Example: At 10,000 sats sale, {upstreamExampleSats.toLocaleString()} sats goes upstream.
                  </div>
                ) : null}
                {upstreamInfo.requiresApproval && !upstreamInfo.approvedAt ? (
                  <>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {upstreamInfo.canRequestApproval ? (
                        <button
                          onClick={async () => {
                            try {
                              await api(`/content-links/${upstreamInfo.linkId}/request-approval`, "POST");
                              const r: any = await api(`/content/${contentId}/parent-link`, "GET");
                              setUpstreamInfo(r?.parentLink === null ? null : r);
                            } catch (e: any) {
                              setUpstreamError(e?.message || "Clearance request failed.");
                            }
                          }}
                          className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={!crossNodeAllowed}
                          title={!crossNodeAllowed ? clearanceReason : "Request clearance"}
                        >
                          Request clearance
                        </button>
                      ) : null}
                      {upstreamInfo.canVote ? (
                        <>
                          <div className="flex items-center gap-2">
                            <label className="text-[11px] text-neutral-500" htmlFor={`upstream-rate-${contentId}`}>
                              Upstream %
                            </label>
                            <input
                              id={`upstream-rate-${contentId}`}
                              name={`upstreamRate-${contentId}`}
                              className="w-20 rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1 text-xs"
                              value={upstreamVotePct}
                              onChange={(e) => setUpstreamVotePct(e.target.value.replace(/[^\d.]/g, ""))}
                              inputMode="decimal"
                              placeholder="10"
                              autoComplete="off"
                            />
                          </div>
                          <button
                            onClick={async () => {
                              try {
                                const pct = Number(upstreamVotePct || "0");
                                if (!Number.isFinite(pct)) {
                                  setUpstreamError("Enter an upstream rate (0–100).");
                                  return;
                                }
                                await api(`/content-links/${upstreamInfo.linkId}/vote`, "POST", {
                                  decision: "approve",
                                  upstreamRatePercent: pct
                                });
                                const r: any = await api(`/content/${contentId}/parent-link`, "GET");
                                setUpstreamInfo(r?.parentLink === null ? null : r);
                              } catch (e: any) {
                                setUpstreamError(e?.message || "Vote failed.");
                              }
                            }}
                            className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={!crossNodeAllowed}
                            title={!crossNodeAllowed ? clearanceReason : "Grant clearance"}
                          >
                            Grant clearance
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                await api(`/content-links/${upstreamInfo.linkId}/vote`, "POST", { decision: "reject" });
                                const r: any = await api(`/content/${contentId}/parent-link`, "GET");
                                setUpstreamInfo(r?.parentLink === null ? null : r);
                              } catch (e: any) {
                                setUpstreamError(e?.message || "Vote failed.");
                              }
                            }}
                            className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={!crossNodeAllowed}
                            title={!crossNodeAllowed ? clearanceReason : "Reject"}
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                    </div>
                    {!crossNodeAllowed ? (
                      <div className="mt-2 text-[11px] text-amber-300">{clearanceReason}</div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 text-xs text-amber-300">
                No original linked. Link the original work to route upstream royalties.
              </div>
            )}
            {upstreamMultiParent ? (
              <div className="mt-2 text-xs text-amber-300">Multiple parent links detected. Multi-parent routing isn’t supported yet.</div>
            ) : null}
            {upstreamError && !upstreamMultiParent ? <div className="mt-2 text-xs text-amber-300">{upstreamError}</div> : null}
            {!upstreamInfo && ["derivative", "remix", "mashup"].includes(String(content?.type || "")) ? (
              <button
                onClick={async () => {
                  try {
                    const list = await api<Array<{ id: string; title: string }>>("/content", "GET");
                    setLinkCandidates(list.filter((c) => c.id !== contentId));
                  } catch {
                    setLinkCandidates([]);
                  }
                  setLinkParentId("");
                  setLinkRelation("derivative");
                  setShowLinkModal(true);
                }}
                className="mt-2 text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
              >
                Link original
              </button>
            ) : null}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {versions.map((v) => {
            const active = v.id === selectedVersionId;
            return (
              <button
                key={v.id}
                onClick={() => setSelectedVersionId(v.id)}
                className={[
                  "text-xs rounded-lg border px-3 py-2",
                  active ? "border-white/30 bg-white/5" : "border-neutral-800 hover:bg-neutral-900"
                ].join(" ")}
              >
                v{v.versionNumber} • {v.status}
                {v.lockedAt ? " • locked" : ""}
              </button>
            );
          })}
          {versions.length === 0 && <div className="text-sm text-neutral-400">No split versions found.</div>}
        </div>

        {selectedVersion && (
          <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm">
                <div className="text-neutral-200 font-medium">
                  Version v{selectedVersion.versionNumber} • {selectedVersion.status}
                  {selectedVersion.lockedAt ? (
                    <span className="text-neutral-400 font-normal">
                      {" "}
                      • locked {new Date(selectedVersion.lockedAt).toLocaleString()}
                    </span>
                  ) : null}
                </div>

                {selectedVersion.status === "locked" ? (
                  <div className="mt-2 space-y-1 text-xs text-neutral-400">
                    <div>
                      Locked file:{" "}
                      <span className="text-neutral-200">
                        {selectedVersion.lockedFileOriginalName ||
                          selectedVersion.lockedFileObjectKey ||
                          "(unknown)"}
                      </span>
                      {selectedVersion.lockedFileOriginalName && selectedVersion.lockedFileObjectKey ? (
                        <span className="text-neutral-500"> • {selectedVersion.lockedFileObjectKey}</span>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                      <span>SHA-256:</span>
                      <span className="text-neutral-200">{shortHash(selectedVersion.lockedFileSha256)}</span>
                      {selectedVersion.lockedFileSha256 ? (
                        <button
                          onClick={() => copyToClipboard(selectedVersion.lockedFileSha256!)}
                          className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                        >
                          Copy
                        </button>
                      ) : null}
                    </div>

                    <div className="mt-2 border-t border-neutral-800 pt-2">
                      <div className="text-xs text-neutral-500">Proof</div>
                      {proofByVersionId[selectedVersion.id] ? (
                        <div className="mt-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span>Proof hash:</span>
                            <span className="text-neutral-200">{shortHash(proofByVersionId[selectedVersion.id]?.proofHash)}</span>
                            <button
                              onClick={() => copyToClipboard(proofByVersionId[selectedVersion.id]?.proofHash || "")}
                              className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                            >
                              Copy
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <span>Manifest hash:</span>
                            <span className="text-neutral-200">{shortHash(proofByVersionId[selectedVersion.id]?.manifestHash)}</span>
                            <button
                              onClick={() => copyToClipboard(proofByVersionId[selectedVersion.id]?.manifestHash || "")}
                              className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                            >
                              Copy
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <span>Splits hash:</span>
                            <span className="text-neutral-200">{shortHash(proofByVersionId[selectedVersion.id]?.splitsHash)}</span>
                            <button
                              onClick={() => copyToClipboard(proofByVersionId[selectedVersion.id]?.splitsHash || "")}
                              className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                            >
                              Copy
                            </button>
                          </div>

                          <div className="mt-2 flex items-center gap-2">
                            <button
                              onClick={() => setProofView(proofByVersionId[selectedVersion.id] || null)}
                              className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                            >
                              View proof.json
                            </button>
                            <button
                              onClick={() =>
                                downloadJson(
                                  `proof-${contentId}-v${selectedVersion.versionNumber}.json`,
                                  proofByVersionId[selectedVersion.id]
                                )
                              }
                              className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                            >
                              Export proof.json
                            </button>
                          </div>
                        </div>
                      ) : proofLoadingId === selectedVersion.id ? (
                        <div className="text-xs text-neutral-500">Loading proof…</div>
                      ) : (
                        <div className="text-xs text-neutral-500">
                          Proof not available yet{proofError ? `: ${proofError}` : "."}
                        </div>
                      )}
                    </div>

                    <div className="mt-2 border-t border-neutral-800 pt-2">
                      <div className="text-xs text-neutral-500">Sell playback credits</div>
                      {proofByVersionId[selectedVersion.id] ? (
                        <div className="mt-2 space-y-2">
                          {lightningBlocked && (
                            <div className="rounded-md border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                              <div className="font-medium">Lightning not configured</div>
                              <div className="text-amber-200/90">
                                Connect a Lightning provider to generate invoices.
                              </div>
                              <div className="mt-2">
                                <button
                                  onClick={() => onGoToPayouts?.()}
                                  className="text-xs rounded-md border border-amber-700/60 px-2 py-1 hover:bg-amber-900/30"
                                >
                                  Configure payments
                                </button>
                              </div>
                              <div className="mt-1 text-[11px] text-amber-200/70">Details: {lightningReason}</div>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <label className="sr-only" htmlFor={`playback-units-${contentId}`}>
                              Playback units
                            </label>
                            <input
                              id={`playback-units-${contentId}`}
                              name={`playbackUnits-${contentId}`}
                              value={payUnits}
                              onChange={(e) => setPayUnits(e.target.value)}
                              className="w-24 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs"
                              inputMode="numeric"
                              placeholder="units"
                              autoComplete="off"
                            />
                            <button
                              disabled={lightningBlocked}
                              onClick={async () => {
                                if (lightningBlocked) {
                                  setPayMsg("Lightning is not configured. Configure payments to generate invoices.");
                                  return;
                                }
                                const units = Math.max(1, Math.floor(Number(payUnits || "0")));
                                setPayMsg(null);
                                setPurchase(null);
                                try {
                                  const res = await api<{ purchaseId: string; bolt11: string }>(`/v1/payments/invoice`, "POST", {
                                    proofHash: proofByVersionId[selectedVersion.id]?.proofHash,
                                    units
                                  });
                                  setPurchase({ id: res.purchaseId, bolt11: res.bolt11, status: "unpaid" });
                                } catch (e: any) {
                                  const raw = e?.message || "Invoice failed";
                                  if (/LND_|BTCPAY_|not configured/i.test(raw)) {
                                    setPayMsg("Lightning is not configured. Configure payments to generate invoices.");
                                  } else {
                                    setPayMsg(raw);
                                  }
                                }
                              }}
                              className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-50"
                            >
                              Generate invoice
                            </button>
                          </div>

                          {purchase?.bolt11 && (
                            <div className="space-y-1">
                              <div className="text-xs text-neutral-400">BOLT11:</div>
                              <div className="text-xs text-neutral-200 break-all">{purchase.bolt11}</div>
                              <button
                                onClick={() => copyToClipboard(purchase.bolt11)}
                                className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                              >
                                Copy invoice
                              </button>
                              <div className="text-xs text-neutral-400">Status: {purchase.status}</div>
                              {purchase.receiptId ? (
                                <div className="text-xs text-emerald-300">Receipt: {purchase.receiptId}</div>
                              ) : null}
                            </div>
                          )}

                          {payMsg ? <div className="text-xs text-red-300">{payMsg}</div> : null}
                        </div>
                      ) : (
                        <div className="text-xs text-neutral-500">Load proof to purchase credits.</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-neutral-400">
                    Not locked yet. Locking creates an immutable proof tied to an exact file + hash.
                  </div>
                )}
              </div>

              <div className="text-xs text-neutral-500">{viewOnly ? "Viewing historical version" : "Editing latest draft"}</div>
            </div>
          </div>
        )}

        <div className="mt-4">
          <HistoryFeed
            title="Split history"
            items={historyItems}
            loading={historyLoading}
            emptyText="No split history yet."
            exportName={`split-history-${contentId || "content"}.json`}
            onRefresh={async () => {
              if (!contentId) return;
              setHistoryLoading(true);
              try {
                const hist = await api<HistoryEvent[]>(`/content/${contentId}/split-history`, "GET");
                setHistoryItems(hist || []);
              } catch {
                setHistoryItems([]);
              } finally {
                setHistoryLoading(false);
              }
            }}
          />

          {selectedVersionId ? (
            <div className="mt-2">
              <AuditPanel
                scopeType="split"
                scopeId={selectedVersionId}
                title="Audit"
                exportName={`split-audit-${selectedVersionId}.json`}
              />
            </div>
          ) : null}
        </div>

        <div className="mt-4 overflow-x-auto">
          {invitedParticipants.length > 0 ? (
            <div className="mb-2 rounded-md border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200">
              Invites are managed in the Split Invites tab. Invited participants do not count toward active payout splits until accepted.
            </div>
          ) : null}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-400">
                <th className="py-2 pr-2">Participant</th>
                <th className="py-2 pr-2">Role</th>
                <th className="py-2 pr-2">Percent</th>
                <th className="py-2 pr-2">Status</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className="border-t border-neutral-800">
                  <td className="py-2 pr-2">
                    <label className="sr-only" htmlFor={`split-email-${idx}`}>
                      Participant
                    </label>
                    <input
                      id={`split-email-${idx}`}
                      name={`splitEmail-${idx}`}
                      disabled={viewOnly || busy}
                      value={r.participantEmail}
                      onChange={(e) => {
                        const next = [...rows];
                        next[idx] = {
                          ...next[idx],
                          participantEmail: e.target.value,
                          participantUserId: null,
                          targetType: null,
                          targetValue: null,
                          invitationStatus: null,
                          resolutionKind: null,
                          resolvedUserId: null,
                          resolvedDisplay: null,
                          normalizedEmail: null,
                          resolvedVerifiedKey: null,
                          acceptedAt: null,
                          verifiedAt: null
                        };
                        setRows(next);
                      }}
                      onBlur={() => {
                        if (viewOnly || busy) return;
                        resolveParticipantAt(idx);
                      }}
                      className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
                      placeholder="Enter creator ID or invite by email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      autoComplete="email"
                    />
                    {String(r.participantEmail || "").trim() ? (
                      <div className="mt-1 text-[11px]">
                        {resolvingByRowKey[rowKey(r, idx)] ? (
                          <span className="text-neutral-400">Resolving…</span>
                        ) : (r.participantUserId && r.verifiedAt && (r.invitationStatus === "accepted" || (!r.invitationStatus && r.acceptedAt))) ? (
                          <span className="text-emerald-300">Accepted</span>
                        ) : ((r.targetType === "local_user" || r.targetType === "identity_ref") && Boolean(r.targetValue)) ? (
                          <span className="text-amber-300">Pending invite: {r.targetValue}</span>
                        ) : (r.targetType === "email" && Boolean(normEmail(r.targetValue || r.normalizedEmail || r.participantEmail))) ? (
                          <span className="text-amber-300">Pending invite: {normEmail(r.targetValue || r.normalizedEmail || r.participantEmail)}</span>
                        ) : r.resolutionKind === "identity" ? (
                          <span className="text-emerald-300">
                            Resolved identity: {r.resolvedDisplay || r.resolvedUserId || "user"}
                          </span>
                        ) : r.resolutionKind === "email_invite" ? (
                          <span className="text-amber-300">Pending invite: {r.normalizedEmail || r.participantEmail}</span>
                        ) : r.resolutionKind === "invalid" ? (
                          <span className="text-rose-300">Needs resolution</span>
                        ) : (
                          <span className="text-neutral-400">Needs resolution</span>
                        )}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-2">
                    <label className="sr-only" htmlFor={`split-role-${idx}`}>
                      Participant role
                    </label>
                    <input
                      id={`split-role-${idx}`}
                      name={`splitRole-${idx}`}
                      disabled={viewOnly || busy}
                      value={r.role}
                      onChange={(e) => {
                        const next = [...rows];
                        next[idx] = { ...next[idx], role: e.target.value };
                        setRows(next);
                      }}
                      className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
                      placeholder="writer, producer, publisher"
                      autoComplete="off"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    {(() => {
                      const displayPercent = percentToString(r.percent);
                      return (
                    <>
                    <label className="sr-only" htmlFor={`split-percent-${idx}`}>
                      Participant percent
                    </label>
                    <input
                      id={`split-percent-${idx}`}
                      name={`splitPercent-${idx}`}
                      disabled={viewOnly || busy}
                      value={displayPercent}
                      onChange={(e) => {
                        const next = [...rows];
                        next[idx] = { ...next[idx], percent: e.target.value };
                        setRows(next);
                      }}
                      className="w-28 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
                      placeholder="50"
                      inputMode="decimal"
                      autoComplete="off"
                    />
                    </>
                      );
                    })()}
                  </td>
                  <td className="py-2 pr-2">
                    <div className="text-xs text-neutral-300">
                      {(() => {
                        const isBoundActive = Boolean(
                          r.participantUserId &&
                            r.verifiedAt &&
                            (r.invitationStatus === "accepted" || (!r.invitationStatus && r.acceptedAt))
                        );
                        if (isBoundActive) return "Accepted";
                        if (r.invitationStatus === "pending") return "Pending invite";
                        if (r.invitationStatus === "revoked") return "Revoked";
                        if (r.invitationStatus === "expired") return "Expired";
                        if (r.invitationStatus === "tombstoned") return "Tombstoned";
                        if (hasValidTarget(r)) return "Pending invite";
                        if (r.resolutionKind === "identity") return "Resolved identity";
                        if (r.resolutionKind === "email_invite") return "Pending invite";
                        if (r.resolutionKind === "invalid") return "Needs resolution";
                        return "Needs resolution";
                      })()}
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <button
                      disabled={viewOnly || busy || rows.length <= 1}
                      onClick={() => setRows(rows.filter((_, i) => i !== idx))}
                      className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-50"
                    >
                      Remove
                    </button>
                    {r.id ? (
                      <div className="mt-2 text-xs text-neutral-400">
                        {auditByParticipant[r.id]?.remoteVerified ? (
                          <span className="text-emerald-300">Verified from remote node</span>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!viewOnly && (
            <button
              disabled={busy}
              onClick={() =>
                setRows([
                  ...rows,
                  { participantEmail: "", role: "writer", percent: "0", participantUserId: null, invitationId: null, invitationStatus: null, targetType: null, targetValue: null, acceptedAt: null, verifiedAt: null, resolutionKind: null, resolvedUserId: null, resolvedDisplay: null, normalizedEmail: null, resolvedVerifiedKey: null }
                ])
              }
              className="mt-3 text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-50"
            >
              Add participant
            </button>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="text-sm text-neutral-400">
            Intended total: <span className={intendedTotalOk ? "text-neutral-200" : "text-red-300"}>{intendedTotal}%</span>
            <span className="ml-3">Active total: <span className={totalOk ? "text-neutral-200" : "text-amber-300"}>{total}%</span></span>
            <span className="ml-3">Pending invites: <span className="text-neutral-200">{pendingCount}</span></span>
            {!viewOnly && candidateTotal !== total ? (
              <span className="ml-2 text-neutral-500">Candidate total: {candidateTotal}%</span>
            ) : null}
            {viewOnly ? <span className="ml-2">View-only</span> : null}
            {!viewOnly && !totalOk ? (
              <span className="ml-2 text-amber-300">
                Cannot lock yet. Accepted participants total {total}%. Pending invites must be accepted before locking.
              </span>
            ) : null}
          </div>

          {msg && <div className="text-sm text-neutral-300">{msg}</div>}
        </div>
      </div>

      {proofView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">proof.json</div>
              <button
                onClick={() => setProofView(null)}
                className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
              >
                Close
              </button>
            </div>
            <pre className="mt-3 max-h-[70vh] overflow-auto text-xs text-neutral-200 bg-neutral-900/30 rounded-lg p-3">
              {JSON.stringify(proofView, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-medium">Link original</div>
            <div className="mt-3 space-y-3 text-xs text-neutral-400">
              <div>
                <label className="text-neutral-300 mb-1" htmlFor={`link-parent-${contentId}`}>
                  Original content
                </label>
                <select
                  id={`link-parent-${contentId}`}
                  name={`linkParent-${contentId}`}
                  className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs"
                  value={linkParentId}
                  onChange={(e) => setLinkParentId(normalizeParentInput(e.target.value))}
                >
                  <option value="">Select from your content…</option>
                  {linkCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <div className="mt-2">
                  <label className="sr-only" htmlFor={`link-parent-raw-${contentId}`}>
                    Original content link or ID
                  </label>
                  <input
                    id={`link-parent-raw-${contentId}`}
                    name={`linkParentRaw-${contentId}`}
                    className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs"
                    placeholder="Paste original link or content ID"
                    value={linkParentId}
                    onChange={(e) => setLinkParentId(normalizeParentInput(e.target.value))}
                    autoComplete="off"
                  />
                </div>
              </div>
              <div>
                <div className="text-neutral-300 mb-1">Relationship</div>
                <div className="flex flex-wrap gap-2">
                  {["derivative", "remix", "mashup"].map((r) => (
                    <button
                      type="button"
                      key={r}
                      onClick={() => setLinkRelation(r)}
                      className={[
                        "text-xs rounded-full border px-3 py-1",
                        linkRelation === r ? "border-white/40 bg-white/10 text-neutral-100" : "border-neutral-800 text-neutral-400"
                      ].join(" ")}
                    >
                      {titleCase(r)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-[11px] text-neutral-500">
                Public release requires original stakeholder clearance.
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowLinkModal(false)}
                className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
              >
                Cancel
              </button>
              <button
                disabled={linkSaving || !linkParentId}
                onClick={async () => {
                  if (!contentId) return;
                    try {
                      setLinkSaving(true);
                      setUpstreamError(null);
                      setUpstreamMultiParent(false);
                      const parentId = normalizeParentInput(linkParentId);
                      await api(`/content/${contentId}/parent-link`, "POST", {
                        parentContentId: parentId,
                        relation: linkRelation
                      });
                      const r: any = await api(`/content/${contentId}/parent-link`, "GET");
                      setUpstreamInfo(r?.parentLink === null ? null : r);
                      setShowLinkModal(false);
                    } catch (e: any) {
                      const msg = e?.message || "Failed to link original.";
                      setUpstreamError(msg);
                      if (/PARENT_LINK_ALREADY_EXISTS|MULTIPLE_PARENTS_NOT_SUPPORTED/.test(msg)) {
                        try {
                          const r: any = await api(`/content/${contentId}/parent-link`, "GET");
                          setUpstreamInfo(r?.parentLink === null ? null : r);
                          setShowLinkModal(false);
                        } catch (ge: any) {
                          setUpstreamError(ge?.message || msg);
                        }
                      }
                    } finally {
                      setLinkSaving(false);
                    }
                }}
                className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-50"
              >
                Save link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
