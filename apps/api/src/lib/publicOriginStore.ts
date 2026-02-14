import fs from "node:fs";
import path from "node:path";

export type PublicOriginMode = "external" | "temporary";

export type PublicOriginRecord = {
  publicOrigin: string;
  mode: PublicOriginMode;
  hostname: string;
  tunnelName?: string | null;
  updatedAt: string;
};

type StoreShape = Record<string, PublicOriginRecord>;

const STORE_DIR = path.resolve(process.cwd(), "tmp");
const STORE_PATH = path.join(STORE_DIR, "public-origins.json");
const CONFIG_PATH = path.join(STORE_DIR, "public-origin-config.json");

function readStore(): StoreShape {
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
  fs.mkdirSync(STORE_DIR, { recursive: true });
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
  updatedAt?: string | null;
};

function readConfig(): PublicOriginConfig {
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
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function getPublicOriginConfig(): PublicOriginConfig {
  return readConfig();
}

export function setPublicOriginConfig(config: PublicOriginConfig) {
  writeConfig({
    provider: config.provider || null,
    domain: config.domain || null,
    tunnelName: config.tunnelName || null,
    updatedAt: new Date().toISOString()
  });
}
