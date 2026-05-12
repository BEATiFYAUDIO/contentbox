
import { useEffect, useMemo, useState } from "react";
import { clearToken, getToken } from "../lib/auth";
import { getApiBase } from "../lib/api";

const DEFAULT_HEALTH_PATH = "/api/health";

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
  selectedMode?: "basic" | "advanced" | "lan";
  effectiveMode?: "basic" | "advanced" | "lan";
  nodeModeSource: string;
  productTier: "basic" | "advanced" | "lan";
  productTierSource: string;
  tierLocked: boolean;
  lockReason: string;
  restartRequired: boolean;
  modeReadiness?: {
    sovereignCreatorEligible: boolean;
    sovereignNodeEligible: boolean;
    namedTunnelDetected: boolean;
    localBitcoinReady: boolean;
    localLndReady: boolean;
    localCommerceReady: boolean;
    blockers: string[];
  };
};

type ProgressStep = {
  title: string;
  detail: string;
  state: "done" | "current" | "pending";
};

type LightningRuntimeSnapshot = {
  connected: boolean;
  canReceive: boolean;
  canSend: boolean;
  capabilityState: string;
  sendFailureReason: string | null;
  source: string;
};

type LightningAdminSnapshot = {
  configured: boolean;
  restUrl: string | null;
  network: string | null;
  lastTestedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  defaults?: { restUrl?: string | null; tlsCertPath?: string | null; macaroonPath?: string | null };
  runtime?: Partial<LightningRuntimeSnapshot>;
};

