export enum IdentityLevel {
  BASIC = "BASIC",
  PERSISTENT = "PERSISTENT"
}

export type IdentityDetail = {
  level: IdentityLevel;
  dbMode: "basic" | "advanced";
  persistentConfigured: boolean;
  reason: string;
  publicOrigin: string | null;
};

function normalizeDbMode(raw: string | undefined): "basic" | "advanced" {
  const v = String(raw || "basic").trim().toLowerCase();
  return v === "advanced" ? "advanced" : "basic";
}

export function getIdentityDetail(): IdentityDetail {
  const overrideRaw = String(process.env.IDENTITY_LEVEL_OVERRIDE || "").trim().toUpperCase();
  if (overrideRaw === IdentityLevel.BASIC || overrideRaw === IdentityLevel.PERSISTENT) {
    const level = overrideRaw as IdentityLevel;
    return {
      level,
      dbMode: level === IdentityLevel.PERSISTENT ? "advanced" : "basic",
      persistentConfigured: level === IdentityLevel.PERSISTENT,
      reason: "override",
      publicOrigin: String(process.env.CONTENTBOX_PUBLIC_ORIGIN || "").trim() || null
    };
  }

  const dbMode = normalizeDbMode(process.env.DB_MODE);
  if (dbMode === "basic") {
    return {
      level: IdentityLevel.BASIC,
      dbMode,
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
      persistentConfigured: false,
      reason: "named_tunnel_missing",
      publicOrigin
    };
  }

  return {
    level: IdentityLevel.PERSISTENT,
    dbMode,
    persistentConfigured: true,
    reason: "named_tunnel_configured",
    publicOrigin
  };
}

export function getIdentityLevel(): IdentityLevel {
  return getIdentityDetail().level;
}
