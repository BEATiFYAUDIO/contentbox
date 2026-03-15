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
    providerInvoicingAvailable?: boolean;
    creatorPayoutDestinationConfigured?: boolean;
    creatorPayoutRail?: "provider_custody" | "forwarded" | "creator_node" | null;
    providerBackedCommerceReady?: boolean;
    providerBackedCommerceMessage?: string;
  };
  modeProfile?: {
    participationMode?: "basic_creator" | "sovereign_creator" | "sovereign_creator_with_provider" | "sovereign_node";
    localSovereignReady?: boolean;
    hasStablePublicRoute?: boolean;
    hasLocalInvoiceMinting?: boolean;
    providerConfigured?: boolean;
    providerTrusted?: boolean;
    providerConnected?: boolean;
    providerConnectionReason?: string;
  };
  payoutDestination?: {
    payoutDestinationType?: "lightning_address" | "local_lnd" | "onchain_address" | null;
    lightningAddress?: string | null;
    onchainAddress?: string | null;
    localLndReady?: boolean;
    providerRemitMode?: "provider_custody" | "auto_forward" | "manual_payout" | null;
    payoutConfiguredAt?: string | null;
    valid?: boolean;
    message?: string;
    effectiveDestinationType?: "lightning_address" | "local_lnd" | "onchain_address" | null;
    effectiveDestinationSummary?: string | null;
    effectivePayoutRail?: "provider_custody" | "forwarded" | "creator_node" | null;
  };
  providerServices?: {
    invoicing?: {
      mode?: "provider_backed" | "self_provided";
      feePercent?: number;
    };
    durablePublicHosting?: {
      mode?: "provider_backed" | "self_provided";
      feePercent?: number;
    };
    totalProviderFeePercent?: number;
  };
  providerBinding: {
    configured: boolean;
    providerNodeId: string | null;
  };
  visibility: "DISABLED" | "UNLISTED" | "LISTED";
  reachability: {
    publicUrl: string | null;
    localNodeEndpointUrl?: string | null;
    temporaryNodeEndpointUrl?: string | null;
    canonicalCommerceUrl?: string | null;
    canonicalCommerceKind?: "provider_hosted" | "self_hosted_stable" | "temporary_endpoint" | "unavailable";
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
  restartAvailable?: boolean;
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

type CreatorPayoutDestinationStatus = {
  payoutDestinationType: "lightning_address" | "local_lnd" | "onchain_address" | null;
  lightningAddress: string | null;
  onchainAddress: string | null;
  localLndReady: boolean;
  providerRemitMode: "provider_custody" | "auto_forward" | "manual_payout" | null;
  payoutConfiguredAt: string | null;
  valid: boolean;
  message: string;
  effectiveDestinationType: "lightning_address" | "local_lnd" | "onchain_address" | null;
  effectiveDestinationSummary: string | null;
  effectivePayoutRail: "provider_custody" | "forwarded" | "creator_node" | null;
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

type PublishReadiness = {
  readiness: "ready" | "activation_required" | "network_not_ready";
  allowed: boolean;
  message: string;
};

type PublishProfileResult = {
  status: "published" | "not_ready" | "activation_required" | "failed";
  message: string;
  publishId?: string;
  publishedAt?: string;
};

type LifecycleReceipt = {
  id: string;
  type: "provider_acknowledgment" | "operation_permit" | "profile_activation" | "profile_publish" | "content_publish";
  version: 1;
  createdAt: string;
  subjectNodeId: string;
  providerNodeId: string | null;
  objectId: string | null;
  payloadHash: string;
  prevReceiptId: string | null;
  payload: unknown;
  signatures: Array<{ alg: string; keyId?: string | null; value: string }>;
};

type ReceiptsSummary = {
  latestAcknowledgmentReceipt: LifecycleReceipt | null;
  latestPermitReceipt: LifecycleReceipt | null;
  latestActivationReceipt: LifecycleReceipt | null;
  latestPublishReceipt: LifecycleReceipt | null;
  latestContentPublishReceipt?: LifecycleReceipt | null;
  totalReceiptCount: number;
};

type ReceiptVerifyResult = {
  exists: boolean;
  hashValid: boolean;
  structuralValid: boolean;
  type: LifecycleReceipt["type"] | null;
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

function safeHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function isPrivateHost(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (hostname.startsWith("10.") || hostname.startsWith("192.168.")) return true;
  const range = hostname.match(/^172\.(\d+)\./);
  if (range) {
    const segment = Number(range[1]);
    return segment >= 16 && segment <= 31;
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
  const [showBasicDiagnostics, setShowBasicDiagnostics] = React.useState(false);
  const [showProviderAdvanced, setShowProviderAdvanced] = React.useState(false);
  const [nodePresence, setNodePresence] = React.useState<NodePresence | null>(null);
  const [userNetworkStatus, setUserNetworkStatus] = React.useState<UserNetworkStatus | null>(null);
  const [guidedSetupPhase, setGuidedSetupPhase] = React.useState<GuidedSetupPhase>("idle");
  const [guidedSetupMessage, setGuidedSetupMessage] = React.useState<string>("Use Connect provider to complete setup.");
  const [guidedSetupError, setGuidedSetupError] = React.useState<string | null>(null);
  const [profileActivationStatus, setProfileActivationStatus] = React.useState<ProfileActivationStatus | null>(null);
  const [profileActivationBusy, setProfileActivationBusy] = React.useState(false);
  const [profileActivationMsg, setProfileActivationMsg] = React.useState<string | null>(null);
  const [profileActivationErr, setProfileActivationErr] = React.useState<string | null>(null);
  const [publishReadiness, setPublishReadiness] = React.useState<PublishReadiness | null>(null);
  const [publishName, setPublishName] = React.useState("");
  const [publishBio, setPublishBio] = React.useState("");
  const [publishLinks, setPublishLinks] = React.useState("");
  const [publishProfileBusy, setPublishProfileBusy] = React.useState(false);
  const [publishProfileResult, setPublishProfileResult] = React.useState<PublishProfileResult | null>(null);
  const [publishProfileErr, setPublishProfileErr] = React.useState<string | null>(null);
  const [payoutDestination, setPayoutDestination] = React.useState<CreatorPayoutDestinationStatus | null>(null);
  const [payoutDestinationSaving, setPayoutDestinationSaving] = React.useState(false);
  const [payoutDestinationMsg, setPayoutDestinationMsg] = React.useState<string | null>(null);
  const [payoutDestinationErr, setPayoutDestinationErr] = React.useState<string | null>(null);
  const [payoutDestinationTypeInput, setPayoutDestinationTypeInput] = React.useState<"lightning_address" | "local_lnd" | "onchain_address">("lightning_address");
  const [payoutLightningInput, setPayoutLightningInput] = React.useState("");
  const [payoutOnchainInput, setPayoutOnchainInput] = React.useState("");
  const [payoutRemitModeInput, setPayoutRemitModeInput] = React.useState<"provider_custody" | "auto_forward" | "manual_payout">("manual_payout");
  const [receiptsPanelOpen, setReceiptsPanelOpen] = React.useState(false);
  const [receiptsLoading, setReceiptsLoading] = React.useState(false);
  const [receiptsErr, setReceiptsErr] = React.useState<string | null>(null);
  const [receiptsSummary, setReceiptsSummary] = React.useState<ReceiptsSummary | null>(null);
  const [receiptsRecent, setReceiptsRecent] = React.useState<LifecycleReceipt[]>([]);
  const [selectedReceiptId, setSelectedReceiptId] = React.useState<string | null>(null);
  const [selectedReceipt, setSelectedReceipt] = React.useState<LifecycleReceipt | null>(null);
  const [selectedReceiptVerify, setSelectedReceiptVerify] = React.useState<ReceiptVerifyResult | null>(null);

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
    api<PublishReadiness>("/api/publish/readiness", "GET")
      .then((d) => {
        if (!active) return;
        setPublishReadiness(d || null);
      })
      .catch(() => {
        if (!active) return;
        setPublishReadiness(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    api<CreatorPayoutDestinationStatus>("/api/network/payout-destination", "GET")
      .then((d) => {
        if (!active) return;
        setPayoutDestination(d || null);
        setPayoutDestinationTypeInput((d?.payoutDestinationType || "lightning_address") as any);
        setPayoutLightningInput(d?.lightningAddress || "");
        setPayoutOnchainInput(d?.onchainAddress || "");
        setPayoutRemitModeInput((d?.providerRemitMode || "manual_payout") as any);
      })
      .catch(() => {
        if (!active) return;
        setPayoutDestination(null);
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

  async function refreshPublishReadiness() {
    try {
      const readiness = await api<PublishReadiness>("/api/publish/readiness", "GET");
      setPublishReadiness(readiness || null);
      return readiness || null;
    } catch {
      setPublishReadiness(null);
      return null;
    }
  }

  async function refreshPayoutDestination() {
    try {
      const destination = await api<CreatorPayoutDestinationStatus>("/api/network/payout-destination", "GET");
      setPayoutDestination(destination || null);
      return destination || null;
    } catch {
      setPayoutDestination(null);
      return null;
    }
  }

  async function loadReceiptsOverview() {
    setReceiptsLoading(true);
    setReceiptsErr(null);
    try {
      const [summary, recent] = await Promise.all([
        api<ReceiptsSummary>("/api/receipts/summary", "GET"),
        api<LifecycleReceipt[]>("/api/receipts?limit=20", "GET")
      ]);
      const safeRecent = Array.isArray(recent) ? recent : [];
      setReceiptsSummary(summary || null);
      setReceiptsRecent(safeRecent);
      if (safeRecent.length > 0 && !selectedReceiptId) {
        setSelectedReceiptId(safeRecent[0].id);
      }
    } catch (e: any) {
      setReceiptsSummary(null);
      setReceiptsRecent([]);
      setReceiptsErr(e?.message || "Failed to load receipts.");
    } finally {
      setReceiptsLoading(false);
    }
  }

  async function loadReceiptDetail(id: string) {
    if (!id) return;
    setReceiptsErr(null);
    try {
      const [detail, verify] = await Promise.all([
        api<LifecycleReceipt>(`/api/receipts/${id}`, "GET"),
        api<ReceiptVerifyResult>(`/api/receipts/verify/${id}`, "GET")
      ]);
      setSelectedReceipt(detail || null);
      setSelectedReceiptVerify(verify || null);
    } catch (e: any) {
      setSelectedReceipt(null);
      setSelectedReceiptVerify(null);
      setReceiptsErr(e?.message || "Failed to load receipt details.");
    }
  }

  React.useEffect(() => {
    if (!receiptsPanelOpen) return;
    void loadReceiptsOverview();
  }, [receiptsPanelOpen]);

  React.useEffect(() => {
    if (!receiptsPanelOpen || !selectedReceiptId) return;
    void loadReceiptDetail(selectedReceiptId);
  }, [receiptsPanelOpen, selectedReceiptId]);

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
      await refreshPublishReadiness();
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
      await refreshPublishReadiness();
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
      await refreshPublishReadiness();
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
      await refreshPublishReadiness();
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
      await refreshPublishReadiness();
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
      await refreshPublishReadiness();
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
      await refreshPublishReadiness();
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
      await refreshPublishReadiness();
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
      await refreshPublishReadiness();
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
      await refreshPublishReadiness();
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
      await refreshPublishReadiness();
    } catch (e: any) {
      setProfileActivationErr(e?.message || "Failed to activate profile.");
    } finally {
      setProfileActivationBusy(false);
    }
  }

  async function savePayoutDestination() {
    setPayoutDestinationMsg(null);
    setPayoutDestinationErr(null);
    setPayoutDestinationSaving(true);
    try {
      const destination = await api<{ ok?: boolean; payoutDestination?: CreatorPayoutDestinationStatus }>(
        "/api/network/payout-destination",
        "POST",
        {
          payoutDestinationType: payoutDestinationTypeInput,
          lightningAddress: payoutDestinationTypeInput === "lightning_address" ? payoutLightningInput.trim() : null,
          onchainAddress: payoutDestinationTypeInput === "onchain_address" ? payoutOnchainInput.trim() : null,
          providerRemitMode: payoutRemitModeInput
        }
      );
      setPayoutDestination(destination?.payoutDestination || null);
      setPayoutDestinationMsg("Payout destination saved.");
      await refreshUserNetworkStatus();
      await refreshPublishReadiness();
    } catch (e: any) {
      setPayoutDestinationErr(e?.message || "Failed to save payout destination.");
      await refreshPayoutDestination();
    } finally {
      setPayoutDestinationSaving(false);
    }
  }

  async function publishProfile() {
    setPublishProfileErr(null);
    setPublishProfileResult(null);
    setPublishProfileBusy(true);
    try {
      const parsedLinks = publishLinks
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const fallbackLink = /^https?:\/\//i.test(summaryCanonicalCommerceUrl) ? [summaryCanonicalCommerceUrl] : [];
      const links = parsedLinks.length ? parsedLinks : fallbackLink;
      const payload: Record<string, any> = {};
      if (publishName.trim()) payload.name = publishName.trim();
      if (publishBio.trim()) payload.bio = publishBio.trim();
      if (links.length) payload.links = links;
      const result = await api<PublishProfileResult>("/api/publish/profile", "POST", payload);
      setPublishProfileResult(result || null);
      await refreshPublishReadiness();
    } catch (e: any) {
      setPublishProfileErr(e?.message || "Failed to publish profile.");
    } finally {
      setPublishProfileBusy(false);
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
      ? "This node can provide BOLT11 invoice infrastructure while creator ownership remains local."
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
  const fallbackVisibilitySummary =
    diagnostics?.publicStatus?.status === "online"
      ? "Direct Link"
      : "Hidden";
  const fallbackPaymentCapabilityLabel =
    paymentMode === "node"
      ? "Sovereign payment rails (local Lightning invoice minting)"
      : "Tips / direct wallet payments";
  const fallbackTunnel = diagnostics?.publicStatus?.mode === "named" || diagnostics?.publicStatus?.mode === "quick";
  const isBasicMode = resolvedNodeMode === "basic";
  const namedTunnelOriginCandidate = String(
    diagnostics?.publicStatus?.canonicalOrigin ||
    diagnostics?.publicStatus?.publicOrigin ||
    diagnostics?.publicStatus?.url ||
    ""
  ).trim();
  const hasDetectedNamedTunnel =
    diagnostics?.publicStatus?.mode === "named" &&
    diagnostics?.publicStatus?.status === "online" &&
    Boolean(namedTunnelOriginCandidate) &&
    !isTemporaryPublicOrigin(namedTunnelOriginCandidate);
  const providerConfigLocked = !hasDetectedNamedTunnel;
  const participationModeFromSummary = networkSummary?.modeProfile?.participationMode;
  const isBasicParticipation =
    participationModeFromSummary !== undefined
      ? participationModeFromSummary === "basic_creator"
      : isBasicMode;
  const isSovereignCreatorMode =
    participationModeFromSummary !== undefined
      ? participationModeFromSummary === "sovereign_creator" || participationModeFromSummary === "sovereign_creator_with_provider"
      : resolvedNodeMode === "advanced";
  const showAdvancedProviderPanels = !isSovereignCreatorMode || showProviderAdvanced;
  const showNetworkDiagnostics = !isBasicParticipation || showBasicDiagnostics;

  const summaryNodeModeLabel =
    networkSummary?.nodeMode === "advanced"
      ? "Sovereign Creator"
      : networkSummary?.nodeMode === "lan"
        ? "Sovereign Node"
        : networkSummary?.nodeMode === "basic"
          ? "Basic Creator"
          : nodeModeLabel;
  const summaryVisibility =
    networkSummary?.visibility === "LISTED"
      ? "Discoverable"
      : networkSummary?.visibility === "UNLISTED"
        ? "Direct Link"
        : networkSummary?.visibility === "DISABLED"
          ? "Hidden"
          : fallbackVisibilitySummary;
  const summaryPaymentCapability = networkSummary
    ? networkSummary.paymentCapability.localInvoiceMinting
      ? "Sovereign payment rails (local Lightning invoice minting)"
      : networkSummary.paymentCapability.delegatedInvoiceSupport
        ? "Delegated invoice infrastructure (provider-assisted)"
        : networkSummary.paymentCapability.tipsOnly
          ? "Tips / direct wallet payments"
          : "Unavailable"
    : fallbackPaymentCapabilityLabel;
  const summaryCanonicalCommerceUrl =
    networkSummary?.reachability?.canonicalCommerceUrl ||
    networkSummary?.reachability?.publicUrl ||
    publicEndpoint;
  const summaryLocalNodeEndpoint =
    networkSummary?.reachability?.localNodeEndpointUrl ||
    networkSummary?.reachability?.publicUrl ||
    publicEndpoint;
  const summaryTemporaryNodeEndpoint = networkSummary?.reachability?.temporaryNodeEndpointUrl || null;
  const summaryCanonicalCommerceKind = networkSummary?.reachability?.canonicalCommerceKind || "unavailable";
  const summaryTunnel = networkSummary ? networkSummary.reachability.tunnel : fallbackTunnel;
  const summaryIpfsEnabled = networkSummary ? networkSummary.reachability.ipfs : false;
  const summaryReachabilityMode = networkSummary
    ? summaryCanonicalCommerceUrl
      ? "Public route available"
      : "No active public route"
    : reachabilityMode;
  const summaryParticipationMode =
    participationModeFromSummary === "basic_creator"
      ? "Basic Creator"
      : participationModeFromSummary === "sovereign_creator_with_provider"
        ? "Sovereign Creator (Provider Commerce)"
        : participationModeFromSummary === "sovereign_creator"
          ? "Sovereign Creator"
          : participationModeFromSummary === "sovereign_node"
            ? "Sovereign Node"
            : summaryNodeModeLabel;
  const summaryStorefrontAuthority =
    (networkSummary?.modeProfile?.hasStablePublicRoute || summaryCanonicalCommerceKind === "self_hosted_stable")
      ? "Creator-hosted (stable named tunnel)"
      : "Creator-hosted (temporary tunnel)";
  const providerCommerceActive = participationModeFromSummary === "sovereign_creator_with_provider";
  const summaryCommerceAuthority = networkSummary?.modeProfile?.localSovereignReady
    ? "Local sovereign commerce"
    : providerCommerceActive
      ? "Connected provider commerce"
      : "Basic tips only";
  const summaryNetworkService = networkSummary
    ? summaryCommerceAuthority === "Local sovereign commerce"
      ? "Local sovereign invoice and commerce services are active on this machine."
      : summaryCommerceAuthority === "Connected provider commerce"
        ? "Provider-backed commerce services are active. Storefront ownership remains creator-hosted."
        : "Basic monetization posture is active (tips / direct wallet). Connect provider or run local node stack to unlock paid commerce."
    : networkService;
  const invoicingService = networkSummary?.providerServices?.invoicing;
  const durableHostingService = networkSummary?.providerServices?.durablePublicHosting;
  const payoutState = payoutDestination || networkSummary?.payoutDestination || null;
  const payoutConfigured = Boolean(payoutState?.valid);
  const payoutDestinationLabel = payoutState?.effectiveDestinationSummary || payoutState?.effectiveDestinationType || "Not configured";
  const payoutRemitModeLabel = payoutState?.providerRemitMode || "manual_payout";
  const providerBackedCommerceReady = Boolean(networkSummary?.paymentCapability?.providerBackedCommerceReady);
  const providerBackedCommerceMessage =
    networkSummary?.paymentCapability?.providerBackedCommerceMessage ||
    (payoutConfigured
      ? "Provider-backed commerce is payout-ready."
      : "Configure payout destination for provider-backed commerce.");
  const runtimeStateLabel =
    runtimeStatus?.runtime?.status === "running"
      ? "Running"
      : runtimeStatus?.runtime?.status === "degraded"
        ? "Degraded"
        : "Stopped";
  const runtimeApiReadyLabel = runtimeStatus?.runtime?.apiReady ? "yes" : "no";
  const runtimeEndpointUrl = runtimeStatus?.endpoint?.url || summaryLocalNodeEndpoint;
  const runtimeEndpointStability =
    runtimeStatus?.endpoint?.stability === "stable"
      ? "Stable"
      : runtimeStatus?.endpoint?.stability === "temporary"
        ? "Temporary"
        : "Unknown";
  const runtimeLastRestart = runtimeStatus?.runtime?.lastRestartAt
    ? new Date(runtimeStatus.runtime.lastRestartAt).toLocaleString()
    : "—";
  const runtimeRestartAvailable = Boolean(runtimeStatus?.restartAvailable);
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
        .map((r) => (r === "provider" ? "provider infrastructure" : "creator identity"))
        .join(" + ")
    : "creator identity";
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
  const publishReadinessLabel =
    publishReadiness?.readiness === "ready"
      ? "Ready"
      : publishReadiness?.readiness === "activation_required"
        ? "Activation required"
        : publishReadiness?.readiness === "network_not_ready"
          ? "Network not ready"
          : "Unknown";
  const hasStablePublicRoute = Boolean(
    networkSummary?.modeProfile?.hasStablePublicRoute || summaryCanonicalCommerceKind === "self_hosted_stable"
  );
  const hasLocalInvoiceMinting = Boolean(
    networkSummary?.modeProfile?.hasLocalInvoiceMinting || networkSummary?.paymentCapability?.localInvoiceMinting
  );
  const needsProviderInvoicing = providerCommerceActive && !hasLocalInvoiceMinting;
  const needsDurablePublicHosting = providerCommerceActive && !hasStablePublicRoute;
  const supportsAutoForward = Boolean(payoutConfigured && payoutState?.effectiveDestinationType === "lightning_address");
  const usingManualWhenAutoAvailable = supportsAutoForward && payoutRemitModeLabel === "manual_payout";
  type GuardLevel = "ready" | "warn" | "block";
  const commerceGuardLevel: GuardLevel =
    needsProviderInvoicing && !payoutConfigured
      ? "block"
      : usingManualWhenAutoAvailable ||
          (needsDurablePublicHosting && durableHostingService?.mode === "provider_backed") ||
          (needsProviderInvoicing && invoicingService?.mode === "provider_backed")
        ? "warn"
        : "ready";
  const commerceGuardMessage =
    !providerCommerceActive
      ? "Basic monetization posture is active for this mode. Connect provider commerce or run local sovereign node to enable paid commerce."
    : commerceGuardLevel === "block"
      ? "Configure a valid creator payout destination before provider-backed commerce can run safely."
      : usingManualWhenAutoAvailable
        ? "Manual payout is active. Auto-forward is available and recommended to complete payout automatically."
        : commerceGuardLevel === "warn"
          ? "Provider-backed fallback is active and valid. You can self-provide capabilities later to reduce provider fees."
          : "Commerce path is fully configured for this mode.";
  const payoutStatusVocabulary = {
    pending: "Pending payout",
    forwarding: "Forwarding payout",
    paid: "Paid out",
    failed: "Payout failed"
  };
  const modeDelineationLabel = summaryParticipationMode;
  const nextStepLabel =
    participationModeFromSummary === "sovereign_node"
      ? "Sovereign Node is active."
      : participationModeFromSummary === "sovereign_creator_with_provider"
        ? "Next step: run local BTC/LND + invoice stack to upgrade to Sovereign Node."
        : participationModeFromSummary === "sovereign_creator"
          ? "Next step: connect a commerce provider or run local node stack."
          : networkSummary?.modeProfile?.providerConnected
            ? "Provider is connected. Next step: switch to Sovereign Creator to activate provider commerce."
          : "Next step: bring named tunnel online to unlock Sovereign Creator.";
  const guardPillClass =
    commerceGuardLevel === "ready"
      ? "border-emerald-800/70 bg-emerald-900/20 text-emerald-300"
      : commerceGuardLevel === "warn"
        ? "border-amber-800/70 bg-amber-900/20 text-amber-300"
        : "border-rose-800/70 bg-rose-900/20 text-rose-300";

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
              <span className="text-neutral-500">Participation</span>
              <span className="text-neutral-200 text-right">{summaryParticipationMode}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Storefront authority</span>
              <span className="text-neutral-200 text-right">{summaryStorefrontAuthority}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Commerce authority</span>
              <span className="text-neutral-200 text-right">{summaryCommerceAuthority}</span>
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
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 md:col-span-2">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Mode Summary</div>
            <div className="mt-1 text-sm text-neutral-200">Mode: {modeDelineationLabel}</div>
            <div className="mt-2">
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${guardPillClass}`}>
                {commerceGuardLevel === "ready" ? "ready" : commerceGuardLevel === "warn" ? "warn" : "block"}
              </span>
              <span className="ml-2 text-xs text-neutral-400">{commerceGuardMessage}</span>
            </div>
            <div className="mt-2 grid gap-1 text-xs text-neutral-300">
              <div>Storefront authority: {summaryStorefrontAuthority}</div>
              <div>Commerce authority: {summaryCommerceAuthority}</div>
              <div>Payout destination: {payoutDestinationLabel}</div>
              <div>{nextStepLabel}</div>
            </div>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Identity</div>
            <div className="mt-1 text-sm text-neutral-200">Certifyd Creator Profile</div>
            <div className="text-xs text-neutral-400 mt-1">Profile type: {summaryParticipationMode}</div>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Payment Capability</div>
            <div className="mt-1 text-sm text-neutral-200">{summaryPaymentCapability}</div>
            <div className="text-xs text-neutral-400 mt-1">{summaryNetworkService}</div>
            {providerCommerceActive ? (
              <div className="text-xs text-neutral-500 mt-1">
                Provider infrastructure executes invoicing/settlement while creator identity, entitlement truth, and sale history remain creator-owned.
              </div>
            ) : null}
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Reachability</div>
            <div className="mt-1 text-sm text-neutral-200">{summaryReachabilityMode}</div>
            <div className="text-xs text-neutral-400 mt-1">
              Canonical public commerce URL:
              <span className="text-neutral-300 break-all"> {summaryCanonicalCommerceUrl || "—"}</span>
            </div>
            <div className="text-xs text-neutral-500 mt-1">
              Canonical route: <span className="text-neutral-300">{summaryCanonicalCommerceKind.replace(/_/g, " ")}</span>
            </div>
            <div className="text-xs text-neutral-500 mt-1">
              Local node endpoint: <span className="text-neutral-300 break-all">{summaryLocalNodeEndpoint || "—"}</span>
            </div>
            {summaryTemporaryNodeEndpoint ? (
              <div className="text-xs text-amber-300 mt-1 break-all">
                Temporary node endpoint: {summaryTemporaryNodeEndpoint}
              </div>
            ) : null}
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

        {isBasicParticipation ? (
          <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Basic Mode Focus</div>
            <div className="mt-2 grid gap-2 text-xs">
              <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
                <span className="text-neutral-500">Public page</span>
                <span className="text-neutral-200 text-right break-all">{publicEndpoint}</span>
              </div>
              <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
                <span className="text-neutral-500">Reachability</span>
                <span className="text-neutral-200 text-right">{discoverability}</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-neutral-500">Payments</span>
                <span className="text-neutral-200 text-right">Tips by default</span>
              </div>
            </div>
            <div className="mt-3">
              <button
                onClick={() => setShowBasicDiagnostics((v) => !v)}
                className="rounded-lg border border-neutral-800 px-3 py-2 text-xs hover:bg-neutral-900"
              >
                {showBasicDiagnostics ? "Hide advanced diagnostics" : "Show advanced diagnostics"}
              </button>
            </div>
          </div>
        ) : null}

        {showNetworkDiagnostics ? (
        <>
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
            <div className="flex items-start justify-between gap-3 border-t border-neutral-900 pt-2">
              <span className="text-neutral-500">Publish readiness</span>
              <span className="text-neutral-200 text-right">{publishReadinessLabel}</span>
            </div>
            <div className="text-neutral-400">{publishReadiness?.message || "Publish readiness unavailable."}</div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Creator Payout Destination</div>
          <div className="mt-2 grid gap-2 text-xs">
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Configured</span>
              <span className="text-neutral-200 text-right">{payoutConfigured ? "yes" : "no"}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Payout destination</span>
              <span className="text-neutral-200 text-right break-all">{payoutDestinationLabel}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Provider remittance mode</span>
              <span className="text-neutral-200 text-right">{payoutRemitModeLabel}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Provider-backed commerce readiness</span>
              <span className={`text-right ${providerBackedCommerceReady ? "text-emerald-300" : "text-amber-300"}`}>
                {providerBackedCommerceReady ? "Ready" : "Action required"}
              </span>
            </div>
            <div className="text-neutral-400">{providerBackedCommerceMessage}</div>
            <div className="text-neutral-400">{payoutState?.message || "Set where creator net should be remitted when provider collects payment."}</div>
            <div className="text-neutral-500">
              Payout state wording: {payoutStatusVocabulary.pending} / {payoutStatusVocabulary.forwarding} / {payoutStatusVocabulary.paid} / {payoutStatusVocabulary.failed}
            </div>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <label className="text-xs text-neutral-400">
              Payout destination
              <select
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200"
                value={payoutDestinationTypeInput}
                onChange={(e) => setPayoutDestinationTypeInput(e.target.value as any)}
              >
                <option value="lightning_address">Lightning Address</option>
                <option value="onchain_address">On-chain address</option>
                <option value="local_lnd">Local Lightning node</option>
              </select>
            </label>
            <label className="text-xs text-neutral-400">
              Provider remittance
              <select
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200"
                value={payoutRemitModeInput}
                onChange={(e) => setPayoutRemitModeInput(e.target.value as any)}
              >
                <option value="manual_payout">Manual payout</option>
                <option value="auto_forward">Auto-forward</option>
                <option value="provider_custody">Provider custody</option>
              </select>
            </label>
            <label className="text-xs text-neutral-400 md:col-span-2">
              Lightning Address
              <input
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200"
                value={payoutLightningInput}
                onChange={(e) => setPayoutLightningInput(e.target.value)}
                placeholder="creator@domain.com"
                disabled={payoutDestinationTypeInput !== "lightning_address"}
              />
            </label>
            <label className="text-xs text-neutral-400 md:col-span-2">
              On-chain address
              <input
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200"
                value={payoutOnchainInput}
                onChange={(e) => setPayoutOnchainInput(e.target.value)}
                placeholder="bc1..."
                disabled={payoutDestinationTypeInput !== "onchain_address"}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={savePayoutDestination}
              disabled={payoutDestinationSaving}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-900 disabled:opacity-60"
            >
              {payoutDestinationSaving ? "Saving..." : "Save payout destination"}
            </button>
            {payoutDestinationMsg ? <span className="text-xs text-emerald-300">{payoutDestinationMsg}</span> : null}
            {payoutDestinationErr ? <span className="text-xs text-rose-300">{payoutDestinationErr}</span> : null}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Payment Flow</div>
          <div className="mt-2 grid gap-1 text-xs text-neutral-300">
            <div>1. Buyer pays</div>
            <div>2. Provider settles</div>
            <div>3. Provider fee retained</div>
            <div>4. Creator net calculated</div>
            <div>5. Creator payout sent</div>
            <div>6. Payout status updated</div>
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
        </>
        ) : null}

        {isBasicParticipation ? (
          <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Provider Configuration</div>
            <div className="mt-1 text-xs text-neutral-400">
              Basic mode keeps provider configuration hidden. Add a named tunnel and switch out of Basic to enable provider commerce services.
            </div>
          </div>
        ) : (
        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Provider Configuration</div>
          <div className="mt-1 text-xs text-neutral-400">
            Configure a trusted provider node for delegated invoice infrastructure. This config does not transfer creator identity, ownership, entitlement truth, or sale history to the provider.
          </div>
          {providerConfigLocked ? (
            <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Named tunnel required before provider configuration. Bring a named tunnel online first.
            </div>
          ) : null}
          {isSovereignCreatorMode ? (
            <div className="mt-3 rounded-lg border border-neutral-800/80 bg-neutral-950/70 px-3 py-2">
              <div className="text-xs text-neutral-300">
                Sovereign Creator only needs provider connection details by default. Protocol verification and post-ready controls are in Advanced.
              </div>
              <button
                onClick={() => setShowProviderAdvanced((v) => !v)}
                className="mt-2 rounded-lg border border-neutral-800 px-3 py-1.5 text-xs hover:bg-neutral-900"
              >
                {showProviderAdvanced ? "Hide advanced provider controls" : "Show advanced provider controls"}
              </button>
            </div>
          ) : null}
          {showAdvancedProviderPanels ? (
          <>
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
                disabled={providerConfigLocked || providerLoading || providerSaving || guidedSetupBusy || !providerConfig}
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
                disabled={providerConfigLocked || profileActivationBusy || userNetworkStatus?.status !== "ready"}
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
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Publish</div>
            <div className="mt-1 text-xs text-neutral-200">Publish profile</div>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <input
                value={publishName}
                onChange={(e) => setPublishName(e.target.value)}
                placeholder="Name (optional)"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs"
                autoComplete="off"
              />
              <input
                value={publishBio}
                onChange={(e) => setPublishBio(e.target.value)}
                placeholder="Bio (optional)"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs"
                autoComplete="off"
              />
              <input
                value={publishLinks}
                onChange={(e) => setPublishLinks(e.target.value)}
                placeholder="Links comma-separated (optional)"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs"
                autoComplete="off"
              />
            </div>
            <div className="mt-2 text-xs text-neutral-500">
              If links are empty, publish uses the canonical public commerce URL when available.
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={publishProfile}
                disabled={providerConfigLocked || publishProfileBusy || publishReadiness?.allowed === false}
                className="rounded-lg border border-neutral-800 px-3 py-2 text-xs hover:bg-neutral-900 disabled:opacity-50"
                title={publishReadiness?.allowed === false ? publishReadiness.message : undefined}
              >
                {publishProfileBusy ? "Publishing..." : "Publish profile"}
              </button>
              {publishProfileResult ? <div className="text-xs text-emerald-300">{publishProfileResult.message}</div> : null}
              {publishProfileErr ? <div className="text-xs text-rose-300">{publishProfileErr}</div> : null}
            </div>
            <div className="mt-2 grid gap-1 text-xs text-neutral-400">
              <div>Status: <span className="text-neutral-300">{publishProfileResult?.status || "—"}</span></div>
              <div>Publish ID: <span className="text-neutral-300 break-all">{publishProfileResult?.publishId || "—"}</span></div>
              <div>Published at: <span className="text-neutral-300">{publishProfileResult?.publishedAt ? new Date(publishProfileResult.publishedAt).toLocaleString() : "—"}</span></div>
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
                disabled={providerConfigLocked || providerHandshakeLoading}
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
                disabled={providerConfigLocked || providerAckLoading}
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
                disabled={providerConfigLocked || providerOperationLoading}
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
                disabled={providerConfigLocked || providerExecuteTestLoading}
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
          <div className="mt-3 rounded-lg border border-neutral-800/80 bg-neutral-950/70 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Receipts Debug Panel</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setReceiptsPanelOpen((v) => !v)}
                  className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900"
                >
                  {receiptsPanelOpen ? "Hide" : "Show"}
                </button>
                {receiptsPanelOpen ? (
                  <button
                    onClick={() => void loadReceiptsOverview()}
                    disabled={receiptsLoading}
                    className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-50"
                  >
                    {receiptsLoading ? "Refreshing..." : "Refresh"}
                  </button>
                ) : null}
              </div>
            </div>
            {receiptsPanelOpen ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-lg border border-neutral-800 bg-neutral-950/80 px-3 py-2">
                  <div className="text-xs text-neutral-300">Receipt Summary</div>
                  <div className="mt-2 grid gap-1 text-xs text-neutral-400">
                    <div>Total Receipts: <span className="text-neutral-300">{receiptsSummary?.totalReceiptCount ?? "—"}</span></div>
                    <div>Latest Acknowledgment: <span className="text-neutral-300 break-all">{receiptsSummary?.latestAcknowledgmentReceipt?.id || "—"}</span></div>
                    <div>Latest Permit: <span className="text-neutral-300 break-all">{receiptsSummary?.latestPermitReceipt?.id || "—"}</span></div>
                    <div>Latest Activation: <span className="text-neutral-300 break-all">{receiptsSummary?.latestActivationReceipt?.id || "—"}</span></div>
                    <div>Latest Publish: <span className="text-neutral-300 break-all">{receiptsSummary?.latestPublishReceipt?.id || "—"}</span></div>
                    <div>Latest Content Publish: <span className="text-neutral-300 break-all">{receiptsSummary?.latestContentPublishReceipt?.id || "—"}</span></div>
                  </div>
                </div>

                <div className="rounded-lg border border-neutral-800 bg-neutral-950/80 px-3 py-2">
                  <div className="text-xs text-neutral-300">Recent Receipts</div>
                  <div className="mt-2 overflow-auto">
                    <table className="w-full min-w-[760px] text-xs">
                      <thead className="text-neutral-500">
                        <tr>
                          <th className="text-left font-normal py-1 pr-3">Type</th>
                          <th className="text-left font-normal py-1 pr-3">Created</th>
                          <th className="text-left font-normal py-1 pr-3">ID</th>
                          <th className="text-left font-normal py-1 pr-3">Object</th>
                          <th className="text-left font-normal py-1">Provider Node ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {receiptsRecent.map((r) => (
                          <tr
                            key={r.id}
                            className={`border-t border-neutral-900 cursor-pointer hover:bg-neutral-900/40 ${selectedReceiptId === r.id ? "bg-neutral-900/50" : ""}`}
                            onClick={() => setSelectedReceiptId(r.id)}
                          >
                            <td className="py-1 pr-3 text-neutral-300">{r.type}</td>
                            <td className="py-1 pr-3 text-neutral-300">{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</td>
                            <td className="py-1 pr-3 text-neutral-300 break-all">{r.id}</td>
                            <td className="py-1 pr-3 text-neutral-300 break-all">{r.objectId || "—"}</td>
                            <td className="py-1 text-neutral-300 break-all">{r.providerNodeId || "—"}</td>
                          </tr>
                        ))}
                        {receiptsRecent.length === 0 ? (
                          <tr className="border-t border-neutral-900">
                            <td className="py-2 text-neutral-500" colSpan={5}>No receipts found.</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-lg border border-neutral-800 bg-neutral-950/80 px-3 py-2">
                  <div className="text-xs text-neutral-300">Receipt Details</div>
                  <div className="mt-2 grid gap-1 text-xs text-neutral-400">
                    <div>ID: <span className="text-neutral-300 break-all">{selectedReceipt?.id || "—"}</span></div>
                    <div>Type: <span className="text-neutral-300">{selectedReceipt?.type || "—"}</span></div>
                    <div>Created: <span className="text-neutral-300">{selectedReceipt?.createdAt ? new Date(selectedReceipt.createdAt).toLocaleString() : "—"}</span></div>
                    <div>Object ID: <span className="text-neutral-300 break-all">{selectedReceipt?.objectId || "—"}</span></div>
                    <div>Provider Node ID: <span className="text-neutral-300 break-all">{selectedReceipt?.providerNodeId || "—"}</span></div>
                    <div>Prev Receipt ID: <span className="text-neutral-300 break-all">{selectedReceipt?.prevReceiptId || "—"}</span></div>
                    <div>Payload Hash: <span className="text-neutral-300 break-all">{selectedReceipt?.payloadHash || "—"}</span></div>
                    <div>Signatures: <span className="text-neutral-300">{selectedReceipt?.signatures?.length ?? "—"}</span></div>
                  </div>
                  <div className="mt-3 text-xs text-neutral-300">Verification</div>
                  <div className="mt-1 grid gap-1 text-xs text-neutral-400">
                    <div>
                      exists:{" "}
                      <span className={selectedReceiptVerify?.exists ? "text-emerald-300" : "text-rose-300"}>
                        {selectedReceiptVerify ? (selectedReceiptVerify.exists ? "true" : "false") : "—"}
                      </span>
                    </div>
                    <div>
                      hashValid:{" "}
                      <span className={selectedReceiptVerify?.hashValid ? "text-emerald-300" : "text-rose-300"}>
                        {selectedReceiptVerify ? (selectedReceiptVerify.hashValid ? "true" : "false") : "—"}
                      </span>
                    </div>
                    <div>
                      structuralValid:{" "}
                      <span className={selectedReceiptVerify?.structuralValid ? "text-emerald-300" : "text-rose-300"}>
                        {selectedReceiptVerify ? (selectedReceiptVerify.structuralValid ? "true" : "false") : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-neutral-300">Payload</div>
                  <pre className="mt-1 max-h-56 overflow-auto rounded border border-neutral-800 bg-neutral-950 p-2 text-[11px] text-neutral-300">
                    {selectedReceipt ? JSON.stringify(selectedReceipt.payload, null, 2) : "—"}
                  </pre>
                </div>
              </div>
            ) : null}
            {receiptsErr ? <div className="mt-2 text-xs text-rose-300">{receiptsErr}</div> : null}
          </div>
          </>
          ) : null}
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
                disabled={providerConfigLocked || providerLoading || providerSaving}
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
                disabled={providerConfigLocked || providerLoading || providerSaving}
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
                disabled={providerConfigLocked || providerLoading || providerSaving}
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
                disabled={providerConfigLocked || providerLoading || providerSaving}
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
              disabled={providerConfigLocked || providerLoading || providerSaving}
            />
            Enabled
          </label>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={saveProviderConfig}
              disabled={providerConfigLocked || providerLoading || providerSaving || !providerConfig}
              className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900 disabled:opacity-50"
            >
              {providerSaving ? "Saving..." : "Save provider"}
            </button>
            {providerMsg ? <div className="text-xs text-emerald-300">{providerMsg}</div> : null}
            {providerErr ? <div className="text-xs text-rose-300">{providerErr}</div> : null}
          </div>
        </div>
        )}

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
