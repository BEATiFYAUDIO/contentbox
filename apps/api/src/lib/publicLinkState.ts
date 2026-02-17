import fs from "node:fs";
import path from "node:path";
import { getPublicOriginConfig } from "./publicOriginStore.js";

const CONTENTBOX_ROOT = String(process.env.CONTENTBOX_ROOT || "").trim();
const STATE_FILE = CONTENTBOX_ROOT ? path.join(CONTENTBOX_ROOT, "state.json") : "";

function readStateFlag(): boolean {
  if (!STATE_FILE) return false;
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
 * Strict canonical public link model:
 * - Named tunnel (if configured) is always the canonical origin.
 * - Quick tunnel is allowed only when named is not configured.
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
  config: { provider?: string | null; domain?: string | null; tunnelName?: string | null };
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

  const envNamedOrigin = normalizeOrigin(input.namedEnv.publicOrigin || null);
  const envTunnel = String(input.namedEnv.tunnelName || "").trim();
  const cfgOrigin = normalizeOrigin(input.config.domain || null);
  const cfgTunnel = String(input.config.tunnelName || "").trim();
  const cfgProvider = String(input.config.provider || "").trim();
  const namedConfigured = Boolean((envTunnel && envNamedOrigin) || (cfgProvider === "cloudflare" && cfgTunnel && cfgOrigin));
  const canonicalNamedOrigin = envNamedOrigin || cfgOrigin || null;

  if (namedConfigured) {
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
  const envTunnel = String(process.env.CLOUDFLARE_TUNNEL_NAME || "").trim();
  const envOrigin = normalizeOrigin(process.env.CONTENTBOX_PUBLIC_ORIGIN || "");
  if (envTunnel && envOrigin) return { tunnelName: envTunnel, publicOrigin: envOrigin };

  const cfg = getPublicOriginConfig();
  const cfgTunnel = String(cfg.tunnelName || "").trim();
  const cfgOrigin = normalizeOrigin(cfg.domain || "");
  const provider = String(cfg.provider || "").trim();
  if (provider === "cloudflare" && cfgTunnel && cfgOrigin) return { tunnelName: cfgTunnel, publicOrigin: cfgOrigin };
  return null;
};

export const isNamedConfigured = () => Boolean(getNamedTunnelConfig());
