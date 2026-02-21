import React from "react";
import { api } from "../lib/api";
import AuditPanel from "../components/AuditPanel";

type SaleRow = {
  id: string;
  contentId: string;
  manifestSha256?: string | null;
  amountSats: string | number;
  status: string;
  paidVia?: string | null;
  createdAt: string;
  receiptToken?: string | null;
  memo?: string | null;
  bolt11?: string | null;
  providerId?: string | null;
  onchainAddress?: string | null;
  destination?: { type: string; value: string } | null;
  content?: { id: string; title: string; type: string } | null;
};

type SalesPageProps = {
  productTier?: string;
};

export default function SalesPage({ productTier = "basic" }: SalesPageProps) {
  const [rows, setRows] = React.useState<SaleRow[]>([]);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [confirmRow, setConfirmRow] = React.useState<SaleRow | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [toastMsg, setToastMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setMsg(null);
        const data = await api<SaleRow[]>("/me/sales/payment-intents", "GET");
        if (!active) return;
        setRows(data || []);
      } catch (e: any) {
        if (!active) return;
        setMsg(e?.message || "Failed to load sales.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

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

  const isManualPending = (r: SaleRow) => {
    if (productTier !== "basic") return false;
    if (r.status === "paid") return false;
    return !r.bolt11 && !r.providerId && !r.onchainAddress;
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
        setRows((prev) =>
          prev.map((r) => (r.id === confirmRow.id ? { ...r, status: "paid", paidVia: r.paidVia || "lightning" } : r))
        );
        setToastMsg("Marked paid");
        setConfirmRow(null);
      }
    } catch (e: any) {
      setActionError(e?.message || "Failed to mark paid");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Revenue Ledger</div>
        <div className="text-sm text-neutral-400 mt-1">Track incoming payments and settle manual receipts.</div>
      </div>

      {msg ? <div className="text-sm text-red-300">{msg}</div> : null}

      <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-400">
              <th className="py-2 px-3">Date</th>
              <th className="py-2 px-3">Item</th>
              <th className="py-2 px-3">Amount (sats)</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="py-4 px-3 text-sm text-neutral-400">
                  Loading sales…
                </td>
              </tr>
            ) : null}
            {!loading &&
              rows.map((r) => {
                const manual = isManualPending(r);
                const statusLabel = manual ? "Pending (Manual)" : r.status;
                return (
                  <tr key={r.id} className="border-t border-neutral-800">
                    <td className="py-2 px-3 text-xs text-neutral-400">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="py-2 px-3">{r.content?.title || "Content"}</td>
                    <td className="py-2 px-3">{formatSats(r.amountSats)}</td>
                    <td className="py-2 px-3">{statusLabel}</td>
                    <td className="py-2 px-3">
                      {manual ? (
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
                );
              })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 px-3 text-sm text-neutral-400">
                  No sales yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AuditPanel scopeType="royalty" title="Audit" exportName="royalty-audit.json" />

      {confirmRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-950 p-5 text-neutral-100">
            <div className="text-lg font-semibold">Mark paid</div>
            <div className="text-sm text-neutral-400 mt-1">
              Confirm you received the manual payment before unlocking.
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <div>
                <span className="text-neutral-400">Amount:</span> {formatSats(confirmRow.amountSats)} sats
              </div>
              <div>
                <span className="text-neutral-400">Memo:</span>{" "}
                <span className="font-mono text-xs">
                  {confirmRow.memo || `CBX-${confirmRow.id.slice(-6).toUpperCase()}`}
                </span>
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
