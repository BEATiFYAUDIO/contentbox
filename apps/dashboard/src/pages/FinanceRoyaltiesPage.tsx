import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import TimeScopeControls from "../components/TimeScopeControls";
import { isWithinPeriod, type TimeBasis, type TimePeriod } from "../lib/timeScope";

type RoyaltyRow = {
  contentId: string;
  title: string;
  totalSalesSats: string;
  grossRevenueSats: string;
  allocationSats: string;
  settledSats: string;
  withdrawnSats: string;
  pendingSats: string;
  isDerivative?: boolean;
};

type RoyaltiesContextResponse = {
  works?: Array<{
    contentId?: string | null;
    myRole?: "owner" | "participant" | string | null;
  }>;
  upstreamIncome?: Array<{
    parentContentId?: string | null;
    parentTitle?: string | null;
    childContentId?: string | null;
    childTitle?: string | null;
    upstreamBps?: number | null;
    myEffectiveBps?: number | null;
    earnedSatsToDate?: string | number | null;
    approvedAt?: string | null;
    status?: string | null;
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

type RevenueSaleCompactRow = {
  contentId?: string | null;
  recognizedAt?: string | null;
};

type FinanceRoyaltiesPageProps = {
  refreshSignal?: number;
  bridgeFilter?: {
    contentId: string;
    title: string;
    token: number;
  } | null;
  onOpenPayouts?: (bridge?: { contentId?: string; title: string }) => void;
};

type OverviewSummary = {
  totals?: {
    participantRoyaltyAccruedSats?: string;
    participantRoyaltyFeeWithheldSats?: string;
    participantRoyaltyPayableSats?: string;
    participantRoyaltyPaidSats?: string;
  };
};

type FinancePayoutItem = {
  id: string;
  paymentIntentId?: string | null;
  contentId?: string | null;
  soldWork?: { id?: string | null; title?: string | null; type?: string | null } | null;
  sourceWork?: { id?: string | null; title?: string | null; type?: string | null } | null;
  amountSats?: string | number | null;
  grossShareSats?: string | number | null;
  feeWithheldSats?: string | number | null;
  netAmountSats?: string | number | null;
  netPaidSats?: string | number | null;
  netPayableSats?: string | number | null;
  earningSourceType?: EarningsSourceType | null;
  allocationRole?: string | null;
  allocationParticipantRef?: string | null;
  allocationBps?: number | null;
  allocationSource?: string | null;
  status?: string | null;
  remittedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type EarningsLedgerStatus = "Earned" | "Pending" | "Processing" | "Partial" | "Paid" | "Failed" | "Blocked";
type EarningsSourceType =
  | "catalog_earning"
  | "collaboration_earning"
  | "derivative_creator_earning"
  | "upstream_royalty_earning";

const EARNINGS_SOURCE_LABEL: Record<EarningsSourceType, string> = {
  catalog_earning: "Catalog earning",
  collaboration_earning: "Collaboration earning",
  derivative_creator_earning: "Derivative creator earning",
  upstream_royalty_earning: "Upstream royalty earning"
};

type EarningsLedgerRow = {
  id: string;
  contentId: string;
  soldWorkTitle: string;
  sourceWorkTitle: string | null;
  sourceType: EarningsSourceType;
  contentTitle: string;
  sourceLabel: string;
  roleLabel: string;
  originLabel: string;
  shareLabel: string;
  status: EarningsLedgerStatus;
  grossShareSats: number;
  feeWithheldSats: number;
  netPayableSats: number;
  netPaidSats: number;
  amountSats: number;
  dateLabel: string;
  dateSortTs: number;
  earnedTsIso: string | null;
  paidTsIso: string | null;
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

function statusTone(status: EarningsLedgerStatus): string {
  if (status === "Paid") return "border-emerald-800/70 bg-emerald-900/20 text-emerald-300";
  if (status === "Pending" || status === "Processing" || status === "Partial") return "border-amber-800/70 bg-amber-900/20 text-amber-300";
  if (status === "Failed" || status === "Blocked") return "border-red-800/70 bg-red-900/20 text-red-300";
  return "border-neutral-700 bg-neutral-900/50 text-neutral-300";
}

export default function FinanceRoyaltiesPage({
  refreshSignal,
  bridgeFilter = null,
  onOpenPayouts
}: FinanceRoyaltiesPageProps) {
  const [rows, setRows] = useState<RoyaltyRow[]>([]);
  const [salesRows, setSalesRows] = useState<RevenueSaleCompactRow[]>([]);
  const [payoutItems, setPayoutItems] = useState<FinancePayoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [ledgerContentFilter, setLedgerContentFilter] = useState<{ contentId: string; title: string } | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [contentQuery, setContentQuery] = useState("");
  const [localRoleByContent, setLocalRoleByContent] = useState<Record<string, string>>({});
  const [remoteRoleByContent, setRemoteRoleByContent] = useState<Record<string, string>>({});
  const [remoteRows, setRemoteRows] = useState<RemoteRoyaltyContextRow[]>([]);
  const [upstreamRows, setUpstreamRows] = useState<NonNullable<RoyaltiesContextResponse["upstreamIncome"]>>([]);
  const [overviewSummary, setOverviewSummary] = useState<OverviewSummary | null>(null);
  const [timeBasis, setTimeBasis] = useState<TimeBasis>("earned");
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("all");
  const [showLedgerGuidance, setShowLedgerGuidance] = useState(false);

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
      try {
        const res = await api<{ items?: FinancePayoutItem[] }>(`/finance/payouts?basis=paid&period=all`, "GET");
        if (!active) return;
        setPayoutItems(Array.isArray(res?.items) ? res.items : []);
      } catch {
        if (!active) return;
        setPayoutItems([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshSignal, retryTick]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api<RevenueSaleCompactRow[]>("/api/revenue/sales?period=all&compact=1", "GET");
        if (!active) return;
        setSalesRows(Array.isArray(res) ? res : []);
      } catch {
        if (!active) return;
        setSalesRows([]);
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
        setUpstreamRows(Array.isArray(localCtx.value?.upstreamIncome) ? localCtx.value.upstreamIncome : []);
        for (const work of works) {
          const contentId = String(work?.contentId || "").trim();
          if (!contentId) continue;
          const roleLabel = normalizeRoleLabel(work?.myRole);
          if (roleLabel) localMap[contentId] = roleLabel;
        }
      } else {
        setUpstreamRows([]);
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

  const mapRemotePayoutStateToLedgerStatus = (
    raw: string | null | undefined,
    summaryRaw: Record<string, number> | null | undefined
  ): EarningsLedgerStatus => {
    const state = String(raw || "").trim().toLowerCase();
    const summary = summaryRaw && typeof summaryRaw === "object" ? summaryRaw : null;
    if (summary) {
      const paid = Number((summary as any).paid || 0);
      const pending = Number((summary as any).pending || 0);
      const ready = Number((summary as any).ready || 0);
      const forwarding = Number((summary as any).forwarding || 0);
      const failed = Number((summary as any).failed || 0);
      const blocked = Number((summary as any).blocked || 0);
      const unresolved = pending + ready + forwarding;
      const failedOrBlocked = failed + blocked;

      // Priority: trust granular payout summary over coarse remote state string.
      if (paid > 0 && unresolved === 0 && failedOrBlocked === 0) return "Paid";
      if (paid > 0 && (unresolved > 0 || failedOrBlocked > 0)) return "Partial";
      if (unresolved > 0) return "Processing";
      if (failedOrBlocked > 0) return "Failed";
    }

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

  const feeWithheld = Number(overviewSummary?.totals?.participantRoyaltyFeeWithheldSats || 0);

  const localRecognizedAtByContent = useMemo(() => {
    const map = new Map<string, string>();
    for (const sale of salesRows) {
      const contentId = String(sale?.contentId || "").trim();
      const recognizedAt = String(sale?.recognizedAt || "").trim();
      if (!contentId || !recognizedAt) continue;
      const prev = map.get(contentId);
      if (!prev || recognizedAt > prev) map.set(contentId, recognizedAt);
    }
    return map;
  }, [salesRows]);

  const earningsLedgerRows = useMemo<EarningsLedgerRow[]>(() => {
    const baseRowByContentId = new Map<string, RoyaltyRow>();
    rows.forEach((row) => {
      const id = String(row.contentId || "").trim();
      if (id) baseRowByContentId.set(id, row);
    });
    const out: EarningsLedgerRow[] = [];
    for (const payout of payoutItems) {
      const contentId = String(payout.contentId || "").trim();
      const fallbackRow = contentId ? baseRowByContentId.get(contentId) : undefined;
      const soldWorkTitle =
        String(payout.soldWork?.title || "").trim() ||
        String(fallbackRow?.title || "").trim() ||
        "Untitled";
      const sourceWorkTitle = String(payout.sourceWork?.title || "").trim() || null;
      const sourceTypeRaw = String(payout.earningSourceType || "").trim() as EarningsSourceType | "";
      const sourceType: EarningsSourceType =
        sourceTypeRaw === "catalog_earning" ||
        sourceTypeRaw === "collaboration_earning" ||
        sourceTypeRaw === "derivative_creator_earning" ||
        sourceTypeRaw === "upstream_royalty_earning"
          ? sourceTypeRaw
          : fallbackRow?.isDerivative
            ? "derivative_creator_earning"
            : "catalog_earning";
      const sourceLabel = EARNINGS_SOURCE_LABEL[sourceType];
      const roleLabel = normalizeRoleLabel(payout.allocationRole) || localRoleByContent[contentId] || "Participant";
      const shareLabel =
        Number.isFinite(Number(payout.allocationBps || 0)) && Number(payout.allocationBps || 0) > 0
          ? `${(Number(payout.allocationBps || 0) / 100).toFixed(2)}%`
          : formatShareLabel(fallbackRow?.allocationSats, fallbackRow?.totalSalesSats);
      const statusRaw = String(payout.status || "").trim().toLowerCase();
      const status: EarningsLedgerStatus =
        statusRaw === "paid"
          ? "Paid"
          : statusRaw === "pending"
            ? "Pending"
            : statusRaw === "ready" || statusRaw === "forwarding"
              ? "Processing"
              : statusRaw === "failed"
                ? "Failed"
                : statusRaw === "blocked"
                  ? "Blocked"
                  : "Earned";
      const grossShareSats = Math.max(0, Number(payout.grossShareSats ?? payout.netAmountSats ?? payout.amountSats ?? 0) || 0);
      const feeWithheldSats = Math.max(0, Number(payout.feeWithheldSats ?? 0) || 0);
      const netAmountSats = Math.max(0, Number(payout.netAmountSats ?? payout.amountSats ?? 0) || 0);
      const netPaidSats = Math.max(0, Number(payout.netPaidSats ?? (status === "Paid" ? netAmountSats : 0)) || 0);
      const netPayableSats = Math.max(
        0,
        Number(
          payout.netPayableSats ??
            (status === "Pending" || status === "Processing" ? netAmountSats : 0)
        ) || 0
      );
      const tsIso = String(payout.remittedAt || payout.updatedAt || payout.createdAt || "").trim() || null;
      const dateSortTs = tsIso ? new Date(tsIso).getTime() : 0;
      const dateLabel = dateSortTs > 0 ? new Date(dateSortTs).toLocaleDateString() : "—";
      const rowId = String(payout.id || "").trim() || `${contentId}:${String(payout.paymentIntentId || "").trim()}:${String(payout.allocationParticipantRef || "").trim()}:${sourceType}:${status}`;
      out.push({
        id: rowId,
        contentId: contentId || `unscoped:${rowId}`,
        soldWorkTitle,
        sourceWorkTitle,
        sourceType,
        contentTitle: soldWorkTitle,
        sourceLabel,
        roleLabel,
        originLabel: "Local",
        shareLabel,
        status,
        grossShareSats,
        feeWithheldSats,
        netPayableSats,
        netPaidSats,
        amountSats: netAmountSats,
        dateLabel,
        dateSortTs,
        earnedTsIso: String(payout.createdAt || payout.updatedAt || "").trim() || tsIso,
        paidTsIso: tsIso,
        remittanceDetail: sourceWorkTitle ? `Source work: ${sourceWorkTitle}` : null,
        remittanceActionable: status !== "Paid" && status !== "Earned"
      });
    }

    for (const row of remoteRows) {
      const contentId = String(row?.contentId || "").trim();
      const earned = Math.max(0, Number(row?.earnedSatsToDate || 0) || 0);
      if (earned <= 0) continue;
      const remoteId = String(row?.id || "").trim();
      const rowId = contentId || remoteId;
      if (!rowId) continue;

      const contentTitle = String(row?.contentTitle || "Remote collaboration").trim() || "Remote collaboration";
      const roleLabel = normalizeRoleLabel(row?.role) || "Participant";
      const shareLabel = formatPercentLabel(row?.percent);
      const status = mapRemotePayoutStateToLedgerStatus(row?.payoutState, row?.payoutSummary || null);
      const dateSortTs = row?.acceptedAt ? new Date(String(row.acceptedAt)).getTime() : 0;
      const dateLabel = dateSortTs > 0 ? new Date(dateSortTs).toLocaleDateString() : "—";
      const payoutSummary = formatRemotePayoutSummary(row?.payoutSummary || null);
      const remittanceDetail = payoutSummary ? `Remote payout rows: ${payoutSummary}` : `Remote payout state: ${String(row?.payoutState || "none")}`;
      const remittanceActionable = status !== "Paid" && status !== "Earned";

      out.push({
        id: `remote:${rowId}:${status.toLowerCase()}`,
        contentId: contentId || `remote:${rowId}`,
        soldWorkTitle: contentTitle,
        sourceWorkTitle: null,
        sourceType: "collaboration_earning",
        contentTitle,
        sourceLabel: EARNINGS_SOURCE_LABEL.collaboration_earning,
        roleLabel,
        originLabel: "Remote",
        shareLabel,
        status,
        grossShareSats: earned,
        feeWithheldSats: 0,
        netPayableSats: status === "Pending" || status === "Processing" || status === "Partial" ? earned : 0,
        netPaidSats: status === "Paid" ? earned : 0,
        amountSats: earned,
        dateLabel,
        dateSortTs,
        earnedTsIso: row?.acceptedAt || null,
        paidTsIso: row?.acceptedAt || null,
        remittanceDetail,
        remittanceActionable
      });
    }

    for (const upstream of upstreamRows) {
      const earned = Math.max(0, Number(upstream?.earnedSatsToDate || 0) || 0);
      if (earned <= 0) continue;
      const parentContentId = String(upstream?.parentContentId || "").trim();
      const childContentId = String(upstream?.childContentId || "").trim();
      const rowId = parentContentId || childContentId;
      if (!rowId) continue;
      const parentTitle = String(upstream?.parentTitle || "Upstream parent").trim() || "Upstream parent";
      const childTitle = String(upstream?.childTitle || "Derivative").trim() || "Derivative";
      const approvedAt = String(upstream?.approvedAt || "").trim();
      const dateSortTs = approvedAt ? new Date(approvedAt).getTime() : 0;
      const dateLabel = dateSortTs > 0 ? new Date(dateSortTs).toLocaleDateString() : "—";
      const myEffectiveBps = Number(upstream?.myEffectiveBps || 0);
      const shareLabel = Number.isFinite(myEffectiveBps) && myEffectiveBps > 0 ? `${(myEffectiveBps / 100).toFixed(2)}%` : "—";

      out.push({
        id: `upstream:${rowId}`,
        contentId: parentContentId || `upstream:${rowId}`,
        soldWorkTitle: childTitle,
        sourceWorkTitle: parentTitle,
        sourceType: "upstream_royalty_earning",
        contentTitle: `${parentTitle} ← ${childTitle}`,
        sourceLabel: EARNINGS_SOURCE_LABEL.upstream_royalty_earning,
        roleLabel: "Upstream stakeholder",
        originLabel: "Local",
        shareLabel,
        status: "Earned",
        grossShareSats: earned,
        feeWithheldSats: 0,
        netPayableSats: 0,
        netPaidSats: 0,
        amountSats: earned,
        dateLabel,
        dateSortTs,
        earnedTsIso: approvedAt || null,
        paidTsIso: approvedAt || null,
        remittanceDetail: "Derivative upstream royalty recognized in earnings.",
        remittanceActionable: false
      });
    }

    // Fallback: keep earned rows visible if payout rows are unavailable for a local work.
    for (const row of rows) {
      const contentId = String(row.contentId || "").trim();
      if (!contentId) continue;
      const hasDetailedRow = out.some((r) => String(r.contentId || "").trim() === contentId && !String(r.id || "").startsWith("remote:"));
      if (hasDetailedRow) continue;
      const earned = Math.max(0, Number(row.settledSats || 0) || 0);
      if (earned <= 0) continue;
      const sourceType: EarningsSourceType = row.isDerivative ? "derivative_creator_earning" : "catalog_earning";
      const sourceLabel = EARNINGS_SOURCE_LABEL[sourceType];
      const roleLabel = localRoleByContent[contentId] || remoteRoleByContent[contentId] || "Participant";
      const shareLabel = formatShareLabel(row.allocationSats, row.totalSalesSats);
      const earnedTs = localRecognizedAtByContent.get(contentId) || "";
      const dateSortTs = earnedTs ? new Date(earnedTs).getTime() : 0;
      const dateLabel = dateSortTs > 0 ? new Date(dateSortTs).toLocaleDateString() : "—";
      out.push({
        id: `${contentId}:earned-fallback`,
        contentId,
        soldWorkTitle: String(row.title || "Untitled").trim() || "Untitled",
        sourceWorkTitle: null,
        sourceType,
        contentTitle: String(row.title || "Untitled").trim() || "Untitled",
        sourceLabel,
        roleLabel,
        originLabel: "Local",
        shareLabel,
        status: "Earned",
        grossShareSats: earned,
        feeWithheldSats: 0,
        netPayableSats: 0,
        netPaidSats: 0,
        amountSats: earned,
        dateLabel,
        dateSortTs,
        earnedTsIso: earnedTs || null,
        paidTsIso: null,
        remittanceDetail: "Payout rows unavailable; showing earned fallback.",
        remittanceActionable: false
      });
    }

    return out.sort((a, b) => {
      const dateDelta = (b.dateSortTs || 0) - (a.dateSortTs || 0);
      if (dateDelta !== 0) return dateDelta;
      const order: Record<EarningsLedgerStatus, number> = {
        Failed: 7,
        Blocked: 6,
        Partial: 5,
        Processing: 4,
        Pending: 3,
        Earned: 2,
        Paid: 1
      };
      const statusDelta = order[b.status] - order[a.status];
      if (statusDelta !== 0) return statusDelta;
      return b.amountSats - a.amountSats;
    });
  }, [rows, remoteRows, upstreamRows, localRoleByContent, remoteRoleByContent, localRecognizedAtByContent, payoutItems]);

  const timeScopedEarningsLedgerRows = useMemo(() => {
    return earningsLedgerRows.filter((row) => {
      if (timePeriod === "all") return true;
      const tsIso = timeBasis === "paid" ? row.paidTsIso || row.earnedTsIso : row.earnedTsIso || row.paidTsIso;
      return isWithinPeriod(tsIso, timePeriod);
    });
  }, [earningsLedgerRows, timeBasis, timePeriod]);

  const summaryScopedEarningsLedgerRows = useMemo(() => {
    if (!ledgerContentFilter?.contentId) return timeScopedEarningsLedgerRows;
    return timeScopedEarningsLedgerRows.filter((row) => row.contentId === ledgerContentFilter.contentId);
  }, [timeScopedEarningsLedgerRows, ledgerContentFilter]);

  const scopedTopline = useMemo(() => {
    return summaryScopedEarningsLedgerRows.reduce(
      (acc, row) => {
        const amt = Math.max(0, Number(row.amountSats || 0) || 0);
        acc.grossEarned += amt;
        acc.fees += Math.max(0, Number(row.feeWithheldSats || 0) || 0);
        if (row.status === "Paid") acc.netPaid += amt;
        if (row.status === "Pending" || row.status === "Processing" || row.status === "Partial") acc.netPayable += amt;
        return acc;
      },
      { grossEarned: 0, fees: 0, netPaid: 0, netPayable: 0 }
    );
  }, [summaryScopedEarningsLedgerRows]);

  const visibleEarningsLedgerRows = useMemo(() => {
    return timeScopedEarningsLedgerRows.filter((row) => {
      if (ledgerContentFilter?.contentId && row.contentId !== ledgerContentFilter.contentId) return false;
      if (contentQuery.trim()) {
        const q = contentQuery.trim().toLowerCase();
        const title = String(row.contentTitle || "").toLowerCase();
        if (!title.includes(q)) return false;
      }
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (sourceFilter !== "all" && row.sourceType !== sourceFilter) return false;
      if (roleFilter !== "all" && row.roleLabel !== roleFilter) return false;
      return true;
    });
  }, [timeScopedEarningsLedgerRows, ledgerContentFilter, contentQuery, roleFilter, sourceFilter, statusFilter]);

  const availableStatuses = useMemo(() => {
    const values = new Set<string>();
    for (const row of earningsLedgerRows) values.add(row.status);
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [earningsLedgerRows]);

  const availableSources = useMemo(() => {
    const values = new Set<string>();
    for (const row of earningsLedgerRows) values.add(row.sourceType);
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [earningsLedgerRows]);

  const availableRoles = useMemo(() => {
    const values = new Set<string>();
    for (const row of earningsLedgerRows) values.add(row.roleLabel);
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
        <div className="text-xs text-neutral-500 mt-2">Sales lives in Sales. This page is your participant/share statement.</div>
        <div className="text-xs text-neutral-500 mt-1">Model: Gross earned (pre-fee) → Fees → Net paid + Net payable.</div>
        <div className="text-xs text-neutral-500 mt-1">
          Derivative creator earnings and upstream royalties are earnings source types here. Payouts remain execution truth.
        </div>
        <div className="mt-3">
          <TimeScopeControls
            basis={timeBasis}
            onBasisChange={setTimeBasis}
            period={timePeriod}
            onPeriodChange={setTimePeriod}
            basisOptions={["earned", "paid"]}
            periodOptions={["1d", "7d", "30d", "90d", "all"]}
            helperText={
              timeBasis === "paid"
                ? "Earnings are scoped by paid/remitted timestamps where available, with earned-time fallback."
                : "Earnings are scoped by earned time using available row timestamps."
            }
          />
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Gross earned</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(String(scopedTopline.grossEarned))}</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Fees</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(String(scopedTopline.fees))}</div>
          {!ledgerContentFilter?.contentId && timePeriod === "all" && scopedTopline.fees === 0 && feeWithheld > 0 ? (
            <div className="mt-1 text-[11px] text-neutral-500">Detailed fee rows unavailable for this scope; showing 0 from row detail.</div>
          ) : null}
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Net paid</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(String(scopedTopline.netPaid))}</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Net payable</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(String(scopedTopline.netPayable))}</div>
        </div>
      </section>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold">Earnings Ledger</div>
            <div className="text-xs text-neutral-500 mt-1">Scope this statement by content, status, source, and role.</div>
          </div>
          <button
            type="button"
            onClick={() => setShowLedgerGuidance((s) => !s)}
            className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-900"
          >
            {showLedgerGuidance ? "Hide guidance" : "Show guidance"}
          </button>
        </div>
        {showLedgerGuidance ? (
          <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-900/30 p-3 text-xs text-neutral-500 space-y-1">
            <div>Status model: Earned = gross accrued, Pending/Processing = unresolved net remittance, Partial = mixed outcomes, Paid = remitted.</div>
            <div>Role/share/origin come from available royalties context; fallback role is Participant.</div>
            <div>Date shows “—” when no row timestamp is available. Time scope is all-time until earned timestamps are consistently available.</div>
            <div>Sales rows stay in Sales. Payout execution details stay in Payouts.</div>
          </div>
        ) : null}
        <div className="mt-3 mb-2 text-xs text-neutral-500">
          Filter rows:
        </div>
        <div className="mb-2 flex flex-wrap gap-2 rounded-lg border border-neutral-800 bg-neutral-900/30 p-2">
          <label className="text-xs text-neutral-400 inline-flex items-center gap-2">
            <span>Content</span>
            <input
              value={contentQuery}
              onChange={(e) => setContentQuery(e.target.value)}
              placeholder="Search title..."
              className="w-44 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
            />
          </label>
          <label className="text-xs text-neutral-400 inline-flex items-center gap-2">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
            >
              <option value="all">All</option>
              {availableStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
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
                  {EARNINGS_SOURCE_LABEL[source as EarningsSourceType] || source}
                </option>
              ))}
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
        {contentQuery.trim() ? (
          <div className="mb-2 flex items-center gap-2 text-xs text-neutral-400">
            <span>
              Search: <span className="text-neutral-200">{contentQuery.trim()}</span>
            </span>
            <button
              type="button"
              onClick={() => setContentQuery("")}
              className="rounded-md border border-neutral-700 px-2 py-1 hover:bg-neutral-900"
            >
              Clear search
            </button>
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="text-left font-medium py-2">Date</th>
                <th className="text-left font-medium py-2">Sold work</th>
                <th className="text-left font-medium py-2">Source work</th>
                <th className="text-left font-medium py-2">Source type</th>
                <th className="text-left font-medium py-2">Role</th>
                <th className="text-left font-medium py-2">Share</th>
                <th className="text-left font-medium py-2">Gross</th>
                <th className="text-left font-medium py-2">Commerce fee</th>
                <th className="text-left font-medium py-2">Net payable</th>
                <th className="text-left font-medium py-2">Net paid</th>
                <th className="text-left font-medium py-2">Status</th>
                <th className="text-left font-medium py-2">Net amount</th>
              </tr>
            </thead>
            <tbody>
              {visibleEarningsLedgerRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-3 text-neutral-500">
                    {ledgerContentFilter
                      ? "No earnings rows found for this work."
                      : sourceFilter !== "all" || roleFilter !== "all" || statusFilter !== "all" || contentQuery.trim().length > 0
                        ? "No earnings rows match the current filters."
                        : "No earnings rows yet."}
                  </td>
                </tr>
              ) : (
                visibleEarningsLedgerRows.map((row) => (
                  <tr key={row.id} className="border-t border-neutral-900 hover:bg-neutral-900/30">
                    <td className="py-2 text-neutral-400">{row.dateLabel}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => setLedgerContentFilter({ contentId: row.contentId, title: row.contentTitle })}
                        className="text-neutral-200 hover:text-white underline decoration-neutral-700 underline-offset-2"
                      >
                        {row.soldWorkTitle}
                      </button>
                    </td>
                    <td className="py-2 text-neutral-300">{row.sourceWorkTitle || "—"}</td>
                    <td className="py-2 text-neutral-300">{row.sourceLabel}</td>
                    <td className="py-2 text-neutral-300">{row.roleLabel}</td>
                    <td className="py-2 text-neutral-300">{row.shareLabel}</td>
                    <td className="py-2 text-neutral-200">{formatSats(String(row.grossShareSats))}</td>
                    <td className="py-2 text-neutral-300">{formatSats(String(row.feeWithheldSats))}</td>
                    <td className="py-2 text-amber-300">{formatSats(String(row.netPayableSats))}</td>
                    <td className="py-2 text-emerald-300">{formatSats(String(row.netPaidSats))}</td>
                    <td className="py-2">
                      <span className={["inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]", statusTone(row.status)].join(" ")}>
                        {row.status}
                      </span>
                      {row.remittanceActionable && onOpenPayouts ? (
                        <button
                          type="button"
                          onClick={() => onOpenPayouts({ contentId: String(row.contentId || "").trim(), title: row.contentTitle })}
                          className="mt-1 block rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-900"
                        >
                          Open payouts
                        </button>
                      ) : null}
                    </td>
                    <td className="py-2 text-neutral-100">{formatSats(String(row.amountSats))}</td>
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
