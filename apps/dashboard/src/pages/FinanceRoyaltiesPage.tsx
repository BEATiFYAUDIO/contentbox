import { useEffect, useState } from "react";
import { api } from "../lib/api";

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

type FinanceRoyaltiesPageProps = {
  refreshSignal?: number;
};

export default function FinanceRoyaltiesPage({ refreshSignal }: FinanceRoyaltiesPageProps) {
  const [rows, setRows] = useState<RoyaltyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api<{ items: RoyaltyRow[] }>("/finance/royalties");
        if (!active) return;
        setRows(res.items || []);
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

  const formatSats = (raw: string | null | undefined) => {
    const n = Number(raw || 0);
    if (!Number.isFinite(n)) return "0 sats";
    return `${Math.round(n).toLocaleString()} sats`;
  };

  if (loading) return <div className="text-sm text-neutral-400">Loading royalties…</div>;
  if (error) {
    return (
      <div className="rounded-lg border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 flex items-center justify-between">
        <span>Couldn’t load royalties. {error}</span>
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
        <div className="text-base font-semibold">Royalties by content</div>
        <div className="text-sm text-neutral-400 mt-1">
          Allocations update immediately after a sale is settled.
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="text-left font-medium py-2">Content</th>
                    <th className="text-left font-medium py-2">Total sales</th>
                    <th className="text-left font-medium py-2">Gross revenue</th>
                    <th className="text-left font-medium py-2">Allocation (your share)</th>
                    <th className="text-left font-medium py-2">Settled</th>
                    <th className="text-left font-medium py-2">Withdrawn</th>
                    <th className="text-left font-medium py-2">Pending</th>
                    <th className="text-left font-medium py-2">Details</th>
                  </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                      <td colSpan={7} className="py-3 text-neutral-500">No royalty data yet.</td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr key={r.contentId} className="border-t border-neutral-900">
                        <td className="py-2 text-neutral-200">{r.title}</td>
                        <td className="py-2">{formatSats(r.totalSalesSats)}</td>
                        <td className="py-2">{formatSats(r.grossRevenueSats)}</td>
                        <td className="py-2">{formatSats(r.allocationSats)}</td>
                        <td className="py-2 text-neutral-300">{formatSats(r.settledSats)}</td>
                        <td className="py-2 text-neutral-300">{formatSats(r.withdrawnSats)}</td>
                        <td className="py-2 text-neutral-300">{formatSats(r.pendingSats)}</td>
                        <td className="py-2">
                          <a
                        href={`/royalties/${r.contentId}`}
                        onClick={(e) => {
                          e.preventDefault();
                          window.history.pushState({}, "", `/royalties/${r.contentId}`);
                          window.location.reload();
                        }}
                        className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        View split terms
                      </a>
                    </td>
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
