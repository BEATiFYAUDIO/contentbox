import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

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
  latestStatus: PayoutState;
  feeSource: "provider_fee_total" | "provider_fee_components" | "gross_minus_earnings";
};

export default function EarningsV2Page({
  refreshSignal,
  hasInvoiceCommerce = false,
  onOpenEarningsForContent
}: EarningsV2PageProps) {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [roleByContent, setRoleByContent] = useState<Record<string, string>>({});
  const [shareByContent, setShareByContent] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<ByContentRow | null>(null);

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

  const summary = useMemo(() => {
    return sales.reduce(
      (acc, row) => {
        const fees = feeBreakdownForRow(row);
        acc.gross += fees.gross;
        acc.earnings += fees.earnings;
        const payoutState = normalizePayoutState(row.payoutStatus);
        if (payoutState === "paid") acc.paidOut += fees.earnings;
        if (payoutState === "pending" || payoutState === "forwarding") acc.pending += fees.earnings;
        return acc;
      },
      { gross: 0, earnings: 0, paidOut: 0, pending: 0 }
    );
  }, [sales]);

  const byContent = useMemo<ByContentRow[]>(() => {
    const map = new Map<string, ByContentRow>();
    const stateMap = new Map<string, PayoutState[]>();
    for (const row of sales) {
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
      const states = stateMap.get(contentId) || [];
      states.push(payoutState);
      stateMap.set(contentId, states);
      map.set(contentId, existing);
    }
    const rows = Array.from(map.values());
    for (const row of rows) {
      row.latestStatus = summarizePayoutState(stateMap.get(row.contentId) || []);
    }
    return rows.sort((a, b) => b.gross - a.gross);
  }, [sales, roleByContent, shareByContent]);

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
          This shows how each work you participate in performed and what you earned from it.
        </div>
        <div className="text-xs text-neutral-500 mt-2">
          Based on your participation and share (see Royalties).
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          Where relationships go, money flows: these earnings come from works you own or collaborate on.
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Buyer Gross</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(summary.gross)}</div>
          <div className="text-xs text-neutral-500 mt-1">Seller-of-record gross total</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Your Share</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(summary.earnings)}</div>
          <div className="text-xs text-neutral-500 mt-1">
            {hasInvoiceCommerce ? "Net after active provider fees" : "Net creator earnings in current posture"}
          </div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Paid</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(summary.paidOut)}</div>
          <div className="text-xs text-neutral-500 mt-1">Based on earnings rows marked paid in existing payout truth.</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Pending</div>
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
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="text-left font-medium py-2">Content</th>
                <th className="text-left font-medium py-2">Role</th>
                <th className="text-left font-medium py-2">Share</th>
                <th className="text-left font-medium py-2">Gross Sales</th>
                <th className="text-left font-medium py-2">Your Share</th>
                <th className="text-left font-medium py-2">Payout State</th>
                <th className="text-left font-medium py-2">Paid</th>
                <th className="text-left font-medium py-2">Pending</th>
                <th className="text-left font-medium py-2">Earnings</th>
                <th className="text-left font-medium py-2">View Details</th>
              </tr>
            </thead>
            <tbody>
              {byContent.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-3 text-neutral-500">No earnings rows yet.</td>
                </tr>
              ) : (
                byContent.map((row) => (
                  <tr key={row.contentId} className="border-t border-neutral-900">
                    <td className="py-2 text-neutral-200">{row.contentTitle}</td>
                    <td className="py-2 text-neutral-300">{row.roleLabel}</td>
                    <td className="py-2 text-neutral-300">{row.shareLabel}</td>
                    <td className="py-2">{formatSats(row.gross)}</td>
                    <td className="py-2">{formatSats(row.earnings)}</td>
                    <td className="py-2 text-neutral-300 capitalize">{row.latestStatus}</td>
                    <td className="py-2 text-emerald-300">{formatSats(row.paid)}</td>
                    <td className="py-2 text-amber-300">{formatSats(row.pending)}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => onOpenEarningsForContent?.(row.contentId, row.contentTitle)}
                        className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        View earnings for this work
                      </button>
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => setDetailRow(row)}
                        className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        View details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {detailRow ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-base font-semibold">Content Earnings Detail</div>
            <button
              onClick={() => setDetailRow(null)}
              className="rounded-lg border border-neutral-800 px-3 py-1 text-xs hover:bg-neutral-900"
            >
              Close
            </button>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-900/20 p-3">
            <div className="text-sm font-medium">Content summary</div>
            <div className="text-sm text-neutral-300 mt-2">{detailRow.contentTitle}</div>
            <div className="text-xs text-neutral-400 mt-1">Buyer paid: {formatSats(detailRow.gross)}</div>
            <div className="text-xs text-neutral-400">Your earnings: {formatSats(detailRow.earnings)}</div>
            <div className="text-xs text-neutral-400">Paid: {formatSats(detailRow.paid)} · Pending: {formatSats(detailRow.pending)}</div>
            <div className="text-xs text-neutral-400">Payout state: {detailRow.latestStatus}</div>
            <div className="text-xs text-neutral-500 mt-2">
              Transactions contributing to this content’s earnings are shown below.
            </div>
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
                    <th className="text-left font-medium py-2">Your share</th>
                    <th className="text-left font-medium py-2">Payout state</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.filter((row) => row.contentId === detailRow.contentId).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-3 text-neutral-500">
                        No contributing sales rows found for this content.
                      </td>
                    </tr>
                  ) : (
                    sales
                      .filter((row) => row.contentId === detailRow.contentId)
                      .sort((a, b) => String(b.recognizedAt).localeCompare(String(a.recognizedAt)))
                      .map((row) => {
                        const fees = feeBreakdownForRow(row);
                        const payoutState = normalizePayoutState(row.payoutStatus);
                        return (
                          <tr key={row.id} className="border-t border-neutral-900">
                            <td className="py-2 text-neutral-400">{new Date(row.recognizedAt).toLocaleString()}</td>
                            <td className="py-2">{formatSats(fees.gross)}</td>
                            <td className="py-2">{formatSats(fees.earnings)}</td>
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
              href={`/royalties/${encodeURIComponent(detailRow.contentId)}`}
              className="mt-2 inline-flex rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900"
            >
              View locked split terms
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
  );
}