type LightningReadinessSnapshot = {
  ok: boolean;
  configured: boolean;
  nodeReachable: boolean;
  node?: { alias?: string; identityPubkey?: string; network?: string };
  wallet?: { syncedToChain?: boolean; syncedToGraph?: boolean; blockHeight?: number };
  channels?: { count?: number };
  receiveReady?: boolean;
  hints?: string[];
  runtime?: Partial<LightningRuntimeSnapshot>;
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

type FanNetworkTestResult = {
  ok: boolean;
  checkedAt: string;
  endpoint: string;
  itemCount: number;
  jsonValid: boolean;
  reachable: boolean;
  message: string;
};

const STORAGE_PUBLIC_ORIGIN = "contentbox.publicOrigin";
const STORAGE_PUBLIC_BUY_ORIGIN = "contentbox.publicBuyOrigin";
const STORAGE_PUBLIC_STUDIO_ORIGIN = "contentbox.publicStudioOrigin";
const STORAGE_PUBLIC_ORIGIN_FALLBACK = "contentbox.publicOriginFallback";
const STORAGE_PUBLIC_BUY_ORIGIN_FALLBACK = "contentbox.publicBuyOriginFallback";
const STORAGE_PUBLIC_STUDIO_ORIGIN_FALLBACK = "contentbox.publicStudioOriginFallback";
const STORAGE_NETWORKING_CUSTOMIZED = "contentbox.networkingCustomized";
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

function isTemporaryPublicOrigin(origin: string): boolean {
  const host = safeHost(origin);
  if (!host) return true;
  const bareHost = host.split(":")[0] || host;
  if (bareHost.endsWith(".trycloudflare.com")) return true;
  return isPrivateHost(bareHost);
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

export default function ConfigPage({
  showAdvanced,
  onOpenPayments,
  onOpenLightningConfig,
  onIdentityRefresh
}: {
  showAdvanced?: boolean;
  onOpenPayments?: () => void;
  onOpenLightningConfig?: () => void;
  onIdentityRefresh?: () => void;
}) {
  const devMode = Boolean((import.meta as any).env?.DEV);
  const apiBase = useMemo(() => getApiBase(), []);
  const uiOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const token = getToken();
  const inputClass =
    "w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-white placeholder:text-neutral-600 outline-none focus:border-neutral-600";
  const [publicOrigin, setPublicOrigin] = useState<string>("");
  const [publicBuyOrigin, setPublicBuyOrigin] = useState<string>("");
  const [publicStudioOrigin, setPublicStudioOrigin] = useState<string>("");
  const [publicOriginFallback, setPublicOriginFallback] = useState<string>("");
  const [publicBuyOriginFallback, setPublicBuyOriginFallback] = useState<string>("");
  const [publicStudioOriginFallback, setPublicStudioOriginFallback] = useState<string>("");
  const [tunnelEnabled, setTunnelEnabled] = useState<boolean>(() => {
    const raw = readStoredValue(STORAGE_TUNNEL_CONFIG_ENABLED);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return false;
  });
  const [tunnelProvider, setTunnelProvider] = useState<string>("cloudflare");
  const [tunnelDomain, setTunnelDomain] = useState<string>("");
  const [tunnelName, setTunnelName] = useState<string>("");
  const [tunnelError, setTunnelError] = useState<string | null>(null);
  const [tunnelActionMsg, setTunnelActionMsg] = useState<string | null>(null);
  const [tunnelLoading, setTunnelLoading] = useState<boolean>(false);
  const [tunnelList, setTunnelList] = useState<Array<{ name?: string; id?: string }>>([]);
  const [discoveredTunnelNameState, setDiscoveredTunnelNameState] = useState<string | null>(null);
  const [namedTunnelDetectedState, setNamedTunnelDetectedState] = useState<boolean>(false);
  const [tokenBootstrapRequiredState, setTokenBootstrapRequiredState] = useState<boolean>(true);
  const [namedTokenInput, setNamedTokenInput] = useState<string>("");
  const [namedTokenBusy, setNamedTokenBusy] = useState<boolean>(false);
  const [namedTokenMsg, setNamedTokenMsg] = useState<string | null>(null);
  const [publicStatus, setPublicStatus] = useState<any | null>(null);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<any | null>(null);
  const [publicBusy, setPublicBusy] = useState(false);
  const [publicMsg, setPublicMsg] = useState<string | null>(null);
  const [publicAdvancedOpen, setPublicAdvancedOpen] = useState(false);
  const [networkingOverridesOpen, setNetworkingOverridesOpen] = useState(false);
  const [publicOriginDetected, setPublicOriginDetected] = useState<string>("");
  const [publicOriginWarn, setPublicOriginWarn] = useState<boolean>(false);
  const [apiBaseOverride, setApiBaseOverride] = useState<string>(() => readStoredValue(STORAGE_API_BASE));
  const [modeInfo, setModeInfo] = useState<NodeModeStatus | null>(null);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeMsg, setModeMsg] = useState<string | null>(null);
  const [lightningAdmin, setLightningAdmin] = useState<LightningAdminSnapshot | null>(null);
  const [lightningReadiness, setLightningReadiness] = useState<LightningReadinessSnapshot | null>(null);
  const [lightningBalances, setLightningBalances] = useState<LightningBalancesSnapshot | null>(null);
  const [lightningWalletError, setLightningWalletError] = useState<string | null>(null);
  const [fanTestBusy, setFanTestBusy] = useState(false);
  const [fanTestResult, setFanTestResult] = useState<FanNetworkTestResult | null>(null);
  const [fanTestError, setFanTestError] = useState<string | null>(null);
  const [fanSubmitMsg, setFanSubmitMsg] = useState<string | null>(null);
  const [reconnectOriginInput, setReconnectOriginInput] = useState<string>("");
  const [reconnectBusy, setReconnectBusy] = useState(false);
  const [reconnectMsg, setReconnectMsg] = useState<string | null>(null);
  const [lastNamedAutoStartKickAt, setLastNamedAutoStartKickAt] = useState<number>(0);
  const apiHost = safeHost(apiBase);
  const uiHost = safeHost(uiOrigin);
  const overrideHost = safeHost(apiBaseOverride);
  const overrideActive = Boolean(apiBaseOverride.trim());
  const apiMismatch = Boolean(uiHost && apiHost && uiHost !== apiHost);
  const overrideMismatch = Boolean(overrideActive && overrideHost && overrideHost !== apiHost);
  const canForceLocal = Boolean(uiHost && (uiHost === "localhost" || uiHost === "127.0.0.1"));
  const detectedPublicOrigin = normalizeOrigin(
    String(publicStatus?.canonicalOrigin || publicStatus?.publicOrigin || publicOrigin || "").trim()
  );
  const fanDiscoverableEndpoint = detectedPublicOrigin
    ? `${detectedPublicOrigin}/public/discoverable-content`
    : "";
  const showReconnectDiscovery =
    (modeInfo?.nodeMode === "basic") || !detectedPublicOrigin || isTemporaryPublicOrigin(detectedPublicOrigin);

  async function testFanNetworkReadiness() {
    setFanTestBusy(true);
    setFanTestError(null);
    setFanSubmitMsg(null);
    try {
      if (!detectedPublicOrigin) {
        setFanTestResult(null);
        setFanTestError("No public origin detected.");
        return;
      }
      const endpoint = `${detectedPublicOrigin}/public/discoverable-content?limit=5`;
      const checkedAt = new Date().toISOString();
      const res = await fetch(endpoint, {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      const text = await res.text();
      let parsed: any = null;
      let jsonValid = false;
      try {
        parsed = text ? JSON.parse(text) : null;
        jsonValid = true;
      } catch {
        jsonValid = false;
      }
      const itemCount = Array.isArray(parsed?.items) ? parsed.items.length : 0;
      const ok = Boolean(res.ok && jsonValid);
      setFanTestResult({
        ok,
        checkedAt,
        endpoint,
        itemCount,
        jsonValid,
        reachable: Boolean(res.ok),
        message: ok
          ? `Ready${itemCount > 0 ? ` (${itemCount} item${itemCount === 1 ? "" : "s"})` : " (0 items found)"}`
          : `Failed (HTTP ${res.status})`
      });
      if (!ok) {
        setFanTestError(
          !res.ok
            ? `Endpoint returned HTTP ${res.status}.`
            : "Endpoint response is not valid JSON."
        );
      }
    } catch (e: any) {
      setFanTestResult({
        ok: false,
        checkedAt: new Date().toISOString(),
        endpoint: fanDiscoverableEndpoint,
        itemCount: 0,
        jsonValid: false,
        reachable: false,
        message: "Unreachable"
      });
      setFanTestError(e?.message || String(e));
    } finally {
      setFanTestBusy(false);
    }
  }

  async function submitToFanNetwork() {
    setFanSubmitMsg(null);
    const checkedAt = fanTestResult?.checkedAt || new Date().toISOString();
    const itemCount = fanTestResult?.itemCount ?? 0;
    const testSummary = fanTestResult
      ? fanTestResult.ok
        ? "pass"
        : "fail"
      : "not_run";
    const issueTitle = `Join Fan Network: ${detectedPublicOrigin || "unknown-origin"}`;
    const issueBody = [
      `publicOrigin: ${detectedPublicOrigin || "unknown"}`,
      `discoverableEndpoint: ${fanDiscoverableEndpoint || "unknown"}`,
      `testResult: ${testSummary}`,
      `itemCount: ${itemCount}`,
      "",
      "operatorNote:",
      "<add any notes here>",
      "",
      `timestamp: ${checkedAt}`
    ].join("\n");
    const baseIssueUrl = "https://github.com/BEATiFYAUDIO/certifyd-fan-pwa/issues/new";
    const fullUrl = `${baseIssueUrl}?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(issueBody)}`;

    if (fullUrl.length <= 1900) {
      window.open(fullUrl, "_blank", "noopener,noreferrer");
      setFanSubmitMsg("Opened prefilled GitHub issue.");
      return;
    }

    try {
      await navigator.clipboard.writeText(issueBody);
      const fallbackUrl = `${baseIssueUrl}?title=${encodeURIComponent(issueTitle)}`;
      window.open(fallbackUrl, "_blank", "noopener,noreferrer");
      setFanSubmitMsg("Issue template copied to clipboard. Paste into the GitHub issue.");
    } catch {
      setFanSubmitMsg("Could not copy issue template. Please copy details manually.");
    }
  }

  async function reconnectDiscoveryOrigin() {
    if (!token) return;
    setReconnectMsg(null);
    const normalized = normalizeOrigin(reconnectOriginInput);
    if (!normalized) {
      setReconnectMsg("Enter a valid public https URL.");
      return;
    }
    setReconnectBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/discovery/public-origin`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ publicOrigin: normalized })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const message = String(json?.message || json?.error || "Failed to reconnect Discovery.");
        setReconnectMsg(message);
        return;
      }
      setReconnectMsg(String(json?.message || "Discovery origin updated."));
      await refreshPublicStatus({ silent: true, discover: true });
      setReconnectOriginInput(String(json?.publicOrigin || normalized));
    } catch (e: any) {
      setReconnectMsg(e?.message || "Failed to reconnect Discovery.");
    } finally {
      setReconnectBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const customized = readStoredValue(STORAGE_NETWORKING_CUSTOMIZED) === "1";
      const fallback = {
        publicOrigin: readStoredValue(STORAGE_PUBLIC_ORIGIN),
        publicBuyOrigin: readStoredValue(STORAGE_PUBLIC_BUY_ORIGIN),
        publicStudioOrigin: readStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN),
        publicOriginFallback: readStoredValue(STORAGE_PUBLIC_ORIGIN_FALLBACK),
        publicBuyOriginFallback: readStoredValue(STORAGE_PUBLIC_BUY_ORIGIN_FALLBACK),
        publicStudioOriginFallback: readStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN_FALLBACK)
      };
      if (!token) {
        if (!customized || cancelled) return;
        setPublicOrigin(fallback.publicOrigin);
        setPublicBuyOrigin(fallback.publicBuyOrigin);
        setPublicStudioOrigin(fallback.publicStudioOrigin);
        setPublicOriginFallback(fallback.publicOriginFallback);
        setPublicBuyOriginFallback(fallback.publicBuyOriginFallback);
        setPublicStudioOriginFallback(fallback.publicStudioOriginFallback);
        return;
      }
      try {
        const res = await fetch(`${apiBase}/api/public/config`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json) {
          setPublicOrigin(String(json.publicOrigin || ""));
          setPublicBuyOrigin(String(json.publicBuyOrigin || ""));
          setPublicStudioOrigin(String(json.publicStudioOrigin || ""));
          setPublicOriginFallback(String(json.publicOriginFallback || ""));
          setPublicBuyOriginFallback(String(json.publicBuyOriginFallback || ""));
          setPublicStudioOriginFallback(String(json.publicStudioOriginFallback || ""));
          return;
        }
      } catch {
        // fall through to local fallback
      }
      if (!customized || cancelled) return;
      setPublicOrigin(fallback.publicOrigin);
      setPublicBuyOrigin(fallback.publicBuyOrigin);
      setPublicStudioOrigin(fallback.publicStudioOrigin);
      setPublicOriginFallback(fallback.publicOriginFallback);
      setPublicBuyOriginFallback(fallback.publicBuyOriginFallback);
      setPublicStudioOriginFallback(fallback.publicStudioOriginFallback);
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, token]);

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
    if (!token) return;
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
          const provider = json?.provider || "cloudflare";
          const domain = json?.domain || "";
          const name = json?.tunnelName || "";
          setTunnelProvider(provider);
          setTunnelDomain(domain);
          setTunnelName(name);
          const hasSavedNamedConfig = Boolean(String(provider || "").trim() || String(domain || "").trim() || String(name || "").trim());
          const storedTunnelFieldsPref = readStoredValue(STORAGE_TUNNEL_CONFIG_ENABLED);
          if (hasSavedNamedConfig && storedTunnelFieldsPref === "") {
            setTunnelEnabled(true);
            writeStoredValue(STORAGE_TUNNEL_CONFIG_ENABLED, "1");
          }
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
  }, [apiBase, token]);

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
    let cancelled = false;
    (async () => {
      if (!token) {
        if (cancelled) return;
        setLightningAdmin(null);
        setLightningReadiness(null);
        setLightningBalances(null);
        setLightningWalletError(null);
        return;
      }
      try {
        setLightningWalletError(null);
        const headers = { Authorization: `Bearer ${token}` };
        const [adminRes, readinessRes, balancesRes] = await Promise.all([
          fetch(`${apiBase}/api/admin/lightning`, { method: "GET", headers }),
          fetch(`${apiBase}/api/admin/lightning/readiness`, { method: "GET", headers }),
          fetch(`${apiBase}/api/admin/lightning/balances`, { method: "GET", headers })
        ]);
        const [adminJson, readinessJson, balancesJson] = await Promise.all([
          adminRes.json().catch(() => null),
          readinessRes.json().catch(() => null),
          balancesRes.json().catch(() => null)
        ]);
        if (cancelled) return;
        if (adminRes.ok && adminJson) setLightningAdmin(adminJson as LightningAdminSnapshot);
        else setLightningAdmin(null);
        if (readinessRes.ok && readinessJson) setLightningReadiness(readinessJson as LightningReadinessSnapshot);
        else setLightningReadiness(null);
        if (balancesRes.ok && balancesJson) setLightningBalances(balancesJson as LightningBalancesSnapshot);
        else setLightningBalances(null);
        if (!adminRes.ok && !readinessRes.ok && !balancesRes.ok) {
          const permissionBlocked = [adminRes.status, readinessRes.status, balancesRes.status].every((code) => code === 401 || code === 403);
          if (permissionBlocked) {
            setLightningWalletError("Local LND wallet details are available in sovereign/provider mode.");
            return;
          }
          setLightningWalletError(
            String(
              (adminJson as any)?.error ||
                (readinessJson as any)?.error ||
                (balancesJson as any)?.error ||
                "Lightning wallet details unavailable."
            )
          );
        }
      } catch (e: any) {
        if (!cancelled) setLightningWalletError(e?.message || "Lightning wallet details unavailable.");
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
  const resolvedNodeMode = ((modeInfo?.effectiveMode || modeInfo?.selectedMode || modeInfo?.nodeMode || "basic") as
    | "basic"
    | "advanced"
    | "lan");
  const nodeMode = resolvedNodeMode;
  const isSovereignPosture = nodeMode === "advanced" || nodeMode === "lan";
  const namedConfigured = Boolean(diagnosticsStatus?.publicStatus?.namedConfigured);
  const quickDisabled = isSovereignPosture && namedConfigured;
  const modeLocked = Boolean(modeInfo?.tierLocked);
  const namedOriginCandidate = String(publicStatus?.canonicalOrigin || publicStatus?.publicOrigin || "").trim();
  const namedTunnelOnline =
    publicStatus?.mode === "named" &&
    publicStatus?.status === "online" &&
    !publicStatus?.namedDisabled &&
    Boolean(namedOriginCandidate) &&
    !isTemporaryPublicOrigin(namedOriginCandidate);
  const configuredTunnelName = String(tunnelName || publicStatus?.tunnelName || "").trim();
  const discoveredTunnel = tunnelList.find((t) => {
    const candidateName = String(t?.name || "").trim().toLowerCase();
    const candidateId = String(t?.id || "").trim().toLowerCase();
    const expected = configuredTunnelName.toLowerCase();
    return Boolean(expected) && (candidateName === expected || candidateId === expected);
  });
  const discoveredTunnelNameFromList = String(discoveredTunnel?.name || discoveredTunnel?.id || "").trim() || null;
  const discoveredTunnelNameFromStatus = String(publicStatus?.tunnelName || "").trim() || null;
  const discoveredTunnelName = discoveredTunnelNameState || discoveredTunnelNameFromList || discoveredTunnelNameFromStatus;
  const cloudflaredAvailable = Boolean(publicStatus?.cloudflared?.available);
  const tunnelControlMode = String(publicStatus?.tunnelControl?.mode || "unknown");
  const tunnelControlMessage = String(publicStatus?.tunnelControl?.message || "").trim();
  const serviceManagedTokenMode = tunnelControlMode === "service_token";
  // Treat named tunnel as "detected" only when it is locally discoverable/manageable.
  // A stale status.mode==="named" on another machine should not block Basic temporary links.
  const namedTunnelDetectedFromStatus =
    !publicStatus?.namedDisabled &&
    Boolean(publicStatus?.namedConfigured) &&
    (Boolean(discoveredTunnelNameFromStatus) || publicStatus?.mode === "named");
  const namedTunnelDetectedRaw =
    namedTunnelDetectedState || Boolean(discoveredTunnelNameFromList) || namedTunnelDetectedFromStatus;
  const namedTunnelDetected = serviceManagedTokenMode
    ? Boolean(namedTunnelDetectedRaw)
    : Boolean(cloudflaredAvailable && namedTunnelDetectedRaw);
  const selectedTunnelMode: "existing_named" | "token_bootstrap" = namedTunnelDetected ? "existing_named" : "token_bootstrap";
  // UI should honor active named posture when backend is already in named mode,
  // even if local discovery heuristics temporarily miss detection.
  const activeNamedPosture = Boolean(!publicStatus?.namedDisabled && publicStatus?.mode === "named");
  const uiTunnelMode: "existing_named" | "token_bootstrap" = activeNamedPosture ? "existing_named" : selectedTunnelMode;
  const tokenBootstrapRequired = tunnelEnabled && tokenBootstrapRequiredState;
  const namedTunnelManageableLocally = Boolean(cloudflaredAvailable && (publicStatus?.namedTokenStored || namedTunnelDetected));
  const startActionLabel =
    uiTunnelMode === "existing_named"
      ? "Start named tunnel"
      : isSovereignPosture
        ? "Start temporary link (fallback)"
        : "Start temporary link";
  const startActionDisabled =
    publicBusy ||
    publicStatus?.status === "starting" ||
    publicStatus?.status === "online" ||
    (uiTunnelMode === "token_bootstrap" ? quickDisabled : !namedTunnelManageableLocally);
  const selectedMode =
    (modeInfo?.selectedMode || modeInfo?.nodeMode) === "lan"
      ? { label: "Sovereign Node", description: "Creator-hosted storefront with local invoice + commerce stack." }
      : (modeInfo?.selectedMode || modeInfo?.nodeMode) === "advanced"
        ? {
            label: "Sovereign Creator",
            description: "Creator-hosted storefront with optional connected-node invoicing and commerce services."
          }
        : { label: "Basic Creator", description: "Creator-hosted storefront via temporary tunnel and tipping by default." };
  const effectiveModeLabel =
    modeInfo?.effectiveMode === "lan" ? "Sovereign Node" : modeInfo?.effectiveMode === "advanced" ? "Sovereign Creator" : "Basic Creator";
  const sovereignCreatorEligible = Boolean(modeInfo?.modeReadiness?.sovereignCreatorEligible ?? namedTunnelOnline);
  const sovereignNodeEligible = Boolean(modeInfo?.modeReadiness?.sovereignNodeEligible);
  const sovereignNodeBlockers = modeInfo?.modeReadiness?.blockers || [];
  const sovereignModeBlockedReason = sovereignCreatorEligible
    ? null
    : "Canonical public origin not detected yet. Sovereign Creator unlocks after stable public host detection.";
  const isBasicMode = nodeMode === "basic";
  const tunnelStepLabel = isBasicMode
    ? "Step 1: Basic Creator tunnel setup"
    : nodeMode === "advanced"
      ? "Step 1: Sovereign Creator routing"
      : "Step 1: Sovereign Node routing";
  const tunnelModeHint = isBasicMode
    ? "Basic mode uses temporary links by default unless a local named tunnel is active."
    : nodeMode === "advanced"
      ? "Sovereign Creator prefers durable named routing. Temporary links are fallback only."
      : "Sovereign Node expects durable named routing for stable canonical origin.";
  const temporaryOverrideAllowed = uiTunnelMode === "existing_named" && !publicStatus?.namedDisabled;
  const routingStatusTitle = publicStatus?.namedDisabled
    ? namedTunnelDetected
      ? "Named tunnel paused"
      : "Temporary-link override is on"
    : uiTunnelMode === "existing_named" && namedTunnelOnline
      ? `Named tunnel ready${discoveredTunnelName ? ` (${discoveredTunnelName})` : ""}`
      : uiTunnelMode === "existing_named" && namedTunnelDetected
        ? `Named tunnel detected${discoveredTunnelName ? ` (${discoveredTunnelName})` : ""}`
        : "Temporary link mode";
  const routingStatusTone = publicStatus?.namedDisabled
    ? "#ffb4b4"
    : uiTunnelMode === "existing_named" && namedTunnelOnline
      ? "#a7f3d0"
      : uiTunnelMode === "existing_named"
        ? "#fbbf24"
        : "rgba(255,255,255,0.72)";
  const routingStatusDetail = publicStatus?.namedDisabled
    ? namedTunnelDetected
      ? "A legacy temporary-link override is still active. Restore the named tunnel to return to durable routing."
      : "Temporary-link override is active until you restore named routing."
    : serviceManagedTokenMode
      ? "Service-managed token tunnel is authoritative. Local cloudflared ingress settings are informational only."
      : uiTunnelMode === "existing_named" && namedTunnelOnline
        ? "This machine has a durable named tunnel online. Buyer-facing links should resolve through the configured public domain."
        : uiTunnelMode === "existing_named" && namedTunnelDetected
        ? "A matching named tunnel exists, but it is not online yet. Start sharing when you want this host active."
        : "No named tunnel is active. Quick links are temporary and do not unlock sovereign creator posture.";
  const routingAuthorityLabel = publicStatus?.namedDisabled
    ? namedTunnelDetected
      ? "Named tunnel paused"
      : "Temporary link override"
    : serviceManagedTokenMode
      ? "Service-managed named tunnel"
      : tunnelControlMode === "local_config"
        ? "Local config-managed named tunnel"
        : uiTunnelMode === "existing_named"
        ? "Named tunnel"
          : "Temporary link";
  const stopActionLabel =
    uiTunnelMode === "existing_named" && !publicStatus?.namedDisabled
      ? "Stop named tunnel"
      : "Stop temporary link";
  const refreshRoutingLabel = "Refresh routing";
  const localRoutingControlsDisabled =
    serviceManagedTokenMode &&
    !publicStatus?.namedDisabled &&
    publicStatus?.mode === "named" &&
    publicStatus?.status === "online";
  const showAdvancedInfraPanels = !isBasicMode || (Boolean(showAdvanced) && devMode);
  const showSystemDebugPanels = Boolean(showAdvanced) && devMode;
  const creatorProgressionSteps = useMemo<ProgressStep[]>(() => {
    const selected = modeInfo?.selectedMode || modeInfo?.nodeMode;
    const localCommerceReady = Boolean(modeInfo?.modeReadiness?.localCommerceReady);
    if (selected === "basic") {
      return [
        { title: "Advanced Posture", detail: "Switch from Basic to Advanced.", state: "current" },
        { title: "Commerce Route", detail: "Choose provider-backed or local sovereign route.", state: "pending" },
        { title: "Rails Readiness", detail: "If local route: configure Lightning + rails.", state: "pending" },
        { title: "Operate", detail: "Use Revenue stages for daily operations.", state: "pending" }
      ];
    }
    if (selected === "lan" && localCommerceReady) {
      return [
        { title: "Advanced Posture", detail: "Sovereign posture enabled.", state: "done" },
        { title: "Commerce Route", detail: "Local sovereign route selected.", state: "done" },
        { title: "Rails Readiness", detail: "Lightning + rails are commerce-ready.", state: "done" },
        { title: "Operate", detail: "Use Revenue stages for daily operations.", state: "current" }
      ];
    }
    if (selected === "lan" && !localCommerceReady) {
      return [
        { title: "Advanced Posture", detail: "Sovereign posture enabled.", state: "done" },
        { title: "Commerce Route", detail: "Local sovereign route selected.", state: "done" },
        { title: "Rails Readiness", detail: "Finish local Lightning + rails setup.", state: "current" },
        { title: "Operate", detail: "Run Revenue stages once rails are ready.", state: "pending" }
      ];
    }
    return [
      { title: "Advanced Posture", detail: "Sovereign creator posture active.", state: "done" },
      { title: "Commerce Route", detail: "Connect provider commerce or move to local sovereign route.", state: "current" },
      { title: "Rails Readiness", detail: "Optional: local Lightning + rails for full sovereignty.", state: "pending" },
      { title: "Operate", detail: "Use Revenue stages for accounting + execution.", state: "pending" }
    ];
  }, [modeInfo?.modeReadiness?.localCommerceReady, modeInfo?.nodeMode, modeInfo?.selectedMode]);
  const lightningRuntime = (lightningReadiness?.runtime || lightningAdmin?.runtime || null) as Partial<LightningRuntimeSnapshot> | null;
  const lightningConfigured = Boolean(lightningAdmin?.configured || lightningReadiness?.configured);
  const localLndDetected = Boolean(
    lightningRuntime?.connected ||
    lightningConfigured ||
    lightningAdmin?.restUrl ||
    String(lightningRuntime?.sendFailureReason || "").toUpperCase().includes("AUTH")
  );
  const formatSats = (raw: number | null | undefined) => {
    const n = Number(raw || 0);
    if (!Number.isFinite(n)) return "0 sats";
    return `${Math.round(n).toLocaleString()} sats`;
  };

  const updateNodeMode = async (nextMode: "basic" | "advanced" | "lan") => {
    if (!token || !modeInfo || modeBusy || nextMode === modeInfo.nodeMode) return;
    if (nextMode === "advanced") {
      const ok = window.confirm(
        "Switching to Sovereign Creator enables creator-hosted storefront with optional connected-node commerce services. Continue?"
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

  useEffect(() => {
    setTokenBootstrapRequiredState(!namedTunnelDetected);
  }, [namedTunnelDetected]);

  const refreshPublicStatus = async (opts?: { silent?: boolean; discover?: boolean }) => {
    if (!token) return;
    const silent = Boolean(opts?.silent);
    try {
      const res = await fetch(`${apiBase}/api/public/status`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      setPublicStatus(json || null);
      if (opts?.discover) {
        await discoverTunnels({ silent: true });
      }
      if (!silent) {
        setPublicMsg("Tunnel status refreshed.");
      }
    } catch {
      setPublicStatus(null);
      if (!silent) {
        setPublicMsg("Failed to refresh tunnel status.");
      }
    }
  };

  // Keep tunnel startup responsive: when backend reports startup states,
  // poll briefly so Basic temporary links flip to "online" without manual refresh.
  useEffect(() => {
    if (!token) return;
    const status = String(publicStatus?.status || "");
    if (status !== "starting" && status !== "restarting") return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const maxAttempts = 24;

    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`${apiBase}/api/public/status`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json().catch(() => null);
        if (!cancelled && json) {
          setPublicStatus(json);
        }
        if (!cancelled && attempts % 4 === 3) {
          await discoverTunnels({ silent: true });
        }
      } catch {
        // keep trying within bounded attempts
      } finally {
        attempts += 1;
        if (!cancelled && attempts < maxAttempts) {
          timer = setTimeout(tick, 1500);
        }
      }
    };

    timer = setTimeout(tick, 500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [apiBase, publicStatus?.status, token]);

  // If named tunnel is available and auto-start is enabled, automatically
  // kick it from offline state so operators don't need to click Start each time.
  useEffect(() => {
    if (!token) return;
    if (publicBusy) return;
    if (uiTunnelMode !== "existing_named") return;
    if (!namedTunnelManageableLocally) return;
    if (publicStatus?.namedDisabled) return;
    if (!publicStatus?.autoStartEnabled) return;
    if (publicStatus?.status !== "offline") return;

    const now = Date.now();
    if (now - lastNamedAutoStartKickAt < 15000) return;
    setLastNamedAutoStartKickAt(now);
    startPublicLink().catch(() => {});
  }, [
    lastNamedAutoStartKickAt,
    namedTunnelManageableLocally,
    publicBusy,
    publicStatus?.autoStartEnabled,
    publicStatus?.namedDisabled,
    publicStatus?.status,
    uiTunnelMode,
    token
  ]);

  const startPublicLink = async () => {
    if (!token) return;
    setPublicBusy(true);
    setPublicMsg(null);
    try {
      // Basic/temporary path: if backend is still in named mode on this machine,
      // force temporary override before requesting /go to prevent stale named-mode failures.
      if (selectedTunnelMode === "token_bootstrap" && publicStatus?.mode === "named" && !publicStatus?.namedDisabled) {
        try {
          const overrideRes = await fetch(`${apiBase}/api/public/named/disable`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` }
          });
          const overrideJson = await overrideRes.json().catch(() => null);
          if (overrideRes.ok && overrideJson) {
            setPublicStatus(overrideJson);
          }
        } catch {
          // best-effort; proceed to /go and let backend return actionable error if needed
        }
      }

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
      if (res.ok && json?.mode === "named") {
        setPublicMsg(json?.message || (json?.status === "online" ? "Named tunnel is online." : "Named tunnel start requested."));
      }
      if (!res.ok) {
        setPublicMsg(json?.message || json?.error || "Failed to start public link.");
      }
      if (res.ok && !json?.message) {
        setPublicMsg(
          json?.mode === "named"
            ? json?.status === "online"
              ? "Named tunnel started."
              : "Named tunnel start requested."
            : "Temporary link start requested."
        );
      }
      if (res.ok) {
        await refreshPublicStatus({ silent: true, discover: true });
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
      await refreshPublicStatus({ silent: true, discover: true });
      setPublicMsg(disabled ? "Named tunnel override enabled." : "Named tunnel override disabled.");
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
      if (!res.ok) {
        setPublicMsg(json?.error || "Failed to stop sharing.");
      } else {
        setPublicMsg("Public sharing stopped.");
      }
    } catch (e: any) {
      setPublicMsg(e?.message || "Failed to stop public link.");
    } finally {
      setPublicBusy(false);
    }
  };

  const buildInfo = `${(import.meta as any).env?.MODE || "unknown"} • ${
    (import.meta as any).env?.VITE_APP_VERSION || "dev"
  }`;

  const saveNetworking = async () => {
    writeStoredValue(STORAGE_NETWORKING_CUSTOMIZED, "1");
    writeStoredValue(STORAGE_PUBLIC_ORIGIN, normalizeOrigin(publicOrigin));
    writeStoredValue(STORAGE_PUBLIC_BUY_ORIGIN, normalizeOrigin(publicBuyOrigin));
    writeStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN, normalizeOrigin(publicStudioOrigin));
    writeStoredValue(STORAGE_PUBLIC_ORIGIN_FALLBACK, normalizeOrigin(publicOriginFallback));
    writeStoredValue(STORAGE_PUBLIC_BUY_ORIGIN_FALLBACK, normalizeOrigin(publicBuyOriginFallback));
    writeStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN_FALLBACK, normalizeOrigin(publicStudioOriginFallback));
    if (!token) return;
    try {
      const res = await fetch(`${apiBase}/api/public/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          publicOrigin: normalizeOrigin(publicOrigin),
          publicBuyOrigin: normalizeOrigin(publicBuyOrigin),
          publicStudioOrigin: normalizeOrigin(publicStudioOrigin),
          publicOriginFallback: normalizeOrigin(publicOriginFallback),
          publicBuyOriginFallback: normalizeOrigin(publicBuyOriginFallback),
          publicStudioOriginFallback: normalizeOrigin(publicStudioOriginFallback)
        })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to save networking config");
      setPublicMsg("Networking config saved.");
    } catch (e: any) {
      setPublicMsg(e?.message || "Failed to save networking config.");
    }
  };

  const clearNetworking = async () => {
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
    writeStoredValue(STORAGE_NETWORKING_CUSTOMIZED, "");
    if (!token) return;
    try {
      const res = await fetch(`${apiBase}/api/public/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          publicOrigin: "",
          publicBuyOrigin: "",
          publicStudioOrigin: "",
          publicOriginFallback: "",
          publicBuyOriginFallback: "",
          publicStudioOriginFallback: ""
        })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to clear networking config");
      setPublicMsg("Networking config cleared.");
    } catch (e: any) {
      setPublicMsg(e?.message || "Failed to clear networking config.");
    }
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
    setTunnelActionMsg(null);
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
      setTunnelActionMsg("Tunnel config saved.");
      await refreshPublicStatus({ silent: true, discover: true });
    } catch (e: any) {
      setTunnelError(e?.message || String(e));
    } finally {
      setTunnelLoading(false);
    }
  };

  const discoverTunnels = async (opts?: { silent?: boolean }) => {
    if (!token) return;
    setTunnelError(null);
    if (!opts?.silent) setTunnelActionMsg(null);
    setTunnelLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/public/tunnels`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to list tunnels");
      setTunnelList(Array.isArray(json?.tunnels) ? json.tunnels : []);
      setNamedTunnelDetectedState(Boolean(json?.namedTunnelDetected));
      setDiscoveredTunnelNameState(
        json?.namedTunnelDetected && json?.discoveredTunnelName ? String(json.discoveredTunnelName) : null
      );
      if (json?.namedTunnelDetected && json?.discoveredTunnelName) {
        setNamedTokenMsg(`Existing named tunnel detected (${json.discoveredTunnelName}). Token bootstrap is not required.`);
        if (!opts?.silent) setTunnelActionMsg(`Named tunnel detected: ${json.discoveredTunnelName}`);
      } else if (json?.configuredTunnelName) {
        setNamedTokenMsg(`Configured tunnel "${json.configuredTunnelName}" not found in discovered tunnels yet.`);
        if (!opts?.silent) setTunnelActionMsg(`Configured tunnel "${json.configuredTunnelName}" not discovered yet.`);
      } else if (!opts?.silent) {
        setTunnelActionMsg("No configured named tunnel to discover.");
      }
    } catch (e: any) {
      setTunnelError(e?.message || String(e));
    } finally {
      setTunnelLoading(false);
    }
  };

  useEffect(() => {
    if (!token || !tunnelEnabled) return;
    if (!configuredTunnelName) return;
    discoverTunnels({ silent: true }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tunnelEnabled, configuredTunnelName]);

  const saveNamedToken = async (autoStart?: boolean) => {
    if (!token) return;
    if (selectedTunnelMode === "existing_named") {
      setNamedTokenMsg("Existing named tunnel detected. Token bootstrap is not required.");
      if (autoStart) await startPublicLink();
      return;
    }
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
      if (json?.skipped) {
        setNamedTokenMsg("Existing named tunnel detected. Token save skipped.");
        await refreshPublicStatus({ silent: true, discover: true });
        return;
      }
      setNamedTokenInput("");
      setNamedTokenMsg("Token saved.");
      if (autoStart) await startPublicLink();
      await refreshPublicStatus({ silent: true, discover: true });
    } catch (e: any) {
      setNamedTokenMsg(e?.message || "Failed to save token.");
    } finally {
      setNamedTokenBusy(false);
    }
  };

  const generateNamedToken = async () => {
    if (!token) return;
    if (selectedTunnelMode === "existing_named") {
      setNamedTokenMsg("Existing named tunnel detected. Token generation is not required.");
      return;
    }
    setNamedTokenBusy(true);
    setNamedTokenMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/public/named-token/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to generate token");
      if (json?.skipped) {
        setNamedTokenMsg("Existing named tunnel detected. Token generation skipped.");
        await refreshPublicStatus({ silent: true, discover: true });
        return;
      }
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
      await refreshPublicStatus({ silent: true, discover: true });
    } catch (e: any) {
      setNamedTokenMsg(e?.message || "Failed to clear token.");
    } finally {
      setNamedTokenBusy(false);
    }
  };

  useEffect(() => {
    if (!namedTunnelOnline) return;
    const origin = String(publicStatus?.canonicalOrigin || publicStatus?.publicOrigin || "").trim();
    const host = safeHost(origin).split(":")[0] || "";
    if (!host) return;
    if (!tunnelDomain.trim()) {
      setTunnelDomain(host);
    }
  }, [namedTunnelOnline, publicStatus?.canonicalOrigin, publicStatus?.publicOrigin, tunnelDomain]);

  useEffect(() => {
    if (reconnectOriginInput.trim()) return;
    if (!detectedPublicOrigin) return;
    setReconnectOriginInput(detectedPublicOrigin);
  }, [detectedPublicOrigin, reconnectOriginInput]);

  return (
    <div style={{ padding: 16, maxWidth: 980 }}>
      <h2 style={{ margin: "8px 0 12px" }}>Config</h2>
      <p style={{ opacity: 0.7, marginBottom: 16 }}>Networking + system settings used across Certifyd Creator.</p>

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
              {selectedMode.label}
            </span>
            <span style={{ fontSize: 12, opacity: 0.75 }}>Effective: {effectiveModeLabel}</span>
          </div>
        </div>
        <div style={{ opacity: 0.7, marginBottom: 10 }}>
          Choose how this node participates in the Certifyd network.
        </div>
        <div style={{ marginBottom: 10, fontSize: 12, color: "#a3a3a3" }}>
          This controls node infrastructure capabilities. Creator identity and content remain unchanged.
        </div>
        <div style={{ marginBottom: 10, fontSize: 12, opacity: 0.7 }}>{selectedMode.description}</div>
        {sovereignModeBlockedReason ? (
          <div style={{ marginBottom: 10, fontSize: 12, color: "#fbbf24" }}>{sovereignModeBlockedReason}</div>
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
              checked={modeInfo?.nodeMode === "basic"}
              disabled={!modeInfo || modeBusy || modeLocked}
              onChange={() => updateNodeMode("basic")}
            />
            <span>
              <div>Basic Creator</div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>Creator-hosted public page via temporary tunnel with tipping and preview.</div>
            </span>
          </label>
          <label htmlFor="cfg-node-mode-advanced" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8 }}>
            <input
              id="cfg-node-mode-advanced"
              type="radio"
              name="cfg-node-mode"
              checked={modeInfo?.nodeMode === "advanced"}
              disabled={!modeInfo || modeBusy || modeLocked || !sovereignCreatorEligible}
              onChange={() => updateNodeMode("advanced")}
            />
            <span>
              <div>Sovereign Creator</div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>
                Creator-hosted storefront with optional connected-node invoicing and commerce services.
              </div>
            </span>
          </label>
          <label htmlFor="cfg-node-mode-lan" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8 }}>
            <input
              id="cfg-node-mode-lan"
              type="radio"
              name="cfg-node-mode"
              checked={modeInfo?.nodeMode === "lan"}
              disabled={!modeInfo || modeBusy || modeLocked || !sovereignNodeEligible}
              onChange={() => updateNodeMode("lan")}
            />
            <span>
              <div>Sovereign Node</div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>Creator-hosted storefront with local invoices and local commerce stack.</div>
            </span>
          </label>
        </div>
        {sovereignCreatorEligible && !sovereignNodeEligible ? (
          <div style={{ marginBottom: 10, fontSize: 12, color: "#fbbf24" }}>
            Sovereign Creator is available now. Sovereign Node still requires local Bitcoin, local LND, and local commerce readiness.
            Next step: connect provider commerce services.
          </div>
        ) : null}
        {sovereignNodeBlockers.length > 0 ? (
          <div style={{ marginBottom: 10, fontSize: 12, color: "#fbbf24" }}>
            Sovereign Node requirements not met:
            <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
              {sovereignNodeBlockers.includes("named_tunnel_required") ? <li>Canonical public origin required</li> : null}
              {sovereignNodeBlockers.includes("local_bitcoin_node_required") ? <li>Local Bitcoin node required</li> : null}
              {sovereignNodeBlockers.includes("local_lnd_required") ? <li>Local LND required</li> : null}
              {sovereignNodeBlockers.includes("local_commerce_service_required") ? <li>Local commerce service required</li> : null}
            </ul>
          </div>
        ) : null}
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
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Creator Progression Flow</div>
        <div style={{ display: "grid", gap: 6, fontSize: 13, opacity: 0.9 }}>
          <div>
            <b>1. Basic Creator</b> → Configure <b>Tunnel & routing</b>, publish content, collect tips.
          </div>
          <div>
            <b>2. Sovereign Creator</b> → Canonical public origin online, then connect commerce services.
          </div>
          <div>
            <b>3. Sovereign Node</b> → Canonical public origin + local stack, then use advanced infra panels.
          </div>
        </div>
        <div style={{ marginTop: 12, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {creatorProgressionSteps.map((step) => {
            const tone =
              step.state === "done"
                ? { border: "1px solid rgba(16,185,129,0.45)", background: "rgba(6,78,59,0.28)" }
                : step.state === "current"
                  ? { border: "1px solid rgba(56,189,248,0.55)", background: "rgba(8,47,73,0.35)" }
                  : { border: "1px solid rgba(255,255,255,0.12)", background: "rgba(10,10,10,0.35)" };
            return (
              <div key={step.title} style={{ borderRadius: 10, padding: "9px 10px", ...tone }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb" }}>{step.title}</div>
                  <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.85 }}>
                    {step.state}
                  </span>
                </div>
                <div style={{ marginTop: 5, fontSize: 11, opacity: 0.78 }}>{step.detail}</div>
              </div>
            );
          })}
        </div>
      </div>

      {showSystemDebugPanels ? (
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
      ) : null}

      {showSystemDebugPanels ? (
      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>API connection</div>
        <div style={{ opacity: 0.7, marginBottom: 8 }}>
          Current API base: <b>{apiBase}</b>
        </div>
        {showAdvanced ? (
          <>
            <label htmlFor="api-base-override">
              <div style={{ opacity: 0.7, marginBottom: 4 }}>API base override (advanced)</div>
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
              If you see tunnels from another machine, your API base is pointing there.
            </div>
          </>
        ) : (
          <div style={{ opacity: 0.6, marginTop: 6, fontSize: 12 }}>
            Advanced mode required to override API base.
          </div>
        )}
      </div>
      ) : null}

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>{tunnelStepLabel}</div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Tunnel & routing</div>
        <div style={{ fontSize: 12, opacity: 0.72, marginBottom: 10 }}>{tunnelModeHint}</div>
        {publicStatus ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <button
                onClick={startPublicLink}
                disabled={startActionDisabled}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
              >
              {startActionLabel}
            </button>
            {uiTunnelMode === "token_bootstrap" && quickDisabled ? (
              <div style={{ fontSize: 12, color: "#ffb4b4", alignSelf: "center" }}>
                Temporary route is fallback-only in sovereign posture when named routing is configured.
              </div>
            ) : null}
            {uiTunnelMode === "existing_named" && !cloudflaredAvailable ? (
              <div style={{ fontSize: 12, color: "#ffb4b4", alignSelf: "center" }}>
                cloudflared is unavailable on this machine, so local named-tunnel launch is disabled.
              </div>
            ) : null}
            {uiTunnelMode === "existing_named" && cloudflaredAvailable && !namedTunnelManageableLocally ? (
              <div style={{ fontSize: 12, color: "#ffb4b4", alignSelf: "center" }}>
                Named tunnel launch is not available yet on this machine. Discover the named tunnel first.
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
              {stopActionLabel}
            </button>
            <button
              onClick={() => refreshPublicStatus({ discover: true })}
              disabled={publicBusy}
              style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
            >
              {refreshRoutingLabel}
            </button>
          </div>
        ) : null}
        {publicStatus ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            {temporaryOverrideAllowed ? (
              <button
                onClick={() => setNamedOverride(true)}
                disabled={publicBusy || publicStatus?.namedDisabled}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
              >
                Use temporary link instead
              </button>
            ) : null}
            {publicStatus?.namedDisabled ? (
              <button
                onClick={() => setNamedOverride(false)}
                disabled={publicBusy}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
              >
                Restore named tunnel
              </button>
            ) : null}
            {publicStatus?.namedDisabled ? (
              <div style={{ fontSize: 12, color: "#ffb4b4", alignSelf: "center" }}>
                {namedTunnelDetected
                  ? "Named tunnel detected. Restore named routing to return to the durable host."
                  : "Temporary-link override is active. Named routing is paused until you restore it."}
              </div>
            ) : null}
          </div>
        ) : null}
        <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 10, marginBottom: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: routingStatusTone }}>{routingStatusTitle}</div>
          <div style={{ fontSize: 12, opacity: 0.82 }}>{routingStatusDetail}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.12)",
                color: routingStatusTone
              }}
            >
              Authority: {routingAuthorityLabel}
            </span>
            {localRoutingControlsDisabled ? (
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: "1px solid rgba(251,191,36,0.35)",
                  color: "#fbbf24"
                }}
              >
                Local controls read-only
              </span>
            ) : null}
          </div>
          <div style={{ display: "grid", gap: 3, fontSize: 12, opacity: 0.82, marginTop: 8 }}>
            <div>Public base domain: <b>{tunnelDomain || "—"}</b></div>
            <div>Tunnel control: <b>{serviceManagedTokenMode ? "Service-managed token" : tunnelControlMode === "local_config" ? "Local config-managed" : "Unknown"}</b></div>
            <div>Named tunnel online: <b>{namedTunnelOnline ? "yes" : "no"}</b></div>
          </div>
          {tunnelControlMessage ? (
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.65 }}>{tunnelControlMessage}</div>
          ) : null}
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
              writeStoredValue(STORAGE_TUNNEL_CONFIG_ENABLED, v ? "1" : "0");
              // UI preference only: do not clear persisted named-tunnel config when toggled off.
              if (!v && publicStatus?.mode === "named" && publicStatus?.status !== "offline") {
                setPublicMsg("Named tunnel is still running. Click Stop sharing to shut it down.");
              }
            }}
          />
          <span>Show advanced tunnel fields</span>
        </label>
        {!tunnelEnabled && publicStatus?.mode === "named" && publicStatus?.status !== "offline" ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#ffb4b4" }}>
            Named tunnel is still running. Use <b>Stop named tunnel</b> to disable it.
          </div>
        ) : null}
        {!tunnelEnabled && (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
            Advanced tunnel fields are hidden. Current routing stays active.
          </div>
        )}

        {!token && <div style={{ marginTop: 8, opacity: 0.7 }}>Sign in to manage tunnel settings.</div>}

        {token && tunnelEnabled && (
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {tunnelError && <div style={{ color: "#ff8080" }}>{tunnelError}</div>}
            {localRoutingControlsDisabled ? (
              <div style={{ fontSize: 12, color: "#fbbf24" }}>
                Service-managed tunnel authority is active. Local fields below are reference-only on this machine.
              </div>
            ) : null}
            {publicStatus?.mode && publicStatus.mode !== "named" ? (
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Named tunnel fields below are for setup/reference. Current routing is not using named mode.
              </div>
            ) : null}
            <details style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 10 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Advanced tunnel details</summary>
              <div style={{ display: "grid", gap: 3, fontSize: 12, opacity: 0.9, marginTop: 8 }}>
                <div>Tunnel provider: <b>{tunnelProvider || "cloudflare"}</b></div>
                <div>Tunnel name: <b>{configuredTunnelName || "—"}</b></div>
                <div>Tunnel detected: <b>{namedTunnelDetected ? "yes" : "no"}</b></div>
                <div>Tunnel online: <b>{namedTunnelOnline ? "yes" : "no"}</b></div>
                <div>Preferred route: <b>{uiTunnelMode === "existing_named" ? "Named tunnel" : "Temporary bootstrap"}</b></div>
                <div>Tunnel control mode: <b>{serviceManagedTokenMode ? "Service-managed token" : tunnelControlMode === "local_config" ? "Local config-managed" : "Unknown"}</b></div>
                <div>Public base domain: <b>{tunnelDomain || "—"}</b></div>
              </div>
              {uiTunnelMode === "existing_named" ? (
                <div style={{ marginTop: 6, fontSize: 12, color: "#a7f3d0" }}>
                  Named tunnel detected. Temporary bootstrap is not needed.
                </div>
              ) : (
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                  No matching named tunnel detected yet. Use temporary bootstrap only for first-time setup.
                </div>
              )}
            </details>
            <label htmlFor="tunnel-provider">
              <div style={{ opacity: 0.7, marginBottom: 4 }}>Provider</div>
              <input
                id="tunnel-provider"
                name="tunnelProvider"
                value={tunnelProvider}
                onChange={(e) => setTunnelProvider(e.target.value)}
                placeholder="cloudflare"
                className={inputClass}
                disabled={!tunnelEnabled || !namedTunnelDetected || localRoutingControlsDisabled}
                autoComplete="off"
              />
              {!namedTunnelDetected ? (
                <div style={{ opacity: 0.7, marginTop: 4, fontSize: 12 }}>
                  Provider host settings unlock after the named tunnel is detected.
                </div>
              ) : null}
            </label>
            <label htmlFor="tunnel-domain">
              <div style={{ opacity: 0.7, marginBottom: 4 }}>Public domain (base)</div>
              <input
                id="tunnel-domain"
                name="tunnelDomain"
                value={tunnelDomain}
                onChange={(e) => setTunnelDomain(e.target.value)}
                placeholder="contentbox.link"
                className={inputClass}
                disabled={!tunnelEnabled || localRoutingControlsDisabled}
                autoComplete="off"
              />
              <div style={{ opacity: 0.6, marginTop: 4, fontSize: 12 }}>
                Base domain for public links (e.g. <b>contentbox.link</b>). The tunnel list does not include domains.
              </div>
              {!namedTunnelOnline ? (
                <div style={{ opacity: 0.7, marginTop: 4, fontSize: 12 }}>
                  Node domain auto-fills only after a named tunnel is detected online.
                </div>
              ) : null}
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
                disabled={!tunnelEnabled || localRoutingControlsDisabled}
                autoComplete="off"
              />
            </label>
            {tunnelEnabled &&
            tokenBootstrapRequired &&
            uiTunnelMode === "token_bootstrap" &&
            !localRoutingControlsDisabled &&
            !serviceManagedTokenMode ? (
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
                disabled={tunnelLoading || !tunnelEnabled || localRoutingControlsDisabled}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
              >
                Save tunnel config
              </button>
              <button
                onClick={() => {
                  discoverTunnels().catch(() => {});
                }}
                disabled={tunnelLoading || !tunnelEnabled}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
              >
                Discover tunnels
              </button>
            </div>
            {tunnelActionMsg ? <div style={{ marginTop: 6, fontSize: 12, color: "#a7f3d0" }}>{tunnelActionMsg}</div> : null}
            {tunnelList.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Detected tunnels</div>
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
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Tunnel status</div>
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
                    ? `Permanent (${(publicStatus as any)?.tunnelName || "Named"})`
                    : publicStatus?.mode === "quick"
                      ? productTier === "advanced"
                        ? "Temporary (testing only — admin access only)"
                        : "Temporary (Quick)"
                      : "Local"}
                </span>
              </div>
            ) : null}
            {publicStatus ? (
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                Controls for Quick link and sharing are in <b>Tunnel &amp; routing</b>.
              </div>
            ) : null}
            {publicMsg ? <div style={{ color: "#ffb4b4" }}>{publicMsg}</div> : null}
            <div><b>OK</b>: {health.ok ? "yes" : "no"}</div>
            <div><b>Canonical public origin</b>: {publicStatus?.canonicalOrigin || publicStatus?.publicOrigin || "—"}</div>
            <div><b>Tunnel mode</b>: {publicStatus?.mode || "—"}</div>
            <div><b>Tunnel status</b>: {publicStatus?.status || "—"}</div>
            <div><b>Last seen</b>: {publicStatus?.lastCheckedAt ? new Date(publicStatus.lastCheckedAt).toLocaleString() : "—"}</div>
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
                <div><b>Public origin</b>: {publicStatus?.canonicalOrigin || publicStatus?.publicOrigin || "—"}</div>
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
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Join Fan Network</div>
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
          This does not move your content or payments. It only submits your public Creator node for discovery in Certifyd Fan.
        </div>
        <div style={{ display: "grid", gap: 6, fontSize: 13, marginBottom: 10 }}>
          <div><b>Public origin</b>: {detectedPublicOrigin || "—"}</div>
          <div><b>Discoverable endpoint</b>: {fanDiscoverableEndpoint || "—"}</div>
          <div><b>Checklist</b>:</div>
          <div style={{ paddingLeft: 10 }}>
            <div>{detectedPublicOrigin ? "✅" : "❌"} Public origin detected</div>
            <div>{fanTestResult?.reachable ? "✅" : fanTestResult ? "❌" : "•"} Discoverable endpoint reachable</div>
            <div>{fanTestResult?.jsonValid ? "✅" : fanTestResult ? "❌" : "•"} Endpoint returns valid JSON</div>
            <div>
              {fanTestResult
                ? fanTestResult.itemCount > 0
                  ? "✅"
                  : "⚠️"
                : "•"}{" "}
              At least one discoverable item ({fanTestResult ? fanTestResult.itemCount : 0})
            </div>
          </div>
        </div>
        {showReconnectDiscovery ? (
          <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
              Temporary tunnel changed? Paste your new public link to reconnect Discovery.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <input
                value={reconnectOriginInput}
                onChange={(e) => setReconnectOriginInput(e.target.value)}
                placeholder="https://your-name.trycloudflare.com"
                className={inputClass}
                style={{ minWidth: 320, flex: 1 }}
              />
              <button
                onClick={reconnectDiscoveryOrigin}
                style={{ padding: "6px 10px", borderRadius: 10, cursor: "pointer" }}
                disabled={reconnectBusy || !reconnectOriginInput.trim()}
              >
                {reconnectBusy ? "Reconnecting…" : "Reconnect Discovery"}
              </button>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
              Free content can appear on Discovery while your public link is online. Temporary tunnels may go offline and
              temporarily remove your content from Discovery.
            </div>
            {reconnectMsg ? <div style={{ marginTop: 8, color: reconnectMsg.includes("updated") ? "#c4f5d5" : "#ffb4b4" }}>{reconnectMsg}</div> : null}
          </div>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <button
            onClick={testFanNetworkReadiness}
            style={{ padding: "6px 10px", borderRadius: 10, cursor: "pointer" }}
            disabled={fanTestBusy}
          >
            {fanTestBusy ? "Testing…" : "Test fan network readiness"}
          </button>
          <button
            onClick={submitToFanNetwork}
            style={{ padding: "6px 10px", borderRadius: 10, cursor: "pointer" }}
            disabled={!detectedPublicOrigin}
          >
            Submit to Fan Network
          </button>
        </div>
        {fanTestResult ? (
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>
            Last test: {fanTestResult.ok ? "PASS" : "FAIL"} • {fanTestResult.itemCount} item(s) •{" "}
            {new Date(fanTestResult.checkedAt).toLocaleString()}
          </div>
        ) : null}
        {fanTestError ? <div style={{ color: "#ffb4b4", marginBottom: 6 }}>{fanTestError}</div> : null}
        {fanSubmitMsg ? <div style={{ color: "#c4f5d5" }}>{fanSubmitMsg}</div> : null}
      </div>

      {showAdvancedInfraPanels ? (
      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Advanced networking overrides</div>
            <div style={{ opacity: 0.7 }}>
              Only use this for split-host or fallback routing. Most setups should leave this blank and rely on the canonical public host.
            </div>
          </div>
          <button
            onClick={() => setNetworkingOverridesOpen((v) => !v)}
            style={{ padding: "6px 10px", borderRadius: 10, cursor: "pointer" }}
          >
            {networkingOverridesOpen ? "Hide overrides" : "Show overrides"}
          </button>
        </div>

        {networkingOverridesOpen ? (
          <>
            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
              <label htmlFor="public-origin">
                <div style={{ opacity: 0.7, marginBottom: 4 }}>Primary public host (recommended)</div>
                <input
                  id="public-origin"
                  name="publicOrigin"
                  value={publicOrigin}
                  onChange={(e) => setPublicOrigin(e.target.value)}
                  placeholder="https://creator.yourdomain.com"
                  className={inputClass}
                  disabled={!namedTunnelOnline}
                  autoComplete="url"
                />
              </label>
              <label htmlFor="public-buy-origin">
                <div style={{ opacity: 0.7, marginBottom: 4 }}>Buy host override (optional)</div>
                <input
                  id="public-buy-origin"
                  name="publicBuyOrigin"
                  value={publicBuyOrigin}
                  onChange={(e) => setPublicBuyOrigin(e.target.value)}
                  placeholder="https://buy.yourdomain.com"
                  className={inputClass}
                  disabled={!namedTunnelOnline}
                  autoComplete="url"
                />
              </label>
              <label htmlFor="public-studio-origin">
                <div style={{ opacity: 0.7, marginBottom: 4 }}>Studio host override (optional)</div>
                <input
                  id="public-studio-origin"
                  name="publicStudioOrigin"
                  value={publicStudioOrigin}
                  onChange={(e) => setPublicStudioOrigin(e.target.value)}
                  placeholder="https://studio.yourdomain.com"
                  className={inputClass}
                  disabled={!namedTunnelOnline}
                  autoComplete="url"
                />
              </label>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
              If overrides are blank, routing uses the primary public host.
            </div>
            {!namedTunnelOnline ? (
              <div style={{ marginTop: 8, fontSize: 12, color: "#fbbf24" }}>
                Commerce/public host overrides unlock only after named tunnel is online.
              </div>
            ) : null}

            <div style={{ marginTop: 12, fontWeight: 600 }}>Fallback hosts (optional)</div>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              <label htmlFor="public-buy-origin-fallback">
                <div style={{ opacity: 0.7, marginBottom: 4 }}>Buy fallback</div>
                <input
                  id="public-buy-origin-fallback"
                  name="publicBuyOriginFallback"
                  value={publicBuyOriginFallback}
                  onChange={(e) => setPublicBuyOriginFallback(e.target.value)}
                  placeholder="https://buy.fallback.com"
                  className={inputClass}
                  autoComplete="url"
                />
              </label>
              <label htmlFor="public-studio-origin-fallback">
                <div style={{ opacity: 0.7, marginBottom: 4 }}>Studio fallback</div>
                <input
                  id="public-studio-origin-fallback"
                  name="publicStudioOriginFallback"
                  value={publicStudioOriginFallback}
                  onChange={(e) => setPublicStudioOriginFallback(e.target.value)}
                  placeholder="https://studio.fallback.com"
                  className={inputClass}
                  autoComplete="url"
                />
              </label>
              <label htmlFor="public-origin-fallback">
                <div style={{ opacity: 0.7, marginBottom: 4 }}>Certifyd Creator fallback</div>
                <input
                  id="public-origin-fallback"
                  name="publicOriginFallback"
                  value={publicOriginFallback}
                  onChange={(e) => setPublicOriginFallback(e.target.value)}
                  placeholder="https://creator.fallback.com"
                  className={inputClass}
                  autoComplete="url"
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                onClick={saveNetworking}
                disabled={!namedTunnelOnline}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
              >
                Save overrides
              </button>
              <button
                onClick={clearNetworking}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
              >
                Clear overrides
              </button>
            </div>

            <div style={{ marginTop: 12, opacity: 0.7 }}>
              Health path used: <b>{DEFAULT_HEALTH_PATH}</b>
            </div>
          </>
        ) : (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.65 }}>
            Hidden by default. Canonical-host routing should be enough unless you intentionally run split hosts or recovery fallbacks.
          </div>
        )}
      </div>
      ) : null}

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Local LND Wallet</div>
        <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 10 }}>
          This machine&apos;s local LND wallet is the commerce wallet/treasury for sovereign commerce flows.
        </div>
        <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
          <div>Node detected: <b>{localLndDetected ? "yes" : "no"}</b></div>
          <div>REST URL: <b>{lightningAdmin?.restUrl || "—"}</b></div>
          <div>Network: <b>{lightningAdmin?.network || "—"}</b></div>
          <div>Last tested: <b>{lightningAdmin?.lastTestedAt ? new Date(lightningAdmin.lastTestedAt).toLocaleString() : "—"}</b></div>
          <div>Alias: <b>{lightningReadiness?.node?.alias || "—"}</b></div>
          <div>Pubkey: <b>{lightningReadiness?.node?.identityPubkey || "—"}</b></div>
          <div>synced_to_chain: <b>{lightningReadiness?.wallet?.syncedToChain ? "yes" : "no"}</b></div>
          <div>canReceive: <b>{lightningRuntime?.canReceive ? "yes" : "no"}</b></div>
          <div>canSend: <b>{lightningRuntime?.canSend ? "yes" : "no"}</b></div>
          <div>capabilityState: <b>{lightningRuntime?.capabilityState || "disconnected"}</b></div>
          <div>channel count: <b>{Number(lightningReadiness?.channels?.count || 0).toLocaleString()}</b></div>
          <div>wallet confirmed: <b>{formatSats(lightningBalances?.wallet?.confirmedSats)}</b></div>
          <div>wallet unconfirmed: <b>{formatSats(lightningBalances?.wallet?.unconfirmedSats)}</b></div>
          <div>wallet total: <b>{formatSats(lightningBalances?.wallet?.totalSats)}</b></div>
          <div>inbound liquidity: <b>{formatSats(lightningBalances?.liquidity?.inboundSats)}</b></div>
          <div>outbound liquidity: <b>{formatSats(lightningBalances?.liquidity?.outboundSats)}</b></div>
          <div>
            pending channels:{" "}
            <b>{Number((lightningBalances?.channels?.pendingOpenCount || 0) + (lightningBalances?.channels?.pendingCloseCount || 0)).toLocaleString()}</b>
          </div>
          <div>open channels: <b>{Number(lightningBalances?.channels?.openCount || 0).toLocaleString()}</b></div>
          <div>Default REST URL: <b>{lightningAdmin?.defaults?.restUrl || "https://127.0.0.1:8080"}</b></div>
          <div>Default TLS path: <b>{lightningAdmin?.defaults?.tlsCertPath || "—"}</b></div>
          <div>Default macaroon path: <b>{lightningAdmin?.defaults?.macaroonPath || "—"}</b></div>
        </div>
        {Array.isArray(lightningReadiness?.hints) && lightningReadiness.hints.length ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#d4d4d8" }}>
            {lightningReadiness.hints.map((hint, idx) => (
              <div key={`${idx}-${hint}`}>{hint}</div>
            ))}
          </div>
        ) : null}
        {lightningRuntime?.sendFailureReason ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#fbbf24" }}>
            send readiness reason: {lightningRuntime.sendFailureReason}
          </div>
        ) : null}
        {lightningWalletError ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#fca5a5" }}>{lightningWalletError}</div>
        ) : null}
        <div style={{ marginTop: 10 }}>
          <button
            onClick={() => onOpenLightningConfig?.()}
            style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
          >
            Open Lightning config
          </button>
        </div>
      </div>

      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Payments</div>
        <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 10 }}>
          In Basic mode, set your creator payout destination (Lightning address or LNURL). In sovereign/provider modes, commerce runs from this machine&apos;s local LND wallet.
        </div>
        <button
          onClick={() => onOpenPayments?.()}
          style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
        >
          Open payments settings
        </button>
      </div>
    </div>
  );
}
