import React from "react";
import { api } from "../lib/api";
import AuditPanel from "../components/AuditPanel";

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
  currency: string;
  rail: string;
  memo?: string | null;
  recognizedAt: string;
  content?: { id: string; title: string; type: string } | null;
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
    } catch (e: any) {
      setError(e?.message || "Failed to load revenue data");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (disabled) return;
    loadData();
  }, [loadData, disabled]);

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
        <div className="text-lg font-semibold">Revenue Ledger</div>
        <div className="text-sm text-neutral-400 mt-1">Unified sales tracking across payment rails.</div>
      </div>

      {error ? <div className="text-sm text-red-300">{error}</div> : null}

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
                <th className="py-2 px-3">Rail</th>
                <th className="py-2 px-3">Memo</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-4 px-3 text-sm text-neutral-400">
                    Loading sales ledger…
                  </td>
                </tr>
              ) : null}
              {!loading && sales.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 px-3 text-sm text-neutral-400">
                    No sales recorded yet.
                  </td>
                </tr>
              ) : null}
              {!loading &&
                sales.map((s) => (
                  <tr key={s.id} className="border-t border-neutral-800">
                    <td className="py-2 px-3 text-xs text-neutral-400">{new Date(s.recognizedAt).toLocaleString()}</td>
                    <td className="py-2 px-3">{s.content?.title || "Content"}</td>
                    <td className="py-2 px-3">{formatSats(s.amountSats)} {s.currency || "SAT"}</td>
                    <td className="py-2 px-3">{s.rail}</td>
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
