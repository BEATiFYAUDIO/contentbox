import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type ReceiptType =
  | "provider_acknowledgment"
  | "operation_permit"
  | "profile_activation"
  | "profile_publish"
  | "content_publish"
  | "payment_receipt";

export type ReceiptSignature = {
  alg: string;
  keyId?: string | null;
  value: string;
};

export type LifecycleReceipt = {
  id: string;
  type: ReceiptType;
  version: 1;
  createdAt: string;
  subjectNodeId: string;
  providerNodeId: string | null;
  objectId: string | null;
  payloadHash: string;
  prevReceiptId: string | null;
  payload: unknown;
  signatures: ReceiptSignature[];
};

type ReceiptIndex = {
  ids: string[];
};

function asIsoNow() {
  return new Date().toISOString();
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function computeReceiptPayloadHash(payload: unknown): string {
  return crypto.createHash("sha256").update(canonicalJsonString(payload)).digest("hex");
}

export function isLifecycleReceipt(value: unknown): value is LifecycleReceipt {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  const knownTypes = new Set<ReceiptType>([
    "provider_acknowledgment",
    "operation_permit",
    "profile_activation",
    "profile_publish",
    "content_publish",
    "payment_receipt"
  ]);
  if (typeof r.id !== "string" || !r.id.trim()) return false;
  if (typeof r.type !== "string" || !knownTypes.has(r.type as ReceiptType)) return false;
  if (r.version !== 1) return false;
  if (typeof r.createdAt !== "string" || !r.createdAt.trim()) return false;
  if (typeof r.subjectNodeId !== "string" || !r.subjectNodeId.trim()) return false;
  if (r.providerNodeId !== null && typeof r.providerNodeId !== "string") return false;
  if (r.objectId !== null && typeof r.objectId !== "string") return false;
  if (typeof r.payloadHash !== "string" || !r.payloadHash.trim()) return false;
  if (r.prevReceiptId !== null && typeof r.prevReceiptId !== "string") return false;
  if (!Array.isArray(r.signatures)) return false;
  for (const sig of r.signatures) {
    if (!sig || typeof sig !== "object") return false;
    const s = sig as Record<string, unknown>;
    if (typeof s.alg !== "string" || typeof s.value !== "string") return false;
    if (s.keyId !== undefined && s.keyId !== null && typeof s.keyId !== "string") return false;
  }
  return true;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, filePath);
}

function indexFile(receiptsDir: string) {
  return path.join(receiptsDir, "index.json");
}

function receiptFile(receiptsDir: string, id: string) {
  return path.join(receiptsDir, `${id}.json`);
}

function readReceiptIndex(receiptsDir: string): ReceiptIndex {
  const parsed = readJsonFile<ReceiptIndex>(indexFile(receiptsDir));
  if (!parsed || !Array.isArray(parsed.ids)) return { ids: [] };
  return { ids: parsed.ids.filter((id) => typeof id === "string" && id.trim()) };
}

function writeReceiptIndex(receiptsDir: string, index: ReceiptIndex) {
  writeJsonFile(indexFile(receiptsDir), index);
}

export function getLastReceiptId(receiptsDir: string): string | null {
  const index = readReceiptIndex(receiptsDir);
  if (!index.ids.length) return null;
  return index.ids[index.ids.length - 1] || null;
}

export function createLifecycleReceipt(input: {
  type: ReceiptType;
  subjectNodeId: string;
  providerNodeId?: string | null;
  objectId?: string | null;
  payload: unknown;
  prevReceiptId?: string | null;
  createdAt?: string;
  signatures?: ReceiptSignature[];
}): LifecycleReceipt {
  const payloadHash = computeReceiptPayloadHash(input.payload);
  const createdAt = input.createdAt || asIsoNow();
  const seed = canonicalJsonString({
    type: input.type,
    createdAt,
    subjectNodeId: input.subjectNodeId,
    providerNodeId: input.providerNodeId || null,
    objectId: input.objectId || null,
    payloadHash,
    prevReceiptId: input.prevReceiptId || null
  });
  const short = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16);
  const id = `rct_${short}_${crypto.randomBytes(3).toString("hex")}`;
  return {
    id,
    type: input.type,
    version: 1,
    createdAt,
    subjectNodeId: input.subjectNodeId,
    providerNodeId: input.providerNodeId || null,
    objectId: input.objectId || null,
    payloadHash,
    prevReceiptId: input.prevReceiptId || null,
    payload: input.payload,
    signatures: input.signatures || []
  };
}

