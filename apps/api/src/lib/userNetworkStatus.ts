export type NetworkStatus = "ready" | "connecting" | "action_required" | "offline";
export type NetworkStatusTitle = "Ready" | "Connecting" | "Action Required" | "Offline";

export type UserNetworkStatusReason =
  | "runtime_not_ready"
  | "sovereign_node_ready"
  | "sovereign_public_origin_missing"
  | "sovereign_local_stack_missing"
  | "sovereign_creator_ready"
  | "basic_creator_ready"
  | "provider_unreachable"
  | "provider_ready"
  | "provider_setup_in_progress"
  | "provider_setup_blocked"
  | "provider_setup_connecting";

export type UserNetworkStatus = {
  status: NetworkStatus;
  title: NetworkStatusTitle;
  message: string;
  actionLabel: string | null;
  reason: UserNetworkStatusReason;
};

export type UserNetworkStatusInput = {
  runtimeReady: boolean;
  participationMode: "basic_creator" | "sovereign_creator" | "sovereign_creator_with_provider" | "sovereign_node";
  nodeMode: "basic" | "advanced" | "lan";
  sovereignReady: boolean;
  namedTunnelDetected: boolean;
  localBitcoinReady: boolean;
  localLndReady: boolean;
  localCommerceReady: boolean;
  trustReadiness: "ready" | "not_configured" | "blocked" | "unreachable";
  ackReadiness: "ready" | "not_configured" | "blocked" | "not_current";
  permitReadiness: "ready" | "not_configured" | "blocked" | "not_current" | "expired";
  chainReady: boolean;
  chainMessage: string;
  ackMessage: string;
  permitMessage: string;
};

export function deriveUserNetworkStatusFromState(input: UserNetworkStatusInput): UserNetworkStatus {
  if (!input.runtimeReady) {
    return {
      status: "offline",
      title: "Offline",
      message: "Node runtime is not ready.",
      actionLabel: "Restart node",
      reason: "runtime_not_ready"
    };
  }
  if (input.participationMode === "sovereign_node" || (input.nodeMode === "lan" && input.sovereignReady)) {
    return {
      status: "ready",
      title: "Ready",
      message: "Local Sovereign Node posture is active and ready.",
      actionLabel: null,
      reason: "sovereign_node_ready"
    };
  }
  if (input.nodeMode === "lan" && !input.sovereignReady) {
    if (!input.namedTunnelDetected) {
      return {
        status: "action_required",
        title: "Action Required",
        message: "Sovereign Node requires a canonical public origin with a stable host route.",
        actionLabel: "Configure canonical public origin",
        reason: "sovereign_public_origin_missing"
      };
    }
    const blockers: string[] = [];
    if (!input.localBitcoinReady) blockers.push("local Bitcoin");
    if (!input.localLndReady) blockers.push("local LND");
    if (!input.localCommerceReady) blockers.push("local commerce service");
    return {
      status: "action_required",
      title: "Action Required",
      message: `Sovereign Node is missing readiness: ${blockers.join(", ")}.`,
      actionLabel: "Fix local node stack",
      reason: "sovereign_local_stack_missing"
    };
  }
  if (input.participationMode === "sovereign_creator") {
    return {
      status: "ready",
      title: "Ready",
      message: "Sovereign Creator storefront is active. Provider commerce is optional.",
      actionLabel: "Connect provider (optional)",
      reason: "sovereign_creator_ready"
    };
  }
  if (input.participationMode === "basic_creator") {
    return {
      status: "ready",
      title: "Ready",
      message: "Basic creator posture is active for publishing and tipping.",
      actionLabel: "Add canonical public origin to upgrade",
      reason: "basic_creator_ready"
    };
  }
  if (input.trustReadiness === "unreachable") {
    return {
      status: "offline",
      title: "Offline",
      message: "Configured provider is currently unreachable.",
      actionLabel: "Check provider reachability",
      reason: "provider_unreachable"
    };
  }
  if (input.chainReady) {
    return {
      status: "ready",
      title: "Ready",
      message: "Connected to provider and ready to use.",
      actionLabel: null,
      reason: "provider_ready"
    };
  }
  if (
    input.trustReadiness === "not_configured" ||
    input.ackReadiness === "not_configured" ||
    input.permitReadiness === "not_configured"
  ) {
    return {
      status: "connecting",
      title: "Connecting",
      message: "Provider relationship setup is still in progress.",
      actionLabel: "Configure provider",
      reason: "provider_setup_in_progress"
    };
  }
  if (
    input.ackReadiness === "not_current" ||
    input.permitReadiness === "not_current" ||
    input.permitReadiness === "expired" ||
    input.trustReadiness === "blocked" ||
    input.ackReadiness === "blocked" ||
    input.permitReadiness === "blocked"
  ) {
    const detail =
      input.permitReadiness === "expired"
        ? input.permitMessage
        : input.permitReadiness === "not_current"
          ? input.permitMessage
          : input.ackReadiness === "not_current"
            ? input.ackMessage
            : input.chainMessage;
    return {
      status: "action_required",
      title: "Action Required",
      message: detail,
      actionLabel: "Refresh provider connection",
      reason: "provider_setup_blocked"
    };
  }
  return {
    status: "connecting",
    title: "Connecting",
    message: "Establishing provider relationship prerequisites.",
    actionLabel: "Refresh connection",
    reason: "provider_setup_connecting"
  };
}

export function deriveActivationStatusMessageFromNetwork(status: UserNetworkStatus): string {
  if (status.status === "ready") {
    return "Setup is ready. Activate profile when you are ready to publish network profile state.";
  }
  return status.message || "Network prerequisites are not ready.";
}
