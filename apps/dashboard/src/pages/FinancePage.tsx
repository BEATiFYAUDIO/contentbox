import { useEffect, useMemo, useState } from "react";
import FinanceOverviewPage from "./FinanceOverviewPage";
import SalesPage from "./SalesPage";
import FinanceRoyaltiesPage from "./FinanceRoyaltiesPage";
import PayoutRailsPage from "./PayoutRailsPage";
import PaymentRailsPage from "./PaymentRailsPage";
import FinanceTransactionsPage from "./FinanceTransactionsPage";
import EarningsV2Page from "./EarningsV2Page";
import { api } from "../lib/api";
import type { NodeMode } from "../lib/identity";
import LockedFeaturePanel from "../components/LockedFeaturePanel";

export type FinanceTab = "overview" | "ledger" | "royalties" | "payouts" | "rails" | "transactions" | "earnings-v2";

type FinancePosture = "basic_creator" | "sovereign_creator" | "sovereign_creator_with_provider" | "sovereign_node";

type FinancePageProps = {
  initialTab?: FinanceTab;
  nodeMode?: NodeMode | null;
  postureSnapshot?: {
    providerCommerceConnected?: boolean;
    localSovereignReady?: boolean;
  } | null;
};

export default function FinancePage({ initialTab = "overview", nodeMode, postureSnapshot }: FinancePageProps) {
  const isBasic = nodeMode === "basic";
  const [tab, setTab] = useState<FinanceTab>(initialTab);
  const [tabRefresh, setTabRefresh] = useState<Record<FinanceTab, number>>({
    overview: 0,
    ledger: 0,
    royalties: 0,
    payouts: 0,
    rails: 0,
    transactions: 0,
    "earnings-v2": 0
  });
  const [summaryRefresh, setSummaryRefresh] = useState(0);
  const [rails, setRails] = useState<Array<{ id: string; status: string; label: string; hint?: string | null }>>([]);
  const [railsError, setRailsError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const railsHealthy = rails.some((r) => r.status === "healthy");

  const financePosture: FinancePosture = useMemo(() => {
    if (nodeMode === "basic") return "basic_creator";
    if (nodeMode === "lan" || postureSnapshot?.localSovereignReady) return "sovereign_node";
    if (postureSnapshot?.providerCommerceConnected) return "sovereign_creator_with_provider";
    return "sovereign_creator";
  }, [nodeMode, postureSnapshot?.localSovereignReady, postureSnapshot?.providerCommerceConnected]);

  const hasInvoiceCommerce = useMemo(() => {
    // Conservative presentation gate:
    // - provider-backed invoice commerce is active, or
    // - local sovereign commerce stack is explicitly ready.
    return Boolean(postureSnapshot?.providerCommerceConnected || postureSnapshot?.localSovereignReady);
  }, [postureSnapshot?.localSovereignReady, postureSnapshot?.providerCommerceConnected]);

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
    const showRailsOps = financePosture === "sovereign_node";
    if (!showRailsOps) return;
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
  }, [summaryRefresh, financePosture]);

  const allTabs = useMemo(
    () => [
      { key: "overview", label: "Revenue Overview" },
      { key: "earnings-v2", label: "Earnings" },
      { key: "royalties", label: "Royalties" },
      { key: "ledger", label: "Revenue Ledger" },
      { key: "payouts", label: "Payout Destinations" },
      { key: "rails", label: "Payment Rails" },
      { key: "transactions", label: "Transactions" }
    ],
    []
  );

  const visibleTabs = useMemo(() => {
    // Transactions endpoint is still intentionally limited/stubbed.
    // Keep route support, but remove it from normal navigation to reduce noise.
    if (financePosture === "sovereign_node") {
      return allTabs.filter((t) => t.key !== "transactions");
    }
    if (financePosture === "sovereign_creator_with_provider") {
      return allTabs.filter((t) => t.key !== "transactions" && t.key !== "rails" && t.key !== "payouts");
    }
    return allTabs.filter(
      (t) => t.key !== "ledger" && t.key !== "transactions" && t.key !== "rails" && t.key !== "payouts"
    );
  }, [allTabs, financePosture]);

  if (isBasic) {
    return <LockedFeaturePanel title="Revenue" />;
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
            <div className="text-sm text-neutral-200 mt-1">
              {financePosture === "sovereign_node" || financePosture === "sovereign_creator_with_provider"
                ? "Sales · Invoices · Transactions"
                : "Creator earnings snapshot"}
            </div>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Money out</div>
            <div className="text-sm text-neutral-200 mt-1">
              {financePosture === "sovereign_node"
                ? "Royalties · Settlements · Payout Destinations"
                : "Royalties · Settlement posture"}
            </div>
          </div>
        </div>
        {financePosture === "sovereign_node" ? (
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
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {visibleTabs.map((t) => {
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
      <div className="text-xs text-neutral-500">
        Primary surfaces: <span className="text-neutral-300">Earnings</span> (summary),{" "}
        <span className="text-neutral-300">Royalties</span> (content/contributor earnings),{" "}
        <span className="text-neutral-300">Revenue Ledger</span> (accounting detail).
      </div>

      {tab === "overview" && (
        <FinanceOverviewPage
          refreshSignal={tabRefresh.overview}
          onOpenRoyalties={() => setTab("royalties")}
        />
      )}
      {tab === "ledger" && <SalesPage hasInvoiceCommerce={hasInvoiceCommerce} />}
      {tab === "royalties" && <FinanceRoyaltiesPage refreshSignal={tabRefresh.royalties} />}
      {tab === "earnings-v2" && <EarningsV2Page refreshSignal={tabRefresh["earnings-v2"]} hasInvoiceCommerce={hasInvoiceCommerce} />}
      {tab === "payouts" && <PayoutRailsPage />}
      {tab === "rails" && <PaymentRailsPage refreshSignal={tabRefresh.rails} />}
      {tab === "transactions" && <FinanceTransactionsPage refreshSignal={tabRefresh.transactions} />}
    </div>
  );
}
