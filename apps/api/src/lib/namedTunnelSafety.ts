export type CloudflaredTunnel = {
  id?: unknown;
  name?: unknown;
  connections?: unknown;
};

export function normalizeTunnelIdentity(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Resolve only the configured tunnel name or UUID. Ambiguous matches are unsafe. */
export function findExactConfiguredTunnel(
  tunnels: readonly CloudflaredTunnel[],
  configuredIdentity: string
): CloudflaredTunnel | null {
  const wanted = normalizeTunnelIdentity(configuredIdentity);
  if (!wanted) return null;
  const matches = tunnels.filter((tunnel) => {
    const name = normalizeTunnelIdentity(tunnel?.name);
    const id = normalizeTunnelIdentity(tunnel?.id);
    return name === wanted || id === wanted;
  });
  return matches.length === 1 ? matches[0] : null;
}

export function namedConfigurationCacheKey(input: {
  provider?: unknown;
  tunnelName?: unknown;
  publicOrigin?: unknown;
  disabled?: boolean;
}): string {
  return JSON.stringify({
    provider: normalizeTunnelIdentity(input.provider),
    tunnelName: normalizeTunnelIdentity(input.tunnelName),
    publicOrigin: String(input.publicOrigin ?? "").trim().replace(/\/+$/, "").toLowerCase(),
    disabled: Boolean(input.disabled)
  });
}

function decodeConnectorTokenTunnelId(token: string): string | null {
  try {
    const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
    const value = decoded?.t ?? decoded?.tunnelID ?? decoded?.tunnelId;
    return value ? normalizeTunnelIdentity(value) : null;
  } catch {
    return null;
  }
}

export function commandLineMatchesConfiguredTunnel(commandLine: string, configuredIdentities: readonly string[]): boolean {
  const identities = new Set(configuredIdentities.map(normalizeTunnelIdentity).filter(Boolean));
  if (!identities.size) return false;
  const line = String(commandLine || "");
  const words = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((word) => word.replace(/^['"]|['"]$/g, "")) || [];
  for (let index = 0; index < words.length; index += 1) {
    const word = normalizeTunnelIdentity(words[index]);
    if (identities.has(word)) return true;
    if (word === "--token" && index + 1 < words.length) {
      const tokenTunnelId = decodeConnectorTokenTunnelId(words[index + 1]);
      if (tokenTunnelId && identities.has(tokenTunnelId)) return true;
    }
    if (word.startsWith("--token=")) {
      const tokenTunnelId = decodeConnectorTokenTunnelId(words[index].slice("--token=".length));
      if (tokenTunnelId && identities.has(tokenTunnelId)) return true;
    }
  }
  return false;
}

export type NamedControlOwnership = "app-managed" | "service-external" | "unknown";

export function classifyNamedControlOwnership(input: {
  configuredIdentities: readonly string[];
  ownedPid?: number | null;
  processes: readonly { pid?: number | null; commandLine: string; serviceManaged?: boolean }[];
}): NamedControlOwnership {
  const matching = input.processes.filter((process) =>
    commandLineMatchesConfiguredTunnel(process.commandLine, input.configuredIdentities)
  );
  if (input.ownedPid && matching.some((process) => process.pid === input.ownedPid)) return "app-managed";
  if (matching.some((process) => process.serviceManaged || process.pid !== input.ownedPid)) return "service-external";
  return "unknown";
}
