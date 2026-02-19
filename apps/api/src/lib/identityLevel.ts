import { dbModeCompatFromStorage, resolveRuntimeConfig } from "./nodeMode.js";

export enum IdentityLevel {
  BASIC = "BASIC",
  PERSISTENT = "PERSISTENT"
}

export type IdentityDetail = {
  level: IdentityLevel;
  dbMode: "basic" | "advanced";
  storage: "sqlite" | "postgres";
  persistentConfigured: boolean;
  reason: string;
  publicOrigin: string | null;
};

export function getIdentityDetail(): IdentityDetail {
  const runtime = resolveRuntimeConfig();
  const dbMode = dbModeCompatFromStorage(runtime.storage);
  const overrideRaw = String(process.env.IDENTITY_LEVEL_OVERRIDE || "").trim().toUpperCase();
  if (overrideRaw === IdentityLevel.BASIC || overrideRaw === IdentityLevel.PERSISTENT) {
    const level = overrideRaw as IdentityLevel;
    return {
      level,
      dbMode: level === IdentityLevel.PERSISTENT ? "advanced" : "basic",
      storage: runtime.storage,
      persistentConfigured: level === IdentityLevel.PERSISTENT,
      reason: "override",
      publicOrigin: String(process.env.CONTENTBOX_PUBLIC_ORIGIN || "").trim() || null
    };
  }

  if (runtime.nodeMode === "basic") {
    return {
      level: IdentityLevel.BASIC,
      dbMode,
      storage: runtime.storage,
      persistentConfigured: false,
      reason: "db_mode_basic",
      publicOrigin: null
    };
  }

  const publicMode = String(process.env.PUBLIC_MODE || "").trim().toLowerCase();
  const tunnelName = String(process.env.CLOUDFLARE_TUNNEL_NAME || "").trim();
  const publicOrigin = String(process.env.CONTENTBOX_PUBLIC_ORIGIN || "").trim() || null;
  const persistentConfigured = publicMode === "named" && Boolean(tunnelName && publicOrigin);

  if (!persistentConfigured) {
    return {
      level: IdentityLevel.BASIC,
      dbMode,
      storage: runtime.storage,
      persistentConfigured: false,
      reason: "named_tunnel_missing",
      publicOrigin
    };
  }

  return {
    level: IdentityLevel.PERSISTENT,
    dbMode,
    storage: runtime.storage,
    persistentConfigured: true,
    reason: "named_tunnel_configured",
    publicOrigin
  };
}

export function getIdentityLevel(): IdentityLevel {
  return getIdentityDetail().level;
}
