import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import TimeScopeControls from "../components/TimeScopeControls";
import { isWithinPeriod, type TimeBasis, type TimePeriod } from "../lib/timeScope";

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
type NodeModeSnapshot = {
  mode?: "basic" | "advanced" | "lan";
  commerceAuthorityAvailable?: boolean;
};

type CurrentMe = {
  id: string;
  email?: string | null;
  displayName?: string | null;
};

type QaTotals = {
  gross: bigint;
  providerFee: bigint;
  creatorNet: bigint;
  settledCount: number;
};

type QaResult = {
  creatorNodeId: string;
  local: QaTotals;
  publicSnapshot: QaTotals & { asOf: string | null };
  delta: QaTotals;
  checkedAt: string;
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

type LocalContentIndexItem = {
  id: string;
  title?: string | null;
  status?: string | null;
  storefrontStatus?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
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
  creatorNodeId?: string | null;
  sourceType?: "catalog_earning" | "collaboration_earning" | "derivative_creator_earning" | "upstream_royalty_earning" | string | null;
  allocationRole?: string | null;
  allocationBps?: number | null;
  allocationSource?: string | null;
  soldWork?: { id?: string | null; title?: string | null; type?: string | null } | null;
  sourceWork?: { id?: string | null; title?: string | null; type?: string | null } | null;
  grossShareSats?: string | null;
  feeWithheldSats?: string | null;
  netAmountSats?: string | null;
  allocation?: {
    contentId?: string | null;
    participantRef: string;
    participantUserId: string | null;
    participantEmail: string | null;
    role: string | null;
    bps: number;
    amountSats: string;
  } | null;
};

type ProviderIntentAuditPayload = {
  paymentIntent: {
    id: string;
    amountSats: string;
    providerId: string | null;
    status: string;
    paidAt: string | null;
    contentId: string | null;
    soldWork?: { id?: string | null; title?: string | null; type?: string | null } | null;
    sourceWork?: { id?: string | null; title?: string | null; type?: string | null } | null;
  };
  providerPaymentIntent: {
    id: string;
    payoutExecutionMode: string | null;
    providerRemitMode: string | null;
    payoutStatus: string | null;
    payoutSummaryStatus: string | null;
    payoutLastError: string | null;
    providerFeeSats: string;
    providerInvoicingFeeSats: string;
    providerDurableHostingFeeSats: string;
    creatorNetSats: string;
  } | null;
  sale: {
    id: string;
    sellerUserId: string | null;
    amountSats: string;
    rail: string | null;
  } | null;
  settlement: {
    id: string;
    netAmountSats: string;
  } | null;
  allocations: Array<{
    id: string;
    providerPaymentIntentId: string;
    contentId: string | null;
    participantRef: string;
    participantUserId: string | null;
    participantEmail: string | null;
    role: string | null;
    bps: number;
    allocationSource: string | null;
    sourceType: "catalog_earning" | "collaboration_earning" | "derivative_creator_earning" | "upstream_royalty_earning" | string;
    grossShareSats: string;
    feeWithheldSats: string;
    netObligationSats: string;
    splitParticipantId: string | null;
    amountSats: string;
  }>;
  participantPayoutRows: Array<{
    id: string;
    providerPaymentIntentId: string;
    paymentIntentId: string;
    allocationId: string;
    participantRef: string | null;
    participantUserId: string | null;
    participantEmail: string | null;
    role: string | null;
    sourceType: "catalog_earning" | "collaboration_earning" | "derivative_creator_earning" | "upstream_royalty_earning" | string;
    allocationSource: string | null;
    grossShareSats: string;
    feeWithheldSats: string;
    netAmountSats: string;
    amountSats: string;
    status: string;
    payoutKey: string | null;
    payoutReference: string | null;
    destinationType: string | null;
    destinationSummary: string | null;
    readinessReason: string | null;
    lastError: string | null;
    blockedReason: string | null;
    attemptCount: number;
    remittedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  }>;
  sums: {
    grossSats: string;
    providerFeeSats: string;
    netSplitPoolSats: string;
    settlementLineTotalSats: string;
    allocationTotalSats: string;
    payoutTotalSats: string;
    payoutPaidSats: string;
    payoutPendingSats: string;
    payoutFailedSats: string;
    allocationGrossShareSats: string;
    allocationFeeWithheldSats: string;
    allocationNetObligationSats: string;
  };
  duplicateChecks?: {
    duplicatePayoutKeys?: Array<{ payoutKey: string; count: number }>;
    duplicateByParticipantRef?: Array<{ key: string; count: number }>;
  };
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

function allocationSourceLabel(sourceType: string | null | undefined) {
  const key = String(sourceType || "").trim();
  if (key === "derivative_creator_earning") return "Derivative creator earning";
  if (key === "upstream_royalty_earning") return "Upstream royalty earning";
  if (key === "collaboration_earning") return "Collaboration earning";
  if (key === "catalog_earning") return "Catalog earning";
  return "Unclassified earning";
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

function toBigIntSats(raw: string | number | null | undefined) {
  return BigInt(String(raw || "0"));
}

function maxIsoTimestamp(current: string | null, candidate: string | null | undefined) {
  if (!candidate) return current;
  const nextTs = Date.parse(candidate);
  if (!Number.isFinite(nextTs)) return current;
  if (!current) return candidate;
  const curTs = Date.parse(current);
  if (!Number.isFinite(curTs) || nextTs > curTs) return candidate;
  return current;
}

function percentOf(part: bigint, total: bigint) {
  if (total <= 0n) return "0.0%";
  const tenths = (part * 1000n) / total;
  const whole = tenths / 10n;
  const frac = tenths % 10n;
  return `${whole.toString()}.${frac.toString()}%`;
}

function isSyntheticCreatorLabel(labelHint: string, creatorNodeId?: string | null) {
  const hinted = String(labelHint || "").trim().toLowerCase();
  if (!hinted) return false;
  if (/^creator-[a-z0-9]{6,}$/.test(hinted)) return true;
  const raw = String(creatorNodeId || "").trim();
  const compact = raw.replace(/^node:/i, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (!compact) return false;
  const suffix = compact.slice(0, 10);
  return Boolean(suffix) && hinted === `creator-${suffix}`;
}

function creatorLabel(creatorNodeId: string | null | undefined, labelHint?: string | null) {
  const rawHint = String(labelHint || "").trim();
  const hinted = isSyntheticCreatorLabel(rawHint, creatorNodeId) ? "" : rawHint;
  if (hinted) return hinted;
  const raw = String(creatorNodeId || "").trim();
  const compact = raw.replace(/^node:/i, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const suffix = compact.slice(0, 10) || "profile";
  return `creator-${suffix}`;
}

function normalizeNodeRef(raw: string | null | undefined) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^node:/, "")
    .replace(/[^a-z0-9]/g, "");
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
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ProviderSummary | null>(null);
  const [creatorLinks, setCreatorLinks] = useState<ProviderCreatorLink[]>([]);
  const [delegatedPublishes, setDelegatedPublishes] = useState<ProviderDelegatedPublish[]>([]);
  const [paymentIntents, setPaymentIntents] = useState<ProviderPaymentIntent[]>([]);
  const [paymentReceipts, setPaymentReceipts] = useState<ProviderPaymentReceipt[]>([]);
  const [participantPayouts, setParticipantPayouts] = useState<ParticipantPayoutRow[]>([]);
  const [localContentIndex, setLocalContentIndex] = useState<LocalContentIndexItem[]>([]);
  const [remitBusyId, setRemitBusyId] = useState<string | null>(null);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<
    "all" | "created" | "issued" | "paid" | "cancelled" | "expired"
  >("all");
  const [expandedIntentIds, setExpandedIntentIds] = useState<Record<string, boolean>>({});
  const [payoutTableScope, setPayoutTableScope] = useState<"latest" | "all">("latest");
  const [timeBasis, setTimeBasis] = useState<TimeBasis>("paid");
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("30d");
  const [creatorScopeId, setCreatorScopeId] = useState<string>("all");
  const [creatorLabelOverrides, setCreatorLabelOverrides] = useState<Record<string, string>>({});
  const [me, setMe] = useState<CurrentMe | null>(null);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaResult, setQaResult] = useState<QaResult | null>(null);
  const [opsExpanded, setOpsExpanded] = useState({
    execution: false,
    ledger: false,
    operational: false
  });
  const [showSecondaryPanels, setShowSecondaryPanels] = useState(false);
  const [expandedInspectorIntentId, setExpandedInspectorIntentId] = useState<string | null>(null);
  const [expandedAuditIntentId, setExpandedAuditIntentId] = useState<string | null>(null);
  const [auditByIntentId, setAuditByIntentId] = useState<Record<string, ProviderIntentAuditPayload>>({});
  const [auditLoadingIntentId, setAuditLoadingIntentId] = useState<string | null>(null);
  const [auditErrorByIntentId, setAuditErrorByIntentId] = useState<Record<string, string>>({});
  const [showAuditDiagnostics, setShowAuditDiagnostics] = useState(false);
  const [showZeroContentRows, setShowZeroContentRows] = useState(false);
  const [lightningAdmin, setLightningAdmin] = useState<LightningAdminSnapshot | null>(null);
  const [lightningBalances, setLightningBalances] = useState<LightningBalancesSnapshot | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("providerCreatorLabelOverrides");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const normalized: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const id = String(k || "").trim();
        const label = String(v || "").trim();
        if (id && label) normalized[id] = label;
      }
      setCreatorLabelOverrides(normalized);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("providerCreatorLabelOverrides", JSON.stringify(creatorLabelOverrides));
    } catch {}
  }, [creatorLabelOverrides]);

  const labelForCreator = useCallback(
    (creatorNodeId: string | null | undefined, labelHint?: string | null) => {
      const id = String(creatorNodeId || "").trim();
      if (id && creatorLabelOverrides[id]) return creatorLabelOverrides[id];
      return creatorLabel(creatorNodeId, labelHint);
    },
    [creatorLabelOverrides]
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      let canUseLightningAdmin = false;
      try {
        const modeSnapshot = await api<NodeModeSnapshot>("/api/node/mode", "GET");
        canUseLightningAdmin = Boolean(modeSnapshot?.commerceAuthorityAvailable);
      } catch {
        canUseLightningAdmin = false;
      }
      const baseCalls = await Promise.all([
        api<ProviderSummary>("/api/provider/summary", "GET"),
        api<{ items: ProviderCreatorLink[] }>("/api/provider/creator-links", "GET"),
        api<{ items: ProviderDelegatedPublish[] }>("/api/provider/delegated-publishes", "GET"),
        api<{ items: ProviderPaymentIntent[] }>("/api/provider/payment-intents", "GET"),
        api<{ items: ProviderPaymentReceipt[] }>("/api/provider/payment-receipts", "GET"),
        api<{ items: ParticipantPayoutRow[] }>("/api/provider/participant-payouts", "GET"),
        api<CurrentMe>("/me", "GET"),
        api<LocalContentIndexItem[]>("/content?scope=library", "GET").catch(() => [] as LocalContentIndexItem[]),
        api<LocalContentIndexItem[]>("/content?scope=mine", "GET").catch(() => [] as LocalContentIndexItem[])
      ]);
      let lightningAdminRes: LightningAdminSnapshot | null = null;
      let lightningBalancesRes: LightningBalancesSnapshot | null = null;
      if (canUseLightningAdmin) {
        const [adminRes, balancesRes] = await Promise.all([
          api<LightningAdminSnapshot>("/api/admin/lightning", "GET"),
          api<LightningBalancesSnapshot>("/api/admin/lightning/balances", "GET")
        ]);
        lightningAdminRes = adminRes || null;
        lightningBalancesRes = balancesRes || null;
      }
      const [summaryRes, creatorLinksRes, delegatedPublishesRes, paymentIntentsRes, paymentReceiptsRes, participantPayoutsRes, meRes, libraryRes, mineRes] = baseCalls;
      setSummary(summaryRes || null);
      setCreatorLinks(Array.isArray(creatorLinksRes?.items) ? creatorLinksRes.items : []);
      setDelegatedPublishes(Array.isArray(delegatedPublishesRes?.items) ? delegatedPublishesRes.items : []);
      setPaymentIntents(Array.isArray(paymentIntentsRes?.items) ? paymentIntentsRes.items : []);
      setPaymentReceipts(Array.isArray(paymentReceiptsRes?.items) ? paymentReceiptsRes.items : []);
      setParticipantPayouts(Array.isArray(participantPayoutsRes?.items) ? participantPayoutsRes.items : []);
      setMe(meRes || null);
      const byId = new Map<string, LocalContentIndexItem>();
      [...(Array.isArray(libraryRes) ? libraryRes : []), ...(Array.isArray(mineRes) ? mineRes : [])].forEach((row) => {
        const id = String(row?.id || "").trim();
        if (!id) return;
        const existing = byId.get(id);
        if (!existing) {
          byId.set(id, row);
          return;
        }
        const nextTitle = String(row?.title || "").trim() || String(existing?.title || "").trim();
        byId.set(id, {
          ...existing,
          ...row,
          title: nextTitle || null
        });
      });
      setLocalContentIndex(Array.from(byId.values()));
      setLightningAdmin(lightningAdminRes);
      setLightningBalances(lightningBalancesRes);
    } catch (e: any) {
      setError(e?.message || "Failed to load provider console.");
    } finally {
      // no-op: page auto-sync is background-driven
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

  const loadIntentAudit = useCallback(async (paymentIntentId: string) => {
    const id = String(paymentIntentId || "").trim();
    if (!id) return;
    setAuditLoadingIntentId(id);
    setAuditErrorByIntentId((prev) => ({ ...prev, [id]: "" }));
    try {
      const payload = await api<ProviderIntentAuditPayload>(`/api/provider/payment-intents/${encodeURIComponent(id)}/audit`, "GET");
      if (payload) {
        setAuditByIntentId((prev) => ({ ...prev, [id]: payload }));
      }
    } catch (e: any) {
      setAuditErrorByIntentId((prev) => ({ ...prev, [id]: e?.message || "Failed to load intent audit." }));
    } finally {
      setAuditLoadingIntentId((current) => (current === id ? null : current));
    }
  }, []);

  const openIntentAudit = useCallback(
    async (paymentIntentId: string | null | undefined) => {
      const id = String(paymentIntentId || "").trim();
      if (!id) return;
      setExpandedAuditIntentId((current) => (current === id ? null : id));
      if (auditByIntentId[id]) return;
      await loadIntentAudit(id);
    },
    [auditByIntentId, loadIntentAudit]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load();
      }
    }, 45000);
    return () => window.clearInterval(tick);
  }, [load]);

  const scopedPaymentIntents = useMemo(() => {
    if (timePeriod === "all") return paymentIntents;
    return paymentIntents.filter((row) => {
      const ts =
        timeBasis === "sale"
          ? (row.paidAt || row.createdAt)
          : (row.remittedAt || row.paidAt || row.updatedAt || row.createdAt);
      return isWithinPeriod(ts, timePeriod);
    });
  }, [paymentIntents, timeBasis, timePeriod]);

  const scopedIntentKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of scopedPaymentIntents) {
      const providerPaymentIntentId = String(row.id || "").trim();
      const paymentIntentId = String(row.paymentIntentId || "").trim();
      if (providerPaymentIntentId) keys.add(providerPaymentIntentId);
      if (paymentIntentId) keys.add(paymentIntentId);
    }
    return keys;
  }, [scopedPaymentIntents]);

  const scopedParticipantPayouts = useMemo(() => {
    if (timePeriod === "all") return participantPayouts;
    // Keep payout rows chained to the currently scoped intents so intake,
    // obligations, execution, and mismatch all reconcile within one scope.
    return participantPayouts.filter((row) => {
      const providerPaymentIntentId = String(row.providerPaymentIntentId || "").trim();
      const paymentIntentId = String(row.paymentIntentId || "").trim();
      return scopedIntentKeys.has(providerPaymentIntentId) || scopedIntentKeys.has(paymentIntentId);
    });
  }, [participantPayouts, scopedIntentKeys, timePeriod]);
  const scopedPaymentReceipts = useMemo(() => {
    if (timePeriod === "all") return paymentReceipts;
    return paymentReceipts.filter((row) => {
      const ts = row.paidAt || row.updatedAt || row.createdAt;
      return isWithinPeriod(ts, timePeriod);
    });
  }, [paymentReceipts, timePeriod]);

  const creatorByIntentKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of paymentIntents) {
      const creatorId = String(row.creatorNodeId || "").trim();
      if (!creatorId) continue;
      if (row.id) map.set(row.id, creatorId);
      if (row.paymentIntentId) map.set(row.paymentIntentId, creatorId);
    }
    return map;
  }, [paymentIntents]);

  const creatorByParticipantRefKey = useMemo(() => {
    const map = new Map<string, string>();
    const add = (keyRaw: string | null | undefined, creatorNodeId: string | null | undefined) => {
      const key = normalizeNodeRef(keyRaw);
      const creatorId = String(creatorNodeId || "").trim();
      if (!key || !creatorId) return;
      map.set(key, creatorId);
    };
    creatorLinks.forEach((row) => add(row.creatorNodeId, row.creatorNodeId));
    paymentIntents.forEach((row) => add(row.creatorNodeId, row.creatorNodeId));
    return map;
  }, [creatorLinks, paymentIntents]);

  const resolveCreatorIdForPayout = useCallback(
    (row: ParticipantPayoutRow): string | null => {
      const explicitCreator = String(row.creatorNodeId || "").trim();
      if (explicitCreator) return explicitCreator;
      const byIntent = creatorByIntentKey.get(row.providerPaymentIntentId) || creatorByIntentKey.get(row.paymentIntentId);
      if (byIntent) return byIntent;
      const participantRef = String(row.allocation?.participantRef || "").trim();
      const byParticipantRef = creatorByParticipantRefKey.get(normalizeNodeRef(participantRef));
      if (byParticipantRef) return byParticipantRef;
      return null;
    },
    [creatorByIntentKey, creatorByParticipantRefKey]
  );

  const buildLocalQaTotals = useCallback(
    (creatorId: string): QaTotals => {
      const settled = paymentIntents.filter(
        (row) => String(row.creatorNodeId || "").trim() === creatorId && row.status === "paid" && Boolean(row.contentId)
      );
      return {
        gross: settled.reduce((acc, row) => acc + toBigIntSats(row.grossAmountSats || row.amountSats), 0n),
        providerFee: settled.reduce((acc, row) => acc + toBigIntSats(row.providerFeeSats), 0n),
        creatorNet: settled.reduce((acc, row) => acc + toBigIntSats(row.creatorNetSats), 0n),
        settledCount: settled.length
      };
    },
    [paymentIntents]
  );

  const runQaCheck = useCallback(async () => {
    if (creatorScopeId === "all") {
      setQaError("Select a delegated creator scope first.");
      return;
    }
    setQaLoading(true);
    setQaError(null);
    try {
      const local = buildLocalQaTotals(creatorScopeId);
      const res = await fetch(`/public/provider/revenue/${encodeURIComponent(creatorScopeId)}`);
      const text = await res.text();
      let payload: any = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }
      if (!res.ok) {
        throw new Error(String(payload?.message || payload?.error || `public_revenue_http_${res.status}`));
      }
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const publicSnapshot: QaTotals & { asOf: string | null } = {
        gross: items.reduce((acc: bigint, row: any) => acc + toBigIntSats(row?.gross_sats), 0n),
        providerFee: items.reduce((acc: bigint, row: any) => acc + toBigIntSats(row?.provider_fee_sats), 0n),
        creatorNet: items.reduce((acc: bigint, row: any) => acc + toBigIntSats(row?.creator_net_sats), 0n),
        settledCount: items.length,
        asOf: String(payload?.asOf || "").trim() || null
      };
      const delta: QaTotals = {
        gross: publicSnapshot.gross - local.gross,
        providerFee: publicSnapshot.providerFee - local.providerFee,
        creatorNet: publicSnapshot.creatorNet - local.creatorNet,
        settledCount: publicSnapshot.settledCount - local.settledCount
      };
      setQaResult({
        creatorNodeId: creatorScopeId,
        local,
        publicSnapshot,
        delta,
        checkedAt: new Date().toISOString()
      });
    } catch (e: any) {
      setQaError(e?.message || "QA reconciliation failed.");
    } finally {
      setQaLoading(false);
    }
  }, [creatorScopeId, buildLocalQaTotals]);

  const providerNodeId = useMemo(() => {
    const fromLinks = creatorLinks.find((row) => String(row.providerNodeId || "").trim())?.providerNodeId;
    if (fromLinks) return String(fromLinks).trim();
    const fromIntents = paymentIntents.find((row) => String(row.providerNodeId || "").trim())?.providerNodeId;
    if (fromIntents) return String(fromIntents).trim();
    const fromReceipts = paymentReceipts.find((row) => String(row.providerNodeId || "").trim())?.providerNodeId;
    if (fromReceipts) return String(fromReceipts).trim();
    const fromPublishes = delegatedPublishes.find((row) => String(row.providerNodeId || "").trim())?.providerNodeId;
    if (fromPublishes) return String(fromPublishes).trim();
    return "";
  }, [creatorLinks, paymentIntents, paymentReceipts, delegatedPublishes]);

  const creatorOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    const activity = new Map<string, { hasLink: boolean; hasPublish: boolean; hasPayout: boolean; hasIntent: boolean; hasReceipt: boolean }>();
    const mark = (creatorId: string, key: "hasLink" | "hasPublish" | "hasPayout" | "hasIntent" | "hasReceipt") => {
      const id = String(creatorId || "").trim();
      if (!id) return;
      const current = activity.get(id) || { hasLink: false, hasPublish: false, hasPayout: false, hasIntent: false, hasReceipt: false };
      current[key] = true;
      activity.set(id, current);
    };
    const ensure = (creatorId: string, labelHint?: string | null) => {
      const id = String(creatorId || "").trim();
      if (!id) return;
      const sanitizedHint = isSyntheticCreatorLabel(String(labelHint || ""), id) ? "" : String(labelHint || "").trim();
      const selfLabel =
        providerNodeId && id === providerNodeId
          ? String(me?.displayName || me?.email || "").trim() || null
          : null;
      const effectiveLabelHint = sanitizedHint || selfLabel;
      if (map.has(id)) {
        if (effectiveLabelHint) {
          map.set(id, { id, label: labelForCreator(id, effectiveLabelHint) });
        }
        return;
      }
      const label = labelForCreator(id, effectiveLabelHint);
      map.set(id, { id, label });
    };
    creatorLinks.forEach((row) => {
      ensure(row.creatorNodeId, row.creatorDisplayName);
      mark(row.creatorNodeId, "hasLink");
    });
    delegatedPublishes.forEach((row) => {
      ensure(row.creatorNodeId, null);
      mark(row.creatorNodeId, "hasPublish");
    });
    paymentIntents.forEach((row) => {
      ensure(row.creatorNodeId, null);
      mark(row.creatorNodeId, "hasIntent");
    });
    paymentReceipts.forEach((row) => {
      ensure(row.creatorNodeId, null);
      mark(row.creatorNodeId, "hasReceipt");
    });
    scopedParticipantPayouts.forEach((row) => {
      const creatorId = resolveCreatorIdForPayout(row);
      if (creatorId) {
        ensure(creatorId, null);
        mark(creatorId, "hasPayout");
      }
    });
    return Array.from(map.values())
      .filter((opt) => {
        if (!providerNodeId || opt.id !== providerNodeId) return true;
        const flags = activity.get(opt.id);
        // Only include provider-node-as-creator when there is explicit creator activity.
        return Boolean(flags?.hasLink || flags?.hasPublish || flags?.hasPayout || flags?.hasIntent || flags?.hasReceipt);
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [creatorLinks, paymentIntents, paymentReceipts, delegatedPublishes, scopedParticipantPayouts, resolveCreatorIdForPayout, providerNodeId, labelForCreator, me]);

  const creatorOptionLabelById = useMemo(() => {
    const map = new Map<string, string>();
    creatorOptions.forEach((opt) => map.set(opt.id, opt.label));
    return map;
  }, [creatorOptions]);

  const displayLabelForCreator = useCallback(
    (creatorNodeId: string | null | undefined, labelHint?: string | null) => {
      const id = String(creatorNodeId || "").trim();
      if (!id) return "Unknown creator";
      const sanitizedHint = isSyntheticCreatorLabel(String(labelHint || ""), id) ? "" : String(labelHint || "").trim();
      const optionLabel = creatorOptionLabelById.get(id) || "";
      const selfLabel =
        providerNodeId && id === providerNodeId
          ? String(me?.displayName || me?.email || "").trim()
          : "";
      return labelForCreator(id, sanitizedHint || optionLabel || selfLabel || null);
    },
    [creatorOptionLabelById, providerNodeId, me, labelForCreator]
  );

  useEffect(() => {
    if (creatorScopeId === "all") return;
    if (!creatorOptions.some((opt) => opt.id === creatorScopeId)) {
      setCreatorScopeId("all");
    }
  }, [creatorOptions, creatorScopeId]);

  const creatorScopedPaymentIntents = useMemo(
    () =>
      creatorScopeId === "all"
        ? scopedPaymentIntents
        : scopedPaymentIntents.filter((row) => String(row.creatorNodeId || "").trim() === creatorScopeId),
    [creatorScopeId, scopedPaymentIntents]
  );
  const creatorScopedDelegatedPublishes = useMemo(
    () =>
      creatorScopeId === "all"
        ? delegatedPublishes
        : delegatedPublishes.filter((row) => String(row.creatorNodeId || "").trim() === creatorScopeId),
    [creatorScopeId, delegatedPublishes]
  );
  const creatorScopedPaymentReceipts = useMemo(
    () =>
      creatorScopeId === "all"
        ? scopedPaymentReceipts
        : scopedPaymentReceipts.filter((row) => String(row.creatorNodeId || "").trim() === creatorScopeId),
    [creatorScopeId, scopedPaymentReceipts]
  );
  const creatorScopedCreatorLinks = useMemo(
    () =>
      creatorScopeId === "all"
        ? creatorLinks
        : creatorLinks.filter((row) => String(row.creatorNodeId || "").trim() === creatorScopeId),
    [creatorScopeId, creatorLinks]
  );
  // Payout rows do not carry creator id directly; resolve through provider/payment intent links.
  const creatorScopedParticipantPayouts = useMemo(() => {
    if (creatorScopeId === "all") return scopedParticipantPayouts;
    return scopedParticipantPayouts.filter((row) => {
      const creatorId = resolveCreatorIdForPayout(row);
      return creatorId === creatorScopeId;
    });
  }, [creatorScopeId, scopedParticipantPayouts, resolveCreatorIdForPayout]);
  const creatorAllPaymentIntents = useMemo(
    () =>
      creatorScopeId === "all"
        ? paymentIntents
        : paymentIntents.filter((row) => String(row.creatorNodeId || "").trim() === creatorScopeId),
    [creatorScopeId, paymentIntents]
  );
  const creatorAllParticipantPayouts = useMemo(() => {
    if (creatorScopeId === "all") return participantPayouts;
    return participantPayouts.filter((row) => {
      const creatorId = resolveCreatorIdForPayout(row);
      return creatorId === creatorScopeId;
    });
  }, [creatorScopeId, participantPayouts, resolveCreatorIdForPayout]);

  const nodeSummary = useMemo(() => {
    const settledIntents = scopedPaymentIntents.filter((row) => row.status === "paid");
    const gross = settledIntents.reduce((acc, row) => acc + toBigIntSats(row.grossAmountSats || row.amountSats), 0n);
    const invoicingFee = settledIntents.reduce((acc, row) => acc + toBigIntSats(row.providerInvoicingFeeSats), 0n);
    const hostingFee = settledIntents.reduce((acc, row) => acc + toBigIntSats(row.providerDurableHostingFeeSats), 0n);
    const providerFee = settledIntents.reduce((acc, row) => acc + toBigIntSats(row.providerFeeSats), 0n);
    const distributable = settledIntents.reduce((acc, row) => acc + toBigIntSats(row.creatorNetSats), 0n);
    const payoutsPaid = scopedParticipantPayouts
      .filter((row) => row.status === "paid")
      .reduce((acc, row) => acc + toBigIntSats(row.amountSats), 0n);
    const payoutsPending = scopedParticipantPayouts
      .filter((row) => row.status === "pending" || row.status === "ready" || row.status === "forwarding")
      .reduce((acc, row) => acc + toBigIntSats(row.amountSats), 0n);
    const payoutsFailed = scopedParticipantPayouts
      .filter((row) => row.status === "failed" || row.status === "blocked")
      .reduce((acc, row) => acc + toBigIntSats(row.amountSats), 0n);
    return {
      activePaymentIntents: scopedPaymentIntents.filter((p) => p.status === "created" || p.status === "issued").length,
      settledPayments: settledIntents.length,
      totals: {
        grossCollectedSats: gross.toString(),
        providerInvoicingFeeEarnedSats: invoicingFee.toString(),
        providerDurableHostingFeeEarnedSats: hostingFee.toString(),
        providerFeeEarnedSats: providerFee.toString(),
        creatorNetOwedSats: distributable.toString(),
        creatorNetPaidSats: payoutsPaid.toString(),
        creatorNetPendingSats: payoutsPending.toString(),
        creatorNetFailedSats: payoutsFailed.toString()
      }
    };
  }, [scopedPaymentIntents, scopedParticipantPayouts]);

  const creatorSummary = useMemo(() => {
    const settledIntents = creatorScopedPaymentIntents.filter((row) => row.status === "paid");
    const gross = settledIntents.reduce((acc, row) => acc + toBigIntSats(row.grossAmountSats || row.amountSats), 0n);
    const providerFees = settledIntents.reduce((acc, row) => acc + toBigIntSats(row.providerFeeSats), 0n);
    const providerInvoicingFees = settledIntents.reduce((acc, row) => acc + toBigIntSats(row.providerInvoicingFeeSats), 0n);
    const providerHostingFees = settledIntents.reduce((acc, row) => acc + toBigIntSats(row.providerDurableHostingFeeSats), 0n);
    const creatorNet = settledIntents.reduce((acc, row) => acc + toBigIntSats(row.creatorNetSats), 0n);
    const paid = creatorScopedParticipantPayouts
      .filter((row) => row.status === "paid")
      .reduce((acc, row) => acc + toBigIntSats(row.amountSats), 0n);
    const payable = creatorScopedParticipantPayouts
      .filter((row) => row.status === "pending" || row.status === "ready" || row.status === "forwarding")
      .reduce((acc, row) => acc + toBigIntSats(row.amountSats), 0n);
    const attention = creatorScopedParticipantPayouts
      .filter((row) => row.status === "failed" || row.status === "blocked")
      .reduce((acc, row) => acc + toBigIntSats(row.amountSats), 0n);
    return {
      gross,
      providerFees,
      providerInvoicingFees,
      providerHostingFees,
      creatorNet,
      paid,
      payable,
      attention,
      settledCount: settledIntents.length
    };
  }, [creatorScopedPaymentIntents, creatorScopedParticipantPayouts]);

  const creatorSummaryRows = useMemo(() => {
    type Row = {
      creatorNodeId: string;
      creatorLabel: string;
      publishedItems: number;
      gross: bigint;
      net: bigint;
      providerFees: bigint;
      invoicingFees: bigint;
      hostingFees: bigint;
      paid: bigint;
      payable: bigint;
      attention: bigint;
      lastActivity: string | null;
    };
    const rows = new Map<string, Row>();
    const ensure = (creatorNodeId: string, labelHint?: string | null) => {
      const id = String(creatorNodeId || "").trim();
      if (!id) return null;
      const existing = rows.get(id);
      if (existing) return existing;
      const label = displayLabelForCreator(id, labelHint || null);
      const next: Row = {
        creatorNodeId: id,
        creatorLabel: label,
        publishedItems: 0,
        gross: 0n,
        net: 0n,
        providerFees: 0n,
        invoicingFees: 0n,
        hostingFees: 0n,
        paid: 0n,
        payable: 0n,
        attention: 0n,
        lastActivity: null
      };
      rows.set(id, next);
      return next;
    };

    creatorLinks.forEach((row) => {
      ensure(row.creatorNodeId, row.creatorDisplayName);
    });

    delegatedPublishes.forEach((row) => {
      const current = ensure(row.creatorNodeId, null);
      if (!current) return;
      current.publishedItems += 1;
      current.lastActivity = maxIsoTimestamp(current.lastActivity, row.publishedAt || row.updatedAt);
    });

    scopedPaymentIntents.forEach((row) => {
      const current = ensure(row.creatorNodeId, null);
      if (!current) return;
      if (row.status === "paid") {
        current.gross += toBigIntSats(row.grossAmountSats || row.amountSats);
        current.net += toBigIntSats(row.creatorNetSats);
        current.providerFees += toBigIntSats(row.providerFeeSats);
        current.invoicingFees += toBigIntSats(row.providerInvoicingFeeSats);
        current.hostingFees += toBigIntSats(row.providerDurableHostingFeeSats);
      }
      current.lastActivity = maxIsoTimestamp(current.lastActivity, row.remittedAt || row.paidAt || row.updatedAt || row.createdAt);
    });

    scopedParticipantPayouts.forEach((row) => {
      const creatorNodeId = resolveCreatorIdForPayout(row);
      if (!creatorNodeId) return;
      const current = ensure(creatorNodeId, null);
      if (!current) return;
      const amount = toBigIntSats(row.amountSats);
      if (row.status === "paid") current.paid += amount;
      else if (row.status === "pending" || row.status === "ready" || row.status === "forwarding") current.payable += amount;
      else if (row.status === "failed" || row.status === "blocked") current.attention += amount;
      current.lastActivity = maxIsoTimestamp(current.lastActivity, row.remittedAt || row.updatedAt || row.lastCheckedAt);
    });

    return Array.from(rows.values()).sort((a, b) => {
      const grossDelta = Number(b.gross - a.gross);
      if (grossDelta !== 0) return grossDelta;
      return a.creatorLabel.localeCompare(b.creatorLabel);
    });
  }, [creatorLinks, delegatedPublishes, scopedPaymentIntents, scopedParticipantPayouts, resolveCreatorIdForPayout, displayLabelForCreator]);

  const nodeProviderFeeTotal = toBigIntSats(nodeSummary.totals.providerFeeEarnedSats);

  const selectedCreatorLabel =
    creatorScopeId === "all"
      ? "All Delegated Creators"
      : `${displayLabelForCreator(creatorScopeId, null)} (${shortId(creatorScopeId, 12, 8)})`;

  const summaryCards = [
    { label: "Delegated Creators", value: summary?.delegatedCreators ?? creatorLinks.length },
    { label: "Published Items", value: summary?.publishedItems ?? delegatedPublishes.length },
    { label: "Active Payment Intents", value: nodeSummary.activePaymentIntents },
    { label: "Settled Invoices", value: nodeSummary.settledPayments || scopedPaymentReceipts.length }
  ];

  const creatorEconomicsCards = [
    { label: "Settled Gross Sales", value: `${sats(creatorSummary.gross.toString())} sats`, tone: "text-neutral-100" },
    { label: "Creator Net (Settlement)", value: `${sats(creatorSummary.creatorNet.toString())} sats`, tone: "text-cyan-200" },
    { label: "Provider Fees (Settlement)", value: `${sats(creatorSummary.providerFees.toString())} sats`, tone: "text-neutral-200" },
    { label: "Settled Invoices", value: `${creatorScopedPaymentReceipts.length.toLocaleString()}`, tone: "text-neutral-100" },
    { label: "Paid (Scope)", value: `${sats(creatorSummary.paid.toString())} sats`, tone: "text-emerald-300" },
    { label: "Payable (Scope)", value: `${sats(creatorSummary.payable.toString())} sats`, tone: "text-amber-300" },
    { label: "Needs Attention (Scope)", value: `${sats(creatorSummary.attention.toString())} sats`, tone: "text-rose-300" }
  ];

  const visiblePaymentIntents =
    paymentStatusFilter === "all"
      ? creatorScopedPaymentIntents
      : creatorScopedPaymentIntents.filter((intent) => intent.status === paymentStatusFilter);

  const contentMetaById = useMemo(() => {
    const map = new Map<
      string,
      { title: string; publishedAt: string | null; publishState: string | null; delegationState: "enabled" | "disabled" | null }
    >();
    const ensure = (
      id: string,
      titleHint?: string | null,
      publishedHint?: string | null,
      publishStateHint?: string | null,
      delegationStateHint?: "enabled" | "disabled" | null
    ) => {
      const contentId = String(id || "").trim();
      if (!contentId) return;
      const current = map.get(contentId) || { title: "", publishedAt: null, publishState: null, delegationState: null };
      const title = String(titleHint || "").trim() || current.title;
      const publishedAt = maxIsoTimestamp(current.publishedAt, publishedHint || null);
      const publishState = String(publishStateHint || "").trim() || current.publishState;
      const delegationState = delegationStateHint ?? current.delegationState;
      map.set(contentId, { title, publishedAt, publishState: publishState || null, delegationState });
    };
    delegatedPublishes.forEach((row) => {
      const publishState = row.status === "published" ? "published" : "publish failed";
      const delegationState = row.visibility === "DISABLED" ? "disabled" : "enabled";
      ensure(row.contentId, row.title, row.publishedAt || row.updatedAt, publishState, delegationState);
    });
    localContentIndex.forEach((row) => {
      const status = String(row.status || "").trim().toLowerCase();
      const storefront = String(row.storefrontStatus || "").trim().toLowerCase();
      const publishState =
        status === "published"
          ? "published"
          : status === "disabled"
            ? "disabled"
          : status || (storefront ? `storefront/${storefront}` : null);
      ensure(row.id, row.title, row.createdAt || row.updatedAt || null, publishState, null);
    });
    return map;
  }, [delegatedPublishes, localContentIndex]);

  const creatorScopedContentRows = useMemo(() => {
    if (creatorScopeId === "all") return [] as Array<{
      contentId: string;
      title: string;
      publishedAt: string | null;
      publishState: string | null;
      delegationState: "enabled" | "disabled" | null;
      gross: bigint;
      net: bigint;
      paid: bigint;
      payable: bigint;
      attention: bigint;
      status: "attention" | "payable" | "paid" | "outside_scope" | "no_execution_rows";
    }>;
    type Row = {
      contentId: string;
      title: string;
      publishedAt: string | null;
      publishState: string | null;
      delegationState: "enabled" | "disabled" | null;
      gross: bigint;
      net: bigint;
      paid: bigint;
      payable: bigint;
      attention: bigint;
      hasPayoutHistory: boolean;
    };
    const rows = new Map<string, Row>();
    const intentToContent = new Map<string, string>();
    const ensure = (contentId: string, titleHint?: string | null) => {
      const id = String(contentId || "").trim() || "unscoped";
      const existing = rows.get(id);
      if (existing) return existing;
      const fallbackMeta = contentMetaById.get(id);
      const next: Row = {
        contentId: id,
        title: String(titleHint || "").trim() || fallbackMeta?.title || "Untitled content",
        publishedAt: fallbackMeta?.publishedAt || null,
        publishState: fallbackMeta?.publishState || null,
        delegationState: fallbackMeta?.delegationState ?? null,
        gross: 0n,
        net: 0n,
        paid: 0n,
        payable: 0n,
        attention: 0n,
        hasPayoutHistory: false
      };
      rows.set(id, next);
      return next;
    };

    creatorScopedDelegatedPublishes.forEach((row) => {
      const current = ensure(row.contentId, row.title);
      current.publishedAt = maxIsoTimestamp(current.publishedAt, row.publishedAt || row.updatedAt);
      current.publishState = row.status === "published"
        ? "published"
        : "publish failed";
      current.delegationState = row.visibility === "DISABLED" ? "disabled" : "enabled";
    });

    const scopedIntentKeys = new Set<string>();
    creatorScopedPaymentIntents.forEach((row) => {
      if (row.id) scopedIntentKeys.add(row.id);
      if (row.paymentIntentId) scopedIntentKeys.add(row.paymentIntentId);
    });
    creatorAllPaymentIntents.forEach((row) => {
      const cid = String(row.contentId || "").trim() || "unscoped";
      const current = ensure(cid, null);
      const fallbackMeta = contentMetaById.get(cid);
      if (fallbackMeta?.publishedAt) current.publishedAt = maxIsoTimestamp(current.publishedAt, fallbackMeta.publishedAt);
      if (!current.publishState && fallbackMeta?.publishState) current.publishState = fallbackMeta.publishState;
      if (!current.delegationState && fallbackMeta?.delegationState) current.delegationState = fallbackMeta.delegationState;
      const inScope = Boolean((row.id && scopedIntentKeys.has(row.id)) || (row.paymentIntentId && scopedIntentKeys.has(row.paymentIntentId)));
      if (inScope && row.status === "paid") {
        current.gross += toBigIntSats(row.grossAmountSats || row.amountSats);
        current.net += toBigIntSats(row.creatorNetSats);
      }
      if (row.id) intentToContent.set(row.id, cid);
      if (row.paymentIntentId) intentToContent.set(row.paymentIntentId, cid);
    });

    creatorAllParticipantPayouts.forEach((row) => {
      const cid = intentToContent.get(row.providerPaymentIntentId) || intentToContent.get(row.paymentIntentId) || "unscoped";
      const current = ensure(cid, null);
      current.hasPayoutHistory = true;
    });

    creatorScopedParticipantPayouts.forEach((row) => {
      const cid = intentToContent.get(row.providerPaymentIntentId) || intentToContent.get(row.paymentIntentId) || "unscoped";
      const current = ensure(cid, null);
      const amount = toBigIntSats(row.amountSats);
      if (row.status === "paid") current.paid += amount;
      else if (row.status === "pending" || row.status === "ready" || row.status === "forwarding") current.payable += amount;
      else if (row.status === "failed" || row.status === "blocked") current.attention += amount;
    });

    return Array.from(rows.values())
      .map((row) => ({
        contentId: row.contentId,
        title: row.title,
        publishedAt: row.publishedAt,
        gross: row.gross,
        net: row.net,
        paid: row.paid,
        payable: row.payable,
        attention: row.attention,
        publishState: row.publishState,
        delegationState: row.delegationState,
        status:
          row.attention > 0n
            ? "attention"
            : row.payable > 0n
              ? "payable"
              : row.paid > 0n
                ? "paid"
                : row.hasPayoutHistory
                  ? "outside_scope"
                  : "no_execution_rows"
      }))
      .sort((a, b) => Number(b.gross - a.gross));
  }, [
    creatorScopeId,
    creatorScopedDelegatedPublishes,
    creatorScopedPaymentIntents,
    creatorAllPaymentIntents,
    creatorAllParticipantPayouts,
    creatorScopedParticipantPayouts,
    contentMetaById
  ]);

  const visibleCreatorScopedContentRows = useMemo(() => {
    if (showZeroContentRows) return creatorScopedContentRows;
    return creatorScopedContentRows.filter(
      (row) => row.gross > 0n || row.net > 0n || row.paid > 0n || row.payable > 0n || row.attention > 0n
    );
  }, [creatorScopedContentRows, showZeroContentRows]);

  const toggleIntentDetails = (id: string) => {
    setExpandedIntentIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const runtime = lightningAdmin?.runtime || null;
  const formatLightningSats = (value: number | null | undefined) => `${Math.round(Number(value || 0)).toLocaleString()} sats`;
  const latestPayoutIntentId = creatorScopedParticipantPayouts[0]?.providerPaymentIntentId || null;
  const visibleParticipantPayouts =
    payoutTableScope === "latest" && latestPayoutIntentId
      ? creatorScopedParticipantPayouts.filter((row) => row.providerPaymentIntentId === latestPayoutIntentId)
      : creatorScopedParticipantPayouts;
  const visiblePayoutCounts = visibleParticipantPayouts.reduce(
    (acc, row) => {
      const key = row.status;
      if (key in acc) acc[key as keyof typeof acc] += 1;
      return acc;
    },
    {
      pending: 0,
      ready: 0,
      forwarding: 0,
      paid: 0,
      failed: 0,
      blocked: 0
    }
  );
  const showExecutionSection =
    creatorScopeId === "all" ||
    creatorScopedParticipantPayouts.length > 0 ||
    creatorSummary.payable > 0n ||
    creatorSummary.attention > 0n;
  const creatorHasExecutionReview =
    creatorScopeId !== "all" &&
    (creatorSummary.payable > 0n ||
      creatorSummary.attention > 0n ||
      creatorScopedParticipantPayouts.some(
        (row) =>
          row.status === "pending" ||
          row.status === "ready" ||
          row.status === "forwarding" ||
          row.status === "failed" ||
          row.status === "blocked"
      ));
  const showWalletContext = creatorScopeId === "all" || creatorHasExecutionReview || Boolean(runtime?.sendFailureReason);

  const obligationTruth = useMemo(() => {
    const totals = {
      pending: 0n,
      ready: 0n,
      forwarding: 0n,
      paid: 0n,
      failed: 0n,
      blocked: 0n
    };
    const counts = {
      pending: 0,
      ready: 0,
      forwarding: 0,
      paid: 0,
      failed: 0,
      blocked: 0
    };
    for (const row of creatorScopedParticipantPayouts) {
      const amount = toBigIntSats(row.netAmountSats || row.amountSats);
      if (row.status in totals) {
        const k = row.status as keyof typeof totals;
        totals[k] += amount;
        counts[k] += 1;
      }
    }
    const netPayable = totals.pending + totals.ready + totals.forwarding;
    const atRisk = totals.failed + totals.blocked;
    return { totals, counts, netPayable, atRisk };
  }, [creatorScopedParticipantPayouts]);

  const intakeTruth = useMemo(() => {
    const scoped = creatorScopedPaymentIntents;
    const settled = scoped.filter((row) => row.status === "paid");
    const gross = settled.reduce((acc, row) => acc + toBigIntSats(row.grossAmountSats || row.amountSats), 0n);
    return {
      intents: scoped.length,
      settledIntents: settled.length,
      grossSats: gross,
      receipts: creatorScopedPaymentReceipts.length
    };
  }, [creatorScopedPaymentIntents, creatorScopedPaymentReceipts]);

  const intentAllocationInspector = useMemo(() => {
    const grouped = new Map<
      string,
      {
        providerPaymentIntentId: string;
        paymentIntentId: string;
        soldWorkTitle: string;
        soldWorkId: string | null;
        latestUpdatedAt: string | null;
        rowCount: number;
        rows: ParticipantPayoutRow[];
        hasMixedStatuses: boolean;
        blockedCount: number;
        failedCount: number;
      }
    >();
    for (const row of creatorScopedParticipantPayouts) {
      const key = String(row.providerPaymentIntentId || "").trim();
      if (!key) continue;
      const current = grouped.get(key) || {
        providerPaymentIntentId: key,
        paymentIntentId: String(row.paymentIntentId || "").trim(),
        soldWorkTitle: String(row.soldWork?.title || "").trim() || "Untitled",
        soldWorkId: String(row.soldWork?.id || "").trim() || null,
        latestUpdatedAt: null as string | null,
        rowCount: 0,
        rows: [] as ParticipantPayoutRow[],
        hasMixedStatuses: false,
        blockedCount: 0,
        failedCount: 0
      };
      current.rowCount += 1;
      current.rows.push(row);
      current.latestUpdatedAt = maxIsoTimestamp(current.latestUpdatedAt, row.updatedAt || row.lastCheckedAt || row.remittedAt || null);
      if (row.status === "blocked") current.blockedCount += 1;
      if (row.status === "failed") current.failedCount += 1;
      grouped.set(key, current);
    }
    const items = Array.from(grouped.values()).map((intent) => {
      const statuses = new Set(intent.rows.map((row) => row.status));
      intent.hasMixedStatuses = statuses.size > 1;
      intent.rows.sort((a, b) => {
        const au = Date.parse(String(a.updatedAt || a.lastCheckedAt || a.remittedAt || ""));
        const bu = Date.parse(String(b.updatedAt || b.lastCheckedAt || b.remittedAt || ""));
        return (Number.isFinite(bu) ? bu : 0) - (Number.isFinite(au) ? au : 0);
      });
      return intent;
    });
    items.sort((a, b) => {
      const at = Date.parse(String(a.latestUpdatedAt || ""));
      const bt = Date.parse(String(b.latestUpdatedAt || ""));
      return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
    });
    return items;
  }, [creatorScopedParticipantPayouts]);

  const riskSummary = useMemo(() => {
    const now = Date.now();
    const stuckThresholdMs = 24 * 60 * 60 * 1000;
    let stuckCount = 0;
    let stuckSats = 0n;
    for (const row of creatorScopedParticipantPayouts) {
      if (!(row.status === "pending" || row.status === "ready" || row.status === "forwarding")) continue;
      const ts = Date.parse(String(row.updatedAt || row.lastCheckedAt || row.remittedAt || ""));
      if (Number.isFinite(ts) && now - ts > stuckThresholdMs) {
        stuckCount += 1;
        stuckSats += toBigIntSats(row.netAmountSats || row.amountSats);
      }
    }
    const mixedIntentCount = intentAllocationInspector.filter((row) => row.hasMixedStatuses).length;
    const mismatch = creatorSummary.creatorNet - (obligationTruth.totals.paid + obligationTruth.netPayable + obligationTruth.atRisk);
    return {
      stuckCount,
      stuckSats,
      mixedIntentCount,
      blockedCount: obligationTruth.counts.blocked,
      blockedSats: obligationTruth.totals.blocked,
      failedCount: obligationTruth.counts.failed,
      failedSats: obligationTruth.totals.failed,
      mismatch
    };
  }, [creatorScopedParticipantPayouts, intentAllocationInspector, obligationTruth, creatorSummary.creatorNet]);

  const activeAudit = useMemo(() => {
    if (!expandedAuditIntentId) return null;
    return auditByIntentId[expandedAuditIntentId] || null;
  }, [expandedAuditIntentId, auditByIntentId]);

  const activeAuditTimeline = useMemo(() => {
    if (!activeAudit) return [] as Array<{ label: string; ts: string | null; detail?: string }>;
    const rows = Array.isArray(activeAudit.participantPayoutRows) ? activeAudit.participantPayoutRows : [];
    const firstCreated = rows.reduce<string | null>((acc, row) => {
      const ts = String(row.createdAt || "").trim();
      if (!ts) return acc;
      if (!acc) return ts;
      return Date.parse(ts) < Date.parse(acc) ? ts : acc;
    }, null);
    const firstForwarding = rows.find((row) => String(row.status || "").toLowerCase() === "forwarding")?.updatedAt || null;
    const firstPaid = rows.find((row) => String(row.status || "").toLowerCase() === "paid")?.remittedAt || rows.find((row) => String(row.status || "").toLowerCase() === "paid")?.updatedAt || null;
    const firstFailed = rows.find((row) => {
      const s = String(row.status || "").toLowerCase();
      return s === "failed" || s === "blocked";
    })?.updatedAt || null;
    const timeline = [
      { label: "Intent created", ts: firstCreated || activeAudit.paymentIntent?.paidAt || null },
      { label: "Intent paid", ts: activeAudit.paymentIntent?.paidAt || null },
      { label: "Payout rows created", ts: firstCreated },
      { label: "Forwarding attempted", ts: firstForwarding },
      { label: "Paid/remitted", ts: firstPaid },
      { label: "Failed/blocked", ts: firstFailed }
    ];
    return timeline.filter((event) => event.ts);
  }, [activeAudit]);

  const activeAuditDelta = useMemo(() => {
    if (!activeAudit) return 0n;
    const netObligations = toBigIntSats(activeAudit.sums.allocationNetObligationSats);
    const netPaid = toBigIntSats(activeAudit.sums.payoutPaidSats);
    const netPayable = toBigIntSats(activeAudit.sums.payoutPendingSats);
    const atRisk = toBigIntSats(activeAudit.sums.payoutFailedSats);
    return netObligations - (netPaid + netPayable + atRisk);
  }, [activeAudit]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold">Provider Console</div>
            <div className="mt-1 text-sm text-neutral-400">
              Settlement-authority view for delegated commerce on this node.
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              This node processes payments, applies fees, and executes payouts.
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              View by: {timeBasis === "sale" ? "Sale (buyer payment)" : "Paid (remitted execution)"}.
            </div>
          </div>
          <div className="text-[11px] text-neutral-500">
            Auto-sync active (every 30s and on tab focus).
          </div>
        </div>
        {error ? <div className="mt-3 text-xs text-rose-300">{error}</div> : null}
        <div className="mt-3 rounded-xl border border-cyan-800/40 bg-cyan-950/20 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="uppercase tracking-wide text-cyan-200/80">Delegated Creator Scope</span>
            {providerNodeId ? (
              <span className="inline-flex items-center rounded-full border border-neutral-700 bg-neutral-900/60 px-2 py-0.5 text-neutral-300">
                Provider Node: {shortId(providerNodeId, 10, 8)}
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCreatorScopeId("all")}
              className={[
                "rounded-lg border px-3 py-1.5 text-xs",
                creatorScopeId === "all"
                  ? "border-cyan-400/70 bg-cyan-500/20 text-cyan-100"
                  : "border-neutral-700 text-neutral-300 hover:bg-neutral-800/60"
              ].join(" ")}
            >
              All Delegated Creators
            </button>
            <label className="inline-flex items-center gap-2 text-xs text-neutral-300">
              <span className="text-neutral-400">Delegated Creator</span>
              <select
                value={creatorScopeId}
                onChange={(e) => setCreatorScopeId(e.target.value)}
                className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
              >
                <option value="all">All Delegated Creators</option>
                {creatorOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {`${opt.label} (${shortId(opt.id, 10, 6)})`}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-xs text-neutral-400">Active creator scope: <span className="text-neutral-200">{selectedCreatorLabel}</span></div>
          </div>
          <div className="mt-3">
            <TimeScopeControls
              basis={timeBasis}
              onBasisChange={setTimeBasis}
              period={timePeriod}
              onPeriodChange={setTimePeriod}
              basisOptions={["sale", "paid"]}
              periodOptions={["1d", "7d", "30d", "all"]}
              helperText={
                timeBasis === "sale"
                  ? "Scoped by provider-side sale/payment recognition timestamps."
                  : "Scoped by payout remittance timestamps where available; falls back to last update timestamp."
              }
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Intake</div>
            <div className="mt-1 text-xs text-neutral-500">Payment-intent flow through this node in the selected scope.</div>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Scoped intents</div>
            <div className="mt-2 text-2xl font-semibold text-neutral-100">{intakeTruth.intents.toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Settled intents</div>
            <div className="mt-2 text-2xl font-semibold text-neutral-100">{intakeTruth.settledIntents.toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Gross processed</div>
            <div className="mt-2 text-2xl font-semibold text-neutral-100">{sats(intakeTruth.grossSats.toString())} sats</div>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Receipts</div>
            <div className="mt-2 text-2xl font-semibold text-neutral-100">{intakeTruth.receipts.toLocaleString()}</div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="text-sm font-semibold">Obligations (ParticipantPayout truth)</div>
        <div className="mt-1 text-xs text-neutral-500">Row-backed obligations by payout status. No aggregation inference.</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Net payable</div>
            <div className="mt-2 text-2xl font-semibold text-amber-300">{sats(obligationTruth.netPayable.toString())} sats</div>
            <div className="mt-1 text-xs text-neutral-500">
              pending {obligationTruth.counts.pending} • ready {obligationTruth.counts.ready} • forwarding {obligationTruth.counts.forwarding}
            </div>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Pending</div>
            <div className="mt-2 text-2xl font-semibold text-amber-300">{sats(obligationTruth.totals.pending.toString())} sats</div>
            <div className="mt-1 text-xs text-neutral-500">{obligationTruth.counts.pending.toLocaleString()} rows</div>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Ready</div>
            <div className="mt-2 text-2xl font-semibold text-amber-300">{sats(obligationTruth.totals.ready.toString())} sats</div>
            <div className="mt-1 text-xs text-neutral-500">{obligationTruth.counts.ready.toLocaleString()} rows</div>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Forwarding</div>
            <div className="mt-2 text-2xl font-semibold text-amber-300">{sats(obligationTruth.totals.forwarding.toString())} sats</div>
            <div className="mt-1 text-xs text-neutral-500">{obligationTruth.counts.forwarding.toLocaleString()} rows</div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="text-sm font-semibold">Execution & Exceptions</div>
        <div className="mt-1 text-xs text-neutral-500">Executed payout truth and operational risk signals.</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Net paid</div>
            <div className="mt-2 text-2xl font-semibold text-emerald-300">{sats(obligationTruth.totals.paid.toString())} sats</div>
            <div className="mt-1 text-xs text-neutral-500">{obligationTruth.counts.paid.toLocaleString()} rows</div>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Blocked</div>
            <div className="mt-2 text-2xl font-semibold text-rose-300">{sats(riskSummary.blockedSats.toString())} sats</div>
            <div className="mt-1 text-xs text-neutral-500">{riskSummary.blockedCount.toLocaleString()} rows</div>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Failed</div>
            <div className="mt-2 text-2xl font-semibold text-rose-300">{sats(riskSummary.failedSats.toString())} sats</div>
            <div className="mt-1 text-xs text-neutral-500">{riskSummary.failedCount.toLocaleString()} rows</div>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Stuck {">"}24h</div>
            <div className="mt-2 text-2xl font-semibold text-amber-300">{sats(riskSummary.stuckSats.toString())} sats</div>
            <div className="mt-1 text-xs text-neutral-500">{riskSummary.stuckCount.toLocaleString()} rows</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
          <span className="inline-flex items-center rounded-full border border-neutral-700 bg-neutral-900/60 px-2 py-0.5">
            Mixed-status intents: <span className="ml-1 text-neutral-200">{riskSummary.mixedIntentCount.toLocaleString()}</span>
          </span>
          <span className="inline-flex items-center rounded-full border border-neutral-700 bg-neutral-900/60 px-2 py-0.5">
            Provider/local mismatch: <span className="ml-1 text-neutral-200">{sats(riskSummary.mismatch.toString())} sats</span>
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="text-sm font-semibold">Intent Allocation Inspector</div>
        <div className="mt-1 text-xs text-neutral-500">
          One row per allocation outcome. Same-user multi-role outcomes remain separate.
        </div>
        {intentAllocationInspector.length === 0 ? (
          <div className="mt-3 text-sm text-neutral-400">No allocation rows for this scope.</div>
        ) : (
          <div className="mt-3 space-y-3">
            {intentAllocationInspector.map((intent) => {
              const expanded = expandedInspectorIntentId === intent.providerPaymentIntentId;
              return (
                <div key={intent.providerPaymentIntentId} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm text-neutral-100">{intent.soldWorkTitle}</div>
                      <div className="text-xs text-neutral-500">
                        Intent {shortId(intent.paymentIntentId, 10, 8)} • {intent.rowCount.toLocaleString()} allocation rows • updated {formatDate(intent.latestUpdatedAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {intent.hasMixedStatuses ? (
                        <span className="inline-flex items-center rounded-full border border-amber-800/70 bg-amber-900/20 px-2 py-0.5 text-[11px] text-amber-300">mixed status</span>
                      ) : null}
                      {(intent.failedCount > 0 || intent.blockedCount > 0) ? (
                        <span className="inline-flex items-center rounded-full border border-rose-800/70 bg-rose-900/20 px-2 py-0.5 text-[11px] text-rose-300">
                          failed/blocked {intent.failedCount + intent.blockedCount}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setExpandedInspectorIntentId(expanded ? null : intent.providerPaymentIntentId)}
                        className="rounded-md border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800/60"
                      >
                        {expanded ? "Hide rows" : "Show rows"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void openIntentAudit(intent.paymentIntentId)}
                        className="rounded-md border border-cyan-700/70 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-900/30"
                      >
                        View audit
                      </button>
                    </div>
                  </div>
                  {expanded ? (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[980px] text-sm">
                        <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                          <tr>
                            <th className="py-2 pr-3 font-medium">Allocation</th>
                            <th className="py-2 pr-3 font-medium">Source type</th>
                            <th className="py-2 pr-3 font-medium">Recipient</th>
                            <th className="py-2 pr-3 font-medium">Gross</th>
                            <th className="py-2 pr-3 font-medium">Fee</th>
                            <th className="py-2 pr-3 font-medium">Net</th>
                            <th className="py-2 pr-3 font-medium">Status</th>
                            <th className="py-2 pr-3 font-medium">Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {intent.rows.map((row) => (
                            <tr key={row.id} className="border-t border-neutral-800/70">
                              <td className="py-2 pr-3 font-mono text-[11px] text-neutral-300">{shortId(row.allocationId, 12, 8)}</td>
                              <td className="py-2 pr-3">
                                <div className="text-neutral-100">{allocationSourceLabel(row.sourceType)}</div>
                                <div className="text-xs text-neutral-500">{row.allocationSource || "allocation"}</div>
                              </td>
                              <td className="py-2 pr-3">
                                <div className="text-neutral-100">{row.allocation?.participantEmail || row.allocation?.participantUserId || row.allocation?.participantRef || "—"}</div>
                                <div className="text-xs text-neutral-500">{row.allocation?.role || "—"}</div>
                              </td>
                              <td className="py-2 pr-3 text-neutral-200">{sats(row.grossShareSats || row.amountSats)} sats</td>
                              <td className="py-2 pr-3 text-neutral-200">{sats(row.feeWithheldSats || "0")} sats</td>
                              <td className="py-2 pr-3 text-neutral-200">{sats(row.netAmountSats || row.amountSats)} sats</td>
                              <td className="py-2 pr-3">
                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(row.status)}`}>{row.status}</span>
                              </td>
                              <td className="py-2 pr-3 text-neutral-300">{formatDate(row.updatedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {expandedAuditIntentId ? (
        <div className="rounded-xl border border-cyan-800/40 bg-cyan-950/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-cyan-100">Provider Intent Audit</div>
              <div className="mt-1 text-xs text-cyan-200/80">
                Forensic drilldown for single-intent traceability.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void loadIntentAudit(expandedAuditIntentId)}
                disabled={auditLoadingIntentId === expandedAuditIntentId}
                className="rounded-md border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800/60 disabled:opacity-60"
              >
                {auditLoadingIntentId === expandedAuditIntentId ? "Refreshing..." : "Refresh audit"}
              </button>
              <button
                type="button"
                onClick={() => setExpandedAuditIntentId(null)}
                className="rounded-md border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800/60"
              >
                Close
              </button>
            </div>
          </div>

          {auditErrorByIntentId[expandedAuditIntentId] ? (
            <div className="mt-3 rounded-lg border border-rose-900/60 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">
              {auditErrorByIntentId[expandedAuditIntentId]}
            </div>
          ) : null}

          {auditLoadingIntentId === expandedAuditIntentId && !activeAudit ? (
            <div className="mt-3 text-sm text-neutral-300">Loading intent audit...</div>
          ) : null}

          {activeAudit ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500">Intent ID</div>
                    <div className="mt-1 font-mono text-xs text-neutral-200">{activeAudit.paymentIntent.id}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500">Provider intent</div>
                    <div className="mt-1 font-mono text-xs text-neutral-200">{activeAudit.providerPaymentIntent?.id || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500">Sold work</div>
                    <div className="mt-1 text-xs text-neutral-200">{activeAudit.paymentIntent.soldWork?.title || "Untitled"}</div>
                    <div className="text-[11px] text-neutral-500">{activeAudit.paymentIntent.soldWork?.id || activeAudit.paymentIntent.contentId || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500">Creator scope</div>
                    <div className="mt-1 text-xs text-neutral-200">{selectedCreatorLabel}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500">Gross paid</div>
                    <div className="mt-1 text-sm font-semibold text-neutral-100">{sats(activeAudit.sums.grossSats)} sats</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500">Paid timestamp</div>
                    <div className="mt-1 text-xs text-neutral-200">{formatDate(activeAudit.paymentIntent.paidAt)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500">Provider status</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(activeAudit.paymentIntent.status)}`}>
                        intent:{activeAudit.paymentIntent.status}
                      </span>
                      {activeAudit.providerPaymentIntent?.payoutStatus ? (
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(activeAudit.providerPaymentIntent.payoutStatus)}`}>
                          payout:{activeAudit.providerPaymentIntent.payoutStatus}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500">Receipt / reference</div>
                    <div className="mt-1 font-mono text-xs text-neutral-200">{activeAudit.sale?.id || activeAudit.providerPaymentIntent?.id || "—"}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
                <div className="text-xs uppercase tracking-wide text-neutral-500">Reconciliation</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    { label: "Gross received", value: `${sats(activeAudit.sums.grossSats)} sats`, tone: "text-neutral-100" },
                    { label: "Allocated gross", value: `${sats(activeAudit.sums.allocationGrossShareSats)} sats`, tone: "text-neutral-100" },
                    { label: "Fees withheld", value: `${sats(activeAudit.sums.allocationFeeWithheldSats)} sats`, tone: "text-amber-300" },
                    { label: "Net obligations", value: `${sats(activeAudit.sums.allocationNetObligationSats)} sats`, tone: "text-cyan-200" },
                    { label: "Net paid", value: `${sats(activeAudit.sums.payoutPaidSats)} sats`, tone: "text-emerald-300" },
                    { label: "Net payable", value: `${sats(activeAudit.sums.payoutPendingSats)} sats`, tone: "text-amber-300" },
                    { label: "At risk", value: `${sats(activeAudit.sums.payoutFailedSats)} sats`, tone: "text-rose-300" },
                    { label: "Delta", value: `${sats(activeAuditDelta.toString())} sats`, tone: activeAuditDelta === 0n ? "text-emerald-300" : "text-rose-300" }
                  ].map((metric) => (
                    <div key={metric.label} className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{metric.label}</div>
                      <div className={`mt-1 text-sm font-semibold ${metric.tone}`}>{metric.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
                <div className="text-sm font-semibold text-neutral-100">Allocation snapshot</div>
                <div className="mt-1 text-xs text-neutral-500">One row per allocation outcome. Same-user rows are never merged.</div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[1100px] text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                      <tr>
                        <th className="py-2 pr-3 font-medium">Allocation ID</th>
                        <th className="py-2 pr-3 font-medium">Recipient</th>
                        <th className="py-2 pr-3 font-medium">Source type</th>
                        <th className="py-2 pr-3 font-medium">Gross share</th>
                        <th className="py-2 pr-3 font-medium">Fee withheld</th>
                        <th className="py-2 pr-3 font-medium">Net obligation</th>
                        <th className="py-2 pr-3 font-medium">Source / role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeAudit.allocations.map((row) => (
                        <tr key={row.id} className="border-t border-neutral-800/70">
                          <td className="py-2 pr-3 font-mono text-[11px] text-neutral-300">{shortId(row.id, 12, 8)}</td>
                          <td className="py-2 pr-3">
                            <div className="text-neutral-100">{row.participantEmail || row.participantUserId || row.participantRef || "—"}</div>
                            <div className="text-xs text-neutral-500">{row.participantRef || "—"}</div>
                          </td>
                          <td className="py-2 pr-3">
                            <span className="inline-flex items-center rounded-full border border-cyan-800/70 bg-cyan-900/20 px-2 py-0.5 text-[11px] text-cyan-200">
                              {allocationSourceLabel(row.sourceType)}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-neutral-200">{sats(row.grossShareSats)} sats</td>
                          <td className="py-2 pr-3 text-neutral-200">{sats(row.feeWithheldSats)} sats</td>
                          <td className="py-2 pr-3 text-neutral-200">{sats(row.netObligationSats)} sats</td>
                          <td className="py-2 pr-3">
                            <div className="text-neutral-200">{row.allocationSource || "allocation"}</div>
                            <div className="text-xs text-neutral-500">{row.role || "—"} • {Number.isFinite(row.bps) ? `${(row.bps / 100).toFixed(2)}%` : "—"}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
                <div className="text-sm font-semibold text-neutral-100">Execution rows</div>
                <div className="mt-1 text-xs text-neutral-500">ParticipantPayout execution rows for this intent.</div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[1300px] text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                      <tr>
                        <th className="py-2 pr-3 font-medium">Payout row ID</th>
                        <th className="py-2 pr-3 font-medium">Allocation ID</th>
                        <th className="py-2 pr-3 font-medium">Recipient</th>
                        <th className="py-2 pr-3 font-medium">Source type</th>
                        <th className="py-2 pr-3 font-medium">Destination</th>
                        <th className="py-2 pr-3 font-medium">Net amount</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                        <th className="py-2 pr-3 font-medium">Created</th>
                        <th className="py-2 pr-3 font-medium">Updated</th>
                        <th className="py-2 pr-3 font-medium">Error / block reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeAudit.participantPayoutRows.map((row) => {
                        const hasStrictNet = String(row.netAmountSats || "").trim().length > 0;
                        return (
                          <tr key={row.id} className="border-t border-neutral-800/70">
                            <td className="py-2 pr-3 font-mono text-[11px] text-neutral-300">{shortId(row.id, 12, 8)}</td>
                            <td className="py-2 pr-3 font-mono text-[11px] text-neutral-300">{shortId(row.allocationId, 12, 8)}</td>
                            <td className="py-2 pr-3">
                              <div className="text-neutral-100">{row.participantEmail || row.participantUserId || row.participantRef || "—"}</div>
                              <div className="text-xs text-neutral-500">{row.role || "—"}</div>
                            </td>
                            <td className="py-2 pr-3">
                              <span className="inline-flex items-center rounded-full border border-cyan-800/70 bg-cyan-900/20 px-2 py-0.5 text-[11px] text-cyan-200">
                                {allocationSourceLabel(row.sourceType)}
                              </span>
                            </td>
                            <td className="py-2 pr-3">
                              <div>{row.destinationSummary || row.destinationType || "—"}</div>
                              <div className="text-xs text-neutral-500">{row.payoutReference || "—"}</div>
                            </td>
                            <td className="py-2 pr-3">
                              <div className="text-neutral-100">{sats(row.netAmountSats || row.amountSats)} sats</div>
                              {!hasStrictNet ? <div className="text-xs text-amber-300">missing-net</div> : null}
                            </td>
                            <td className="py-2 pr-3">
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(row.status)}`}>{row.status}</span>
                            </td>
                            <td className="py-2 pr-3 text-neutral-300">{formatDate(row.createdAt)}</td>
                            <td className="py-2 pr-3 text-neutral-300">{formatDate(row.updatedAt)}</td>
                            <td className="py-2 pr-3">
                              <div>{row.lastError || row.blockedReason || row.readinessReason || "—"}</div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {activeAuditTimeline.length > 0 ? (
                <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
                  <div className="text-sm font-semibold text-neutral-100">Timeline</div>
                  <div className="mt-1 text-xs text-neutral-500">Event timestamps derived from intent and payout row payloads.</div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {activeAuditTimeline.map((event) => (
                      <div key={`${event.label}:${event.ts || ""}`} className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2">
                        <div className="text-xs uppercase tracking-wide text-neutral-500">{event.label}</div>
                        <div className="mt-1 text-xs text-neutral-200">{formatDate(event.ts)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-neutral-100">Diagnostics</div>
                  <button
                    type="button"
                    onClick={() => setShowAuditDiagnostics((v) => !v)}
                    className="rounded-md border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800/60"
                  >
                    {showAuditDiagnostics ? "Hide diagnostics" : "Show diagnostics"}
                  </button>
                </div>
                {showAuditDiagnostics ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4 text-xs">
                    <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2">
                      <div className="text-neutral-500">Mixed-status allocations</div>
                      <div className="mt-1 text-neutral-100">
                        {new Set(activeAudit.participantPayoutRows.map((row) => String(row.status || "").toLowerCase())).size > 1 ? "yes" : "no"}
                      </div>
                    </div>
                    <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2">
                      <div className="text-neutral-500">Intent vs payout delta</div>
                      <div className={`mt-1 ${activeAuditDelta === 0n ? "text-emerald-300" : "text-rose-300"}`}>{sats(activeAuditDelta.toString())} sats</div>
                    </div>
                    <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2">
                      <div className="text-neutral-500">Missing net rows</div>
                      <div className="mt-1 text-neutral-100">
                        {activeAudit.participantPayoutRows.filter((row) => !String(row.netAmountSats || "").trim()).length.toLocaleString()}
                      </div>
                    </div>
                    <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2">
                      <div className="text-neutral-500">Unresolved rows</div>
                      <div className="mt-1 text-neutral-100">
                        {activeAudit.participantPayoutRows.filter((row) => {
                          const s = String(row.status || "").toLowerCase();
                          return s === "pending" || s === "ready" || s === "forwarding";
                        }).length.toLocaleString()}
                      </div>
                    </div>
                    <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 md:col-span-2 xl:col-span-4">
                      <div className="text-neutral-500">Provider/local mismatch</div>
                      <div className="mt-1 text-neutral-100">
                        {activeAudit.duplicateChecks?.duplicatePayoutKeys?.length || activeAudit.duplicateChecks?.duplicateByParticipantRef?.length
                          ? "Potential duplicate payout keys/participant refs detected."
                          : "No duplicate payout key / participant-ref conflicts detected in this intent."}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Payout Rows</div>
            <div className="mt-1 text-xs text-neutral-500">Execution truth rows (ParticipantPayout). No row collapsing.</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPayoutTableScope("latest")}
              className={[
                "rounded-lg border px-2 py-1 text-[11px]",
                payoutTableScope === "latest"
                  ? "border-neutral-500 bg-neutral-800/80 text-neutral-100"
                  : "border-neutral-700 text-neutral-300 hover:bg-neutral-800/50"
              ].join(" ")}
            >
              Latest intent
            </button>
            <button
              type="button"
              onClick={() => setPayoutTableScope("all")}
              className={[
                "rounded-lg border px-2 py-1 text-[11px]",
                payoutTableScope === "all"
                  ? "border-neutral-500 bg-neutral-800/80 text-neutral-100"
                  : "border-neutral-700 text-neutral-300 hover:bg-neutral-800/50"
              ].join(" ")}
            >
              All history
            </button>
          </div>
        </div>
        {visibleParticipantPayouts.length === 0 ? (
          <div className="mt-3 text-sm text-neutral-400">No participant payout rows yet.</div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-400">
                  <th className="py-2 pr-3 font-medium">Intent</th>
                  <th className="py-2 pr-3 font-medium">Sold work</th>
                  <th className="py-2 pr-3 font-medium">Source type</th>
                  <th className="py-2 pr-3 font-medium">Recipient</th>
                  <th className="py-2 pr-3 font-medium">Gross</th>
                  <th className="py-2 pr-3 font-medium">Commerce fee</th>
                  <th className="py-2 pr-3 font-medium">Net</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Reason</th>
                  <th className="py-2 pr-3 font-medium">Updated</th>
                  <th className="py-2 pr-3 font-medium">Audit</th>
                </tr>
              </thead>
              <tbody>
                {visibleParticipantPayouts.slice(0, 400).map((row) => (
                  <tr key={row.id} className="border-t border-neutral-800/80 align-top text-neutral-200">
                    <td className="py-2 pr-3">
                      <div className="font-mono text-[11px] text-neutral-300">{shortId(row.paymentIntentId, 8, 6)}</div>
                      <div className="font-mono text-[11px] text-neutral-500">{shortId(row.providerPaymentIntentId, 8, 6)}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <div>{String(row.soldWork?.title || "").trim() || "Untitled"}</div>
                      {row.sourceWork?.title ? <div className="text-xs text-neutral-500">Source: {row.sourceWork.title}</div> : null}
                    </td>
                    <td className="py-2 pr-3">
                      <div>{allocationSourceLabel(row.sourceType)}</div>
                      <div className="text-xs text-neutral-500">{row.allocationSource || "allocation"}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <div>{row.allocation?.participantEmail || row.allocation?.participantUserId || row.allocation?.participantRef || "—"}</div>
                      <div className="text-xs text-neutral-500">{row.allocation?.role || "—"}</div>
                    </td>
                    <td className="py-2 pr-3">{sats(row.grossShareSats || row.amountSats)} sats</td>
                    <td className="py-2 pr-3">{sats(row.feeWithheldSats || "0")} sats</td>
                    <td className="py-2 pr-3">{sats(row.netAmountSats || row.amountSats)} sats</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(row.status)}`}>{row.status}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <div>{row.readinessReason || row.blockedReason || row.destinationSummary || row.destinationType || "—"}</div>
                      <div className="text-xs text-neutral-500">{row.payoutRail || "—"}</div>
                      {row.lastError ? <div className="text-xs text-rose-300">{row.lastError}</div> : null}
                    </td>
                    <td className="py-2 pr-3">{formatDate(row.updatedAt)}</td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => void openIntentAudit(row.paymentIntentId)}
                        className="rounded-md border border-cyan-700/70 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-900/30"
                      >
                        View audit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-neutral-500">Secondary context (creator/reporting + QA + diagnostics)</div>
          <button
            type="button"
            onClick={() => setShowSecondaryPanels((v) => !v)}
            className="rounded-md border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800/60"
          >
            {showSecondaryPanels ? "Hide secondary" : "Show secondary"}
          </button>
        </div>
      </div>

      {showSecondaryPanels && (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">QA Reconciliation (Temporary)</div>
            <div className="mt-1 text-xs text-neutral-500">
              Compares local settled provider intents vs public provider revenue snapshot (all-time, creator-scoped).
            </div>
          </div>
          <button
            type="button"
            onClick={() => void runQaCheck()}
            disabled={qaLoading || creatorScopeId === "all"}
            className="rounded-md border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800/60 disabled:opacity-60"
          >
            {qaLoading ? "Checking..." : "Run QA Check"}
          </button>
        </div>
        {creatorScopeId === "all" ? (
          <div className="mt-3 text-xs text-neutral-500">Select a delegated creator to run reconciliation.</div>
        ) : null}
        {qaError ? <div className="mt-3 text-xs text-rose-300">{qaError}</div> : null}
        {qaResult ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Metric</th>
                  <th className="py-2 pr-3 font-medium">Local Provider Console</th>
                  <th className="py-2 pr-3 font-medium">Public Revenue Snapshot</th>
                  <th className="py-2 pr-3 font-medium">Delta (Public - Local)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-neutral-800/70">
                  <td className="py-2 pr-3">Gross Sales</td>
                  <td className="py-2 pr-3">{sats(qaResult.local.gross.toString())} sats</td>
                  <td className="py-2 pr-3">{sats(qaResult.publicSnapshot.gross.toString())} sats</td>
                  <td className={["py-2 pr-3", qaResult.delta.gross === 0n ? "text-emerald-300" : "text-amber-300"].join(" ")}>
                    {sats(qaResult.delta.gross.toString())} sats
                  </td>
                </tr>
                <tr className="border-t border-neutral-800/70">
                  <td className="py-2 pr-3">Provider Fees</td>
                  <td className="py-2 pr-3">{sats(qaResult.local.providerFee.toString())} sats</td>
                  <td className="py-2 pr-3">{sats(qaResult.publicSnapshot.providerFee.toString())} sats</td>
                  <td className={["py-2 pr-3", qaResult.delta.providerFee === 0n ? "text-emerald-300" : "text-amber-300"].join(" ")}>
                    {sats(qaResult.delta.providerFee.toString())} sats
                  </td>
                </tr>
                <tr className="border-t border-neutral-800/70">
                  <td className="py-2 pr-3">Creator Net</td>
                  <td className="py-2 pr-3">{sats(qaResult.local.creatorNet.toString())} sats</td>
                  <td className="py-2 pr-3">{sats(qaResult.publicSnapshot.creatorNet.toString())} sats</td>
                  <td className={["py-2 pr-3", qaResult.delta.creatorNet === 0n ? "text-emerald-300" : "text-amber-300"].join(" ")}>
                    {sats(qaResult.delta.creatorNet.toString())} sats
                  </td>
                </tr>
                <tr className="border-t border-neutral-800/70">
                  <td className="py-2 pr-3">Settled Rows</td>
                  <td className="py-2 pr-3">{qaResult.local.settledCount.toLocaleString()}</td>
                  <td className="py-2 pr-3">{qaResult.publicSnapshot.settledCount.toLocaleString()}</td>
                  <td className={["py-2 pr-3", qaResult.delta.settledCount === 0 ? "text-emerald-300" : "text-amber-300"].join(" ")}>
                    {qaResult.delta.settledCount.toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="mt-2 text-[11px] text-neutral-500">
              Creator: <span className="text-neutral-300">{shortId(qaResult.creatorNodeId, 12, 10)}</span>
              <span className="mx-2">|</span>
              Public asOf: <span className="text-neutral-300">{formatDate(qaResult.publicSnapshot.asOf)}</span>
              <span className="mx-2">|</span>
              Checked: <span className="text-neutral-300">{formatDate(qaResult.checkedAt)}</span>
            </div>
          </div>
        ) : null}
      </div>
      )}
      {showSecondaryPanels && creatorScopeId === "all" ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
          <div className="text-sm font-semibold">Delegated Creator Overview</div>
          <div className="mt-1 text-xs text-neutral-500">
            Compare delegated creators on this node. Select a row to scope the full console.
          </div>
          {creatorSummaryRows.length === 0 ? (
            <div className="mt-3 text-sm text-neutral-400">No delegated creator activity in the selected time scope.</div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Delegated Creator</th>
                    <th className="py-2 pr-3 font-medium">Published</th>
                    <th className="py-2 pr-3 font-medium">Gross Sales</th>
                    <th className="py-2 pr-3 font-medium">Earnings / Net</th>
                    <th className="py-2 pr-3 font-medium">Paid</th>
                    <th className="py-2 pr-3 font-medium">Payable</th>
                    <th className="py-2 pr-3 font-medium">Health</th>
                    <th className="py-2 pr-3 font-medium">Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {creatorSummaryRows.map((row) => {
                    const health =
                      row.attention > 0n ? "Needs attention" : row.payable > 0n ? "Payable" : row.paid > 0n ? "Healthy" : "Quiet";
                    const healthTone =
                      row.attention > 0n
                        ? "border-rose-800/70 bg-rose-900/20 text-rose-300"
                        : row.payable > 0n
                          ? "border-amber-800/70 bg-amber-900/20 text-amber-300"
                          : "border-emerald-800/70 bg-emerald-900/20 text-emerald-300";
                    return (
                      <tr
                        key={row.creatorNodeId}
                        className="border-t border-neutral-800/70 cursor-pointer hover:bg-neutral-800/30"
                        onClick={() => setCreatorScopeId(row.creatorNodeId)}
                      >
                        <td className="py-2 pr-3 align-top">
                          <div className="text-neutral-100">{row.creatorLabel}</div>
                          <div className="max-w-[240px] truncate font-mono text-[11px] text-neutral-500" title={row.creatorNodeId}>
                            {shortId(row.creatorNodeId, 16, 10)}
                          </div>
                        </td>
                        <td className="py-2 pr-3 align-top text-neutral-200">{row.publishedItems.toLocaleString()}</td>
                        <td className="py-2 pr-3 align-top text-neutral-200">{sats(row.gross.toString())} sats</td>
                        <td className="py-2 pr-3 align-top text-cyan-200">{sats(row.net.toString())} sats</td>
                        <td className="py-2 pr-3 align-top text-emerald-300">{sats(row.paid.toString())} sats</td>
                        <td className="py-2 pr-3 align-top text-amber-300">{sats(row.payable.toString())} sats</td>
                        <td className="py-2 pr-3 align-top">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${healthTone}`}>
                            {health}
                          </span>
                        </td>
                        <td className="py-2 pr-3 align-top text-neutral-300">{formatDate(row.lastActivity)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {showSecondaryPanels && creatorScopeId === "all" ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
          <div className="text-sm font-semibold">Node Fee Attribution</div>
          <div className="mt-1 text-xs text-neutral-500">
            Provider fee collection by delegated creator using settled intent data.
          </div>
          {creatorSummaryRows.length === 0 ? (
            <div className="mt-3 text-sm text-neutral-400">No fee attribution rows in the selected time scope.</div>
          ) : (
            <>
            <div className="mt-3 grid gap-2 lg:hidden">
              {creatorSummaryRows.map((row) => {
                const feeShare = percentOf(row.providerFees, nodeProviderFeeTotal);
                return (
                  <button
                    key={`fee-card-${row.creatorNodeId}`}
                    type="button"
                    className="rounded-lg border border-neutral-800 bg-neutral-950/30 p-3 text-left hover:bg-neutral-800/30"
                    onClick={() => setCreatorScopeId(row.creatorNodeId)}
                  >
                    <div className="text-sm text-neutral-100">{row.creatorLabel}</div>
                    <div className="mt-1 truncate font-mono text-[11px] text-neutral-500" title={row.creatorNodeId}>
                      {shortId(row.creatorNodeId, 16, 10)}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-neutral-500">Gross</span><div className="text-neutral-200">{sats(row.gross.toString())} sats</div></div>
                      <div><span className="text-neutral-500">Provider</span><div className="text-neutral-100">{sats(row.providerFees.toString())} sats</div></div>
                      <div><span className="text-neutral-500">Invoicing</span><div className="text-neutral-300">{sats(row.invoicingFees.toString())} sats</div></div>
                      <div><span className="text-neutral-500">Hosting</span><div className="text-neutral-300">{sats(row.hostingFees.toString())} sats</div></div>
                      <div><span className="text-neutral-500">Paid</span><div className="text-emerald-300">{sats(row.paid.toString())} sats</div></div>
                      <div><span className="text-neutral-500">Payable</span><div className="text-amber-300">{sats(row.payable.toString())} sats</div></div>
                    </div>
                    <div className="mt-2 text-xs text-neutral-300">Fee share: {feeShare}</div>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 hidden lg:block">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Delegated Creator</th>
                    <th className="py-2 pr-3 font-medium">Gross Sales</th>
                    <th className="py-2 pr-3 font-medium">Provider Fees</th>
                    <th className="py-2 pr-3 font-medium">Invoicing Fee</th>
                    <th className="py-2 pr-3 font-medium">Hosting Fee</th>
                    <th className="py-2 pr-3 font-medium">Paid</th>
                    <th className="py-2 pr-3 font-medium">Payable</th>
                    <th className="py-2 pr-3 font-medium">Fee Share</th>
                  </tr>
                </thead>
                <tbody>
                  {creatorSummaryRows.map((row) => {
                    const feeShare = percentOf(row.providerFees, nodeProviderFeeTotal);
                    return (
                      <tr
                        key={`fee-${row.creatorNodeId}`}
                        className="border-t border-neutral-800/70 cursor-pointer hover:bg-neutral-800/30"
                        onClick={() => setCreatorScopeId(row.creatorNodeId)}
                      >
                        <td className="py-2 pr-3 align-top">
                          <div className="text-neutral-100">{row.creatorLabel}</div>
                          <div className="max-w-[240px] truncate font-mono text-[11px] text-neutral-500" title={row.creatorNodeId}>
                            {shortId(row.creatorNodeId, 16, 10)}
                          </div>
                        </td>
                        <td className="py-2 pr-3 align-top text-neutral-200">{sats(row.gross.toString())} sats</td>
                        <td className="py-2 pr-3 align-top text-neutral-100">{sats(row.providerFees.toString())} sats</td>
                        <td className="py-2 pr-3 align-top text-neutral-300">{sats(row.invoicingFees.toString())} sats</td>
                        <td className="py-2 pr-3 align-top text-neutral-300">{sats(row.hostingFees.toString())} sats</td>
                        <td className="py-2 pr-3 align-top text-emerald-300">{sats(row.paid.toString())} sats</td>
                        <td className="py-2 pr-3 align-top text-amber-300">{sats(row.payable.toString())} sats</td>
                        <td className="py-2 pr-3 align-top text-neutral-200">{feeShare}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      ) : null}

      {showSecondaryPanels && (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="text-sm font-semibold">Money State</div>
        <div className="mt-1 text-xs text-neutral-500">{creatorScopeId === "all" ? "All delegated creators." : selectedCreatorLabel}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="inline-flex items-center rounded-full border border-cyan-800/50 bg-cyan-950/20 px-2 py-0.5 text-cyan-200/90">
            Lens: Provider settlement
          </span>
          <span className="inline-flex items-center rounded-full border border-neutral-700 bg-neutral-900/60 px-2 py-0.5 text-neutral-300">
            Basis: {timeBasis === "sale" ? "Sale time" : "Paid/remitted time"}
          </span>
          <span className="inline-flex items-center rounded-full border border-neutral-700 bg-neutral-900/60 px-2 py-0.5 text-neutral-300">
            Period: {timePeriod === "all" ? "All time" : timePeriod}
          </span>
        </div>
        <div className="mt-2 text-xs text-neutral-500">
          These values are creator-scoped provider settlement metrics; they are not a 1:1 match to creator accounting snapshots across all works.
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {creatorEconomicsCards.map((card) => (
            <div key={card.label} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
              <div className="text-xs uppercase tracking-wide text-neutral-500">{card.label}</div>
              <div className={["mt-2 text-2xl font-semibold", card.tone].join(" ")}>{card.value}</div>
            </div>
          ))}
        </div>
      </div>
      )}

      {showSecondaryPanels && creatorScopeId !== "all" ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
          <div className="text-sm font-semibold">Creator Content Breakdown</div>
          <div className="mt-1 text-xs text-neutral-500">
            Per-content financial and payout execution view for the selected delegated creator.
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            Catalog state and provider delegation are independent. A work can be published while delegation is currently disabled.
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            Paid/Payable columns are scoped to the selected time window.
          </div>
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowZeroContentRows((v) => !v)}
              className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800/60"
            >
              {showZeroContentRows ? "Hide zero rows" : "Show zero rows"}
            </button>
          </div>
          {visibleCreatorScopedContentRows.length === 0 ? (
            <div className="mt-3 text-sm text-neutral-400">No content activity for this creator in the selected time scope.</div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Content</th>
                    <th className="py-2 pr-3 font-medium">Gross Sales</th>
                    <th className="py-2 pr-3 font-medium">Creator Net</th>
                    <th className="py-2 pr-3 font-medium">Paid (Scope)</th>
                    <th className="py-2 pr-3 font-medium">Payable (Scope)</th>
                    <th className="py-2 pr-3 font-medium">Payout State</th>
                    <th className="py-2 pr-3 font-medium">Catalog State</th>
                    <th className="py-2 pr-3 font-medium">Provider Delegation</th>
                    <th className="py-2 pr-3 font-medium">Published</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCreatorScopedContentRows.map((row) => (
                    <tr key={row.contentId} className="border-t border-neutral-800/70">
                      <td className="py-2 pr-3 align-top">
                        <div className="text-neutral-100">{row.title}</div>
                        <div className="max-w-[260px] truncate font-mono text-[11px] text-neutral-500" title={row.contentId}>
                          {shortId(row.contentId, 14, 8)}
                        </div>
                      </td>
                      <td className="py-2 pr-3 align-top text-neutral-200">{sats(row.gross.toString())} sats</td>
                      <td className="py-2 pr-3 align-top text-cyan-200">{sats(row.net.toString())} sats</td>
                      <td className="py-2 pr-3 align-top text-emerald-300">{sats(row.paid.toString())} sats</td>
                      <td className="py-2 pr-3 align-top text-amber-300">{sats(row.payable.toString())} sats</td>
                      <td className="py-2 pr-3 align-top">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(row.status === "attention" ? "failed" : row.status === "payable" ? "forwarding" : row.status === "paid" ? "paid" : "unknown")}`}>
                          {row.status === "attention"
                            ? "needs attention"
                            : row.status === "payable"
                              ? "payable"
                              : row.status === "paid"
                                ? "paid"
                                : row.status === "outside_scope"
                                  ? "payout history outside scope"
                                  : "no payouts yet"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 align-top">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(
                          row.publishState === "published" ? "published" : "unknown"
                        )}`}>
                          {row.publishState || "unknown"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 align-top">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${
                          row.delegationState === "enabled"
                            ? "border-emerald-800/70 bg-emerald-900/20 text-emerald-300"
                            : row.delegationState === "disabled"
                              ? "border-amber-800/70 bg-amber-900/20 text-amber-300"
                              : "border-neutral-700 bg-neutral-900/50 text-neutral-300"
                        }`}>
                          {row.delegationState || "unknown"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 align-top text-neutral-300">{formatDate(row.publishedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {showSecondaryPanels && showExecutionSection ? (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Execution State</div>
            <div className="mt-1 text-xs text-neutral-500">Paid vs payable vs failed/blocked payout rows.</div>
          </div>
          <button
            type="button"
            onClick={() => setOpsExpanded((prev) => ({ ...prev, execution: !prev.execution }))}
            className="rounded-md border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800/60"
          >
            {opsExpanded.execution ? "Hide details" : "Show details"}
          </button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {(["pending", "ready", "forwarding", "paid", "failed", "blocked"] as const).map((k) => (
            <div key={k} className="rounded border border-neutral-800 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">{k}</div>
              <div className="text-lg font-semibold text-neutral-100">
                {Number(visiblePayoutCounts[k] || 0).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
        {opsExpanded.execution ? (
        <>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPayoutTableScope("latest")}
            className={[
              "rounded-lg border px-2 py-1 text-[11px]",
              payoutTableScope === "latest"
                ? "border-neutral-500 bg-neutral-800/80 text-neutral-100"
                : "border-neutral-700 text-neutral-300 hover:bg-neutral-800/50"
            ].join(" ")}
          >
            Latest intent
          </button>
          <button
            type="button"
            onClick={() => setPayoutTableScope("all")}
            className={[
              "rounded-lg border px-2 py-1 text-[11px]",
              payoutTableScope === "all"
                ? "border-neutral-500 bg-neutral-800/80 text-neutral-100"
                : "border-neutral-700 text-neutral-300 hover:bg-neutral-800/50"
            ].join(" ")}
          >
            All history
          </button>
          {latestPayoutIntentId ? (
            <div className="text-[11px] text-neutral-500">
              Latest intent: <span className="text-neutral-300">{shortId(latestPayoutIntentId, 8, 6)}</span>
            </div>
          ) : null}
        </div>
        {visibleParticipantPayouts.length === 0 ? (
          <div className="mt-3 text-sm text-neutral-400">No participant payout rows yet.</div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-400">
                  <th className="py-2 pr-3 font-medium">Intent</th>
                  <th className="py-2 pr-3 font-medium">Sold work</th>
                  <th className="py-2 pr-3 font-medium">Source type</th>
                  <th className="py-2 pr-3 font-medium">Recipient</th>
                  <th className="py-2 pr-3 font-medium">Gross</th>
                  <th className="py-2 pr-3 font-medium">Commerce fee</th>
                  <th className="py-2 pr-3 font-medium">Net</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Reason</th>
                  <th className="py-2 pr-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {visibleParticipantPayouts.slice(0, 200).map((row) => (
                  <tr key={row.id} className="border-t border-neutral-800/80 align-top text-neutral-200">
                    <td className="py-2 pr-3">
                      <div className="font-mono text-[11px] text-neutral-300">{shortId(row.paymentIntentId, 8, 6)}</div>
                      <div className="font-mono text-[11px] text-neutral-500">{shortId(row.providerPaymentIntentId, 8, 6)}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <div>{String(row.soldWork?.title || "").trim() || "Untitled"}</div>
                      {row.sourceWork?.title ? (
                        <div className="text-xs text-neutral-500">Source: {row.sourceWork.title}</div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      <div>{allocationSourceLabel(row.sourceType)}</div>
                      <div className="text-xs text-neutral-500">{row.allocationSource || "allocation"}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <div>{row.allocation?.participantEmail || row.allocation?.participantUserId || row.allocation?.participantRef || "—"}</div>
                      <div className="text-xs text-neutral-500">{row.allocation?.role || "—"}</div>
                    </td>
                    <td className="py-2 pr-3">{sats(row.grossShareSats || row.amountSats)} sats</td>
                    <td className="py-2 pr-3">{sats(row.feeWithheldSats || "0")} sats</td>
                    <td className="py-2 pr-3">{sats(row.netAmountSats || row.amountSats)} sats</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <div>{row.readinessReason || row.blockedReason || row.destinationSummary || row.destinationType || "—"}</div>
                      <div className="text-xs text-neutral-500">{row.payoutRail || "—"}</div>
                      {row.lastError ? <div className="text-xs text-rose-300">{row.lastError}</div> : null}
                    </td>
                    <td className="py-2 pr-3">{formatDate(row.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </>
        ) : null}
      </div>
      ) : null}

      {showWalletContext ? (
      <div className={["rounded-xl border border-neutral-800 bg-neutral-900/30 p-4", creatorScopeId !== "all" ? "opacity-80" : ""].join(" ")}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Treasury Wallet</div>
            <div className="mt-1 text-xs text-neutral-500">Execution readiness context for provider settlement and payout rails.</div>
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
            <div className="text-neutral-500">open channels</div>
            <div className="text-neutral-100">{Number(lightningBalances?.channels?.openCount || 0).toLocaleString()}</div>
          </div>
          <div className="rounded border border-neutral-800 px-3 py-2">
            <div className="text-neutral-500">pending channels</div>
            <div className="text-neutral-100">
              {Number((lightningBalances?.channels?.pendingOpenCount || 0) + (lightningBalances?.channels?.pendingCloseCount || 0)).toLocaleString()}
            </div>
          </div>
        </div>
        {runtime?.sendFailureReason ? (
          <div className="mt-2 text-xs text-amber-300">send readiness reason: {runtime.sendFailureReason}</div>
        ) : null}
      </div>
      ) : null}

      {showSecondaryPanels && (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Operational Details</div>
            <div className="mt-1 text-xs text-neutral-500">Inspection surfaces for row-level review and troubleshooting.</div>
          </div>
          <button
            type="button"
            onClick={() => setOpsExpanded((prev) => ({ ...prev, operational: !prev.operational }))}
            className="rounded-md border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800/60"
          >
            {opsExpanded.operational ? "Hide details" : "Show details"}
          </button>
        </div>
        {opsExpanded.operational ? (
        <>
      <div className="mt-3 rounded-lg border border-neutral-800/70 bg-neutral-950/25 p-3">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Settlement Ledger</div>
        <div className="mt-1 text-xs text-neutral-500">Inspect settlement rows when review is needed.</div>
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpsExpanded((prev) => ({ ...prev, ledger: !prev.ledger }))}
            className="rounded-md border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800/60"
          >
            {opsExpanded.ledger ? "Hide ledger rows" : "Show ledger rows"}
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
        </div>
        {opsExpanded.ledger ? (
        <>
        <div className="mt-2 flex flex-wrap items-center gap-2">
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
          <div className="mt-3 rounded-md border border-emerald-900/40 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-200">
            No settlement rows in this scope/time window. Nothing to review right now.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Intent</th>
                  <th className="py-2 pr-3 font-medium">Creator Node</th>
                  <th className="hidden xl:table-cell py-2 pr-3 font-medium">Content</th>
                  <th className="py-2 pr-3 font-medium">Buyer Gross</th>
                  <th className="hidden lg:table-cell py-2 pr-3 font-medium">Distributable Net</th>
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
                      <div className="max-w-[220px] truncate text-neutral-100" title={contentMetaById.get(String(row.contentId || "").trim())?.title || ""}>
                        {contentMetaById.get(String(row.contentId || "").trim())?.title || "—"}
                      </div>
                      <div className="max-w-[220px] truncate font-mono text-[11px] text-neutral-500" title={row.contentId || ""}>
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
                              Node: {row.payoutRail || "—"}
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
        </>
        ) : (
          <div className="mt-3 text-xs text-neutral-500">Hidden to reduce noise. Expand for operational detail.</div>
        )}
      </div>

      {showSecondaryPanels && creatorScopeId === "all" ? (
      <div className="mt-3 rounded-lg border border-neutral-800/70 bg-neutral-950/25 p-3">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Delegated Creator Links</div>
        {creatorScopedCreatorLinks.length === 0 ? (
          <div className="mt-2 text-xs text-neutral-400">No delegated creator links yet.</div>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Delegated Creator</th>
                  <th className="py-2 pr-3 font-medium">Trust</th>
                  <th className="py-2 pr-3 font-medium">Handshake</th>
                  <th className="py-2 pr-3 font-medium">Execution</th>
                  <th className="py-2 pr-3 font-medium">Last Seen</th>
                  <th className="hidden xl:table-cell py-2 pr-3 font-medium">Endpoint</th>
                </tr>
              </thead>
              <tbody>
                {creatorScopedCreatorLinks.map((row) => (
                  <tr key={row.id} className="border-t border-neutral-800/70">
                    <td className="py-2 pr-3 align-top">
                      <div className="text-neutral-100">{displayLabelForCreator(row.creatorNodeId, row.creatorDisplayName)}</div>
                      <div className="max-w-[260px] truncate font-mono text-[11px] text-neutral-500" title={row.creatorNodeId}>
                        {shortId(row.creatorNodeId, 16, 10)}
                      </div>
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(row.trustStatus)}`}>{row.trustStatus}</span>
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(row.handshakeStatus)}`}>{row.handshakeStatus}</span>
                    </td>
                    <td className="py-2 pr-3 align-top"><ExecutionPill allowed={row.executionAllowed} /></td>
                    <td className="py-2 pr-3 align-top text-neutral-300">{formatDate(row.lastSeenAt)}</td>
                    <td className="hidden xl:table-cell py-2 pr-3 align-top text-neutral-300">
                      <div className="max-w-[320px] truncate font-mono text-[11px]" title={row.providerEndpoint || ""}>{row.providerEndpoint || "—"}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      ) : null}

      {showSecondaryPanels && creatorScopeId === "all" ? (
      <div className="mt-3 rounded-lg border border-neutral-800/70 bg-neutral-950/25 p-3">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Delegated Publishes</div>
        {creatorScopedDelegatedPublishes.length === 0 ? (
          <div className="mt-2 text-xs text-neutral-400">No delegated publish records yet.</div>
        ) : (
          <div className="mt-2 overflow-x-auto">
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
                {creatorScopedDelegatedPublishes.map((row) => (
                  <tr key={row.id} className="border-t border-neutral-800/70">
                    <td className="py-2 pr-3 align-top">
                      <div className="text-neutral-100">{row.title || row.contentId}</div>
                      <div className="text-xs text-neutral-500">{row.contentType || "unknown type"}</div>
                    </td>
                    <td className="py-2 pr-3 align-top text-neutral-300">
                      <div className="max-w-[240px] truncate font-mono text-[12px]" title={row.creatorNodeId}>{shortId(row.creatorNodeId, 16, 10)}</div>
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <div className="inline-flex items-center rounded-full border border-neutral-700 bg-neutral-900/50 px-2 py-0.5 text-[11px] text-neutral-300">
                        Storefront: {row.visibility.toLowerCase()}
                      </div>
                      <div className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(row.status)}`}>
                        Publish: {row.status}
                      </div>
                    </td>
                    <td className="hidden lg:table-cell py-2 pr-3 align-top text-neutral-300">
                      <div className="max-w-[180px] truncate font-mono text-[11px]" title={row.publishReceiptId || ""}>{row.publishReceiptId ? shortId(row.publishReceiptId, 14, 8) : "—"}</div>
                    </td>
                    <td className="hidden xl:table-cell py-2 pr-3 align-top text-neutral-300">
                      <div className="max-w-[260px] truncate font-mono text-[11px]" title={row.manifestHash}>{shortId(row.manifestHash, 16, 12)}</div>
                    </td>
                    <td className="py-2 pr-3 align-top text-neutral-300">{formatDate(row.publishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      ) : null}
        </>
        ) : (
          <div className="mt-3 text-xs text-neutral-500">Hidden by default. Expand only when you need row-level inspection.</div>
        )}
      </div>
      )}

      {showSecondaryPanels && creatorScopeId === "all" ? (
      <div className="space-y-2 opacity-70">
        <div className="text-sm font-semibold text-neutral-200">Provider Node Overview</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
              <div className="text-xs uppercase tracking-wide text-neutral-500">{card.label}</div>
              <div className="mt-2 text-2xl font-semibold text-neutral-100">{card.value}</div>
            </div>
          ))}
        </div>
      </div>
      ) : null}
    </div>
  );
}
