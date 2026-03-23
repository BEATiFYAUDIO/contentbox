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

type TransactionRow = {
  id: string;
  kind: string;
  refId: string;
  contentId: string | null;
  contentTitle: string | null;
  amountSats: string | null;
  createdAt: string;
  metadata: any;
};

type EarningsV2PageProps = {
  refreshSignal?: number;
};

type PayoutState = "paid" | "forwarding" | "pending" | "failed" | "unknown";

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

export default function EarningsV2Page({ refreshSignal }: EarningsV2PageProps) {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<ByContentRow | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [salesRes, txRes] = await Promise.all([
          api<SaleRow[]>("/api/revenue/sales", "GET"),
          api<{ items: TransactionRow[] }>("/finance/transactions", "GET")
        ]);
        if (!active) return;
        setSales(Array.isArray(salesRes) ? salesRes : []);
        setTransactions(Array.isArray(txRes?.items) ? txRes.items : []);
      } catch (e: any) {
        if (!active) return;
        setError(e?.message || "Failed to load earnings v2.");
      } finally {
        if (active) setLoading(false);
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
  }, [sales]);

  const recentTransactions = useMemo(() => {
    return [...transactions]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 12);
  }, [transactions]);

  if (loading) return <div className="text-sm text-neutral-400">Loading earnings…</div>;

  if (error) {
    return (
      <div className="rounded-lg border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
        Earnings v2 failed to load. {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Earnings Overview</div>
        <div className="text-sm text-neutral-400 mt-1">
          Seller-of-record sales, your net earnings, payout progress, and recent commerce activity.
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Gross Sales</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(summary.gross)}</div>
          <div className="text-xs text-neutral-500 mt-1">Seller-of-record gross total</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Your Earnings</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(summary.earnings)}</div>
          <div className="text-xs text-neutral-500 mt-1">Net after active provider fees</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Paid Out</div>
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
        <div className="text-base font-semibold">Earnings by Content</div>
        <div className="text-sm text-neutral-400 mt-1">Gross, net earnings, remitted amount, and pending amount by content.</div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="text-left font-medium py-2">Content</th>
                <th className="text-left font-medium py-2">Gross Sales</th>
                <th className="text-left font-medium py-2">Your Earnings</th>
                <th className="text-left font-medium py-2">Payout State</th>
                <th className="text-left font-medium py-2">Paid</th>
                <th className="text-left font-medium py-2">Pending</th>
                <th className="text-left font-medium py-2">View Details</th>
              </tr>
            </thead>
            <tbody>
              {byContent.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-3 text-neutral-500">No earnings rows yet.</td>
                </tr>
              ) : (
                byContent.map((row) => (
                  <tr key={row.contentId} className="border-t border-neutral-900">
                    <td className="py-2 text-neutral-200">{row.contentTitle}</td>
                    <td className="py-2">{formatSats(row.gross)}</td>
                    <td className="py-2">{formatSats(row.earnings)}</td>
                    <td className="py-2 text-neutral-300 capitalize">{row.latestStatus}</td>
                    <td className="py-2 text-emerald-300">{formatSats(row.paid)}</td>
                    <td className="py-2 text-amber-300">{formatSats(row.pending)}</td>
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

      <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="text-base font-semibold">Recent Transactions</div>
        <div className="text-sm text-neutral-400 mt-1">Latest finance events from the transaction stream.</div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="text-left font-medium py-2">Time</th>
                <th className="text-left font-medium py-2">Content</th>
                <th className="text-left font-medium py-2">Amount</th>
                <th className="text-left font-medium py-2">Status</th>
                <th className="text-left font-medium py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {recentTransactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-3 text-neutral-500">No transactions yet.</td>
                </tr>
              ) : (
                recentTransactions.map((tx) => (
                  <tr key={tx.id} className="border-t border-neutral-900">
                    <td className="py-2 text-neutral-400">{new Date(tx.createdAt).toLocaleString()}</td>
                    <td className="py-2 text-neutral-200">{tx.contentTitle || "—"}</td>
                    <td className="py-2">{formatSats(tx.amountSats || 0)}</td>
                    <td className="py-2">{tx.metadata?.status || tx.metadata?.rail || tx.kind || "—"}</td>
                    <td className="py-2 text-xs text-neutral-400 font-mono">{tx.refId}</td>
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
            <div className="text-sm font-medium">Human summary</div>
            <div className="text-sm text-neutral-300 mt-2">{detailRow.contentTitle}</div>
            <div className="text-xs text-neutral-400 mt-1">Buyer paid: {formatSats(detailRow.gross)}</div>
            <div className="text-xs text-neutral-400">Your earnings: {formatSats(detailRow.earnings)}</div>
            <div className="text-xs text-neutral-400">Payout state: {detailRow.latestStatus}</div>
            <div className="text-xs text-neutral-500 mt-2">
              Content-level earnings summary. Exact payment-intent and settlement execution records remain in existing ledger/provider views.
            </div>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-900/20 p-3">
            <div className="text-sm font-medium">Financial flow</div>
            <div className="mt-2 text-xs text-neutral-300 space-y-1">
              <div>Buyer Paid: {formatSats(detailRow.gross)}</div>
              <div className="text-neutral-400 mt-1">Fees</div>
              <div>Invoicing Fee: {formatSats(detailRow.invoicingFee)}</div>
              <div>
                Durable Hosting Fee: {detailRow.durableHostingFee > 0 ? formatSats(detailRow.durableHostingFee) : "inactive"}
              </div>
              <div>Total Fees: {formatSats(detailRow.totalProviderFees)}</div>
              <div>Net to creators: {formatSats(detailRow.earnings)}</div>
              <div>Payouts completed: {formatSats(detailRow.paid)}</div>
              <div>Residual unpaid: {formatSats(Math.max(0, detailRow.earnings - detailRow.paid))}</div>
              {detailRow.feeSource === "gross_minus_earnings" ? (
                <div className="text-neutral-500">Provider fees inferred from gross minus net (explicit fee fields not present).</div>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-900/20 p-3">
            <div className="text-sm font-medium">Participants</div>
            <div className="text-xs text-neutral-400 mt-2">
              Participant-level identities/shares remain available in split terms and provider settlement detail views.
            </div>
            <a
              href={`/royalties/${encodeURIComponent(detailRow.contentId)}`}
              className="mt-2 inline-flex rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900"
            >
              View split terms
            </a>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-900/20 p-3">
            <div className="text-sm font-medium">Advanced execution details</div>
            <div className="text-xs text-neutral-500 mt-2">
              BOLT11, payout references, rails, and transport diagnostics remain in existing ledger/provider views.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
