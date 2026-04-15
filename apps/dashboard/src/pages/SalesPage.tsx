import React from "react";
import { api } from "../lib/api";
import AuditPanel from "../components/AuditPanel";
import LockedFeaturePanel from "../components/LockedFeaturePanel";
import TimeScopeControls from "../components/TimeScopeControls";
import { readDelegatedRevenue, upsertDelegatedRevenue, type DelegatedRevenueRow } from "../lib/delegatedRevenueStore";
import { isWithinPeriod, type TimeBasis, type TimePeriod } from "../lib/timeScope";

type SaleRow = {
  id: string;
  intentId: string;
  contentId: string;
  amountSats: string | number;
  grossAmountSats?: string | number;
  providerInvoicingFeeSats?: string | number;
  providerDurableHostingFeeSats?: string | number;
  providerFeeSats?: string | number;
  creatorNetSats?: string | number;
  payoutStatus?: "pending" | "forwarding" | "paid" | "failed";
  payoutRail?: "provider_custody" | "forwarded" | "creator_node" | null;
  payoutDestinationType?: "lightning_address" | "local_lnd" | "onchain_address" | null;
  payoutDestinationSummary?: string | null;
  providerRemitMode?: "provider_custody" | "auto_forward" | "manual_payout" | null;
  payoutReference?: string | null;
  remittedAt?: string | null;
  payoutLastError?: string | null;
  providerNodeId?: string | null;
  creatorNodeId?: string | null;
  currency: string;
  rail: string;
  memo?: string | null;
  recognizedAt: string;
  content?: { id: string; title: string; type: string } | null;
};

type ProviderConfig = {
  providerUrl: string | null;
  enabled: boolean;
  configured?: boolean;
};

type NodeIdentity = {
  nodeId: string;
};

type ProviderRevenueSnapshotResponse = {
  ok: boolean;
  providerNodeId: string | null;
  creatorNodeId: string;
  asOf: string;
  items: DelegatedRevenueRow[];
};

type RoyaltyScopeRow = {
  contentId: string;
  title: string;
  totalSalesSats: string;
  allocationSats: string;
  settledSats: string;
  withdrawnSats: string;
  pendingSats: string;
};

type SalesPageProps = {
  productTier?: string;
  disabled?: boolean;
  hasInvoiceCommerce?: boolean;
  onOpenSplitEditor?: (contentId: string) => void;
};

