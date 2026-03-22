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
  paidAt?: string | null;
  unlockedAt?: string | null;
  accessMode?: "stream_only" | "download_only" | "stream_and_download";
  canStream?: boolean;
  canDownload?: boolean;
  receiptToken?: string | null;
  content?: {
    id: string;
    title: string;
    type: string;
    owner?: { id: string; displayName?: string | null; email?: string | null } | null;
  } | null;
};

export default function PurchasesPage(props: { onOpenReceipt: (token: string) => void }) {
  const [rows, setRows] = React.useState<PurchaseRow[]>([]);
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    api<PurchaseRow[]>("/me/purchases/payment-intents", "GET")
      .then(setRows)
      .catch((e: any) => setMsg(e?.message || "Failed to load purchases"));
  }, []);

  const accessLabel = (r: PurchaseRow) => {
    const mode = String(r.accessMode || "").toLowerCase();
    if (mode === "stream_and_download") return "Stream + download";
    if (mode === "download_only") return "Download only";
    return "Stream only";
  };

  const openDownload = (r: PurchaseRow) => {
    if (!r.receiptToken) return;
    props.onOpenReceipt(r.receiptToken);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Purchase history</div>
        <div className="text-sm text-neutral-400 mt-1">Receipts and what each payment unlocked.</div>
      </div>

      {msg ? <div className="text-sm text-red-300">{msg}</div> : null}

      <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-400">
              <th className="py-2 px-3">Date</th>
              <th className="py-2 px-3">Item</th>
              <th className="py-2 px-3">Creator</th>
              <th className="py-2 px-3">Amount (sats)</th>
              <th className="py-2 px-3">Access unlocked</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-neutral-800">
                <td className="py-2 px-3 text-xs text-neutral-400">
                  <div>{new Date(r.createdAt).toLocaleString()}</div>
                  {r.unlockedAt ? <div className="text-[11px]">Unlocked: {new Date(r.unlockedAt).toLocaleString()}</div> : null}
                </td>
                <td className="py-2 px-3">
                  <div>{r.content?.title || "Content"}</div>
                  <div className="text-xs text-neutral-500">{String(r.content?.type || "file").toUpperCase()}</div>
                </td>
                <td className="py-2 px-3 text-xs text-neutral-300">
                  {r.content?.owner?.displayName || r.content?.owner?.email || "—"}
                </td>
                <td className="py-2 px-3">{String(r.amountSats)}</td>
                <td className="py-2 px-3 text-xs">
                  <div>{accessLabel(r)}</div>
                  <div className="text-neutral-500">{r.canStream ? "Stream" : "No stream"} · {r.canDownload ? "Download" : "No download"}</div>
                </td>
                <td className="py-2 px-3">
                  <div>{r.status}</div>
                  <div className="text-xs text-neutral-500">{r.paidVia || "-"}</div>
                </td>
                <td className="py-2 px-3">
                  <div className="flex flex-wrap gap-2">
                    <a
                      href="/library"
                      className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                    >
                      Open in Library
                    </a>
                    {r.content?.id ? (
                      <a
                        href={`/p/${encodeURIComponent(r.content.id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        Open content
                      </a>
                    ) : null}
                    {r.canDownload && r.receiptToken ? (
                      <button
                        onClick={() => openDownload(r)}
                        className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        Download
                      </button>
                    ) : null}
                    {r.receiptToken ? (
                      <button
                        onClick={() => props.onOpenReceipt(r.receiptToken!)}
                        className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        View receipt
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 px-3 text-sm text-neutral-400">
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
