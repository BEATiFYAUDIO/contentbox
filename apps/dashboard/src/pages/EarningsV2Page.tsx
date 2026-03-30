import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import TimeScopeControls from "../components/TimeScopeControls";
import { isWithinPeriod, type TimeBasis, type TimePeriod } from "../lib/timeScope";

type SaleRow = {
  id: string;
  intentId: string;
  contentId: string;
  amountSats: string | number;
  grossAmountSats?: string | number;
  providerInvoicingFeeSats?: string | number;
  providerDurableHostingFeeSats?: string | number;
  providerFeeSats?: string | number;
  creatorNetSats?: string | number;
  payoutStatus?: "pending" | "forwarding" | "paid" | "failed";
  payoutRail?: "provider_custody" | "forwarded" | "creator_node" | null;
  payoutDestinationType?: "lightning_address" | "local_lnd" | "onchain_address" | null;
  payoutDestinationSummary?: string | null;
  providerRemitMode?: "provider_custody" | "auto_forward" | "manual_payout" | null;
  payoutReference?: string | null;
  remittedAt?: string | null;
  payoutLastError?: string | null;
  currency: string;
  rail: string;
  memo?: string | null;
  recognizedAt: string;
  content?: { id: string; title: string; type: string } | null;
};

type EarningsV2PageProps = {
  refreshSignal?: number;
  hasInvoiceCommerce?: boolean;
  onOpenEarningsForContent?: (contentId: string, title: string) => void;
};

type RoyaltiesContextResponse = {
  works?: Array<{
    contentId?: string | null;
    myRole?: "owner" | "participant" | string | null;
    myBps?: number | null;
    myPercent?: number | string | null;
  }>;
};

type FinancePayoutItem = {
  id: string;
  paymentIntentId?: string | null;
  contentId?: string | null;
  amountSats?: string | number;
  netAmountSats?: string | number;
  status?: string | null;
};

type PayoutState = "paid" | "forwarding" | "pending" | "failed" | "unknown";

