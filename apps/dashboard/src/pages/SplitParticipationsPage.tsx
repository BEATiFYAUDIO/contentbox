import { useEffect, useState } from "react";
import { api } from "../lib/api";
import HistoryFeed, { type HistoryEvent } from "../components/HistoryFeed";
import AuditPanel from "../components/AuditPanel";

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
  pendingSatsToDate?: string | null;
  withdrawnSatsToDate?: string | null;
  lastActivityAt?: string | null;
  storefrontStatus?: string | null;
  contentStatus?: string | null;
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
};

type RoyaltiesResponse = {
  works: WorkRoyaltyRow[];
  upstreamIncome: UpstreamIncomeRow[];
};

export default function SplitParticipationsPage() {
  const [works, setWorks] = useState<WorkRoyaltyRow[]>([]);
  const [upstream, setUpstream] = useState<UpstreamIncomeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sortBy, setSortBy] = useState<"earnings" | "pending" | "alpha">("earnings");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await api<RoyaltiesResponse>("/my/royalties", "GET");
        setWorks(res?.works || []);
        setUpstream(res?.upstreamIncome || []);
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
  }, [retryTick]);

  const formatSats = (raw?: string | null) => {
    const n = Number(raw || 0);
    if (!Number.isFinite(n)) return "0 sats";
    return `${Math.round(n).toLocaleString()} sats`;
  };

  const filteredWorks = works.filter((w) => {
    if (typeFilter === "all") return true;
    return (w.type || "").toLowerCase() === typeFilter;
  });

  const sortedWorks = [...filteredWorks].sort((a, b) => {
    if (sortBy === "alpha") return (a.title || "").localeCompare(b.title || "");
    const aEarned = Number(a.earnedSatsToDate || 0);
    const bEarned = Number(b.earnedSatsToDate || 0);
    const aPending = Number(a.pendingSatsToDate || 0);
    const bPending = Number(b.pendingSatsToDate || 0);
    if (sortBy === "pending") return bPending - aPending;
    return bEarned - aEarned;
  });

  function exportWorkJson(work: WorkRoyaltyRow) {
    try {
      const blob = new Blob([JSON.stringify(work, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `royalty-${work.contentId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">My Royalties</div>
            <div className="text-sm text-neutral-400 mt-1">
              Track your share of revenue across the content you own or participate in.
            </div>
          </div>
          <button
            onClick={() => setRetryTick((t) => t + 1)}
            className="rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900"
          >
            Refresh now
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-neutral-400">Sort</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-neutral-200"
            >
              <option value="earnings">Earnings</option>
              <option value="pending">Pending</option>
              <option value="alpha">A → Z</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-neutral-400">Type</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-neutral-200"
            >
              <option value="all">All</option>
              <option value="song">Song</option>
              <option value="video">Video</option>
              <option value="book">Book</option>
              <option value="file">File</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? <div className="text-sm text-neutral-400">Loading…</div> : null}
      {error ? (
        <div className="rounded-lg border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 flex items-center justify-between">
          <span>Couldn’t load royalties. {error}</span>
          <button
            onClick={() => setRetryTick((t) => t + 1)}
            className="rounded-lg border border-amber-700 px-2 py-1 text-xs hover:bg-amber-900/30"
          >
            Retry
          </button>
        </div>
      ) : null}

      {!loading && works.length === 0 ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4 text-sm text-neutral-400">
          No royalties yet — your content hasn’t sold.
        </div>
      ) : null}

      <div className="text-sm text-neutral-300">Works I have a share in</div>
      <div className="space-y-3">
        {sortedWorks.map((p) => (
          <div key={p.contentId} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-neutral-100">{p.title || "Untitled"}</div>
                <div className="text-xs text-neutral-400 mt-1">
                  {p.type ? p.type.toUpperCase() : "CONTENT"} • {p.contentStatus || "unknown"}
                </div>
                <div className="text-xs text-neutral-400 mt-1">
                  Role: <span className="text-neutral-200">{p.myRole === "owner" ? "owner" : "participant"}</span>
                  {" "}• Share: <span className="text-neutral-200">{p.myBps != null ? `${(p.myBps / 100).toFixed(2)}%` : p.myPercent || "—"}</span>
                  {" "}• Earned: <span className="text-neutral-200">{formatSats(p.earnedSatsToDate)}</span>
                </div>
                <div className="text-xs text-neutral-500 mt-1">
                  Pending: <span className="text-neutral-200">{formatSats(p.pendingSatsToDate)}</span>
                  {" "}• Withdrawn: <span className="text-neutral-200">{formatSats(p.withdrawnSatsToDate)}</span>
                  {" "}• Last activity: <span className="text-neutral-200">{p.lastActivityAt ? new Date(p.lastActivityAt).toLocaleString() : "—"}</span>
                </div>
                {p.ownerDisplayName || p.ownerEmail ? (
                  <div className="text-xs text-neutral-500 mt-1">
                    Original creator: {p.ownerDisplayName || p.ownerEmail}
                  </div>
                ) : null}
                <details className="mt-2 text-xs text-neutral-400">
                  <summary className="cursor-pointer select-none">Details</summary>
                  <div className="mt-2 space-y-2">
                    {p.splitSummary?.length ? (
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Split breakdown</div>
                        <div className="mt-1 space-y-1">
                          {p.splitSummary.map((s, idx) => (
                            <div key={`${p.contentId}-${idx}`} className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                {s.displayName || s.participantEmail || s.participantUserId || "participant"} — {s.role || "role"}
                              </div>
                              <div>{typeof s.bps === "number" ? `${(s.bps / 100).toFixed(2)}%` : s.percent || "—"}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div>No split details yet.</div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => exportWorkJson(p)}
                        className="text-[11px] rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        Export JSON
                      </button>
                      <button
                        disabled
                        className="text-[11px] rounded-lg border border-neutral-800 px-2 py-1 opacity-60 cursor-not-allowed"
                      >
                        Share report
                      </button>
                    </div>
                  </div>
                </details>
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

      <div className="text-sm text-neutral-300 mt-6">Upstream income from derivatives</div>
      {upstream.length === 0 ? (
        <div className="text-sm text-neutral-500">No upstream income yet.</div>
      ) : (
        <div className="space-y-3">
          {upstream.map((u) => (
            <div key={`${u.parentContentId}:${u.childContentId}`} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
              <div className="text-sm font-medium text-neutral-100">
                {u.parentTitle} → {u.childTitle}
              </div>
              <div className="text-xs text-neutral-400 mt-1">
                Upstream rate: {(u.upstreamBps / 100).toFixed(u.upstreamBps % 100 ? 2 : 0)}% • My effective share:{" "}
                {(u.myEffectiveBps / 100).toFixed(u.myEffectiveBps % 100 ? 2 : 0)}%
              </div>
              <div className="text-xs text-neutral-400 mt-1">
                Earned: <span className="text-neutral-200">{u.earnedSatsToDate} sats</span>
                {u.approvedAt ? ` • Cleared ${new Date(u.approvedAt).toLocaleString()}` : null}
              </div>
            </div>
          ))}
        </div>
      )}


      <HistoryFeed
        title="Royalty allocation history"
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
