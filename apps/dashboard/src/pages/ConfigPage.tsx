
import { useEffect, useMemo, useState } from "react";
import { clearToken, getToken } from "../lib/auth";
import { getApiBase } from "../lib/api";

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
  onIdentityRefresh
}: {
  showAdvanced?: boolean;
  onOpenPayments?: () => void;
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
  const [tunnelEnabled, setTunnelEnabled] = useState<boolean>(() => readStoredValue(STORAGE_TUNNEL_CONFIG_ENABLED) === "1");
  const [tunnelProvider, setTunnelProvider] = useState<string>("cloudflare");
  const [tunnelDomain, setTunnelDomain] = useState<string>("");
  const [tunnelName, setTunnelName] = useState<string>("");
  const [tunnelError, setTunnelError] = useState<string | null>(null);
  const [tunnelActionMsg, setTunnelActionMsg] = useState<string | null>(null);
  const [tunnelLoading, setTunnelLoading] = useState<boolean>(false);
  const [tunnelList, setTunnelList] = useState<Array<{ name?: string; id?: string }>>([]);
  const [discoveredTunnelNameState, setDiscoveredTunnelNameState] = useState<string | null>(null);
  const [namedTunnelDetectedState, setNamedTunnelDetectedState] = useState<boolean>(false);
  const [selectedTunnelModeState, setSelectedTunnelModeState] = useState<"existing_named" | "token_bootstrap">("token_bootstrap");
  const [tokenBootstrapRequiredState, setTokenBootstrapRequiredState] = useState<boolean>(true);
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
  const namedOriginCandidate = String(publicStatus?.canonicalOrigin || publicStatus?.publicOrigin || "").trim();
  const namedTunnelOnline =
    publicStatus?.mode === "named" &&
    publicStatus?.status === "online" &&
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
  const discoveredTunnelName = discoveredTunnelNameState || discoveredTunnelNameFromList;
  const namedTunnelDetected = namedTunnelDetectedState || Boolean(discoveredTunnelNameFromList);
  const selectedTunnelMode: "existing_named" | "token_bootstrap" = namedTunnelDetected ? "existing_named" : selectedTunnelModeState;
  const tokenBootstrapRequired = tunnelEnabled && tokenBootstrapRequiredState;
  const cloudflaredAvailable = Boolean(publicStatus?.cloudflared?.available);
  const tunnelControlMode = String(publicStatus?.tunnelControl?.mode || "unknown");
  const tunnelControlMessage = String(publicStatus?.tunnelControl?.message || "").trim();
  const serviceManagedTokenMode = tunnelControlMode === "service_token";
  const namedTunnelManageableLocally = Boolean(cloudflaredAvailable && (publicStatus?.namedTokenStored || namedTunnelDetected));
  const startActionLabel = selectedTunnelMode === "existing_named" ? "Start named tunnel" : "Start temporary link";
  const startActionDisabled =
    publicBusy ||
    publicStatus?.status === "starting" ||
    publicStatus?.status === "online" ||
    (selectedTunnelMode === "token_bootstrap" ? quickDisabled : !namedTunnelManageableLocally);
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
    : "Named tunnel not detected yet. Sovereign Creator unlocks after stable public host detection.";
  const isBasicMode = modeInfo?.nodeMode === "basic";
  const showAdvancedInfraPanels = !isBasicMode || (Boolean(showAdvanced) && devMode);

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
    const mode = namedTunnelDetected ? "existing_named" : "token_bootstrap";
    setSelectedTunnelModeState(mode);
    setTokenBootstrapRequiredState(mode === "token_bootstrap");
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
              {sovereignNodeBlockers.includes("named_tunnel_required") ? <li>Named tunnel required</li> : null}
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
            <b>2. Sovereign Creator</b> → Named tunnel online, then connect commerce services.
          </div>
          <div>
            <b>3. Sovereign Node</b> → Named tunnel + local stack, then use advanced infra panels.
          </div>
        </div>
      </div>

      {showAdvancedInfraPanels ? (
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

      {showAdvancedInfraPanels ? (
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
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>Step 1: Basic Creator tunnel setup</div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Tunnel & routing</div>
        {publicStatus ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <button
                onClick={startPublicLink}
                disabled={startActionDisabled}
                style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
              >
              {startActionLabel}
            </button>
            {selectedTunnelMode === "token_bootstrap" && quickDisabled ? (
              <div style={{ fontSize: 12, color: "#ffb4b4", alignSelf: "center" }}>
                Temporary (testing only — admin access only). Advanced prefers named when configured.
              </div>
            ) : null}
            {selectedTunnelMode === "existing_named" && !cloudflaredAvailable ? (
              <div style={{ fontSize: 12, color: "#ffb4b4", alignSelf: "center" }}>
                cloudflared is unavailable on this machine, so local named-tunnel launch is disabled.
              </div>
            ) : null}
            {selectedTunnelMode === "existing_named" && cloudflaredAvailable && !namedTunnelManageableLocally ? (
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
              Stop sharing
            </button>
            <button
              onClick={() => refreshPublicStatus({ discover: true })}
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
              Advanced routing for public links.
            </div>
            {serviceManagedTokenMode ? (
              <div style={{ marginBottom: 10, fontSize: 12, color: "#fbbf24" }}>
                Service-managed token tunnel detected. Local `~/.cloudflared/config.yml` ingress is not authoritative in this mode.
              </div>
            ) : null}
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
          <span>Enable advanced routing settings</span>
        </label>
        {!tunnelEnabled && publicStatus?.mode === "named" && publicStatus?.status !== "offline" ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#ffb4b4" }}>
            Named tunnel still running. Use <b>Stop sharing</b> to disable it.
          </div>
        ) : null}
        {!tunnelEnabled && (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
            Advanced routing is off — Quick tunnel will be used (no DDNS/custom domain).
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
            <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Named tunnel mode status</div>
              <div style={{ display: "grid", gap: 3, fontSize: 12, opacity: 0.9 }}>
                <div>Tunnel provider: <b>{tunnelProvider || "cloudflare"}</b></div>
                <div>Tunnel name: <b>{configuredTunnelName || "—"}</b></div>
                <div>Tunnel detected: <b>{namedTunnelDetected ? "yes" : "no"}</b></div>
                <div>Tunnel online: <b>{namedTunnelOnline ? "yes" : "no"}</b></div>
                <div>Active mode: <b>{selectedTunnelMode === "existing_named" ? "Existing named tunnel" : "Token bootstrap"}</b></div>
                <div>Tunnel control mode: <b>{serviceManagedTokenMode ? "Service-managed token" : tunnelControlMode === "local_config" ? "Local config-managed" : "Unknown"}</b></div>
                <div>Public base domain: <b>{tunnelDomain || "—"}</b></div>
              </div>
              {tunnelControlMessage ? (
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>{tunnelControlMessage}</div>
              ) : null}
              {selectedTunnelMode === "existing_named" ? (
                <div style={{ marginTop: 6, fontSize: 12, color: "#a7f3d0" }}>
                  Existing named tunnel detected{discoveredTunnelName ? ` (${discoveredTunnelName})` : ""}. Token bootstrap is not required.
                </div>
              ) : (
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                  No matching named tunnel was detected yet. Use token bootstrap only if you are setting up this tunnel for the first time.
                </div>
              )}
            </div>
            <label htmlFor="tunnel-provider">
              <div style={{ opacity: 0.7, marginBottom: 4 }}>Provider</div>
              <input
                id="tunnel-provider"
                name="tunnelProvider"
                value={tunnelProvider}
                onChange={(e) => setTunnelProvider(e.target.value)}
                placeholder="cloudflare"
                className={inputClass}
                disabled={!tunnelEnabled || !namedTunnelDetected}
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
                disabled={!tunnelEnabled}
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
                disabled={!tunnelEnabled}
                autoComplete="off"
              />
            </label>
            {tunnelEnabled && tokenBootstrapRequired ? (
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
            {tunnelEnabled && selectedTunnelMode === "existing_named" && namedTokenMsg ? (
              <div style={{ marginTop: 4, color: "#a7f3d0", fontSize: 12 }}>{namedTokenMsg}</div>
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

      {showAdvancedInfraPanels ? (
      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Networking</div>
        <div style={{ opacity: 0.7, marginBottom: 12 }}>
          Public hosts used for buy + studio + creator-profile routing.
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <label htmlFor="public-buy-origin">
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Buy host (public)</div>
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
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Studio host (public)</div>
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
          <label htmlFor="public-origin">
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Certifyd Creator host (public)</div>
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
          Health path used: <b>{DEFAULT_HEALTH_PATH}</b>
        </div>
      </div>
      ) : null}

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
    </div>
  );
}
