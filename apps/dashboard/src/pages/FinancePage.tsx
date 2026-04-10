import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { NodeMode } from "../lib/identity";
import LockedFeaturePanel from "../components/LockedFeaturePanel";

const FinanceOverviewPage = lazy(() => import("./FinanceOverviewPage"));
const SalesPage = lazy(() => import("./SalesPage"));
const FinanceRoyaltiesPage = lazy(() => import("./FinanceRoyaltiesPage"));
const PayoutRailsPage = lazy(() => import("./PayoutRailsPage"));
const PaymentRailsPage = lazy(() => import("./PaymentRailsPage"));
const FinanceTransactionsPage = lazy(() => import("./FinanceTransactionsPage"));
const EarningsV2Page = lazy(() => import("./EarningsV2Page"));

export type FinanceTab = "overview" | "ledger" | "royalties" | "payouts" | "rails" | "transactions" | "earnings-v2";

type FinancePosture = "basic_creator" | "sovereign_creator" | "sovereign_creator_with_provider" | "sovereign_node";

type FinancePageProps = {
  initialTab?: FinanceTab;
  nodeMode?: NodeMode | null;
  postureSnapshot?: {
    providerCommerceConnected?: boolean;
    localSovereignReady?: boolean;
  } | null;
  onOpenLightningConfig?: () => void;
};

export default function FinancePage({ initialTab = "overview", nodeMode, postureSnapshot, onOpenLightningConfig }: FinancePageProps) {
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
      { key: "rails", label: "Lightning & Rails" },
      { key: "transactions", label: "Transactions" }
    ],
    []
  );

  if (isBasic) {
    return <LockedFeaturePanel title="Revenue" />;
  }

  const tabFallback = (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 text-sm text-neutral-400">
      Loading section…
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Revenue</div>
            <div className="text-sm text-neutral-400 mt-1">
              Sales input → Content intelligence → Earnings statement → Payout execution.
            </div>
            <div className="text-xs text-neutral-500 mt-1">Sales truth, earnings truth, payout truth.</div>
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
        <div className="mt-4 flex flex-wrap gap-2">
          {([
            { key: "overview", label: "Stage 0 · Overview" },
            { key: "ledger", label: "Stage 1 · Sales" },
            { key: "earnings-v2", label: "Stage 2 · Earnings by Work" },
            { key: "royalties", label: "Stage 3 · Earnings Ledger" },
            { key: "payouts", label: "Stage 4 · Payouts" }
          ] as Array<{ key: FinanceTab; label: string }>).map((t) => (
            <button
              key={`stage-${t.key}`}
              type="button"
              onClick={() => setTab(t.key)}
              className={[
                "rounded-full border px-3 py-1.5 text-xs",
                tab === t.key
                  ? "border-white/30 bg-white/10 text-neutral-100"
                  : "border-neutral-800 bg-neutral-950/40 text-neutral-300 hover:bg-neutral-900"
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
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
        <Suspense fallback={tabFallback}>
          <FinanceOverviewPage
            refreshSignal={tabRefresh.overview}
            onOpenRoyalties={() => setTab("royalties")}
            showNodeWalletContext={false}
          />
        </Suspense>
      )}
      {tab === "ledger" && (
        <Suspense fallback={tabFallback}>
          <SalesPage
            hasInvoiceCommerce={hasInvoiceCommerce}
          />
        </Suspense>
      )}
      {tab === "royalties" && (
        <Suspense fallback={tabFallback}>
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
        </Suspense>
      )}
      {tab === "earnings-v2" && (
        <Suspense fallback={tabFallback}>
          <EarningsV2Page
            refreshSignal={tabRefresh["earnings-v2"]}
            hasInvoiceCommerce={hasInvoiceCommerce}
            onOpenEarningsForContent={(contentId, title) => {
              setEarningsBridgeFilter({ contentId, title, token: Date.now() });
              setTab("royalties");
            }}
          />
        </Suspense>
      )}
      {tab === "payouts" && (
        <Suspense fallback={tabFallback}>
          <PayoutRailsPage bridgeFilter={payoutBridgeFilter} />
        </Suspense>
      )}
      {tab === "rails" && (
        <Suspense fallback={tabFallback}>
          <PaymentRailsPage refreshSignal={tabRefresh.rails} onOpenLightningConfig={onOpenLightningConfig} />
        </Suspense>
      )}
      {tab === "transactions" && (
        <Suspense fallback={tabFallback}>
          <FinanceTransactionsPage refreshSignal={tabRefresh.transactions} />
        </Suspense>
      )}
    </div>
  );
}