export function appendLifecycleReceipt(
  receiptsDir: string,
  input: Omit<Parameters<typeof createLifecycleReceipt>[0], "prevReceiptId">
): LifecycleReceipt {
  const prevReceiptId = getLastReceiptId(receiptsDir);
  const receipt = createLifecycleReceipt({ ...input, prevReceiptId });
  persistLifecycleReceipt(receiptsDir, receipt);
  return receipt;
}

export function persistLifecycleReceipt(receiptsDir: string, receipt: LifecycleReceipt): LifecycleReceipt {
  writeJsonFile(receiptFile(receiptsDir, receipt.id), receipt);
  const index = readReceiptIndex(receiptsDir);
  if (!index.ids.includes(receipt.id)) {
    index.ids.push(receipt.id);
    writeReceiptIndex(receiptsDir, index);
  }
  return receipt;
}

export function getLifecycleReceiptById(receiptsDir: string, id: string): LifecycleReceipt | null {
  const parsed = readJsonFile<unknown>(receiptFile(receiptsDir, id));
  if (!isLifecycleReceipt(parsed)) return null;
  return parsed;
}

export function listLifecycleReceipts(receiptsDir: string, limit = 50): LifecycleReceipt[] {
  const lim = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 50;
  const index = readReceiptIndex(receiptsDir);
  const out: LifecycleReceipt[] = [];
  for (let i = index.ids.length - 1; i >= 0; i -= 1) {
    const id = index.ids[i];
    const rec = getLifecycleReceiptById(receiptsDir, id);
    if (!rec) continue;
    out.push(rec);
    if (out.length >= lim) break;
  }
  return out;
}

export function verifyLifecycleReceipt(receiptsDir: string, id: string) {
  const rec = getLifecycleReceiptById(receiptsDir, id);
  if (!rec) {
    return {
      exists: false,
      hashValid: false,
      structuralValid: false,
      type: null as ReceiptType | null
    };
  }
  const hashValid = computeReceiptPayloadHash(rec.payload) === rec.payloadHash;
  return {
    exists: true,
    hashValid,
    structuralValid: isLifecycleReceipt(rec),
    type: rec.type
  };
}

export function summarizeLifecycleReceipts(receiptsDir: string) {
  const index = readReceiptIndex(receiptsDir);
  let latestAcknowledgmentReceipt: LifecycleReceipt | null = null;
  let latestPermitReceipt: LifecycleReceipt | null = null;
  let latestActivationReceipt: LifecycleReceipt | null = null;
  let latestPublishReceipt: LifecycleReceipt | null = null;
  let latestContentPublishReceipt: LifecycleReceipt | null = null;
  let latestPaymentReceipt: LifecycleReceipt | null = null;

  for (let i = index.ids.length - 1; i >= 0; i -= 1) {
    const rec = getLifecycleReceiptById(receiptsDir, index.ids[i]);
    if (!rec) continue;
    if (!latestAcknowledgmentReceipt && rec.type === "provider_acknowledgment") latestAcknowledgmentReceipt = rec;
    if (!latestPermitReceipt && rec.type === "operation_permit") latestPermitReceipt = rec;
    if (!latestActivationReceipt && rec.type === "profile_activation") latestActivationReceipt = rec;
    if (!latestPublishReceipt && rec.type === "profile_publish") latestPublishReceipt = rec;
    if (!latestContentPublishReceipt && rec.type === "content_publish") latestContentPublishReceipt = rec;
    if (!latestPaymentReceipt && rec.type === "payment_receipt") latestPaymentReceipt = rec;
    if (
      latestAcknowledgmentReceipt &&
      latestPermitReceipt &&
      latestActivationReceipt &&
      latestPublishReceipt &&
      latestContentPublishReceipt &&
      latestPaymentReceipt
    ) break;
  }

  return {
    latestAcknowledgmentReceipt,
    latestPermitReceipt,
    latestActivationReceipt,
    latestPublishReceipt,
    latestContentPublishReceipt,
    latestPaymentReceipt,
    totalReceiptCount: index.ids.length
  };
}
