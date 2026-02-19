import { readNodeConfigSync } from "./nodeConfig.js";

export type NodeMode = "basic" | "advanced" | "lan";
export type StorageEngine = "sqlite" | "postgres";

export type FeatureName = "public_share" | "derivatives" | "advanced_splits" | "multi_user";

function normalizeDbMode(raw: string | undefined): "basic" | "advanced" {
  const v = String(raw || "basic").trim().toLowerCase();
  return v === "advanced" ? "advanced" : "basic";
}

function normalizeNodeMode(raw: string | undefined): NodeMode | null {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "basic" || v === "advanced" || v === "lan") return v as NodeMode;
  return null;
}

function normalizeStorage(raw: string | undefined): StorageEngine | null {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "sqlite" || v === "postgres") return v as StorageEngine;
  return null;
}

function envBool(value: string | undefined): boolean {
  const v = String(value || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export type RuntimeConfig = {
  nodeMode: NodeMode;
  storage: StorageEngine;
  nodeModeSource: "env" | "file" | "legacy" | "default";
  storageSource: "env" | "legacy" | "default";
};

export function resolveRuntimeConfig(): RuntimeConfig {
  const explicitNodeMode = normalizeNodeMode(process.env.NODE_MODE);
  const explicitStorage = normalizeStorage(process.env.STORAGE);
  const legacyDbMode = normalizeDbMode(process.env.DB_MODE);
  const legacyLan = envBool(process.env.CONTENTBOX_LAN);
  const fileNodeMode = normalizeNodeMode(readNodeConfigSync()?.nodeMode);

  let nodeMode: NodeMode = "basic";
  let nodeModeSource: RuntimeConfig["nodeModeSource"] = "default";
  if (explicitNodeMode) {
    nodeMode = explicitNodeMode;
    nodeModeSource = "env";
  } else if (fileNodeMode) {
    nodeMode = fileNodeMode;
    nodeModeSource = "file";
  } else if (legacyLan) {
    nodeMode = "lan";
    nodeModeSource = "legacy";
  } else if (legacyDbMode === "advanced") {
    nodeMode = "advanced";
    nodeModeSource = "legacy";
  } else {
    nodeMode = "basic";
    nodeModeSource = "legacy";
  }

  let storage: StorageEngine = "sqlite";
  let storageSource: RuntimeConfig["storageSource"] = "default";
  if (explicitStorage) {
    storage = explicitStorage;
    storageSource = "env";
  } else if (legacyDbMode === "advanced") {
    storage = "postgres";
    storageSource = "legacy";
  } else {
    storage = "sqlite";
    storageSource = "legacy";
  }

  return { nodeMode, storage, nodeModeSource, storageSource };
}

export function getNodeMode(): NodeMode {
  return resolveRuntimeConfig().nodeMode;
}

export function getStorageEngine(): StorageEngine {
  return resolveRuntimeConfig().storage;
}

export function dbModeCompatFromStorage(storage: StorageEngine): "basic" | "advanced" {
  return storage === "postgres" ? "advanced" : "basic";
}

export function canPublicShare(mode: NodeMode): boolean {
  return mode === "advanced";
}

export function canDerivatives(mode: NodeMode): boolean {
  return mode === "advanced" || mode === "lan";
}

export function canAdvancedSplits(mode: NodeMode): boolean {
  return mode === "advanced" || mode === "lan";
}

export function canMultiUser(mode: NodeMode): boolean {
  return mode === "lan";
}

export function lockReason(feature: FeatureName, mode: NodeMode): string {
  if (feature === "public_share") {
    return mode === "lan"
      ? "Public sharing is disabled in LAN mode."
      : "Public sharing is disabled in Basic (Trial).";
  }
  if (feature === "derivatives") {
    return "Derivatives require Advanced or LAN mode.";
  }
  if (feature === "advanced_splits") {
    return "Splits and royalties require Advanced or LAN mode.";
  }
  if (feature === "multi_user") {
    return mode === "advanced"
      ? "Advanced nodes are single-identity. Use LAN mode for multi-user."
      : "Multi-user requires LAN mode.";
  }
  return "Feature unavailable in this mode.";
}

export function getFeatureMatrix(mode: NodeMode) {
  return {
    publicShare: canPublicShare(mode),
    derivatives: canDerivatives(mode),
    advancedSplits: canAdvancedSplits(mode),
    multiUser: canMultiUser(mode)
  };
}

export function shouldBlockAdditionalUser(
  mode: NodeMode,
  allowMultiUser: boolean,
  hasOtherUsers: boolean
) {
  if (allowMultiUser) return false;
  if (mode === "advanced" && hasOtherUsers) return true;
  return false;
}
