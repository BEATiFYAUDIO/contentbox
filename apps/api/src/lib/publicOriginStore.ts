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
