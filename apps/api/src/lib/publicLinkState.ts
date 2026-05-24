import fs from "node:fs";
import path from "node:path";
import { getPublicOriginConfig } from "./publicOriginStore.js";
import { resolveContentboxRoot } from "./contentboxRoot.js";

const CONTENTBOX_ROOT = resolveContentboxRoot();
const STATE_FILE = path.join(CONTENTBOX_ROOT, "state.json");

function readStateFlag(): boolean {
  try {
    if (!fs.existsSync(STATE_FILE)) return false;
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const json = JSON.parse(raw);
    return Boolean(json?.namedTunnelDisabled);
  } catch {
    return false;
  }
}

/**
 * Canonical public link model:
 * - In named mode, configured named origin is canonical.
 * - In quick mode, quick origin is canonical (even if named config exists).
 * - Named offline is OFFLINE (not ERROR); canonical origin stays the same.
 */
export type PublicMode = "off" | "quick" | "named";
export type PublicStatus = "starting" | "online" | "offline" | "error";

export interface PublicLinkState {
  mode: PublicMode;
  status: PublicStatus;
  canonicalOrigin: string | null;
  isCanonical: boolean;
  message: string;
  lastChangedAt?: string;
}

export const canonicalOriginForLinks = (state: PublicLinkState, fallback: string): string => {
  const origin = String(state.canonicalOrigin || "").trim();
  if (origin) return origin;
  return fallback;
};

export interface PublicLinkStateInput {
  publicModeEnv: string | undefined;
  dbModeEnv: string | undefined;
  namedEnv: { tunnelName?: string | null; publicOrigin?: string | null };
  config: { provider?: string | null; domain?: string | null; tunnelName?: string | null; publicOrigin?: string | null };
  quick: { status: "STOPPED" | "STARTING" | "ACTIVE" | "ERROR"; publicOrigin: string | null; lastError?: string | null; lastCheckedAt?: string | null };
  namedHealthOk?: boolean | null;
  directOrigin?: string | null;
}

const normalizeMode = (value: string | undefined): PublicMode => {
  const v = String(value || "").trim().toLowerCase();
  if (v === "off" || v === "quick" || v === "named") return v;
  return "quick";
};

const normalizeOrigin = (value: string | null | undefined): string | null => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, "");
  return `https://${raw.replace(/\/+$/, "")}`;
};

