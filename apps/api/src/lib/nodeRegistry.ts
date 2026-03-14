export type NodeKind = "provider" | "sovereign_creator";
export type NodeStability = "stable" | "temporary";
export type EndpointKind = "quick" | "named" | "custom" | "unknown";

export type CertifydNodeDescriptor = {
  nodeId: string | null;
  nodeKind: NodeKind;
  endpointUrl: string | null;
  endpointKind: EndpointKind;
  stability: NodeStability;
  canonicalCommerceOrigin: string | null;
  canonicalCommerceKind:
    | "provider_hosted"
    | "self_hosted_stable"
    | "temporary_endpoint"
    | "unavailable";
  commerceCapable: boolean;
  replayCapable: boolean;
  settlementCapable: boolean;
  publicKey: string | null;
  displayName: string | null;
  brandLabel: string | null;
};

export function classifyEndpointStability(input: {
  endpointUrl: string | null | undefined;
  endpointKind?: EndpointKind;
}): NodeStability {
  const kind = input.endpointKind || "unknown";
  const endpointUrl = String(input.endpointUrl || "").trim();
  if (!endpointUrl) return "temporary";
  if (kind === "quick") return "temporary";
  if (kind === "named") return "stable";
  try {
    const u = new URL(endpointUrl);
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") return "temporary";
    if (host.endsWith(".trycloudflare.com")) return "temporary";
    if (host.startsWith("10.") || host.startsWith("192.168.")) return "temporary";
    const private172 = host.match(/^172\.(\d+)\./);
    if (private172) {
      const seg = Number(private172[1]);
      if (seg >= 16 && seg <= 31) return "temporary";
    }
    return "stable";
  } catch {
    return "temporary";
  }
}

export function isStableNode(node: CertifydNodeDescriptor): boolean {
  return node.stability === "stable" && Boolean(node.endpointUrl);
}

export function canActAsCommerceHost(node: CertifydNodeDescriptor): boolean {
  if (!isStableNode(node)) return false;
  if (!node.canonicalCommerceOrigin) return false;
  if (node.nodeKind === "provider") return node.settlementCapable;
  return node.settlementCapable && node.replayCapable;
}

export function canJoinNetworkAsNode(node: CertifydNodeDescriptor): boolean {
  if (!isStableNode(node)) return false;
  return canActAsCommerceHost(node);
}

