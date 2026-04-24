import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveContentboxRoot } from "./contentboxRoot.js";

export type PublicOriginMode = "external" | "temporary";

export type PublicOriginRecord = {
  publicOrigin: string;
  mode: PublicOriginMode;
  hostname: string;
  tunnelName?: string | null;
  updatedAt: string;
};

type StoreShape = Record<string, PublicOriginRecord>;

const CONTENTBOX_ROOT = resolveContentboxRoot();
const STORE_DIR = path.join(CONTENTBOX_ROOT, "state");
const STORE_PATH = path.join(STORE_DIR, "public-origins.json");
const CONFIG_PATH = path.join(STORE_DIR, "public-origin-config.json");
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_STORE_PATHS = [
  path.resolve(process.cwd(), "tmp", "public-origins.json"),
  path.resolve(process.cwd(), "apps/api/tmp/public-origins.json"),
  path.resolve(MODULE_DIR, "../../tmp/public-origins.json"),
  path.resolve(MODULE_DIR, "../../../../tmp/public-origins.json")
];
const LEGACY_CONFIG_PATHS = [
  path.resolve(process.cwd(), "tmp", "public-origin-config.json"),
  path.resolve(process.cwd(), "apps/api/tmp/public-origin-config.json"),
  path.resolve(MODULE_DIR, "../../tmp/public-origin-config.json"),
  path.resolve(MODULE_DIR, "../../../../tmp/public-origin-config.json")
];
let storeMigrated = false;
let configMigrated = false;

function ensureDirectory() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

function migrateLegacyFileIfNeeded(targetPath: string, candidates: string[]) {
  if (fs.existsSync(targetPath)) return;
  for (const candidate of candidates) {
    if (!candidate || candidate === targetPath) continue;
    if (!fs.existsSync(candidate)) continue;
    try {
      ensureDirectory();
      fs.copyFileSync(candidate, targetPath);
      return;
    } catch {
      // keep trying other legacy candidates
    }
  }
}

function ensureStoreMigration() {
  if (storeMigrated) return;
  migrateLegacyFileIfNeeded(STORE_PATH, LEGACY_STORE_PATHS);
  storeMigrated = true;
}

function ensureConfigMigration() {
  if (configMigrated) return;
  migrateLegacyFileIfNeeded(CONFIG_PATH, LEGACY_CONFIG_PATHS);
  configMigrated = true;
}

function readStore(): StoreShape {
  ensureStoreMigration();
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const json = JSON.parse(raw);
    if (json && typeof json === "object") return json as StoreShape;
    return {};
  } catch {
    return {};
  }
}

function writeStore(store: StoreShape) {
  ensureStoreMigration();
  ensureDirectory();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function getPublicOrigin(userId: string): PublicOriginRecord | null {
  const store = readStore();
  return store[userId] || null;
}

export function setPublicOrigin(userId: string, record: PublicOriginRecord) {
  const store = readStore();
  store[userId] = record;
  writeStore(store);
}

export function clearPublicOrigin(userId: string) {
  const store = readStore();
  if (store[userId]) {
    delete store[userId];
    writeStore(store);
  }
}

export type PublicOriginConfig = {
  provider?: string | null;
  domain?: string | null;
  tunnelName?: string | null;
  publicOrigin?: string | null;
  publicBuyOrigin?: string | null;
  publicStudioOrigin?: string | null;
  publicOriginFallback?: string | null;
  publicBuyOriginFallback?: string | null;
  publicStudioOriginFallback?: string | null;
  updatedAt?: string | null;
};

function readConfig(): PublicOriginConfig {
  ensureConfigMigration();
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const json = JSON.parse(raw);
    if (json && typeof json === "object") return json as PublicOriginConfig;
    return {};
  } catch {
    return {};
  }
}

function writeConfig(config: PublicOriginConfig) {
  ensureConfigMigration();
  ensureDirectory();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function getPublicOriginConfig(): PublicOriginConfig {
  return readConfig();
}

export function setPublicOriginConfig(config: PublicOriginConfig) {
  const current = readConfig();
  writeConfig({
    provider:
      config.provider !== undefined
        ? config.provider || null
        : current.provider || null,
    domain:
      config.domain !== undefined
        ? config.domain || null
        : current.domain || null,
    tunnelName:
      config.tunnelName !== undefined
        ? config.tunnelName || null
        : current.tunnelName || null,
    publicOrigin:
      config.publicOrigin !== undefined
        ? config.publicOrigin || null
        : current.publicOrigin || null,
    publicBuyOrigin:
      config.publicBuyOrigin !== undefined
        ? config.publicBuyOrigin || null
        : current.publicBuyOrigin || null,
    publicStudioOrigin:
      config.publicStudioOrigin !== undefined
        ? config.publicStudioOrigin || null
        : current.publicStudioOrigin || null,
    publicOriginFallback:
      config.publicOriginFallback !== undefined
        ? config.publicOriginFallback || null
        : current.publicOriginFallback || null,
    publicBuyOriginFallback:
      config.publicBuyOriginFallback !== undefined
        ? config.publicBuyOriginFallback || null
        : current.publicBuyOriginFallback || null,
    publicStudioOriginFallback:
      config.publicStudioOriginFallback !== undefined
        ? config.publicStudioOriginFallback || null
        : current.publicStudioOriginFallback || null,
    updatedAt: new Date().toISOString()
  });
}
