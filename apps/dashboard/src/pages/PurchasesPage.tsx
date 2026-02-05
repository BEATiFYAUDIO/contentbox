import React from "react";
import { api } from "../lib/api";
import AuditPanel from "../components/AuditPanel";

type PurchaseRow = {
  id: string;
  contentId: string;
  manifestSha256?: string | null;
  amountSats: string | number;
  status: string;
  paidVia?: string | null;
  createdAt: string;
  receiptToken?: string | null;
  content?: { id: string; title: string; type: string } | null;
};

export default function PurchasesPage(props: { onOpenReceipt: (token: string) => void }) {
  const [rows, setRows] = React.useState<PurchaseRow[]>([]);
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    api<PurchaseRow[]>("/me/purchases/payment-intents", "GET")
      .then(setRows)
      .catch((e: any) => setMsg(e?.message || "Failed to load purchases"));
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Purchase history</div>
        <div className="text-sm text-neutral-400 mt-1">Your payments and receipts.</div>
      </div>

      {msg ? <div className="text-sm text-red-300">{msg}</div> : null}

      <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-400">
              <th className="py-2 px-3">Date</th>
              <th className="py-2 px-3">Item</th>
              <th className="py-2 px-3">Amount (sats)</th>
              <th className="py-2 px-3">Rail</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-neutral-800">
                <td className="py-2 px-3 text-xs text-neutral-400">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="py-2 px-3">{r.content?.title || "Content"}</td>
                <td className="py-2 px-3">{String(r.amountSats)}</td>
                <td className="py-2 px-3">{r.paidVia || "-"}</td>
                <td className="py-2 px-3">{r.status}</td>
                <td className="py-2 px-3">
                  {r.receiptToken ? (
                    <button
                      onClick={() => props.onOpenReceipt(r.receiptToken!)}
                      className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                    >
                      View receipt
                    </button>
                  ) : (
                    <span className="text-xs text-neutral-500">—</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 px-3 text-sm text-neutral-400">
                  No purchases yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AuditPanel scopeType="royalty" title="Audit" exportName="royalty-audit.json" />
    </div>
  );
}
