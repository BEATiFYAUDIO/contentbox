import { useEffect, useState } from "react";
import { api } from "../lib/api";

type PayoutRow = {
  id: string;
  amountSats: string;
  status: string;
  method: string | null;
  createdAt: string;
  completedAt: string | null;
};

type PayoutsResponse = {
  items: PayoutRow[];
  totals: { pendingSats: string; paidSats: string };
};

type WithdrawalsPageProps = {
  onOpenDestinations?: () => void;
};

export default function WithdrawalsPage({ onOpenDestinations }: WithdrawalsPageProps) {
  const [data, setData] = useState<PayoutsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api<PayoutsResponse>("/finance/payouts");
        if (!active) return;
        setData(res);
      } catch (e: any) {
        if (!active) return;
        setError(e.message || "Failed to load withdrawals.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [retryTick]);

  const formatSats = (raw?: string | null) => {
    const n = Number(raw || 0);
    if (!Number.isFinite(n)) return "0 sats";
    return `${Math.round(n).toLocaleString()} sats`;
  };

  if (loading) return <div className="text-sm text-neutral-400">Loading withdrawals…</div>;
  if (error) {
    return (
      <div className="rounded-lg border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 flex items-center justify-between">
        <span>Couldn’t load withdrawals. {error}</span>
        <button
          onClick={() => setRetryTick((t) => t + 1)}
          className="rounded-lg border border-amber-700 px-2 py-1 text-xs hover:bg-amber-900/30"
        >
          Retry
        </button>
      </div>
    );
  }

  const rows = data?.items || [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Withdrawals</div>
            <div className="text-sm text-neutral-400 mt-1">Track payouts to your configured destination.</div>
          </div>
          <button
            onClick={() => setRetryTick((t) => t + 1)}
            className="rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900"
          >
            Refresh now
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Pending</div>
          <div className="mt-2 text-2xl font-semibold">{formatSats(data?.totals?.pendingSats || "0")}</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Paid out</div>
          <div className="mt-2 text-2xl font-semibold">{formatSats(data?.totals?.paidSats || "0")}</div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="text-base font-semibold">Withdrawal history</div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="text-left font-medium py-2">Date</th>
                <th className="text-left font-medium py-2">Amount</th>
                <th className="text-left font-medium py-2">Method</th>
                <th className="text-left font-medium py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-3 text-neutral-500">
                    No withdrawals yet. Configure a payout destination to get paid.
                    {onOpenDestinations ? (
                      <button
                        onClick={() => onOpenDestinations()}
                        className="ml-2 text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        Add payout destination
                      </button>
                    ) : null}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-900">
                    <td className="py-2 text-neutral-400">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="py-2">{formatSats(r.amountSats)}</td>
                    <td className="py-2 text-neutral-300">{r.method || "manual"}</td>
                    <td className="py-2 text-neutral-300">{r.status}</td>
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
