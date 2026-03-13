import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

type ProviderSummary = {
  delegatedCreators: number;
  publishedItems: number;
  activePaymentIntents: number;
  settledPayments: number;
  totals?: {
    grossCollectedSats: string;
    providerFeeEarnedSats: string;
    creatorNetOwedSats: string;
    creatorNetPaidSats: string;
    creatorNetPendingSats: string;
  };
};

type ProviderCreatorLink = {
  id: string;
  providerNodeId: string;
  creatorNodeId: string;
  creatorDisplayName: string | null;
  providerEndpoint: string | null;
  trustStatus: "unknown" | "verified" | "blocked";
  handshakeStatus: "none" | "accepted" | "failed";
  executionAllowed: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProviderDelegatedPublish = {
  id: string;
  providerNodeId: string;
  creatorNodeId: string;
  contentId: string;
  title: string | null;
  contentType: string | null;
  manifestHash: string;
  visibility: "DISABLED" | "UNLISTED" | "LISTED";
  publishReceiptId: string | null;
  publishedAt: string;
  status: "published" | "failed";
  createdAt: string;
  updatedAt: string;
};

type ProviderPaymentIntent = {
  id: string;
  providerNodeId: string;
  creatorNodeId: string;
  contentId: string | null;
  paymentIntentId: string;
  bolt11: string | null;
  providerInvoiceRef: string | null;
  amountSats: string;
  grossAmountSats: string;
  providerFeeSats: string;
  creatorNetSats: string;
  status: "created" | "issued" | "paid" | "cancelled" | "expired";
  payoutStatus: "pending" | "paid" | "failed";
  payoutRail: "provider_custody" | "forwarded" | "creator_node" | null;
  paymentReceiptId: string | null;
  buyerSessionId: string | null;
  createdAt: string;
  paidAt: string | null;
  updatedAt: string;
};

type ProviderPaymentReceipt = {
  id: string;
  providerNodeId: string;
  creatorNodeId: string;
  contentId: string | null;
  paymentIntentId: string;
  paymentReceiptId: string;
  bolt11: string | null;
  amountSats: string;
  paidAt: string;
  createdAt: string;
  updatedAt: string;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleString();
}

function statusPillClass(status: string) {
  if (status === "verified" || status === "accepted" || status === "published" || status === "paid") {
    return "border-emerald-800/70 bg-emerald-900/20 text-emerald-300";
  }
  if (status === "created" || status === "issued" || status === "unknown") {
    return "border-amber-800/70 bg-amber-900/20 text-amber-300";
  }
  return "border-neutral-700 bg-neutral-900/50 text-neutral-300";
}

function sats(raw: string | number | null | undefined) {
  const n = Number(raw || 0);
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString();
}

function ExecutionPill({ allowed }: { allowed: boolean }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]",
        allowed ? "border-emerald-800/70 bg-emerald-900/20 text-emerald-300" : "border-amber-800/70 bg-amber-900/20 text-amber-300"
      ].join(" ")}
    >
      {allowed ? "Allowed" : "Blocked"}
    </span>
  );
}

