import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import TimeScopeControls from "../components/TimeScopeControls";
import type { TimeBasis, TimePeriod } from "../lib/timeScope";

type RoyaltyRow = {
  contentId: string;
  title: string;
  totalSalesSats: string;
  grossRevenueSats: string;
  allocationSats: string;
  settledSats: string;
  withdrawnSats: string;
  pendingSats: string;
};

type RoyaltiesContextResponse = {
  works?: Array<{
    contentId?: string | null;
    myRole?: "owner" | "participant" | string | null;
  }>;
};

type RemoteRoyaltyContextRow = {
  id?: string | null;
  contentId?: string | null;
  contentTitle?: string | null;
  role?: string | null;
  percent?: number | string | null;
  earnedSatsToDate?: string | number | null;
  payoutState?: string | null;
  payoutSummary?: Record<string, number> | null;
  acceptedAt?: string | null;
};

type FinanceRoyaltiesPageProps = {
  refreshSignal?: number;
  bridgeFilter?: {
    contentId: string;
    title: string;
    token: number;
  } | null;
  onOpenPayouts?: () => void;
};

type OverviewSummary = {
  totals?: {
    participantRoyaltyAccruedSats?: string;
    participantRoyaltyFeeWithheldSats?: string;
    participantRoyaltyPayableSats?: string;
    participantRoyaltyPaidSats?: string;
  };
};

type EarningsLedgerStatus = "Earned" | "Pending" | "Processing" | "Partial" | "Paid" | "Failed" | "Blocked";

type EarningsLedgerRow = {
  id: string;
  contentId: string;
  contentTitle: string;
  sourceLabel: string;
  roleLabel: string;
  originLabel: string;
  shareLabel: string;
  status: EarningsLedgerStatus;
  amountSats: number;
  dateLabel: string;
  remittanceDetail?: string | null;
  remittanceActionable?: boolean;
};

