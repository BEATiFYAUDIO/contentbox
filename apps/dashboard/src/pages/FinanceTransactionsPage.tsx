import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

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

type FinanceTransactionsPageProps = {
  refreshSignal?: number;
};

export default function FinanceTransactionsPage({ refreshSignal }: FinanceTransactionsPageProps) {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api<{ items: TransactionRow[] }>("/finance/transactions");
        if (!active) return;
        setRows(res.items || []);
      } catch (e: any) {
        if (!active) return;
        setError(e.message || "Failed to load transactions.");
      } finally {
        if (active) setLoading(false);
      }
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

  const displayRows = useMemo(() => {
    return rows.map((r) => ({
      ...r,
      createdLabel: new Date(r.createdAt).toLocaleString(),
      amountLabel: r.amountSats ? formatSats(r.amountSats) : "—",
      typeLabel: r.metadata?.eventType || r.kind,
      parties: r.metadata?.participantEmail || r.metadata?.participantId || r.metadata?.paymentIntentId || "—",
      details: r.metadata?.status || r.metadata?.rail || r.metadata?.method || "—"
    }));
  }, [rows]);

  function exportJson() {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "finance-transactions.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    const header = ["timestamp", "type", "amount_sats", "content", "parties", "details", "ref_id"].join(",");
    const lines = displayRows.map((r) =>
      [r.createdAt, r.typeLabel, r.amountSats || "", r.contentTitle || "", r.parties, r.details, r.refId]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "finance-transactions.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="text-sm text-neutral-400">Loading transactions…</div>;
  if (error) {
    return (
      <div className="rounded-lg border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 flex items-center justify-between">
        <span>Couldn’t load transactions. {error}</span>
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
      <div className="flex items-center justify-between">
        <div>
          <div className="text-base font-semibold">Transaction History</div>
          <div className="text-sm text-neutral-400">Unified, chronological ledger of finance events.</div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportJson}
            className="rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900"
          >
            Export JSON
          </button>
          <button
            onClick={exportCsv}
            className="rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="text-left font-medium py-2">Timestamp</th>
                <th className="text-left font-medium py-2">Type</th>
                <th className="text-left font-medium py-2">Amount</th>
                <th className="text-left font-medium py-2">Content</th>
                <th className="text-left font-medium py-2">Parties</th>
                <th className="text-left font-medium py-2">Related</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-3 text-neutral-500">No transactions yet.</td>
                </tr>
              ) : (
                displayRows.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-900">
                    <td className="py-2 text-neutral-400">{r.createdLabel}</td>
                    <td className="py-2 text-neutral-200">{r.typeLabel}</td>
                    <td className="py-2">{r.amountLabel}</td>
                    <td className="py-2 text-neutral-200">{r.contentTitle || "—"}</td>
                    <td className="py-2 text-neutral-400">{r.parties}</td>
                    <td className="py-2 text-neutral-400">{r.details}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
