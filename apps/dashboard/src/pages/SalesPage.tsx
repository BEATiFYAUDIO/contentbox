import { useEffect, useMemo, useState } from "react";
import AuditPanel from "../components/AuditPanel";
import { api } from "../lib/api";

type SalesOverview = {
  totals: {
    salesSats: string;
    salesSatsLast30d: string;
    invoicesTotal: number;
    invoicesPaid: number;
    invoicesPending: number;
    invoicesFailed: number;
    invoicesExpired: number;
    paymentsReceivedSats: string;
    paymentsPendingSats: string;
    paymentsReceivedCount: number;
    paymentsPendingCount: number;
    paymentsLast30d: number;
  };
  recentSales: Array<{
    id: string;
    contentId: string;
    contentTitle: string;
    amountSats: string;
    status: string;
    createdAt: string;
    paidAt: string | null;
    paidVia: string | null;
    paymentIntentId: string | null;
  }>;
};

type RoyaltyRow = {
  contentId: string;
  title: string;
  totalRoyaltiesSats: string;
  yourShareSats: string;
  pendingRoyaltiesSats: string;
  earnedRoyaltiesSats: string;
};

type PayoutsResponse = {
  pending: Array<{
    id: string;
    amountSats: string;
    status: string;
    method: string | null;
    createdAt: string;
    completedAt: string | null;
    settlementRecords: any;
  }>;
  completed: Array<{
    id: string;
    amountSats: string;
    status: string;
    method: string | null;
    createdAt: string;
    completedAt: string | null;
    settlementRecords: any;
  }>;
  pendingTotalSats: string;
  completedTotalSats: string;
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

type SalesPageProps = {
  variant?: "full" | "ledger";
  refreshSignal?: number;
  titleOverride?: string;
};

export default function SalesPage({ variant = "full", refreshSignal, titleOverride }: SalesPageProps) {
  const [overview, setOverview] = useState<SalesOverview | null>(null);
  const [royalties, setRoyalties] = useState<RoyaltyRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutsResponse | null>(null);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const overviewPromise = api<SalesOverview>("/finance/overview");
        const promises: Array<Promise<any>> = [overviewPromise];
        if (variant === "full") {
          promises.push(
            api<{ items: RoyaltyRow[] }>("/finance/royalties"),
            api<{ items: any[]; totals: any }>("/finance/payouts"),
            api<{ items: TransactionRow[] }>("/finance/transactions")
          );
        }
        const results = await Promise.all(promises);
        const o = results[0] as SalesOverview;
        if (!active) return;
        setOverview(o);
        if (variant === "full") {
          const r = results[1] as { items: RoyaltyRow[] };
          const p = results[2] as { items: any[]; totals: { pendingSats: string; paidSats: string } };
          const t = results[3] as { items: TransactionRow[] };
          setRoyalties(r.items || []);
          setPayouts({
            pending: (p.items || []).filter((x: any) => x.status !== "completed"),
            completed: (p.items || []).filter((x: any) => x.status === "completed"),
            pendingTotalSats: p.totals?.pendingSats || "0",
            completedTotalSats: p.totals?.paidSats || "0"
          });
          setTransactions(t.items || []);
        } else {
          setRoyalties([]);
          setPayouts(null);
          setTransactions([]);
        }
      } catch (e: any) {
        if (!active) return;
        setError(e.message || "Failed to load finance data.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshTick, refreshSignal]);


  const formatSats = (raw: string | null | undefined) => {
    const n = Number(raw || 0);
    if (!Number.isFinite(n)) return "0 sats";
    return `${Math.round(n).toLocaleString()} sats`;
  };

  const recentSales = overview?.recentSales || [];
  const invoiceCounts = overview?.totals
    ? {
        paid: overview.totals.invoicesPaid,
        pending: overview.totals.invoicesPending,
        failed: overview.totals.invoicesFailed,
        expired: overview.totals.invoicesExpired,
      }
    : { paid: 0, pending: 0, failed: 0, expired: 0 };
  const paymentTotals = overview?.totals
    ? {
        receivedSats: overview.totals.paymentsReceivedSats,
        pendingSats: overview.totals.paymentsPendingSats,
        receivedCount: overview.totals.paymentsReceivedCount,
        pendingCount: overview.totals.paymentsPendingCount,
      }
    : {
        receivedSats: "0",
        pendingSats: "0",
        receivedCount: 0,
        pendingCount: 0,
      };

  const payoutPending = payouts?.pending || [];
  const payoutCompleted = payouts?.completed || [];
  const totalPendingPayout = payouts?.pendingTotalSats || "0";
  const totalCompletedPayout = payouts?.completedTotalSats || "0";

  const showRoyalties = variant === "full";
  const showPayouts = variant === "full";
  const showTransactions = variant === "full";

  const transactionRows = useMemo(() => {
    return transactions.map((t) => ({
      ...t,
      amountLabel: t.amountSats ? formatSats(t.amountSats) : "—",
      createdLabel: new Date(t.createdAt).toLocaleString(),
      title: t.contentTitle || "—",
      typeLabel: t.metadata?.eventType || t.kind,
    }));
  }, [transactions]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">{titleOverride || "Revenue Overview"}</div>
            <div className="text-sm text-neutral-400 mt-1">
              Track invoices, payments, royalties, and payouts in one place.
            </div>
          </div>
          <button
            onClick={() => setRefreshTick((t) => t + 1)}
            className="rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900"
          >
            Refresh now
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 flex items-center justify-between">
          <span>Couldn’t load revenue data. {error}</span>
          <button
            onClick={() => setRefreshTick((t) => t + 1)}
            className="rounded-lg border border-amber-700 px-2 py-1 text-xs hover:bg-amber-900/30"
          >
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-neutral-400">Loading finance data…</div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
              <div className="text-xs uppercase tracking-wide text-neutral-400">Total Sales</div>
              <div className="mt-2 text-2xl font-semibold">
                {formatSats(overview?.totals?.salesSats || "0")}
              </div>
              <div className="mt-1 text-xs text-neutral-500">All paid invoices</div>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
              <div className="text-xs uppercase tracking-wide text-neutral-400">Invoices</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div>Paid: <span className="text-neutral-200">{invoiceCounts.paid}</span></div>
                <div>Pending: <span className="text-neutral-200">{invoiceCounts.pending}</span></div>
                <div>Failed: <span className="text-neutral-200">{invoiceCounts.failed}</span></div>
                <div>Expired: <span className="text-neutral-200">{invoiceCounts.expired}</span></div>
              </div>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
              <div className="text-xs uppercase tracking-wide text-neutral-400">Payments</div>
              <div className="mt-2 text-sm text-neutral-200">
                Received: {formatSats(paymentTotals.receivedSats)} ({paymentTotals.receivedCount})
              </div>
              <div className="text-sm text-neutral-400">
                Pending: {formatSats(paymentTotals.pendingSats)} ({paymentTotals.pendingCount})
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="text-base font-semibold">Recent Sales</div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-neutral-400">
                  <tr>
                    <th className="text-left font-medium py-2">Content</th>
                    <th className="text-left font-medium py-2">Amount</th>
                    <th className="text-left font-medium py-2">Status</th>
                    <th className="text-left font-medium py-2">Invoice</th>
                    <th className="text-left font-medium py-2">Method</th>
                    <th className="text-left font-medium py-2">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-3 text-neutral-500">No sales yet.</td>
                    </tr>
                  ) : (
                    recentSales.map((s) => (
                      <tr key={s.id} className="border-t border-neutral-900">
                        <td className="py-2 text-neutral-200">{s.contentTitle}</td>
                        <td className="py-2">{formatSats(s.amountSats)}</td>
                        <td className="py-2 text-neutral-300">{s.status}</td>
                        <td className="py-2 text-neutral-300">
                          {s.paymentIntentId ? (
                            <button
                              onClick={() => navigator.clipboard?.writeText(s.paymentIntentId || "")}
                              className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                            >
                              Copy ID
                            </button>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 text-neutral-300">{s.paidVia || "—"}</td>
                        <td className="py-2 text-neutral-400">
                          {new Date(s.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {showRoyalties ? (
            <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
              <div className="text-base font-semibold">Royalties</div>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-neutral-400">
                    <tr>
                      <th className="text-left font-medium py-2">Content</th>
                      <th className="text-left font-medium py-2">Total Royalties</th>
                      <th className="text-left font-medium py-2">Your Share</th>
                      <th className="text-left font-medium py-2">Pending</th>
                      <th className="text-left font-medium py-2">Earned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {royalties.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-3 text-neutral-500">No royalties yet.</td>
                      </tr>
                    ) : (
                      royalties.map((r) => (
                        <tr key={r.contentId} className="border-t border-neutral-900">
                          <td className="py-2 text-neutral-200">{r.title}</td>
                          <td className="py-2">{formatSats(r.totalRoyaltiesSats)}</td>
                          <td className="py-2">{formatSats(r.yourShareSats)}</td>
                          <td className="py-2 text-neutral-300">{formatSats(r.pendingRoyaltiesSats)}</td>
                          <td className="py-2 text-neutral-300">{formatSats(r.earnedRoyaltiesSats)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {showPayouts ? (
            <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
              <div className="text-base font-semibold">Payouts</div>
              <div className="mt-2 text-sm text-neutral-300">
                Pending: {formatSats(totalPendingPayout)} · Completed: {formatSats(totalCompletedPayout)}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-3">
                  <div className="text-sm font-medium">Pending Payouts</div>
                  <div className="mt-2 space-y-2 text-sm">
                    {payoutPending.length === 0 ? (
                      <div className="text-neutral-500">No pending payouts.</div>
                    ) : (
                      payoutPending.map((p) => (
                        <div key={p.id} className="flex items-center justify-between text-neutral-200">
                          <span>{p.method || "manual"}</span>
                          <span>{formatSats(p.amountSats)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-3">
                  <div className="text-sm font-medium">Completed Payouts</div>
                  <div className="mt-2 space-y-2 text-sm">
                    {payoutCompleted.length === 0 ? (
                      <div className="text-neutral-500">No completed payouts.</div>
                    ) : (
                      payoutCompleted.map((p) => (
                        <div key={p.id} className="flex items-center justify-between text-neutral-200">
                          <span>{p.method || "manual"}</span>
                          <span>{formatSats(p.amountSats)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {showTransactions ? (
            <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
              <div className="text-base font-semibold">Transaction History</div>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-neutral-400">
                    <tr>
                      <th className="text-left font-medium py-2">Date</th>
                      <th className="text-left font-medium py-2">Type</th>
                      <th className="text-left font-medium py-2">Content</th>
                      <th className="text-left font-medium py-2">Amount</th>
                      <th className="text-left font-medium py-2">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactionRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-3 text-neutral-500">No transactions yet.</td>
                      </tr>
                    ) : (
                      transactionRows.map((t) => (
                        <tr key={t.id} className="border-t border-neutral-900">
                          <td className="py-2 text-neutral-400">{t.createdLabel}</td>
                          <td className="py-2 text-neutral-200">{t.typeLabel}</td>
                          <td className="py-2 text-neutral-200">{t.title}</td>
                          <td className="py-2">{t.amountLabel}</td>
                          <td className="py-2 text-neutral-400">
                            {t.metadata?.status || t.metadata?.rail || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}

      <AuditPanel scopeType="royalty" title="Audit" exportName="royalty-audit.json" />
    </div>
  );
}