const originHost = (value: string | null | undefined): string | null => {
  const normalized = normalizeOrigin(value);
  if (!normalized) return null;
  try {
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const isBareRegistrableDomain = (host: string): boolean => host.split(".").filter(Boolean).length === 2;

const isTunnelPrefixedDuplicate = (
  publicOrigin: string | null | undefined,
  tunnelName: string | null | undefined,
  domain: string | null | undefined
): boolean => {
  const publicHost = originHost(publicOrigin);
  const domainHost = originHost(domain);
  const name = String(tunnelName || "").trim().toLowerCase();
  if (!publicHost || !domainHost || !name) return false;
  return publicHost === `${name}.${domainHost}` && !isBareRegistrableDomain(domainHost);
};

// Canonical origin must remain exactly what the node owner configured.
// Tunnel name is transport metadata and must not rewrite host identity.
const applyTunnelSubdomain = (origin: string | null, _tunnelName: string | null | undefined): string | null => origin;

const deriveOriginFromNamedTunnelConfig = (
  provider: string | null | undefined,
  tunnelName: string | null | undefined,
  domain: string | null | undefined
): string | null => {
  if (String(provider || "").trim().toLowerCase() !== "cloudflare") return null;
  const rawName = String(tunnelName || "").trim().toLowerCase();
  const rawDomain = String(domain || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  if (!rawName || !rawDomain) return null;
  if (!isBareRegistrableDomain(rawDomain)) return null;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(rawName)) return null;
  return normalizeOrigin(`${rawName}.${rawDomain}`);
};

export const computePublicLinkState = (input: PublicLinkStateInput): PublicLinkState => {
  const envMode = normalizeMode(input.publicModeEnv);
  if (envMode === "off") {
    return {
      mode: "off",
      status: "offline",
      canonicalOrigin: null,
      isCanonical: false,
      message: "Public sharing is disabled."
    };
  }

  const envNamedOrigin = applyTunnelSubdomain(normalizeOrigin(input.namedEnv.publicOrigin || null), input.namedEnv.tunnelName);
  const envTunnel = String(input.namedEnv.tunnelName || "").trim();
  const cfgPublicOriginRaw = normalizeOrigin(input.config.publicOrigin || null);
  const cfgPublicOrigin = isTunnelPrefixedDuplicate(cfgPublicOriginRaw, input.config.tunnelName, input.config.domain)
    ? null
    : cfgPublicOriginRaw;
  const cfgDomainOrigin = applyTunnelSubdomain(normalizeOrigin(input.config.domain || null), input.config.tunnelName);
  const cfgDerivedOrigin = deriveOriginFromNamedTunnelConfig(input.config.provider, input.config.tunnelName, input.config.domain);
  const canonicalNamedOrigin = envNamedOrigin || cfgPublicOrigin || cfgDerivedOrigin || cfgDomainOrigin || null;
  const namedConfigured = Boolean(canonicalNamedOrigin);

  if (envMode === "named" && namedConfigured) {
    const health = input.namedHealthOk;
    const status: PublicStatus = health === true ? "online" : "offline";
    return {
      mode: "named",
      status,
      canonicalOrigin: canonicalNamedOrigin,
      isCanonical: true,
      message:
        status === "online"
          ? "Permanent identity link (stable hostname)."
          : "Identity endpoint offline. Link stays the same."
    };
  }

  const quickStatus = input.quick.status;
  const quickOrigin = normalizeOrigin(input.quick.publicOrigin || null);
  const status: PublicStatus =
    quickStatus === "ACTIVE" ? "online" : quickStatus === "STARTING" ? "starting" : quickStatus === "ERROR" ? "error" : "offline";

  return {
    mode: envMode === "named" ? "quick" : envMode,
    status,
    canonicalOrigin: quickOrigin,
    isCanonical: false,
    message:
      status === "online"
        ? "Temporary link (changes on restart)."
        : "Temporary link is offline. Start sharing to generate a new link."
  };
};

export const getNamedTunnelConfig = () => {
  if (readStateFlag()) return null;
  const cfg = getPublicOriginConfig();
  const envTunnel = String(process.env.CLOUDFLARE_TUNNEL_NAME || "").trim();
  const envOrigin = applyTunnelSubdomain(normalizeOrigin(process.env.CONTENTBOX_PUBLIC_ORIGIN || ""), envTunnel);
  const cfgTunnel = String(cfg.tunnelName || "").trim();
  const cfgPublicOriginRaw = normalizeOrigin(cfg.publicOrigin || "");
  const cfgPublicOrigin = isTunnelPrefixedDuplicate(cfgPublicOriginRaw, cfgTunnel, cfg.domain)
    ? null
    : cfgPublicOriginRaw;
  const cfgDomainOrigin = applyTunnelSubdomain(normalizeOrigin(cfg.domain || ""), cfgTunnel);
  const cfgDerivedOrigin = deriveOriginFromNamedTunnelConfig(cfg.provider, cfgTunnel, cfg.domain);
  const canonicalOrigin = envOrigin || cfgPublicOrigin || cfgDerivedOrigin || cfgDomainOrigin;
  if (!canonicalOrigin) return null;
  const effectiveTunnel = envTunnel || cfgTunnel || null;
  return { tunnelName: effectiveTunnel, publicOrigin: canonicalOrigin };
};

export const isNamedConfigured = () => Boolean(getNamedTunnelConfig());
