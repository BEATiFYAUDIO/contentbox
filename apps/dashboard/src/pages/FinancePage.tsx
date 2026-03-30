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
  const [earningsBridgeFilter, setEarningsBridgeFilter] = useState<{ contentId: string; title: string; token: number } | null>(null);
  const [payoutBridgeFilter, setPayoutBridgeFilter] = useState<{ contentId?: string; title: string; token: number } | null>(null);
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
      if (document.visibilityState !== "visible") return;
      setSummaryRefresh((s) => s + 1);
      setTabRefresh((prev) => ({ ...prev, [tab]: (prev[tab] || 0) + 1 }));
    }, 60000);
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
        setRailsError(e.message || "Failed to load node health.");
      }
    })();
    return () => {
      active = false;
    };
  }, [summaryRefresh, financePosture]);

  const allTabs = useMemo(
    () => [
      { key: "overview", label: "Revenue Overview" },
      { key: "ledger", label: "Sales" },
      { key: "earnings-v2", label: "Content" },
      { key: "royalties", label: "Earnings" },
      { key: "payouts", label: "Payouts" },
      { key: "rails", label: "Node & Wallet" },
      { key: "transactions", label: "Transactions" }
    ],
    []
  );

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
              Sales input → Content intelligence → Earnings statement → Payout execution.
            </div>
            <div className="text-xs text-neutral-500 mt-1">Where relationships go, money flows.</div>
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
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <button
            type="button"
            onClick={() => setTab("overview")}
            className={[
              "rounded-xl border p-3 text-left transition",
              tab === "overview"
                ? "border-white/30 bg-white/10"
                : "border-neutral-800 bg-neutral-950/40 hover:bg-neutral-900"
            ].join(" ")}
          >
            <div className="text-xs uppercase tracking-wide text-neutral-500">Stage 0</div>
            <div className="mt-1 text-sm font-semibold text-neutral-100">Revenue Overview</div>
            <div className="mt-1 text-xs text-neutral-400">System summary, health, and top-level money posture.</div>
          </button>
          <button
            type="button"
            onClick={() => setTab("ledger")}
            className={[
              "rounded-xl border p-3 text-left transition",
              tab === "ledger"
                ? "border-white/30 bg-white/10"
                : "border-neutral-800 bg-neutral-950/40 hover:bg-neutral-900"
            ].join(" ")}
          >
            <div className="text-xs uppercase tracking-wide text-neutral-500">Stage 1</div>
            <div className="mt-1 text-sm font-semibold text-neutral-100">Sales Input</div>
            <div className="mt-1 text-xs text-neutral-400">Buyer payment truth and settlement node context.</div>
          </button>
          <button
            type="button"
            onClick={() => setTab("earnings-v2")}
            className={[
              "rounded-xl border p-3 text-left transition",
              tab === "earnings-v2"
                ? "border-white/30 bg-white/10"
                : "border-neutral-800 bg-neutral-950/40 hover:bg-neutral-900"
            ].join(" ")}
          >
            <div className="text-xs uppercase tracking-wide text-neutral-500">Stage 2</div>
            <div className="mt-1 text-sm font-semibold text-neutral-100">Content Intelligence</div>
            <div className="mt-1 text-xs text-neutral-400">Multi-view performance, risk, role, and freshness analysis.</div>
          </button>
          <button
            type="button"
            onClick={() => setTab("royalties")}
            className={[
              "rounded-xl border p-3 text-left transition",
              tab === "royalties"
                ? "border-white/30 bg-white/10"
                : "border-neutral-800 bg-neutral-950/40 hover:bg-neutral-900"
            ].join(" ")}
          >
            <div className="text-xs uppercase tracking-wide text-neutral-500">Stage 3</div>
            <div className="mt-1 text-sm font-semibold text-neutral-100">Earnings Statement</div>
            <div className="mt-1 text-xs text-neutral-400">Your personal royalty money statement by status.</div>
          </button>
          <button
            type="button"
            onClick={() => setTab("payouts")}
            className={[
              "rounded-xl border p-3 text-left transition",
              tab === "payouts"
                ? "border-white/30 bg-white/10"
                : "border-neutral-800 bg-neutral-950/40 hover:bg-neutral-900"
            ].join(" ")}
          >
            <div className="text-xs uppercase tracking-wide text-neutral-500">Stage 4</div>
            <div className="mt-1 text-sm font-semibold text-neutral-100">Payout Execution</div>
            <div className="mt-1 text-xs text-neutral-400">
              {financePosture === "sovereign_node"
                ? "Paid, pending, failed, and node execution health."
                : "Paid and pending execution state."}
            </div>
          </button>
        </div>
        {financePosture === "sovereign_node" && tab !== "overview" ? (
          <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3 space-y-2">
          <div className="flex items-center flex-wrap gap-2">
            {rails.map((r) => (
              <span key={r.id} className="text-xs rounded-full border border-neutral-800 px-2 py-1 text-neutral-200">
                {r.label}: {r.status}
              </span>
            ))}
            {rails.length === 0 && !railsError ? (
              <span className="text-xs text-neutral-500">Node health unavailable</span>
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

      <div className="text-xs text-neutral-500">
        Current stage:{" "}
        <span className="text-neutral-300">
          {(allTabs.find((t) => t.key === tab)?.label || "Revenue Overview").replace("Revenue ", "")}
        </span>
      </div>
      {tab === "overview" && (
        <FinanceOverviewPage
          refreshSignal={tabRefresh.overview}
          onOpenRoyalties={() => setTab("royalties")}
          showNodeWalletContext={financePosture === "sovereign_node"}
        />
      )}
      {tab === "ledger" && (
        <SalesPage
          hasInvoiceCommerce={hasInvoiceCommerce}
        />
      )}
      {tab === "royalties" && (
        <FinanceRoyaltiesPage
          refreshSignal={tabRefresh.royalties}
          bridgeFilter={earningsBridgeFilter}
          onOpenPayouts={(bridge) => {
            setPayoutBridgeFilter({
              contentId: String(bridge?.contentId || "").trim() || undefined,
              title: bridge?.title || "Untitled",
              token: Date.now()
            });
            setTab("payouts");
          }}
        />
      )}
      {tab === "earnings-v2" && (
        <EarningsV2Page
          refreshSignal={tabRefresh["earnings-v2"]}
          hasInvoiceCommerce={hasInvoiceCommerce}
          onOpenEarningsForContent={(contentId, title) => {
            setEarningsBridgeFilter({ contentId, title, token: Date.now() });
            setTab("royalties");
          }}
        />
      )}
      {tab === "payouts" && <PayoutRailsPage bridgeFilter={payoutBridgeFilter} />}
      {tab === "rails" && <PaymentRailsPage refreshSignal={tabRefresh.rails} />}
      {tab === "transactions" && <FinanceTransactionsPage refreshSignal={tabRefresh.transactions} />}
    </div>
  );
}
