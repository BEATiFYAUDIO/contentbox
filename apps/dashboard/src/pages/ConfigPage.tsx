
import { useEffect, useMemo, useState } from "react";
import { clearToken, getToken } from "../lib/auth";
import { getApiBase } from "../lib/api";
import { participationModeMeta, resolveParticipationMode, type ParticipationMode } from "../lib/networkUserType";

const DEFAULT_HEALTH_PATH = "/health";

type Health = {
  ok: boolean;
  peerId?: string;
  fingerprint?: string;
  httpPort?: number;
  publicOrigin?: string;
  publicBuyOrigin?: string;
  publicStudioOrigin?: string;
  ts?: string;
};

type NodeModeStatus = {
  nodeMode: "basic" | "advanced" | "lan";
  nodeModeSource: string;
  productTier: "basic" | "advanced" | "lan";
  productTierSource: string;
  tierLocked: boolean;
  lockReason: string;
  restartRequired: boolean;
};

type NetworkSummary = {
  nodeMode: "basic" | "advanced" | "lan";
  serviceRoles: {
    creator: boolean;
    invoiceProvider: boolean;
    hybrid: boolean;
  };
  paymentCapability: {
    localInvoiceMinting: boolean;
    delegatedInvoiceSupport: boolean;
    tipsOnly: boolean;
    paidCommerceAllowed?: boolean;
    paidCommerceReason?: string | null;
    canonicalCommerceConfigured?: boolean;
    endpointStability?: "stable" | "temporary" | "unknown";
  };
  providerBinding: {
    configured: boolean;
    providerNodeId: string | null;
  };
  modeProfile?: {
    selectedParticipationMode?: string;
    effectiveParticipationMode?: string;
    hasStablePublicRoute?: boolean;
    hasLocalInvoiceMinting?: boolean;
    hasChainBackendReady?: boolean;
  };
  capabilityResolution?: {
    delegatedCapabilities?: string[];
    readinessBlockers?: string[];
    effectiveCommerceHost?: string | null;
    effectiveSettlementHost?: string | null;
    effectiveBuyerRecoveryHost?: string | null;
  };
  providerServices?: {
    totalProviderFeePercent?: number;
  };
  reachability?: {
    localNodeEndpointUrl?: string | null;
    temporaryNodeEndpointUrl?: string | null;
    canonicalCommerceUrl?: string | null;
    canonicalCommerceKind?: string;
    routing?: {
      replayMode?: string;
      providerDurablePlaybackAvailable?: boolean;
      creatorPlaybackAvailable?: boolean;
      selectedOriginType?: string;
    };
  };
};

type NetworkProviderConfig = {
  providerNodeId: string | null;
  providerUrl: string | null;
  enabled: boolean;
};

const STORAGE_PUBLIC_ORIGIN = "contentbox.publicOrigin";
const STORAGE_PUBLIC_BUY_ORIGIN = "contentbox.publicBuyOrigin";
const STORAGE_PUBLIC_STUDIO_ORIGIN = "contentbox.publicStudioOrigin";
const STORAGE_PUBLIC_ORIGIN_FALLBACK = "contentbox.publicOriginFallback";
const STORAGE_PUBLIC_BUY_ORIGIN_FALLBACK = "contentbox.publicBuyOriginFallback";
const STORAGE_PUBLIC_STUDIO_ORIGIN_FALLBACK = "contentbox.publicStudioOriginFallback";
const STORAGE_TUNNEL_CONFIG_ENABLED = "contentbox.tunnelConfig.enabled";
const STORAGE_API_BASE = "contentbox.apiBase";

function isPrivateHost(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (hostname.startsWith("10.") || hostname.startsWith("192.168.")) return true;
  const m = hostname.match(/^172\.(\d+)\./);
  if (m) {
    const n = Number(m[1]);
    return n >= 16 && n <= 31;
  }
  return false;
}

