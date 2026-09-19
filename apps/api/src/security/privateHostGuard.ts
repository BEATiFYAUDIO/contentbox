import net from "node:net";
import { isPublicRouteAllowed } from "./publicRoutePolicy.js";

function asString(x: unknown): string {
  return typeof x === "string" ? x : String(x ?? "");
}

export function normalizePrivateRequestHost(value: unknown): string | null {
  const raw = asString(value).split(",")[0]?.trim().toLowerCase() || "";
  if (!raw) return null;

  let host = raw;
  if (raw.startsWith("[")) {
    const close = raw.indexOf("]");
    if (close <= 1) return null;
    host = raw.slice(1, close);
    const rest = raw.slice(close + 1);
    if (rest && !/^:\d+$/.test(rest)) return null;
  } else {
    const colonCount = (raw.match(/:/g) || []).length;
    if (colonCount === 1) {
      const [name, port] = raw.split(":");
      if (!name || !/^\d+$/.test(port || "")) return null;
      host = name;
    } else if (colonCount > 1) {
      host = raw;
    }
  }

  if (!host || host.includes("/") || /\s/.test(host)) return null;
  if (net.isIP(host)) return host;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  if (host.startsWith(".") || host.endsWith(".") || host.includes("..")) return null;
  return host;
}

export function normalizePrivateRequestHostFromHeaders(headers: Record<string, unknown> | undefined): string | null {
  return normalizePrivateRequestHost(headers?.["x-forwarded-host"] || headers?.host || "");
}

export function isLoopbackPrivateHost(host: string | null | undefined): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function parsePrivateAllowedHosts(value: unknown): Set<string> {
  const out = new Set<string>();
  for (const entry of asString(value).split(",")) {
    const host = normalizePrivateRequestHost(entry);
    if (host) out.add(host);
  }
  return out;
}

export function isPrivateAllowedHost(host: string | null | undefined, allowlistValue: unknown): boolean {
  if (!host) return false;
  return parsePrivateAllowedHosts(allowlistValue).has(host);
}

export function shouldBlockPrivateHostRequest(input: {
  method: unknown;
  pathOrUrl: unknown;
  host: unknown;
  privateAllowedHosts?: unknown;
  allowAnyPublicHost?: unknown;
}): boolean {
  const host = normalizePrivateRequestHost(input.host);
  if (!host) return true;
  if (isLoopbackPrivateHost(host)) return false;
  if (isPrivateAllowedHost(host, input.privateAllowedHosts)) return false;
  if (String(input.allowAnyPublicHost || "") === "1") return false;
  return !isPublicRouteAllowed(asString(input.method || "GET"), asString(input.pathOrUrl || "/"));
}
