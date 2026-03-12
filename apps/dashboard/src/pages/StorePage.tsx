import React from "react";
import { api, getApiBase } from "../lib/api";
import { fetchIdentityDetail } from "../lib/identity";

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
  };
  providerBinding: {
    configured: boolean;
    providerNodeId: string | null;
  };
  visibility: "DISABLED" | "UNLISTED" | "LISTED";
  reachability: {
    publicUrl: string | null;
    tunnel: boolean;
    ipfs: boolean;
  };
};

type NetworkProviderConfig = {
  providerNodeId: string | null;
  providerProfileId: string | null;
  providerUrl: string | null;
  providerPubKey: string | null;
  enabled: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  configured?: boolean;
};

type ProviderVerification = {
  configured: {
    providerUrl: string | null;
    providerNodeId: string | null;
    providerPubKey: string | null;
  };
  observed: {
    nodeId: string | null;
    nodePubKey: string | null;
    capabilityLevel: "basic" | "advanced" | "lan" | null;
    serviceRoles: Array<"creator" | "provider">;
    endpoint: {
      url: string | null;
      kind: "quick" | "named" | "custom" | null;
      stability: "temporary" | "stable" | null;
      active: boolean | null;
    };
  };
  verification: {
    status:
      | "verified"
      | "mismatch"
      | "pubkey_mismatch"
      | "identity_inconsistent"
      | "invalid_signature"
      | "unsigned_descriptor"
      | "unreachable"
      | "invalid_descriptor"
      | "missing_provider_role"
      | "not_configured";
    checkedAt: string;
    message: string;
  };
  history?: {
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
  };
};

type ProviderHandshakeResult = {
  configured: {
    providerUrl: string | null;
    providerNodeId: string | null;
  };
  observed: {
    nodeId: string | null;
    capabilityLevel: "basic" | "advanced" | "lan" | null;
    serviceRoles: Array<"creator" | "provider">;
    providerCapabilities: {
      descriptorVerification: boolean;
      trustGatedExecution: boolean;
    } | null;
  };
  handshake: {
    status: "ok" | "unreachable" | "invalid_response" | "provider_not_trusted";
    checkedAt: string;
    message: string;
  };
};

type ProviderAcknowledgmentResult = {
  configured: {
    providerUrl: string | null;
    providerNodeId: string | null;
    providerPubKey?: string | null;
  };
  observed: {
    providerNodeId: string | null;
    providerNodePubKey: string | null;
  };
  acknowledgment: {
    status: "accepted" | "invalid_response" | "invalid_signature" | "unreachable" | "provider_not_trusted";
    intent: string | null;
    issuedAt: string | null;
    signatureValidated: boolean;
    checkedAt: string;
    message: string;
  };
};

type ProviderOperationIntentResult = {
  configured: {
    providerUrl: string | null;
    providerNodeId: string | null;
    providerPubKey?: string | null;
  };
  observed: {
    providerNodeId: string | null;
    providerNodePubKey: string | null;
  };
  permit: {
    permitId: string | null;
    status:
      | "accepted"
      | "invalid_response"
      | "invalid_signature"
      | "unreachable"
      | "provider_not_trusted"
      | "provider_acknowledgment_required";
    intent: string | null;
    issuedAt: string | null;
    expiresAt: string | null;
    signatureValidated: boolean;
    checkedAt: string;
    message: string;
  };
};

type ProviderExecutionPermitReadiness = {
  readiness: "ready" | "blocked" | "not_current" | "expired" | "not_configured";
  allowed: boolean;
  status:
    | "accepted"
    | "invalid_response"
    | "invalid_signature"
    | "unreachable"
    | "provider_not_trusted"
    | "provider_acknowledgment_required"
    | "missing";
  message: string;
};

type ProviderExecutionChainReadiness = {
  ready: boolean;
  trustReadiness: { readiness: string };
  ackReadiness: { readiness: string };
  permitReadiness: { readiness: string };
  message: string;
};

type ProviderExecuteTestResult = {
  configured: {
    providerUrl: string | null;
    providerNodeId: string | null;
  };
  execution: {
    status: "ok" | "unreachable" | "invalid_response" | "provider_execution_not_ready";
    checkedAt: string;
    message: string;
  };
};

type ProviderAcknowledgmentReadiness = {
  readiness: "ready" | "blocked" | "not_current" | "not_configured";
  allowed: boolean;
  status:
    | "accepted"
    | "invalid_response"
    | "invalid_signature"
    | "unreachable"
    | "provider_not_trusted"
    | "missing";
  message: string;
};

type RuntimeStatus = {
  runtime: {
    status: "running" | "stopped" | "degraded";
    apiReady: boolean;
    startedAt: string | null;
    lastRestartAt: string | null;
    restartCount24h: number;
    pid: number | null;
    reason: string;
  };
  endpoint: {
    url: string | null;
    kind: "quick" | "named" | "custom";
    stability: "temporary" | "stable";
    active: boolean;
    lastSeenAt: string | null;
  };
  node: {
    nodeId: string;
    capabilityLevel: "basic" | "advanced" | "lan";
  };
};

type NodePresence = {
  node: {
    nodeId: string;
    profileId: string | null;
    capabilityLevel: "basic" | "advanced" | "lan";
    serviceRoles: Array<"creator" | "provider">;
  };
  endpoint: {
    url: string | null;
    kind: "quick" | "named" | "custom";
    stability: "temporary" | "stable";
    active: boolean;
  };
  runtime: {
    status: "running" | "stopped" | "degraded";
    apiReady: boolean;
    reason: string;
  };
};

type UserNetworkStatus = {
  status: "ready" | "connecting" | "action_required" | "offline";
  title: "Ready" | "Connecting" | "Action Required" | "Offline";
  message: string;
  actionLabel: string | null;
};

type GuidedSetupPhase = "idle" | "saving" | "verifying" | "acknowledging" | "permitting" | "ready" | "error";

type ProfileActivationStatus = {
  configured: {
    providerUrl: string | null;
    providerNodeId: string | null;
    providerPubKey: string | null;
  };
  activation: {
    status: "activated" | "not_ready";
    message: string;
    checkedAt: string;
    activatedAt: string | null;
  };
};

type ProfileActivationResult = {
  status: "activated" | "not_ready" | "failed";
  message: string;
  activatedAt: string | null;
  checkedAt: string | null;
};

function guessApiBase() {
  return getApiBase();
}

function isLikelyUrl(s: string) {
  return /^https?:\/\//i.test(s.trim());
}

