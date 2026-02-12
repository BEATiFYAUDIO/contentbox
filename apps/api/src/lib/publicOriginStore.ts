import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

export type PublicOriginRecord = {
  publicOrigin: string;
  mode: "external" | "temporary";
  hostname?: string;
  tunnelName?: string;
  updatedAt: string;
};

type StoreShape = Record<string, PublicOriginRecord>;

function normalizeOrigin(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  const noSlash = trimmed.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(noSlash)) {
    return `https://${noSlash}`;
  }
  return noSlash;
}

export function publicOriginStorePath(apiRoot: string) {
  return path.join(apiRoot, "tmp", "user-public-origins.json");
}

async function readStore(filePath: string): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as StoreShape;
  } catch {}
  return {};
}

async function writeStore(filePath: string, next: StoreShape) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

export async function getUserPublicOrigin(apiRoot: string, userId: string): Promise<string | null> {
  const filePath = publicOriginStorePath(apiRoot);
  const store = await readStore(filePath);
  const value = store[userId];
  const origin = value?.publicOrigin;
  return origin ? normalizeOrigin(origin) : null;
}

export async function getUserPublicOriginRecord(apiRoot: string, userId: string): Promise<PublicOriginRecord | null> {
  const filePath = publicOriginStorePath(apiRoot);
  const store = await readStore(filePath);
  const value = store[userId];
  return value || null;
}

export async function setUserPublicOrigin(
  apiRoot: string,
  userId: string,
  record: Omit<PublicOriginRecord, "updatedAt">
): Promise<PublicOriginRecord> {
  const filePath = publicOriginStorePath(apiRoot);
  const store = await readStore(filePath);
  const normalized = normalizeOrigin(record.publicOrigin);
  const next: PublicOriginRecord = {
    ...record,
    publicOrigin: normalized,
    updatedAt: new Date().toISOString()
  };
  store[userId] = next;
  await writeStore(filePath, store);
  return next;
}

export async function clearUserPublicOrigin(apiRoot: string, userId: string): Promise<void> {
  const filePath = publicOriginStorePath(apiRoot);
  if (!fsSync.existsSync(filePath)) return;
  const store = await readStore(filePath);
  if (!store[userId]) return;
  delete store[userId];
  await writeStore(filePath, store);
}