function readStoredValue(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeStoredValue(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (!value) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, value);
  } catch {}
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function safeHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function isValidOrigin(value: string): boolean {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export default function ConfigPage({
  showAdvanced,
  onOpenPayments,
  onIdentityRefresh
}: {
  showAdvanced?: boolean;
  onOpenPayments?: () => void;
  onIdentityRefresh?: () => void;
}) {
  const mapSummaryModeToParticipationMode = (mode: string | null | undefined): ParticipationMode | null => {
    if (!mode) return null;
    if (mode === "basic_creator") return "basic_creator";
    if (mode === "sovereign_node_operator" || mode === "sovereign_node") return "sovereign_node";
    if (mode === "sovereign_creator_with_provider" || mode === "sovereign_creator") return "sovereign_with_provider";
    return null;
  };
  const devMode = Boolean((import.meta as any).env?.DEV);
  const apiBase = useMemo(() => getApiBase(), []);
  const uiOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const token = getToken();
  const inputClass =
    "w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-white placeholder:text-neutral-600 outline-none focus:border-neutral-600";
  const [publicOrigin, setPublicOrigin] = useState<string>(() => readStoredValue(STORAGE_PUBLIC_ORIGIN));
  const [publicBuyOrigin, setPublicBuyOrigin] = useState<string>(() => readStoredValue(STORAGE_PUBLIC_BUY_ORIGIN));
  const [publicStudioOrigin, setPublicStudioOrigin] = useState<string>(() => readStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN));
  const [publicOriginFallback, setPublicOriginFallback] = useState<string>(() => readStoredValue(STORAGE_PUBLIC_ORIGIN_FALLBACK));
  const [publicBuyOriginFallback, setPublicBuyOriginFallback] = useState<string>(() => readStoredValue(STORAGE_PUBLIC_BUY_ORIGIN_FALLBACK));
  const [publicStudioOriginFallback, setPublicStudioOriginFallback] = useState<string>(() => readStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN_FALLBACK));
  const [tunnelEnabled, setTunnelEnabled] = useState<boolean>(() => readStoredValue(STORAGE_TUNNEL_CONFIG_ENABLED) === "1");
  const [tunnelProvider, setTunnelProvider] = useState<string>("cloudflare");
  const [tunnelDomain, setTunnelDomain] = useState<string>("");
  const [tunnelName, setTunnelName] = useState<string>("");
  const [tunnelError, setTunnelError] = useState<string | null>(null);
  const [tunnelLoading, setTunnelLoading] = useState<boolean>(false);
  const [tunnelList, setTunnelList] = useState<Array<{ name?: string; id?: string }>>([]);
  const [namedTokenInput, setNamedTokenInput] = useState<string>("");
  const [namedTokenBusy, setNamedTokenBusy] = useState<boolean>(false);
  const [namedTokenMsg, setNamedTokenMsg] = useState<string | null>(null);
  const [publicStatus, setPublicStatus] = useState<any | null>(null);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<any | null>(null);
  const [publicBusy, setPublicBusy] = useState(false);
  const [publicMsg, setPublicMsg] = useState<string | null>(null);
  const [publicAdvancedOpen, setPublicAdvancedOpen] = useState(false);
  const [publicOriginDetected, setPublicOriginDetected] = useState<string>("");
  const [publicOriginWarn, setPublicOriginWarn] = useState<boolean>(false);
  const [apiBaseOverride, setApiBaseOverride] = useState<string>(() => readStoredValue(STORAGE_API_BASE));
  const [modeInfo, setModeInfo] = useState<NodeModeStatus | null>(null);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeMsg, setModeMsg] = useState<string | null>(null);
  const [networkSummary, setNetworkSummary] = useState<NetworkSummary | null>(null);
  const [providerConfig, setProviderConfig] = useState<NetworkProviderConfig | null>(null);
  const [configMsg, setConfigMsg] = useState<string | null>(null);
  const apiHost = safeHost(apiBase);
  const uiHost = safeHost(uiOrigin);
  const overrideHost = safeHost(apiBaseOverride);
  const overrideActive = Boolean(apiBaseOverride.trim());
  const apiMismatch = Boolean(uiHost && apiHost && uiHost !== apiHost);
  const overrideMismatch = Boolean(overrideActive && overrideHost && overrideHost !== apiHost);
  const canForceLocal = Boolean(uiHost && (uiHost === "localhost" || uiHost === "127.0.0.1"));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setErr(null);
        const res = await fetch(`${apiBase}${DEFAULT_HEALTH_PATH}`, { method: "GET" });
        const json = (await res.json()) as Health;
        if (!cancelled) setHealth(json);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/public/origin`, { method: "GET" });
        const json = await res.json().catch(() => null);
        const origin = String(json?.publicOrigin || "").trim().replace(/\/+$/, "");
        if (!cancelled) {
          setPublicOriginDetected(origin);
          const host = safeHost(origin);
          setPublicOriginWarn(!origin || isPrivateHost(host));
        }
      } catch {
        if (!cancelled) {
          setPublicOriginDetected("");
          setPublicOriginWarn(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    if (!tunnelEnabled || !token) return;
    let cancelled = false;
    (async () => {
      try {
        setTunnelError(null);
        setTunnelLoading(true);
        const res = await fetch(`${apiBase}/api/public/config`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (!cancelled) {
          setTunnelProvider(json?.provider || "cloudflare");
          setTunnelDomain(json?.domain || "");
          setTunnelName(json?.tunnelName || "");
        }
      } catch (e: any) {
        if (!cancelled) setTunnelError(e?.message || String(e));
      } finally {
        if (!cancelled) setTunnelLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, token, tunnelEnabled]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/public/status`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (!cancelled) setPublicStatus(json || null);
      } catch {
        if (!cancelled) setPublicStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const [summaryRes, providerRes] = await Promise.all([
          fetch(`${apiBase}/api/network/summary`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` }
          }),
          fetch(`${apiBase}/api/network/provider`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` }
          })
        ]);
        const [summaryJson, providerJson] = await Promise.all([
          summaryRes.json().catch(() => null),
          providerRes.json().catch(() => null)
        ]);
        if (cancelled) return;
        setNetworkSummary(summaryRes.ok ? (summaryJson as NetworkSummary) : null);
        setProviderConfig(providerRes.ok ? (providerJson as NetworkProviderConfig) : null);
      } catch {
        if (cancelled) return;
        setNetworkSummary(null);
        setProviderConfig(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, token, modeInfo?.nodeMode]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/node/mode`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (!cancelled) setModeInfo(res.ok ? (json as NodeModeStatus) : null);
      } catch {
        if (!cancelled) setModeInfo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/diagnostics/status`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (!cancelled) setDiagnosticsStatus(json || null);
      } catch {
        if (!cancelled) setDiagnosticsStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, token]);

  const productTier = diagnosticsStatus?.productTier || "basic";
  const namedConfigured = Boolean(diagnosticsStatus?.publicStatus?.namedConfigured);
  const quickDisabled = productTier === "advanced" && namedConfigured;
  const modeLocked = Boolean(modeInfo?.tierLocked);
  const providerConfigured = Boolean(
    networkSummary?.providerBinding?.configured ||
      (providerConfig?.enabled && providerConfig?.providerNodeId && providerConfig?.providerUrl)
  );
  const providerInfrastructureCapability = Boolean(
    networkSummary?.serviceRoles?.invoiceProvider ||
      networkSummary?.serviceRoles?.hybrid ||
      networkSummary?.paymentCapability?.localInvoiceMinting
  );
  const fallbackParticipationMode: ParticipationMode = resolveParticipationMode({
    nodeMode: modeInfo?.nodeMode ?? null,
    providerConfigured,
    providerInfrastructureCapability
  });
  const selectedFromSummary = mapSummaryModeToParticipationMode(networkSummary?.modeProfile?.selectedParticipationMode);
  const effectiveFromSummary = mapSummaryModeToParticipationMode(networkSummary?.modeProfile?.effectiveParticipationMode);
  const resolvedParticipationMode: ParticipationMode = effectiveFromSummary || fallbackParticipationMode;
  const selectedParticipationMode: ParticipationMode = selectedFromSummary || fallbackParticipationMode;
  const participationMode = participationModeMeta(resolvedParticipationMode);
  const participationStageIndex =
    resolvedParticipationMode === "basic_creator" ? 0 : resolvedParticipationMode === "sovereign_with_provider" ? 1 : 2;
  const showNodeIdentityByDefault = resolvedParticipationMode !== "basic_creator";
  const showPreviewByDefault = resolvedParticipationMode === "basic_creator";
  const showReachabilityByDefault = resolvedParticipationMode === "sovereign_node";
  const temporaryPreviewEndpoint = publicStatus?.mode === "quick";
  const normalizedPublicBuyOrigin = normalizeOrigin(publicBuyOrigin);
  const normalizedPublicStudioOrigin = normalizeOrigin(publicStudioOrigin);
  const normalizedPublicOrigin = normalizeOrigin(publicOrigin);
  const normalizedPublicBuyOriginFallback = normalizeOrigin(publicBuyOriginFallback);
  const normalizedPublicStudioOriginFallback = normalizeOrigin(publicStudioOriginFallback);
  const normalizedPublicOriginFallback = normalizeOrigin(publicOriginFallback);
  const canonicalCommerceHost = normalizedPublicBuyOrigin || health?.publicBuyOrigin || publicStatus?.canonicalOrigin || "Not configured";
  const stableCommerceConfigured = Boolean(
    normalizedPublicBuyOrigin ||
      health?.publicBuyOrigin ||
      (publicStatus?.mode === "named" && (publicStatus?.canonicalOrigin || publicStatus?.publicOrigin))
  );
  const delegatedCapabilities = networkSummary?.capabilityResolution?.delegatedCapabilities || [];
  const readinessBlockers = networkSummary?.capabilityResolution?.readinessBlockers || [];
  const stablePublicHostDetected = Boolean(networkSummary?.modeProfile?.hasStablePublicRoute);
  const lndReadyDetected = Boolean(networkSummary?.modeProfile?.hasLocalInvoiceMinting);
  const chainReadyDetected = Boolean(networkSummary?.modeProfile?.hasChainBackendReady);
  const canonicalCommerceConfiguredDetected = Boolean(networkSummary?.paymentCapability?.canonicalCommerceConfigured);
  const temporaryEndpointDetected = Boolean(
    networkSummary?.reachability?.temporaryNodeEndpointUrl || publicStatus?.mode === "quick"
  );
  const replayCapableDetected = Boolean(
    networkSummary?.reachability?.routing?.providerDurablePlaybackAvailable ||
      networkSummary?.reachability?.routing?.creatorPlaybackAvailable
  );
  const nodeReadinessRows = [
    { label: "Dashboard/App", value: health?.ok ? "Running" : "Not confirmed", ok: Boolean(health?.ok) },
    { label: "Local API Base", value: apiBase || "Not resolved", ok: Boolean(apiBase) },
    { label: "Stable Public Host", value: stablePublicHostDetected ? "Configured" : "Not configured", ok: stablePublicHostDetected },
    { label: "Temporary Endpoint", value: temporaryEndpointDetected ? "Active" : "Inactive", ok: !temporaryEndpointDetected },
    {
      label: "Canonical Commerce",
      value: canonicalCommerceConfiguredDetected ? "Configured" : "Not configured",
      ok: canonicalCommerceConfiguredDetected
    },
    { label: "Lightning (LND)", value: lndReadyDetected ? "Ready" : "Not ready", ok: lndReadyDetected },
    { label: "Chain Backend", value: chainReadyDetected ? "Ready" : "Not ready", ok: chainReadyDetected },
    { label: "Replay Delivery", value: replayCapableDetected ? "Capable" : "Not ready", ok: replayCapableDetected },
    {
      label: "Buyer Recovery Host",
      value: networkSummary?.capabilityResolution?.effectiveBuyerRecoveryHost || "Not resolved",
      ok: Boolean(networkSummary?.capabilityResolution?.effectiveBuyerRecoveryHost)
    }
  ];
  const sovereignNodeRequirements = [
    { label: "Stable public host", ready: stablePublicHostDetected },
    { label: "Lightning (LND)", ready: lndReadyDetected },
    { label: "Chain backend", ready: chainReadyDetected },
    { label: "Replay delivery", ready: replayCapableDetected }
  ];
  const sovereignNodeMissing = sovereignNodeRequirements.filter((r) => !r.ready).map((r) => r.label);
  const canSelectSovereignNode = sovereignNodeMissing.length === 0;
  const invalidOrigins = [
    { label: "Commerce host", value: normalizedPublicBuyOrigin },
    { label: "Creator app host", value: normalizedPublicStudioOrigin },
    { label: "Node domain", value: normalizedPublicOrigin },
    { label: "Commerce fallback", value: normalizedPublicBuyOriginFallback },
    { label: "Creator app fallback", value: normalizedPublicStudioOriginFallback },
    { label: "Node fallback", value: normalizedPublicOriginFallback }
  ].filter((entry) => entry.value && !isValidOrigin(entry.value));
  const primaryFilledCount = [normalizedPublicBuyOrigin, normalizedPublicStudioOrigin, normalizedPublicOrigin].filter(Boolean).length;
  const partialPrimaryHosts = primaryFilledCount > 0 && primaryFilledCount < 3;
  const fallbackWithoutPrimary =
    (normalizedPublicBuyOriginFallback && !normalizedPublicBuyOrigin) ||
    (normalizedPublicStudioOriginFallback && !normalizedPublicStudioOrigin) ||
    (normalizedPublicOriginFallback && !normalizedPublicOrigin);
  const fallbackDuplicatesPrimary =
    (normalizedPublicBuyOrigin && normalizedPublicBuyOriginFallback && normalizedPublicBuyOrigin === normalizedPublicBuyOriginFallback) ||
    (normalizedPublicStudioOrigin && normalizedPublicStudioOriginFallback && normalizedPublicStudioOrigin === normalizedPublicStudioOriginFallback) ||
    (normalizedPublicOrigin && normalizedPublicOriginFallback && normalizedPublicOrigin === normalizedPublicOriginFallback);
  const configHealthStatus: "consistent" | "mixed" | "invalid" = invalidOrigins.length
    ? "invalid"
    : apiMismatch || overrideMismatch || partialPrimaryHosts || fallbackWithoutPrimary || fallbackDuplicatesPrimary
      ? "mixed"
      : "consistent";
  const configHealthTitle = configHealthStatus === "consistent" ? "Consistent" : configHealthStatus === "mixed" ? "Mixed" : "Invalid";
  const configHealthDescription =
    configHealthStatus === "consistent"
      ? "Config values are aligned for this machine."
      : configHealthStatus === "mixed"
        ? "Some config values are conflicting or incomplete."
        : "One or more host values are not valid http/https origins.";

  const updateNodeMode = async (nextMode: "basic" | "advanced" | "lan") => {
    if (!token || !modeInfo || modeBusy || nextMode === modeInfo.nodeMode) return;
    if (nextMode === "lan" && !canSelectSovereignNode) {
      setModeMsg(
        `Sovereign Node Operator requires readiness first. Missing: ${sovereignNodeMissing.join(", ")}.`
      );
      return;
    }
    if (nextMode === "advanced") {
      const ok = window.confirm(
        "Switching to Sovereign Creator Node enforces single-identity local ownership. Continue?"
      );
      if (!ok) return;
    }
    setModeBusy(true);
    setModeMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/node/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nodeMode: nextMode })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || json?.error || "Failed to update node mode.");
      setModeInfo(json as NodeModeStatus);
      setModeMsg((json as NodeModeStatus).restartRequired ? "Saved. Restart required to fully apply mode change." : "Saved.");
      onIdentityRefresh?.();
    } catch (e: any) {
      setModeMsg(e?.message || "Failed to update node mode.");
    } finally {
      setModeBusy(false);
    }
  };

  const refreshPublicStatus = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${apiBase}/api/public/status`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      setPublicStatus(json || null);
    } catch {
      setPublicStatus(null);
    }
  };

  const startPublicLink = async () => {
    if (!token) return;
    setPublicBusy(true);
    setPublicMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/public/go`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ consent: true })
      });
      const json = await res.json();
      setPublicStatus(json || null);
      if (res.ok && json?.mode === "quick" && json?.publicOrigin) {
        const ok = window.confirm(
          "Temporary link created (testing only). Use for admin access. It does not activate Advanced. Open in new tab?"
        );
        if (ok) {
          window.open(String(json.publicOrigin), "_blank", "noopener,noreferrer");
        }
      }
      if (!res.ok) {
        setPublicMsg(json?.message || json?.error || "Failed to start public link.");
      }
    } catch (e: any) {
      setPublicMsg(e?.message || "Failed to start public link.");
    } finally {
      setPublicBusy(false);
    }
  };

  const setNamedOverride = async (disabled: boolean) => {
    if (!token) return;
    setPublicBusy(true);
    setPublicMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/public/named/${disabled ? "disable" : "enable"}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to update named override.");
      await refreshPublicStatus();
    } catch (e: any) {
      setPublicMsg(e?.message || "Failed to update named override.");
    } finally {
      setPublicBusy(false);
    }
  };

  const stopPublicLink = async () => {
    if (!token) return;
    setPublicBusy(true);
    setPublicMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/public/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      setPublicStatus(json || null);
    } catch (e: any) {
      setPublicMsg(e?.message || "Failed to stop public link.");
    } finally {
      setPublicBusy(false);
    }
  };

  const buildInfo = `${(import.meta as any).env?.MODE || "unknown"} • ${
    (import.meta as any).env?.VITE_APP_VERSION || "dev"
  }`;

  const saveNetworking = () => {
    setConfigMsg(null);
    if (invalidOrigins.length > 0) {
      setConfigMsg(`Fix invalid origins before saving: ${invalidOrigins.map((entry) => entry.label).join(", ")}.`);
      return;
    }
    writeStoredValue(STORAGE_PUBLIC_ORIGIN, normalizedPublicOrigin);
    writeStoredValue(STORAGE_PUBLIC_BUY_ORIGIN, normalizedPublicBuyOrigin);
    writeStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN, normalizedPublicStudioOrigin);
    writeStoredValue(STORAGE_PUBLIC_ORIGIN_FALLBACK, normalizedPublicOriginFallback);
    writeStoredValue(STORAGE_PUBLIC_BUY_ORIGIN_FALLBACK, normalizedPublicBuyOriginFallback);
    writeStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN_FALLBACK, normalizedPublicStudioOriginFallback);
    setConfigMsg("Networking config saved.");
  };

  const clearNetworking = () => {
    setPublicOrigin("");
    setPublicBuyOrigin("");
    setPublicStudioOrigin("");
    setPublicOriginFallback("");
    setPublicBuyOriginFallback("");
    setPublicStudioOriginFallback("");
    writeStoredValue(STORAGE_PUBLIC_ORIGIN, "");
    writeStoredValue(STORAGE_PUBLIC_BUY_ORIGIN, "");
    writeStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN, "");
    writeStoredValue(STORAGE_PUBLIC_ORIGIN_FALLBACK, "");
    writeStoredValue(STORAGE_PUBLIC_BUY_ORIGIN_FALLBACK, "");
    writeStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN_FALLBACK, "");
    setConfigMsg("Networking overrides cleared.");
  };

  const normalizeConfig = () => {
    setConfigMsg(null);
    const nextBuy = normalizedPublicBuyOrigin || normalizedPublicBuyOriginFallback;
    const nextStudio = normalizedPublicStudioOrigin || normalizedPublicStudioOriginFallback;
    const nextCreator = normalizedPublicOrigin || normalizedPublicOriginFallback;
    const nextBuyFallback = nextBuy && nextBuy === normalizedPublicBuyOriginFallback ? "" : normalizedPublicBuyOriginFallback;
    const nextStudioFallback =
      nextStudio && nextStudio === normalizedPublicStudioOriginFallback ? "" : normalizedPublicStudioOriginFallback;
    const nextCreatorFallback = nextCreator && nextCreator === normalizedPublicOriginFallback ? "" : normalizedPublicOriginFallback;
    const invalidAfterNormalize = [
      { label: "Commerce host", value: nextBuy },
      { label: "Creator app host", value: nextStudio },
      { label: "Node domain", value: nextCreator },
      { label: "Commerce fallback", value: nextBuyFallback },
      { label: "Creator app fallback", value: nextStudioFallback },
      { label: "Node fallback", value: nextCreatorFallback }
    ].filter((entry) => entry.value && !isValidOrigin(entry.value));
    if (invalidAfterNormalize.length > 0) {
      setConfigMsg(`Cannot normalize: invalid origins in ${invalidAfterNormalize.map((entry) => entry.label).join(", ")}.`);
      return;
    }
    setPublicBuyOrigin(nextBuy);
    setPublicStudioOrigin(nextStudio);
    setPublicOrigin(nextCreator);
    setPublicBuyOriginFallback(nextBuyFallback);
    setPublicStudioOriginFallback(nextStudioFallback);
    setPublicOriginFallback(nextCreatorFallback);
    writeStoredValue(STORAGE_PUBLIC_BUY_ORIGIN, nextBuy);
    writeStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN, nextStudio);
    writeStoredValue(STORAGE_PUBLIC_ORIGIN, nextCreator);
    writeStoredValue(STORAGE_PUBLIC_BUY_ORIGIN_FALLBACK, nextBuyFallback);
    writeStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN_FALLBACK, nextStudioFallback);
    writeStoredValue(STORAGE_PUBLIC_ORIGIN_FALLBACK, nextCreatorFallback);
    if (overrideMismatch) {
      setApiBaseOverride("");
      writeStoredValue(STORAGE_API_BASE, "");
    }
    setConfigMsg("Config normalized.");
  };

  const saveApiBaseOverride = () => {
    writeStoredValue(STORAGE_API_BASE, normalizeOrigin(apiBaseOverride));
    window.location.reload();
  };

  const clearApiBaseOverride = () => {
    setApiBaseOverride("");
    writeStoredValue(STORAGE_API_BASE, "");
    window.location.reload();
  };

  const saveTunnelConfig = async () => {
    if (!token) return;
    setTunnelError(null);
    setTunnelLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/public/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          provider: tunnelProvider,
          domain: tunnelDomain,
          tunnelName
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save tunnel config");
      setTunnelProvider(json?.provider || "cloudflare");
      setTunnelDomain(json?.domain || "");
      setTunnelName(json?.tunnelName || "");
    } catch (e: any) {
      setTunnelError(e?.message || String(e));
    } finally {
      setTunnelLoading(false);
    }
  };

  const discoverTunnels = async () => {
    if (!token) return;
    setTunnelError(null);
    setTunnelLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/public/tunnels`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to list tunnels");
      setTunnelList(Array.isArray(json?.tunnels) ? json.tunnels : []);
    } catch (e: any) {
      setTunnelError(e?.message || String(e));
    } finally {
      setTunnelLoading(false);
    }
  };

  const saveNamedToken = async (autoStart?: boolean) => {
    if (!token) return;
    const trimmed = namedTokenInput.trim();
    if (!trimmed) {
      setNamedTokenMsg("Paste the connector token to continue.");
      return;
    }
    setNamedTokenBusy(true);
    setNamedTokenMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/public/named-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ token: trimmed })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save token");
      setNamedTokenInput("");
      setNamedTokenMsg("Token saved.");
      if (autoStart) await startPublicLink();
      await refreshPublicStatus();
    } catch (e: any) {
      setNamedTokenMsg(e?.message || "Failed to save token.");
    } finally {
      setNamedTokenBusy(false);
    }
  };

  const generateNamedToken = async () => {
    if (!token) return;
    setNamedTokenBusy(true);
    setNamedTokenMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/public/named-token/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to generate token");
      const tok = String(json?.token || "").trim();
      if (!tok) throw new Error("Token generation failed");
      setNamedTokenInput(tok);
      setNamedTokenMsg("Token generated. Click Save & start tunnel.");
    } catch (e: any) {
      const details = e?.message || "Failed to generate token.";
      setNamedTokenMsg(details);
    } finally {
      setNamedTokenBusy(false);
    }
  };

  const clearNamedToken = async () => {
    if (!token) return;
    setNamedTokenBusy(true);
    setNamedTokenMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/public/named-token/clear`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to clear token");
      setNamedTokenMsg("Token cleared.");
      await refreshPublicStatus();
    } catch (e: any) {
      setNamedTokenMsg(e?.message || "Failed to clear token.");
    } finally {
      setNamedTokenBusy(false);
    }
  };

  const goToModePicker = () => {
    const element = typeof document !== "undefined" ? document.getElementById("node-mode") : null;
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div style={{ padding: 16, maxWidth: 980 }}>
      <h2 style={{ margin: "8px 0 12px" }}>Config</h2>
      <p style={{ opacity: 0.7, marginBottom: 16 }}>Networking + system settings used across Certifyd Creator.</p>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Creator Journey</div>
        <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 12 }}>
          Grow from getting started to operating your own sovereign commerce node.
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {[
            {
              key: "basic_creator",
              title: "Basic Creator",
              subtitle: "Start with tips",
              capabilities: "Publish, tips, and temporary preview links. No durable paid commerce."
            },
            {
              key: "sovereign_with_provider",
              title: "Sovereign Creator (with Provider)",
              subtitle: "Enable paid commerce",
              capabilities: "Durable buy links, receipts, library, replay, and payouts via provider infrastructure (~2% fee)."
            },
            {
              key: "sovereign_node",
              title: "Sovereign Node Operator",
              subtitle: "Run your own node",
              capabilities: "Operate your own stable domain + Lightning/chain stack and remove provider infrastructure fees."
            }
          ].map((stage, index) => {
            const status =
              index === participationStageIndex
                ? "current"
                : index === participationStageIndex + 1
                  ? "next step"
                  : index > participationStageIndex
                    ? "available"
                    : "completed";
            return (
              <div
                key={stage.key}
                style={{
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 10,
                  padding: 10,
                  background: index === participationStageIndex ? "rgba(255,255,255,0.04)" : "transparent"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{stage.title}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{stage.subtitle}</div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      padding: "3px 8px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.22)",
                      color:
                        status === "current"
                          ? "#6ee7b7"
                          : status === "next step"
                            ? "#fbbf24"
                            : status === "completed"
                              ? "#a7f3d0"
                              : "#d1d5db"
                    }}
                  >
                    {status}
                  </span>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>{stage.capabilities}</div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {participationStageIndex === 0
              ? "Next step: Enable durable paid commerce with a provider."
              : participationStageIndex === 1
                ? "Next step: Become a Sovereign Node Operator to remove provider infrastructure fees."
                : "You are operating as a Sovereign Node Operator."}
          </div>
          {participationStageIndex < 2 ? (
            <button onClick={goToModePicker} style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}>
              {participationStageIndex === 0 ? "Enable Paid Commerce" : "Become a Sovereign Node"}
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Auto-Detected Node Readiness</div>
        <div style={{ opacity: 0.72, marginBottom: 10, fontSize: 13 }}>
          Runtime status is detected automatically. Configure only participation intent and identity-critical settings.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
          {nodeReadinessRows.map((row) => (
            <div key={row.label} style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{row.label}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 4 }}>
                <div style={{ fontSize: 13 }}>{row.value}</div>
                <span
                  style={{
                    fontSize: 11,
                    padding: "3px 8px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.2)",
                    color: row.ok ? "#6ee7b7" : "#fbbf24"
                  }}
                >
                  {row.ok ? "Ready" : "Needs attention"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {(apiMismatch || overrideMismatch) && (
        <div
          style={{
            border: "1px solid rgba(255,180,80,0.5)",
            background: "rgba(255,180,80,0.08)",
            borderRadius: 12,
            padding: 12,
            marginBottom: 14
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Diagnostics</div>
          {apiMismatch && (
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              This dashboard is pointed at a different machine. UI host: <b>{uiHost || "unknown"}</b> • API host:{" "}
              <b>{apiHost || "unknown"}</b>
            </div>
          )}
          {overrideMismatch && (
            <div style={{ fontSize: 13 }}>
              API override is set and does not match the current API base. Override:{" "}
              <b>{overrideHost || "invalid"}</b> • API base: <b>{apiHost || "unknown"}</b>
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <button
              onClick={clearApiBaseOverride}
              style={{ padding: "6px 10px", borderRadius: 10, cursor: "pointer" }}
            >
              Clear override & reload
            </button>
            {canForceLocal && (
              <button
                onClick={() => {
                  writeStoredValue(STORAGE_API_BASE, "http://127.0.0.1:4000");
                  window.location.reload();
                }}
                style={{ padding: "6px 10px", borderRadius: 10, cursor: "pointer", marginLeft: 8 }}
              >
                Use local API
              </button>
            )}
          </div>
        </div>
      )}

      <details
        open={Boolean(showAdvanced)}
        style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}
      >
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Advanced Diagnostics & Config Health</summary>
        <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Config health</div>
            <div style={{ opacity: 0.75, fontSize: 13 }}>{configHealthDescription}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.2)",
                background:
                  configHealthStatus === "consistent"
                    ? "rgba(16,185,129,0.14)"
                    : configHealthStatus === "mixed"
                      ? "rgba(251,191,36,0.14)"
                      : "rgba(248,113,113,0.14)",
                color: configHealthStatus === "consistent" ? "#6ee7b7" : configHealthStatus === "mixed" ? "#fde68a" : "#fda4af"
              }}
            >
              {configHealthTitle}
            </span>
            <button onClick={normalizeConfig} style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}>
              Normalize config
            </button>
          </div>
        </div>
        {configMsg ? (
          <div style={{ marginTop: 10, fontSize: 12, color: configMsg.toLowerCase().includes("invalid") ? "#fda4af" : "#fbbf24" }}>
            {configMsg}
          </div>
        ) : null}
      </details>

      <div id="node-mode" style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 600 }}>Network Participation Mode</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, opacity: 0.75 }}>Current Participation</span>
            <span
              style={{
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.04)",
                color: "#e5e7eb"
              }}
            >
              {participationMode.label}
            </span>
          </div>
        </div>
        <div style={{ opacity: 0.7, marginBottom: 10 }}>
          Choose how this node participates in the Certifyd network.
        </div>
        <div style={{ marginBottom: 10, fontSize: 12, color: "#a3a3a3" }}>
          This controls node infrastructure capabilities. Creator identity and content remain unchanged.
        </div>
        <div style={{ marginBottom: 10, fontSize: 12, opacity: 0.7 }}>{participationMode.description}</div>
        {selectedParticipationMode !== resolvedParticipationMode ? (
          <div style={{ marginBottom: 10, fontSize: 12, color: "#fbbf24" }}>
            Selected posture: <b>{participationModeMeta(selectedParticipationMode).label}</b> • Effective runtime:{" "}
            <b>{participationMode.label}</b>
          </div>
        ) : null}
        {readinessBlockers.length > 0 ? (
          <div style={{ marginBottom: 10, fontSize: 12, color: "#fbbf24" }}>
            Readiness blockers: {readinessBlockers.join(" ")}
          </div>
        ) : null}
        {delegatedCapabilities.length > 0 ? (
          <div style={{ marginBottom: 10, fontSize: 12, color: "#93c5fd" }}>
            Delegated capabilities: {delegatedCapabilities.join(", ")}
          </div>
        ) : null}
        {modeLocked ? (
          <div style={{ marginBottom: 10, fontSize: 12, color: "#fbbf24" }}>
            {modeInfo?.lockReason || "Mode is locked by server environment settings."}
          </div>
        ) : null}
        <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
          <label htmlFor="cfg-node-mode-basic" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8 }}>
            <input
              id="cfg-node-mode-basic"
              type="radio"
              name="cfg-node-mode"
              checked={selectedParticipationMode === "basic_creator"}
              disabled={!modeInfo || modeBusy || modeLocked}
              onChange={() => updateNodeMode("basic")}
            />
            <span>
              <div>Basic Creator</div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>Publish, tips, and preview links only. Upgrade to enable durable paid commerce.</div>
            </span>
          </label>
          <label htmlFor="cfg-node-mode-advanced" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8 }}>
            <input
              id="cfg-node-mode-advanced"
              type="radio"
              name="cfg-node-mode"
              checked={selectedParticipationMode === "sovereign_with_provider"}
              disabled={!modeInfo || modeBusy || modeLocked}
              onChange={() => updateNodeMode("advanced")}
            />
            <span>
              <div>Sovereign Creator (with Provider)</div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>First durable paid-commerce tier using provider infrastructure (with provider fee).</div>
            </span>
          </label>
          <label htmlFor="cfg-node-mode-lan" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8 }}>
            <input
              id="cfg-node-mode-lan"
              type="radio"
              name="cfg-node-mode"
              checked={selectedParticipationMode === "sovereign_node"}
              disabled={!modeInfo || modeBusy || modeLocked || !canSelectSovereignNode}
              onChange={() => updateNodeMode("lan")}
            />
            <span>
              <div>Sovereign Node Operator</div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>Run your own stable infrastructure to eliminate provider dependency and fees.</div>
              {!canSelectSovereignNode ? (
                <div style={{ marginTop: 4, fontSize: 12, color: "#fbbf24" }}>
                  Locked until ready: {sovereignNodeMissing.join(", ")}.
                </div>
              ) : null}
            </span>
          </label>
        </div>
        {devMode && modeInfo ? (
          <details style={{ marginTop: 10, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "8px 10px" }}>
            <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Dev Info</summary>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              <div>nodeMode: {modeInfo.nodeMode}</div>
              <div>modeSource: {modeInfo.nodeModeSource}</div>
              <div>tierSource: {modeInfo.productTierSource}</div>
            </div>
          </details>
        ) : null}
        {modeMsg ? (
          <div style={{ marginTop: 8, fontSize: 12, color: modeMsg.toLowerCase().includes("failed") ? "#fda4af" : "#fbbf24" }}>
            {modeMsg}
          </div>
        ) : null}
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Mode Service Summary</div>
        <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
          <div>
            <b>Public commerce host</b>: {stableCommerceConfigured ? canonicalCommerceHost : "Not configured"}
          </div>
          <div>
            <b>Effective commerce host</b>: {networkSummary?.capabilityResolution?.effectiveCommerceHost || "Not resolved"}
          </div>
          <div>
            <b>Effective settlement host</b>: {networkSummary?.capabilityResolution?.effectiveSettlementHost || "Not resolved"}
          </div>
          <div>
            <b>Effective buyer recovery host</b>:{" "}
            {networkSummary?.capabilityResolution?.effectiveBuyerRecoveryHost || "Not resolved"}
          </div>
          <div>
            <b>Temporary preview endpoint</b>:{" "}
            {temporaryPreviewEndpoint ? "Active (preview/testing only)" : "Not active"}
          </div>
          <div>
            <b>Provider-backed commerce</b>:{" "}
            {resolvedParticipationMode === "sovereign_with_provider" && providerConfigured ? "Enabled" : "Not active"}
          </div>
          <div>
            <b>Provider fee posture</b>:{" "}
            {typeof networkSummary?.providerServices?.totalProviderFeePercent === "number"
              ? `${networkSummary.providerServices.totalProviderFeePercent}%`
              : "Not resolved"}
          </div>
          <div>
            <b>Sovereign node infrastructure</b>: {resolvedParticipationMode === "sovereign_node" ? "Enabled" : "Not active"}
          </div>
        </div>
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Creator App</div>
        <div style={{ opacity: 0.7, marginBottom: 8 }}>
          Local API Base: <b>{apiBase}</b>
        </div>
        {overrideMismatch ? (
          <div style={{ marginBottom: 8, fontSize: 12, color: "#fbbf24" }}>
            API override points to another machine. Clear override to keep this node local.
          </div>
        ) : null}
        {showAdvanced ? (
          <>
            <label htmlFor="api-base-override">
              <div style={{ opacity: 0.7, marginBottom: 4 }}>App Base Override (advanced)</div>
              <input
                id="api-base-override"
                name="apiBaseOverride"
                value={apiBaseOverride}
                onChange={(e) => setApiBaseOverride(e.target.value)}
                placeholder="http://127.0.0.1:4000"
                className={inputClass}
                autoComplete="url"
              />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                onClick={saveApiBaseOverride}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
              >
                Save & reload
              </button>
              <button
                onClick={clearApiBaseOverride}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
              >
                Clear override
              </button>
            </div>
            <div style={{ opacity: 0.6, marginTop: 6, fontSize: 12 }}>
              This is the local creator control endpoint. It is not the buyer-facing public commerce host.
            </div>
          </>
        ) : (
          <div style={{ opacity: 0.6, marginTop: 6, fontSize: 12 }}>
            Advanced mode required to override API base.
          </div>
        )}
      </div>

      <details
        open={Boolean(showAdvanced && showNodeIdentityByDefault)}
        style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}
      >
        <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>Node Identity & Host Overrides (Advanced)</summary>
        {resolvedParticipationMode === "basic_creator" ? (
          <div style={{ marginBottom: 10, fontSize: 12, color: "#fbbf24" }}>
            Basic Creator mode keeps node infrastructure simple. Expand when you are ready to configure a stable node domain.
          </div>
        ) : null}
        <div style={{ opacity: 0.7, marginBottom: 6 }}>
          Configure how this node is identified and reached on the network.
        </div>
        <div style={{ opacity: 0.7, marginBottom: 12, fontSize: 12 }}>
          Your node domain represents public node identity when running as a Sovereign Creator Node.
        </div>
        {!showAdvanced ? (
          <div style={{ marginBottom: 10, fontSize: 12, color: "#93c5fd" }}>
            Hidden by default. Enable Advanced mode to edit host overrides.
          </div>
        ) : null}
        {!showAdvanced ? null : (
          <>
        {(partialPrimaryHosts || fallbackWithoutPrimary || fallbackDuplicatesPrimary || invalidOrigins.length > 0) && (
          <div style={{ marginBottom: 10, fontSize: 12, color: "#fbbf24" }}>
            {invalidOrigins.length > 0
              ? `Invalid origins: ${invalidOrigins.map((entry) => entry.label).join(", ")}.`
              : partialPrimaryHosts
                ? "Primary node/commerce hosts are partially configured. Set all primary hosts or clear unused ones."
                : fallbackWithoutPrimary
                  ? "A fallback host is set without a matching primary host."
                  : "Fallback host duplicates primary host and can be cleared."}
          </div>
        )}

        <div style={{ display: "grid", gap: 8 }}>
          <label htmlFor="public-buy-origin">
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Commerce Host (public)</div>
            <input
              id="public-buy-origin"
              name="publicBuyOrigin"
              value={publicBuyOrigin}
              onChange={(e) => setPublicBuyOrigin(e.target.value)}
              placeholder="https://commerce.yourdomain.com"
              className={inputClass}
              autoComplete="url"
            />
          </label>
          <label htmlFor="public-studio-origin">
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Creator App Host (optional)</div>
            <input
              id="public-studio-origin"
              name="publicStudioOrigin"
              value={publicStudioOrigin}
              onChange={(e) => setPublicStudioOrigin(e.target.value)}
              placeholder="https://app.yourdomain.com"
              className={inputClass}
              autoComplete="url"
            />
          </label>
          <label htmlFor="public-origin">
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Node Domain (public identity)</div>
            <input
              id="public-origin"
              name="publicOrigin"
              value={publicOrigin}
              onChange={(e) => setPublicOrigin(e.target.value)}
              placeholder="https://node.yourdomain.com"
              className={inputClass}
              autoComplete="url"
            />
          </label>
        </div>

        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Advanced fallback hosts (optional)</summary>
          <div style={{ opacity: 0.65, marginTop: 6, fontSize: 12 }}>
            Fallback routing values are kept for compatibility. They are not the primary node identity settings.
          </div>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <label htmlFor="public-buy-origin-fallback">
              <div style={{ opacity: 0.7, marginBottom: 4 }}>Commerce fallback</div>
              <input
                id="public-buy-origin-fallback"
                name="publicBuyOriginFallback"
                value={publicBuyOriginFallback}
                onChange={(e) => setPublicBuyOriginFallback(e.target.value)}
                placeholder="https://commerce.fallback.com"
                className={inputClass}
                autoComplete="url"
              />
            </label>
            <label htmlFor="public-studio-origin-fallback">
              <div style={{ opacity: 0.7, marginBottom: 4 }}>Creator app fallback</div>
              <input
                id="public-studio-origin-fallback"
                name="publicStudioOriginFallback"
                value={publicStudioOriginFallback}
                onChange={(e) => setPublicStudioOriginFallback(e.target.value)}
                placeholder="https://app.fallback.com"
                className={inputClass}
                autoComplete="url"
              />
            </label>
            <label htmlFor="public-origin-fallback">
              <div style={{ opacity: 0.7, marginBottom: 4 }}>Node fallback</div>
              <input
                id="public-origin-fallback"
                name="publicOriginFallback"
                value={publicOriginFallback}
                onChange={(e) => setPublicOriginFallback(e.target.value)}
                placeholder="https://node.fallback.com"
                className={inputClass}
                autoComplete="url"
              />
            </label>
          </div>
        </details>

        <div style={{ marginTop: 12, padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", opacity: 0.85 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Public Commerce</div>
          <div style={{ fontSize: 12 }}>
            Configure the stable public host used for buyer purchases, receipts, library, and replay.
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            Temporary links are for preview/testing only and are not used for durable paid commerce.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={saveNetworking}
            style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
          >
            Save networking
          </button>
          <button
            onClick={clearNetworking}
            style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
          >
            Clear overrides
          </button>
        </div>

        <div style={{ marginTop: 12, opacity: 0.7 }}>
          Buyer recovery health path: <b>{DEFAULT_HEALTH_PATH}</b>
        </div>
          </>
        )}
      </details>

      <details
        open={showPreviewByDefault}
        style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}
      >
        <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>Temporary Preview Link</summary>
        {publicStatus ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <button
              onClick={startPublicLink}
              disabled={quickDisabled || publicBusy || publicStatus?.status === "starting" || publicStatus?.status === "online"}
              style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
            >
              Start temporary link
            </button>
            {quickDisabled ? (
            <div style={{ fontSize: 12, color: "#ffb4b4", alignSelf: "center" }}>
              Preview only. Advanced prefers stable named infrastructure when configured.
            </div>
            ) : null}
            {productTier === "advanced" && publicStatus?.mode === "quick" && publicStatus?.publicOrigin ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={() => window.open(String(publicStatus.publicOrigin), "_blank", "noopener,noreferrer")}
                  style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
                >
                  Open temporary link
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(String(publicStatus.publicOrigin)).catch(() => {});
                  }}
                  style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
                >
                  Copy temporary link
                </button>
              </div>
            ) : null}
            <button
              onClick={stopPublicLink}
              disabled={publicBusy || publicStatus?.status !== "online"}
              style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
            >
              Stop sharing
            </button>
            <button
              onClick={refreshPublicStatus}
              disabled={publicBusy}
              style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
            >
              Refresh status
            </button>
          </div>
        ) : null}
        {publicStatus ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <button
              onClick={() => setNamedOverride(true)}
              disabled={publicBusy || publicStatus?.namedDisabled}
              style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
            >
              Disable named (override)
            </button>
            <button
              onClick={() => setNamedOverride(false)}
              disabled={publicBusy || !publicStatus?.namedDisabled}
              style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
            >
              Re-enable named
            </button>
            {publicStatus?.namedDisabled ? (
              <div style={{ fontSize: 12, color: "#ffb4b4", alignSelf: "center" }}>
                Named tunnel override is ON. Env config is ignored.
              </div>
            ) : null}
          </div>
        ) : null}
        <div style={{ opacity: 0.7, marginBottom: 10 }}>
          Preview/testing reachability controls.
        </div>
        <div style={{ opacity: 0.7, marginBottom: 10, fontSize: 12 }}>
          Temporary preview links are not valid durable commerce infrastructure and are not used for buyer recovery.
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }} htmlFor="tunnel-settings-enabled">
          <input
            id="tunnel-settings-enabled"
            name="tunnelSettingsEnabled"
            type="checkbox"
            checked={tunnelEnabled}
            onChange={async (e) => {
              const v = e.target.checked;
              setTunnelEnabled(v);
              writeStoredValue(STORAGE_TUNNEL_CONFIG_ENABLED, v ? "1" : "");
              if (!v && token) {
                try {
                  const res = await fetch(`${apiBase}/api/public/config`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ provider: null, domain: null, tunnelName: null })
                  });
                  const json = await res.json();
                  if (res.ok) {
                    setTunnelProvider(json?.provider || "cloudflare");
                    setTunnelDomain(json?.domain || "");
                    setTunnelName(json?.tunnelName || "");
                    await refreshPublicStatus();
                  }
                } catch {}
              }
              if (!v && publicStatus?.mode === "named" && publicStatus?.status !== "offline") {
                setPublicMsg("Named tunnel is still running. Click Stop sharing to shut it down.");
              }
            }}
          />
          <span>Enable advanced preview routing settings</span>
        </label>
        {!tunnelEnabled && publicStatus?.mode === "named" && publicStatus?.status !== "offline" ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#ffb4b4" }}>
            Named tunnel still running. Use <b>Stop sharing</b> to disable it.
          </div>
        ) : null}
        {!tunnelEnabled && (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
            Advanced preview routing is off — Quick tunnel will be used for preview/testing only.
          </div>
        )}

        {!token && <div style={{ marginTop: 8, opacity: 0.7 }}>Sign in to manage tunnel settings.</div>}

        {token && (
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {tunnelError && <div style={{ color: "#ff8080" }}>{tunnelError}</div>}
            {publicStatus?.mode && publicStatus.mode !== "named" ? (
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Named tunnel settings apply only when PUBLIC_MODE=named.
              </div>
            ) : null}
            <label htmlFor="tunnel-provider">
              <div style={{ opacity: 0.7, marginBottom: 4 }}>Provider</div>
              <input
                id="tunnel-provider"
                name="tunnelProvider"
                value={tunnelProvider}
                onChange={(e) => setTunnelProvider(e.target.value)}
                placeholder="cloudflare"
                className={inputClass}
                disabled={!tunnelEnabled}
                autoComplete="off"
              />
            </label>
            <label htmlFor="tunnel-domain">
              <div style={{ opacity: 0.7, marginBottom: 4 }}>Node domain (base)</div>
              <input
                id="tunnel-domain"
                name="tunnelDomain"
                value={tunnelDomain}
                onChange={(e) => setTunnelDomain(e.target.value)}
                placeholder="contentbox.link"
                className={inputClass}
                disabled={!tunnelEnabled}
                autoComplete="off"
              />
            <div style={{ opacity: 0.6, marginTop: 4, fontSize: 12 }}>
                Base domain for stable node identity and buyer-facing commerce links.
              </div>
            </label>
            <label htmlFor="tunnel-name">
              <div style={{ opacity: 0.7, marginBottom: 4 }}>Tunnel name</div>
              <input
                id="tunnel-name"
                name="tunnelName"
                value={tunnelName}
                onChange={(e) => setTunnelName(e.target.value)}
                placeholder="contentbox"
                className={inputClass}
                disabled={!tunnelEnabled}
                autoComplete="off"
              />
            </label>
            {tunnelEnabled ? (
              <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Connect named tunnel (one‑time)</div>
                <div style={{ opacity: 0.65, fontSize: 12, marginBottom: 8 }}>
                  Paste the Cloudflare connector token once. Certifyd Creator will reuse it to start the tunnel.
                </div>
                <input
                  id="tunnel-connector-token"
                  name="tunnelConnectorToken"
                  value={namedTokenInput}
                  onChange={(e) => setNamedTokenInput(e.target.value)}
                  placeholder="Cloudflare connector token"
                  className={inputClass}
                  disabled={!tunnelEnabled}
                  autoComplete="off"
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={generateNamedToken}
                    disabled={namedTokenBusy || !tunnelEnabled}
                    style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
                  >
                    Generate token
                  </button>
                  <button
                    onClick={() => saveNamedToken(false)}
                    disabled={namedTokenBusy || !tunnelEnabled}
                    style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
                  >
                    Save token
                  </button>
                  <button
                    onClick={() => saveNamedToken(true)}
                    disabled={namedTokenBusy || !tunnelEnabled}
                    style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
                  >
                    Save & start tunnel
                  </button>
                  {publicStatus?.namedTokenStored ? (
                    <button
                      onClick={clearNamedToken}
                      disabled={namedTokenBusy || !tunnelEnabled}
                      style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
                    >
                      Clear saved token
                    </button>
                  ) : null}
                </div>
                {namedTokenMsg ? <div style={{ marginTop: 6, color: "#ffb4b4" }}>{namedTokenMsg}</div> : null}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={saveTunnelConfig}
                disabled={tunnelLoading || !tunnelEnabled}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
              >
                Save tunnel config
              </button>
              <button
                onClick={discoverTunnels}
                disabled={tunnelLoading || !tunnelEnabled}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
              >
                Discover tunnels
              </button>
            </div>
            {tunnelList.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Found tunnels</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {tunnelList.map((t, i) => {
                    const label = t?.name || t?.id || String(i + 1);
                    return (
                      <button
                        key={`${t?.id || t?.name || i}`}
                        type="button"
                        onClick={() => setTunnelName(String(label))}
                        className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </details>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>System</div>
        <div><b>API base</b>: {apiBase}</div>
        <div><b>Build</b>: {buildInfo}</div>
        <div><b>Token</b>: {token ? `present (${token.slice(0, 10)}…)` : "not set"}</div>
        <div style={{ marginTop: 10 }}>
          <button
            onClick={() => { clearToken(); window.location.reload(); }}
            style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
          >
            Clear token & reload
          </button>
        </div>
      </div>

      <details
        open={showReachabilityByDefault}
        style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}
      >
        <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>Node Reachability Status</summary>
        {err && <div style={{ color: "#ff8080" }}>Error: {err}</div>}
        {!err && !health && <div>Checking…</div>}
        {health && (
          <div style={{ display: "grid", gap: 4 }}>
            {publicStatus ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                <span
                  className={`text-[11px] rounded-full border px-2 py-0.5 ${
                    publicStatus?.status === "online"
                      ? "border-emerald-900 bg-emerald-950/30 text-emerald-200"
                      : publicStatus?.status === "starting"
                        ? "border-amber-900 bg-amber-950/30 text-amber-200"
                        : publicStatus?.status === "error"
                          ? "border-red-900 bg-red-950/30 text-red-200"
                          : "border-neutral-800 bg-neutral-950 text-neutral-400"
                  }`}
                >
                  {publicStatus?.status === "online"
                    ? "ONLINE"
                    : publicStatus?.status === "starting"
                      ? "STARTING"
                      : publicStatus?.status === "error"
                        ? "ERROR"
                        : "OFFLINE"}
                </span>
                <span className="text-[11px] rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-neutral-500">
                  DDNS disabled
                </span>
                <span className="text-[11px] rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-neutral-400">
                  {publicStatus?.mode === "named"
                    ? `Stable node route (${(publicStatus as any)?.tunnelName || "Named"})`
                    : publicStatus?.mode === "quick"
                      ? productTier === "advanced"
                        ? "Temporary preview (testing only)"
                        : "Temporary preview"
                      : "Local"}
                </span>
              </div>
            ) : null}
            {publicStatus ? (
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                Controls for temporary preview links are in <b>Temporary Preview Link</b>.
              </div>
            ) : null}
            {publicMsg ? <div style={{ color: "#ffb4b4" }}>{publicMsg}</div> : null}
            <div><b>OK</b>: {health.ok ? "yes" : "no"}</div>
            <div><b>Commerce host</b>: {health.publicBuyOrigin || "—"}</div>
            <div><b>Creator app host</b>: {health.publicStudioOrigin || "—"}</div>
            <div><b>Node domain</b>: {health.publicOrigin || "—"}</div>
            <div><b>Last seen</b>: {health.ts || "—"}</div>
            <div>
              <b>PUBLIC_ORIGIN detected</b>: {publicOriginWarn ? "⚠️" : "✅"}{" "}
              {publicOriginDetected || "—"}
              {publicOriginWarn ? <span style={{ opacity: 0.7 }}> (links may use derived origin)</span> : null}
            </div>
            {publicStatus ? (
              <div>
                <b>Last check</b>:{" "}
                {publicStatus?.lastCheckedAt ? new Date(publicStatus.lastCheckedAt).toLocaleString() : "—"}
              </div>
            ) : null}
            {publicStatus ? (
              <>
                <div><b>Public node origin</b>: {publicStatus?.canonicalOrigin || publicStatus?.publicOrigin || "—"}</div>
                <div><b>Last error</b>: {publicStatus?.lastError || "—"}</div>
                <div><b>cloudflared</b>: {publicStatus?.cloudflared?.available ? "yes" : "no"}</div>
                <div><b>cloudflared path</b>: {publicStatus?.cloudflared?.managedPath || "—"}</div>
                <div><b>cloudflared version</b>: {publicStatus?.cloudflared?.version || "—"}</div>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }} htmlFor="diagnostics-public-autostart">
                  <input
                    id="diagnostics-public-autostart"
                    name="diagnosticsPublicAutostart"
                    type="checkbox"
                    checked={Boolean(publicStatus?.autoStartEnabled)}
                    onChange={async (e) => {
                      try {
                        const res = await fetch(`${apiBase}/api/public/autostart`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ enabled: e.target.checked })
                        });
                        const json = await res.json();
                        setPublicStatus(json || null);
                      } catch {
                        setPublicMsg("Failed to update auto-start setting.");
                      }
                    }}
                  />
                  Auto-start Public Link on launch
                </label>
                <div>
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch(`${apiBase}/api/public/consent/reset`, {
                          method: "POST",
                          headers: { Authorization: `Bearer ${token}` }
                        });
                        const json = await res.json();
                        setPublicStatus(json || null);
                      } catch {
                        setPublicMsg("Failed to reset consent.");
                      }
                    }}
                    style={{ padding: "6px 10px", borderRadius: 10, cursor: "pointer" }}
                  >
                    Reset Public Link consent
                  </button>
                </div>
                <button
                  onClick={() => setPublicAdvancedOpen((v) => !v)}
                  style={{ padding: "6px 10px", borderRadius: 10, cursor: "pointer" }}
                >
                  {publicAdvancedOpen ? "Hide details" : "Show details"}
                </button>
                {publicAdvancedOpen ? (
                  <div style={{ opacity: 0.8 }}>
                    <div><b>Mode</b>: {publicStatus?.mode || "—"}</div>
                    <div><b>Consent required</b>: {publicStatus?.consentRequired ? "yes" : "no"}</div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        )}
      </details>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Payments</div>
        <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 10 }}>
          Set your Lightning address or LNURL to receive payments in Basic mode.
        </div>
        <button
          onClick={() => onOpenPayments?.()}
          style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
        >
          Open payments settings
        </button>
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Publishing</div>
        <div style={{ opacity: 0.75 }}>
          Use “Publish to Website” on a content item to generate embed snippets and a public buy link. No secrets are stored here.
        </div>
      </div>
    </div>
  );
}