export default function SalesPage({
  disabled = false,
  hasInvoiceCommerce = false,
  onOpenSplitEditor
}: SalesPageProps) {
  const [sales, setSales] = React.useState<SaleRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [delegatedRows, setDelegatedRows] = React.useState<DelegatedRevenueRow[]>([]);
  const [delegatedMode, setDelegatedMode] = React.useState<"fresh" | "offline_snapshot" | "not_provider_mode" | "none">("none");
  const [delegatedMsg, setDelegatedMsg] = React.useState<string | null>(null);
  const [delegatedLastSyncAt, setDelegatedLastSyncAt] = React.useState<string | null>(null);
  const [delegatedSnapshotAsOf, setDelegatedSnapshotAsOf] = React.useState<string | null>(null);
  const [royaltyRows, setRoyaltyRows] = React.useState<RoyaltyScopeRow[]>([]);
  const [selectedSaleId, setSelectedSaleId] = React.useState<string | null>(null);
  const [contentScopeId, setContentScopeId] = React.useState<string | null>(null);
  const [auditOpenSignal, setAuditOpenSignal] = React.useState(0);
  const [showScopedAudit, setShowScopedAudit] = React.useState(false);
  const [timeBasis, setTimeBasis] = React.useState<TimeBasis>("sale");
  const [timePeriod, setTimePeriod] = React.useState<TimePeriod>("all");
  const [contentFilter, setContentFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [sourceFilter, setSourceFilter] = React.useState("all");
  const [roleFilter, setRoleFilter] = React.useState("all");

  const syncDelegatedSnapshot = React.useCallback(async () => {
    try {
      const [providerCfg, identity] = await Promise.all([
        api<ProviderConfig>("/api/network/provider", "GET"),
        api<NodeIdentity>("/api/network/node-identity", "GET")
      ]);
      const providerUrl = String(providerCfg?.providerUrl || "").trim().replace(/\/+$/, "");
      const creatorNodeId = String(identity?.nodeId || "").trim();
      const providerConfigured = Boolean(providerCfg?.enabled && providerUrl && creatorNodeId);
      if (!providerConfigured) {
        setDelegatedMode("not_provider_mode");
        setDelegatedMsg("Provider-backed mode is not configured on this node.");
        setDelegatedRows(await readDelegatedRevenue());
        return;
      }
      const res = await fetch(`${providerUrl}/public/provider/revenue/${encodeURIComponent(creatorNodeId)}`);
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok) throw new Error(String(json?.message || json?.error || `provider_http_${res.status}`));
      const payload = (json || {}) as ProviderRevenueSnapshotResponse;
      const rows = Array.isArray(payload.items) ? payload.items : [];
      await upsertDelegatedRevenue(rows);
      setDelegatedRows(rows);
      setDelegatedLastSyncAt(new Date().toISOString());
      setDelegatedSnapshotAsOf(String(payload.asOf || "").trim() || null);
      setDelegatedMode("fresh");
      setDelegatedMsg(`Provider-backed revenue synced from ${providerUrl}.`);
    } catch (e: any) {
      const cached = await readDelegatedRevenue();
      if (cached.length > 0) {
        setDelegatedRows(cached);
        if (cached.length > 0) {
          const newest = [...cached].sort((a, b) => String(b.last_updated).localeCompare(String(a.last_updated)))[0];
          setDelegatedSnapshotAsOf(newest?.last_updated || null);
        }
        setDelegatedMode("offline_snapshot");
        setDelegatedMsg("Provider unreachable. Showing last-known delegated revenue snapshot.");
      } else {
        setDelegatedRows([]);
        setDelegatedSnapshotAsOf(null);
        setDelegatedMode("none");
        setDelegatedMsg(e?.message || "Provider-backed revenue unavailable.");
      }
    }
  }, []);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [salesRes, royaltiesRes] = await Promise.allSettled([
        api<SaleRow[]>("/api/revenue/sales", "GET"),
        api<{ items: RoyaltyScopeRow[] }>("/finance/royalties", "GET")
      ]);
      if (salesRes.status === "fulfilled") {
        setSales(salesRes.value || []);
      } else {
        setSales([]);
        setError(salesRes.reason?.message || "Failed to load sales data");
      }
      if (royaltiesRes.status === "fulfilled") {
        setRoyaltyRows(Array.isArray(royaltiesRes.value?.items) ? royaltiesRes.value.items : []);
      } else {
        setRoyaltyRows([]);
      }
      await syncDelegatedSnapshot();
    } catch (e: any) {
      setError(e?.message || "Failed to load revenue data");
      await syncDelegatedSnapshot();
    } finally {
      setLoading(false);
    }
  }, [syncDelegatedSnapshot]);

  React.useEffect(() => {
    if (disabled) return;
    loadData();
  }, [loadData, disabled]);

  React.useEffect(() => {
    if (disabled) return;
    let active = true;
    const interval = window.setInterval(() => {
      if (!active) return;
      void syncDelegatedSnapshot();
    }, 45_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [disabled, syncDelegatedSnapshot]);

  const formatSats = (raw: string | number) => {
    const n = Number(raw || 0);
    if (!Number.isFinite(n)) return "0";
    return Math.round(n).toLocaleString();
  };

  const shortNodeId = (raw?: string | null) => {
    const id = String(raw || "").trim();
    if (!id) return "";
    if (id.length <= 12) return id;
    return `${id.slice(0, 6)}…${id.slice(-6)}`;
  };

  const settlementNodeLabel = (row: SaleRow) => {
    const creatorNode = shortNodeId(row.creatorNodeId);
    const providerNode = shortNodeId(row.providerNodeId);
    const rail = String(row.rail || "").trim().toLowerCase();
    const payoutRail = String(row.payoutRail || "").trim().toLowerCase();

    if (creatorNode) return `Creator node${creatorNode ? ` (${creatorNode})` : ""}`;
    if (providerNode) return `Provider node${providerNode ? ` (${providerNode})` : ""}`;
    if (payoutRail === "creator_node") return "Creator node";
    if (payoutRail === "provider_custody") return "Provider custody";
    if (payoutRail === "forwarded") return "Forwarded";
    if (rail === "node_invoice") return "Creator node";
    if (rail === "provider_custody") return "Provider custody";
    if (rail === "forwarded") return "Forwarded";
    return "Unknown";
  };

  const openSplitEditorForContent = React.useCallback((contentId: string) => {
    if (!contentId) return;
    if (onOpenSplitEditor) {
      onOpenSplitEditor(contentId);
      return;
    }
    window.history.pushState({}, "", `/content/${encodeURIComponent(contentId)}/splits`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, [onOpenSplitEditor]);

  const scopedSales = React.useMemo(() => {
    const rowTimestampForScope = (row: SaleRow): string => {
      if (timeBasis === "paid") return String(row.remittedAt || row.recognizedAt || "");
      // Sales and Earned both map to recognized buyer-payment timestamp for this ledger.
      return String(row.recognizedAt || "");
    };
    if (timePeriod === "all") return sales;
    return sales.filter((row) => isWithinPeriod(rowTimestampForScope(row), timePeriod));
  }, [sales, timeBasis, timePeriod]);

  const contentScopedSales = React.useMemo(() => {
    const scopedId = String(contentScopeId || "").trim();
    if (!scopedId) return scopedSales;
    return scopedSales.filter((row) => String(row.content?.id || row.contentId || "").trim() === scopedId);
  }, [scopedSales, contentScopeId]);

  const roleByContentId = React.useMemo(() => {
    const out = new Map<string, string>();
    for (const row of royaltyRows) {
      const contentId = String(row.contentId || "").trim();
      if (!contentId) continue;
      const total = Number(row.totalSalesSats || 0) || 0;
      const allocation = Number(row.allocationSats || 0) || 0;
      const isOwner = total > 0 && Math.abs(total - allocation) < 0.5;
      out.set(contentId, isOwner ? "Owner" : "Participant");
    }
    return out;
  }, [royaltyRows]);

  const payoutStatusLabel = React.useCallback((row: SaleRow) => {
    const raw = String(row.payoutStatus || "").trim().toLowerCase();
    if (raw === "paid") return "Paid";
    if (raw === "failed") return "Failed";
    if (raw === "forwarding") return "Forwarding";
    return "Pending";
  }, []);

  const sourceLabelForSale = React.useCallback((row: SaleRow) => {
    const payoutRail = String(row.payoutRail || "").trim().toLowerCase();
    const rail = String(row.rail || "").trim().toLowerCase();
    if (payoutRail === "creator_node" || rail === "node_invoice") return "Creator node";
    if (payoutRail === "forwarded" || rail === "forwarded") return "Forwarded";
    if (payoutRail === "provider_custody" || rail === "provider_custody") return "Provider custody";
    return "Other";
  }, []);

  const roleLabelForSale = React.useCallback((row: SaleRow) => {
    const contentId = String(row.content?.id || row.contentId || "").trim();
    return roleByContentId.get(contentId) || "Participant";
  }, [roleByContentId]);

  const filteredSales = React.useMemo(() => {
    const q = contentFilter.trim().toLowerCase();
    return contentScopedSales.filter((row) => {
      const title = String(row.content?.title || "").toLowerCase();
      const matchesContent = !q || title.includes(q);
      const status = payoutStatusLabel(row).toLowerCase();
      const source = sourceLabelForSale(row).toLowerCase();
      const role = roleLabelForSale(row).toLowerCase();
      const matchesStatus = statusFilter === "all" || status === statusFilter;
      const matchesSource = sourceFilter === "all" || source === sourceFilter;
      const matchesRole = roleFilter === "all" || role === roleFilter;
      return matchesContent && matchesStatus && matchesSource && matchesRole;
    });
  }, [contentScopedSales, contentFilter, payoutStatusLabel, roleFilter, roleLabelForSale, sourceFilter, sourceLabelForSale, statusFilter]);

  const availableStatuses = React.useMemo(() => {
    const set = new Set<string>();
    for (const row of contentScopedSales) set.add(payoutStatusLabel(row).toLowerCase());
    return Array.from(set).sort();
  }, [contentScopedSales, payoutStatusLabel]);

  const availableSources = React.useMemo(() => {
    const set = new Set<string>();
    for (const row of contentScopedSales) set.add(sourceLabelForSale(row).toLowerCase());
    return Array.from(set).sort();
  }, [contentScopedSales, sourceLabelForSale]);

  const availableRoles = React.useMemo(() => {
    const set = new Set<string>();
    for (const row of contentScopedSales) set.add(roleLabelForSale(row).toLowerCase());
    return Array.from(set).sort();
  }, [contentScopedSales, roleLabelForSale]);

  const totals = React.useMemo(() => {
    return filteredSales.reduce(
      (acc, s) => {
        acc.gross += Number(s.grossAmountSats ?? s.amountSats ?? 0) || 0;
        acc.providerInvoicingFee += Number(s.providerInvoicingFeeSats ?? s.providerFeeSats ?? 0) || 0;
        acc.providerDurableHostingFee += Number(s.providerDurableHostingFeeSats ?? 0) || 0;
        acc.providerFee += Number(s.providerFeeSats ?? 0) || 0;
        acc.creatorNet += Number(s.creatorNetSats ?? s.amountSats ?? 0) || 0;
        return acc;
      },
      {
        gross: 0,
        providerInvoicingFee: 0,
        providerDurableHostingFee: 0,
        providerFee: 0,
        creatorNet: 0
      }
    );
  }, [filteredSales]);

  const selectedSale = React.useMemo(() => {
    if (!filteredSales.length) return null;
    if (selectedSaleId) {
      const match = filteredSales.find((row) => row.id === selectedSaleId);
      if (match) return match;
    }
    return filteredSales[0];
  }, [filteredSales, selectedSaleId]);

  const scopedWorkTotals = React.useMemo(() => {
    const contentId = String(selectedSale?.content?.id || "").trim();
    if (!contentId) return null;
    let gross = 0;
    let net = 0;
    let events = 0;
    let latestRecognizedAt = "";
    for (const row of filteredSales) {
      if (String(row.content?.id || "").trim() !== contentId) continue;
      gross += Number(row.grossAmountSats ?? row.amountSats ?? 0) || 0;
      net += Number(row.creatorNetSats ?? row.amountSats ?? 0) || 0;
      events += 1;
      if (!latestRecognizedAt || String(row.recognizedAt || "") > latestRecognizedAt) {
        latestRecognizedAt = String(row.recognizedAt || "");
      }
    }
    return { gross, net, events, latestRecognizedAt };
  }, [filteredSales, selectedSale?.content?.id]);

  const scopedSplitSnapshot = React.useMemo(() => {
    const contentId = String(selectedSale?.content?.id || selectedSale?.contentId || "").trim();
    const contentTitle = String(selectedSale?.content?.title || "").trim().toLowerCase();
    if (!contentId && !contentTitle) return null;
    const row =
      royaltyRows.find((r) => String(r?.contentId || "").trim() === contentId) ||
      royaltyRows.find((r) => String(r?.title || "").trim().toLowerCase() === contentTitle);
    if (!row) return null;
    const total = Number(row.totalSalesSats || 0);
    const allocation = Number(row.allocationSats || 0);
    const sharePct = Number.isFinite(total) && total > 0 ? (allocation / total) * 100 : NaN;
    return {
      shareLabel: Number.isFinite(sharePct) ? `${sharePct % 1 === 0 ? sharePct.toFixed(0) : sharePct.toFixed(1)}%` : "—",
      accruedSats: Number(row.settledSats || 0) || 0,
      pendingSats: Number(row.pendingSats || 0) || 0,
      paidSats: Number(row.withdrawnSats || 0) || 0
    };
  }, [royaltyRows, selectedSale?.content?.id, selectedSale?.contentId]);

  React.useEffect(() => {
    if (!filteredSales.length) {
      setSelectedSaleId(null);
      return;
    }
    if (!selectedSaleId || !filteredSales.some((row) => row.id === selectedSaleId)) {
      setSelectedSaleId(filteredSales[0].id);
    }
  }, [filteredSales, selectedSaleId]);

  if (disabled) {
    return <LockedFeaturePanel title="Revenue" />;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Sales</div>
        <div className="text-sm text-neutral-400 mt-1">Sales events for your works, with fees and net after fees.</div>
        <div className="mt-3">
          <TimeScopeControls
            basis={timeBasis}
            onBasisChange={setTimeBasis}
            period={timePeriod}
            onPeriodChange={setTimePeriod}
            basisOptions={["sale", "earned", "paid"]}
            periodOptions={["1d", "7d", "30d", "90d", "all"]}
            helperText={
              timeBasis === "paid"
                ? "View uses paid/remitted timestamps in the selected period, with sale-recognized fallback when remitted time is missing."
                : timeBasis === "earned"
                  ? "View uses earned/recognized timestamps in the selected period."
                  : "View uses sale-recognized buyer payment timestamps in the selected period."
            }
          />
        </div>
      </div>

      {error ? <div className="text-sm text-red-300">{error}</div> : null}

      {delegatedMode !== "none" ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-base font-semibold">Delegated Revenue Snapshot</div>
          <div className="mt-1 text-sm text-neutral-400">
            {delegatedMode === "fresh"
              ? "Provider-backed mode (fresh data)"
              : delegatedMode === "offline_snapshot"
                ? "Offline snapshot (stale but persisted)"
                : delegatedMode === "not_provider_mode"
                  ? "Provider-backed mode not active"
                  : "Unavailable"}
          </div>
          <div className="mt-2 text-xs text-neutral-500">
            Snapshot reflects provider-node settlement reporting for delegated commerce paths.
          </div>
          {delegatedMsg ? <div className="mt-2 text-xs text-neutral-500">{delegatedMsg}</div> : null}
          <div className="mt-2 grid gap-1 text-xs text-neutral-500 sm:grid-cols-2">
            <div>Last sync: {delegatedLastSyncAt ? new Date(delegatedLastSyncAt).toLocaleString() : "—"}</div>
            <div>Snapshot as-of: {delegatedSnapshotAsOf ? new Date(delegatedSnapshotAsOf).toLocaleString() : "—"}</div>
          </div>
          {delegatedRows.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-400">
                    <th className="py-2 px-3">Content</th>
                    <th className="py-2 px-3">Gross</th>
                    <th className="py-2 px-3">Invoicing Fee</th>
                    <th className="py-2 px-3">Hosting Fee</th>
                    <th className="py-2 px-3">Provider Fee</th>
                    <th className="py-2 px-3">Net After Fees</th>
                    <th className="py-2 px-3">Node</th>
                    <th className="py-2 px-3">Last Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {delegatedRows.map((row) => (
                    <tr key={row.content_id} className="border-t border-neutral-800">
                      <td className="py-2 px-3 font-mono text-xs">{row.content_id}</td>
                      <td className="py-2 px-3">{formatSats(row.gross_sats)} sats</td>
                      <td className="py-2 px-3">{formatSats(row.provider_invoicing_fee_sats ?? 0)} sats</td>
                      <td className="py-2 px-3">{formatSats(row.provider_durable_hosting_fee_sats ?? 0)} sats</td>
                      <td className="py-2 px-3">{formatSats(row.provider_fee_sats)} sats</td>
                      <td className="py-2 px-3">{formatSats(row.creator_net_sats)} sats</td>
                      <td className="py-2 px-3">{row.payout_rail || "—"}</td>
                      <td className="py-2 px-3 text-xs text-neutral-500">{new Date(row.last_updated).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Buyer Gross</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(totals.gross)} sats</div>
          <div className="mt-1 text-[11px] text-neutral-500">Time: selected period · Basis: {timeBasis === "paid" ? "paid/remitted-time fallback" : timeBasis === "earned" ? "earned-time" : "sale-time"} · Layer: gross sales</div>
        </div>
        {hasInvoiceCommerce ? (
          <>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Invoicing Fee</div>
              <div className="mt-2 text-xl font-semibold">{formatSats(totals.providerInvoicingFee)} sats</div>
              <div className="mt-1 text-[11px] text-neutral-500">Time: selected period · Basis: sale settlement rows · Layer: commerce fee</div>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Durable Hosting Fee</div>
              <div className="mt-2 text-xl font-semibold">{formatSats(totals.providerDurableHostingFee)} sats</div>
              <div className="mt-1 text-[11px] text-neutral-500">Time: selected period · Basis: sale settlement rows · Layer: commerce fee</div>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Total Fees</div>
              <div className="mt-2 text-xl font-semibold">{formatSats(totals.providerFee)} sats</div>
              <div className="mt-1 text-[11px] text-neutral-500">Time: selected period · Basis: sale settlement rows · Layer: total commerce fees</div>
            </div>
          </>
        ) : null}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Net After Fees</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(totals.creatorNet)} sats</div>
          <div className="text-xs text-neutral-500 mt-1">Time: selected period · Basis: sale settlement rows · Layer: net entitlement after fees.</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-base font-semibold">Sales</div>
          <div className="text-sm text-neutral-400 mt-1">Recognized revenue events.</div>
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs">
            <span className="text-neutral-500">Scope:</span>
            {contentScopeId ? (
              <>
                <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-neutral-200">
                  {selectedSale?.content?.title || "Content"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setContentScopeId(null);
                    setSelectedSaleId(scopedSales[0]?.id || null);
                  }}
                  className="rounded-full border border-neutral-700 px-3 py-1 text-neutral-300 hover:bg-neutral-800/60"
                >
                  Clear scope
                </button>
              </>
            ) : (
              <span className="text-neutral-500">All sales</span>
            )}
          </div>

          <div className="mt-3">
            <div className="text-xs text-neutral-500">Filter rows:</div>
            <div className="mt-2 grid gap-2 rounded-lg border border-neutral-800 bg-neutral-900/30 p-2 text-xs md:grid-cols-4">
              <label className="flex items-center gap-2 text-neutral-400">
                <span>Content</span>
                <input
                  value={contentFilter}
                  onChange={(e) => setContentFilter(e.target.value)}
                  placeholder="Search title..."
                  className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
                />
              </label>
              <label className="flex items-center gap-2 text-neutral-400">
                <span>Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
                >
                  <option value="all">All</option>
                  {availableStatuses.map((status) => (
                    <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-neutral-400">
                <span>Source</span>
                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
                >
                  <option value="all">All</option>
                  {availableSources.map((source) => (
                    <option key={source} value={source}>{source.charAt(0).toUpperCase() + source.slice(1)}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-neutral-400">
                <span>Role</span>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
                >
                  <option value="all">All</option>
                  {availableRoles.map((role) => (
                    <option key={role} value={role}>{role.charAt(0).toUpperCase() + role.slice(1)}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-400">
                  <th className="py-2 px-3">Recognized</th>
                  <th className="py-2 px-3">Item</th>
                  <th className="py-2 px-3">Buyer Amount</th>
                  {hasInvoiceCommerce ? <th className="py-2 px-3">Invoicing Fee</th> : null}
                  {hasInvoiceCommerce ? <th className="py-2 px-3">Durable Hosting Fee</th> : null}
                  {hasInvoiceCommerce ? <th className="py-2 px-3">Total Fees</th> : null}
                  <th className="py-2 px-3">Net After Fees</th>
                  <th className="py-2 px-3">Settlement Node</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={hasInvoiceCommerce ? 8 : 5} className="py-4 px-3 text-sm text-neutral-400">
                      Loading sales ledger…
                    </td>
                  </tr>
                ) : null}
                {!loading && filteredSales.length === 0 ? (
                  <tr>
                    <td colSpan={hasInvoiceCommerce ? 8 : 5} className="py-4 px-3 text-sm text-neutral-400">
                      {sales.length === 0 ? "No sales recorded yet." : contentScopeId ? "No sales rows for this work in the selected scope." : "No sales rows in the selected scope."}
                    </td>
                  </tr>
                ) : null}
                {!loading &&
                  filteredSales.map((s) => {
                    const isScoped = selectedSale?.id === s.id;
                    return (
                      <tr
                        key={s.id}
                        className={`border-t border-neutral-800 cursor-pointer ${isScoped ? "bg-neutral-900/40" : "hover:bg-neutral-900/30"}`}
                        onClick={() => {
                          setSelectedSaleId(s.id);
                          setContentScopeId(String(s.content?.id || s.contentId || "").trim() || null);
                        }}
                      >
                        <td className="py-2 px-3 text-xs text-neutral-400">{new Date(s.recognizedAt).toLocaleString()}</td>
                        <td className="py-2 px-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-neutral-200">{s.content?.title || "Content"}</span>
                            <span className="text-[11px] text-neutral-500">{isScoped ? "Scoped" : "Details >"}</span>
                          </div>
                        </td>
                        <td className="py-2 px-3">{formatSats(s.grossAmountSats ?? s.amountSats)} {s.currency || "SAT"}</td>
                        {hasInvoiceCommerce ? <td className="py-2 px-3">{formatSats(s.providerInvoicingFeeSats ?? s.providerFeeSats ?? 0)} SAT</td> : null}
                        {hasInvoiceCommerce ? <td className="py-2 px-3">{formatSats(s.providerDurableHostingFeeSats ?? 0)} SAT</td> : null}
                        {hasInvoiceCommerce ? <td className="py-2 px-3">{formatSats(s.providerFeeSats ?? 0)} SAT</td> : null}
                        <td className="py-2 px-3">{formatSats(s.creatorNetSats ?? s.amountSats)} SAT</td>
                        <td className="py-2 px-3" title={String(s.rail || "") || undefined}>{settlementNodeLabel(s)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/30 p-3 text-xs text-neutral-500 lg:hidden">
            <div className="font-semibold text-neutral-300">Scoped work details</div>
            <div className="mt-1">Select a row to open actions and audit evidence.</div>
            {selectedSale?.content?.id ? (
              <div className="mt-3 space-y-2">
                <div className="text-neutral-300">{selectedSale.content.title || "Content"}</div>
                {scopedWorkTotals ? (
                  <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-neutral-500">Earnings snapshot (this work)</div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <div className="text-neutral-500">Events</div>
                        <div className="text-neutral-200">{scopedWorkTotals.events}</div>
                      </div>
                      <div>
                        <div className="text-neutral-500">Gross</div>
                        <div className="text-neutral-200">{formatSats(scopedWorkTotals.gross)} sats</div>
                      </div>
                      <div>
                        <div className="text-neutral-500">Net</div>
                        <div className="text-neutral-200">{formatSats(scopedWorkTotals.net)} sats</div>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-2">
                  <div className="text-[10px] uppercase tracking-wide text-neutral-500">Locked split snapshot (this work)</div>
                  {scopedSplitSnapshot ? (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <div className="text-neutral-500">Your Share</div>
                        <div className="text-neutral-200">{scopedSplitSnapshot.shareLabel}</div>
                      </div>
                      <div>
                        <div className="text-neutral-500">Accrued</div>
                        <div className="text-neutral-200">{formatSats(scopedSplitSnapshot.accruedSats)} sats</div>
                      </div>
                      <div>
                        <div className="text-neutral-500">Pending</div>
                        <div className="text-neutral-200">{formatSats(scopedSplitSnapshot.pendingSats)} sats</div>
                      </div>
                      <div>
                        <div className="text-neutral-500">Paid</div>
                        <div className="text-neutral-200">{formatSats(scopedSplitSnapshot.paidSats)} sats</div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-neutral-500">No locked split snapshot available for this work yet.</div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openSplitEditorForContent(String(selectedSale.content?.id || ""))}
                    className="rounded-full border border-neutral-700 px-3 py-1.5 text-[11px] text-neutral-200 hover:bg-neutral-800/60"
                  >
                    Open split editor
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="hidden lg:block">
          <div className="sticky top-32 rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
            <div className="text-sm font-semibold">Scoped work details</div>
            <div className="mt-1 text-xs text-neutral-500">
              Actions and audit evidence for the currently scoped row.
            </div>
            {selectedSale?.content?.id ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Scoped Work</div>
                  <div className="mt-1 text-sm text-neutral-200">{selectedSale.content.title || "Content"}</div>
                  {scopedWorkTotals ? (
                    <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/50 p-2">
                      <div className="text-[10px] uppercase tracking-wide text-neutral-500">Earnings snapshot (this work)</div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <div className="text-neutral-500">Events</div>
                          <div className="text-neutral-200">{scopedWorkTotals.events}</div>
                        </div>
                        <div>
                          <div className="text-neutral-500">Gross</div>
                          <div className="text-neutral-200">{formatSats(scopedWorkTotals.gross)} sats</div>
                        </div>
                        <div>
                          <div className="text-neutral-500">Net</div>
                          <div className="text-neutral-200">{formatSats(scopedWorkTotals.net)} sats</div>
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-neutral-500">
                        Latest recognized:{" "}
                        {scopedWorkTotals.latestRecognizedAt
                          ? new Date(scopedWorkTotals.latestRecognizedAt).toLocaleString()
                          : "—"}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/50 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-neutral-500">Locked split snapshot (this work)</div>
                    {scopedSplitSnapshot ? (
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <div className="text-neutral-500">Your Share</div>
                          <div className="text-neutral-200">{scopedSplitSnapshot.shareLabel}</div>
                        </div>
                        <div>
                          <div className="text-neutral-500">Accrued</div>
                          <div className="text-neutral-200">{formatSats(scopedSplitSnapshot.accruedSats)} sats</div>
                        </div>
                        <div>
                          <div className="text-neutral-500">Pending</div>
                          <div className="text-neutral-200">{formatSats(scopedSplitSnapshot.pendingSats)} sats</div>
                        </div>
                        <div>
                          <div className="text-neutral-500">Paid</div>
                          <div className="text-neutral-200">{formatSats(scopedSplitSnapshot.paidSats)} sats</div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 text-[11px] text-neutral-500">No locked split snapshot available for this work yet.</div>
                    )}
                  </div>
                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => openSplitEditorForContent(String(selectedSale.content?.id || ""))}
                      className="rounded-full border border-neutral-700 px-3 py-1.5 text-[11px] text-neutral-200 hover:bg-neutral-800/60"
                    >
                      Open split editor
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuditOpenSignal((n) => n + 1)}
                      className="rounded-full border border-neutral-700 px-3 py-1.5 text-[11px] text-neutral-200 hover:bg-neutral-800/60"
                    >
                      Refresh audit evidence
                    </button>
                  </div>
                </div>
                <div className="pt-1">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">Audit evidence</div>
                    <button
                      type="button"
                      onClick={() => setShowScopedAudit((s) => !s)}
                      className="rounded-full border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800/60"
                    >
                      {showScopedAudit ? "Hide audit" : "Show audit"}
                    </button>
                  </div>
                  {showScopedAudit ? (
                    <AuditPanel
                      scopeType="content"
                      scopeId={String(selectedSale.content.id)}
                      title="Audit"
                      defaultOpen
                      exportName={`content-audit-${selectedSale.content.id}.json`}
                      openSignal={auditOpenSignal}
                      eventFilter="commerce"
                      bodyMaxHeightClass="max-h-[22rem]"
                    />
                  ) : (
                    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs text-neutral-500">
                      Audit is hidden to keep Sales table first. Use “Show audit” when needed.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-3 text-xs text-neutral-500">
                {contentScopedSales.length ? "Selected row has no content scope." : sales.length ? "No sales rows in this period." : "No sales recorded yet."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