function normalizeRoleLabel(raw: string | null | undefined): string {
  const role = String(raw || "").trim().toLowerCase();
  if (!role) return "";
  if (role === "owner") return "Owner";
  if (role === "collaborator" || role === "collab") return "Collaborator";
  if (role === "participant") return "Participant";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function toNum(raw: string | number | null | undefined) {
  const n = Number(raw || 0);
  return Number.isFinite(n) ? n : 0;
}

function hasValue(raw: string | number | null | undefined) {
  if (raw === null || raw === undefined) return false;
  const s = String(raw).trim();
  return s.length > 0;
}

function formatSats(raw: string | number | null | undefined) {
  return `${Math.round(toNum(raw)).toLocaleString()} sats`;
}

function normalizePayoutState(raw: SaleRow["payoutStatus"]): PayoutState {
  if (raw === "paid" || raw === "forwarding" || raw === "pending" || raw === "failed") return raw;
  return "unknown";
}

const PAYOUT_STATE_PRIORITY: Record<PayoutState, number> = {
  paid: 5,
  forwarding: 4,
  pending: 3,
  failed: 2,
  unknown: 1
};

function summarizePayoutState(states: PayoutState[]): PayoutState {
  if (!states.length) return "unknown";
  let best: PayoutState = "unknown";
  for (const state of states) {
    if (PAYOUT_STATE_PRIORITY[state] > PAYOUT_STATE_PRIORITY[best]) best = state;
  }
  return best;
}

function feeBreakdownForRow(row: SaleRow): {
  gross: number;
  earnings: number;
  invoicingFee: number;
  durableHostingFee: number;
  totalProviderFees: number;
  feeSource: "provider_fee_total" | "provider_fee_components" | "gross_minus_earnings";
} {
  const gross = toNum(row.grossAmountSats ?? row.amountSats);
  const earnings = toNum(row.creatorNetSats ?? row.amountSats);
  const invoicingRaw = row.providerInvoicingFeeSats;
  const durableRaw = row.providerDurableHostingFeeSats;
  const totalRaw = row.providerFeeSats;

  if (hasValue(totalRaw)) {
    const totalProviderFees = toNum(totalRaw);
    const invoicingFee = hasValue(invoicingRaw) ? toNum(invoicingRaw) : totalProviderFees;
    const durableHostingFee = hasValue(durableRaw) ? toNum(durableRaw) : 0;
    return {
      gross,
      earnings,
      invoicingFee,
      durableHostingFee,
      totalProviderFees,
      feeSource: "provider_fee_total"
    };
  }

  if (hasValue(invoicingRaw) || hasValue(durableRaw)) {
    const invoicingFee = toNum(invoicingRaw);
    const durableHostingFee = toNum(durableRaw);
    const totalProviderFees = Math.max(0, invoicingFee + durableHostingFee);
    return {
      gross,
      earnings,
      invoicingFee,
      durableHostingFee,
      totalProviderFees,
      feeSource: "provider_fee_components"
    };
  }

  const totalProviderFees = Math.max(0, gross - earnings);
  return {
    gross,
    earnings,
    invoicingFee: totalProviderFees,
    durableHostingFee: 0,
    totalProviderFees,
    feeSource: "gross_minus_earnings"
  };
}

type ByContentRow = {
  contentId: string;
  contentTitle: string;
  roleLabel: string;
  shareLabel: string;
  gross: number;
  earnings: number;
  invoicingFee: number;
  durableHostingFee: number;
  totalProviderFees: number;
  paid: number;
  pending: number;
  lastRecognizedAt: string;
  latestStatus: PayoutState;
  feeSource: "provider_fee_total" | "provider_fee_components" | "gross_minus_earnings";
};

type ContentView =
  | "performance"
  | "top_earners"
  | "momentum"
  | "by_role"
  | "payout_state"
  | "cashflow_risk"
  | "settlement_reliability"
  | "fee_efficiency"
  | "realization"
  | "concentration"
  | "freshness"
  | "momentum_delta";
type RoleViewFilter = "owner" | "collaborator";
type PayoutBucket = "paid" | "pending" | "mixed";

function parseSharePercent(raw: string | null | undefined): number {
  const s = String(raw || "").trim().replace("%", "");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function computeRowShareSats(rowNetSats: number, shareLabel: string): number {
  const pct = parseSharePercent(shareLabel);
  if (!Number.isFinite(pct) || pct <= 0) return rowNetSats;
  const boundedPct = Math.min(100, Math.max(0, pct));
  return Math.round(rowNetSats * (boundedPct / 100));
}

function classifyRoleBucket(row: ByContentRow): RoleViewFilter {
  const role = String(row.roleLabel || "").trim().toLowerCase();
  const sharePct = parseSharePercent(row.shareLabel);
  if (role === "owner" || (Number.isFinite(sharePct) && sharePct >= 99.999)) return "owner";
  return "collaborator";
}

function payoutBucketForRow(row: ByContentRow): PayoutBucket {
  if (row.paid > 0 && row.pending > 0) return "mixed";
  if (row.pending > 0) return "pending";
  return "paid";
}

function ratio(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return part / total;
}

export default function EarningsV2Page({
  refreshSignal,
  hasInvoiceCommerce = false,
  onOpenEarningsForContent: _onOpenEarningsForContent
}: EarningsV2PageProps) {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [payoutItems, setPayoutItems] = useState<FinancePayoutItem[]>([]);
  const [roleByContent, setRoleByContent] = useState<Record<string, string>>({});
  const [shareByContent, setShareByContent] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scopedContentId, setScopedContentId] = useState<string | null>(null);
  const [contentView, setContentView] = useState<ContentView>("performance");
  const [timeBasis, setTimeBasis] = useState<TimeBasis>("earned");
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("all");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const salesRes = await api<SaleRow[]>("/api/revenue/sales", "GET");
        if (!active) return;
        setSales(Array.isArray(salesRes) ? salesRes : []);
      } catch (e: any) {
        if (!active) return;
        setError(e?.message || "Failed to load earnings.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshSignal]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api<{ items?: FinancePayoutItem[] }>(
          `/finance/payouts?basis=earned&period=${encodeURIComponent(timePeriod)}`
        );
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
  }, [refreshSignal, timePeriod]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api<RoyaltiesContextResponse>("/my/royalties", "GET");
        if (!active) return;
        const works = Array.isArray(res?.works) ? res.works : [];
        const roleMap: Record<string, string> = {};
        const shareMap: Record<string, string> = {};
        for (const work of works) {
          const contentId = String(work?.contentId || "").trim();
          if (!contentId) continue;
          const roleLabel = normalizeRoleLabel(work?.myRole);
          if (roleLabel) roleMap[contentId] = roleLabel;

          const bps = Number(work?.myBps ?? NaN);
          if (Number.isFinite(bps) && bps > 0) {
            shareMap[contentId] = `${(bps / 100).toFixed(2)}%`;
            continue;
          }
          const pct = Number(work?.myPercent ?? NaN);
          if (Number.isFinite(pct) && pct > 0) {
            shareMap[contentId] = `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
          }
        }
        setRoleByContent(roleMap);
        setShareByContent(shareMap);
      } catch {
        if (!active) return;
        setRoleByContent({});
        setShareByContent({});
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshSignal]);

  const scopedSales = useMemo(() => {
    if (timePeriod === "all") return sales;
    return sales.filter((row) => isWithinPeriod(row.recognizedAt, timePeriod));
  }, [sales, timePeriod]);

  const summary = useMemo(() => {
    return scopedSales.reduce(
      (acc, row) => {
        const fees = feeBreakdownForRow(row);
        acc.gross += fees.gross;
        acc.earnings += fees.earnings;
        acc.fees += Math.max(0, fees.totalProviderFees);
        const payoutState = normalizePayoutState(row.payoutStatus);
        if (payoutState === "paid") acc.paidOut += fees.earnings;
        if (payoutState === "pending" || payoutState === "forwarding") acc.pending += fees.earnings;
        return acc;
      },
      { gross: 0, earnings: 0, fees: 0, paidOut: 0, pending: 0 }
    );
  }, [scopedSales]);

  const byContent = useMemo<ByContentRow[]>(() => {
    const payoutByContent = new Map<string, { earnings: number; paid: number; pending: number; failed: number }>();
    for (const payout of payoutItems) {
      const contentId = String(payout.contentId || "").trim();
      if (!contentId) continue;
      const amount = toNum(payout.netAmountSats ?? payout.amountSats);
      const status = normalizePayoutState(payout.status as SaleRow["payoutStatus"]);
      const existing = payoutByContent.get(contentId) || { earnings: 0, paid: 0, pending: 0, failed: 0 };
      existing.earnings += amount;
      if (status === "paid") existing.paid += amount;
      else if (status === "pending" || status === "forwarding") existing.pending += amount;
      else if (status === "failed") existing.failed += amount;
      payoutByContent.set(contentId, existing);
    }

    const map = new Map<string, ByContentRow>();
    const stateMap = new Map<string, PayoutState[]>();
    for (const row of scopedSales) {
      const contentId = row.contentId;
      const fees = feeBreakdownForRow(row);
      const existing = map.get(contentId) || {
        contentId,
        contentTitle: row.content?.title || "Untitled",
        roleLabel: roleByContent[contentId] || "Participant",
        shareLabel: shareByContent[contentId] || "—",
        gross: 0,
        earnings: 0,
        invoicingFee: 0,
        durableHostingFee: 0,
        totalProviderFees: 0,
        paid: 0,
        pending: 0,
        lastRecognizedAt: "",
        latestStatus: "unknown" as PayoutState,
        feeSource: fees.feeSource
      };
      existing.gross += fees.gross;
      existing.earnings += fees.earnings;
      existing.invoicingFee += fees.invoicingFee;
      existing.durableHostingFee += fees.durableHostingFee;
      existing.totalProviderFees += fees.totalProviderFees;
      const payoutState = normalizePayoutState(row.payoutStatus);
      if (payoutState === "paid") existing.paid += fees.earnings;
      if (payoutState === "pending" || payoutState === "forwarding") existing.pending += fees.earnings;
      if (!existing.lastRecognizedAt || String(row.recognizedAt || "") > existing.lastRecognizedAt) {
        existing.lastRecognizedAt = String(row.recognizedAt || "");
      }
      const states = stateMap.get(contentId) || [];
      states.push(payoutState);
      stateMap.set(contentId, states);
      map.set(contentId, existing);
    }
    const rows = Array.from(map.values());
    for (const row of rows) {
      const payoutSummary = payoutByContent.get(row.contentId);
      if (payoutSummary) {
        row.earnings = payoutSummary.earnings;
        row.paid = payoutSummary.paid;
        row.pending = payoutSummary.pending;
        row.latestStatus =
          payoutSummary.pending > 0 && payoutSummary.paid > 0
            ? "forwarding"
            : payoutSummary.pending > 0
              ? "pending"
              : payoutSummary.paid > 0
                ? "paid"
                : payoutSummary.failed > 0
                  ? "failed"
                  : "unknown";
      } else {
        row.latestStatus = summarizePayoutState(stateMap.get(row.contentId) || []);
      }
    }
    return rows.sort((a, b) => b.gross - a.gross);
  }, [scopedSales, roleByContent, shareByContent, payoutItems]);

  const momentumByContent = useMemo(() => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const map = new Map<
      string,
      { recent7: number; previous7: number; recent30: number; paidRecent30: number; pendingRecent30: number }
    >();
    let hasTimestampSignal = false;
    let hasRecentSignal = false;
    for (const row of scopedSales) {
      const contentId = String(row.contentId || "").trim();
      if (!contentId) continue;
      const ts = new Date(row.recognizedAt).getTime();
      if (!Number.isFinite(ts)) continue;
      hasTimestampSignal = true;
      const age = now - ts;
      const fees = feeBreakdownForRow(row);
      const payoutState = normalizePayoutState(row.payoutStatus);
      const current = map.get(contentId) || {
        recent7: 0,
        previous7: 0,
        recent30: 0,
        paidRecent30: 0,
        pendingRecent30: 0
      };
      if (age <= sevenDaysMs) current.recent7 += fees.earnings;
      else if (age <= sevenDaysMs * 2) current.previous7 += fees.earnings;
      if (age <= thirtyDaysMs) {
        current.recent30 += fees.earnings;
        if (payoutState === "paid") current.paidRecent30 += fees.earnings;
        if (payoutState === "pending" || payoutState === "forwarding") current.pendingRecent30 += fees.earnings;
        if (fees.earnings > 0) hasRecentSignal = true;
      }
      map.set(contentId, current);
    }
    return { map, hasTimestampSignal, hasRecentSignal };
  }, [scopedSales]);

  const byContentRows = useMemo(() => {
    const rows = [...byContent];
    if (contentView === "performance") {
      return rows.sort((a, b) => b.gross - a.gross);
    }
    if (contentView === "top_earners") {
      return rows.sort((a, b) => b.earnings - a.earnings || b.gross - a.gross);
    }
    if (contentView === "momentum") {
      return rows.sort((a, b) => {
        const ma = momentumByContent.map.get(a.contentId) || {
          recent7: 0,
          previous7: 0,
          recent30: 0,
          paidRecent30: 0,
          pendingRecent30: 0
        };
        const mb = momentumByContent.map.get(b.contentId) || {
          recent7: 0,
          previous7: 0,
          recent30: 0,
          paidRecent30: 0,
          pendingRecent30: 0
        };
        return (
          mb.recent7 - ma.recent7 ||
          mb.recent30 - ma.recent30 ||
          mb.pendingRecent30 - ma.pendingRecent30 ||
          mb.paidRecent30 - ma.paidRecent30 ||
          b.pending - a.pending ||
          b.paid - a.paid ||
          b.earnings - a.earnings
        );
      });
    }
    if (contentView === "by_role") {
      return rows.sort((a, b) => b.earnings - a.earnings || b.gross - a.gross);
    }
    if (contentView === "payout_state") {
      const order: Record<PayoutBucket, number> = { mixed: 3, pending: 2, paid: 1 };
      return rows.sort((a, b) => {
        const ba = payoutBucketForRow(a);
        const bb = payoutBucketForRow(b);
        return order[bb] - order[ba] || b.pending - a.pending || b.paid - a.paid || b.earnings - a.earnings;
      });
    }
    if (contentView === "cashflow_risk") {
      return rows.sort((a, b) => {
        const ra = ratio(a.pending, a.earnings);
        const rb = ratio(b.pending, b.earnings);
        return rb - ra || b.pending - a.pending || b.earnings - a.earnings;
      });
    }
    if (contentView === "settlement_reliability") {
      const statusPenalty = (status: PayoutState) => {
        if (status === "paid") return 0;
        if (status === "forwarding") return 0.15;
        if (status === "pending") return 0.3;
        if (status === "failed") return 0.8;
        return 1;
      };
      return rows.sort((a, b) => {
        const sa = ratio(a.paid, a.earnings) - ratio(a.pending, a.earnings) * 0.5 - statusPenalty(a.latestStatus);
        const sb = ratio(b.paid, b.earnings) - ratio(b.pending, b.earnings) * 0.5 - statusPenalty(b.latestStatus);
        return sb - sa || b.paid - a.paid || a.pending - b.pending;
      });
    }
    if (contentView === "fee_efficiency") {
      return rows.sort((a, b) => {
        const fa = ratio(a.totalProviderFees, a.gross);
        const fb = ratio(b.totalProviderFees, b.gross);
        return fb - fa || b.totalProviderFees - a.totalProviderFees || b.gross - a.gross;
      });
    }
    if (contentView === "realization") {
      return rows.sort((a, b) => {
        const ra = ratio(a.paid, a.earnings);
        const rb = ratio(b.paid, b.earnings);
        return rb - ra || b.paid - a.paid || b.earnings - a.earnings;
      });
    }
    if (contentView === "concentration") {
      return rows.sort((a, b) => b.earnings - a.earnings || b.gross - a.gross);
    }
    if (contentView === "freshness") {
      return rows.sort((a, b) => String(b.lastRecognizedAt || "").localeCompare(String(a.lastRecognizedAt || "")));
    }
    if (contentView === "momentum_delta") {
      return rows.sort((a, b) => {
        const ma = momentumByContent.map.get(a.contentId) || {
          recent7: 0,
          previous7: 0,
          recent30: 0,
          paidRecent30: 0,
          pendingRecent30: 0
        };
        const mb = momentumByContent.map.get(b.contentId) || {
          recent7: 0,
          previous7: 0,
          recent30: 0,
          paidRecent30: 0,
          pendingRecent30: 0
        };
        const da = ma.recent7 - ma.previous7;
        const db = mb.recent7 - mb.previous7;
        return db - da || mb.recent7 - ma.recent7 || b.pending - a.pending || b.earnings - a.earnings;
      });
    }
    return rows;
  }, [byContent, contentView, momentumByContent.map]);

  const scopedRow = useMemo(() => {
    if (!byContent.length) return null;
    if (scopedContentId) {
      const match = byContent.find((row) => row.contentId === scopedContentId);
      if (match) return match;
    }
    return byContent[0];
  }, [byContent, scopedContentId]);

  const scopedSalesRows = useMemo(() => {
    if (!scopedRow) return [];
    return scopedSales
      .filter((row) => row.contentId === scopedRow.contentId)
      .sort((a, b) => String(b.recognizedAt).localeCompare(String(a.recognizedAt)));
  }, [scopedSales, scopedRow]);

  const scopedPayoutByIntent = useMemo(() => {
    const map = new Map<string, { netAmount: number; status: PayoutState }>();
    if (!scopedRow) return map;
    const statuses = new Map<string, PayoutState[]>();
    const amounts = new Map<string, number>();
    for (const payout of payoutItems) {
      const contentId = String(payout.contentId || "").trim();
      const intentId = String(payout.paymentIntentId || "").trim();
      if (!intentId || contentId !== scopedRow.contentId) continue;
      const status = normalizePayoutState(payout.status as SaleRow["payoutStatus"]);
      const amount = toNum(payout.netAmountSats ?? payout.amountSats);
      statuses.set(intentId, [...(statuses.get(intentId) || []), status]);
      amounts.set(intentId, (amounts.get(intentId) || 0) + amount);
    }
    for (const [intentId, list] of statuses.entries()) {
      map.set(intentId, {
        netAmount: amounts.get(intentId) || 0,
        status: summarizePayoutState(list)
      });
    }
    return map;
  }, [payoutItems, scopedRow]);

  useEffect(() => {
    if (!byContent.length) {
      setScopedContentId(null);
      return;
    }
    if (!scopedContentId || !byContent.some((row) => row.contentId === scopedContentId)) {
      setScopedContentId(byContent[0].contentId);
    }
  }, [byContent, scopedContentId]);

  useEffect(() => {
    if (contentView !== "momentum" && contentView !== "momentum_delta") return;
    if (momentumByContent.hasRecentSignal) return;
    setContentView("performance");
  }, [contentView, momentumByContent.hasRecentSignal]);

  const viewDescription = useMemo(() => {
    if (contentView === "performance") return "Standard performance view by gross sales.";
    if (contentView === "top_earners") return "Sorted by your share (highest to lowest).";
    if (contentView === "momentum") {
      return momentumByContent.hasRecentSignal
        ? "Sorted by recent earnings activity (7d, then 30d)."
        : "Recent earnings signals unavailable.";
    }
    if (contentView === "momentum_delta") {
      return "Sorted by 7-day trend delta versus the previous 7 days.";
    }
    if (contentView === "by_role") {
      return "Grouped by role: Owner and Collaborator.";
    }
    if (contentView === "cashflow_risk") {
      return "Sorted by pending risk (pending ratio and pending amount).";
    }
    if (contentView === "settlement_reliability") {
      return "Sorted by payout reliability (paid realization, pending drag, and status quality).";
    }
    if (contentView === "fee_efficiency") {
      return "Sorted by fee burden (provider fees vs gross).";
    }
    if (contentView === "realization") {
      return "Sorted by realization (paid as a share of your earnings).";
    }
    if (contentView === "concentration") {
      return "Sorted by earnings concentration contribution.";
    }
    if (contentView === "freshness") {
      return "Sorted by most recently active content.";
    }
    return "Grouped by payout state signal (mixed, pending, paid).";
  }, [contentView, momentumByContent.hasRecentSignal]);

  const totalEarningsAll = useMemo(() => byContent.reduce((acc, row) => acc + row.earnings, 0), [byContent]);

  const contentInsightLabel = (row: ByContentRow, index: number) => {
    if (contentView === "top_earners") return `#${index + 1}`;
    if (contentView === "cashflow_risk") {
      const pendingRatio = ratio(row.pending, row.earnings) * 100;
      return `Risk ${pendingRatio.toFixed(0)}% pending`;
    }
    if (contentView === "settlement_reliability") {
      const realizationPct = ratio(row.paid, row.earnings) * 100;
      return `Realized ${realizationPct.toFixed(0)}%`;
    }
    if (contentView === "fee_efficiency") {
      const feeRate = ratio(row.totalProviderFees, row.gross) * 100;
      return `Fee load ${feeRate.toFixed(1)}%`;
    }
    if (contentView === "realization") {
      const realizationPct = ratio(row.paid, row.earnings) * 100;
      return `Paid ${realizationPct.toFixed(0)}%`;
    }
    if (contentView === "concentration") {
      const contribution = ratio(row.earnings, totalEarningsAll) * 100;
      return `${contribution.toFixed(1)}% of your earnings`;
    }
    if (contentView === "freshness") {
      const ts = new Date(row.lastRecognizedAt).getTime();
      if (!Number.isFinite(ts)) return "No activity timestamp";
      const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
      if (days <= 7) return "Hot";
      if (days <= 30) return "Warm";
      return "Cold";
    }
    if (contentView === "momentum_delta") {
      const m = momentumByContent.map.get(row.contentId) || {
        recent7: 0,
        previous7: 0,
        recent30: 0,
        paidRecent30: 0,
        pendingRecent30: 0
      };
      const delta = m.recent7 - m.previous7;
      if (delta > 0) return "↑";
      if (delta < 0) return "↓";
      return "→";
    }
    return "";
  };

  if (loading) return <div className="text-sm text-neutral-400">Loading earnings…</div>;

  if (error) {
    return (
      <div className="rounded-lg border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
        Earnings failed to load. {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Content Performance</div>
        <div className="text-sm text-neutral-400 mt-1">
          This shows how each work you participate in performed, fee impact, and net payout outcome.
        </div>
        <div className="text-xs text-neutral-500 mt-2">
          Based on your participation and share (see Royalties).
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          Where relationships go, money flows: these earnings come from works you own or collaborate on.
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Buyer Gross</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(summary.gross)}</div>
          <div className="text-xs text-neutral-500 mt-1">Seller-of-record gross total</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Fees Withheld</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(summary.fees)}</div>
          <div className="text-xs text-neutral-500 mt-1">Explicit provider/settlement fee deductions.</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Net Earned</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(summary.earnings)}</div>
          <div className="text-xs text-neutral-500 mt-1">
            {hasInvoiceCommerce ? "Net after active provider fees" : "Net creator earnings in current posture"}
          </div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Net Paid</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(summary.paidOut)}</div>
          <div className="text-xs text-neutral-500 mt-1">Based on earnings rows marked paid in existing payout truth.</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Net Payable</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(summary.pending)}</div>
          <div className="text-xs text-neutral-500 mt-1">Earnings rows not yet marked paid (pending/forwarding).</div>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="text-base font-semibold">Performance by Content</div>
        <div className="text-sm text-neutral-400 mt-1">Content sales context, your share outcome, and payout status by title.</div>
        <div className="text-xs text-neutral-500 mt-1">
          Work performance here links to detailed money rows in Earnings.
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          Role/share context is shown from existing Royalties context when available.
        </div>
        <div className="mt-3">
          <TimeScopeControls
            basis={timeBasis}
            onBasisChange={setTimeBasis}
            period={timePeriod}
            onPeriodChange={setTimePeriod}
            basisOptions={["earned"]}
            periodOptions={["1d", "7d", "30d", "90d", "all"]}
            helperText="Earnings are scoped by earned time using recognized timestamps from existing earnings source rows."
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-500">View:</span>
          {[
            ["performance", "Performance"],
            ["top_earners", "Top Earners"],
            ...(momentumByContent.hasRecentSignal
              ? ([
                  ["momentum", "Momentum"],
                  ["momentum_delta", "Momentum Delta"]
                ] as const)
              : []),
            ["by_role", "By Role"],
            ["payout_state", "Payout State"],
            ["cashflow_risk", "Cashflow Risk"],
            ["settlement_reliability", "Settlement Reliability"],
            ["fee_efficiency", "Fee Efficiency"],
            ["realization", "Realization"],
            ["concentration", "Concentration"],
            ["freshness", "Freshness"]
          ].map(([key, label]) => {
            const active = contentView === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setContentView(key as ContentView)}
                className={[
                  "rounded-full border px-3 py-1 text-xs transition",
                  active ? "border-white/40 bg-white/10 text-white" : "border-neutral-800 text-neutral-300 hover:bg-neutral-900"
                ].join(" ")}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="mt-2 text-xs text-neutral-500">{viewDescription}</div>
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-neutral-400">
                  <tr>
                    <th className="text-left font-medium py-2">Content</th>
                    <th className="text-left font-medium py-2">Role</th>
                    <th className="text-left font-medium py-2">Share</th>
                    <th className="text-left font-medium py-2">Gross Sales</th>
                    <th className="text-left font-medium py-2">Net Earned</th>
                    <th className="text-left font-medium py-2">Payout State</th>
                    <th className="text-left font-medium py-2">Paid</th>
                    <th className="text-left font-medium py-2">Pending</th>
                    <th className="text-left font-medium py-2">Scope</th>
                  </tr>
                </thead>
                <tbody>
                  {byContentRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-3 text-neutral-500">
                        {sales.length === 0 ? "No earnings rows yet." : "No earnings rows in the selected period."}
                      </td>
                    </tr>
                  ) : contentView === "payout_state" ? (
                    (["mixed", "pending", "paid"] as PayoutBucket[]).map((bucket) => {
                      const bucketRows = byContentRows.filter((row) => payoutBucketForRow(row) === bucket);
                      if (!bucketRows.length) return null;
                      return (
                        <Fragment key={`bucket-${bucket}`}>
                          <tr className="border-t border-neutral-800 bg-neutral-900/30">
                            <td colSpan={8} className="py-2 text-xs uppercase tracking-wide text-neutral-400">
                              {bucket === "mixed" ? "Mixed" : bucket === "pending" ? "Pending" : "Paid"}
                            </td>
                          </tr>
                          {bucketRows.map((row) => (
                            <tr
                              key={row.contentId}
                              className={`border-t border-neutral-900 cursor-pointer ${scopedRow?.contentId === row.contentId ? "bg-neutral-900/40" : "hover:bg-neutral-900/30"}`}
                              onClick={() => setScopedContentId(row.contentId)}
                            >
                              <td className="py-2 text-neutral-200">{row.contentTitle}</td>
                              <td className="py-2 text-neutral-300">{row.roleLabel}</td>
                              <td className="py-2 text-neutral-300">{row.shareLabel}</td>
                              <td className="py-2">{formatSats(row.gross)}</td>
                              <td className="py-2">{formatSats(row.earnings)}</td>
                              <td className="py-2 text-neutral-300 capitalize">{row.latestStatus}</td>
                              <td className="py-2 text-emerald-300">{formatSats(row.paid)}</td>
                              <td className="py-2 text-amber-300">{formatSats(row.pending)}</td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })
                  ) : contentView === "by_role" ? (
                    (["owner", "collaborator"] as RoleViewFilter[]).map((roleBucket) => {
                      const roleRows = byContentRows.filter((row) => classifyRoleBucket(row) === roleBucket);
                      if (!roleRows.length) return null;
                      return (
                        <Fragment key={`role-${roleBucket}`}>
                          <tr className="border-t border-neutral-800 bg-neutral-900/30">
                            <td colSpan={8} className="py-2 text-xs uppercase tracking-wide text-neutral-400">
                              {roleBucket === "owner" ? "Owner" : "Collaborator"}
                            </td>
                          </tr>
                          {roleRows.map((row) => (
                            <tr
                              key={row.contentId}
                              className={`border-t border-neutral-900 cursor-pointer ${scopedRow?.contentId === row.contentId ? "bg-neutral-900/40" : "hover:bg-neutral-900/30"}`}
                              onClick={() => setScopedContentId(row.contentId)}
                            >
                              <td className="py-2 text-neutral-200">{row.contentTitle}</td>
                              <td className="py-2 text-neutral-300">{row.roleLabel}</td>
                              <td className="py-2 text-neutral-300">{row.shareLabel}</td>
                              <td className="py-2">{formatSats(row.gross)}</td>
                              <td className="py-2">{formatSats(row.earnings)}</td>
                              <td className="py-2 text-neutral-300 capitalize">{row.latestStatus}</td>
                              <td className="py-2 text-emerald-300">{formatSats(row.paid)}</td>
                              <td className="py-2 text-amber-300">{formatSats(row.pending)}</td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })
                  ) : (
                    byContentRows.map((row, index) => (
                      <tr
                        key={row.contentId}
                        className={[
                          "border-t border-neutral-900 cursor-pointer",
                          scopedRow?.contentId === row.contentId ? "bg-neutral-900/40" : "",
                          scopedRow?.contentId === row.contentId ? "" : "hover:bg-neutral-900/30",
                          contentView === "top_earners" ? "text-[13px]" : ""
                        ].join(" ")}
                        onClick={() => setScopedContentId(row.contentId)}
                      >
                        <td className={contentView === "top_earners" ? "py-1.5 text-neutral-200" : "py-2 text-neutral-200"}>
                          <div className="flex items-center gap-2">
                            {(contentView === "top_earners" || contentView === "momentum_delta") && contentInsightLabel(row, index) ? (
                              <span className="text-[11px] text-neutral-500">{contentInsightLabel(row, index)}</span>
                            ) : null}
                            <span>{row.contentTitle}</span>
                          </div>
                          {[
                            "cashflow_risk",
                            "settlement_reliability",
                            "fee_efficiency",
                            "realization",
                            "concentration",
                            "freshness"
                          ].includes(contentView) ? (
                            <div className="text-[11px] text-neutral-500 mt-0.5">{contentInsightLabel(row, index)}</div>
                          ) : null}
                        </td>
                        <td className={contentView === "top_earners" ? "py-1.5 text-neutral-300" : "py-2 text-neutral-300"}>{row.roleLabel}</td>
                        <td className={contentView === "top_earners" ? "py-1.5 text-neutral-300" : "py-2 text-neutral-300"}>{row.shareLabel}</td>
                        <td className={contentView === "top_earners" ? "py-1.5" : "py-2"}>{formatSats(row.gross)}</td>
                        <td className={contentView === "top_earners" ? "py-1.5" : "py-2"}>{formatSats(row.earnings)}</td>
                        <td className={contentView === "top_earners" ? "py-1.5 text-neutral-300 capitalize" : "py-2 text-neutral-300 capitalize"}>{row.latestStatus}</td>
                        <td className={contentView === "top_earners" ? "py-1.5 text-emerald-300" : "py-2 text-emerald-300"}>{formatSats(row.paid)}</td>
                        <td className={contentView === "top_earners" ? "py-1.5 text-amber-300" : "py-2 text-amber-300"}>{formatSats(row.pending)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 lg:hidden">
              {scopedRow ? (
                <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
                  <div className="text-base font-semibold">Scoped content details</div>
                  <div className="text-xs text-neutral-500">Earnings and transaction detail for the currently scoped content row.</div>
                  <div className="rounded-lg border border-neutral-800 bg-neutral-900/20 p-3">
                    <div className="text-sm font-medium">Content summary</div>
                    <div className="text-sm text-neutral-300 mt-2">{scopedRow.contentTitle}</div>
                    <div className="text-xs text-neutral-400 mt-1">Buyer paid: {formatSats(scopedRow.gross)}</div>
                    <div className="text-xs text-neutral-400">Net earned: {formatSats(scopedRow.earnings)}</div>
                    <div className="text-xs text-neutral-400">Paid: {formatSats(scopedRow.paid)} · Pending: {formatSats(scopedRow.pending)}</div>
                    <div className="text-xs text-neutral-400">Payout state: {scopedRow.latestStatus}</div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="hidden lg:block">
            {scopedRow ? (
              <div className="sticky top-24 rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
                <div className="text-base font-semibold">Scoped content details</div>
                <div className="text-xs text-neutral-500">Earnings and transaction detail for the currently scoped content row.</div>

                <div className="rounded-lg border border-neutral-800 bg-neutral-900/20 p-3">
                  <div className="text-sm font-medium">Content summary</div>
                  <div className="text-sm text-neutral-300 mt-2">{scopedRow.contentTitle}</div>
                  <div className="text-xs text-neutral-400 mt-1">Buyer paid: {formatSats(scopedRow.gross)}</div>
                  <div className="text-xs text-neutral-400">Net earned: {formatSats(scopedRow.earnings)}</div>
                  <div className="text-xs text-neutral-400">Paid: {formatSats(scopedRow.paid)} · Pending: {formatSats(scopedRow.pending)}</div>
                  <div className="text-xs text-neutral-400">Payout state: {scopedRow.latestStatus}</div>
                  <div className="text-xs text-neutral-500 mt-2">Transactions contributing to this content’s earnings are shown below.</div>
                </div>

                <div className="rounded-lg border border-neutral-800 bg-neutral-900/20 p-3">
                  <div className="text-sm font-medium">Transaction proof rows</div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Content-level view. Payout execution destination/reference details are in the Payouts tab.
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead className="text-neutral-400">
                        <tr>
                          <th className="text-left font-medium py-2">Time</th>
                          <th className="text-left font-medium py-2">Buyer paid</th>
                          <th className="text-left font-medium py-2">Your share (split)</th>
                          <th className="text-left font-medium py-2">Payout state</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scopedSalesRows.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-3 text-neutral-500">
                              No contributing sales rows found for this content.
                            </td>
                          </tr>
                        ) : (
                          scopedSalesRows.map((row) => {
                            const fees = feeBreakdownForRow(row);
                            const payoutTruth = scopedPayoutByIntent.get(String(row.intentId || "").trim());
                            const payoutState = payoutTruth?.status || normalizePayoutState(row.payoutStatus);
                            const yourShareSats =
                              payoutTruth?.netAmount ??
                              (scopedRow ? computeRowShareSats(fees.earnings, scopedRow.shareLabel) : fees.earnings);
                            return (
                              <tr key={row.id} className="border-t border-neutral-900">
                                <td className="py-2 text-neutral-400">{new Date(row.recognizedAt).toLocaleString()}</td>
                                <td className="py-2">{formatSats(fees.gross)}</td>
                                <td className="py-2">{formatSats(yourShareSats)}</td>
                                <td className="py-2 capitalize">{payoutState}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-lg border border-neutral-800 bg-neutral-900/20 p-3">
                  <div className="text-sm font-medium">Split context</div>
                  <div className="text-xs text-neutral-400 mt-2">
                    Participant-level identities/shares remain available in split terms and provider settlement detail views.
                  </div>
                  <a
                    href={`/content/${encodeURIComponent(scopedRow.contentId)}/splits`}
                    className="mt-2 inline-flex rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900"
                  >
                    Open split editor
                  </a>
                </div>

                <div className="rounded-lg border border-neutral-800 bg-neutral-900/20 p-3">
                  <div className="text-sm font-medium">Advanced execution details</div>
                  <div className="text-xs text-neutral-500 mt-2">
                    BOLT11, payout references, node transport details, and diagnostics remain in existing ledger/provider views.
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
