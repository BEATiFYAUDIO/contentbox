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
}) {
  type RoyaltiesScope = "active" | "local" | "remote" | "derivatives" | "history";
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
  const [scope, setScope] = useState<RoyaltiesScope>("active");
  const toBigInt = (v: unknown): bigint => {
    try {
      const s = String(v ?? "0").trim();
      if (!s) return 0n;
      return BigInt(s);
    } catch {
      return 0n;
    }
  };
  const fmtSats = (v: bigint): string => `${Number(v).toLocaleString()} sats`;
  const openSplitEditor = (contentId: string) => {
    const id = String(contentId || "").trim();
    if (!id) return;
    window.location.href = `/content/${encodeURIComponent(id)}/splits`;
  };
  const openSplitSummary = (contentId?: string | null) => {
    const id = String(contentId || "").trim();
    if (id) {
      window.location.href = `/royalties/${encodeURIComponent(id)}`;
      return;
    }
    window.location.href = "/splits";
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
  const localRoyaltyAccrued = works.reduce((sum, row) => sum + toBigInt(row.earnedSatsToDate), 0n);
  const localRoyaltyPayable = works.reduce((sum, row) => sum + toBigInt(row.pendingSats), 0n);
  const localRoyaltyPaid = works.reduce((sum, row) => sum + toBigInt(row.withdrawnSats), 0n);
  const remoteRoyaltyAccrued = remoteRoyalties.reduce((sum, row) => sum + toBigInt(row.earnedSatsToDate), 0n);
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
  const ownedContentIds = new Set(visibleOwnedSharedWorks.map((row) => row.contentId));
  const visibleActiveCollaborations = participations.filter((row) => !ownedContentIds.has(row.contentId));
  const visibleUpstream = upstream.filter((u) => showInactive || (!u.childDeletedAt && !u.parentDeletedAt));
  const collaborationCount = participations.length + remoteRoyalties.length;
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
    return <LockedFeaturePanel title="Collaborations" />;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold">Collaborations</div>
        <div className="text-sm text-neutral-400 mt-1">Songs and works you share with others, including split roles and accepted collaborations.</div>
        <div className="text-xs text-neutral-500 mt-1">
          Primary source for participation, roles, and share across works, including accrued and paid amounts.
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          This page shows your participation, roles, and share across works. Earnings are summarized in the Earnings tab.
        </div>
        <div className="text-xs text-neutral-500 mt-1">Where relationships go, money flows.</div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Collaborations</div>
          <div className="mt-1 text-lg font-semibold text-neutral-100">{collaborationCount.toLocaleString()}</div>
          <div className="text-xs text-neutral-500 mt-1">Active + remote collaboration records</div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Royalty accrued</div>
          <div className="mt-1 text-lg font-semibold text-neutral-100">{fmtSats(localRoyaltyAccrued + remoteRoyaltyAccrued)}</div>
          <div className="text-xs text-neutral-500 mt-1">Local + remote participation accrual</div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Royalty payable</div>
          <div className="mt-1 text-lg font-semibold text-neutral-100">{fmtSats(localRoyaltyPayable)}</div>
          <div className="text-xs text-neutral-500 mt-1">Allocated but not yet remitted (local rows)</div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Royalty paid</div>
          <div className="mt-1 text-lg font-semibold text-neutral-100">{fmtSats(localRoyaltyPaid)}</div>
          <div className="text-xs text-neutral-500 mt-1">Successfully paid/withdrawn (local rows)</div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Remote accrued</div>
          <div className="mt-1 text-lg font-semibold text-neutral-100">{fmtSats(remoteRoyaltyAccrued)}</div>
          <div className="text-xs text-neutral-500 mt-1">Mirrored remote participation accrual</div>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-950/30 p-3">
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Scope</div>
        <div className="text-xs text-neutral-500 mt-1">Choose one section at a time to reduce table noise.</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setScope("active")}
            className={[
              "text-xs rounded-full border px-2 py-1",
              scope === "active" ? "border-white/40 bg-white/10 text-white" : "border-neutral-800 hover:bg-neutral-900"
            ].join(" ")}
          >
            Active collaborations ({visibleActiveCollaborations.length})
          </button>
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
            Remote collaborations ({remoteRoyalties.length})
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

      {scope === "active" ? (
      <section id="collab-active" className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="text-sm text-neutral-300 font-medium">Active Collaborations</div>
        <div className="text-xs text-neutral-500 mt-1">Content you are part of with defined splits.</div>
        {visibleActiveCollaborations.length === 0 ? (
          <div className="text-sm text-neutral-500 mt-3">No locked participations yet.</div>
        ) : (
          <div className="space-y-3 mt-3">
            {visibleActiveCollaborations.map((p) => (
              <div key={p.splitParticipantId} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-neutral-100">{p.contentTitle || "Untitled"}</div>
                    <div className="text-xs text-neutral-400 mt-1">
                      {(p.contentType || "content").toUpperCase()} • Role: {p.participantRole || "participant"} • Share: {p.participantBps != null ? `${(p.participantBps / 100).toFixed(2)}%` : (p.participantPercent != null ? `${Number(p.participantPercent).toFixed(2)}%` : "—")}
                    </div>
                    <div className="text-xs text-neutral-500 mt-1">
                      Split v{p.splitVersionNumber ?? "?"} • Rights status: accepted
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge label="Active" tone="success" />
                    <Badge label={p.contentStatus || "unknown"} />
                    {p.highlightedOnProfile ? <Badge label="Featured" tone="cyan" /> : null}
                    {p.buyUrl ? (
                      <button
                        onClick={() => window.open(p.buyUrl as string, "_blank", "noopener,noreferrer")}
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
                <div className="text-xs text-neutral-400 mt-1">
                  Accrued: <span className="text-neutral-200">{p.earnedSatsToDate} sats</span>
                  {" "}• Payable: <span className="text-neutral-200">{p.pendingSats || "0"} sats</span>
                  {" "}• Paid: <span className="text-neutral-200">{p.withdrawnSats || "0"} sats</span>
                </div>
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
                {toBigInt(p.pendingSats) > 0n ? <Badge label="Pending payout" tone="amber" /> : null}
                {toBigInt(p.withdrawnSats) > 0n ? <Badge label="Paid" tone="success" /> : null}
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
                <div className="text-xs text-neutral-400 mt-1">
                  Accrued: <span className="text-neutral-200">{p.earnedSatsToDate} sats</span>
                  {" "}• Payable: <span className="text-neutral-200">{p.pendingSats || "0"} sats</span>
                  {" "}• Paid: <span className="text-neutral-200">{p.withdrawnSats || "0"} sats</span>
                </div>
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
                {toBigInt(p.pendingSats) > 0n ? <Badge label="Pending payout" tone="amber" /> : null}
                {toBigInt(p.withdrawnSats) > 0n ? <Badge label="Paid" tone="success" /> : null}
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
                    Accrued: <span className="text-neutral-200">{String(r.earnedSatsToDate || "0")} sats</span>
                    {" "}• Payout state: <span className="text-neutral-200">{r.payoutState || "none"}</span>
                    {" "}• Destination: <span className="text-neutral-200">{r.destinationState || "unknown"}</span>
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
                  {String(r.payoutState || "").toLowerCase() === "paid" ? <Badge label="Paid" tone="success" /> : null}
                  {(String(r.payoutState || "").toLowerCase() === "pending" || String(r.payoutState || "").toLowerCase() === "ready" || String(r.payoutState || "").toLowerCase() === "forwarding") ? (
                    <Badge label="Pending payout" tone="amber" />
                  ) : null}
                  {String(r.payoutState || "").toLowerCase() === "failed" ? <Badge label="Payout failed" tone="warning" /> : null}
                  {r.contentId || r.inviteUrl ? (
                    <button
                      onClick={() => openSplitSummary(r.contentId)}
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
                .slice(0, showAllUpstream ? upstream.length : 3)
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
                      {(u.myEffectiveBps / 100).toFixed(u.myEffectiveBps % 100 ? 2 : 0)}%
                    </div>
                    <div className="text-xs text-neutral-400 mt-1">
                      Earned: <span className="text-neutral-200">{u.earnedSatsToDate} sats</span>
                      {u.approvedAt ? ` • Cleared ${new Date(u.approvedAt).toLocaleString()}` : " • Pending clearance"}
                      {u.approveWeightBps != null && u.approvalBpsTarget != null ? (
                        <span className="ml-2 text-neutral-500">Progress: {u.approveWeightBps}/{u.approvalBpsTarget} bps</span>
                      ) : null}
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
