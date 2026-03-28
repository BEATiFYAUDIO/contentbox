import React from "react";
import { api } from "../lib/api";
import AuditPanel from "../components/AuditPanel";
import LockedFeaturePanel from "../components/LockedFeaturePanel";
import { readDelegatedRevenue, upsertDelegatedRevenue, type DelegatedRevenueRow } from "../lib/delegatedRevenueStore";

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

type SalesPageProps = {
  productTier?: string;
  disabled?: boolean;
  hasInvoiceCommerce?: boolean;
  onOpenEarningsForContent?: (contentId: string, title: string) => void;
};

export default function SalesPage({
  disabled = false,
  hasInvoiceCommerce = false,
  onOpenEarningsForContent
}: SalesPageProps) {
  const [sales, setSales] = React.useState<SaleRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [delegatedRows, setDelegatedRows] = React.useState<DelegatedRevenueRow[]>([]);
  const [delegatedMode, setDelegatedMode] = React.useState<"fresh" | "offline_snapshot" | "not_provider_mode" | "none">("none");
  const [delegatedMsg, setDelegatedMsg] = React.useState<string | null>(null);
  const [delegatedLastSyncAt, setDelegatedLastSyncAt] = React.useState<string | null>(null);
  const [delegatedSnapshotAsOf, setDelegatedSnapshotAsOf] = React.useState<string | null>(null);
  const [selectedAuditContent, setSelectedAuditContent] = React.useState<{ id: string; title: string } | null>(null);
  const [auditOpenSignal, setAuditOpenSignal] = React.useState(0);

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
      const salesRes = await api<SaleRow[]>("/api/revenue/sales", "GET");
      setSales(salesRes || []);
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

  const totals = React.useMemo(() => {
    return sales.reduce(
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
  }, [sales]);

  if (disabled) {
    return <LockedFeaturePanel title="Revenue" />;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Sales</div>
        <div className="text-sm text-neutral-400 mt-1">Sales events for your works, with fees and net after fees.</div>
        <div className="text-xs text-neutral-500 mt-2">
          This page is sales input only. Your share is in Earnings. Payout execution is in Payouts.
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          Share and participation for those earnings are defined in Royalties.
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
        </div>
        {hasInvoiceCommerce ? (
          <>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Invoicing Fee</div>
              <div className="mt-2 text-xl font-semibold">{formatSats(totals.providerInvoicingFee)} sats</div>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Durable Hosting Fee</div>
              <div className="mt-2 text-xl font-semibold">{formatSats(totals.providerDurableHostingFee)} sats</div>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Total Fees</div>
              <div className="mt-2 text-xl font-semibold">{formatSats(totals.providerFee)} sats</div>
            </div>
          </>
        ) : null}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Net After Fees</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(totals.creatorNet)} sats</div>
          <div className="text-xs text-neutral-500 mt-1">Distributable net after settlement fees.</div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
        <div className="text-base font-semibold">Sales</div>
        <div className="text-sm text-neutral-400 mt-1">Recognized revenue events.</div>
        {hasInvoiceCommerce ? (
          <div className="mt-2 text-xs text-neutral-500">
            Fee truth: invoicing and durable-hosting fees are shown only for invoice-based commerce rows.
          </div>
        ) : null}
        <div className="mt-1 text-xs text-neutral-500">
          This page is sales input only. Your share is in Earnings. Payout execution details are in Payouts.
        </div>
        <div className="mt-1 text-xs text-neutral-500">
          Where relationships go, money flows: Royalties defines participation and share for these works.
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
              {!loading && sales.length === 0 ? (
                <tr>
                  <td colSpan={hasInvoiceCommerce ? 8 : 5} className="py-4 px-3 text-sm text-neutral-400">
                    No sales recorded yet.
                  </td>
                </tr>
              ) : null}
              {!loading &&
                sales.map((s) => (
                  <tr key={s.id} className="border-t border-neutral-800">
                    <td className="py-2 px-3 text-xs text-neutral-400">{new Date(s.recognizedAt).toLocaleString()}</td>
                    <td className="py-2 px-3">
                      <div className="text-neutral-200">{s.content?.title || "Content"}</div>
                      {s.content?.id ? (
                        <div className="mt-1 flex flex-wrap gap-2">
                          <a
                            href={`/royalties/${encodeURIComponent(String(s.content.id))}`}
                            className="rounded-md border border-neutral-700 px-2 py-0.5 text-[11px] hover:bg-neutral-800/60"
                          >
                            View locked split terms
                          </a>
                          {onOpenEarningsForContent ? (
                            <button
                              type="button"
                              onClick={() =>
                                onOpenEarningsForContent(
                                  String(s.content?.id || ""),
                                  String(s.content?.title || "Content")
                                )
                              }
                              className="rounded-md border border-neutral-700 px-2 py-0.5 text-[11px] hover:bg-neutral-800/60"
                            >
                              View earnings for this work
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              if (!s.content?.id) return;
                              setSelectedAuditContent({
                                id: String(s.content.id),
                                title: String(s.content.title || "Content")
                              });
                              setAuditOpenSignal((n) => n + 1);
                            }}
                            className="rounded-md border border-neutral-700 px-2 py-0.5 text-[11px] hover:bg-neutral-800/60"
                          >
                            Audit info
                          </button>
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 px-3">{formatSats(s.grossAmountSats ?? s.amountSats)} {s.currency || "SAT"}</td>
                    {hasInvoiceCommerce ? <td className="py-2 px-3">{formatSats(s.providerInvoicingFeeSats ?? s.providerFeeSats ?? 0)} SAT</td> : null}
                    {hasInvoiceCommerce ? <td className="py-2 px-3">{formatSats(s.providerDurableHostingFeeSats ?? 0)} SAT</td> : null}
                    {hasInvoiceCommerce ? <td className="py-2 px-3">{formatSats(s.providerFeeSats ?? 0)} SAT</td> : null}
                    <td className="py-2 px-3">{formatSats(s.creatorNetSats ?? s.amountSats)} SAT</td>
                    <td className="py-2 px-3">{s.rail}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Content audit evidence</div>
            <div className="text-xs text-neutral-500 mt-1">
              Use <span className="text-neutral-300">Audit info</span> on a content row to open evidence for that work.
            </div>
          </div>
          {selectedAuditContent ? (
            <button
              type="button"
              onClick={() => setSelectedAuditContent(null)}
              className="rounded-lg border border-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-900"
            >
              Clear
            </button>
          ) : null}
        </div>
        {selectedAuditContent ? (
          <div className="mt-3 space-y-2">
            <div className="text-xs text-neutral-400">
              Showing audit for <span className="text-neutral-200">{selectedAuditContent.title}</span>
            </div>
            <AuditPanel
              scopeType="content"
              scopeId={selectedAuditContent.id}
              title="Audit"
              exportName={`content-audit-${selectedAuditContent.id}.json`}
              openSignal={auditOpenSignal}
            />
          </div>
        ) : (
          <div className="mt-3 text-xs text-neutral-500">No content selected yet.</div>
        )}
      </div>
    </div>
  );
}
