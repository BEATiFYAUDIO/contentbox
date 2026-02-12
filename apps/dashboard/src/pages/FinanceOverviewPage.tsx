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
  health: {
    lightning?: { status: string; message?: string; endpoint?: string | null; hint?: string | null };
    onchain?: { status: string; message?: string; endpoint?: string | null; hint?: string | null };
  };
};

type FinanceOverviewPageProps = {
  refreshSignal?: number;
  useNodeRails?: boolean;
  onGoToPayouts?: () => void;
};

export default function FinanceOverviewPage({ refreshSignal, useNodeRails = false, onGoToPayouts }: FinanceOverviewPageProps) {
  const [data, setData] = useState<Overview | null>(null);
  const [royaltyTotals, setRoyaltyTotals] = useState<{ earnedSats: string; pendingSats: string }>({
    earnedSats: "0",
    pendingSats: "0"
  });
  const [payoutTotals, setPayoutTotals] = useState<{ pendingSats: string; paidSats: string }>({
    pendingSats: "0",
    paidSats: "0"
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auxError, setAuxError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      setAuxError(null);
      try {
        const [overviewRes, royaltiesRes, payoutsRes] = await Promise.allSettled([
          api<Overview>("/finance/overview"),
          api<{ totals: { earnedSats: string; pendingSats: string } }>("/finance/royalties"),
          api<{ totals: { pendingSats: string; paidSats: string } }>("/finance/payouts")
        ]);
        if (!active) return;
        if (overviewRes.status === "fulfilled") {
          setData(overviewRes.value);
        } else {
          throw overviewRes.reason;
        }
        if (royaltiesRes.status === "fulfilled") {
          setRoyaltyTotals(royaltiesRes.value?.totals || { earnedSats: "0", pendingSats: "0" });
        } else {
          setRoyaltyTotals({ earnedSats: "0", pendingSats: "0" });
          setAuxError("Royalties summary unavailable.");
        }
        if (payoutsRes.status === "fulfilled") {
          setPayoutTotals(payoutsRes.value?.totals || { pendingSats: "0", paidSats: "0" });
        } else {
          setPayoutTotals({ pendingSats: "0", paidSats: "0" });
          setAuxError((prev) => prev || "Payouts summary unavailable.");
        }
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

  const lightning = data?.health?.lightning;
  const onchain = data?.health?.onchain;
  const healthTone = (status?: string) => {
    if (status === "healthy") return "border-emerald-500/40 text-emerald-300 bg-emerald-500/10";
    if (status === "locked" || status === "degraded" || status === "tlsError") return "border-amber-500/40 text-amber-300 bg-amber-500/10";
    if (status === "missing") return "border-neutral-700 text-neutral-300 bg-neutral-900/50";
    return "border-red-500/40 text-red-300 bg-red-500/10";
  };
  const hasRevenue =
    Number(data?.totals?.salesSats || 0) > 0 ||
    Number(data?.totals?.invoicesTotal || 0) > 0 ||
    Number(royaltyTotals.earnedSats || 0) > 0 ||
    Number(payoutTotals.pendingSats || 0) > 0;

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
      {!hasRevenue ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 text-sm text-neutral-300">
          No revenue yet — sell content to get started.
        </div>
      ) : null}

      <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-base font-semibold">Revenue Overview</div>
          {useNodeRails ? (
            <div className="flex items-center gap-2 text-xs">
              <span className={["rounded-full border px-2 py-1", healthTone(lightning?.status)].join(" ")}>
                Lightning: {lightning?.status || "unknown"}
              </span>
              <span className={["rounded-full border px-2 py-1", healthTone(onchain?.status)].join(" ")}>
                On-chain: {onchain?.status || "unknown"}
              </span>
              <span className="text-neutral-500">
                Last updated: {data?.lastUpdatedAt ? new Date(data.lastUpdatedAt).toLocaleString() : "—"}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-neutral-400">Get paid: add a Lightning Address</span>
              <button
                onClick={() => onGoToPayouts?.()}
                className="rounded-lg border border-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-900"
              >
                Open Get Paid
              </button>
            </div>
          )}
        </div>
        {auxError ? (
          <div className="mt-2 text-xs text-amber-300">{auxError}</div>
        ) : null}
        {useNodeRails && lightning?.hint ? (
          <div className="mt-1 text-xs text-neutral-500">Lightning hint: {lightning.hint}</div>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Total sales</div>
          <div className="mt-2 text-2xl font-semibold">{formatSats(data?.totals?.salesSats || "0")}</div>
          <div className="mt-1 text-xs text-neutral-500">Paid invoices only</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Royalties earned</div>
          <div className="mt-2 text-2xl font-semibold">{formatSats(royaltyTotals.earnedSats || "0")}</div>
          <div className="mt-1 text-xs text-neutral-500">Your share to date</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Pending payouts</div>
          <div className="mt-2 text-2xl font-semibold">{formatSats(payoutTotals.pendingSats || "0")}</div>
          <div className="mt-1 text-xs text-neutral-500">Awaiting settlement</div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
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
