import { useEffect, useState } from "react";
import { api } from "../lib/api";
import HistoryFeed, { type HistoryEvent } from "../components/HistoryFeed";
import AuditPanel from "../components/AuditPanel";
import LockedFeaturePanel from "../components/LockedFeaturePanel";
import type { FeatureMatrix, CapabilitySet, NodeMode } from "../lib/identity";
import { resolveParticipantDisplayLabel } from "../lib/participantDisplay";
import {
  isActiveLibraryVisible,
  isEntitlementHistoryVisible,
  logVisibilityDecision,
  type LibraryRelation
} from "../lib/libraryEligibility";

type WorkRoyaltyRow = {
  contentId: string;
  title: string;
  type: string;
  ownerId: string;
  ownerDisplayName?: string | null;
  ownerEmail?: string | null;
  myRole: "owner" | "participant";
  myBps: number | null;
  myPercent: any;
  splitSummary: Array<{
    participantUserId?: string | null;
    participantEmail?: string | null;
    displayName?: string | null;
    role?: string | null;
    bps?: number | null;
    percent?: any;
  }>;
  earnedSatsToDate: string;
  pendingSats?: string;
  withdrawnSats?: string;
  storefrontStatus?: string | null;
  contentStatus?: string | null;
  contentDeletedAt?: string | null;
};

type UpstreamIncomeRow = {
  parentContentId: string;
  parentTitle: string;
  childContentId: string;
  childTitle: string;
  upstreamBps: number;
  myEffectiveBps: number;
  earnedSatsToDate: string;
  approvedAt: string | null;
  status?: string | null;
  approveWeightBps?: number | null;
  approvalBpsTarget?: number | null;
  childDeletedAt?: string | null;
  parentDeletedAt?: string | null;
};

type RoyaltiesResponse = {
  works: WorkRoyaltyRow[];
  upstreamIncome: UpstreamIncomeRow[];
};

type RemoteRoyaltyRow = {
  id: string;
  remoteOrigin: string;
  inviteUrl?: string | null;
  contentId?: string | null;
  contentTitle?: string | null;
  contentType?: string | null;
  splitVersionNum?: number | null;
  role?: string | null;
  percent?: any;
  participantEmail?: string | null;
  acceptedAt?: string | null;
  remoteNodeUrl?: string | null;
  earnedSatsToDate?: string;
  settlementLineCount?: number;
  payoutRows?: number;
  payoutSummary?: Record<string, number>;
  payoutState?: string;
  destinationState?: string;
  clearanceInbox?: Array<{
    authorizationId?: string;
    parentContentId?: string | null;
    parentTitle?: string | null;
    childContentId?: string | null;
    childTitle?: string | null;
    childStatus?: string | null;
    relation?: string | null;
    status?: string | null;
    approveWeightBps?: number | null;
    approvalBpsTarget?: number | null;
    approvedApprovers?: number | null;
    upstreamRatePercent?: number | null;
  }>;
};

type UpstreamDisplayRow = UpstreamIncomeRow & {
  remoteOrigin?: string | null;
  childStatus?: string | null;
  source: "local" | "remote";
};

type ParticipationRow = {
  contentId: string;
  contentTitle: string | null;
  contentType: string | null;
  contentStatus: string | null;
  contentDeletedAt: string | null;
  splitVersionId: string;
  splitVersionNumber: number | null;
  splitParticipantId: string;
  participantRole: string | null;
  participantBps: number | null;
  participantPercent: number | null;
  acceptedAt: string | null;
  attributionUrl: string | null;
  buyUrl: string | null;
  highlightedOnProfile: boolean;
};

