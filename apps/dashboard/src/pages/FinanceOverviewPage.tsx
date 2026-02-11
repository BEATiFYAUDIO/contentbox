import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

type Overview = {
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
  revenueSeries: Array<{ date: string; amountSats: string }>;
  lastUpdatedAt: string;
};

type FinanceOverviewPageProps = {
  refreshSignal?: number;
};

export default function FinanceOverviewPage({ refreshSignal }: FinanceOverviewPageProps) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api<Overview>("/finance/overview");
        if (!active) return;
        setData(res);
      } catch (e: any) {
        if (!active) return;
        setError(e.message || "Failed to load finance overview.");
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

  const series = data?.revenueSeries || [];
  const chart = useMemo(() => {
    if (!series.length) return [] as Array<{ height: number; label: string; amountSats: string }>;
    const max = series.reduce((m, d) => Math.max(m, Number(d.amountSats || 0)), 0);
    return series.map((d) => ({
      height: max > 0 ? Math.round((Number(d.amountSats || 0) / max) * 100) : 0,
      label: d.date.slice(5),
      amountSats: d.amountSats
    }));
  }, [series]);

  if (loading) return <div className="text-sm text-neutral-400">Loading revenue overview…</div>;
  if (error) {
    return (
      <div className="rounded-lg border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 flex items-center justify-between">
        <span>Couldn’t load revenue overview. {error}</span>
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
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Lifetime revenue</div>
          <div className="mt-2 text-2xl font-semibold">{formatSats(data?.totals?.salesSats || "0")}</div>
          <div className="mt-1 text-xs text-neutral-500">Paid invoices only</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Last 30 days</div>
          <div className="mt-2 text-2xl font-semibold">{formatSats(data?.totals?.salesSatsLast30d || "0")}</div>
          <div className="mt-1 text-xs text-neutral-500">
            Invoices: {data?.totals?.invoicesTotal ?? 0} · Payments: {data?.totals?.paymentsLast30d ?? 0}
          </div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Invoices total</div>
          <div className="mt-2 text-2xl font-semibold">{data?.totals?.invoicesTotal ?? 0}</div>
          <div className="mt-1 text-xs text-neutral-500">Paid: {data?.totals?.invoicesPaid ?? 0}</div>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="text-base font-semibold">Revenue over time (last 30 days)</div>
        <div className="mt-3 flex items-end gap-1 h-32">
          {chart.length === 0 ? (
            <div className="text-sm text-neutral-500">No revenue yet.</div>
          ) : (
            chart.map((d, idx) => (
              <div key={`${d.label}-${idx}`} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-sm bg-orange-400/70"
                  style={{ height: `${Math.max(2, d.height)}%` }}
                  title={`${formatSats(d.amountSats)} on ${d.label}`}
                />
                {idx % 5 === 0 ? (
                  <div className="text-[10px] text-neutral-500">{d.label}</div>
                ) : (
                  <div className="text-[10px] text-transparent">.</div>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-base font-semibold">Invoice status</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div>Paid: <span className="text-neutral-200">{data?.totals?.invoicesPaid ?? 0}</span></div>
            <div>Pending: <span className="text-neutral-200">{data?.totals?.invoicesPending ?? 0}</span></div>
            <div>Failed: <span className="text-neutral-200">{data?.totals?.invoicesFailed ?? 0}</span></div>
            <div>Expired: <span className="text-neutral-200">{data?.totals?.invoicesExpired ?? 0}</span></div>
          </div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-base font-semibold">Payments received</div>
          <div className="mt-2 text-sm text-neutral-200">
            Received: {formatSats(data?.totals?.paymentsReceivedSats || "0")} ({data?.totals?.paymentsReceivedCount ?? 0})
          </div>
          <div className="text-sm text-neutral-400">
            Pending: {formatSats(data?.totals?.paymentsPendingSats || "0")} ({data?.totals?.paymentsPendingCount ?? 0})
          </div>
        </div>
      </section>
    </div>
  );
}