function normalizeRoleLabel(raw: string | null | undefined): string {
  const role = String(raw || "").trim().toLowerCase();
  if (!role) return "";
  if (role === "owner") return "Owner";
  if (role === "collaborator" || role === "collab") return "Collaborator";
  if (role === "participant") return "Participant";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default function FinanceRoyaltiesPage({
  refreshSignal,
  bridgeFilter = null,
  onOpenPayouts
}: FinanceRoyaltiesPageProps) {
  const [rows, setRows] = useState<RoyaltyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [ledgerContentFilter, setLedgerContentFilter] = useState<{ contentId: string; title: string } | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | EarningsLedgerStatus>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [originFilter, setOriginFilter] = useState<string>("all");
  const [localRoleByContent, setLocalRoleByContent] = useState<Record<string, string>>({});
  const [remoteRoleByContent, setRemoteRoleByContent] = useState<Record<string, string>>({});
  const [remoteRows, setRemoteRows] = useState<RemoteRoyaltyContextRow[]>([]);
  const [overviewSummary, setOverviewSummary] = useState<OverviewSummary | null>(null);
  const [timeBasis, setTimeBasis] = useState<TimeBasis>("earned");
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("all");

  useEffect(() => {
    if (!bridgeFilter?.contentId) return;
    setLedgerContentFilter({ contentId: bridgeFilter.contentId, title: bridgeFilter.title || "Untitled" });
  }, [bridgeFilter?.token, bridgeFilter?.contentId, bridgeFilter?.title]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [res, overview] = await Promise.all([
          api<{ items: RoyaltyRow[] }>("/finance/royalties"),
          api<OverviewSummary>("/finance/overview")
        ]);
        if (!active) return;
        setRows(res.items || []);
        setOverviewSummary(overview || null);
      } catch (e: any) {
        if (!active) return;
        setError(e.message || "Failed to load royalties.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshSignal, retryTick]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [localCtx, remoteCtx] = await Promise.allSettled([
        api<RoyaltiesContextResponse>("/my/royalties", "GET"),
        api<RemoteRoyaltyContextRow[]>("/my/royalties/remote", "GET")
      ]);
      if (!active) return;

      const localMap: Record<string, string> = {};
      const remoteMap: Record<string, string> = {};

      if (localCtx.status === "fulfilled") {
        const works = Array.isArray(localCtx.value?.works) ? localCtx.value.works : [];
        for (const work of works) {
          const contentId = String(work?.contentId || "").trim();
          if (!contentId) continue;
          const roleLabel = normalizeRoleLabel(work?.myRole);
          if (roleLabel) localMap[contentId] = roleLabel;
        }
      }

      if (remoteCtx.status === "fulfilled") {
        const remoteList = Array.isArray(remoteCtx.value) ? remoteCtx.value : [];
        for (const row of remoteList) {
          const contentId = String(row?.contentId || "").trim();
          if (!contentId) continue;
          const roleLabel = normalizeRoleLabel(row?.role);
          remoteMap[contentId] = roleLabel || "Participant";
        }
        setRemoteRows(remoteList);
      } else {
        setRemoteRows([]);
      }

      setLocalRoleByContent(localMap);
      setRemoteRoleByContent(remoteMap);
    })();

    return () => {
      active = false;
    };
  }, [refreshSignal, retryTick]);

  const formatSats = (raw: string | null | undefined) => {
    const n = Number(raw || 0);
    if (!Number.isFinite(n)) return "0 sats";
    return `${Math.round(n).toLocaleString()} sats`;
  };

  const formatShareLabel = (allocationRaw: string | number | null | undefined, totalRaw: string | number | null | undefined) => {
    const allocation = Number(allocationRaw || 0);
    const total = Number(totalRaw || 0);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(allocation) && allocation >= 0) {
      const pct = Math.max(0, Math.min(100, (allocation / total) * 100));
      const rounded = pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1);
      return `${rounded}%`;
    }
    return "—";
  };

  const formatPercentLabel = (raw: string | number | null | undefined) => {
    const n = Number(raw ?? NaN);
    if (!Number.isFinite(n) || n <= 0) return "—";
    const rounded = n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
    return `${rounded}%`;
  };

  const mapRemotePayoutStateToLedgerStatus = (raw: string | null | undefined): EarningsLedgerStatus => {
    const state = String(raw || "").trim().toLowerCase();
    if (state === "paid") return "Paid";
    if (state === "ready" || state === "forwarding") return "Processing";
    if (state === "mixed") return "Partial";
    if (state === "failed") return "Failed";
    if (state === "blocked") return "Blocked";
    if (state === "pending") return "Processing";
    return "Earned";
  };

  const formatRemotePayoutSummary = (summaryRaw: Record<string, number> | null | undefined) => {
    const summary = summaryRaw && typeof summaryRaw === "object" ? summaryRaw : null;
    if (!summary) return "";
    const ordered: string[] = [];
    for (const key of ["paid", "ready", "forwarding", "pending", "failed", "blocked"]) {
      const count = Number((summary as any)[key] || 0);
      if (count > 0) ordered.push(`${key}:${count}`);
    }
    return ordered.join(" ");
  };

  const totals = rows.reduce(
    (acc, r) => {
      acc.earned += Number(r.settledSats || 0) || 0;
      acc.paid += Number(r.withdrawnSats || 0) || 0;
      acc.pending += Number(r.pendingSats || 0) || 0;
      return acc;
    },
    { earned: 0, paid: 0, pending: 0 }
  );
  const grossEarned = Number(overviewSummary?.totals?.participantRoyaltyAccruedSats || 0) || totals.earned;
  const feeWithheld = Number(overviewSummary?.totals?.participantRoyaltyFeeWithheldSats || 0);
  const netPaid = Number(overviewSummary?.totals?.participantRoyaltyPaidSats || 0) || totals.paid;
  const netPayable = Number(overviewSummary?.totals?.participantRoyaltyPayableSats || 0) || totals.pending;

  const earningsLedgerRows = useMemo<EarningsLedgerRow[]>(() => {
    const out: EarningsLedgerRow[] = [];
    const baseContentIds = new Set<string>();
    for (const row of rows) {
      const contentId = String(row.contentId || "").trim();
      if (contentId) baseContentIds.add(contentId);
      const contentTitle = String(row.title || "Untitled").trim() || "Untitled";
      const earned = Math.max(0, Number(row.settledSats || 0) || 0);
      const paid = Math.max(0, Number(row.withdrawnSats || 0) || 0);
      const pending = Math.max(0, Number(row.pendingSats || 0) || 0);
      const sourceLabel = "Catalog earning";
      const localRole = localRoleByContent[contentId] || "";
      const remoteRole = remoteRoleByContent[contentId] || "";
      const roleLabel = localRole || remoteRole || "Participant";
      const originLabel = remoteRole ? "Remote" : localRole ? "Local" : "—";
      const shareLabel = formatShareLabel(row.allocationSats, row.totalSalesSats);
      const dateLabel = "—";

      if (paid > 0) {
        out.push({
          id: `${contentId}:paid`,
          contentId,
          contentTitle,
          sourceLabel,
          roleLabel,
          originLabel,
          shareLabel,
          status: "Paid",
          amountSats: paid,
          dateLabel,
          remittanceDetail: null,
          remittanceActionable: false
        });
      }

      if (pending > 0) {
        out.push({
          id: `${contentId}:pending`,
          contentId,
          contentTitle,
          sourceLabel,
          roleLabel,
          originLabel,
          shareLabel,
          status: "Pending",
          amountSats: pending,
          dateLabel,
          remittanceDetail: null,
          remittanceActionable: false
        });
      }

      const earnedOnly = Math.max(0, earned - paid - pending);
      if (earnedOnly > 0) {
        out.push({
          id: `${contentId}:earned`,
          contentId,
          contentTitle,
          sourceLabel,
          roleLabel,
          originLabel,
          shareLabel,
          status: "Earned",
          amountSats: earnedOnly,
          dateLabel,
          remittanceDetail: null,
          remittanceActionable: false
        });
      }
    }

    for (const row of remoteRows) {
      const contentId = String(row?.contentId || "").trim();
      if (contentId && baseContentIds.has(contentId)) continue;
      const earned = Math.max(0, Number(row?.earnedSatsToDate || 0) || 0);
      if (earned <= 0) continue;
      const remoteId = String(row?.id || "").trim();
      const rowId = contentId || remoteId;
      if (!rowId) continue;

      const contentTitle = String(row?.contentTitle || "Remote collaboration").trim() || "Remote collaboration";
      const roleLabel = normalizeRoleLabel(row?.role) || "Participant";
      const shareLabel = formatPercentLabel(row?.percent);
      const status = mapRemotePayoutStateToLedgerStatus(row?.payoutState);
      const dateLabel = row?.acceptedAt ? new Date(String(row.acceptedAt)).toLocaleDateString() : "—";
      const payoutSummary = formatRemotePayoutSummary(row?.payoutSummary || null);
      const remittanceDetail = payoutSummary ? `Remote payout rows: ${payoutSummary}` : `Remote payout state: ${String(row?.payoutState || "none")}`;
      const remittanceActionable = status !== "Paid" && status !== "Earned";

      out.push({
        id: `remote:${rowId}:${status.toLowerCase()}`,
        contentId: contentId || `remote:${rowId}`,
        contentTitle,
        sourceLabel: "Collaboration earning",
        roleLabel,
        originLabel: "Remote",
        shareLabel,
        status,
        amountSats: earned,
        dateLabel,
        remittanceDetail,
        remittanceActionable
      });
    }

    return out.sort((a, b) => {
      const order: Record<EarningsLedgerStatus, number> = {
        Failed: 7,
        Blocked: 6,
        Partial: 5,
        Processing: 4,
        Pending: 3,
        Earned: 2,
        Paid: 1
      };
      return order[b.status] - order[a.status];
    });
  }, [rows, remoteRows, localRoleByContent, remoteRoleByContent]);

  const visibleEarningsLedgerRows = useMemo(() => {
    return earningsLedgerRows.filter((row) => {
      if (ledgerContentFilter?.contentId && row.contentId !== ledgerContentFilter.contentId) return false;
      if (sourceFilter !== "all" && row.sourceLabel !== sourceFilter) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (roleFilter !== "all" && row.roleLabel !== roleFilter) return false;
      if (originFilter !== "all" && row.originLabel !== originFilter) return false;
      return true;
    });
  }, [earningsLedgerRows, ledgerContentFilter, sourceFilter, statusFilter, roleFilter, originFilter]);

  const availableSources = useMemo(() => {
    const values = new Set<string>();
    for (const row of earningsLedgerRows) values.add(row.sourceLabel);
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [earningsLedgerRows]);

  const availableRoles = useMemo(() => {
    const values = new Set<string>();
    for (const row of earningsLedgerRows) values.add(row.roleLabel);
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [earningsLedgerRows]);

  const availableOrigins = useMemo(() => {
    const values = new Set<string>();
    for (const row of earningsLedgerRows) values.add(row.originLabel);
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [earningsLedgerRows]);

  if (loading) return <div className="text-sm text-neutral-400">Loading content…</div>;
  if (error) {
    return (
      <div className="rounded-lg border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 flex items-center justify-between">
        <span>Couldn’t load content data. {error}</span>
        <button
          onClick={() => setRetryTick((t) => t + 1)}
          className="rounded-lg border border-amber-700 px-2 py-1 text-xs hover:bg-amber-900/30"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="text-base font-semibold">Earnings</div>
        <div className="text-sm text-neutral-400 mt-1">
          Your money across content: gross earned, fee impact, and net payout state.
        </div>
        <div className="text-xs text-neutral-500 mt-2">
          Seller revenue lives in Sales and Content. This Earnings view is your share only.
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          This ledger reflects earnings visible from the current finance feed. Royalty-specific separation is shown only when source data supports it safely.
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          If no royalty-type earnings are present in the current feed, this page shows catalog earnings only.
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          Gross earned is pre-fee participation accrual. Net paid/net payable are post-fee payout states.
        </div>
        <div className="mt-3">
          <TimeScopeControls
            basis={timeBasis}
            onBasisChange={setTimeBasis}
            period={timePeriod}
            onPeriodChange={setTimePeriod}
            basisOptions={["earned"]}
            periodOptions={["all"]}
            periodDisabled
            helperText="Earnings use earned time. Time scoping will expand as row-level earned timestamps become available."
          />
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Gross earned</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(String(grossEarned))}</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Fees</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(String(feeWithheld))}</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Net paid</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(String(netPaid))}</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Net payable</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(String(netPayable))}</div>
        </div>
      </section>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="text-base font-semibold">Earnings Ledger</div>
        <div className="text-xs text-neutral-500 mt-1">
          Each row represents an earning event from a work in your catalog or collaborations.
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          Row-level earnings by content and lifecycle state. Sales stay in Sales. Payout execution details stay in Payouts.
        </div>
        <div className="text-xs text-neutral-500 mt-1 mb-2">
          Status model: Earned = gross accrued, Pending/Processing = unresolved net remittance, Partial = mixed payout outcomes, Paid = remitted.
        </div>
        <div className="text-xs text-neutral-500 mt-1 mb-2">
          Role/share/origin context is attached only from existing Royalties context; when role is unavailable, rows fall back to Participant.
        </div>
        <div className="text-xs text-neutral-500 mt-1 mb-2">
          Includes earnings shown by the current finance feed. Date shows “—” when no row timestamp is available.
        </div>
        <div className="text-xs text-neutral-500 mt-1 mb-2">
          Period scoping is currently all-time for this statement because local earned rows do not yet include consistent earned timestamps.
        </div>
        <div className="text-xs text-neutral-500 mt-1 mb-2">
          Share is derived from your settled share versus total settled amount for the work.
        </div>
        <div className="text-xs text-neutral-500 mt-1 mb-2">
          Scope this ledger by source, role, origin, and status.
        </div>
        <div className="mb-2 flex flex-wrap gap-2">
          <label className="text-xs text-neutral-400 inline-flex items-center gap-2">
            <span>Source</span>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
            >
              <option value="all">All</option>
              {availableSources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-neutral-400 inline-flex items-center gap-2">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | EarningsLedgerStatus)}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
            >
              <option value="all">All</option>
              <option value="Earned">Earned</option>
              <option value="Pending">Pending</option>
              <option value="Processing">Processing</option>
              <option value="Partial">Partial</option>
              <option value="Paid">Paid</option>
              <option value="Failed">Failed</option>
              <option value="Blocked">Blocked</option>
            </select>
          </label>
          <label className="text-xs text-neutral-400 inline-flex items-center gap-2">
            <span>Role</span>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
            >
              <option value="all">All</option>
              {availableRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-neutral-400 inline-flex items-center gap-2">
            <span>Origin</span>
            <select
              value={originFilter}
              onChange={(e) => setOriginFilter(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
            >
              <option value="all">All</option>
              {availableOrigins.map((origin) => (
                <option key={origin} value={origin}>
                  {origin}
                </option>
              ))}
            </select>
          </label>
        </div>
        {ledgerContentFilter ? (
          <div className="mb-2 flex items-center gap-2 text-xs text-neutral-400">
            <span>
              Filtered to: <span className="text-neutral-200">{ledgerContentFilter.title}</span>
            </span>
            <button
              type="button"
              onClick={() => setLedgerContentFilter(null)}
              className="rounded-md border border-neutral-700 px-2 py-1 hover:bg-neutral-900"
            >
              Clear filter
            </button>
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="text-left font-medium py-2">Date</th>
                <th className="text-left font-medium py-2">Content</th>
                <th className="text-left font-medium py-2">Source</th>
                <th className="text-left font-medium py-2">Role</th>
                <th className="text-left font-medium py-2">Origin</th>
                <th className="text-left font-medium py-2">Share</th>
                <th className="text-left font-medium py-2">Amount</th>
                <th className="text-left font-medium py-2">Status</th>
                <th className="text-left font-medium py-2">Remittance detail</th>
              </tr>
            </thead>
            <tbody>
              {visibleEarningsLedgerRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-3 text-neutral-500">
                    {ledgerContentFilter
                      ? "No earnings rows found for this work."
                      : sourceFilter !== "all" || statusFilter !== "all" || roleFilter !== "all" || originFilter !== "all"
                        ? "No earnings rows match the current filters."
                        : "No earnings rows yet."}
                  </td>
                </tr>
              ) : (
                visibleEarningsLedgerRows.map((row) => (
                  <tr key={row.id} className="border-t border-neutral-900">
                    <td className="py-2 text-neutral-400">{row.dateLabel}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => setLedgerContentFilter({ contentId: row.contentId, title: row.contentTitle })}
                        className="text-neutral-200 hover:text-white underline decoration-neutral-700 underline-offset-2"
                      >
                        {row.contentTitle}
                      </button>
                    </td>
                    <td className="py-2 text-neutral-300">{row.sourceLabel}</td>
                    <td className="py-2 text-neutral-300">{row.roleLabel}</td>
                    <td className="py-2 text-neutral-300">{row.originLabel}</td>
                    <td className="py-2 text-neutral-300">{row.shareLabel}</td>
                    <td className="py-2">{formatSats(String(row.amountSats))}</td>
                    <td className="py-2 text-neutral-300">{row.status}</td>
                    <td className="py-2 text-neutral-400">
                      {row.remittanceDetail ? <div className="text-xs">{row.remittanceDetail}</div> : <div className="text-xs text-neutral-600">—</div>}
                      {row.remittanceActionable && onOpenPayouts ? (
                        <button
                          type="button"
                          onClick={onOpenPayouts}
                          className="mt-1 rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-900"
                        >
                          Open payouts
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upstream derivatives live in Collaborations */}
    </div>
  );
}
