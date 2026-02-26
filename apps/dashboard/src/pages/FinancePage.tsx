import { useEffect, useMemo, useState } from "react";
import FinanceOverviewPage from "./FinanceOverviewPage";
import SalesPage from "./SalesPage";
import FinanceRoyaltiesPage from "./FinanceRoyaltiesPage";
import PayoutRailsPage from "./PayoutRailsPage";
import PaymentRailsPage from "./PaymentRailsPage";
import FinanceTransactionsPage from "./FinanceTransactionsPage";
import { api } from "../lib/api";
import type { NodeMode } from "../lib/identity";

export type FinanceTab = "overview" | "ledger" | "royalties" | "payouts" | "rails" | "transactions";

type FinancePageProps = {
  initialTab?: FinanceTab;
  nodeMode?: NodeMode | null;
};

export default function FinancePage({ initialTab = "overview", nodeMode }: FinancePageProps) {
  const isBasic = nodeMode === "basic";
  const [tab, setTab] = useState<FinanceTab>(initialTab);
  const [tabRefresh, setTabRefresh] = useState<Record<FinanceTab, number>>({
    overview: 0,
    ledger: 0,
    royalties: 0,
    payouts: 0,
    rails: 0,
    transactions: 0
  });
  const [summaryRefresh, setSummaryRefresh] = useState(0);
  const [rails, setRails] = useState<Array<{ id: string; status: string; label: string; hint?: string | null }>>([]);
  const [railsError, setRailsError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const railsHealthy = rails.some((r) => r.status === "healthy");

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (isBasic) return;
    const timer = setInterval(() => {
      setSummaryRefresh((s) => s + 1);
      setTabRefresh((prev) => ({ ...prev, [tab]: (prev[tab] || 0) + 1 }));
    }, 30000);
    return () => clearInterval(timer);
  }, [tab, isBasic]);

  useEffect(() => {
    if (isBasic) return;
    let active = true;
    (async () => {
      try {
        setRailsError(null);
        const res = await api<Array<{ id: string; status: string; label: string; hint?: string | null }>>("/finance/payment-rails");
        if (!active) return;
        setRails(res || []);
        setLastUpdatedAt(new Date().toISOString());
      } catch (e: any) {
        if (!active) return;
        setRailsError(e.message || "Failed to load rail health.");
      }
    })();
    return () => {
      active = false;
    };
  }, [summaryRefresh, isBasic]);

  const tabs = useMemo(
    () => [
      { key: "overview", label: "Revenue Overview" },
      { key: "ledger", label: "Revenue Ledger" },
      { key: "royalties", label: "Royalties" },
      { key: "payouts", label: "Payout Destinations" },
      { key: "rails", label: "Payment Rails" },
      { key: "transactions", label: "Transactions" }
    ],
    []
  );

  if (isBasic) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-6 text-neutral-400">
        <div className="text-lg font-semibold text-neutral-200">Revenue</div>
        <div className="text-sm mt-2">
          Available in Advanced mode. Tips in Basic are paid directly to your wallet and are not tracked.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Revenue</div>
            <div className="text-sm text-neutral-400 mt-1">
              Unified view of sales, settlements, and payout configuration.
            </div>
          </div>
          <button
            onClick={() => {
              setSummaryRefresh((s) => s + 1);
              setTabRefresh((prev) => ({ ...prev, [tab]: (prev[tab] || 0) + 1 }));
            }}
            className="rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900"
          >
            Refresh now
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Money in</div>
            <div className="text-sm text-neutral-200 mt-1">Sales · Invoices · Transactions</div>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Money out</div>
            <div className="text-sm text-neutral-200 mt-1">Royalties · Settlements · Payout Destinations</div>
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3 space-y-2">
          <div className="flex items-center flex-wrap gap-2">
            {rails.map((r) => (
              <span key={r.id} className="text-xs rounded-full border border-neutral-800 px-2 py-1 text-neutral-200">
                {r.label}: {r.status}
              </span>
            ))}
            {rails.length === 0 && !railsError ? (
              <span className="text-xs text-neutral-500">Rails health unavailable</span>
            ) : null}
            {railsError ? <span className="text-xs text-amber-300">{railsError}</span> : null}
          </div>
          <div className="text-xs text-neutral-500">
            ThunderHub (SSH tunnel):
            <code className="ml-2 text-[11px]">ssh -L 3000:127.0.0.1:3000 &lt;USER&gt;@&lt;NODE_HOST&gt;</code>
          </div>
          <div className="text-xs text-neutral-500">
            Last updated: {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString() : "—"}
          </div>
          {!railsHealthy ? (
            <button
              onClick={() => setTab("payouts")}
              className="rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900"
            >
              Configure payout destinations
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key as FinanceTab)}
              className={[
                "rounded-full px-4 py-2 text-sm border transition",
                active
                  ? "border-white/40 bg-white/10 text-white"
                  : "border-neutral-800 text-neutral-300 hover:bg-neutral-900"
              ].join(" ")}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "overview" && <FinanceOverviewPage refreshSignal={tabRefresh.overview} />}
      {tab === "ledger" && <SalesPage />}
      {tab === "royalties" && <FinanceRoyaltiesPage refreshSignal={tabRefresh.royalties} />}
      {tab === "payouts" && <PayoutRailsPage />}
      {tab === "rails" && <PaymentRailsPage refreshSignal={tabRefresh.rails} />}
      {tab === "transactions" && <FinanceTransactionsPage refreshSignal={tabRefresh.transactions} />}
    </div>
  );
}
