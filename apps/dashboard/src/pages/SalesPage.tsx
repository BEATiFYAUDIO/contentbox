import React from "react";
import { api } from "../lib/api";
import AuditPanel from "../components/AuditPanel";
import LockedFeaturePanel from "../components/LockedFeaturePanel";
import { readDelegatedRevenue, upsertDelegatedRevenue, type DelegatedRevenueRow } from "../lib/delegatedRevenueStore";

type PendingRow = {
  id: string;
  contentId: string;
  amountSats: string | number;
  status: string;
  memo?: string | null;
  createdAt: string;
  destination?: { type: string; value: string } | null;
  content?: { id: string; title: string; type: string } | null;
};

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
};

export default function SalesPage({ productTier = "basic", disabled = false }: SalesPageProps) {
  const [pending, setPending] = React.useState<PendingRow[]>([]);
  const [sales, setSales] = React.useState<SaleRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmRow, setConfirmRow] = React.useState<PendingRow | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [toastMsg, setToastMsg] = React.useState<string | null>(null);
  const [delegatedRows, setDelegatedRows] = React.useState<DelegatedRevenueRow[]>([]);
  const [delegatedMode, setDelegatedMode] = React.useState<"fresh" | "offline_snapshot" | "not_provider_mode" | "none">("none");
  const [delegatedMsg, setDelegatedMsg] = React.useState<string | null>(null);
  const [delegatedLastSyncAt, setDelegatedLastSyncAt] = React.useState<string | null>(null);
  const [delegatedSnapshotAsOf, setDelegatedSnapshotAsOf] = React.useState<string | null>(null);

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
      const [pendingRes, salesRes] = await Promise.all([
        api<PendingRow[]>("/api/revenue/pending-manual", "GET"),
        api<SaleRow[]>("/api/revenue/sales", "GET")
      ]);
      setPending(pendingRes || []);
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

  React.useEffect(() => {
    if (!toastMsg) return;
    const timer = window.setTimeout(() => setToastMsg(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toastMsg]);

  const formatSats = (raw: string | number) => {
    const n = Number(raw || 0);
    if (!Number.isFinite(n)) return "0";
    return Math.round(n).toLocaleString();
  };

  const copy = (text: string) => {
    if (!text || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).catch(() => {});
  };
  const payoutStatusLabel = (status?: SaleRow["payoutStatus"]) =>
    status === "forwarding"
      ? "Forwarding payout"
      : status === "paid"
        ? "Paid out"
        : status === "failed"
          ? "Payout failed"
          : "Pending payout";
  const payoutStatusTone = (status?: SaleRow["payoutStatus"]) =>
    status === "paid"
      ? "text-emerald-300"
      : status === "failed"
        ? "text-rose-300"
        : status === "forwarding"
          ? "text-amber-300"
          : "text-neutral-200";

  const totals = React.useMemo(() => {
    return sales.reduce(
      (acc, s) => {
        acc.gross += Number(s.grossAmountSats ?? s.amountSats ?? 0) || 0;
        acc.providerInvoicingFee += Number(s.providerInvoicingFeeSats ?? s.providerFeeSats ?? 0) || 0;
        acc.providerDurableHostingFee += Number(s.providerDurableHostingFeeSats ?? 0) || 0;
        acc.providerFee += Number(s.providerFeeSats ?? 0) || 0;
        acc.creatorNet += Number(s.creatorNetSats ?? s.amountSats ?? 0) || 0;
        if (s.payoutStatus === "paid") acc.payoutsReceived += Number(s.creatorNetSats ?? s.amountSats ?? 0) || 0;
        if (s.payoutStatus === "pending") acc.pendingPayout += Number(s.creatorNetSats ?? s.amountSats ?? 0) || 0;
        if (s.payoutStatus === "forwarding") acc.pendingPayout += Number(s.creatorNetSats ?? s.amountSats ?? 0) || 0;
        if (s.payoutStatus === "failed") acc.failedPayout += Number(s.creatorNetSats ?? s.amountSats ?? 0) || 0;
        return acc;
      },
      {
        gross: 0,
        providerInvoicingFee: 0,
        providerDurableHostingFee: 0,
        providerFee: 0,
        creatorNet: 0,
        payoutsReceived: 0,
        pendingPayout: 0,
        failedPayout: 0
      }
    );
  }, [sales]);

  const onConfirmMarkPaid = async () => {
    if (!confirmRow) return;
    setActionError(null);
    setActionLoading(true);
    try {
      const res = await api<{ ok: boolean; status: string; receiptToken?: string | null }>(
        `/api/payments/intents/${confirmRow.id}/mark-paid`,
        "POST"
      );
      if (res?.ok) {
        setPending((prev) => prev.filter((r) => r.id !== confirmRow.id));
        await loadData();
        setToastMsg("Marked paid");
        setConfirmRow(null);
      }
    } catch (e: any) {
      setActionError(e?.message || "Failed to mark paid");
    } finally {
      setActionLoading(false);
    }
  };

  if (disabled) {
    return <LockedFeaturePanel title="Revenue" />;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Revenue Ledger</div>
        <div className="text-sm text-neutral-400 mt-1">Unified sales tracking across payment rails.</div>
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
                    <th className="py-2 px-3">Creator Net</th>
                    <th className="py-2 px-3">Payout</th>
                    <th className="py-2 px-3">Rail</th>
                    <th className="py-2 px-3">Destination</th>
                    <th className="py-2 px-3">Remit Mode</th>
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
                      <td className="py-2 px-3">{row.payout_status}</td>
                      <td className="py-2 px-3">{row.payout_rail || "—"}</td>
                      <td className="py-2 px-3">{row.payout_destination_summary || row.payout_destination_type || "—"}</td>
                      <td className="py-2 px-3">{row.provider_remit_mode || "—"}</td>
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
          <div className="text-xs uppercase tracking-wide text-neutral-500">Gross Sales</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(totals.gross)} sats</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Provider Fee</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(totals.providerFee)} sats</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Provider Invoicing Fee</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(totals.providerInvoicingFee)} sats</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Provider Durable Hosting Fee</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(totals.providerDurableHostingFee)} sats</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Net Creator Earnings</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(totals.creatorNet)} sats</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Payouts Received</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(totals.payoutsReceived)} sats</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Pending Payout</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(totals.pendingPayout)} sats</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Failed Payout</div>
          <div className="mt-2 text-xl font-semibold">{formatSats(totals.failedPayout)} sats</div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
        <div className="text-base font-semibold">Pending manual payments</div>
        <div className="text-sm text-neutral-400 mt-1">Basic manual Lightning confirmations.</div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-400">
                <th className="py-2 px-3">Date</th>
                <th className="py-2 px-3">Item</th>
                <th className="py-2 px-3">Amount (sats)</th>
                <th className="py-2 px-3">Memo</th>
                <th className="py-2 px-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-4 px-3 text-sm text-neutral-400">
                    Loading pending payments…
                  </td>
                </tr>
              ) : null}
              {!loading && pending.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 px-3 text-sm text-neutral-400">
                    No pending manual payments.
                  </td>
                </tr>
              ) : null}
              {!loading &&
                pending.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-800">
                    <td className="py-2 px-3 text-xs text-neutral-400">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="py-2 px-3">{r.content?.title || "Content"}</td>
                    <td className="py-2 px-3">{formatSats(r.amountSats)}</td>
                    <td className="py-2 px-3 font-mono text-xs">{r.memo || "—"}</td>
                    <td className="py-2 px-3">
                      {productTier === "basic" ? (
                        <button
                          onClick={() => {
                            setActionError(null);
                            setConfirmRow(r);
                          }}
                          className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                        >
                          Mark paid
                        </button>
                      ) : (
                        <span className="text-xs text-neutral-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4">
        <div className="text-base font-semibold">Sales ledger</div>
        <div className="text-sm text-neutral-400 mt-1">Recognized revenue events.</div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-400">
                <th className="py-2 px-3">Recognized</th>
                <th className="py-2 px-3">Item</th>
                <th className="py-2 px-3">Amount</th>
                <th className="py-2 px-3">Invoicing Fee</th>
                <th className="py-2 px-3">Hosting Fee</th>
                <th className="py-2 px-3">Provider Fee</th>
                <th className="py-2 px-3">Creator Net</th>
                <th className="py-2 px-3">Rail</th>
                <th className="py-2 px-3">Payout</th>
                <th className="py-2 px-3">Destination</th>
                <th className="py-2 px-3">Memo</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="py-4 px-3 text-sm text-neutral-400">
                    Loading sales ledger…
                  </td>
                </tr>
              ) : null}
              {!loading && sales.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-4 px-3 text-sm text-neutral-400">
                    No sales recorded yet.
                  </td>
                </tr>
              ) : null}
              {!loading &&
                sales.map((s) => (
                  <tr key={s.id} className="border-t border-neutral-800">
                    <td className="py-2 px-3 text-xs text-neutral-400">{new Date(s.recognizedAt).toLocaleString()}</td>
                    <td className="py-2 px-3">{s.content?.title || "Content"}</td>
                    <td className="py-2 px-3">{formatSats(s.grossAmountSats ?? s.amountSats)} {s.currency || "SAT"}</td>
                    <td className="py-2 px-3">{formatSats(s.providerInvoicingFeeSats ?? s.providerFeeSats ?? 0)} SAT</td>
                    <td className="py-2 px-3">{formatSats(s.providerDurableHostingFeeSats ?? 0)} SAT</td>
                    <td className="py-2 px-3">{formatSats(s.providerFeeSats ?? 0)} SAT</td>
                    <td className="py-2 px-3">{formatSats(s.creatorNetSats ?? s.amountSats)} SAT</td>
                    <td className="py-2 px-3">{s.rail}</td>
                    <td className="py-2 px-3">
                      <div className={payoutStatusTone(s.payoutStatus)}>{payoutStatusLabel(s.payoutStatus)}</div>
                      <div className="text-xs text-neutral-500">{s.payoutRail || "creator_node"}</div>
                      {s.payoutStatus === "failed" ? <div className="text-xs text-neutral-500">Retry available</div> : null}
                    </td>
                    <td className="py-2 px-3">
                      <div>{s.payoutDestinationSummary || s.payoutDestinationType || "—"}</div>
                      <div className="text-xs text-neutral-500">{s.providerRemitMode || "self-received"}</div>
                      {s.remittedAt ? <div className="text-xs text-neutral-500">Remitted: {new Date(s.remittedAt).toLocaleString()}</div> : null}
                      {s.payoutLastError ? <div className="text-xs text-rose-300">{s.payoutLastError}</div> : null}
                    </td>
                    <td className="py-2 px-3 font-mono text-xs">{s.memo || "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <AuditPanel scopeType="royalty" title="Audit" exportName="royalty-audit.json" />

      {confirmRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-950 p-5 text-neutral-100">
            <div className="text-lg font-semibold">Mark paid</div>
            <div className="text-sm text-neutral-400 mt-1">Confirm you received the manual payment.</div>
            <div className="mt-4 space-y-2 text-sm">
              <div>
                <span className="text-neutral-400">Amount:</span> {formatSats(confirmRow.amountSats)} sats
              </div>
              <div>
                <span className="text-neutral-400">Memo:</span>{" "}
                <span className="font-mono text-xs">{confirmRow.memo || `CBX-${confirmRow.id.slice(-6).toUpperCase()}`}</span>
                <button
                  className="ml-2 text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                  onClick={() => copy(confirmRow.memo || `CBX-${confirmRow.id.slice(-6).toUpperCase()}`)}
                >
                  Copy memo
                </button>
              </div>
              {confirmRow.destination?.value ? (
                <div>
                  <span className="text-neutral-400">Destination:</span>{" "}
                  <span className="font-mono text-xs">{confirmRow.destination.value}</span>
                  <button
                    className="ml-2 text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                    onClick={() => copy(confirmRow.destination?.value || "")}
                  >
                    Copy address
                  </button>
                </div>
              ) : null}
              {actionError ? <div className="text-xs text-red-300">{actionError}</div> : null}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-md border border-neutral-800 px-3 py-2 text-xs hover:bg-neutral-900"
                onClick={() => setConfirmRow(null)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-black disabled:opacity-70"
                onClick={onConfirmMarkPaid}
                disabled={actionLoading}
              >
                {actionLoading ? "Marking…" : "Mark paid"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toastMsg ? (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-100">
          {toastMsg}
        </div>
      ) : null}
    </div>
  );
}
