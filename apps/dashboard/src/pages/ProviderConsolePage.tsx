import { Fragment, useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

type ProviderSummary = {
  delegatedCreators: number;
  publishedItems: number;
  activePaymentIntents: number;
  settledPayments: number;
  totals?: {
    grossCollectedSats: string;
    providerInvoicingFeeEarnedSats?: string;
    providerDurableHostingFeeEarnedSats?: string;
    providerFeeEarnedSats: string;
    creatorNetOwedSats: string;
    creatorNetPaidSats: string;
    creatorNetPendingSats: string;
    creatorNetFailedSats?: string;
  };
  participantPayouts?: {
    pending: number;
    ready: number;
    forwarding: number;
    paid: number;
    failed: number;
    blocked: number;
  };
};

type LightningRuntimeSnapshot = {
  connected?: boolean;
  canReceive?: boolean;
  canSend?: boolean;
  capabilityState?: string;
  sendFailureReason?: string | null;
};

type LightningAdminSnapshot = {
  configured: boolean;
  runtime?: LightningRuntimeSnapshot;
};

type LightningBalancesSnapshot = {
  wallet: {
    confirmedSats: number;
    unconfirmedSats: number;
    totalSats: number;
  };
  channels: {
    openCount: number;
    pendingOpenCount: number;
    pendingCloseCount: number;
  };
  liquidity: {
    outboundSats: number;
    inboundSats: number;
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
  providerInvoicingFeeSats: string;
  providerDurableHostingFeeSats: string;
  providerFeeSats: string;
  creatorNetSats: string;
  status: "created" | "issued" | "paid" | "cancelled" | "expired";
  payoutStatus: "pending" | "forwarding" | "paid" | "failed";
  payoutRail: "provider_custody" | "forwarded" | "creator_node" | null;
  payoutDestinationType: "lightning_address" | "local_lnd" | "onchain_address" | null;
  payoutDestinationSummary: string | null;
  providerRemitMode: "provider_custody" | "auto_forward" | "manual_payout" | null;
  payoutReference: string | null;
  remittedAt: string | null;
  payoutLastError: string | null;
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

type ParticipantPayoutRow = {
  id: string;
  allocationId: string;
  providerPaymentIntentId: string;
  paymentIntentId: string;
  amountSats: string;
  status: "pending" | "ready" | "forwarding" | "paid" | "failed" | "blocked";
  payoutRail: "provider_custody" | "forwarded" | "creator_node" | null;
  destinationType: string | null;
  destinationSummary: string | null;
  readinessReason: string | null;
  attemptCount: number;
  attemptId: string | null;
  payoutReference: string | null;
  lastError: string | null;
  blockedReason: string | null;
  remittedAt: string | null;
  lastCheckedAt: string | null;
  updatedAt: string;
  allocation?: {
    participantRef: string;
    participantUserId: string | null;
    participantEmail: string | null;
    role: string | null;
    bps: number;
    amountSats: string;
  } | null;
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
  if (status === "created" || status === "issued" || status === "forwarding" || status === "unknown") {
    return "border-amber-800/70 bg-amber-900/20 text-amber-300";
  }
  return "border-neutral-700 bg-neutral-900/50 text-neutral-300";
}

function sats(raw: string | number | null | undefined) {
  const n = Number(raw || 0);
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString();
}

function shortId(value: string | null | undefined, left = 12, right = 10) {
  const v = String(value || "").trim();
  if (!v) return "—";
  if (v.length <= left + right + 1) return v;
  return `${v.slice(0, left)}…${v.slice(-right)}`;
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

export default function ProviderConsolePage({ onOpenLightningConfig }: { onOpenLightningConfig?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ProviderSummary | null>(null);
  const [creatorLinks, setCreatorLinks] = useState<ProviderCreatorLink[]>([]);
  const [delegatedPublishes, setDelegatedPublishes] = useState<ProviderDelegatedPublish[]>([]);
  const [paymentIntents, setPaymentIntents] = useState<ProviderPaymentIntent[]>([]);
  const [paymentReceipts, setPaymentReceipts] = useState<ProviderPaymentReceipt[]>([]);
  const [participantPayouts, setParticipantPayouts] = useState<ParticipantPayoutRow[]>([]);
  const [remitBusyId, setRemitBusyId] = useState<string | null>(null);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<
    "all" | "created" | "issued" | "paid" | "cancelled" | "expired"
  >("all");
  const [expandedIntentIds, setExpandedIntentIds] = useState<Record<string, boolean>>({});
  const [lightningAdmin, setLightningAdmin] = useState<LightningAdminSnapshot | null>(null);
  const [lightningBalances, setLightningBalances] = useState<LightningBalancesSnapshot | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, creatorLinksRes, delegatedPublishesRes, paymentIntentsRes, paymentReceiptsRes, participantPayoutsRes, lightningAdminRes, lightningBalancesRes] = await Promise.all([
        api<ProviderSummary>("/api/provider/summary", "GET"),
        api<{ items: ProviderCreatorLink[] }>("/api/provider/creator-links", "GET"),
        api<{ items: ProviderDelegatedPublish[] }>("/api/provider/delegated-publishes", "GET"),
        api<{ items: ProviderPaymentIntent[] }>("/api/provider/payment-intents", "GET"),
        api<{ items: ProviderPaymentReceipt[] }>("/api/provider/payment-receipts", "GET"),
        api<{ items: ParticipantPayoutRow[] }>("/api/provider/participant-payouts", "GET"),
        api<LightningAdminSnapshot>("/api/admin/lightning", "GET"),
        api<LightningBalancesSnapshot>("/api/admin/lightning/balances", "GET")
      ]);
      setSummary(summaryRes || null);
      setCreatorLinks(Array.isArray(creatorLinksRes?.items) ? creatorLinksRes.items : []);
      setDelegatedPublishes(Array.isArray(delegatedPublishesRes?.items) ? delegatedPublishesRes.items : []);
      setPaymentIntents(Array.isArray(paymentIntentsRes?.items) ? paymentIntentsRes.items : []);
      setPaymentReceipts(Array.isArray(paymentReceiptsRes?.items) ? paymentReceiptsRes.items : []);
      setParticipantPayouts(Array.isArray(participantPayoutsRes?.items) ? participantPayoutsRes.items : []);
      setLightningAdmin(lightningAdminRes || null);
      setLightningBalances(lightningBalancesRes || null);
    } catch (e: any) {
      setError(e?.message || "Failed to load provider console.");
    } finally {
      setLoading(false);
    }
  }, []);

  const retryRemittance = useCallback(async (id: string) => {
    if (!id) return;
    setRemitBusyId(id);
    setError(null);
    try {
      await api(`/api/provider/payment-intents/${encodeURIComponent(id)}/retry-remittance`, "POST", {});
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to retry remittance.");
    } finally {
      setRemitBusyId(null);
    }
  }, [load]);

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
    { label: "Invoicing Fee Earned", value: `${sats(summary?.totals?.providerInvoicingFeeEarnedSats)} sats` },
    { label: "Durable Hosting Fee Earned", value: `${sats(summary?.totals?.providerDurableHostingFeeEarnedSats)} sats` },
    { label: "Provider Fee Earned", value: `${sats(summary?.totals?.providerFeeEarnedSats)} sats` },
    { label: "Creator Net Owed", value: `${sats(summary?.totals?.creatorNetOwedSats)} sats` },
    { label: "Creator Net Paid", value: `${sats(summary?.totals?.creatorNetPaidSats)} sats` },
    { label: "Creator Net Pending", value: `${sats(summary?.totals?.creatorNetPendingSats)} sats` },
    { label: "Creator Net Failed", value: `${sats(summary?.totals?.creatorNetFailedSats)} sats` }
  ];
  const visiblePaymentIntents =
    paymentStatusFilter === "all" ? paymentIntents : paymentIntents.filter((intent) => intent.status === paymentStatusFilter);
  const toggleIntentDetails = (id: string) => {
    setExpandedIntentIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const runtime = lightningAdmin?.runtime || null;
  const formatLightningSats = (value: number | null | undefined) => `${Math.round(Number(value || 0)).toLocaleString()} sats`;

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

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Commerce Wallet Source</div>
            <div className="mt-1 text-xs text-neutral-500">
              Local LND wallet on this machine handles commerce flows. Creator payout destinations are separate remittance targets.
            </div>
          </div>
          <button
            onClick={() => onOpenLightningConfig?.()}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800/60"
            type="button"
          >
            Open Lightning Config
          </button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4 text-xs">
          <div className="rounded border border-neutral-800 px-3 py-2">
            <div className="text-neutral-500">canReceive</div>
            <div className="text-neutral-100">{runtime?.canReceive ? "yes" : "no"}</div>
          </div>
          <div className="rounded border border-neutral-800 px-3 py-2">
            <div className="text-neutral-500">canSend</div>
            <div className="text-neutral-100">{runtime?.canSend ? "yes" : "no"}</div>
          </div>
          <div className="rounded border border-neutral-800 px-3 py-2">
            <div className="text-neutral-500">capability</div>
            <div className="text-neutral-100">{runtime?.capabilityState || "disconnected"}</div>
          </div>
          <div className="rounded border border-neutral-800 px-3 py-2">
            <div className="text-neutral-500">wallet total</div>
            <div className="text-neutral-100">{formatLightningSats(lightningBalances?.wallet?.totalSats)}</div>
          </div>
          <div className="rounded border border-neutral-800 px-3 py-2">
            <div className="text-neutral-500">outbound liquidity</div>
            <div className="text-neutral-100">{formatLightningSats(lightningBalances?.liquidity?.outboundSats)}</div>
          </div>
          <div className="rounded border border-neutral-800 px-3 py-2">
            <div className="text-neutral-500">inbound liquidity</div>
            <div className="text-neutral-100">{formatLightningSats(lightningBalances?.liquidity?.inboundSats)}</div>
          </div>
          <div className="rounded border border-neutral-800 px-3 py-2">
            <div className="text-neutral-500">settled sales (count)</div>
            <div className="text-neutral-100">{Number(summary?.settledPayments || 0).toLocaleString()}</div>
          </div>
          <div className="rounded border border-neutral-800 px-3 py-2">
            <div className="text-neutral-500">participant payouts paid</div>
            <div className="text-neutral-100">{Number(summary?.participantPayouts?.paid || 0).toLocaleString()}</div>
          </div>
        </div>
        {runtime?.sendFailureReason ? (
          <div className="mt-2 text-xs text-amber-300">send readiness reason: {runtime.sendFailureReason}</div>
        ) : null}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="text-sm font-semibold">Participant Payout Execution</div>
        <div className="mt-1 text-xs text-neutral-500">Per-participant payout rows are execution truth when participant mode is active.</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {(["pending", "ready", "forwarding", "paid", "failed", "blocked"] as const).map((k) => (
            <div key={k} className="rounded border border-neutral-800 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">{k}</div>
              <div className="text-lg font-semibold text-neutral-100">
                {Number(summary?.participantPayouts?.[k] || 0).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
        {participantPayouts.length === 0 ? (
          <div className="mt-3 text-sm text-neutral-400">No participant payout rows yet.</div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-400">
                  <th className="py-2 pr-3 font-medium">Participant</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Amount</th>
                  <th className="py-2 pr-3 font-medium">Destination</th>
                  <th className="py-2 pr-3 font-medium">Reason</th>
                  <th className="py-2 pr-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {participantPayouts.slice(0, 200).map((row) => (
                  <tr key={row.id} className="border-t border-neutral-800/80 align-top text-neutral-200">
                    <td className="py-2 pr-3">
                      <div>{row.allocation?.participantEmail || row.allocation?.participantUserId || row.allocation?.participantRef || "—"}</div>
                      <div className="text-xs text-neutral-500">{row.allocation?.role || "—"}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{sats(row.amountSats)} sats</td>
                    <td className="py-2 pr-3">
                      <div>{row.destinationSummary || row.destinationType || "—"}</div>
                      <div className="text-xs text-neutral-500">{row.payoutRail || "—"}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <div>{row.readinessReason || row.blockedReason || "—"}</div>
                      {row.lastError ? <div className="text-xs text-rose-300">{row.lastError}</div> : null}
                    </td>
                    <td className="py-2 pr-3">{formatDate(row.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Creator</th>
                  <th className="py-2 pr-3 font-medium">Trust</th>
                  <th className="py-2 pr-3 font-medium">Handshake</th>
                  <th className="py-2 pr-3 font-medium">Execution</th>
                  <th className="py-2 pr-3 font-medium">Last Seen</th>
                  <th className="hidden xl:table-cell py-2 pr-3 font-medium">Endpoint</th>
                </tr>
              </thead>
              <tbody>
                {creatorLinks.map((row) => (
                  <tr key={row.id} className="border-t border-neutral-800/70">
                    <td className="py-2 pr-3 align-top">
                      <div className="text-neutral-100">{row.creatorDisplayName || "Delegated creator"}</div>
                      <div className="max-w-[260px] truncate font-mono text-[11px] text-neutral-500" title={row.creatorNodeId}>
                        {shortId(row.creatorNodeId, 16, 10)}
                      </div>
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
                    <td className="hidden xl:table-cell py-2 pr-3 align-top text-neutral-300">
                      <div className="max-w-[320px] truncate font-mono text-[11px]" title={row.providerEndpoint || ""}>
                        {row.providerEndpoint || "—"}
                      </div>
                    </td>
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
            <table className="w-full min-w-[780px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Title</th>
                  <th className="py-2 pr-3 font-medium">Creator Node</th>
                  <th className="py-2 pr-3 font-medium">Visibility</th>
                  <th className="hidden lg:table-cell py-2 pr-3 font-medium">Receipt</th>
                  <th className="hidden xl:table-cell py-2 pr-3 font-medium">Manifest Hash</th>
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
                    <td className="py-2 pr-3 align-top text-neutral-300">
                      <div className="max-w-[240px] truncate font-mono text-[12px]" title={row.creatorNodeId}>
                        {shortId(row.creatorNodeId, 16, 10)}
                      </div>
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(row.status)}`}>
                        {row.visibility.toLowerCase()} / {row.status}
                      </span>
                    </td>
                    <td className="hidden lg:table-cell py-2 pr-3 align-top text-neutral-300">
                      <div className="max-w-[180px] truncate font-mono text-[11px]" title={row.publishReceiptId || ""}>
                        {row.publishReceiptId ? shortId(row.publishReceiptId, 14, 8) : "—"}
                      </div>
                    </td>
                    <td className="hidden xl:table-cell py-2 pr-3 align-top text-neutral-300">
                      <div className="max-w-[260px] truncate font-mono text-[11px]" title={row.manifestHash}>
                        {shortId(row.manifestHash, 16, 12)}
                      </div>
                    </td>
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
          <button
            onClick={() => void api("/api/provider/remittances/reprocess", "POST", {}).then(load).catch((e: any) => setError(e?.message || "Failed to reprocess remittances."))}
            className="rounded-md border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800/60"
            disabled={loading}
          >
            Reprocess pending/failed
          </button>
        </div>
        {visiblePaymentIntents.length === 0 ? (
          <div className="mt-3 text-sm text-neutral-400">No payment intents yet.</div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Intent</th>
                  <th className="py-2 pr-3 font-medium">Creator Node</th>
                  <th className="hidden xl:table-cell py-2 pr-3 font-medium">Content</th>
                  <th className="py-2 pr-3 font-medium">Amount</th>
                  <th className="hidden lg:table-cell py-2 pr-3 font-medium">Creator Net</th>
                  <th className="py-2 pr-3 font-medium">Settlement</th>
                  <th className="py-2 pr-3 font-medium">Payout</th>
                  <th className="py-2 pr-3 font-medium">Action</th>
                  <th className="py-2 pr-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {visiblePaymentIntents.map((row) => (
                  <Fragment key={row.id}>
                  <tr className="border-t border-neutral-800/70">
                    <td className="py-2 pr-3 align-top">
                      <div className="max-w-[170px] truncate font-mono text-[12px] text-neutral-100" title={row.paymentIntentId}>
                        {shortId(row.paymentIntentId, 16, 10)}
                      </div>
                      <div className="text-[11px] text-neutral-500">{formatDate(row.createdAt)}</div>
                    </td>
                    <td className="py-2 pr-3 align-top text-neutral-300">
                      <div className="max-w-[160px] truncate font-mono text-[12px]" title={row.creatorNodeId}>
                        {shortId(row.creatorNodeId, 16, 10)}
                      </div>
                    </td>
                    <td className="hidden xl:table-cell py-2 pr-3 align-top text-neutral-300">
                      <div className="max-w-[130px] truncate font-mono text-[12px]" title={row.contentId || ""}>
                        {row.contentId ? shortId(row.contentId, 10, 8) : "—"}
                      </div>
                    </td>
                    <td className="py-2 pr-3 align-top text-neutral-300">{row.grossAmountSats || row.amountSats} sats</td>
                    <td className="hidden lg:table-cell py-2 pr-3 align-top text-neutral-300">{row.creatorNetSats} sats</td>
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
                    <td className="py-2 pr-3 align-top text-neutral-300">
                      {row.status === "paid" && row.payoutStatus !== "paid" ? (
                        <button
                          onClick={() => retryRemittance(row.id)}
                          disabled={remitBusyId === row.id}
                          className="rounded-md border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800/60 disabled:opacity-60"
                        >
                          {remitBusyId === row.id ? "Retrying..." : "Retry remittance"}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <button
                        onClick={() => toggleIntentDetails(row.id)}
                        className="rounded-md border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800/60"
                      >
                        {expandedIntentIds[row.id] ? "Hide details" : "Show details"}
                      </button>
                    </td>
                  </tr>
                  {expandedIntentIds[row.id] ? (
                    <tr className="border-t border-neutral-800/50 bg-neutral-950/40">
                      <td colSpan={9} className="px-3 py-3">
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          <div className="text-xs text-neutral-400">
                            <div className="uppercase tracking-wide text-neutral-500">Provider Invoice Ref</div>
                            <div className="mt-1 break-all font-mono text-[11px] text-neutral-300">{row.providerInvoiceRef || "—"}</div>
                          </div>
                          <div className="text-xs text-neutral-400">
                            <div className="uppercase tracking-wide text-neutral-500">BOLT11</div>
                            <div className="mt-1 break-all font-mono text-[11px] text-neutral-300">{row.bolt11 || "—"}</div>
                          </div>
                          <div className="text-xs text-neutral-400">
                            <div className="uppercase tracking-wide text-neutral-500">Payment Receipt</div>
                            <div className="mt-1 break-all font-mono text-[11px] text-neutral-300">{row.paymentReceiptId || "—"}</div>
                          </div>
                          <div className="text-xs text-neutral-400">
                            <div className="uppercase tracking-wide text-neutral-500">Fee Split</div>
                            <div className="mt-1 text-neutral-300">
                              Provider total {row.providerFeeSats} sats
                              <span className="mx-1 text-neutral-500">|</span>
                              Invoicing {row.providerInvoicingFeeSats} sats
                              <span className="mx-1 text-neutral-500">|</span>
                              Hosting {row.providerDurableHostingFeeSats} sats
                            </div>
                          </div>
                          <div className="text-xs text-neutral-400">
                            <div className="uppercase tracking-wide text-neutral-500">Payout Routing</div>
                            <div className="mt-1 text-neutral-300">
                              Rail: {row.payoutRail || "—"}
                              <span className="mx-1 text-neutral-500">|</span>
                              Mode: {row.providerRemitMode || "—"}
                            </div>
                            <div className="mt-1 break-all font-mono text-[11px] text-neutral-300">
                              Destination: {row.payoutDestinationSummary || row.payoutDestinationType || "—"}
                            </div>
                          </div>
                          <div className="text-xs text-neutral-400">
                            <div className="uppercase tracking-wide text-neutral-500">Remittance</div>
                            <div className="mt-1 break-all font-mono text-[11px] text-neutral-300">
                              Ref: {row.payoutReference || "—"}
                            </div>
                            <div className="mt-1 text-neutral-300">
                              Remitted: {formatDate(row.remittedAt)} <span className="mx-1 text-neutral-500">|</span> Paid: {formatDate(row.paidAt)}
                            </div>
                            {row.payoutLastError ? (
                              <div className="mt-1 break-all text-rose-300">{row.payoutLastError}</div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
