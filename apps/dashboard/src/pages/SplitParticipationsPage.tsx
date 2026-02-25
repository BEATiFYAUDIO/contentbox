import { useEffect, useState } from "react";
import { api } from "../lib/api";
import HistoryFeed, { type HistoryEvent } from "../components/HistoryFeed";
import AuditPanel from "../components/AuditPanel";
import LockedFeaturePanel from "../components/LockedFeaturePanel";
import type { FeatureMatrix, CapabilitySet, NodeMode } from "../lib/identity";

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
};

export default function SplitParticipationsPage(props: {
  identityLevel?: string | null;
  features?: FeatureMatrix;
  lockReasons?: Record<string, string>;
  capabilities?: CapabilitySet;
  nodeMode?: NodeMode | null;
}) {
  const canAdvancedSplits = props.features?.advancedSplits ?? false;
  const splitsAllowed = props.capabilities?.useSplits ?? canAdvancedSplits;
  const derivativesAllowed = props.capabilities?.useDerivatives ?? canAdvancedSplits;
  const isBasic = props.nodeMode === "basic";

  const [works, setWorks] = useState<WorkRoyaltyRow[]>([]);
  const [upstream, setUpstream] = useState<UpstreamIncomeRow[]>([]);
  const [remoteRoyalties, setRemoteRoyalties] = useState<RemoteRoyaltyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [showInactiveWorks, setShowInactiveWorks] = useState(false);
  const [showAllUpstream, setShowAllUpstream] = useState(false);

  useEffect(() => {
    if (isBasic) return;
    (async () => {
      try {
        setLoading(true);
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
    return <LockedFeaturePanel title="My Royalties" />;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold">My Royalties</div>
        <div className="text-sm text-neutral-400 mt-1">Entitlements from content splits (owned or invited).</div>
      </div>

      {loading ? <div className="text-sm text-neutral-400">Loading…</div> : null}
      {error ? <div className="text-sm text-amber-300">{error}</div> : null}

      {!loading && works.length === 0 ? (
        <div className="text-sm text-neutral-500">No works yet.</div>
      ) : null}

      <div className="text-sm text-neutral-300">Works I have a share in</div>
      <div className="mt-2 flex items-center justify-between">
        <div className="text-xs text-neutral-500">Inactive works are tombstoned or trashed items.</div>
        <button
          onClick={() => setShowInactiveWorks((v) => !v)}
          className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
        >
          {showInactiveWorks ? "Hide inactive" : "Show inactive"}
        </button>
      </div>
      <div className="space-y-3">
        {works
          .filter((p) => showInactiveWorks || !p.contentDeletedAt)
          .map((p) => (
          <div key={p.contentId} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-neutral-100">{p.title || "Untitled"}</div>
                <div className="text-xs text-neutral-400 mt-1">
                  {p.type ? p.type.toUpperCase() : "CONTENT"} • {p.contentStatus || "unknown"}
                  {p.contentDeletedAt ? <span className="ml-2 text-[10px] text-amber-300">inactive</span> : null}
                </div>
                <div className="text-xs text-neutral-400 mt-1">
                  Role: <span className="text-neutral-200">{p.myRole === "owner" ? "owner" : "participant"}</span>
                  {" "}• Share: <span className="text-neutral-200">{p.myBps != null ? `${(p.myBps / 100).toFixed(2)}%` : p.myPercent || "—"}</span>
                  {" "}• Earned: <span className="text-neutral-200">{p.earnedSatsToDate} sats</span>
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
                            {s.displayName || s.participantEmail || s.participantUserId || "participant"} — {s.role || "role"}
                          </div>
                          <div>{typeof s.bps === "number" ? `${(s.bps / 100).toFixed(2)}%` : s.percent || "—"}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] rounded-full border border-neutral-800 px-2 py-0.5 text-neutral-300">
                  {p.myRole === "owner" ? "Owned" : "Participant"}
                </span>
                {p.contentId ? (
                  <button
                    onClick={() => {
                      window.location.href = `/royalties/${p.contentId}`;
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

      {derivativesAllowed ? (
        <>
          <div className="text-sm text-neutral-300 mt-6">Upstream derivatives</div>
          <div className="text-xs text-neutral-500 mt-1">Derivative royalties tied to your splits.</div>
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
          {upstream.filter((u) => showInactive || (!u.childDeletedAt && !u.parentDeletedAt)).length === 0 ? (
            <div className="text-sm text-neutral-500 mt-3">No upstream derivatives yet.</div>
          ) : (
            <div className="mt-3 space-y-3">
              {upstream
                .filter((u) => showInactive || (!u.childDeletedAt && !u.parentDeletedAt))
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

          <div className="text-sm text-neutral-300 mt-6">Remote royalties</div>
          {remoteRoyalties.length === 0 ? (
            <div className="text-sm text-neutral-500">No remote invites yet.</div>
          ) : (
            <div className="space-y-3">
              {remoteRoyalties.map((r) => (
                <div key={r.id} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-neutral-100">{r.contentTitle || "Untitled"}</div>
                      <div className="text-xs text-neutral-400 mt-1">
                        {r.contentType ? r.contentType.toUpperCase() : "CONTENT"} • remote
                      </div>
                      <div className="text-xs text-neutral-400 mt-1">
                        Role: <span className="text-neutral-200">{r.role || "participant"}</span>
                        {" "}• Share: <span className="text-neutral-200">{r.percent != null ? `${Number(r.percent).toFixed(2)}%` : "—"}</span>
                      </div>
                      <div className="text-xs text-neutral-500 mt-1">
                        Remote: {r.remoteOrigin}
                      </div>
                      {r.acceptedAt ? (
                        <div className="text-xs text-neutral-400 mt-1">Accepted: {new Date(r.acceptedAt).toLocaleString()}</div>
                      ) : null}
                    </div>
                    {r.inviteUrl ? (
                      <button
                        onClick={() => window.open(r.inviteUrl as string, "_blank", "noopener,noreferrer")}
                        className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        Open
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
      )}

        </>
      ) : null}

      <HistoryFeed
        title="Royalties history"
        items={historyItems}
        loading={historyLoading}
        emptyText="No royalty history yet."
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
    </div>
  );
}
