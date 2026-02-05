import React from "react";
import { api } from "../lib/api";
import AuditPanel from "../components/AuditPanel";

type ReceiptStatus = {
  paymentStatus: "pending" | "paid" | "failed" | "expired";
  paymentIntentId: string;
  contentId: string;
  manifestSha256: string | null;
  canFulfill: boolean;
};

type FulfillPayload = {
  contentId: string;
  manifestSha256: string;
  manifestJson: any;
  files: Array<{
    objectKey: string;
    originalName: string;
    mime: string;
    sizeBytes: string | number;
    sha256: string;
  }>;
};

function apiBase() {
  const raw = ((import.meta as any).env?.VITE_API_URL || window.location.origin) as string;
  return raw.replace(/\/$/, "");
}

export default function ReceiptPage(props: { token: string }) {
  const [status, setStatus] = React.useState<ReceiptStatus | null>(null);
  const [fulfill, setFulfill] = React.useState<FulfillPayload | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const s = await api<ReceiptStatus>(`/public/receipts/${props.token}/status`, "GET");
        if (cancelled) return;
        setStatus(s);
        if (s.canFulfill) {
          const f = await api<FulfillPayload>(`/public/receipts/${props.token}/fulfill`, "GET");
          if (!cancelled) setFulfill(f);
        }
      } catch (e: any) {
        if (!cancelled) setMsg(e?.message || "Receipt not found");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [props.token]);

  const receiptLink = `${apiBase()}/public/receipts/${props.token}/status`;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Receipt</div>
        <div className="text-sm text-neutral-400 mt-1">Status and downloads for this purchase.</div>
        <div className="mt-3 text-xs text-neutral-400 break-all">Receipt link: {receiptLink}</div>
      </div>

      {msg ? <div className="text-sm text-red-300">{msg}</div> : null}

      {status && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
          <div className="text-sm text-neutral-400">Status</div>
          <div className="text-lg font-semibold">{status.paymentStatus}</div>
          <div className="mt-2 text-xs text-neutral-500">Content ID: {status.contentId}</div>
        </div>
      )}

      {fulfill && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
          <div className="text-sm text-neutral-400">Downloads</div>
          <div className="mt-3 space-y-2">
            {fulfill.files.map((f) => (
              <div key={f.objectKey} className="flex items-center justify-between gap-3 border border-neutral-800 rounded-lg px-3 py-2">
                <div className="text-sm">
                  <div className="font-medium">{f.originalName || f.objectKey}</div>
                  <div className="text-xs text-neutral-500">{f.mime}</div>
                </div>
                <a
                  className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                  href={`${apiBase()}/public/receipts/${props.token}/file?objectKey=${encodeURIComponent(f.objectKey)}`}
                >
                  Download
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      <AuditPanel scopeType="royalty" title="Audit" exportName="royalty-audit.json" />
    </div>
  );
}