function extractReceiptToken(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (v.length >= 16 && !v.includes("/") && !v.includes(" ")) return v;
  const m = v.match(/\/public\/receipts\/([^/?#]+)/i);
  if (m) return m[1];
  return null;
}

function extractBuyUrl(input: string): string | null {
  const v = input.trim();
  if (!isLikelyUrl(v)) return null;
  if (v.includes("/buy/")) return v;
  return null;
}

export default function StorePage(props: { onOpenReceipt: (token: string) => void }) {
  const [input, setInput] = React.useState("");
  const [nodeHost, setNodeHost] = React.useState(() => guessApiBase());
  const [msg, setMsg] = React.useState<string | null>(null);
  const [diagnostics, setDiagnostics] = React.useState<any | null>(null);
  const [identity, setIdentity] = React.useState<{ nodeMode?: string | null } | null>(null);
  const [networkSummary, setNetworkSummary] = React.useState<NetworkSummary | null>(null);
  const [providerConfig, setProviderConfig] = React.useState<NetworkProviderConfig | null>(null);
  const [providerLoading, setProviderLoading] = React.useState(false);
  const [providerSaving, setProviderSaving] = React.useState(false);
  const [providerMsg, setProviderMsg] = React.useState<string | null>(null);
  const [providerErr, setProviderErr] = React.useState<string | null>(null);
  const [providerVerification, setProviderVerification] = React.useState<ProviderVerification | null>(null);
  const [providerVerificationLoading, setProviderVerificationLoading] = React.useState(false);
  const [providerHandshake, setProviderHandshake] = React.useState<ProviderHandshakeResult | null>(null);
  const [providerHandshakeLoading, setProviderHandshakeLoading] = React.useState(false);
  const [providerHandshakeErr, setProviderHandshakeErr] = React.useState<string | null>(null);
  const [providerAck, setProviderAck] = React.useState<ProviderAcknowledgmentResult | null>(null);
  const [providerAckLoading, setProviderAckLoading] = React.useState(false);
  const [providerAckErr, setProviderAckErr] = React.useState<string | null>(null);
  const [providerAckReadiness, setProviderAckReadiness] = React.useState<ProviderAcknowledgmentReadiness | null>(null);
  const [providerOperation, setProviderOperation] = React.useState<ProviderOperationIntentResult | null>(null);
  const [providerOperationLoading, setProviderOperationLoading] = React.useState(false);
  const [providerOperationErr, setProviderOperationErr] = React.useState<string | null>(null);
  const [providerPermitReadiness, setProviderPermitReadiness] = React.useState<ProviderExecutionPermitReadiness | null>(null);
  const [providerExecutionReadiness, setProviderExecutionReadiness] = React.useState<ProviderExecutionChainReadiness | null>(null);
  const [providerExecuteTest, setProviderExecuteTest] = React.useState<ProviderExecuteTestResult | null>(null);
  const [providerExecuteTestLoading, setProviderExecuteTestLoading] = React.useState(false);
  const [providerExecuteTestErr, setProviderExecuteTestErr] = React.useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = React.useState<RuntimeStatus | null>(null);
  const [runtimeRestarting, setRuntimeRestarting] = React.useState(false);
  const [runtimeMsg, setRuntimeMsg] = React.useState<string | null>(null);
  const [runtimeErr, setRuntimeErr] = React.useState<string | null>(null);
  const [nodePresence, setNodePresence] = React.useState<NodePresence | null>(null);
  const [userNetworkStatus, setUserNetworkStatus] = React.useState<UserNetworkStatus | null>(null);
  const [guidedSetupPhase, setGuidedSetupPhase] = React.useState<GuidedSetupPhase>("idle");
  const [guidedSetupMessage, setGuidedSetupMessage] = React.useState<string>("Use Connect provider to complete setup.");
  const [guidedSetupError, setGuidedSetupError] = React.useState<string | null>(null);
  const [profileActivationStatus, setProfileActivationStatus] = React.useState<ProfileActivationStatus | null>(null);
  const [profileActivationBusy, setProfileActivationBusy] = React.useState(false);
  const [profileActivationMsg, setProfileActivationMsg] = React.useState<string | null>(null);
  const [profileActivationErr, setProfileActivationErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    api("/api/diagnostics/status", "GET")
      .then((d) => {
        if (!active) return;
        setDiagnostics(d || null);
      })
      .catch(() => {
        if (!active) return;
        setDiagnostics(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    setProviderVerificationLoading(true);
    api<ProviderVerification>("/api/network/provider/verification/status", "GET")
      .then((d) => {
        if (!active) return;
        setProviderVerification(d || null);
      })
      .catch(() => {
        if (!active) return;
        setProviderVerification(null);
      })
      .finally(() => {
        if (!active) return;
        setProviderVerificationLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    api<ProviderAcknowledgmentResult>("/api/network/provider/acknowledgment/status", "GET")
      .then((d) => {
        if (!active) return;
        setProviderAck(d || null);
      })
      .catch(() => {
        if (!active) return;
        setProviderAck(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    api<ProviderAcknowledgmentReadiness>("/api/network/provider/acknowledgment/readiness", "GET")
      .then((d) => {
        if (!active) return;
        setProviderAckReadiness(d || null);
      })
      .catch(() => {
        if (!active) return;
        setProviderAckReadiness(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    api<ProviderOperationIntentResult>("/api/network/provider/operation-intent/status", "GET")
      .then((d) => {
        if (!active) return;
        setProviderOperation(d || null);
      })
      .catch(() => {
        if (!active) return;
        setProviderOperation(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    api<ProviderExecutionPermitReadiness>("/api/network/provider/operation-intent/readiness", "GET")
      .then((d) => {
        if (!active) return;
        setProviderPermitReadiness(d || null);
      })
      .catch(() => {
        if (!active) return;
        setProviderPermitReadiness(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    api<ProviderExecutionChainReadiness>("/api/network/provider/execution/readiness", "GET")
      .then((d) => {
        if (!active) return;
        setProviderExecutionReadiness(d || null);
      })
      .catch(() => {
        if (!active) return;
        setProviderExecutionReadiness(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    api<NodePresence>("/api/network/presence", "GET")
      .then((d) => {
        if (!active) return;
        setNodePresence(d || null);
      })
      .catch(() => {
        if (!active) return;
        setNodePresence(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    api<RuntimeStatus>("/api/runtime/status", "GET")
      .then((d) => {
        if (!active) return;
        setRuntimeStatus(d || null);
      })
      .catch(() => {
        if (!active) return;
        setRuntimeStatus(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    api<UserNetworkStatus>("/api/network/user-status", "GET")
      .then((d) => {
        if (!active) return;
        setUserNetworkStatus(d || null);
      })
      .catch(() => {
        if (!active) return;
        setUserNetworkStatus(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    api<ProfileActivationStatus>("/api/network/activate-profile/status", "GET")
      .then((d) => {
        if (!active) return;
        setProfileActivationStatus(d || null);
      })
      .catch(() => {
        if (!active) return;
        setProfileActivationStatus(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    fetchIdentityDetail()
      .then((d) => {
        if (!active) return;
        setIdentity(d || null);
      })
      .catch(() => {
        if (!active) return;
        setIdentity(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    api<NetworkSummary>("/api/network/summary", "GET")
      .then((d) => {
        if (!active) return;
        setNetworkSummary(d || null);
      })
      .catch(() => {
        if (!active) return;
        setNetworkSummary(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    setProviderLoading(true);
    api<NetworkProviderConfig>("/api/network/provider", "GET")
      .then((d) => {
        if (!active) return;
        setProviderConfig({
          providerNodeId: d?.providerNodeId || "",
          providerProfileId: d?.providerProfileId || "",
          providerUrl: d?.providerUrl || "",
          providerPubKey: d?.providerPubKey || "",
          enabled: Boolean(d?.enabled),
          createdAt: d?.createdAt || null,
          updatedAt: d?.updatedAt || null,
          configured: Boolean(d?.configured)
        });
      })
      .catch(() => {
        if (!active) return;
        setProviderConfig({
          providerNodeId: "",
          providerProfileId: "",
          providerUrl: "",
          providerPubKey: "",
          enabled: false
        });
      })
      .finally(() => {
        if (!active) return;
        setProviderLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function updateProviderField<K extends keyof NetworkProviderConfig>(key: K, value: NetworkProviderConfig[K]) {
    setProviderConfig((prev) => {
      const base: NetworkProviderConfig = prev || {
        providerNodeId: "",
        providerProfileId: "",
        providerUrl: "",
        providerPubKey: "",
        enabled: false
      };
      return { ...base, [key]: value };
    });
  }

  async function refreshUserNetworkStatus() {
    try {
      const status = await api<UserNetworkStatus>("/api/network/user-status", "GET");
      setUserNetworkStatus(status || null);
      return status || null;
    } catch {
      setUserNetworkStatus(null);
      return null;
    }
  }

  async function refreshProfileActivationStatus() {
    try {
      const status = await api<ProfileActivationStatus>("/api/network/activate-profile/status", "GET");
      setProfileActivationStatus(status || null);
      return status || null;
    } catch {
      setProfileActivationStatus(null);
      return null;
    }
  }

  function guidedVerificationFailureMessage(status: ProviderVerification["verification"]["status"]) {
    if (status === "unreachable") return "We couldn’t reach your provider.";
    if (status === "not_configured") return "Your connection setup is incomplete.";
    return "Your provider connection needs to be refreshed.";
  }

  function guidedAcknowledgmentFailureMessage(status: ProviderAcknowledgmentResult["acknowledgment"]["status"]) {
    if (status === "unreachable") return "We couldn’t reach your provider.";
    if (status === "invalid_response") return "Your provider response was invalid.";
    if (status === "invalid_signature" || status === "provider_not_trusted") {
      return "Your provider connection needs to be refreshed.";
    }
    return "Your connection setup is incomplete.";
  }

  function guidedPermitFailureMessage(status: ProviderOperationIntentResult["permit"]["status"]) {
    if (status === "unreachable") return "We couldn’t reach your provider.";
    if (status === "provider_acknowledgment_required") return "Your connection setup is incomplete.";
    if (status === "invalid_response") return "Your provider response was invalid.";
    if (status === "invalid_signature" || status === "provider_not_trusted") {
      return "Your provider connection needs to be refreshed.";
    }
    return "Your connection setup is incomplete.";
  }

  async function saveProviderConfig() {
    if (!providerConfig) return;
    setProviderMsg(null);
    setProviderErr(null);
    setProviderSaving(true);
    try {
      const saved = await api<NetworkProviderConfig>("/api/network/provider", "PUT", {
        providerNodeId: providerConfig.providerNodeId || "",
        providerProfileId: providerConfig.providerProfileId || null,
        providerUrl: providerConfig.providerUrl || "",
        providerPubKey: providerConfig.providerPubKey || null,
        enabled: Boolean(providerConfig.enabled)
      });
      setProviderConfig({
        providerNodeId: saved?.providerNodeId || "",
        providerProfileId: saved?.providerProfileId || "",
        providerUrl: saved?.providerUrl || "",
        providerPubKey: saved?.providerPubKey || "",
        enabled: Boolean(saved?.enabled),
        createdAt: saved?.createdAt || null,
        updatedAt: saved?.updatedAt || null,
        configured: Boolean(saved?.configured)
      });
      setProviderMsg("Provider configuration saved.");
      const refreshed = await api<NetworkSummary>("/api/network/summary", "GET");
      setNetworkSummary(refreshed || null);
      setProviderVerificationLoading(true);
      const verification = await api<ProviderVerification>("/api/network/provider/verification", "GET");
      setProviderVerification(verification || null);
      const ackStatus = await api<ProviderAcknowledgmentResult>("/api/network/provider/acknowledgment/status", "GET");
      setProviderAck(ackStatus || null);
      const ackReadiness = await api<ProviderAcknowledgmentReadiness>("/api/network/provider/acknowledgment/readiness", "GET");
      setProviderAckReadiness(ackReadiness || null);
      const operationStatus = await api<ProviderOperationIntentResult>("/api/network/provider/operation-intent/status", "GET");
      setProviderOperation(operationStatus || null);
      const permitReadiness = await api<ProviderExecutionPermitReadiness>("/api/network/provider/operation-intent/readiness", "GET");
      setProviderPermitReadiness(permitReadiness || null);
      const executionReadiness = await api<ProviderExecutionChainReadiness>("/api/network/provider/execution/readiness", "GET");
      setProviderExecutionReadiness(executionReadiness || null);
      await refreshUserNetworkStatus();
      await refreshProfileActivationStatus();
      setProviderVerificationLoading(false);
    } catch (e: any) {
      setProviderErr(e?.message || "Failed to save provider configuration.");
      setProviderVerificationLoading(false);
    } finally {
      setProviderSaving(false);
    }
  }

  async function testProviderHandshake() {
    setProviderHandshakeErr(null);
    setProviderHandshakeLoading(true);
    try {
      const result = await api<ProviderHandshakeResult>("/api/network/provider/handshake", "POST", {});
      setProviderHandshake(result || null);
    } catch (e: any) {
      setProviderHandshake(null);
      setProviderHandshakeErr(e?.message || "Provider handshake failed.");
    } finally {
      setProviderHandshakeLoading(false);
    }
  }

  async function requestProviderAcknowledgment() {
    setProviderAckErr(null);
    setProviderAckLoading(true);
    try {
      const result = await api<ProviderAcknowledgmentResult>("/api/network/provider/request-acknowledgment", "POST", {});
      setProviderAck(result || null);
      const readiness = await api<ProviderAcknowledgmentReadiness>("/api/network/provider/acknowledgment/readiness", "GET");
      setProviderAckReadiness(readiness || null);
      const executionReadiness = await api<ProviderExecutionChainReadiness>("/api/network/provider/execution/readiness", "GET");
      setProviderExecutionReadiness(executionReadiness || null);
      await refreshUserNetworkStatus();
      await refreshProfileActivationStatus();
    } catch (e: any) {
      setProviderAck(null);
      setProviderAckErr(e?.message || "Provider acknowledgment request failed.");
    } finally {
      setProviderAckLoading(false);
    }
  }

  async function requestProviderOperationIntent() {
    setProviderOperationErr(null);
    setProviderOperationLoading(true);
    try {
      const result = await api<ProviderOperationIntentResult>("/api/network/provider/request-operation-intent", "POST", {});
      setProviderOperation(result || null);
      const permitReadiness = await api<ProviderExecutionPermitReadiness>("/api/network/provider/operation-intent/readiness", "GET");
      setProviderPermitReadiness(permitReadiness || null);
      const executionReadiness = await api<ProviderExecutionChainReadiness>("/api/network/provider/execution/readiness", "GET");
      setProviderExecutionReadiness(executionReadiness || null);
      await refreshUserNetworkStatus();
      await refreshProfileActivationStatus();
    } catch (e: any) {
      setProviderOperation(null);
      setProviderOperationErr(e?.message || "Provider execution permit request failed.");
    } finally {
      setProviderOperationLoading(false);
    }
  }

  async function requestProviderExecuteTest() {
    setProviderExecuteTestErr(null);
    setProviderExecuteTestLoading(true);
    try {
      const result = await api<ProviderExecuteTestResult>("/api/network/provider/request-execute-test", "POST", {});
      setProviderExecuteTest(result || null);
      const executionReadiness = await api<ProviderExecutionChainReadiness>("/api/network/provider/execution/readiness", "GET");
      setProviderExecutionReadiness(executionReadiness || null);
      await refreshUserNetworkStatus();
      await refreshProfileActivationStatus();
    } catch (e: any) {
      setProviderExecuteTest(null);
      setProviderExecuteTestErr(e?.message || "Provider execute-test failed.");
    } finally {
      setProviderExecuteTestLoading(false);
    }
  }

  async function connectProviderGuided() {
    if (!providerConfig) return;
    setGuidedSetupError(null);
    setGuidedSetupPhase("saving");
    setGuidedSetupMessage("Saving provider settings...");
    setProviderMsg(null);
    setProviderErr(null);
    setProviderSaving(true);
    try {
      const saved = await api<NetworkProviderConfig>("/api/network/provider", "PUT", {
        providerNodeId: providerConfig.providerNodeId || "",
        providerProfileId: providerConfig.providerProfileId || null,
        providerUrl: providerConfig.providerUrl || "",
        providerPubKey: providerConfig.providerPubKey || null,
        enabled: Boolean(providerConfig.enabled)
      });
      setProviderConfig({
        providerNodeId: saved?.providerNodeId || "",
        providerProfileId: saved?.providerProfileId || "",
        providerUrl: saved?.providerUrl || "",
        providerPubKey: saved?.providerPubKey || "",
        enabled: Boolean(saved?.enabled),
        createdAt: saved?.createdAt || null,
        updatedAt: saved?.updatedAt || null,
        configured: Boolean(saved?.configured)
      });
      setProviderMsg("Provider configuration saved.");

      const refreshed = await api<NetworkSummary>("/api/network/summary", "GET");
      setNetworkSummary(refreshed || null);
      const initialStatus = await refreshUserNetworkStatus();
      await refreshProfileActivationStatus();
      if (initialStatus?.status === "ready") {
        setGuidedSetupPhase("ready");
        setGuidedSetupMessage("Connected and ready to use.");
        return;
      }

      setGuidedSetupPhase("verifying");
      setGuidedSetupMessage("Checking provider...");
      setProviderVerificationLoading(true);
      const verification = await api<ProviderVerification>("/api/network/provider/verification", "GET");
      setProviderVerification(verification || null);
      setProviderVerificationLoading(false);
      await refreshUserNetworkStatus();
      await refreshProfileActivationStatus();
      if (verification?.verification?.status !== "verified") {
        setGuidedSetupPhase("error");
        setGuidedSetupMessage(guidedVerificationFailureMessage(verification?.verification?.status || "not_configured"));
        return;
      }

      setGuidedSetupPhase("acknowledging");
      setGuidedSetupMessage("Establishing provider relationship...");
      const ack = await api<ProviderAcknowledgmentResult>("/api/network/provider/request-acknowledgment", "POST", {});
      setProviderAck(ack || null);
      const ackReadiness = await api<ProviderAcknowledgmentReadiness>("/api/network/provider/acknowledgment/readiness", "GET");
      setProviderAckReadiness(ackReadiness || null);
      await refreshUserNetworkStatus();
      await refreshProfileActivationStatus();
      if (!(ack?.acknowledgment?.status === "accepted" && ack?.acknowledgment?.signatureValidated)) {
        setGuidedSetupPhase("error");
        setGuidedSetupMessage(guidedAcknowledgmentFailureMessage(ack?.acknowledgment?.status || "provider_not_trusted"));
        return;
      }

      setGuidedSetupPhase("permitting");
      setGuidedSetupMessage("Finalizing provider access...");
      const permit = await api<ProviderOperationIntentResult>("/api/network/provider/request-operation-intent", "POST", {});
      setProviderOperation(permit || null);
      const permitReadiness = await api<ProviderExecutionPermitReadiness>("/api/network/provider/operation-intent/readiness", "GET");
      setProviderPermitReadiness(permitReadiness || null);
      const executionReadiness = await api<ProviderExecutionChainReadiness>("/api/network/provider/execution/readiness", "GET");
      setProviderExecutionReadiness(executionReadiness || null);
      const finalStatus = await refreshUserNetworkStatus();
      await refreshProfileActivationStatus();
      if (!(permit?.permit?.status === "accepted" && permit?.permit?.signatureValidated)) {
        setGuidedSetupPhase("error");
        setGuidedSetupMessage(guidedPermitFailureMessage(permit?.permit?.status || "provider_not_trusted"));
        return;
      }
      if (finalStatus?.status === "ready") {
        setGuidedSetupPhase("ready");
        setGuidedSetupMessage("Connected and ready to use.");
        return;
      }
      if (finalStatus?.status === "offline") {
        setGuidedSetupPhase("error");
        setGuidedSetupMessage("We couldn’t reach your provider.");
        return;
      }
      if (finalStatus?.status === "action_required") {
        setGuidedSetupPhase("error");
        setGuidedSetupMessage("Your provider connection needs to be refreshed.");
        return;
      }
      setGuidedSetupPhase("error");
      setGuidedSetupMessage("Your connection setup is incomplete.");
    } catch (e: any) {
      setGuidedSetupPhase("error");
      setGuidedSetupError(e?.message || "Failed to connect provider.");
      setGuidedSetupMessage("Your provider connection needs attention.");
      await refreshUserNetworkStatus();
      await refreshProfileActivationStatus();
    } finally {
      setProviderSaving(false);
      setProviderVerificationLoading(false);
    }
  }

  async function restartRuntime() {
    setRuntimeMsg(null);
    setRuntimeErr(null);
    setRuntimeRestarting(true);
    try {
      await api("/api/runtime/restart", "POST", {});
      setRuntimeMsg("Restart requested. The node runtime should come back shortly.");
      await refreshUserNetworkStatus();
      await refreshProfileActivationStatus();
    } catch (e: any) {
      setRuntimeErr(e?.message || "Failed to request restart.");
    } finally {
      setRuntimeRestarting(false);
    }
  }

  async function activateProfileOnNetwork() {
    setProfileActivationErr(null);
    setProfileActivationMsg(null);
    setProfileActivationBusy(true);
    try {
      const result = await api<ProfileActivationResult>("/api/network/activate-profile", "POST", {});
      if (result?.status === "activated") {
        setProfileActivationMsg("Profile activated and ready for future provider-backed features.");
      } else {
        setProfileActivationMsg(result?.message || "Finish provider setup before activating this feature.");
      }
      await refreshUserNetworkStatus();
      await refreshProfileActivationStatus();
    } catch (e: any) {
      setProfileActivationErr(e?.message || "Failed to activate profile.");
    } finally {
      setProfileActivationBusy(false);
    }
  }

  function onOpen() {
    setMsg(null);
    const buyUrl = extractBuyUrl(input);
    if (buyUrl) {
      window.location.assign(buyUrl);
      return;
    }

    const token = extractReceiptToken(input);
    if (token) {
      props.onOpenReceipt(token);
      return;
    }

    const contentId = input.trim();
    if (!contentId) {
      setMsg("Paste a link, receipt token, or content ID.");
      return;
    }
    if (!nodeHost) {
      setMsg("Enter a node endpoint to open this content.");
      return;
    }
    const host = nodeHost.replace(/\/$/, "");
    window.location.assign(`${host}/buy/${contentId}`);
  }

  const profileType = diagnostics?.productTier === "advanced" ? "Advanced" : "Basic";
  const productTier = String(diagnostics?.productTier || "basic").toLowerCase();
  const paymentMode = String(diagnostics?.paymentsMode || "wallet").toLowerCase();
  const reachabilityMode =
    diagnostics?.publicStatus?.mode === "named"
      ? "Direct persistent endpoint"
      : diagnostics?.publicStatus?.mode === "quick"
        ? "Fallback-backed temporary endpoint"
        : "Not configured";
  const publicEndpoint = diagnostics?.publicStatus?.url ? String(diagnostics.publicStatus.url) : "Unavailable";
  const discoverability =
    diagnostics?.publicStatus?.status === "online"
      ? "Visible by link"
      : "Offline / not currently reachable";
  const networkService =
    paymentMode === "node"
      ? "This node can provide BOLT11 invoice generation."
      : "This profile can consume network payment services via wallet/fallback mode.";
  const runtimeNodeMode = String(identity?.nodeMode || "").toLowerCase();
  const resolvedNodeMode =
    runtimeNodeMode === "advanced" || runtimeNodeMode === "lan" || runtimeNodeMode === "basic"
      ? runtimeNodeMode
      : productTier === "advanced"
        ? "advanced"
        : productTier === "lan"
          ? "lan"
          : "basic";
  const nodeModeLabel =
    resolvedNodeMode === "advanced"
      ? "Advanced"
      : resolvedNodeMode === "lan"
        ? "LAN"
        : "Basic (tunnel-backed)";
  const fallbackServiceRoleLabel =
    paymentMode === "node" && resolvedNodeMode === "advanced"
      ? "Providing invoice infrastructure"
      : "Creator";
  const fallbackVisibilitySummary =
    diagnostics?.publicStatus?.status === "online"
      ? "Direct Link"
      : "Hidden";
  const fallbackPaymentCapabilityLabel =
    paymentMode === "node" ? "Local Lightning invoice minting enabled" : "Tips only";
  const fallbackTunnel = diagnostics?.publicStatus?.mode === "named" || diagnostics?.publicStatus?.mode === "quick";

  const summaryNodeModeLabel =
    networkSummary?.nodeMode === "advanced"
      ? "Advanced"
      : networkSummary?.nodeMode === "lan"
        ? "LAN"
        : networkSummary?.nodeMode === "basic"
          ? "Basic (tunnel-backed)"
          : nodeModeLabel;
  const summaryVisibility =
    networkSummary?.visibility === "LISTED"
      ? "Discoverable"
      : networkSummary?.visibility === "UNLISTED"
        ? "Direct Link"
        : networkSummary?.visibility === "DISABLED"
          ? "Hidden"
          : fallbackVisibilitySummary;
  const summaryServiceRole = networkSummary
    ? networkSummary.serviceRoles.hybrid
      ? "Creator + invoice provider"
      : networkSummary.serviceRoles.invoiceProvider
        ? "Providing invoice infrastructure"
        : "Creator"
    : fallbackServiceRoleLabel;
  const summaryPaymentCapability = networkSummary
    ? networkSummary.paymentCapability.localInvoiceMinting
      ? "Local Lightning invoice minting enabled"
      : networkSummary.paymentCapability.delegatedInvoiceSupport
        ? "Delegated invoice infrastructure enabled"
        : networkSummary.paymentCapability.tipsOnly
          ? "Tips only"
          : "Unavailable"
    : fallbackPaymentCapabilityLabel;
  const summaryPublicEndpoint = networkSummary?.reachability?.publicUrl || publicEndpoint;
  const summaryTunnel = networkSummary ? networkSummary.reachability.tunnel : fallbackTunnel;
  const summaryIpfsEnabled = networkSummary ? networkSummary.reachability.ipfs : false;
  const summaryReachabilityMode = networkSummary
    ? networkSummary.reachability.publicUrl
      ? "Public route available"
      : "No active public route"
    : reachabilityMode;
  const summaryNetworkService = networkSummary
    ? networkSummary.serviceRoles.hybrid || networkSummary.serviceRoles.invoiceProvider
      ? "This node can serve invoice-generation infrastructure."
      : "This profile participates as a creator network identity."
    : networkService;
  const runtimeStateLabel =
    runtimeStatus?.runtime?.status === "running"
      ? "Running"
      : runtimeStatus?.runtime?.status === "degraded"
        ? "Degraded"
        : "Stopped";
  const runtimeApiReadyLabel = runtimeStatus?.runtime?.apiReady ? "yes" : "no";
  const runtimeEndpointUrl = runtimeStatus?.endpoint?.url || summaryPublicEndpoint;
  const runtimeEndpointStability =
    runtimeStatus?.endpoint?.stability === "stable"
      ? "Stable"
      : runtimeStatus?.endpoint?.stability === "temporary"
        ? "Temporary"
        : "Unknown";
  const runtimeLastRestart = runtimeStatus?.runtime?.lastRestartAt
    ? new Date(runtimeStatus.runtime.lastRestartAt).toLocaleString()
    : "—";
  const runtimeRestartAvailable = Boolean(runtimeStatus);
  const presenceNodeIdRaw = nodePresence?.node?.nodeId || "Unavailable";
  const presenceNodeId =
    presenceNodeIdRaw.length > 42
      ? `${presenceNodeIdRaw.slice(0, 18)}...${presenceNodeIdRaw.slice(-12)}`
      : presenceNodeIdRaw;
  const presenceCapabilityLevel =
    nodePresence?.node?.capabilityLevel === "advanced"
      ? "Advanced"
      : nodePresence?.node?.capabilityLevel === "lan"
        ? "LAN"
        : nodePresence?.node?.capabilityLevel === "basic"
          ? "Basic"
          : summaryNodeModeLabel;
  const presenceRoles = nodePresence?.node?.serviceRoles?.length
    ? nodePresence.node.serviceRoles
        .map((r) => (r === "provider" ? "provider" : "creator"))
        .join(" + ")
    : "creator";
  const presenceEndpointUrl = nodePresence?.endpoint?.url || runtimeEndpointUrl || "Unavailable";
  const presenceEndpointStability =
    nodePresence?.endpoint?.stability === "stable"
      ? "Stable"
      : nodePresence?.endpoint?.stability === "temporary"
        ? "Temporary"
        : runtimeEndpointStability;
  const presenceRuntimeStatus =
    nodePresence?.runtime?.status === "running"
      ? "Running"
      : nodePresence?.runtime?.status === "degraded"
        ? "Degraded"
        : nodePresence?.runtime?.status === "stopped"
          ? "Stopped"
          : runtimeStateLabel;
  const providerAckExecutionReadinessLabel =
    providerAckReadiness?.readiness === "ready"
      ? "Ready"
      : providerAckReadiness?.readiness === "not_current"
        ? "Not current"
        : providerAckReadiness?.readiness === "not_configured"
          ? "Not configured"
          : providerAckReadiness?.readiness === "blocked"
            ? "Blocked"
            : "Unknown";
  const providerPermitExecutionReadinessLabel =
    providerPermitReadiness?.readiness === "ready"
      ? "Ready"
      : providerPermitReadiness?.readiness === "expired"
        ? "Expired"
        : providerPermitReadiness?.readiness === "not_current"
          ? "Not current"
          : providerPermitReadiness?.readiness === "not_configured"
            ? "Not configured"
            : providerPermitReadiness?.readiness === "blocked"
              ? "Blocked"
              : "Unknown";
  const providerExecutionChainLabel =
    providerExecutionReadiness?.ready
      ? "Ready"
      : providerExecutionReadiness
        ? "Blocked"
        : "Unknown";
  const userNetworkStatusLabel =
    userNetworkStatus?.status === "ready"
      ? "Ready"
      : userNetworkStatus?.status === "connecting"
        ? "Connecting"
        : userNetworkStatus?.status === "action_required"
          ? "Action Required"
          : userNetworkStatus?.status === "offline"
            ? "Offline"
            : "Unknown";
  const providerExecutionTrust =
    providerVerification?.verification?.status === "verified"
      ? "Ready"
      : providerVerification?.verification?.status === "unreachable"
        ? "Unreachable"
        : providerVerification?.verification?.status === "not_configured"
          ? "Not configured"
          : providerVerification?.verification?.status
            ? "Blocked"
            : "Unknown";
  const guidedSetupBusy =
    guidedSetupPhase === "saving" ||
    guidedSetupPhase === "verifying" ||
    guidedSetupPhase === "acknowledging" ||
    guidedSetupPhase === "permitting";
  const guidedSetupPhaseLabel =
    guidedSetupPhase === "saving"
      ? "Saving provider settings"
      : guidedSetupPhase === "verifying"
        ? "Checking provider"
        : guidedSetupPhase === "acknowledging"
          ? "Establishing provider relationship"
          : guidedSetupPhase === "permitting"
            ? "Finalizing provider access"
            : guidedSetupPhase === "ready"
              ? "Ready"
              : guidedSetupPhase === "error"
                ? userNetworkStatus?.status === "offline"
                  ? "Offline"
                  : "Action Required"
                : "Idle";
  const guidedActionLabel =
    userNetworkStatus?.status === "ready"
      ? "Refresh setup"
      : userNetworkStatus?.status === "connecting" || userNetworkStatus?.status === "action_required"
        ? "Finish setup"
        : "Connect provider";
  const profileActivationLabel =
    profileActivationStatus?.activation?.status === "activated"
      ? "Activated"
      : profileActivationStatus?.activation?.status === "not_ready"
        ? "Not ready"
        : "Unknown";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Network</div>
        <div className="text-sm text-neutral-400 mt-1">
          Your Certifyd Creator Profile is your network identity. Endpoint URLs may change, identity does not.
        </div>

        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Network Summary</div>
          <div className="mt-2 grid gap-2 text-xs">
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Identity</span>
              <span className="text-neutral-200 text-right">Certifyd Creator Profile active</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Reachability</span>
              <span className="text-neutral-200 text-right">{summaryReachabilityMode}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Payment</span>
              <span className="text-neutral-200 text-right">{summaryPaymentCapability}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Node Mode</span>
              <span className="text-neutral-200 text-right">{summaryNodeModeLabel}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Service Role</span>
              <span className="text-neutral-200 text-right">{summaryServiceRole}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-neutral-500">Visibility</span>
              <span className="text-neutral-200 text-right">
                {summaryVisibility} <span className="text-neutral-500">(per-content states: Hidden / Direct Link / Discoverable)</span>
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Identity</div>
            <div className="mt-1 text-sm text-neutral-200">Certifyd Creator Profile</div>
            <div className="text-xs text-neutral-400 mt-1">Profile type: {profileType}</div>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Payment Capability</div>
            <div className="mt-1 text-sm text-neutral-200">{summaryPaymentCapability}</div>
            <div className="text-xs text-neutral-400 mt-1">{summaryNetworkService}</div>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Reachability</div>
            <div className="mt-1 text-sm text-neutral-200">{summaryReachabilityMode}</div>
            <div className="text-xs text-neutral-400 mt-1 break-all">{summaryPublicEndpoint}</div>
            <div className="text-xs text-neutral-500 mt-1">Tunnel: {summaryTunnel ? "yes" : "no"}</div>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Discoverability</div>
            <div className="mt-1 text-sm text-neutral-200">{discoverability}</div>
            <div className="text-xs text-neutral-400 mt-1">
              Network discovery is link-first in v1. Explorer/search surfaces come later.
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">User Network Status</div>
          <div className="mt-2 grid gap-2 text-xs">
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Network Status</span>
              <span className="text-neutral-200 text-right">{userNetworkStatusLabel}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Status message</span>
              <span className="text-neutral-200 text-right">{userNetworkStatus?.message || "Status unavailable."}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-neutral-500">Suggested action</span>
              <span className="text-neutral-200 text-right">{userNetworkStatus?.actionLabel || "None"}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Runtime</div>
          <div className="mt-2 grid gap-2 text-xs">
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Node Runtime</span>
              <span className="text-neutral-200 text-right">{runtimeStateLabel}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">API Ready</span>
              <span className="text-neutral-200 text-right">{runtimeApiReadyLabel}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Last restart</span>
              <span className="text-neutral-200 text-right">{runtimeLastRestart}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Endpoint</span>
              <span className="text-neutral-200 text-right break-all">{runtimeEndpointUrl || "Unavailable"}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-neutral-500">Endpoint stability</span>
              <span className="text-neutral-200 text-right">{runtimeEndpointStability}</span>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            {runtimeRestartAvailable ? (
              <button
                onClick={restartRuntime}
                disabled={runtimeRestarting}
                className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900 disabled:opacity-50"
              >
                {runtimeRestarting ? "Restarting..." : "Restart node"}
              </button>
            ) : null}
            {runtimeMsg ? <div className="text-xs text-emerald-300">{runtimeMsg}</div> : null}
            {runtimeErr ? <div className="text-xs text-rose-300">{runtimeErr}</div> : null}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Node Presence</div>
          <div className="mt-2 grid gap-2 text-xs">
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Node ID</span>
              <span className="text-neutral-200 text-right break-all">{presenceNodeId}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Capability</span>
              <span className="text-neutral-200 text-right">{presenceCapabilityLevel}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Service roles</span>
              <span className="text-neutral-200 text-right">{presenceRoles}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Endpoint</span>
              <span className="text-neutral-200 text-right break-all">{presenceEndpointUrl}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Endpoint stability</span>
              <span className="text-neutral-200 text-right">{presenceEndpointStability}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-neutral-500">Runtime status</span>
              <span className="text-neutral-200 text-right">{presenceRuntimeStatus}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Network Services</div>
          <div className="mt-1 text-sm text-neutral-200">{summaryNetworkService}</div>
          <div className="text-xs text-neutral-400 mt-1">
            Service roles can evolve without changing the creator identity root.
          </div>
          <div className="mt-3 rounded-lg border border-neutral-800/80 bg-neutral-950/70 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Content Distribution</div>
            <div className="mt-1 text-xs text-neutral-300">Primary route: {summaryTunnel ? "Tunnel endpoint" : "Direct endpoint"}</div>
            <div className="text-xs text-neutral-500">Fallback route: IPFS ({summaryIpfsEnabled ? "enabled" : "planned"})</div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Provider Configuration</div>
          <div className="mt-1 text-xs text-neutral-400">
            Configure a trusted network provider for future delegated invoice infrastructure. Saving a provider here does not enable delegated purchases by itself.
          </div>
          <div className="mt-3 rounded-lg border border-neutral-800/80 bg-neutral-950/70 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Guided setup</div>
            <div className="mt-1 text-xs text-neutral-200">Current step: {guidedSetupPhaseLabel}</div>
            <div className="text-xs text-neutral-400 mt-1">{guidedSetupMessage}</div>
            <div className="text-xs text-neutral-400 mt-1">
              Network Status: <span className="text-neutral-300">{userNetworkStatusLabel}</span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={connectProviderGuided}
                disabled={providerLoading || providerSaving || guidedSetupBusy || !providerConfig}
                className="rounded-lg border border-neutral-800 px-3 py-2 text-xs hover:bg-neutral-900 disabled:opacity-50"
              >
                {guidedSetupBusy ? `${guidedSetupPhaseLabel}...` : guidedActionLabel}
              </button>
              {guidedSetupError ? <div className="text-xs text-rose-300">{guidedSetupError}</div> : null}
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-neutral-800/80 bg-neutral-950/70 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Post-Ready action</div>
            <div className="mt-1 text-xs text-neutral-200">Activate profile on network</div>
            <div className="mt-2 grid gap-1 text-xs text-neutral-400">
              <div>Status: <span className="text-neutral-300">{profileActivationLabel}</span></div>
              <div>Message: <span className="text-neutral-300">{profileActivationStatus?.activation?.message || "Activate once setup is ready."}</span></div>
              <div>Activated at: <span className="text-neutral-300">{profileActivationStatus?.activation?.activatedAt ? new Date(profileActivationStatus.activation.activatedAt).toLocaleString() : "—"}</span></div>
              <div>Checked at: <span className="text-neutral-300">{profileActivationStatus?.activation?.checkedAt ? new Date(profileActivationStatus.activation.checkedAt).toLocaleString() : "—"}</span></div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={activateProfileOnNetwork}
                disabled={profileActivationBusy || userNetworkStatus?.status !== "ready"}
                className="rounded-lg border border-neutral-800 px-3 py-2 text-xs hover:bg-neutral-900 disabled:opacity-50"
                title={userNetworkStatus?.status !== "ready" ? "Finish provider setup before activating." : undefined}
              >
                {profileActivationBusy ? "Activating..." : "Activate profile"}
              </button>
              {profileActivationMsg ? <div className="text-xs text-emerald-300">{profileActivationMsg}</div> : null}
              {profileActivationErr ? <div className="text-xs text-rose-300">{profileActivationErr}</div> : null}
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-neutral-800/80 bg-neutral-950/70 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Provider verification</div>
            <div className="mt-1 text-xs text-neutral-200">
              Status:{" "}
              {providerVerificationLoading
                ? "Checking..."
                : providerVerification?.verification?.status || "unknown"}
            </div>
            <div className="text-xs text-neutral-400 mt-1">
              {providerVerification?.verification?.message || "Verification state unavailable."}
            </div>
            <div className="mt-2 grid gap-1 text-xs text-neutral-400">
              <div>Provider trust for execution: <span className="text-neutral-300">{providerExecutionTrust}</span></div>
              <div>Configured URL: <span className="text-neutral-300 break-all">{providerVerification?.configured?.providerUrl || "—"}</span></div>
              <div>Expected node ID: <span className="text-neutral-300 break-all">{providerVerification?.configured?.providerNodeId || "—"}</span></div>
              <div>Configured pubkey: <span className="text-neutral-300 break-all">{providerVerification?.configured?.providerPubKey || "—"}</span></div>
              <div>Observed node ID: <span className="text-neutral-300 break-all">{providerVerification?.observed?.nodeId || "—"}</span></div>
              <div>Observed pubkey: <span className="text-neutral-300 break-all">{providerVerification?.observed?.nodePubKey || "—"}</span></div>
              <div>Observed roles: <span className="text-neutral-300">{providerVerification?.observed?.serviceRoles?.length ? providerVerification.observed.serviceRoles.join(" + ") : "—"}</span></div>
              <div>Observed endpoint: <span className="text-neutral-300 break-all">{providerVerification?.observed?.endpoint?.url || "—"}</span></div>
              <div>Endpoint posture: <span className="text-neutral-300">{providerVerification?.observed?.endpoint?.stability || "—"}{typeof providerVerification?.observed?.endpoint?.active === "boolean" ? ` / ${providerVerification.observed.endpoint.active ? "active" : "inactive"}` : ""}</span></div>
              <div>Checked: <span className="text-neutral-300">{providerVerification?.verification?.checkedAt ? new Date(providerVerification.verification.checkedAt).toLocaleString() : "—"}</span></div>
              <div>Last success: <span className="text-neutral-300">{providerVerification?.history?.lastSuccessAt ? new Date(providerVerification.history.lastSuccessAt).toLocaleString() : "—"}</span></div>
              <div>Last failure: <span className="text-neutral-300">{providerVerification?.history?.lastFailureAt ? new Date(providerVerification.history.lastFailureAt).toLocaleString() : "—"}</span></div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={testProviderHandshake}
                disabled={providerHandshakeLoading}
                className="rounded-lg border border-neutral-800 px-3 py-2 text-xs hover:bg-neutral-900 disabled:opacity-50"
              >
                {providerHandshakeLoading ? "Testing..." : "Test provider handshake"}
              </button>
            </div>
            <div className="mt-2 grid gap-1 text-xs text-neutral-400">
              <div>Handshake status: <span className="text-neutral-300">{providerHandshake?.handshake?.status || "—"}</span></div>
              <div>Handshake message: <span className="text-neutral-300">{providerHandshake?.handshake?.message || "—"}</span></div>
              <div>Handshake checked: <span className="text-neutral-300">{providerHandshake?.handshake?.checkedAt ? new Date(providerHandshake.handshake.checkedAt).toLocaleString() : "—"}</span></div>
              <div>Observed node ID: <span className="text-neutral-300 break-all">{providerHandshake?.observed?.nodeId || "—"}</span></div>
              <div>Observed roles: <span className="text-neutral-300">{providerHandshake?.observed?.serviceRoles?.length ? providerHandshake.observed.serviceRoles.join(" + ") : "—"}</span></div>
              <div>Observed capabilities: <span className="text-neutral-300">{providerHandshake?.observed?.providerCapabilities ? `descriptorVerification=${providerHandshake.observed.providerCapabilities.descriptorVerification ? "yes" : "no"}, trustGatedExecution=${providerHandshake.observed.providerCapabilities.trustGatedExecution ? "yes" : "no"}` : "—"}</span></div>
            </div>
            {providerHandshakeErr ? <div className="mt-2 text-xs text-rose-300">{providerHandshakeErr}</div> : null}
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={requestProviderAcknowledgment}
                disabled={providerAckLoading}
                className="rounded-lg border border-neutral-800 px-3 py-2 text-xs hover:bg-neutral-900 disabled:opacity-50"
              >
                {providerAckLoading ? "Requesting..." : "Request provider acknowledgment"}
              </button>
            </div>
            <div className="mt-2 grid gap-1 text-xs text-neutral-400">
              <div>Acknowledgment status: <span className="text-neutral-300">{providerAck?.acknowledgment?.status || "—"}</span></div>
              <div>Provider acknowledgment for execution: <span className="text-neutral-300">{providerAckExecutionReadinessLabel}</span></div>
              <div>Acknowledgment message: <span className="text-neutral-300">{providerAck?.acknowledgment?.message || "—"}</span></div>
              <div>Readiness message: <span className="text-neutral-300">{providerAckReadiness?.message || "—"}</span></div>
              <div>Issued at: <span className="text-neutral-300">{providerAck?.acknowledgment?.issuedAt ? new Date(providerAck.acknowledgment.issuedAt).toLocaleString() : "—"}</span></div>
              <div>Checked at: <span className="text-neutral-300">{providerAck?.acknowledgment?.checkedAt ? new Date(providerAck.acknowledgment.checkedAt).toLocaleString() : "—"}</span></div>
              <div>Signature validated: <span className="text-neutral-300">{providerAck?.acknowledgment?.signatureValidated ? "yes" : providerAck ? "no" : "—"}</span></div>
              <div>Observed provider node ID: <span className="text-neutral-300 break-all">{providerAck?.observed?.providerNodeId || "—"}</span></div>
            </div>
            {providerAckErr ? <div className="mt-2 text-xs text-rose-300">{providerAckErr}</div> : null}
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={requestProviderOperationIntent}
                disabled={providerOperationLoading}
                className="rounded-lg border border-neutral-800 px-3 py-2 text-xs hover:bg-neutral-900 disabled:opacity-50"
              >
                {providerOperationLoading ? "Requesting..." : "Request provider execution permit"}
              </button>
            </div>
            <div className="mt-2 grid gap-1 text-xs text-neutral-400">
              <div>Execution permit readiness: <span className="text-neutral-300">{providerPermitExecutionReadinessLabel}</span></div>
              <div>Execution chain readiness: <span className="text-neutral-300">{providerExecutionChainLabel}</span></div>
              <div>Execution readiness detail: <span className="text-neutral-300">{providerExecutionReadiness?.message || "—"}</span></div>
              <div>Permit status: <span className="text-neutral-300">{providerOperation?.permit?.status || "—"}</span></div>
              <div>Permit message: <span className="text-neutral-300">{providerOperation?.permit?.message || "—"}</span></div>
              <div>Permit ID: <span className="text-neutral-300 break-all">{providerOperation?.permit?.permitId || "—"}</span></div>
              <div>Permit issuedAt: <span className="text-neutral-300">{providerOperation?.permit?.issuedAt ? new Date(providerOperation.permit.issuedAt).toLocaleString() : "—"}</span></div>
              <div>Permit expiresAt: <span className="text-neutral-300">{providerOperation?.permit?.expiresAt ? new Date(providerOperation.permit.expiresAt).toLocaleString() : "—"}</span></div>
              <div>Permit checkedAt: <span className="text-neutral-300">{providerOperation?.permit?.checkedAt ? new Date(providerOperation.permit.checkedAt).toLocaleString() : "—"}</span></div>
              <div>Permit signature validated: <span className="text-neutral-300">{providerOperation?.permit?.signatureValidated ? "yes" : providerOperation ? "no" : "—"}</span></div>
              <div>Observed provider node ID: <span className="text-neutral-300 break-all">{providerOperation?.observed?.providerNodeId || "—"}</span></div>
            </div>
            {providerOperationErr ? <div className="mt-2 text-xs text-rose-300">{providerOperationErr}</div> : null}
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={requestProviderExecuteTest}
                disabled={providerExecuteTestLoading}
                className="rounded-lg border border-neutral-800 px-3 py-2 text-xs hover:bg-neutral-900 disabled:opacity-50"
              >
                {providerExecuteTestLoading ? "Executing..." : "Run provider execute-test"}
              </button>
            </div>
            <div className="mt-2 grid gap-1 text-xs text-neutral-400">
              <div>Execute-test status: <span className="text-neutral-300">{providerExecuteTest?.execution?.status || "—"}</span></div>
              <div>Execute-test message: <span className="text-neutral-300">{providerExecuteTest?.execution?.message || "—"}</span></div>
              <div>Execute-test checkedAt: <span className="text-neutral-300">{providerExecuteTest?.execution?.checkedAt ? new Date(providerExecuteTest.execution.checkedAt).toLocaleString() : "—"}</span></div>
            </div>
            {providerExecuteTestErr ? <div className="mt-2 text-xs text-rose-300">{providerExecuteTestErr}</div> : null}
          </div>
          <div className="mt-2 text-xs">
            {networkSummary?.providerBinding?.configured
              ? "Provider configured, but delegated invoice support is not active yet."
              : "No provider configured."}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div>
              <label className="text-xs text-neutral-500" htmlFor="provider-node-id">Provider Node ID</label>
              <input
                id="provider-node-id"
                name="providerNodeId"
                value={providerConfig?.providerNodeId || ""}
                onChange={(e) => updateProviderField("providerNodeId", e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                autoComplete="off"
                disabled={providerLoading || providerSaving}
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500" htmlFor="provider-profile-id">Provider Profile ID (optional)</label>
              <input
                id="provider-profile-id"
                name="providerProfileId"
                value={providerConfig?.providerProfileId || ""}
                onChange={(e) => updateProviderField("providerProfileId", e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                autoComplete="off"
                disabled={providerLoading || providerSaving}
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500" htmlFor="provider-url">Provider URL</label>
              <input
                id="provider-url"
                name="providerUrl"
                value={providerConfig?.providerUrl || ""}
                onChange={(e) => updateProviderField("providerUrl", e.target.value)}
                placeholder="https://provider.example.com"
                className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                autoComplete="url"
                disabled={providerLoading || providerSaving}
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500" htmlFor="provider-pubkey">Provider Public Key (optional)</label>
              <input
                id="provider-pubkey"
                name="providerPubKey"
                value={providerConfig?.providerPubKey || ""}
                onChange={(e) => updateProviderField("providerPubKey", e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                autoComplete="off"
                disabled={providerLoading || providerSaving}
              />
            </div>
          </div>
          <label className="mt-3 inline-flex items-center gap-2 text-xs text-neutral-300" htmlFor="provider-enabled">
            <input
              id="provider-enabled"
              name="providerEnabled"
              type="checkbox"
              checked={Boolean(providerConfig?.enabled)}
              onChange={(e) => updateProviderField("enabled", e.target.checked)}
              disabled={providerLoading || providerSaving}
            />
            Enabled
          </label>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={saveProviderConfig}
              disabled={providerLoading || providerSaving || !providerConfig}
              className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900 disabled:opacity-50"
            >
              {providerSaving ? "Saving..." : "Save provider"}
            </button>
            {providerMsg ? <div className="text-xs text-emerald-300">{providerMsg}</div> : null}
            {providerErr ? <div className="text-xs text-rose-300">{providerErr}</div> : null}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <label className="text-sm" htmlFor="store-buy-link">
            Open by link / receipt / content ID
          </label>
          <input
            id="store-buy-link"
            name="storeBuyLink"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a Certifyd Creator link, receipt link/token, or content ID"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
            autoComplete="off"
          />
          <div className="text-xs text-neutral-500">
            Examples: https://node.site/buy/CONTENT_ID · https://node.site/public/receipts/TOKEN · TOKEN
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs text-neutral-500" htmlFor="store-seller-host">
                Node endpoint (if you pasted only a content ID)
              </label>
              <input
                id="store-seller-host"
                name="storeSellerHost"
                value={nodeHost}
                onChange={(e) => setNodeHost(e.target.value)}
                placeholder="https://node.site"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                autoComplete="url"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={onOpen}
                className="w-full text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
              >
                Open route
              </button>
            </div>
          </div>
          {msg ? <div className="text-xs text-amber-300">{msg}</div> : null}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6 opacity-80">
        <div className="text-lg font-semibold">Network discovery (Coming soon)</div>
        <div className="text-sm text-neutral-400 mt-1">
          Discovery layers will build on verified identity, reachability, and capability signals. Direct links work today.
        </div>
        <div className="mt-4 grid gap-3">
          <label className="sr-only" htmlFor="store-search">
            Search
          </label>
          <input
            id="store-search"
            name="storeSearch"
            disabled
            placeholder="Search"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 opacity-50"
            autoComplete="off"
          />
          <div className="grid grid-cols-2 gap-2">
            <button disabled className="rounded-lg border border-neutral-800 px-3 py-2 text-xs opacity-50">
              Music
            </button>
            <button disabled className="rounded-lg border border-neutral-800 px-3 py-2 text-xs opacity-50">
              Video
            </button>
            <button disabled className="rounded-lg border border-neutral-800 px-3 py-2 text-xs opacity-50">
              Books
            </button>
            <button disabled className="rounded-lg border border-neutral-800 px-3 py-2 text-xs opacity-50">
              Files
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