export default function SplitParticipationsPage(props: {
  identityLevel?: string | null;
  features?: FeatureMatrix;
  lockReasons?: Record<string, string>;
  capabilities?: CapabilitySet;
  nodeMode?: NodeMode | null;
  onOpenSplitEditor?: (contentId: string) => void;
  onOpenSplitSummary?: (contentId: string) => void;
}) {
  type RoyaltiesScope = "local" | "remote" | "derivatives" | "history";
  const canAdvancedSplits = props.features?.advancedSplits ?? false;
  const splitsAllowed = props.capabilities?.useSplits ?? canAdvancedSplits;
  const derivativesAllowed = props.capabilities?.useDerivatives ?? canAdvancedSplits;
  const isBasic = props.nodeMode === "basic";

  const [works, setWorks] = useState<WorkRoyaltyRow[]>([]);
  const [participations, setParticipations] = useState<ParticipationRow[]>([]);
  const [upstream, setUpstream] = useState<UpstreamIncomeRow[]>([]);
  const [remoteRoyalties, setRemoteRoyalties] = useState<RemoteRoyaltyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [showInactiveWorks, setShowInactiveWorks] = useState(false);
  const [showAllUpstream, setShowAllUpstream] = useState(false);
  const [scope, setScope] = useState<RoyaltiesScope>("local");
  const openSplitEditor = (contentId: string) => {
    const id = String(contentId || "").trim();
    if (!id) return;
    if (props.onOpenSplitEditor) {
      props.onOpenSplitEditor(id);
      return;
    }
    window.history.pushState({}, "", `/content/${encodeURIComponent(id)}/splits`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const openSplitSummary = (contentId?: string | null) => {
    const id = String(contentId || "").trim();
    if (!id) return;
    if (props.onOpenSplitSummary) {
      props.onOpenSplitSummary(id);
      return;
    }
    window.history.pushState({}, "", `/royalties/${encodeURIComponent(id)}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const activeWorks = works.filter((p) => {
    const relation: LibraryRelation = p.myRole === "owner" ? "owner" : "participant";
    const decision = isActiveLibraryVisible(
      {
        id: p.contentId,
        status: p.contentStatus || "published",
        deletedAt: p.contentDeletedAt || null
      },
      relation,
      p.myRole === "participant"
        ? {
            contentId: p.contentId,
            status: "accepted",
            acceptedAt: "1",
            contentStatus: p.contentStatus || "published",
            contentDeletedAt: p.contentDeletedAt || null
          }
        : undefined
    );
    logVisibilityDecision({
      surface: "royalties.works.active",
      sourceModelQuery: "GET /my/royalties",
      relation,
      content: {
        id: p.contentId,
        status: p.contentStatus || "published",
        deletedAt: p.contentDeletedAt || null
      },
      included: decision.visible,
      reason: decision.visible ? "active_library_visible" : decision.reason || "excluded"
    });
    return decision.visible;
  });

  const inactiveWorks = works.filter((p) => {
    const relation: LibraryRelation = p.myRole === "owner" ? "owner" : "participant";
    const history = isEntitlementHistoryVisible(
      {
        id: p.contentId,
        status: p.contentStatus || "published",
        deletedAt: p.contentDeletedAt || null
      },
      relation,
      p.myRole === "participant"
        ? {
            contentId: p.contentId,
            status: "accepted",
            acceptedAt: "1",
            contentStatus: p.contentStatus || "published",
            contentDeletedAt: p.contentDeletedAt || null
          }
        : undefined
    );
    const active = isActiveLibraryVisible(
      {
        id: p.contentId,
        status: p.contentStatus || "published",
        deletedAt: p.contentDeletedAt || null
      },
      relation
    );
    const include = history.visible && !active.visible;
    logVisibilityDecision({
      surface: "royalties.works.history",
      sourceModelQuery: "GET /my/royalties",
      relation,
      content: {
        id: p.contentId,
        status: p.contentStatus || "published",
        deletedAt: p.contentDeletedAt || null
      },
      included: include,
      reason: include ? history.reason || "history_visible" : active.visible ? "active_section" : history.reason || "excluded"
    });
    return include;
  });
  const visibleLocalWorks = showInactiveWorks ? [...activeWorks, ...inactiveWorks] : activeWorks;
  const visibleOwnedSharedWorks = visibleLocalWorks.filter((row) => row.myRole === "owner");
  const toSharePercent = (row: WorkRoyaltyRow): number | null => {
    if (typeof row.myBps === "number" && Number.isFinite(row.myBps)) return row.myBps / 100;
    const parsed = Number(String(row.myPercent ?? "").replace("%", "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  };
  const ownedLocalWorks = visibleOwnedSharedWorks.filter((row) => {
    const pct = toSharePercent(row);
    return pct != null && Math.abs(pct - 100) < 0.0001;
  });
  const collaborativeLocalWorks = visibleOwnedSharedWorks.filter((row) => {
    const pct = toSharePercent(row);
    return pct == null || pct < 100;
  });
  const remoteUpstreamRows = remoteRoyalties.flatMap((row) => {
    const parentPercent = Number(row.percent ?? 0);
    const inbox = Array.isArray(row.clearanceInbox) ? row.clearanceInbox : [];
    return inbox
      .map((entry) => {
        const childContentId = String(entry.childContentId || "").trim();
        if (!childContentId) return null;
        const upstreamRatePercent = Number(entry.upstreamRatePercent ?? 0);
        const upstreamBps = Number.isFinite(upstreamRatePercent) ? Math.max(0, Math.round(upstreamRatePercent * 100)) : 0;
        const myEffectiveBps =
          Number.isFinite(parentPercent) && Number.isFinite(upstreamRatePercent)
            ? Math.max(0, Math.round((parentPercent / 100) * upstreamBps))
            : 0;
        return {
          parentContentId: String(entry.parentContentId || row.contentId || "").trim(),
          parentTitle: String(entry.parentTitle || row.contentTitle || "Untitled").trim(),
          childContentId,
          childTitle: String(entry.childTitle || "").trim() || "Untitled",
          upstreamBps,
          myEffectiveBps,
          earnedSatsToDate: "0",
          approvedAt: String(entry.status || "").trim().toUpperCase() === "APPROVED" ? row.acceptedAt || null : null,
          status: String(entry.status || "").trim().toUpperCase() || undefined,
          approveWeightBps: typeof entry.approveWeightBps === "number" ? entry.approveWeightBps : null,
          approvalBpsTarget: typeof entry.approvalBpsTarget === "number" ? entry.approvalBpsTarget : null,
          childDeletedAt: null,
          parentDeletedAt: null,
          childStatus: String(entry.childStatus || "").trim().toLowerCase() || null,
          remoteOrigin: row.remoteOrigin,
          source: "remote" as const
        } satisfies UpstreamDisplayRow;
      })
      .filter((entry) => Boolean(entry)) as UpstreamDisplayRow[];
  });
  const allUpstreamRows: UpstreamDisplayRow[] = [
    ...upstream.map((u) => ({ ...u, childStatus: null, remoteOrigin: null, source: "local" as const })),
    ...remoteUpstreamRows
  ];
  const visibleUpstream = allUpstreamRows.filter((u) => {
    if (showInactive) return true;
    return !u.childDeletedAt && !u.parentDeletedAt;
  });
  const collaborationCount = participations.length + remoteRoyalties.length;
  const ownedCount = ownedLocalWorks.length;
  const collaborationOwnedCount = collaborativeLocalWorks.length;

  const canonicalById = new Map<string, string>();
  for (const row of works) {
    const id = String(row.contentId || "").trim();
    const title = String(row.title || "").trim();
    if (id && title) canonicalById.set(id, title);
  }
  for (const row of remoteRoyalties) {
    const id = String(row.contentId || "").trim();
    const title = String(row.contentTitle || "").trim();
    if (id && title && !canonicalById.has(id)) canonicalById.set(id, title);
  }
  for (const row of upstream) {
    const parentId = String(row.parentContentId || "").trim();
    const parentTitle = String(row.parentTitle || "").trim();
    const childId = String(row.childContentId || "").trim();
    const childTitle = String(row.childTitle || "").trim();
    if (parentId && parentTitle && !canonicalById.has(parentId)) canonicalById.set(parentId, parentTitle);
    if (childId && childTitle && !canonicalById.has(childId)) canonicalById.set(childId, childTitle);
  }
  const localCanonicalIdByLowerTitle = new Map<string, string>();
  const rememberLocalTitle = (idRaw?: string | null, titleRaw?: string | null) => {
    const id = String(idRaw || "").trim();
    const title = String(titleRaw || "").trim();
    if (!id || !title) return;
    const key = title.toLowerCase();
    if (!localCanonicalIdByLowerTitle.has(key)) localCanonicalIdByLowerTitle.set(key, id);
  };
  for (const row of works) rememberLocalTitle(row.contentId, row.title);
  for (const row of participations) rememberLocalTitle(row.contentId, row.contentTitle);
  for (const row of upstream) {
    rememberLocalTitle(row.parentContentId, row.parentTitle);
    rememberLocalTitle(row.childContentId, row.childTitle);
  }
  const localKnownIds = new Set<string>();
  for (const row of works) {
    const id = String(row.contentId || "").trim();
    if (id) localKnownIds.add(id);
  }
  for (const row of participations) {
    const id = String(row.contentId || "").trim();
    if (id) localKnownIds.add(id);
  }
  for (const row of upstream) {
    const parentId = String(row.parentContentId || "").trim();
    const childId = String(row.childContentId || "").trim();
    if (parentId) localKnownIds.add(parentId);
    if (childId) localKnownIds.add(childId);
  }

  const openEarningsView = (contentId?: string | null, title?: string | null) => {
    const rawId = String(contentId || "").trim();
    const rawTitle = String(title || "").trim();
    const fallbackId = rawTitle ? String(localCanonicalIdByLowerTitle.get(rawTitle.toLowerCase()) || "").trim() : "";
    const id = localKnownIds.has(rawId) ? rawId : fallbackId || rawId;
    const canonicalTitle = (id && canonicalById.get(id)) || rawTitle;
    const params = new URLSearchParams();
    if (id) params.set("contentId", id);
    const t = String(canonicalTitle || "").trim();
    if (t) params.set("title", t);
    params.set("source", "royalties");
    const query = params.toString();
    window.history.pushState({}, "", query ? `/earnings-v2?${query}` : "/earnings-v2");
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const describeRelationshipRole = (row: WorkRoyaltyRow): string => {
    const pct = toSharePercent(row);
    if (row.myRole === "owner" && pct != null && Math.abs(pct - 100) < 0.0001) return "Originator";
    if (row.myRole === "owner") return "Originator + Collaborator";
    return "Collaborator";
  };
  const Badge = ({
    label,
    tone = "neutral"
  }: {
    label: string;
    tone?: "neutral" | "success" | "warning" | "cyan" | "amber";
  }) => {
    const cls =
      tone === "success"
        ? "border-emerald-700/60 bg-emerald-900/20 text-emerald-300"
        : tone === "warning"
          ? "border-rose-700/60 bg-rose-900/20 text-rose-300"
          : tone === "cyan"
            ? "border-cyan-700/60 bg-cyan-900/20 text-cyan-300"
            : tone === "amber"
              ? "border-amber-700/60 bg-amber-900/20 text-amber-300"
              : "border-neutral-800 text-neutral-300";
    return <span className={`text-[11px] rounded-full border px-2 py-0.5 ${cls}`}>{label}</span>;
  };

  useEffect(() => {
    if (isBasic) return;
    (async () => {
      try {
        setLoading(true);
        const participationRes = await api<{ items: ParticipationRow[] }>("/my/participations", "GET");
        setParticipations(participationRes?.items || []);
        const res = await api<RoyaltiesResponse>("/my/royalties", "GET");
        setWorks(res?.works || []);
        setUpstream(res?.upstreamIncome || []);
        try {
          const remote = await api<RemoteRoyaltyRow[]>("/my/royalties/remote", "GET");
          setRemoteRoyalties(remote || []);
        } catch {
          setRemoteRoyalties([]);
        }
        setHistoryLoading(true);
        const hist = await api<HistoryEvent[]>("/me/royalty-history", "GET");
        setHistoryItems(hist || []);
      } catch (e: any) {
        setError(e?.message || "Failed to load split participations.");
        setHistoryItems([]);
      } finally {
        setLoading(false);
        setHistoryLoading(false);
      }
    })();
  }, [isBasic]);

  if (isBasic) {
    return <LockedFeaturePanel title="Royalties" />;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold">Royalties</div>
        <div className="text-sm text-neutral-400 mt-1">Structure view for ownership, participation, and derivative relationships.</div>
        <div className="text-xs text-neutral-500 mt-1">
          Royalty defines relationship structure (who, role, and share). Revenue and Earnings show money outcomes.
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          Use “View earnings” on any row to jump to a content-scoped earnings view.
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Participation links</div>
          <div className="mt-1 text-lg font-semibold text-neutral-100">{collaborationCount.toLocaleString()}</div>
          <div className="text-xs text-neutral-500 mt-1">Active + remote participation records</div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Owned works</div>
          <div className="mt-1 text-lg font-semibold text-neutral-100">{ownedCount.toLocaleString()}</div>
          <div className="text-xs text-neutral-500 mt-1">Originator relationships</div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Shared-split works</div>
          <div className="mt-1 text-lg font-semibold text-neutral-100">{collaborationOwnedCount.toLocaleString()}</div>
          <div className="text-xs text-neutral-500 mt-1">Originator + collaborator structure</div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Remote relationships</div>
          <div className="mt-1 text-lg font-semibold text-neutral-100">{remoteRoyalties.length.toLocaleString()}</div>
          <div className="text-xs text-neutral-500 mt-1">Accepted remote collaboration links</div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Derivative links</div>
          <div className="mt-1 text-lg font-semibold text-neutral-100">{visibleUpstream.length.toLocaleString()}</div>
          <div className="text-xs text-neutral-500 mt-1">Parent/child derivative relationships</div>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-950/30 p-3">
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Scope</div>
        <div className="text-xs text-neutral-500 mt-1">Choose one section at a time to reduce table noise.</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setScope("local")}
            className={[
              "text-xs rounded-full border px-2 py-1",
              scope === "local" ? "border-white/40 bg-white/10 text-white" : "border-neutral-800 hover:bg-neutral-900"
            ].join(" ")}
          >
            Your content ({ownedLocalWorks.length}) • Collaborations ({collaborativeLocalWorks.length})
          </button>
          <button
            type="button"
            onClick={() => setScope("remote")}
            className={[
              "text-xs rounded-full border px-2 py-1",
              scope === "remote" ? "border-white/40 bg-white/10 text-white" : "border-neutral-800 hover:bg-neutral-900"
            ].join(" ")}
          >
            Remote relationships ({remoteRoyalties.length})
          </button>
          {derivativesAllowed ? (
            <button
              type="button"
              onClick={() => setScope("derivatives")}
              className={[
                "text-xs rounded-full border px-2 py-1",
                scope === "derivatives" ? "border-white/40 bg-white/10 text-white" : "border-neutral-800 hover:bg-neutral-900"
              ].join(" ")}
            >
              Upstream derivatives ({visibleUpstream.length})
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setScope("history")}
            className={[
              "text-xs rounded-full border px-2 py-1",
              scope === "history" ? "border-white/40 bg-white/10 text-white" : "border-neutral-800 hover:bg-neutral-900"
            ].join(" ")}
          >
            History & audit
          </button>
        </div>
      </div>

      {loading ? <div className="text-sm text-neutral-400">Loading…</div> : null}
      {error ? <div className="text-sm text-amber-300">{error}</div> : null}

      {!loading && works.length === 0 ? (
        <div className="text-sm text-neutral-500">No works yet.</div>
      ) : null}

      {scope === "local" ? (
      <section id="collab-local" className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="text-sm text-neutral-300 font-medium">Your Content</div>
        <div className="mt-2 flex items-center justify-between">
          <div className="text-xs text-neutral-500">Your owned catalog, separated from true collaborations.</div>
          <button
            onClick={() => setShowInactiveWorks((v) => !v)}
            className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
          >
            {showInactiveWorks ? "Hide inactive" : "Show inactive"}
          </button>
        </div>
        <div className="mt-3 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Your Content</div>
            <div className="space-y-3 mt-2">
          {ownedLocalWorks.map((p) => (
          <div key={p.contentId} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-neutral-100">{p.title || "Untitled"}</div>
                <div className="text-xs text-neutral-400 mt-1">
                  {p.type ? p.type.toUpperCase() : "CONTENT"} • Role: {p.myRole === "owner" ? "owner" : "participant"} • Share: {p.myBps != null ? `${(p.myBps / 100).toFixed(2)}%` : p.myPercent || "—"}
                </div>
                <div className="text-xs text-neutral-500 mt-1">Relationship role: {describeRelationshipRole(p)}</div>
                {p.ownerDisplayName || p.ownerEmail ? (
                  <div className="text-xs text-neutral-500 mt-1">
                    Original creator: {p.ownerDisplayName || p.ownerEmail}
                  </div>
                ) : null}
                {splitsAllowed && p.splitSummary?.length ? (
                  <details className="mt-2 text-xs text-neutral-400">
                    <summary className="cursor-pointer select-none">Split terms</summary>
                    <div className="mt-2 space-y-1">
                      {p.splitSummary.map((s, idx) => (
                        <div key={`${p.contentId}-${idx}`} className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            {resolveParticipantDisplayLabel({
                              displayName: s.displayName || null,
                              participantUserId: s.participantUserId || null,
                              participantEmail: s.participantEmail || null,
                              allowEmail: true,
                              fallbackLabel: "Participant"
                            })} — {s.role || "role"}
                          </div>
                          <div>{typeof s.bps === "number" ? `${(s.bps / 100).toFixed(2)}%` : s.percent || "—"}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Badge label="Owned • 100%" tone="neutral" />
                {p.contentDeletedAt ? <Badge label="Inactive" tone="amber" /> : <Badge label="Active" tone="success" />}
                <button
                  onClick={() => openEarningsView(p.contentId, p.title)}
                  className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                >
                  View earnings
                </button>
                {p.contentId ? (
                  <button
                    onClick={() => openSplitEditor(p.contentId)}
                    className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                  >
                    Open
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
          {ownedLocalWorks.length === 0 ? (
            <div className="text-sm text-neutral-500">No fully owned content in this view.</div>
          ) : null}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Collaborations</div>
            <div className="space-y-3 mt-2">
          {collaborativeLocalWorks.map((p) => (
          <div key={p.contentId} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-neutral-100">{p.title || "Untitled"}</div>
                <div className="text-xs text-neutral-400 mt-1">
                  {p.type ? p.type.toUpperCase() : "CONTENT"} • Role: owner • Share: {p.myBps != null ? `${(p.myBps / 100).toFixed(2)}%` : p.myPercent || "—"}
                </div>
                <div className="text-xs text-neutral-500 mt-1">Relationship role: {describeRelationshipRole(p)}</div>
                {p.ownerDisplayName || p.ownerEmail ? (
                  <div className="text-xs text-neutral-500 mt-1">
                    Original creator: {p.ownerDisplayName || p.ownerEmail}
                  </div>
                ) : null}
                {splitsAllowed && p.splitSummary?.length ? (
                  <details className="mt-2 text-xs text-neutral-400">
                    <summary className="cursor-pointer select-none">Split terms</summary>
                    <div className="mt-2 space-y-1">
                      {p.splitSummary.map((s, idx) => (
                        <div key={`${p.contentId}-${idx}`} className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            {resolveParticipantDisplayLabel({
                              displayName: s.displayName || null,
                              participantUserId: s.participantUserId || null,
                              participantEmail: s.participantEmail || null,
                              allowEmail: true,
                              fallbackLabel: "Participant"
                            })} — {s.role || "role"}
                          </div>
                          <div>{typeof s.bps === "number" ? `${(s.bps / 100).toFixed(2)}%` : s.percent || "—"}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Badge label={`Collaboration • ${p.myBps != null ? `${(p.myBps / 100).toFixed(2)}%` : p.myPercent || "—"} share`} tone="cyan" />
                {p.contentDeletedAt ? <Badge label="Inactive" tone="amber" /> : <Badge label="Active" tone="success" />}
                <button
                  onClick={() => openEarningsView(p.contentId, p.title)}
                  className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                >
                  View earnings
                </button>
                {p.contentId ? (
                  <button
                    onClick={() => openSplitEditor(p.contentId)}
                    className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                  >
                    Open
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
          {collaborativeLocalWorks.length === 0 ? (
            <div className="text-sm text-neutral-500">No collaboration-owned content yet.</div>
          ) : null}
            </div>
          </div>
        </div>
      </section>
      ) : null}

      {scope === "remote" ? (
      <section id="collab-remote" className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="text-sm text-neutral-300 font-medium">Collaborations from Others</div>
        <div className="text-xs text-neutral-500 mt-1">Content from other creators where you participate.</div>
        {remoteRoyalties.length === 0 ? (
          <div className="text-sm text-neutral-500 mt-3">No remote collaborations yet.</div>
        ) : (
          <div className="space-y-3 mt-3">
            {remoteRoyalties.map((r) => (
            <div key={r.id} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-neutral-100">{r.contentTitle || "Untitled"}</div>
                  <div className="text-xs text-neutral-400 mt-1">
                    {r.contentType ? r.contentType.toUpperCase() : "CONTENT"} • Role: {r.role || "participant"} • Share: {r.percent != null ? `${Number(r.percent).toFixed(2)}%` : "—"}
                  </div>
                  <div className="text-xs text-neutral-400 mt-1">
                    Relationship role: <span className="text-neutral-200">Collaborator</span>
                    {" "}• Execution state: <span className="text-neutral-200">{r.payoutState || "none"}</span>
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Remote: {r.remoteOrigin}
                  </div>
                  {r.acceptedAt ? (
                    <div className="text-xs text-neutral-400 mt-1">Accepted: {new Date(r.acceptedAt).toLocaleString()}</div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge label="Remote" tone="cyan" />
                  <button
                    onClick={() => openEarningsView(r.contentId, r.contentTitle)}
                    className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                  >
                    View earnings
                  </button>
                  {r.contentId ? (
                    <button
                      onClick={() => {
                        const id = String(r.contentId || "").trim();
                        if (id && localKnownIds.has(id)) {
                          openSplitEditor(id);
                          return;
                        }
                        openSplitSummary(id || null);
                      }}
                      className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                    >
                      Open
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            ))}
          </div>
        )}
      </section>
      ) : null}

      {derivativesAllowed && scope === "derivatives" ? (
        <section id="collab-derivatives" className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-sm text-neutral-300 font-medium">Upstream Derivatives</div>
          <div className="text-xs text-neutral-500 mt-1">Derivative royalties tied to your collaboration splits.</div>
          <div className="mt-2 flex items-center justify-between">
            <div className="text-xs text-neutral-500">Inactive items are tombstoned or deleted works.</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowInactive((v) => !v)}
                className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
              >
                {showInactive ? "Hide inactive" : "Show inactive"}
              </button>
              <button
                onClick={() => setShowAllUpstream((v) => !v)}
                className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
              >
                {showAllUpstream ? "Show less" : "Show all"}
              </button>
            </div>
          </div>
          {visibleUpstream.length === 0 ? (
            <div className="text-sm text-neutral-500 mt-3">No upstream derivatives yet.</div>
          ) : (
            <div className="mt-3 space-y-3">
              {visibleUpstream
                .slice(0, showAllUpstream ? visibleUpstream.length : 3)
                .map((u, idx) => (
                  <div key={`${u.parentTitle}-${u.childTitle}-${idx}`} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
                    <div className="text-sm font-medium text-neutral-100">
                      {u.parentTitle} → {u.childTitle}
                      {u.childDeletedAt || u.parentDeletedAt ? (
                        <span className="ml-2 text-[10px] text-amber-300">inactive</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-neutral-400 mt-1">
                      Upstream rate: {(u.upstreamBps / 100).toFixed(u.upstreamBps % 100 ? 2 : 0)}% • My effective share:{" "}
                      {typeof u.myEffectiveBps === "number"
                        ? `${(u.myEffectiveBps / 100).toFixed(u.myEffectiveBps % 100 ? 2 : 0)}%`
                        : "Not split-derived"}
                    </div>
                    <div className="text-xs text-neutral-400 mt-1">
                      Relationship role: <span className="text-neutral-200">Upstream stakeholder</span>
                      {u.approvedAt
                        ? ` • Cleared ${new Date(u.approvedAt).toLocaleString()}`
                        : String(u.status || "").trim().toUpperCase() === "APPROVED"
                          ? " • Cleared"
                          : " • Pending clearance"}
                      {u.approveWeightBps != null && u.approvalBpsTarget != null ? (
                        <span className="ml-2 text-neutral-500">Progress: {u.approveWeightBps}/{u.approvalBpsTarget} bps</span>
                      ) : null}
                      {u.source === "remote" && u.remoteOrigin ? (
                        <span className="ml-2 text-neutral-500">Remote: {u.remoteOrigin}</span>
                      ) : null}
                    </div>
                    <div className="mt-2">
                      <button
                        onClick={() => openEarningsView(u.childContentId, u.childTitle)}
                        className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        View earnings
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </section>
      ) : null}

      {scope === "history" ? (
      <section id="collab-audit" className="space-y-3">
        <HistoryFeed
          title="Collaboration history"
          items={historyItems}
          loading={historyLoading}
          emptyText="No collaboration history yet."
          exportName="royalty-history.json"
          onRefresh={async () => {
            setHistoryLoading(true);
            try {
              const hist = await api<HistoryEvent[]>("/me/royalty-history", "GET");
              setHistoryItems(hist || []);
            } catch {
              setHistoryItems([]);
            } finally {
              setHistoryLoading(false);
            }
          }}
        />

        <AuditPanel
          scopeType="royalty"
          title="Audit"
          exportName="royalty-audit.json"
        />
      </section>
      ) : null}
    </div>
  );
}