export default function ProviderConsolePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ProviderSummary | null>(null);
  const [creatorLinks, setCreatorLinks] = useState<ProviderCreatorLink[]>([]);
  const [delegatedPublishes, setDelegatedPublishes] = useState<ProviderDelegatedPublish[]>([]);
  const [paymentIntents, setPaymentIntents] = useState<ProviderPaymentIntent[]>([]);
  const [paymentReceipts, setPaymentReceipts] = useState<ProviderPaymentReceipt[]>([]);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<
    "all" | "created" | "issued" | "paid" | "cancelled" | "expired"
  >("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, creatorLinksRes, delegatedPublishesRes, paymentIntentsRes, paymentReceiptsRes] = await Promise.all([
        api<ProviderSummary>("/api/provider/summary", "GET"),
        api<{ items: ProviderCreatorLink[] }>("/api/provider/creator-links", "GET"),
        api<{ items: ProviderDelegatedPublish[] }>("/api/provider/delegated-publishes", "GET"),
        api<{ items: ProviderPaymentIntent[] }>("/api/provider/payment-intents", "GET"),
        api<{ items: ProviderPaymentReceipt[] }>("/api/provider/payment-receipts", "GET")
      ]);
      setSummary(summaryRes || null);
      setCreatorLinks(Array.isArray(creatorLinksRes?.items) ? creatorLinksRes.items : []);
      setDelegatedPublishes(Array.isArray(delegatedPublishesRes?.items) ? delegatedPublishesRes.items : []);
      setPaymentIntents(Array.isArray(paymentIntentsRes?.items) ? paymentIntentsRes.items : []);
      setPaymentReceipts(Array.isArray(paymentReceiptsRes?.items) ? paymentReceiptsRes.items : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load provider console.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summaryCards = [
    { label: "Delegated Creators", value: summary?.delegatedCreators ?? creatorLinks.length },
    { label: "Published Items", value: summary?.publishedItems ?? delegatedPublishes.length },
    { label: "Active Payment Intents", value: summary?.activePaymentIntents ?? paymentIntents.filter((p) => p.status === "created" || p.status === "issued").length },
    { label: "Settled Payments", value: summary?.settledPayments ?? paymentReceipts.length }
  ];
  const economicsCards = [
    { label: "Gross Collected", value: `${sats(summary?.totals?.grossCollectedSats)} sats` },
    { label: "Provider Fee Earned", value: `${sats(summary?.totals?.providerFeeEarnedSats)} sats` },
    { label: "Creator Net Owed", value: `${sats(summary?.totals?.creatorNetOwedSats)} sats` },
    { label: "Creator Net Pending", value: `${sats(summary?.totals?.creatorNetPendingSats)} sats` }
  ];
  const visiblePaymentIntents =
    paymentStatusFilter === "all" ? paymentIntents : paymentIntents.filter((intent) => intent.status === paymentStatusFilter);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold">Provider Console</div>
            <div className="mt-1 text-sm text-neutral-400">
              Manage delegated creator relationships, delegated publishes, and provider-side payment intents.
            </div>
          </div>
          <button
            onClick={load}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800/60"
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {error ? <div className="mt-3 text-xs text-rose-300">{error}</div> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">{card.label}</div>
            <div className="mt-2 text-2xl font-semibold text-neutral-100">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {economicsCards.map((card) => (
          <div key={card.label} className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">{card.label}</div>
            <div className="mt-2 text-2xl font-semibold text-neutral-100">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="text-sm font-semibold">Delegated Creators</div>
        <div className="mt-1 text-xs text-neutral-500">Relationship records between this provider node and delegated creator nodes.</div>
        {creatorLinks.length === 0 ? (
          <div className="mt-3 text-sm text-neutral-400">No delegated creator links yet.</div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Creator</th>
                  <th className="py-2 pr-3 font-medium">Trust</th>
                  <th className="py-2 pr-3 font-medium">Handshake</th>
                  <th className="py-2 pr-3 font-medium">Execution</th>
                  <th className="py-2 pr-3 font-medium">Last Seen</th>
                  <th className="py-2 pr-3 font-medium">Endpoint</th>
                </tr>
              </thead>
              <tbody>
                {creatorLinks.map((row) => (
                  <tr key={row.id} className="border-t border-neutral-800/70">
                    <td className="py-2 pr-3 align-top">
                      <div className="text-neutral-100">{row.creatorDisplayName || "Delegated creator"}</div>
                      <div className="text-xs text-neutral-500 break-all">{row.creatorNodeId}</div>
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(row.trustStatus)}`}>
                        {row.trustStatus}
                      </span>
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(row.handshakeStatus)}`}>
                        {row.handshakeStatus}
                      </span>
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <ExecutionPill allowed={row.executionAllowed} />
                    </td>
                    <td className="py-2 pr-3 align-top text-neutral-300">{formatDate(row.lastSeenAt)}</td>
                    <td className="py-2 pr-3 align-top text-neutral-300 break-all">{row.providerEndpoint || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="text-sm font-semibold">Delegated Publishes</div>
        <div className="mt-1 text-xs text-neutral-500">Content publish events executed through this provider node.</div>
        {delegatedPublishes.length === 0 ? (
          <div className="mt-3 text-sm text-neutral-400">No delegated publish records yet.</div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[1020px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Title</th>
                  <th className="py-2 pr-3 font-medium">Creator Node</th>
                  <th className="py-2 pr-3 font-medium">Visibility</th>
                  <th className="py-2 pr-3 font-medium">Receipt</th>
                  <th className="py-2 pr-3 font-medium">Manifest Hash</th>
                  <th className="py-2 pr-3 font-medium">Published</th>
                </tr>
              </thead>
              <tbody>
                {delegatedPublishes.map((row) => (
                  <tr key={row.id} className="border-t border-neutral-800/70">
                    <td className="py-2 pr-3 align-top">
                      <div className="text-neutral-100">{row.title || row.contentId}</div>
                      <div className="text-xs text-neutral-500">{row.contentType || "unknown type"}</div>
                    </td>
                    <td className="py-2 pr-3 align-top text-neutral-300 break-all">{row.creatorNodeId}</td>
                    <td className="py-2 pr-3 align-top">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(row.status)}`}>
                        {row.visibility.toLowerCase()} / {row.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 align-top text-neutral-300 break-all">{row.publishReceiptId || "—"}</td>
                    <td className="py-2 pr-3 align-top text-neutral-300 break-all">{row.manifestHash}</td>
                    <td className="py-2 pr-3 align-top text-neutral-300">{formatDate(row.publishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Payment Settlements</div>
            <div className="mt-1 text-xs text-neutral-500">Provider-side BOLT11 intents, fee accounting, and creator net payout posture for delegated commerce.</div>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-neutral-400">
            <span>Status</span>
            <select
              value={paymentStatusFilter}
              onChange={(e) => setPaymentStatusFilter(e.target.value as any)}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
            >
              <option value="all">All</option>
              <option value="created">Created</option>
              <option value="issued">Issued</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
              <option value="expired">Expired</option>
            </select>
          </label>
        </div>
        {visiblePaymentIntents.length === 0 ? (
          <div className="mt-3 text-sm text-neutral-400">No payment intents yet.</div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[1220px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Payment Intent</th>
                  <th className="py-2 pr-3 font-medium">Creator Node</th>
                  <th className="py-2 pr-3 font-medium">Content</th>
                  <th className="py-2 pr-3 font-medium">BOLT11</th>
                  <th className="py-2 pr-3 font-medium">Amount</th>
                  <th className="py-2 pr-3 font-medium">Provider Fee</th>
                  <th className="py-2 pr-3 font-medium">Creator Net</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Payout</th>
                  <th className="py-2 pr-3 font-medium">Payout Rail</th>
                  <th className="py-2 pr-3 font-medium">Payment Receipt</th>
                  <th className="py-2 pr-3 font-medium">Created</th>
                  <th className="py-2 pr-3 font-medium">Paid</th>
                </tr>
              </thead>
              <tbody>
                {visiblePaymentIntents.map((row) => (
                  <tr key={row.id} className="border-t border-neutral-800/70">
                    <td className="py-2 pr-3 align-top">
                      <div className="text-neutral-100">{row.paymentIntentId}</div>
                      <div className="text-xs text-neutral-500">{row.providerInvoiceRef || "No provider invoice ref"}</div>
                    </td>
                    <td className="py-2 pr-3 align-top text-neutral-300 break-all">{row.creatorNodeId}</td>
                    <td className="py-2 pr-3 align-top text-neutral-300 break-all">{row.contentId || "—"}</td>
                    <td className="py-2 pr-3 align-top text-neutral-300">
                      <span className="block max-w-[320px] truncate" title={row.bolt11 || ""}>
                        {row.bolt11 || "—"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 align-top text-neutral-300">{row.grossAmountSats || row.amountSats} sats</td>
                    <td className="py-2 pr-3 align-top text-neutral-300">{row.providerFeeSats} sats</td>
                    <td className="py-2 pr-3 align-top text-neutral-300">{row.creatorNetSats} sats</td>
                    <td className="py-2 pr-3 align-top">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(row.payoutStatus)}`}>
                        {row.payoutStatus}
                      </span>
                    </td>
                    <td className="py-2 pr-3 align-top text-neutral-300">{row.payoutRail || "—"}</td>
                    <td className="py-2 pr-3 align-top text-neutral-300 break-all">{row.paymentReceiptId || "—"}</td>
                    <td className="py-2 pr-3 align-top text-neutral-300">{formatDate(row.createdAt)}</td>
                    <td className="py-2 pr-3 align-top text-neutral-300">{formatDate(row.paidAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
