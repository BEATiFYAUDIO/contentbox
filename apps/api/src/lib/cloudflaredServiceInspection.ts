export type CloudflaredServiceRecord = {
  platform: "win32" | "linux" | "darwin";
  name: string;
  state: "running" | "stopped" | "unknown";
  pid: number | null;
  commandLine: string;
};

const parsePid = (value: unknown): number | null => {
  const pid = Number(String(value ?? "").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
};

/** Parse the delimiter-safe output emitted by the bounded Win32_Service query. */
export function parseWindowsCloudflaredServices(output: string): CloudflaredServiceRecord[] {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [name = "", state = "", pid = "", ...pathParts] = line.split("|");
      const commandLine = pathParts.join("|").trim();
      if (!/cloudflared/i.test(`${name} ${commandLine}`)) return [];
      return [{
        platform: "win32" as const,
        name: name.trim() || "cloudflared",
        state: /^running$/i.test(state.trim()) ? "running" as const : /^stopped$/i.test(state.trim()) ? "stopped" as const : "unknown" as const,
        pid: parsePid(pid),
        commandLine
      }];
    });
}

/** Parse `systemctl show` output for the cloudflared unit. */
export function parseLinuxCloudflaredService(output: string): CloudflaredServiceRecord[] {
  const values = new Map<string, string>();
  for (const line of String(output || "").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0) values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  if (!values.size || values.get("LoadState") === "not-found") return [];
  const commandLine = values.get("ExecStart") || "";
  return [{
    platform: "linux",
    name: values.get("Id") || "cloudflared.service",
    state: values.get("ActiveState") === "active" ? "running" : values.get("ActiveState") === "inactive" ? "stopped" : "unknown",
    pid: parsePid(values.get("MainPID")),
    commandLine
  }];
}

/** Parse `launchctl list` rows and keep only Cloudflare tunnel jobs. */
export function parseMacCloudflaredServices(output: string): CloudflaredServiceRecord[] {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /cloudflared/i.test(line))
    .map((line) => {
      const parts = line.split(/\s+/);
      const label = parts.at(-1) || "cloudflared";
      return {
        platform: "darwin" as const,
        name: label,
        state: parsePid(parts[0]) ? "running" as const : "unknown" as const,
        pid: parsePid(parts[0]),
        commandLine: label
      };
    });
}

export function serviceInspectionSummary(records: readonly CloudflaredServiceRecord[]) {
  const running = records.filter((record) => record.state === "running");
  return {
    serviceDetected: records.length > 0,
    serviceRunning: running.length > 0,
    serviceCount: records.length,
    runningServiceCount: running.length,
    servicePids: running.map((record) => record.pid).filter((pid): pid is number => Boolean(pid))
  };
}

export function evaluateNamedRouteEvidence(input: {
  identityConnected: boolean;
  externalServiceRunning: boolean;
  routeReachable: boolean;
  routeMatchesThisCore: boolean;
  localListenerReady: boolean;
}) {
  const connected = input.identityConnected || (input.externalServiceRunning && input.routeMatchesThisCore);
  const online = connected && input.routeMatchesThisCore;
  const reason = online
    ? input.identityConnected
      ? "identity_verified"
      : "external_service_route_verified"
    : input.routeReachable && !input.routeMatchesThisCore
      ? "route_points_to_different_core"
      : input.externalServiceRunning
        ? "external_service_route_offline"
        : input.identityConnected && !input.localListenerReady
          ? "public_listener_offline"
          : input.identityConnected
            ? "durable_route_offline"
          : "identity_unavailable";
  return { connected, online, reason };
}
