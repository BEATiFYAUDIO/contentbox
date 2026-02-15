import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import bcrypt from "bcrypt";
import multipart from "@fastify/multipart";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";
import { ethers } from "ethers";
import * as cheerio from "cheerio";
import { PrismaPg } from "@prisma/adapter-pg";
import { initContentRepo, addFileToContentRepo, commitAll } from "./lib/repo.js";
import {
  computeManifestHash,
  computeProofHash,
  computeSplitsHash,
  normalizeSplitsForProof,
  stableStringify
} from "./lib/proof.js";
import { createPaymentProvider } from "./lib/payments.js";
import { allocateByBps, sumBps } from "./lib/settlement.js";
import { createOnchainAddress, checkOnchainPayment } from "./payments/onchain.js";
import { deriveFromXpub } from "./payments/xpub.js";
import { createLightningInvoice, checkLightningInvoice } from "./payments/lightning.js";
import { finalizePurchase } from "./payments/finalizePurchase.js";
import { getPublicOriginConfig, setPublicOriginConfig } from "./lib/publicOriginStore.js";
import { TunnelManager } from "./lib/tunnelManager.js";
import { startPublicServer } from "./publicServer.js";
import { mapLightningErrorMessage } from "./lib/railHealth.js";

/** ---------- tiny utils (strict TS friendly) ---------- */

// Ensure BigInt can be JSON-stringified anywhere.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`${name} missing in apps/api/.env`);
  return String(v).trim();
}

function asString(x: unknown): string {
  return typeof x === "string" ? x : String(x ?? "");
}

function normalizeEmail(x: unknown): string {
  return asString(x).trim().toLowerCase();
}

function num(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function parseSats(x: unknown): bigint {
  if (typeof x === "bigint") return x;
  if (typeof x === "number") return BigInt(Math.floor(x));
  const s = asString(x).trim();
  if (!s) return 0n;
  if (/^\d+$/.test(s)) return BigInt(s);
  const n = Number(s);
  return Number.isFinite(n) ? BigInt(Math.floor(n)) : 0n;
}

type RangeRequest =
  | { kind: "ok"; start: number; end: number }
  | { kind: "invalid" }
  | { kind: "none" };

function parseRangeHeader(range: string | undefined, size: number): RangeRequest {
  if (!range) return { kind: "none" };
  const trimmed = range.trim();
  if (!trimmed.startsWith("bytes=")) return { kind: "invalid" };
  const spec = trimmed.slice(6);
  if (!spec || spec.includes(",")) return { kind: "invalid" };

  const match = spec.match(/^(\d*)-(\d*)$/);
  if (!match) return { kind: "invalid" };

  const startRaw = match[1];
  const endRaw = match[2];

  if (!startRaw && !endRaw) return { kind: "invalid" };

  if (!startRaw && endRaw) {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: "invalid" };
    const end = Math.max(0, size - 1);
    const start = Math.max(0, size - suffix);
    if (start > end) return { kind: "invalid" };
    return { kind: "ok", start, end };
  }

  const start = Number(startRaw);
  if (!Number.isFinite(start) || start < 0) return { kind: "invalid" };

  if (!endRaw) {
    const end = Math.max(0, size - 1);
    if (start > end) return { kind: "invalid" };
    return { kind: "ok", start, end };
  }

  const end = Number(endRaw);
  if (!Number.isFinite(end) || end < start) return { kind: "invalid" };
  if (start >= size) return { kind: "invalid" };
  return { kind: "ok", start, end: Math.min(end, size - 1) };
}

function previewMaxBytesFor(mime: string | null | undefined, contentType: string | null | undefined): number {
  const mt = (mime || "").toLowerCase();
  const ct = (contentType || "").toLowerCase();
  if (mt.startsWith("audio/") || ct === "song") return 1_000_000;
  if (mt.startsWith("video/") || ct === "video") return 2_500_000;
  if (ct === "book") return 256_000;
  return 0;
}

function canPreview(mime: string | null | undefined, contentType: string | null | undefined): boolean {
  const ct = (contentType || "").toLowerCase();
  if (ct === "file") return false;
  const mt = (mime || "").toLowerCase();
  if (mt.startsWith("audio/") || mt.startsWith("video/")) return true;
  if (ct === "book") return true;
  return false;
}

const previewTokens = new Map<
  string,
  { manifestHash: string; fileId: string; expiresAt: number; maxBytes: number }
>();
const previewRate = new Map<string, { count: number; resetAt: number }>();

function isPreviewToken(token: string | null | undefined): boolean {
  return Boolean(token && token.startsWith("preview_"));
}

function issuePreviewToken(input: { manifestHash: string; fileId: string; maxBytes: number; ttlMs: number }) {
  const token = `preview_${crypto.randomBytes(18).toString("hex")}`;
  const expiresAt = Date.now() + input.ttlMs;
  previewTokens.set(token, {
    manifestHash: input.manifestHash,
    fileId: input.fileId,
    maxBytes: input.maxBytes,
    expiresAt
  });
  return { token, expiresAt };
}

function allowPreviewIssue(ip: string, limit = 6, windowMs = 5 * 60 * 1000): boolean {
  const now = Date.now();
  const entry = previewRate.get(ip);
  if (!entry || now > entry.resetAt) {
    previewRate.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(normalized, "base64");
}

type PermitClaims = {
  manifestHash: string;
  fileId: string;
  buyerId: string;
  scopes: string[];
  iat: number;
  exp: number;
  nonce: string;
};

function signPermit(claims: PermitClaims): string {
  const header = { alg: "HS256", typ: "CBP1" };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(claims));
  const data = `${headerB64}.${payloadB64}`;
  const sig = crypto.createHmac("sha256", PERMIT_SECRET).update(data).digest();
  const sigB64 = base64UrlEncode(sig);
  return `permit_${data}.${sigB64}`;
}

function verifyPermit(token: string): { ok: boolean; expired?: boolean; claims?: PermitClaims } {
  if (!token.startsWith("permit_")) return { ok: false };
  const raw = token.slice("permit_".length);
  const parts = raw.split(".");
  if (parts.length !== 3) return { ok: false };
  const [headerB64, payloadB64, sigB64] = parts;
  try {
    const header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
    if (header?.alg !== "HS256") return { ok: false };
    const data = `${headerB64}.${payloadB64}`;
    const expected = crypto.createHmac("sha256", PERMIT_SECRET).update(data).digest();
    const actual = base64UrlDecode(sigB64);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return { ok: false };
    const claims = JSON.parse(base64UrlDecode(payloadB64).toString("utf8")) as PermitClaims;
    if (!claims?.manifestHash || !claims?.fileId || !claims?.exp || !claims?.iat) return { ok: false };
    if (Date.now() > Number(claims.exp)) return { ok: false, expired: true, claims };
    return { ok: true, claims };
  } catch {
    return { ok: false };
  }
}

function readPemMaybeFile(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("BEGIN")) return trimmed;
  if (fsSync.existsSync(trimmed)) {
    try {
      return fsSync.readFileSync(trimmed, "utf8");
    } catch {
      return null;
    }
  }
  return trimmed;
}

function readMacaroon(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (fsSync.existsSync(trimmed)) {
    try {
      const buf = fsSync.readFileSync(trimmed);
      return buf.toString("hex");
    } catch {
      return null;
    }
  }
  return trimmed;
}

function isValidPublicOrigin(url: string | null | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\/[^/\s]+/i.test(url);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal } as any);
  } finally {
    clearTimeout(timer);
  }
}

async function lndHealthCheck() {
  const baseUrl = String(process.env.LND_REST_URL || "").replace(/\/$/, "");
  const macVal =
    process.env.LND_MACAROON_PATH ||
    process.env.LND_INVOICE_MACAROON_PATH ||
    process.env.LND_MACAROON_HEX ||
    process.env.LND_MACAROON ||
    "";
  const macaroon = readMacaroon(macVal);
  const cert = readPemMaybeFile(process.env.LND_TLS_CERT_PATH || process.env.LND_TLS_CERT_PEM || "");

  if (!baseUrl || !macaroon) {
    return {
      status: "missing",
      message: "LND env not configured",
      endpoint: baseUrl || null,
      hint: "Set LND_REST_URL and LND_MACAROON_PATH"
    };
  }

  try {
    const dispatcher = cert ? new (await import("undici")).Agent({ connect: { ca: cert } }) : undefined;
    const res = await fetchWithTimeout(
      `${baseUrl}/v1/getinfo`,
      {
        method: "GET",
        headers: { "Grpc-Metadata-Macaroon": macaroon },
        dispatcher
      } as any,
      4000
    );
    if (!res.ok) {
      const text = await res.text();
      const mapped = mapLightningErrorMessage(text || `LND error ${res.status}`);
      return { status: mapped.status, message: mapped.reason, endpoint: baseUrl, hint: mapped.hint || null };
    }
    return { status: "healthy", message: "LND reachable", endpoint: baseUrl, hint: null };
  } catch (e: any) {
    const mapped = mapLightningErrorMessage(String(e?.message || e));
    return { status: mapped.status, message: mapped.reason, endpoint: baseUrl, hint: mapped.hint || null };
  }
}

async function bitcoindHealthCheck() {
  const url = (process.env.BITCOIND_RPC_URL || "").trim();
  if (!url) return { status: "missing", message: "BITCOIND_RPC_URL not configured", endpoint: null, hint: "Set BITCOIND_RPC_URL" };
  const user = process.env.BITCOIND_RPC_USER || "";
  const pass = process.env.BITCOIND_RPC_PASS || "";
  if (!user || !pass) return { status: "degraded", message: "RPC user/pass missing", endpoint: url, hint: "Set BITCOIND_RPC_USER/BITCOIND_RPC_PASS" };
  try {
    const auth = Buffer.from(`${user}:${pass}`).toString("base64");
    const body = JSON.stringify({ jsonrpc: "1.0", id: crypto.randomUUID(), method: "getblockchaininfo", params: [] });
    const res = await fetchWithTimeout(
      url,
      { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` }, body },
      4000
    );
    if (!res.ok) {
      const text = await res.text();
      return { status: "degraded", message: `RPC error: ${text}`, endpoint: url, hint: "Check bitcoind RPC settings" };
    }
    return { status: "healthy", message: "bitcoind reachable", endpoint: url, hint: null };
  } catch (e: any) {
    return { status: "degraded", message: String(e?.message || e), endpoint: url, hint: "Check RPC connectivity" };
  }
}
// Try to return a URL string that is safe to pass to fetch. If the input
// contains spaces or other characters that make it invalid, attempt to
// encode it with encodeURI and re-validate. Returns null if still invalid.
function normalizeUrlString(u: string | null | undefined): string | null {
  if (!u) return null;
  const s = String(u).trim();
  if (!s) return null;
  try {
    // If this succeeds it's already a valid URL (may be relative in some callers)
    new URL(s);
    return s;
  } catch {
    try {
      const enc = encodeURI(s);
      new URL(enc);
      return enc;
    } catch {
      return null;
    }
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function percentToPrimitive(x: unknown): string | number | null {
  if (x === null || x === undefined) return null;
  if (typeof x === "number" || typeof x === "string") return x;
  try {
    if (typeof (x as any).toString === "function") return (x as any).toString();
  } catch {}
  return String(x);
}

function jsonSafe<T>(value: T): T {
  if (typeof value === "bigint") return value.toString() as unknown as T;
  if (Array.isArray(value)) return value.map((v) => jsonSafe(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) out[k] = jsonSafe(v);
    return out as T;
  }
  return value;
}

function jsonStringifySafe(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "user";
}

function execFileAsync(cmd: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

type HistoryActor =
  | { kind: "user"; id: string; email?: string | null; displayName?: string | null }
  | { kind: "external"; email?: string | null }
  | { kind: "system"; id?: string | null };

type HistoryEvent = {
  id: string;
  ts: string;
  category: string;
  type: string;
  title: string;
  summary?: string | null;
  actor?: HistoryActor | null;
  details?: any;
  diff?: any;
};

type AuditEventOut = {
  id: string;
  ts: string;
  type: string;
  summary?: string | null;
  actor?: HistoryActor | null;
  details?: any;
  diff?: any;
};

function actorFromUser(u: { id: string; email?: string | null; displayName?: string | null } | null): HistoryActor | null {
  if (!u) return null;
  return { kind: "user", id: u.id, email: u.email || null, displayName: u.displayName || null };
}

function actorExternal(email?: string | null): HistoryActor {
  return { kind: "external", email: email || null };
}

function createPreviewToken(app: any, userId: string, contentId: string, objectKey: string) {
  return app.jwt.sign(
    { sub: userId, contentId, objectKey, scope: "preview" },
    { expiresIn: "15m" }
  );
}

function badRequest(reply: any, msg: string) {
  return reply.code(400).send({ error: msg });
}

function notFound(reply: any, msg: string) {
  return reply.code(404).send({ error: msg });
}

function forbidden(reply: any) {
  return reply.code(403).send({ error: "Forbidden" });
}

/** ---------- app init ---------- */

const app = Fastify({
  logger: true,
  // Ensure BigInt never crashes JSON serialization at the root.
  stringify: (obj: any) => JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
});

app.addHook("onRequest", async (req, reply) => {
  const existing = (req.headers["x-request-id"] as string | undefined) || null;
  const id = existing || crypto.randomUUID();
  (req as any).requestId = id;
  reply.header("x-request-id", id);
});

app.setErrorHandler((error, req, reply) => {
  const id = (req as any).requestId || null;
  try {
    app.log.error({ requestId: id, message: String((error as any)?.message || error) }, "Unhandled error");
  } catch {}
  const status = Number((error as any)?.statusCode || (error as any)?.status) || 500;
  const payload: any = {
    error: "Internal Server Error",
    requestId: id
  };
  if (process.env.NODE_ENV !== "production") {
    payload.message = String(error?.message || error);
    payload.name = (error as any)?.name || "Error";
    if ((error as any)?.code) payload.code = (error as any)?.code;
  }
  const safe = jsonSafe(payload);
  reply.type("application/json");
  reply.code(status).send(jsonStringifySafe(safe));
});

const dbMode = String(process.env.DB_MODE || "basic").toLowerCase();
const dbUrl = mustEnv("DATABASE_URL");
const prisma =
  dbMode === "advanced"
    ? new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl }), log: [] })
    : new PrismaClient({ log: [] });

const JWT_SECRET = mustEnv("JWT_SECRET");
const PERMIT_SECRET = (process.env.PERMIT_SECRET || JWT_SECRET || "").toString();
const STREAM_TOKEN_MODE = (process.env.STREAM_TOKEN_MODE || "allow").toLowerCase();
const CONTENTBOX_ROOT = mustEnv("CONTENTBOX_ROOT");
const APP_BASE_URL = (process.env.APP_BASE_URL || "http://127.0.0.1:5173").replace(/\/$/, "");
const NODE_HTTP_PORT = Number(process.env.PORT || 4000);
const PUBLIC_MODE = String(process.env.PUBLIC_MODE || "quick").trim().toLowerCase();
const PUBLIC_HEALTH_INTERVAL_MS = Math.max(5000, Math.floor(Number(process.env.PUBLIC_HEALTH_INTERVAL_MS || "60000")));
const PUBLIC_HEALTH_FAILURE_THRESHOLD = Math.max(1, Math.floor(Number(process.env.PUBLIC_HEALTH_FAILURE_THRESHOLD || "2")));
const CLOUDFLARED_BIN_DIR = String(process.env.CLOUDFLARED_BIN_DIR || "").trim() || path.join(CONTENTBOX_ROOT, ".bin");
const PUBLIC_HTTP_PORT = Number(process.env.PUBLIC_PORT || 4010);
const STATE_FILE = path.join(CONTENTBOX_ROOT, "state.json");
const allowedOrigins = (process.env.CONTENTBOX_CORS_ORIGINS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const ETH_RPC_URL = (process.env.ETH_RPC_URL || "").trim() || null;
const PAYMENT_PROVIDER = createPaymentProvider();
const PAYMENT_UNIT_SECONDS = 30;
const DEFAULT_RATE_SATS_PER_UNIT = Number(process.env.RATE_SATS_PER_UNIT || "100");
const ONCHAIN_MIN_CONFS = Math.max(0, Math.floor(Number(process.env.ONCHAIN_MIN_CONFS || "1")));
const RECEIPT_TOKEN_TTL_SECONDS = Math.max(60, Math.floor(Number(process.env.RECEIPT_TOKEN_TTL_SECONDS || "3600")));
const tunnelManager = new TunnelManager({
  targetPort: PUBLIC_HTTP_PORT,
  binDir: CLOUDFLARED_BIN_DIR,
  healthIntervalMs: PUBLIC_HEALTH_INTERVAL_MS,
  healthFailureThreshold: PUBLIC_HEALTH_FAILURE_THRESHOLD,
  protocolPreference: getPublicSharingProtocolPreference(),
  onProtocolSuggestion: (protocol) => {
    setPublicSharingProtocolPreference(protocol);
  },
  logger: {
    info: (msg) => app.log.info(msg),
    warn: (msg) => app.log.warn(msg),
    error: (msg) => app.log.error(msg)
  }
});

function resolveCloudflaredCmd(): string | null {
  const envPath = String(process.env.CLOUDFLARED_PATH || "").trim();
  if (envPath && fsSync.existsSync(envPath)) return envPath;
  const localBin = path.join(CLOUDFLARED_BIN_DIR, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  if (fsSync.existsSync(localBin)) return localBin;
  try {
    const res = spawnSync("cloudflared", ["--version"], { stdio: "ignore" });
    if (res.status === 0) return "cloudflared";
  } catch {}
  return null;
}

function hasCloudflaredBinary(): boolean {
  return Boolean(resolveCloudflaredCmd());
}

function readCloudflaredVersionSync(binPath: string): string | null {
  try {
    const res = spawnSync(binPath, ["--version"], { encoding: "utf8" });
    if (res.status === 0) return String(res.stdout || "").trim() || null;
  } catch {}
  return null;
}

function getCloudflaredStatus(): { available: boolean; managedPath: string | null; version: string | null } {
  const resolved = resolveCloudflaredCmd();
  if (!resolved) return { available: false, managedPath: null, version: null };
  const managedPath = resolved === "cloudflared" ? null : resolved;
  return {
    available: true,
    managedPath,
    version: readCloudflaredVersionSync(resolved)
  };
}

type LocalState = {
  publicSharingConsent?: {
    granted?: boolean;
    grantedAt?: string | null;
    dontAskAgain?: boolean;
  };
  publicSharingAutoStart?: boolean;
  publicSharingProtocol?: "http2" | "quic";
};

function readLocalState(): LocalState {
  try {
    if (!fsSync.existsSync(STATE_FILE)) return {};
    const raw = fsSync.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as LocalState;
  } catch {
    return {};
  }
}

function writeLocalState(next: LocalState) {
  try {
    const tmp = `${STATE_FILE}.tmp`;
    fsSync.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fsSync.renameSync(tmp, STATE_FILE);
  } catch {}
}

function getPublicSharingConsent() {
  const s = readLocalState();
  const c = s.publicSharingConsent || {};
  return {
    granted: Boolean(c.granted),
    grantedAt: typeof c.grantedAt === "string" ? c.grantedAt : null,
    dontAskAgain: Boolean(c.dontAskAgain)
  };
}

function setPublicSharingConsent(granted: boolean, dontAskAgain: boolean) {
  const s = readLocalState();
  s.publicSharingConsent = {
    granted,
    dontAskAgain,
    grantedAt: granted ? new Date().toISOString() : null
  };
  writeLocalState(s);
  return s.publicSharingConsent;
}

function clearPublicSharingConsent() {
  const s = readLocalState();
  if (s.publicSharingConsent) delete s.publicSharingConsent;
  writeLocalState(s);
}

function getPublicSharingAutoStart(): boolean {
  const s = readLocalState();
  return Boolean(s.publicSharingAutoStart);
}

function setPublicSharingAutoStart(enabled: boolean) {
  const s = readLocalState();
  s.publicSharingAutoStart = enabled;
  writeLocalState(s);
}

function getPublicSharingProtocolPreference(): "auto" | "http2" | "quic" {
  const s = readLocalState();
  if (s.publicSharingProtocol === "http2") return "http2";
  if (s.publicSharingProtocol === "quic") return "quic";
  return "auto";
}

function setPublicSharingProtocolPreference(p: "http2" | "quic") {
  const s = readLocalState();
  s.publicSharingProtocol = p;
  writeLocalState(s);
}

type PublicMode = "off" | "quick" | "named" | "direct";
type PublicState = "STOPPED" | "STARTING" | "ACTIVE" | "ERROR";

function normalizePublicMode(value: string): PublicMode {
  const v = String(value || "").trim().toLowerCase();
  if (v === "off" || v === "quick" || v === "named" || v === "direct") return v;
  return "quick";
}

function getPublicBindHost(mode: PublicMode): string {
  if (mode === "direct" && String(process.env.CONTENTBOX_BIND || "").trim() === "public") return "0.0.0.0";
  return "127.0.0.1";
}

function detectPublicIp(): string | null {
  const nets = os.networkInterfaces();
  const candidates: string[] = [];
  for (const list of Object.values(nets)) {
    for (const info of list || []) {
      if (info.family !== "IPv4") continue;
      if (info.internal) continue;
      candidates.push(info.address);
    }
  }
  return candidates[0] || null;
}

function getDirectPublicOrigin(): string | null {
  const host = getPublicBindHost("direct");
  if (host !== "0.0.0.0") return null;
  const ip = detectPublicIp();
  if (!ip) return null;
  return `http://${ip}:${PUBLIC_HTTP_PORT}`;
}

function toEpochMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function getPublicStatus(): {
  mode: PublicMode;
  state: PublicState;
  publicOrigin: string | null;
  lastError: string | null;
  lastCheckedAt: number | null;
  cloudflared: { available: boolean; managedPath: string | null; version: string | null };
  consentRequired: boolean;
  autoStartEnabled: boolean;
} {
  const mode = normalizePublicMode(PUBLIC_MODE);
  const cloudflared = getCloudflaredStatus();
  const consent = getPublicSharingConsent();
  const consentGranted = consent.granted || consent.dontAskAgain;
  const autoStartEnabled = getPublicSharingAutoStart();
  const consentRequired = mode === "quick" && !cloudflared.available && !consentGranted;
  if (mode === "off") {
    return { mode, state: "STOPPED", publicOrigin: null, lastError: null, lastCheckedAt: null, cloudflared, consentRequired: false, autoStartEnabled };
  }

  if (mode === "direct") {
    const origin = getDirectPublicOrigin();
    if (!origin) {
      return { mode, state: "ERROR", publicOrigin: null, lastError: "direct_mode_not_public", lastCheckedAt: null, cloudflared, consentRequired: false, autoStartEnabled };
    }
    return { mode, state: "ACTIVE", publicOrigin: origin, lastError: null, lastCheckedAt: null, cloudflared, consentRequired: false, autoStartEnabled };
  }

  if (mode === "named") {
    const tunnelName = String(process.env.CLOUDFLARE_TUNNEL_NAME || "").trim();
    const publicOrigin = String(process.env.CONTENTBOX_PUBLIC_ORIGIN || "").trim();
    if (!tunnelName || !publicOrigin) {
      return { mode, state: "ERROR", publicOrigin: null, lastError: "missing_named_tunnel_config", lastCheckedAt: null, cloudflared, consentRequired: false, autoStartEnabled };
    }
  }

  const base = tunnelManager.status();
  return {
    mode,
    state: base.status as PublicState,
    publicOrigin: base.status === "ACTIVE" ? base.publicOrigin : null,
    lastError: base.lastError || null,
    lastCheckedAt: toEpochMs(base.lastCheckedAt),
    cloudflared,
    consentRequired,
    autoStartEnabled
  };
}

async function triggerPublicStartBestEffort() {
  const mode = normalizePublicMode(PUBLIC_MODE);
  if (mode === "quick") {
    const prep = await tunnelManager.ensureBinary();
    if (!prep.ok) return;
    tunnelManager.startQuick().catch(() => {});
    return;
  }
  if (mode === "named") {
    const tunnelName = String(process.env.CLOUDFLARE_TUNNEL_NAME || "").trim();
    const publicOrigin = String(process.env.CONTENTBOX_PUBLIC_ORIGIN || "").trim();
    if (!tunnelName || !publicOrigin) return;
    tunnelManager
      .startNamed({
        publicOrigin,
        tunnelName,
        configPath: String(process.env.CLOUDFLARED_CONFIG_PATH || "").trim() || null
      })
      .catch(() => {});
  }
}

async function checkPublicPing(publicOrigin: string): Promise<boolean> {
  const base = publicOrigin.replace(/\/$/, "");
  try {
    const res = await fetchWithTimeout(`${base}/public/ping`, { method: "GET" } as any, 5000);
    return res.ok;
  } catch {
    return false;
  }
}

function getActivePublicOrigin(): string | null {
  const status = getPublicStatus();
  if (status.state === "ACTIVE" && status.publicOrigin) return status.publicOrigin;
  return null;
}

function isPublicCorsPath(url?: string) {
  if (!url) return false;
  return (
    url.startsWith("/auth/login") ||
    url.startsWith("/auth/register") ||
    url.startsWith("/embed.js") ||
    url.startsWith("/buy/") ||
    url.startsWith("/p2p/content/") ||
    url.startsWith("/p2p/payments/intents") ||
    url.startsWith("/public/receipts/")
  );
}

app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    if (process.env.NODE_ENV !== "production") {
      const devAllowed = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://192.168.100.109:5173"
      ];
      if (devAllowed.includes(origin)) return cb(null, true);
    }
    return cb(null, false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
  preflightContinue: false,
  optionsSuccessStatus: 204
});

app.register(jwt, { secret: JWT_SECRET });

app.register(multipart, {
  limits: {
    fileSize: 1024 * 1024 * 1024 // 1GB
  }
});

// Ensure BigInt values never crash JSON serialization.
app.addHook("preSerialization", async (_req, _reply, payload) => {
  if (typeof payload === "bigint") return payload.toString();
  if (!payload || typeof payload !== "object") return payload;
  try {
    return jsonSafe(payload);
  } catch {
    return payload;
  }
});

// Fallback: ensure BigInt never leaks into JSON responses.
app.addHook("onSend", async (_req, _reply, payload) => {
  return payload;
});

type JwtUser = { sub: string };

const requireAuth = async (req: any, reply: any) => {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "Unauthorized" });
  }
};

const optionalAuth = async (req: any, reply: any) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader) return;
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "Unauthorized" });
  }
};

async function ensureDirWritable(p: string) {
  await fs.mkdir(p, { recursive: true });
  const testFile = path.join(p, ".contentbox_write_test");
  await fs.writeFile(testFile, "ok", "utf8");
  await fs.unlink(testFile);
}

// Download an image URL and store it in CONTENTBOX_ROOT/avatars/<userId>/ with a safe filename.
async function fetchAndStoreAvatarForUser(userId: string, imageUrl: string) {
  if (!imageUrl) return null;
  try {
    const normalized = normalizeUrlString(imageUrl);
    if (!normalized) return null;
    const r = await fetch(normalized, { method: "GET" } as any);
    if (!r.ok) return null;

    const ct = r.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return null;

    // limit size to 2MB
    const MAX = 2 * 1024 * 1024;

    // stream and accumulate up to MAX bytes
    const reader = (r.body as any).getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.length;
        if (received > MAX) {
          // abort
          try { await reader.cancel(); } catch {}
          return null;
        }
        chunks.push(value);
      }
    }

    const buf = Buffer.concat(chunks as any);
    const sha = crypto.createHash("sha256").update(buf).digest("hex");

    // derive extension from content-type
    const ext = (() => {
      const m = (ct.match(/^image\/(png|jpeg|jpg|gif|webp|avif)/i) || [])[1];
      if (!m) return "";
      if (m === "jpeg") return ".jpg";
      return `.${m}`;
    })();

    const dir = path.join(CONTENTBOX_ROOT, "avatars", userId);
    await fs.mkdir(dir, { recursive: true });

    const filename = `${sha}${ext}`;
    const abs = path.join(dir, filename);

    // write file if not exists
    try {
      await fs.stat(abs);
    } catch {
      await fs.writeFile(abs, buf);
    }

    // return public URL
    return `${APP_BASE_URL}/public/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(filename)}`;
  } catch (e) {
    return null;
  }
}

/** ---------- manifest helpers ---------- */

type ManifestFile = { path?: string; filename?: string; originalName?: string; sha256?: string; sizeBytes?: number; mime?: string };
type Manifest = {
  version?: number;
  contentId?: string;
  title?: string;
  type?: string;
  primaryFile?: string | ManifestFile | null;
  files?: ManifestFile[];
};

async function readManifest(repoPath: string): Promise<Manifest | null> {
  try {
    const p = path.join(repoPath, "manifest.json");
    const raw = await fs.readFile(p, "utf8");
    const json = JSON.parse(raw);
    return json as Manifest;
  } catch {
    return null;
  }
}

function findManifestSha(manifest: Manifest | null, objectKey: string): string | null {
  if (!manifest?.files?.length) return null;
  const f = manifest.files.find((x) => x.path === objectKey);
  return f?.sha256 || null;
}

function getPrimaryObjectKey(manifest: Manifest | null): string | null {
  const p = manifest?.primaryFile;
  if (typeof p === "string") {
    const trimmed = p.trim();
    return trimmed ? trimmed : null;
  }
  if (p && typeof p === "object") {
    const key = typeof p.path === "string" ? p.path : typeof p.filename === "string" ? p.filename : null;
    if (key && key.trim()) return key.trim();
  }
  return null;
}

function getPrimaryFileInfo(manifest: Manifest | null): { objectKey: string | null; sha256: string | null; originalName: string | null } {
  if (!manifest) return { objectKey: null, sha256: null, originalName: null };

  const p = manifest.primaryFile;
  if (p && typeof p === "object") {
    const objectKey = typeof p.path === "string" ? p.path : typeof p.filename === "string" ? p.filename : null;
    const sha256 = typeof p.sha256 === "string" ? p.sha256 : null;
    const originalName = typeof p.originalName === "string" ? p.originalName : null;
    if (objectKey || sha256 || originalName) return { objectKey, sha256, originalName };
  }

  if (typeof p === "string") {
    const objectKey = p.trim() || null;
    const f = manifest.files?.find((x) => x.path === objectKey || x.filename === objectKey) || null;
    return {
      objectKey,
      sha256: (f?.sha256 as string) || null,
      originalName: (f?.originalName as string) || null
    };
  }

  const f = manifest.files?.[0] || null;
  return {
    objectKey: (f?.path as string) || (f?.filename as string) || null,
    sha256: (f?.sha256 as string) || null,
    originalName: (f?.originalName as string) || null
  };
}

function proofRelPath(versionNumber: number) {
  return path.posix.join("proofs", `v${versionNumber}`, "proof.json");
}

function proofAbsPath(repoPath: string, versionNumber: number) {
  return path.join(repoPath, "proofs", `v${versionNumber}`, "proof.json");
}

function parseSplitVersionParam(input: string): number | null {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return null;
  const n = raw.startsWith("v") ? raw.slice(1) : raw;
  const v = Number(n);
  if (!Number.isInteger(v) || v < 1) return null;
  return v;
}

async function openFolderPath(p: string) {
  const plat = process.platform;
  return new Promise<void>((resolve, reject) => {
    if (plat === "win32") {
      execFile("cmd", ["/c", "start", "", p], (err) => (err ? reject(err) : resolve()));
      return;
    }
    if (plat === "darwin") {
      execFile("open", [p], (err) => (err ? reject(err) : resolve()));
      return;
    }
    execFile("xdg-open", [p], (err) => (err ? reject(err) : resolve()));
  });
}

async function loadProofForSplitVersion(repoPath: string, versionNumber: number): Promise<any | null> {
  const abs = proofAbsPath(repoPath, versionNumber);
  if (!fsSync.existsSync(abs)) return null;
  try {
    const raw = await fs.readFile(abs, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function buildManifestJson(content: any, files: any[]) {
  const primaryFile = files?.[0]?.objectKey || null;
  return {
    contentId: content.id,
    title: content.title,
    description: content.description || null,
    type: content.type,
    status: content.status,
    createdAt: content.createdAt,
    primaryFile,
    files: files.map((f) => ({
      objectKey: f.objectKey,
      originalName: f.originalName,
      mime: f.mime,
      sizeBytes: typeof f.sizeBytes === "bigint" ? f.sizeBytes.toString() : String(f.sizeBytes ?? "0"),
      sha256: f.sha256,
      cipherSha256: f.cipherSha256 || null,
      createdAt: f.createdAt
    }))
  };
}

async function ensurePreviewFile(content: any, files: any[]) {
  try {
    if (!content?.repoPath) return null;
    if (!Array.isArray(files) || files.length === 0) return null;
    const primary = files[files.length - 1];
    const mime = String(primary?.mime || "").toLowerCase();
    if (!mime.startsWith("video/") && !mime.startsWith("audio/")) return null;

    const previewExt = mime.startsWith("video/") ? "mp4" : "mp3";
    const previewDir = "previews";
    const previewName = `${content.id}-preview.${previewExt}`;
    const previewObjectKey = `${previewDir}/${previewName}`;

    const repoRoot = path.resolve(content.repoPath);
    const previewAbs = path.resolve(repoRoot, previewObjectKey);
    if (fsSync.existsSync(previewAbs)) return previewObjectKey;

    const inputAbs = path.resolve(repoRoot, primary.objectKey || "");
    if (!inputAbs.startsWith(repoRoot)) return null;
    if (!fsSync.existsSync(inputAbs)) return null;

    const tmpOut = path.join(os.tmpdir(), `contentbox-preview-${content.id}.${previewExt}`);
    const ffmpegArgs = mime.startsWith("video/")
      ? [
          "-y",
          "-ss",
          "0",
          "-t",
          "20",
          "-i",
          inputAbs,
          "-vf",
          "scale='min(1280,iw)':-2",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "28",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          tmpOut
        ]
      : ["-y", "-ss", "0", "-t", "20", "-i", inputAbs, "-c:a", "libmp3lame", "-b:a", "128k", tmpOut];

    await execFileAsync("ffmpeg", ffmpegArgs);

    const stream = fsSync.createReadStream(tmpOut);
    const fileEntry = await addFileToContentRepo({
      repoPath: content.repoPath,
      contentTitle: content.title,
      originalName: previewName,
      mime: mime.startsWith("video/") ? "video/mp4" : "audio/mpeg",
      stream,
      setAsPrimary: false,
      preferMasterName: false
    });

    await prisma.contentFile.upsert({
      where: { contentId_objectKey: { contentId: content.id, objectKey: fileEntry.path } },
      update: {
        originalName: previewName,
        mime: mime.startsWith("video/") ? "video/mp4" : "audio/mpeg",
        sizeBytes: BigInt(fileEntry.sizeBytes || 0),
        sha256: fileEntry.sha256 || "",
        createdAt: new Date(fileEntry.committedAt)
      },
      create: {
        contentId: content.id,
        objectKey: fileEntry.path,
        originalName: previewName,
        mime: mime.startsWith("video/") ? "video/mp4" : "audio/mpeg",
        sizeBytes: BigInt(fileEntry.sizeBytes || 0),
        sha256: fileEntry.sha256 || "",
        encDek: "",
        encAlg: ""
      }
    });

    try {
      fsSync.unlinkSync(tmpOut);
    } catch {}

    return fileEntry.path || previewObjectKey;
  } catch (e: any) {
    app.log.warn({ err: e }, "preview.generate.failed");
    return null;
  }
}

function hashManifestJson(manifestJson: any): string {
  return crypto.createHash("sha256").update(stableStringify(manifestJson)).digest("hex");
}

async function findProofByHashForUser(userId: string, proofHash: string) {
  const events = await prisma.auditEvent.findMany({
    where: { userId, action: "split.lock" },
    orderBy: { createdAt: "desc" }
  });

  for (const ev of events) {
    const payload: any = (ev as any).payloadJson || null;
    if (!payload || payload.proofHash !== proofHash) continue;

    const sv = await prisma.splitVersion.findUnique({
      where: { id: ev.entityId },
      include: { content: true }
    });
    if (!sv || !sv.content || sv.content.ownerUserId !== userId) continue;
    if (!sv.content.repoPath) continue;

    const proof = await loadProofForSplitVersion(sv.content.repoPath, sv.versionNumber);
    if (proof && proof.proofHash === proofHash) {
      return { proof, splitVersion: sv, content: sv.content };
    }
  }
  return null;
}

async function getRateSatsPerUnitForContent(repoPath: string): Promise<number> {
  const manifest = await readManifest(repoPath);
  const rate = Number((manifest as any)?.payments?.rateSatsPerUnit);
  if (Number.isFinite(rate) && rate > 0) return Math.floor(rate);
  if (Number.isFinite(DEFAULT_RATE_SATS_PER_UNIT) && DEFAULT_RATE_SATS_PER_UNIT > 0) return Math.floor(DEFAULT_RATE_SATS_PER_UNIT);
  return 100;
}

/** ---------- splits validation (strict TS safe) ---------- */

type ParticipantNormalized = { participantEmail: string; role: string; percent: number; bps: number };
type ParticipantInput = { participantEmail?: unknown; role?: unknown; percent?: unknown };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function toParticipantNormalized(p: unknown): ParticipantNormalized | null {
  if (!isRecord(p)) return null;

  const pi = p as ParticipantInput;
  const participantEmail = normalizeEmail(pi.participantEmail);
  const role = asString(pi.role).trim();
  const percent = round3(num(pi.percent));
  const bps = Math.round(percent * 100);

  if (!participantEmail || !role) return null;
  return { participantEmail, role, percent, bps };
}

function canonicalParticipantsForHash(participants: ParticipantNormalized[]): ParticipantNormalized[] {
  return [...participants].sort((a, b) => a.participantEmail.localeCompare(b.participantEmail));
}

function participantsHash(participants: ParticipantNormalized[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalParticipantsForHash(participants))).digest("hex");
}

function validateAndNormalizeParticipants(body: unknown):
  | { ok: true; participants: ParticipantNormalized[]; hash: string }
  | { ok: false; error: string } {
  const participantsRaw: unknown[] = (() => {
    if (!isRecord(body)) return [];
    const p = (body as Record<string, unknown>).participants;
    return Array.isArray(p) ? p : [];
  })();

  if (participantsRaw.length === 0) return { ok: false, error: "participants required" };

  const parsed: ParticipantNormalized[] = participantsRaw
    .map((x: unknown) => toParticipantNormalized(x))
    .filter((x: ParticipantNormalized | null): x is ParticipantNormalized => Boolean(x));

  if (parsed.length === 0) return { ok: false, error: "participants required" };

  // De-dupe by email (keep last)
  const deduped = Array.from(new Map(parsed.map((p) => [p.participantEmail, p])).values());

  const total = round3(deduped.reduce((s, p) => s + num(p.percent), 0));
  if (total !== 100) return { ok: false, error: `Split percent must total 100. Current total=${total}` };

  const participants = canonicalParticipantsForHash(deduped);
  return { ok: true, participants, hash: participantsHash(participants) };
}

/** ---------- invites helpers ---------- */

function makeInviteToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function hashInviteToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** ---------- clearance helpers ---------- */

function makeApprovalToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function hashApprovalToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** ---------- routes ---------- */

function registerPublicRoutes(appPublic: any) {
  appPublic.get("/public/ping", handlePublicPing);
  appPublic.get("/p/:token", handleShortPublicLink);
  appPublic.get("/buy/:contentId", handleBuyPage);
  appPublic.get("/buy/content/:contentId/offer", handlePublicOffer);
  appPublic.get("/buy/content/:id/preview-file", handlePublicPreviewFile);
  appPublic.post("/buy/payments/intents", handlePublicPaymentsIntents);
  appPublic.post("/buy/permits", handlePublicPermits);
  appPublic.get("/buy/receipts/:receiptToken/status", handlePublicReceiptStatus);
  appPublic.get("/buy/receipts/:receiptToken/fulfill", handlePublicReceiptFulfill);
  appPublic.get("/buy/receipts/:receiptToken/file", handlePublicReceiptFile);
}

function handlePublicPing(_req: any, reply: any) {
  return reply.send({ ok: true, ts: new Date().toISOString() });
}

app.get("/health", async () => ({ ok: true }));
app.get("/public/ping", async (_req: any, reply: any) => {
  return reply.send({ ok: true, ts: new Date().toISOString() });
});

// Public capabilities (non-sensitive)
app.get("/api/capabilities", async (_req: any, reply: any) => {
  const provider = String(process.env.PUBLIC_TUNNEL_PROVIDER || "cloudflare").trim() || "cloudflare";
  return reply.send({
    ok: true,
    cloudflaredInstalled: hasCloudflaredBinary(),
    publicSharing: {
      provider,
      quickTunnelSupported: true
    }
  });
});

// Public node discovery endpoint to support basic P2P verification
app.get("/.well-known/contentbox", async (req: any, reply: any) => {
  // include node public key for verification
  try {
    const pubPath = path.join(CONTENTBOX_ROOT, ".node", "node_public.pem");
    const pub = await fs.readFile(pubPath, "utf8");
    return reply.send({ nodeUrl: APP_BASE_URL, version: "1", publicKeyPem: pub });
  } catch {
    return reply.send({ nodeUrl: APP_BASE_URL, version: "1" });
  }
});

// Public user profile lookup (minimal, intentionally public to allow cross-node verification)
async function handlePublicUser(req: any, reply: any) {
  const id = asString((req.params as any).id);
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true, displayName: true, email: true, createdAt: true } });
  if (!u) return notFound(reply, "User not found");
  // Only return non-sensitive fields
  return reply.send({ id: u.id, displayName: u.displayName, createdAt: u.createdAt });
}

app.get("/public/users/:id", handlePublicUser);

// Local node: sign an acceptance payload for a token (used when accepting on a remote owner node)
app.post("/local/sign-acceptance", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const token = asString((req.body ?? {})?.token || "");
  if (!token) return badRequest(reply, "token required");

  const userId = (req.user as JwtUser).sub;

  const payload = { token, remoteUserId: userId, nodeUrl: APP_BASE_URL, ts: new Date().toISOString() };
  const payloadStr = JSON.stringify(payload);

  try {
    const privPath = path.join(CONTENTBOX_ROOT, ".node", "node_private.pem");
    const privPem = await fs.readFile(privPath, "utf8");
    const sigBuf = (crypto.sign as any)(null, Buffer.from(payloadStr), privPem) as Buffer;
    const signature = sigBuf.toString("base64");
    return reply.send({ payload, signature });
  } catch (e: any) {
    return reply.code(500).send({ error: String((e as any)?.message || String(e)) });
  }
});

// Get audit events for a split version
app.get("/split-versions/:id/audit", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const splitVersionId = asString((req.params as any).id);

  const sv = await prisma.splitVersion.findUnique({ where: { id: splitVersionId }, include: { content: true } });
  if (!sv) return notFound(reply, "Split version not found");
  if (sv.content.ownerUserId !== userId) {
    const ok = await isAcceptedParticipant(userId, sv.contentId);
    if (!ok) return forbidden(reply);
  }

  const events = await prisma.auditEvent.findMany({
    where: { entityType: "SplitVersion", entityId: splitVersionId },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, email: true, displayName: true } } }
  });

  return reply.send(
    events.map((e) => ({
      id: e.id,
      action: e.action,
      payload: e.payloadJson || null,
      userId: e.userId,
      user: e.user ? { id: e.user.id, email: e.user.email, displayName: e.user.displayName } : null,
      createdAt: e.createdAt ? e.createdAt.toISOString() : null
    }))
  );
});

// Alias: splits audit (same as split-versions)
app.get("/splits/:id/audit", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const splitVersionId = asString((req.params as any).id);

  const sv = await prisma.splitVersion.findUnique({ where: { id: splitVersionId }, include: { content: true } });
  if (!sv) return notFound(reply, "Split version not found");
  if (sv.content.ownerUserId !== userId) {
    const ok = await isAcceptedParticipant(userId, sv.contentId);
    if (!ok) return forbidden(reply);
  }

  const events = await prisma.auditEvent.findMany({
    where: { entityType: "SplitVersion", entityId: splitVersionId },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, email: true, displayName: true } } }
  });

  return reply.send(
    events.map((e) => ({
      id: e.id,
      action: e.action,
      payload: e.payloadJson || null,
      userId: e.userId,
      user: e.user ? { id: e.user.id, email: e.user.email, displayName: e.user.displayName } : null,
      createdAt: e.createdAt ? e.createdAt.toISOString() : null
    }))
  );
});

// Content audit history (owner only)
app.get("/content/:id/audit", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.deletedAt) return notFound(reply, "Not found");
  if (content.ownerUserId !== userId) return forbidden(reply);

  const events = await prisma.auditEvent.findMany({
    where: { entityType: "ContentItem", entityId: contentId },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, email: true, displayName: true } } }
  });

  return reply.send(
    events.map((e) => ({
      id: e.id,
      action: e.action,
      payload: e.payloadJson || null,
      userId: e.userId,
      user: e.user ? { id: e.user.id, email: e.user.email, displayName: e.user.displayName } : null,
      createdAt: e.createdAt ? e.createdAt.toISOString() : null
    }))
  );
});

// Scoped content history feed (content lifecycle + related split actions)
app.get("/content/:id/history", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) {
    const ok = await isAcceptedParticipant(userId, contentId);
    if (!ok) return forbidden(reply);
  }

  const contentEvents = await prisma.auditEvent.findMany({
    where: { entityType: "ContentItem", entityId: contentId },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, email: true, displayName: true } } }
  });

  const splitVersions = await prisma.splitVersion.findMany({
    where: { contentId },
    select: { id: true, versionNumber: true }
  });
  const splitVersionMap = new Map(splitVersions.map((v) => [v.id, v.versionNumber]));
  const splitEvents = splitVersions.length
    ? await prisma.auditEvent.findMany({
        where: { entityType: "SplitVersion", entityId: { in: splitVersions.map((v) => v.id) } },
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, email: true, displayName: true } } }
      })
    : [];

  const events: HistoryEvent[] = [
    ...contentEvents.map((e) => ({
      id: `content:${e.id}`,
      ts: e.createdAt.toISOString(),
      category: "content",
      type: e.action,
      title: e.action.replace(/\./g, " "),
      summary: content.title || "Content",
      actor: actorFromUser(e.user),
      details: e.payloadJson || null
    })),
    ...splitEvents.map((e) => ({
      id: `split:${e.id}`,
      ts: e.createdAt.toISOString(),
      category: "split",
      type: e.action,
      title: `Split v${splitVersionMap.get(e.entityId) || "?"} • ${e.action.replace(/\./g, " ")}`,
      summary: content.title || "Content",
      actor: actorFromUser(e.user),
      details: e.payloadJson || null,
      diff: (e.payloadJson as any)?.diff || null
    }))
  ].sort((a, b) => (a.ts < b.ts ? 1 : -1));

  return reply.send(jsonSafe(events));
});

// Scoped split history feed (all split versions for a content item)
app.get("/content/:id/split-history", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) {
    const ok = await isAcceptedParticipant(userId, contentId);
    if (!ok) return forbidden(reply);
  }

  const splitVersions = await prisma.splitVersion.findMany({
    where: { contentId },
    select: { id: true, versionNumber: true }
  });
  const splitVersionMap = new Map(splitVersions.map((v) => [v.id, v.versionNumber]));
  const events = splitVersions.length
    ? await prisma.auditEvent.findMany({
        where: { entityType: "SplitVersion", entityId: { in: splitVersions.map((v) => v.id) } },
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, email: true, displayName: true } } }
      })
    : [];

  const out: HistoryEvent[] = events.map((e) => ({
    id: `split:${e.id}`,
    ts: e.createdAt.toISOString(),
    category: "split",
    type: e.action,
    title: `Split v${splitVersionMap.get(e.entityId) || "?"} • ${e.action.replace(/\./g, " ")}`,
    summary: content.title || "Content",
    actor: actorFromUser(e.user),
    details: e.payloadJson || null,
    diff: (e.payloadJson as any)?.diff || null
  }));

  return reply.send(jsonSafe(out));
});

// Scoped royalty history for current user
app.get("/me/royalty-history", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, displayName: true } });
  if (!me) return reply.send([]);

  const participantRows = await prisma.splitParticipant.findMany({
    where: {
      OR: [
        { participantUserId: userId },
        me.email ? { participantEmail: { equals: me.email, mode: "insensitive" } } : undefined
      ].filter(Boolean) as any
    },
    select: { id: true }
  });
  const participantIds = participantRows.map((p) => p.id);
  if (participantIds.length === 0 && !me.email) {
    return reply.send([]);
  }

  const settlementLines = await prisma.settlementLine.findMany({
    where: {
      OR: [
        participantIds.length ? { participantId: { in: participantIds } } : undefined,
        me.email ? { participantEmail: { equals: me.email, mode: "insensitive" } } : undefined
      ].filter(Boolean) as any
    },
    include: {
      settlement: { include: { payment: true, content: { include: { owner: true } }, lines: true } }
    }
  });

  const settlementMap = new Map<string, typeof settlementLines[0]["settlement"]>();
  for (const l of settlementLines) {
    if (l.settlement) settlementMap.set(l.settlement.id, l.settlement);
  }

  const settlementEvents: HistoryEvent[] = Array.from(settlementMap.values()).map((s) => {
    const total = s.payment?.amountSats ? BigInt(s.payment.amountSats as any) : BigInt(0);
    const sumLines = s.lines.reduce((acc, ln) => acc + BigInt(ln.amountSats as any), BigInt(0));
    const totalsMatch = total === sumLines;
    return {
      id: `settlement:${s.id}`,
      ts: s.createdAt.toISOString(),
      category: "royalty",
      type: "settlement.created",
      title: `Settlement • ${s.content?.title || "Content"}`,
      summary: `${sumLines.toString()} sats`,
      actor: actorFromUser(s.content?.owner ? { id: s.content.owner.id, email: s.content.owner.email, displayName: s.content.owner.displayName } : null),
      details: {
        paymentIntentId: s.paymentIntentId,
        amountSats: total.toString(),
        lines: s.lines.map((ln) => ({
          participantId: ln.participantId || null,
          participantEmail: ln.participantEmail || null,
          role: ln.role || null,
          amountSats: BigInt(ln.amountSats as any).toString()
        }))
      },
      diff: { totalsMatch }
    };
  });

  const paymentIntents = await prisma.paymentIntent.findMany({
    where: { buyerUserId: userId },
    include: { content: true }
  });

  const paymentEvents: HistoryEvent[] = paymentIntents.map((p) => ({
    id: `payment:${p.id}`,
    ts: p.createdAt.toISOString(),
    category: "royalty",
    type: "payment.intent",
    title: `Purchase • ${p.content?.title || "Content"}`,
    summary: `${BigInt(p.amountSats as any).toString()} sats • ${p.status}`,
    actor: actorFromUser(me),
    details: {
      amountSats: BigInt(p.amountSats as any).toString(),
      status: p.status,
      purpose: p.purpose,
      paidAt: p.paidAt ? p.paidAt.toISOString() : null
    }
  }));

  const out = [...settlementEvents, ...paymentEvents].sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return reply.send(jsonSafe(out));
});

// Scoped clearance history for a derivative link
app.get("/content-links/:id/clearance-history", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const linkId = asString((req.params as any).id);

  const link = await prisma.contentLink.findUnique({
    where: { id: linkId },
    include: {
      parentContent: { select: { id: true, title: true, ownerUserId: true } },
      childContent: { select: { id: true, title: true, ownerUserId: true } },
      approvedBy: { select: { id: true, email: true, displayName: true } }
    }
  });
  if (!link) return notFound(reply, "Link not found");
  if (link.parentContent?.ownerUserId !== userId && link.childContent?.ownerUserId !== userId) return forbidden(reply);

  const requests = await prisma.clearanceRequest.findMany({
    where: { contentLinkId: linkId },
    orderBy: { createdAt: "desc" }
  });
  const tokens = await prisma.approvalToken.findMany({
    where: { contentLinkId: linkId },
    orderBy: { createdAt: "desc" }
  });

  const events: HistoryEvent[] = [];
  for (const r of requests) {
    events.push({
      id: `clearance.request:${r.id}`,
      ts: r.createdAt.toISOString(),
      category: "clearance",
      type: "clearance.requested",
      title: `Clearance requested • ${link.childContent?.title || "Derivative"}`,
      summary: r.status,
      actor: actorFromUser(r.requestedByUserId ? { id: r.requestedByUserId } as any : null),
      details: { status: r.status }
    });
    if (r.reviewGrantedAt) {
      events.push({
        id: `clearance.reviewGranted:${r.id}`,
        ts: r.reviewGrantedAt.toISOString(),
        category: "clearance",
        type: "clearance.reviewGranted",
        title: "Preview access granted",
        summary: null,
        actor: r.reviewGrantedByUserId ? actorFromUser({ id: r.reviewGrantedByUserId } as any) : null
      });
    }
  }

  for (const t of tokens) {
    events.push({
      id: `clearance.token:${t.id}`,
      ts: t.createdAt.toISOString(),
      category: "clearance",
      type: "clearance.token.created",
      title: "Approval token issued",
      summary: t.approverEmail,
      actor: actorExternal(t.approverEmail),
      details: { expiresAt: t.expiresAt.toISOString() }
    });
    if (t.usedAt) {
      events.push({
        id: `clearance.vote:${t.id}`,
        ts: t.usedAt.toISOString(),
        category: "clearance",
        type: "clearance.vote",
        title: `Vote ${t.decision || "UNKNOWN"}`,
        summary: t.approverEmail,
        actor: actorExternal(t.approverEmail),
        details: {
          decision: t.decision,
          upstreamRatePercent: t.upstreamRatePercent ? String(t.upstreamRatePercent) : null
        }
      });
    }
  }

  if (link.approvedAt) {
    events.push({
      id: `clearance.cleared:${link.id}`,
      ts: link.approvedAt.toISOString(),
      category: "clearance",
      type: "clearance.cleared",
      title: "Cleared for public release",
      summary: `${(link.upstreamBps || 0) / 100}% upstream`,
      actor: actorFromUser(link.approvedBy ? { id: link.approvedBy.id, email: link.approvedBy.email, displayName: link.approvedBy.displayName } : null),
      details: { upstreamBps: link.upstreamBps }
    });
  }

  events.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return reply.send(jsonSafe(events));
});

// Scoped invite history for current user
app.get("/me/invite-history", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, displayName: true } });
  if (!me) return reply.send([]);

  const invites = await prisma.invitation.findMany({
    where: {
      OR: [
        { splitParticipant: { splitVersion: { content: { ownerUserId: userId } } } },
        { splitParticipant: { participantUserId: userId } },
        me.email ? { splitParticipant: { participantEmail: { equals: me.email, mode: "insensitive" } } } : undefined
      ].filter(Boolean) as any
    },
    include: {
      splitParticipant: { include: { splitVersion: { include: { content: true } } } }
    },
    orderBy: { createdAt: "desc" }
  });

  const events: HistoryEvent[] = [];
  for (const inv of invites) {
    const contentTitle = inv.splitParticipant?.splitVersion?.content?.title || "Content";
    const ownerId = inv.splitParticipant?.splitVersion?.content?.ownerUserId || null;
    if (ownerId === userId) {
      events.push({
        id: `invite.sent:${inv.id}`,
        ts: inv.createdAt.toISOString(),
        category: "invite",
        type: "invite.sent",
        title: `Invite sent • ${contentTitle}`,
        summary: inv.splitParticipant?.participantEmail || null,
        actor: actorFromUser(me),
        details: { expiresAt: inv.expiresAt.toISOString() }
      });
    }
    events.push({
      id: `invite.received:${inv.id}`,
      ts: inv.createdAt.toISOString(),
      category: "invite",
      type: "invite.received",
      title: `Invite received • ${contentTitle}`,
      summary: inv.splitParticipant?.participantEmail || null,
      actor: actorFromUser(me),
      details: { expiresAt: inv.expiresAt.toISOString() }
    });
    if (inv.acceptedAt) {
      events.push({
        id: `invite.accepted:${inv.id}`,
        ts: inv.acceptedAt.toISOString(),
        category: "invite",
        type: "invite.accepted",
        title: `Invite accepted • ${contentTitle}`,
        summary: inv.splitParticipant?.participantEmail || null,
        actor: actorFromUser(me)
      });
    }
  }

  events.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return reply.send(jsonSafe(events));
});

// Unified audit endpoint (evidence-grade)
app.get("/audit", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const q = (req.query || {}) as { scopeType?: string; scopeId?: string };
  const scopeType = asString(q.scopeType || "").trim();
  const scopeId = asString(q.scopeId || "").trim() || null;

  if (!scopeType) return badRequest(reply, "scopeType required");

  const events: AuditEventOut[] = [];

  if (scopeType === "content" && scopeId) {
    const content = await prisma.contentItem.findUnique({ where: { id: scopeId }, include: { owner: true } });
    if (!content) return notFound(reply, "Content not found");
    if (content.ownerUserId !== userId) {
      const ok = await isAcceptedParticipant(userId, content.id);
      if (!ok) return forbidden(reply);
    }

    events.push({
      id: `content.snapshot:${content.id}`,
      ts: content.createdAt.toISOString(),
      type: "content.snapshot",
      summary: content.title,
      actor: actorFromUser(content.owner ? { id: content.owner.id, email: content.owner.email, displayName: content.owner.displayName } : null),
      details: {
        id: content.id,
        ownerUserId: content.ownerUserId,
        type: content.type,
        status: content.status,
        storefrontStatus: content.storefrontStatus,
        createdAt: content.createdAt.toISOString()
      }
    });

    const files = await prisma.contentFile.findMany({ where: { contentId: content.id }, orderBy: { createdAt: "desc" } });
    files.forEach((f) => {
      events.push({
        id: `file:${f.id}`,
        ts: f.createdAt.toISOString(),
        type: "content.file",
        summary: f.originalName || f.objectKey,
        details: {
          objectKey: f.objectKey,
          originalName: f.originalName,
          mime: f.mime,
          sizeBytes: f.sizeBytes ? f.sizeBytes.toString() : null,
          sha256: f.sha256,
          createdAt: f.createdAt.toISOString()
        }
      });
    });

    const audits = await prisma.auditEvent.findMany({
      where: { entityType: "ContentItem", entityId: content.id },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, email: true, displayName: true } } }
    });
    audits.forEach((e) => {
      events.push({
        id: `content.audit:${e.id}`,
        ts: e.createdAt.toISOString(),
        type: e.action,
        summary: content.title,
        actor: actorFromUser(e.user),
        details: e.payloadJson || null
      });
    });
  } else if (scopeType === "split") {
    if (!scopeId) {
      const splitVersions = await prisma.splitVersion.findMany({
        where: {
          content: {
            OR: [
              { ownerUserId: userId },
              { splitVersions: { some: { participants: { some: { participantUserId: userId, acceptedAt: { not: null } } } } } }
            ]
          }
        },
        include: { content: true, participants: true },
        orderBy: { createdAt: "desc" },
        take: 25
      });

      splitVersions.forEach((sv) => {
        events.push({
          id: `split.snapshot:${sv.id}`,
          ts: sv.createdAt.toISOString(),
          type: "split.snapshot",
          summary: sv.content.title,
          details: {
            splitVersionId: sv.id,
            versionNumber: sv.versionNumber,
            status: sv.status,
            lockedAt: sv.lockedAt ? sv.lockedAt.toISOString() : null,
            participants: sv.participants.map((p) => ({
              id: p.id,
              participantEmail: p.participantEmail,
              participantUserId: p.participantUserId,
              role: p.role,
              bps: p.bps,
              percent: String(p.percent),
              acceptedAt: p.acceptedAt ? p.acceptedAt.toISOString() : null
            }))
          }
        });
      });
    } else {
      const sv = await prisma.splitVersion.findUnique({
        where: { id: scopeId },
        include: { content: true, participants: true }
      });
      if (!sv) return notFound(reply, "Split version not found");
    if (sv.content.ownerUserId !== userId) {
      const ok = await isAcceptedParticipant(userId, sv.contentId);
      if (!ok) return forbidden(reply);
    }

    events.push({
      id: `split.snapshot:${sv.id}`,
      ts: sv.createdAt.toISOString(),
      type: "split.snapshot",
      summary: sv.content.title,
      details: {
        splitVersionId: sv.id,
        versionNumber: sv.versionNumber,
        status: sv.status,
        lockedAt: sv.lockedAt ? sv.lockedAt.toISOString() : null,
        participants: sv.participants.map((p) => ({
          id: p.id,
          participantEmail: p.participantEmail,
          participantUserId: p.participantUserId,
          role: p.role,
          bps: p.bps,
          percent: String(p.percent),
          acceptedAt: p.acceptedAt ? p.acceptedAt.toISOString() : null
        }))
      }
    });

      const audits = await prisma.auditEvent.findMany({
        where: { entityType: "SplitVersion", entityId: sv.id },
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, email: true, displayName: true } } }
      });
      audits.forEach((e) => {
        events.push({
          id: `split.audit:${e.id}`,
          ts: e.createdAt.toISOString(),
          type: e.action,
          summary: sv.content.title,
          actor: actorFromUser(e.user),
          details: e.payloadJson || null,
          diff: (e.payloadJson as any)?.diff || null
        });
      });
    }
  } else if (scopeType === "invite") {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, displayName: true } });
    const invites = await prisma.invitation.findMany({
      where: {
        OR: [
          { splitParticipant: { splitVersion: { content: { ownerUserId: userId } } } },
          { splitParticipant: { participantUserId: userId } },
          me?.email ? { splitParticipant: { participantEmail: { equals: me.email, mode: "insensitive" } } } : undefined
        ].filter(Boolean) as any
      },
      include: { splitParticipant: { include: { splitVersion: { include: { content: true } } } } },
      orderBy: { createdAt: "desc" }
    });

    invites.forEach((inv) => {
      events.push({
        id: `invite:${inv.id}`,
        ts: inv.createdAt.toISOString(),
        type: "invite",
        summary: inv.splitParticipant?.participantEmail || null,
        actor: actorFromUser(me ? { id: me.id, email: me.email, displayName: me.displayName } : null),
        details: {
          id: inv.id,
          splitParticipantId: inv.splitParticipantId,
          contentId: inv.splitParticipant?.splitVersion?.contentId,
          contentTitle: inv.splitParticipant?.splitVersion?.content?.title,
          expiresAt: inv.expiresAt.toISOString(),
          acceptedAt: inv.acceptedAt ? inv.acceptedAt.toISOString() : null
        }
      });
    });
  } else if (scopeType === "royalty") {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, displayName: true } });
    const participantRows = await prisma.splitParticipant.findMany({
      where: {
        OR: [
          { participantUserId: userId },
          me?.email ? { participantEmail: { equals: me.email, mode: "insensitive" } } : undefined
        ].filter(Boolean) as any
      },
      select: { id: true }
    });
    const participantIds = participantRows.map((p) => p.id);
    const lines = await prisma.settlementLine.findMany({
      where: {
        OR: [
          participantIds.length ? { participantId: { in: participantIds } } : undefined,
          me?.email ? { participantEmail: { equals: me.email, mode: "insensitive" } } : undefined
        ].filter(Boolean) as any
      },
      include: {
        settlement: { include: { payment: true, content: true, lines: true } }
      }
    });
    const settlementMap = new Map<string, typeof lines[0]["settlement"]>();
    lines.forEach((l) => {
      if (l.settlement) settlementMap.set(l.settlement.id, l.settlement);
    });
    for (const s of settlementMap.values()) {
      const total = s.payment?.amountSats ? BigInt(s.payment.amountSats as any) : BigInt(0);
      const sumLines = s.lines.reduce((acc, ln) => acc + BigInt(ln.amountSats as any), BigInt(0));
      events.push({
        id: `settlement:${s.id}`,
        ts: s.createdAt.toISOString(),
        type: "settlement",
        summary: s.content?.title || null,
        details: {
          amountSats: total.toString(),
          totalsMatch: total === sumLines,
          lines: s.lines.map((ln) => ({
            participantId: ln.participantId || null,
            participantEmail: ln.participantEmail || null,
            role: ln.role || null,
            amountSats: BigInt(ln.amountSats as any).toString()
          }))
        }
      });
    }
  } else if (scopeType === "clearance" && scopeId) {
    const link = await prisma.contentLink.findUnique({
      where: { id: scopeId },
      include: { parentContent: true, childContent: true }
    });
    if (!link) return notFound(reply, "Link not found");
    if (link.parentContent?.ownerUserId !== userId && link.childContent?.ownerUserId !== userId) return forbidden(reply);

    events.push({
      id: `clearance.link:${link.id}`,
      ts: (link.approvedAt || link.childContent?.createdAt || new Date()).toISOString(),
      type: "clearance.link",
      summary: link.childContent?.title || null,
      details: {
        contentLinkId: link.id,
        parentContentId: link.parentContentId,
        childContentId: link.childContentId,
        requiresApproval: link.requiresApproval,
        upstreamBps: link.upstreamBps,
        approvedAt: link.approvedAt ? link.approvedAt.toISOString() : null
      }
    });

    const tokens = await prisma.approvalToken.findMany({ where: { contentLinkId: link.id }, orderBy: { createdAt: "desc" } });
    tokens.forEach((t) => {
      events.push({
        id: `clearance.token:${t.id}`,
        ts: t.createdAt.toISOString(),
        type: "clearance.vote",
        summary: t.approverEmail,
        actor: actorExternal(t.approverEmail),
        details: {
          decision: t.decision,
          weightBps: t.weightBps,
          upstreamRatePercent: t.upstreamRatePercent ? String(t.upstreamRatePercent) : null,
          usedAt: t.usedAt ? t.usedAt.toISOString() : null
        }
      });
    });
  } else if (scopeType === "identity") {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.send({ ok: true, scopeType, scopeId, audit: [] });
    events.push({
      id: `identity:${user.id}`,
      ts: user.createdAt.toISOString(),
      type: "identity.snapshot",
      summary: user.email,
      details: {
        id: user.id,
        email: user.email,
        displayName: user.displayName || null,
        avatarUrl: user.avatarUrl || null
      }
    });
  } else if (scopeType === "library") {
    const content = await prisma.contentItem.findMany({
      where: { ownerUserId: userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 25
    });
    content.forEach((c) => {
      events.push({
        id: `library:${c.id}`,
        ts: c.createdAt.toISOString(),
        type: "content.created",
        summary: c.title,
        details: { id: c.id, type: c.type, status: c.status, storefrontStatus: c.storefrontStatus }
      });
    });
  } else {
    return badRequest(reply, "Unsupported scopeType");
  }

  events.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return reply.send(jsonSafe({ ok: true, scopeType, scopeId, audit: events }));
});

// Invite audit history (owner only)
app.get("/invites/:id/audit", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const inviteId = asString((req.params as any).id);

  const inv = await prisma.invitation.findUnique({
    where: { id: inviteId },
    include: { splitParticipant: { include: { splitVersion: { include: { content: true } } } } }
  });
  if (!inv) return notFound(reply, "Invite not found");

  // If expired, log once for audit (owner id)
  try {
    if (inv.expiresAt.getTime() < Date.now()) {
      const ownerId = inv.splitParticipant?.splitVersion?.content?.ownerUserId || "";
      if (ownerId) {
        const prior = await prisma.auditEvent.findFirst({
          where: { entityType: "Invitation", entityId: inv.id, action: "invite.expire" }
        });
        if (!prior) {
          await prisma.auditEvent.create({
            data: {
              userId: ownerId,
              action: "invite.expire",
              entityType: "Invitation",
              entityId: inv.id,
              payloadJson: { expiresAt: inv.expiresAt } as any
            }
          });
        }
      }
    }
  } catch {}
  if (inv.splitParticipant?.splitVersion?.content?.ownerUserId !== userId) return forbidden(reply);

  const events = await prisma.auditEvent.findMany({
    where: { entityType: "Invitation", entityId: inviteId },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, email: true, displayName: true } } }
  });

  return reply.send(
    events.map((e) => ({
      id: e.id,
      action: e.action,
      payload: e.payloadJson || null,
      userId: e.userId,
      user: e.user ? { id: e.user.id, email: e.user.email, displayName: e.user.displayName } : null,
      createdAt: e.createdAt
    }))
  );
});

/**
 * AUTH
 */
app.post("/auth/signup", async (req, reply) => {
  const body = (req.body ?? {}) as { email?: string; password?: string; displayName?: string };

  const email = normalizeEmail(body?.email);
  const password = body?.password;

  if (!email || !password) return badRequest(reply, "email and password are required");
  if (password.length < 8) return badRequest(reply, "password must be at least 8 characters");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return reply.code(409).send({ error: "email already in use" });

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      displayName: body.displayName?.trim() || null,
      passwordHash
    },
    select: { id: true, email: true, displayName: true, createdAt: true }
  });

  const token = app.jwt.sign({ sub: user.id });
  return reply.send({ token, user });
});

// List invitations for content owned by the authenticated user (no token values are returned)
app.get("/my/invitations", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;

  const invites = await prisma.invitation.findMany({
    where: {
      splitParticipant: {
        splitVersion: {
          content: { ownerUserId: userId }
        }
      }
    },
    include: {
      splitParticipant: { include: { splitVersion: { include: { content: true } } } }
    },
    orderBy: { createdAt: "desc" }
  });

  const out = invites.map((inv) => ({
    id: inv.id,
    splitParticipantId: inv.splitParticipantId,
    participantEmail: inv.splitParticipant?.participantEmail || null,
    contentId: inv.splitParticipant?.splitVersion?.contentId || null,
    contentTitle: inv.splitParticipant?.splitVersion?.content?.title || null,
    splitVersionId: inv.splitParticipant?.splitVersionId || null,
    expiresAt: inv.expiresAt.toISOString(),
    acceptedAt: inv.acceptedAt ? inv.acceptedAt.toISOString() : null,
    createdAt: inv.createdAt.toISOString()
  }));

  return reply.send(out);
});

// List invitations received by the authenticated user (matched by participantUserId or email)
app.get("/my/invitations/received", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, displayName: true } });
  if (!me?.email) return reply.send([]);

  const invites = await prisma.invitation.findMany({
    where: {
      OR: [
        { splitParticipant: { participantUserId: userId } },
        { splitParticipant: { participantEmail: { equals: me.email, mode: "insensitive" } } }
      ]
    },
    include: {
      splitParticipant: { include: { splitVersion: { include: { content: { include: { owner: true } } } } } }
    },
    orderBy: { createdAt: "desc" }
  });

  const out = invites.map((inv) => ({
    id: inv.id,
    splitParticipantId: inv.splitParticipantId,
    participantEmail: inv.splitParticipant?.participantEmail || null,
    role: inv.splitParticipant?.role || null,
    percent: percentToPrimitive(inv.splitParticipant?.percent ?? null),
    contentId: inv.splitParticipant?.splitVersion?.contentId || null,
    contentTitle: inv.splitParticipant?.splitVersion?.content?.title || null,
    splitVersionId: inv.splitParticipant?.splitVersionId || null,
    ownerUserId: inv.splitParticipant?.splitVersion?.content?.ownerUserId || null,
    ownerDisplayName: inv.splitParticipant?.splitVersion?.content?.owner?.displayName || null,
    ownerEmail: inv.splitParticipant?.splitVersion?.content?.owner?.email || null,
    expiresAt: inv.expiresAt.toISOString(),
    acceptedAt: inv.acceptedAt ? inv.acceptedAt.toISOString() : null,
    createdAt: inv.createdAt.toISOString()
  }));

  return reply.send(out);
});

// List accepted split participations for the authenticated user
app.get("/my/split-participations", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const email = (me?.email || "").toLowerCase();

  const parts = await prisma.splitParticipant.findMany({
    where: {
      AND: [
        {
          OR: [
            { participantUserId: userId },
            email ? { participantEmail: { equals: email, mode: "insensitive" } } : undefined
          ].filter(Boolean) as any
        },
        {
          OR: [
            { acceptedAt: { not: null } },
            { invitations: { some: { acceptedAt: { not: null } } } },
            { splitVersion: { content: { ownerUserId: userId } } }
          ]
        }
      ]
    },
    include: {
      splitVersion: { include: { content: { include: { owner: true } } } }
    },
    orderBy: { acceptedAt: "desc" }
  });

  if (process.env.NODE_ENV !== "production") {
    app.log.info({ userId, email, count: parts.length }, "split-participations");
  }

  return reply.send(
    parts.map((p) => ({
      splitParticipantId: p.id,
      role: p.role,
      percent: percentToPrimitive(p.percent ?? null),
      bps: p.bps ?? null,
      acceptedAt: p.acceptedAt ? p.acceptedAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
      splitVersionId: p.splitVersionId,
      splitVersionNumber: p.splitVersion?.versionNumber ?? null,
      splitStatus: p.splitVersion?.status ?? null,
      contentId: p.splitVersion?.contentId ?? null,
      contentTitle: p.splitVersion?.content?.title ?? null,
      contentType: p.splitVersion?.content?.type ?? null,
      contentStatus: p.splitVersion?.content?.status ?? null,
      ownerUserId: p.splitVersion?.content?.ownerUserId ?? null,
      ownerDisplayName: p.splitVersion?.content?.owner?.displayName ?? null,
      ownerEmail: p.splitVersion?.content?.owner?.email ?? null
    }))
  );
});

// Royalties (works + upstream income)
app.get("/my/royalties", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, displayName: true } });
  const email = (me?.email || "").toLowerCase();

  const owned = await prisma.contentItem.findMany({
    where: { ownerUserId: userId, deletedAt: null },
    include: { owner: true }
  });

  const participantRows = await prisma.splitParticipant.findMany({
    where: {
      OR: [
        { participantUserId: userId },
        email ? { participantEmail: { equals: email, mode: "insensitive" } } : undefined
      ].filter(Boolean) as any,
      acceptedAt: { not: null }
    },
    include: { splitVersion: { include: { content: { include: { owner: true } }, participants: true } } }
  });

  const participantContentIds = new Set<string>();
  participantRows.forEach((p) => {
    if (p.splitVersion?.contentId) participantContentIds.add(p.splitVersion.contentId);
  });

  // Settlement lines for this user (used for earned totals + upstream)
  const participantIds = await prisma.splitParticipant.findMany({
    where: {
      OR: [
        { participantUserId: userId },
        email ? { participantEmail: { equals: email, mode: "insensitive" } } : undefined
      ].filter(Boolean) as any
    },
    select: { id: true }
  });
  const participantIdList = participantIds.map((p) => p.id);

  const settlementLines = await prisma.settlementLine.findMany({
    where: {
      OR: [
        participantIdList.length ? { participantId: { in: participantIdList } } : undefined,
        email ? { participantEmail: { equals: email, mode: "insensitive" } } : undefined
      ].filter(Boolean) as any
    },
    include: {
      settlement: { include: { content: true } }
    }
  });

  const settlementContentIds = new Set<string>();
  settlementLines.forEach((l) => {
    if (l.settlement?.contentId) settlementContentIds.add(l.settlement.contentId);
  });

  // Union of contentIds for works
  const workContentIds = new Set<string>();
  owned.forEach((c) => workContentIds.add(c.id));
  participantContentIds.forEach((id) => workContentIds.add(id));
  settlementContentIds.forEach((id) => workContentIds.add(id));

  const works: any[] = [];

  for (const contentId of workContentIds) {
    const content =
      owned.find((c) => c.id === contentId) ||
      participantRows.find((p) => p.splitVersion?.contentId === contentId)?.splitVersion?.content ||
      (await prisma.contentItem.findUnique({ where: { id: contentId }, include: { owner: true } }));
    if (!content) continue;

    const split = await getLockedSplitForContent(content.id) || await prisma.splitVersion.findFirst({
      where: { contentId: content.id },
      orderBy: { versionNumber: "desc" },
      include: { participants: true }
    });

    const participants = split?.participants || [];
    const userParticipant =
      participants.find((p) => p.participantUserId === userId) ||
      (email ? participants.find((p) => (p.participantEmail || "").toLowerCase() === email) : null);

    const myBps = userParticipant ? toBps(userParticipant) : null;
    const myPercent = userParticipant ? percentToPrimitive(userParticipant.percent) : null;

    // build participant summary with names
    const userIds = Array.from(new Set(participants.map((p) => p.participantUserId).filter(Boolean) as string[]));
    const userMap = new Map<string, { displayName?: string | null; email?: string | null }>();
    if (userIds.length) {
      const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, displayName: true } });
      users.forEach((u) => userMap.set(u.id, { displayName: u.displayName, email: u.email }));
    }

    const splitSummary = participants.map((p) => ({
      participantUserId: p.participantUserId || null,
      participantEmail: p.participantEmail || null,
      displayName: p.participantUserId ? userMap.get(p.participantUserId)?.displayName || null : null,
      role: p.role,
      bps: toBps(p),
      percent: percentToPrimitive(p.percent)
    }));

    // earned sats for this content (exclude upstream lines from derivative settlements)
    const earned = settlementLines
      .filter((l) => l.settlement?.contentId === content.id && l.role !== "upstream")
      .reduce((acc, l) => acc + BigInt(l.amountSats as any), 0n);

    works.push({
      contentId: content.id,
      title: content.title,
      type: content.type,
      ownerId: content.ownerUserId,
      ownerDisplayName: content.owner?.displayName || null,
      ownerEmail: content.owner?.email || null,
      myRole: content.ownerUserId === userId ? "owner" : "participant",
      myBps,
      myPercent,
      splitSummary,
      earnedSatsToDate: earned.toString(),
      storefrontStatus: content.storefrontStatus,
      contentStatus: content.status
    });
  }

  // Upstream income from derivative settlements
  const upstreamIncomeMap = new Map<string, any>();
  for (const l of settlementLines) {
    if (l.role !== "upstream") continue;
    const childContentId = l.settlement?.contentId;
    if (!childContentId) continue;
    const link = await prisma.contentLink.findFirst({ where: { childContentId } });
    if (!link) continue;
    const parentContent = await prisma.contentItem.findUnique({ where: { id: link.parentContentId } });
    const childContent = await prisma.contentItem.findUnique({ where: { id: childContentId } });
    if (!parentContent || !childContent) continue;

    const parentSplit = await getLockedSplitForContent(parentContent.id);
    const parentParticipant =
      parentSplit?.participants.find((p) => p.participantUserId === userId) ||
      (email ? parentSplit?.participants.find((p) => (p.participantEmail || "").toLowerCase() === email) : null);
    const parentBps = parentParticipant ? toBps(parentParticipant) : 0;

    const key = `${parentContent.id}:${childContent.id}`;
    const existing = upstreamIncomeMap.get(key);
    const earned = BigInt(l.amountSats as any);
    if (!existing) {
      const upstreamBps = link.upstreamBps || 0;
      const myEffectiveBps = Math.floor((upstreamBps * parentBps) / 10000);
      upstreamIncomeMap.set(key, {
        parentContentId: parentContent.id,
        parentTitle: parentContent.title,
        childContentId: childContent.id,
        childTitle: childContent.title,
        upstreamBps,
        myEffectiveBps,
        earnedSatsToDate: earned,
        approvedAt: link.approvedAt ? link.approvedAt.toISOString() : null
      });
    } else {
      existing.earnedSatsToDate = (existing.earnedSatsToDate as bigint) + earned;
    }
  }

  // Also include cleared upstream links even if no earnings yet
  const clearedLinks = await prisma.contentLink.findMany({
    where: { approvedAt: { not: null }, upstreamBps: { gt: 0 } },
    include: { parentContent: true, childContent: true }
  });
  const parentSplits = new Map<string, any>();
  for (const link of clearedLinks) {
    if (!parentSplits.has(link.parentContentId)) {
      const ps = await getLockedSplitForContent(link.parentContentId);
      parentSplits.set(link.parentContentId, ps);
    }
  }
  for (const link of clearedLinks) {
    const ps = parentSplits.get(link.parentContentId);
    if (!ps) continue;
    const parentParticipant =
      ps.participants.find((p: any) => p.participantUserId === userId) ||
      (email ? ps.participants.find((p: any) => (p.participantEmail || "").toLowerCase() === email) : null);
    if (!parentParticipant) continue;
    const key = `${link.parentContentId}::${link.childContentId}`;
    if (!upstreamIncomeMap.has(key)) {
      upstreamIncomeMap.set(key, {
        parentContentId: link.parentContentId,
        parentTitle: link.parentContent?.title || null,
        childContentId: link.childContentId,
        childTitle: link.childContent?.title || null,
        upstreamBps: link.upstreamBps || 0,
        myEffectiveBps: Math.round((link.upstreamBps || 0) * (toBps(parentParticipant) || 0) / 10000),
        earnedSatsToDate: 0n,
        approvedAt: link.approvedAt ? link.approvedAt.toISOString() : null
      });
    }
  }

  const upstreamIncome = Array.from(upstreamIncomeMap.values()).map((u) => ({
    ...u,
    earnedSatsToDate: (u.earnedSatsToDate as bigint).toString()
  }));

  return reply.send(jsonSafe({ works, upstreamIncome }));
});

// Read-only split terms for owners or accepted participants
app.get("/royalties/:contentId/terms", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).contentId);
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const email = (me?.email || "").toLowerCase();

  const content = await prisma.contentItem.findUnique({
    where: { id: contentId },
    include: { owner: true }
  });
  if (!content) return notFound(reply, "Content not found");

  const isOwner = content.ownerUserId === userId;

  let isParticipant = false;
  if (!isOwner) {
    const participant = await prisma.splitParticipant.findFirst({
      where: {
        splitVersion: { contentId },
        OR: [
          { participantUserId: userId },
          email ? { participantEmail: { equals: email, mode: "insensitive" } } : undefined
        ].filter(Boolean) as any,
        acceptedAt: { not: null }
      }
    });
    isParticipant = Boolean(participant);
  }

  if (!isOwner && !isParticipant) return forbidden(reply);

  const locked = await prisma.splitVersion.findFirst({
    where: { contentId, status: "locked" },
    orderBy: { versionNumber: "desc" },
    include: { participants: { orderBy: { createdAt: "asc" } } }
  });

  const latest = locked
    ? locked
    : await prisma.splitVersion.findFirst({
        where: { contentId },
        orderBy: { versionNumber: "desc" },
        include: { participants: { orderBy: { createdAt: "asc" } } }
      });

  if (!latest) return notFound(reply, "No split version found");

  return reply.send({
    content: {
      id: content.id,
      title: content.title,
      type: content.type,
      status: content.status
    },
    splitVersion: {
      id: latest.id,
      versionNumber: latest.versionNumber,
      status: latest.status,
      lockedAt: latest.lockedAt ? latest.lockedAt.toISOString() : null
    },
    participants: latest.participants.map((p) => ({
      participantEmail: p.participantEmail || null,
      role: p.role || null,
      percent: percentToPrimitive(p.percent ?? null),
      acceptedAt: p.acceptedAt ? p.acceptedAt.toISOString() : null
    })),
    canEdit: isOwner
  });
});

// Delete/cancel a pending invitation (owner only)
app.delete("/invites/:id", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const inviteId = asString((req.params as any).id);
  if (!inviteId) return badRequest(reply, "invite id required");

  const inv = await prisma.invitation.findUnique({
    where: { id: inviteId },
    include: { splitParticipant: { include: { splitVersion: { include: { content: true } } } } }
  });
  if (!inv) return notFound(reply, "Invite not found");
  if (inv.splitParticipant?.splitVersion?.content?.ownerUserId !== userId) return forbidden(reply);
  if (inv.acceptedAt) return badRequest(reply, "Invite already accepted");

  await prisma.invitation.delete({ where: { id: inviteId } });

  try {
    await prisma.auditEvent.create({
      data: {
        userId,
        action: "invite.delete",
        entityType: "Invitation",
        entityId: inviteId,
        payloadJson: {
          splitParticipantId: inv.splitParticipantId,
          participantEmail: inv.splitParticipant?.participantEmail || null,
          contentId: inv.splitParticipant?.splitVersion?.contentId || null
        } as any
      }
    });
  } catch {}

  return reply.send({ ok: true });
});

app.post("/auth/login", async (req, reply) => {
  const body = (req.body ?? {}) as { email?: string; password?: string };

  const email = normalizeEmail(body?.email);
  const password = body?.password;

  if (!email || !password) return badRequest(reply, "email and password are required");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash) return reply.code(401).send({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return reply.code(401).send({ error: "Invalid credentials" });

  const token = app.jwt.sign({ sub: user.id });
  return reply.send({
    token,
    user: { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt }
  });
});

app.get("/me", { preHandler: requireAuth }, async (req: any) => {
  const userId = (req.user as JwtUser).sub;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, createdAt: true, bio: true, avatarUrl: true }
  });
  const publicOrigin = getActivePublicOrigin();
  return { ...user, publicOrigin: publicOrigin || null };
});

// Public exposure control
app.get("/api/public/status", { preHandler: requireAuth }, async (_req: any, reply: any) => {
  return reply.send(getPublicStatus());
});

app.get("/api/public/config", { preHandler: requireAuth }, async (_req: any, reply: any) => {
  const config = getPublicOriginConfig();
  return reply.send({
    ok: true,
    provider: config.provider || null,
    domain: config.domain || null,
    tunnelName: config.tunnelName || null,
    updatedAt: config.updatedAt || null
  });
});

app.post("/api/public/config", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const body = (req.body ?? {}) as { provider?: string; domain?: string; tunnelName?: string };
  const provider = String(body.provider || "").trim();
  const domain = String(body.domain || "").trim();
  const tunnelName = String(body.tunnelName || "").trim();
  setPublicOriginConfig({
    provider: provider || null,
    domain: domain || null,
    tunnelName: tunnelName || null
  });
  return reply.send({ ok: true, provider: provider || null, domain: domain || null, tunnelName: tunnelName || null });
});

app.get("/api/public/tunnels", { preHandler: requireAuth }, async (_req: any, reply: any) => {
  const config = getPublicOriginConfig();
  const provider = String(config.provider || process.env.PUBLIC_TUNNEL_PROVIDER || "").trim();
  if (provider !== "cloudflare") {
    return reply.code(400).send({ error: "Public tunnel provider not enabled" });
  }

  try {
    const cloudflaredCmd = resolveCloudflaredCmd();
    if (!cloudflaredCmd) return reply.code(503).send({ error: "cloudflared not available" });
    const { stdout } = await execFileAsync(cloudflaredCmd, ["tunnel", "list", "--output", "json"]);
    const list = JSON.parse(stdout || "[]");
    return reply.send({ ok: true, tunnels: list });
  } catch (e: any) {
    return reply.code(500).send({ error: "Failed to list tunnels", details: e?.message || String(e) });
  }
});

app.post("/api/public/go", { preHandler: requireAuth }, async (_req: any, reply: any) => {
  const mode = normalizePublicMode(PUBLIC_MODE);
  const body = (_req.body ?? {}) as { consent?: boolean; dontAskAgain?: boolean };

  if (mode === "off") {
    return reply.code(409).send({
      mode,
      state: "ERROR",
      publicOrigin: null,
      lastError: "public_mode_disabled",
      lastCheckedAt: null,
      cloudflared: getCloudflaredStatus(),
      consentRequired: false
    });
  }

  if (mode === "direct") {
    const status = getPublicStatus();
    if (status.state === "ERROR") {
      return reply.code(409).send({
        mode,
        state: "ERROR",
        publicOrigin: null,
        lastError: "direct_mode_not_public",
        lastCheckedAt: null,
        cloudflared: status.cloudflared,
        consentRequired: false
      });
    }
    return reply.send(status);
  }

  if (mode === "named") {
    const tunnelName = String(process.env.CLOUDFLARE_TUNNEL_NAME || "").trim();
    const publicOrigin = String(process.env.CONTENTBOX_PUBLIC_ORIGIN || "").trim();
    if (!tunnelName || !publicOrigin) {
      return reply.code(409).send({
        mode,
        state: "ERROR",
        publicOrigin: null,
        lastError: "missing_named_tunnel_config",
        lastCheckedAt: null,
        cloudflared: getCloudflaredStatus(),
        consentRequired: false
      });
    }
    const status = await tunnelManager.startNamed({
      publicOrigin,
      tunnelName,
      configPath: String(process.env.CLOUDFLARED_CONFIG_PATH || "").trim() || null
    });
    if (status.status === "ACTIVE") {
      return reply.send({
        mode,
        state: "ACTIVE",
        publicOrigin,
        lastError: null,
        lastCheckedAt: toEpochMs(status.lastCheckedAt),
        cloudflared: getCloudflaredStatus(),
        consentRequired: false
      });
    }
    return reply.code(503).send({
      mode,
      state: "ERROR",
      publicOrigin: null,
      lastError: status.lastError || "named_tunnel_failed",
      lastCheckedAt: toEpochMs(status.lastCheckedAt),
      cloudflared: getCloudflaredStatus(),
      consentRequired: false
    });
  }

  // quick
  const cloudflared = getCloudflaredStatus();
  const consent = getPublicSharingConsent();
  const consentGranted = consent.granted || consent.dontAskAgain;
  if (!cloudflared.available && !consentGranted) {
    if (body?.consent !== true) {
      const status = getPublicStatus();
      return reply.code(409).send({
        ...status,
        state: "ERROR",
        publicOrigin: null,
        lastError: "consent_required",
        consentRequired: true
      });
    }
    setPublicSharingConsent(true, body?.dontAskAgain === true);
  }

  const prep = await tunnelManager.ensureBinary();
  if (!prep.ok) {
    tunnelManager.setError("cloudflared_download_failed");
    const status = getPublicStatus();
    return reply.code(503).send({
      ...status,
      state: "ERROR",
      publicOrigin: null,
      lastError: "cloudflared_download_failed",
      consentRequired: false
    });
  }
  const status = getPublicStatus();
  if (status.state === "ACTIVE") return reply.send(status);
  tunnelManager.startQuick().catch(() => {});
  return reply.send({
    mode,
    state: "STARTING",
    publicOrigin: null,
    lastError: null,
    lastCheckedAt: null,
    cloudflared: getCloudflaredStatus(),
    consentRequired: false
  });
});

app.post("/api/public/stop", { preHandler: requireAuth }, async (_req: any, reply: any) => {
  await tunnelManager.stop();
  const status = getPublicStatus();
  return reply.send({
    ...status,
    state: "STOPPED",
    publicOrigin: null,
    lastError: null
  });
});

app.post("/api/public/consent/reset", { preHandler: requireAuth }, async (_req: any, reply: any) => {
  clearPublicSharingConsent();
  return reply.send(getPublicStatus());
});

app.post("/api/public/autostart", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const body = (req.body ?? {}) as { enabled?: boolean };
  setPublicSharingAutoStart(Boolean(body.enabled));
  return reply.send(getPublicStatus());
});

// Buyer library (entitlements)
app.get("/me/entitlements", { preHandler: requireAuth }, async (req: any) => {
  const userId = (req.user as JwtUser).sub;
  const entitlements = await prisma.entitlement.findMany({
    where: { buyerUserId: userId },
    include: { content: true },
    orderBy: { grantedAt: "desc" }
  });

  const intents = await prisma.paymentIntent.findMany({
    where: { buyerUserId: userId, status: "paid", receiptToken: { not: null } },
    select: { receiptToken: true, contentId: true, manifestSha256: true }
  });
  const tokenByKey = new Map<string, string>();
  for (const i of intents) {
    if (i.receiptToken) tokenByKey.set(`${i.contentId}:${i.manifestSha256 || ""}`, i.receiptToken);
  }

  return entitlements.map((e) => ({
    id: e.id,
    contentId: e.contentId,
    manifestSha256: e.manifestSha256,
    grantedAt: e.grantedAt.toISOString(),
    content: e.content
      ? { id: e.content.id, title: e.content.title, type: e.content.type, status: e.content.status }
      : null,
    receiptToken: tokenByKey.get(`${e.contentId}:${e.manifestSha256}`) || null
  }));
});

// Buyer purchase history
app.get("/me/purchases/payment-intents", { preHandler: requireAuth }, async (req: any) => {
  const userId = (req.user as JwtUser).sub;
  const intents = await prisma.paymentIntent.findMany({
    where: { buyerUserId: userId },
    include: { content: true },
    orderBy: { createdAt: "desc" }
  });
  return intents.map((i) => ({
    id: i.id,
    contentId: i.contentId,
    manifestSha256: i.manifestSha256,
    amountSats: i.amountSats.toString(),
    status: i.status,
    paidVia: i.paidVia,
    createdAt: i.createdAt.toISOString(),
    receiptToken: i.receiptToken || null,
    content: i.content ? { id: i.content.id, title: i.content.title, type: i.content.type } : null
  }));
});

// Update current user (partial update). Currently supports updating displayName.
app.patch("/me", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const body = (req.body ?? {}) as { displayName?: string | null; bio?: string | null; avatarUrl?: string | null };

  const displayName = body.displayName === undefined ? undefined : (String(body.displayName).trim() || null);
  const bio = body.bio === undefined ? undefined : (String(body.bio).trim() || null);
  const avatarUrl = body.avatarUrl === undefined ? undefined : (String(body.avatarUrl).trim() || null);

  const data: any = {};
  if (displayName !== undefined) data.displayName = displayName;
  if (bio !== undefined) data.bio = bio;
  if (avatarUrl !== undefined) data.avatarUrl = avatarUrl;

  const updated = await prisma.user.update({ where: { id: userId }, data, select: { id: true, email: true, displayName: true, createdAt: true, bio: true, avatarUrl: true } });
  return reply.send(updated);
});

// (external/profile/import) route: enhanced implementation later in the file (Lens, ENS, HTML parsing).

// Enhance external profile import: try Lens and ENS lookups when applicable
app.post("/external/profile/import", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const url = asString((req.body ?? {})?.url || "").trim();
  if (!url) return badRequest(reply, "url required");

  // If the input looks like a bare ENS name (e.g. 'alice.eth'), normalize to a URL-like string
  const maybeEns = url.match(/^([a-z0-9-]+\.eth)$/i);

  // Helper: perform HTML parsing using cheerio for more robust extraction
  async function fetchAndParseHtml(targetUrl: string) {
    const r = await fetch(targetUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      } as any
    } as any);
    if (!r.ok) return null;
    const text = await r.text();
    const $ = cheerio.load(text);
    const out: any = { name: null, description: null, image: null, payouts: {}, handle: null };
    let beatifyHandleFromUrl: string | null = null;
    try {
      const u = new URL(targetUrl);
      if ((u.hostname || "").toLowerCase().includes("beatify")) {
        const parts = u.pathname.split("/").filter(Boolean);
        beatifyHandleFromUrl = parts.length ? parts[parts.length - 1] : null;
      }
    } catch {}

    function findFirstString(root: any, keys: string[], maxDepth = 7) {
      const seen = new Set<any>();
      function walk(node: any, depth: number): string | null {
        if (!node || depth > maxDepth) return null;
        if (seen.has(node)) return null;
        if (typeof node === "string") return null;
        if (typeof node !== "object") return null;
        seen.add(node);
        for (const k of keys) {
          const v = (node as any)[k];
          if (typeof v === "string" && v.trim()) return v.trim();
        }
        for (const k of Object.keys(node)) {
          const v = (node as any)[k];
          if (typeof v === "string" && v.trim() && keys.includes(k)) return v.trim();
          if (typeof v === "object" && v) {
            const found = walk(v, depth + 1);
            if (found) return found;
          }
        }
        if (Array.isArray(node)) {
          for (const v of node) {
            const found = walk(v, depth + 1);
            if (found) return found;
          }
        }
        return null;
      }
      return walk(root, 0);
    }

    // 1) JSON-LD
    try {
      const jsonLd = $('script[type="application/ld+json"]').first().text();
      if (jsonLd) {
        try {
          const j = JSON.parse(jsonLd);
          out.name = out.name || j.name || j.headline || null;
          out.description = out.description || j.description || j.summary || null;
          const img = j.image || (j.picture && j.picture.original && j.picture.original.url) || null;
          out.image = out.image || (typeof img === "string" ? img : img?.url || null);
        } catch {}
      }
    } catch {}

    // 2) meta tags
    try {
      const meta = (names: string) => {
        const selectors = names.split("|").map((n) => `meta[name=\"${n}\"],meta[property=\"${n}\"]`).join(",");
        const el = $(selectors).first();
        return el.attr("content") || null;
      };
      out.name = out.name || meta("og:title|twitter:title|title");
      out.description = out.description || meta("og:description|twitter:description|description");
      out.image = out.image || meta("og:image|twitter:image");
    } catch {}

    // 3) title / headings
    try {
      out.name = out.name || $("title").first().text().trim() || null;
      out.name = out.name || $("h1").first().text().trim() || $("h2").first().text().trim() || null;
    } catch {}

    // 3a) next.js / nuxt / inline JSON boot data
    try {
      const nextData = $("#__NEXT_DATA__").first().text();
      if (nextData) {
        try {
          const j = JSON.parse(nextData);
          const name = findFirstString(j, ["displayName", "name", "username", "handle", "profileName"]);
          const bio = findFirstString(j, ["bio", "description", "about", "summary"]);
          const img = findFirstString(j, ["avatar", "avatarUrl", "image", "photo", "picture", "profilePicture"]);
          if (name) out.name = out.name || name;
          if (bio) out.description = out.description || bio;
          if (img) out.image = out.image || img;
          const handle = findFirstString(j, ["handle", "username", "slug"]);
          if (handle) out.handle = out.handle || handle;
        } catch {}
      }
    } catch {}
    try {
      const scripts = $("script").toArray();
      for (const s of scripts) {
        const txt = $(s).text() || "";
        if (!txt) continue;
        const nuxtMatch = txt.match(/__NUXT__\s*=\s*(\{[\s\S]*\});?/);
        if (nuxtMatch) {
          try {
            const j = JSON.parse(nuxtMatch[1]);
            const name = findFirstString(j, ["displayName", "name", "username", "handle", "profileName"]);
            const bio = findFirstString(j, ["bio", "description", "about", "summary"]);
            const img = findFirstString(j, ["avatar", "avatarUrl", "image", "photo", "picture", "profilePicture"]);
            if (name) out.name = out.name || name;
            if (bio) out.description = out.description || bio;
            if (img) out.image = out.image || img;
            const handle = findFirstString(j, ["handle", "username", "slug"]);
            if (handle) out.handle = out.handle || handle;
            break;
          } catch {}
        }
      }
    } catch {}

    // 3b) Beatify-specific username element
    try {
      const $usernameEl = $(".text-profile-username").first();
      const beatifyHandle = $usernameEl.text().trim();
      const altHandle =
        beatifyHandle ||
        $("[data-testid*=username]").first().text().trim() ||
        $("[class*=username]").first().text().trim() ||
        $("[class*=handle]").first().text().trim();

      if (beatifyHandle || altHandle) {
        const chosenHandle = beatifyHandle || altHandle;
        // Prefer the Beatify username when parsing Beatify hosts — override other name candidates
        try {
          const host = new URL(targetUrl).hostname.toLowerCase();
          if (host.includes("beatify")) {
            out.name = chosenHandle;
          } else {
            out.name = out.name || chosenHandle;
          }
        } catch {
          out.name = out.name || chosenHandle;
        }
        out.handle = out.handle || chosenHandle;

        // Try to find a bio paragraph that is adjacent or inside the same container
        try {
          const nextP = $usernameEl.nextAll("p").first();
          if (nextP && nextP.text() && nextP.text().trim().length > 0) {
            out.description = out.description || nextP.text().trim();
          }
        } catch {}

        try {
          if (!out.description) {
            const parentP = $usernameEl.parent().find("p").first();
            if (parentP && parentP.text() && parentP.text().trim().length > 0) {
              out.description = out.description || parentP.text().trim();
            }
          }
        } catch {}
      }
    } catch {}

    // 3c) Beatify fallback: if on beatify host, prefer URL handle over generic title
    try {
      if (beatifyHandleFromUrl) {
        out.handle = out.handle || beatifyHandleFromUrl;
        out.name = beatifyHandleFromUrl;
      }
    } catch {}

    // 4) bio/about by id/class or common selectors
    try {
      const selectors = [
        "[id*=bio]",
        "[class*=bio]",
        "[data-testid*=bio]",
        "[id*=about]",
        "[class*=about]",
        "[id*=description]",
        "[class*=description]",
        "[data-testid*=description]",
        "[id*=profile]",
        "[class*=profile]",
        "[itemprop=description]",
        "section.about",
        "section.profile",
        "div.profile",
        "article"
      ];
      for (const s of selectors) {
        const el = $(s).first();
        if (el && el.text() && el.text().trim().length > 20) {
          out.description = out.description || el.text().trim();
          break;
        }
      }
      // fallback: first paragraph longer than 80 chars
      if (!out.description) {
        const p = $("p").filter((i, el) => $(el).text().trim().length > 80).first();
        if (p && p.text()) out.description = p.text().trim();
      }
    } catch {}

    // 4b) Beatify-specific bio: allow shorter bios and look for likely containers
    try {
      if (!out.description && beatifyHandleFromUrl) {
        const beatifySelectors = [
          ".text-profile-bio",
          ".text-profile-description",
          ".profile-bio",
          ".profile-description",
          "[class*=bio]",
          "[class*=description]",
          "[data-testid*=bio]",
          "[data-testid*=description]"
        ];
        for (const s of beatifySelectors) {
          const el = $(s).first();
          const txt = el && el.text ? el.text().trim() : "";
          if (txt && txt.length > 4) {
            out.description = txt;
            break;
          }
        }

        if (!out.description) {
          // If there's a "Bio" label, use the next sibling text
          const bioLabel = $("*").filter((i, el) => $(el).text().trim().toLowerCase() === "bio").first();
          if (bioLabel && bioLabel.length) {
            const next = bioLabel.next();
            const txt = next && next.text ? next.text().trim() : "";
            if (txt && txt.length > 4) out.description = txt;
          }
        }
      }
    } catch {}

    // 5) avatar image heuristics
    try {
      // Beatify-specific explicit selector: prefer <img class="profile-picture outfit-reference" src="...">
      try {
        const bf = $("img.profile-picture.outfit-reference").first();
        const bfsrc = bf.attr && bf.attr("src") ? bf.attr("src") : null;
        if (bfsrc) {
          try {
            const resolved = new URL(bfsrc, targetUrl).toString();
            const norm = normalizeUrlString(resolved);
            out.image = out.image || (norm || resolved);
          } catch {
            const norm = normalizeUrlString(bfsrc);
            out.image = out.image || (norm || bfsrc);
          }
        }
      } catch {}

      const imgs = $("img").toArray().map((el) => ({ src: $(el).attr("src") || "", attrs: ($(el).attr("class") || "") + " " + ($(el).attr("alt") || "") }));
      function chooseImg(cands: typeof imgs) {
        for (const c of cands) if (/(avatar|profile|pfp|photo|headshot|face)/i.test(c.attrs)) return c.src;
        for (const c of cands) if (/(avatar|profile|pfp|headshot|face|user|photo)/i.test(c.src)) return c.src;
        return cands.length ? cands[0].src : null;
      }
      const picked = chooseImg(imgs);
      if (picked) {
        try {
          const resolved = new URL(picked, targetUrl).toString();
          const norm = normalizeUrlString(resolved);
          out.image = out.image || (norm || resolved);
        } catch {
          const norm = normalizeUrlString(picked);
          out.image = out.image || (norm || picked);
        }
      }
      // Beatify-specific heuristic: prefer explicit avatar files like
      // /<handle>/avatar.png or any path containing '/avatar' on beatify hosts.
      try {
        const allImgSrcs = $("img").toArray().map((el) => $(el).attr("src") || "");
        for (const s of allImgSrcs) {
          if (!s) continue;
          let resolved: string | null = null;
          try {
            resolved = new URL(s, targetUrl).toString();
          } catch {
            resolved = normalizeUrlString(s);
          }
          if (!resolved) continue;

          try {
            const p = new URL(resolved).pathname || "";
            // match paths like /<handle>/avatar.png or any path segment 'avatar' with an image extension
            if (/\/(?:[^\/]+)\/avatar(?:\.(png|jpe?g|gif|webp|avif))?$/i.test(p) || /\bavatar(?:\.(png|jpe?g|gif|webp|avif))$/i.test(p) || /content\.beatify\./i.test(resolved) || /beatify\.me/i.test(targetUrl)) {
              const norm = normalizeUrlString(resolved);
              out.image = out.image || (norm || resolved);
              break;
            }
          } catch {
            // ignore per-URL errors
          }
        }
      } catch {}
    } catch {}

    // 6) payouts heuristics (scan text)
    try {
      const bodyText = $("body").text();
      const lnMatch = bodyText.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
      const lightningUrlMatch = bodyText.match(/(lightning:\/?\/?[a-zA-Z0-9@%._:-]+)/i);
      const lnurlMatch = bodyText.match(/(lnurl[0-9a-zA-Z-:._@%]+)/i);
      if (lightningUrlMatch) out.payouts.lightning = lightningUrlMatch[1];
      else if (lnMatch && String(lnMatch[1]).includes("@")) out.payouts.lightning = lnMatch[1];
      if (lnurlMatch) out.payouts.lnurl = lnurlMatch[1];
    } catch {}

    return out;
  }

  try {
    let parsed: any = { name: null, description: null, image: null, payouts: {} };

    // 1) If it's a Lens handle or Lens URL, call Lens API
    try {
      const u = new URL(url.includes("//") ? url : `https://${url}`);
      const host = (u.hostname || "").toLowerCase();
      if (host.includes("lens") || host.includes("lenster") || u.pathname.includes("/u/") || u.pathname.includes("/profile/")) {
        // extract last path segment as handle
        const parts = u.pathname.split("/").filter(Boolean);
        const handle = parts[parts.length - 1];
        if (handle) {
          try {
            const q = `query Profile($handle: Handle!) { profile(request: { handle: $handle }) { id name bio handle ownedBy picture { __typename ... on MediaSet { original { url } } ... on NftImage { uri } } } }`;
            const resp = await fetch("https://api.lens.dev/", { method: "POST", headers: { "Content-Type": "application/json" } as any, body: JSON.stringify({ query: q, variables: { handle } }) } as any);
            if (resp.ok) {
              const j: any = await resp.json();
              const p = j?.data?.profile;
              if (p) {
                parsed.name = p.name || parsed.name || null;
                parsed.description = p.bio || parsed.description || null;
                const pic = p?.picture;
                if (pic) {
                  parsed.image = pic?.original?.url || pic?.uri || parsed.image || null;
                }
                parsed.payouts = parsed.payouts || {};
                return reply.send(parsed);
              }
            }
          } catch {
            // ignore lens failures
          }
        }
      }
    } catch {
      // ignore URL parsing errors
    }

    // 2) If it looks like an ENS name, attempt ENS metadata endpoints
    if (maybeEns) {
      const name = maybeEns[1];
      try {
        // Try metadata.ens.domains endpoints (best-effort)
        const profileUrl = `https://metadata.ens.domains/mainnet/profile/${encodeURIComponent(name)}`;
        const pr = await fetch(profileUrl, { method: "GET" } as any);
        if (pr && pr.ok) {
          try {
            const pj: any = await pr.json();
            if (pj) {
              parsed.name = pj.name || parsed.name;
              parsed.description = pj.description || parsed.description;
              parsed.image = pj.avatar || pj.image || parsed.image;
            }
          } catch {}
        }
      } catch {}
    }

    // 3) Attempt HTML parsing of the provided URL
    const htmlParsed = await fetchAndParseHtml(maybeEns ? `https://${maybeEns[1]}` : url);
    if (htmlParsed) {
      // merge HTML-parsed values
      parsed = { ...parsed, ...htmlParsed };
      try {
        // debug: log what HTML parsing returned so we can diagnose which fields were found
        app.log.info({ url, htmlParsed }, "import-debug.htmlParsed");
      } catch {}
    }

    // Beatify special-case: if we didn't find an image via HTML parsing,
    // try the conventional content host avatar path: https://content.beatify.audio/<handle>/avatar.png
    try {
      if (!parsed.image) {
        try {
          const u = new URL(url.includes("//") ? url : `https://${url}`);
          const host = (u.hostname || "").toLowerCase();
          if (host.includes("beatify")) {
            // derive handle from parsed.handle (if present) or from path (last path segment)
            const parts = u.pathname.split("/").filter(Boolean);
            const handleFromPath = parts.length ? parts[parts.length - 1] : null;
            const handle = parsed.handle || handleFromPath;
            if (handle) {
              const cand = `https://content.beatify.audio/${encodeURIComponent(handle)}/avatar.png`;
              try {
                // prefer HEAD to check existence; some hosts may not support HEAD, so fall back to GET
                let ok = false;
                try {
                  const hr = await fetch(cand, { method: "HEAD" } as any);
                  ok = hr && hr.ok && ((hr.headers.get("content-type") || "").startsWith("image/"));
                } catch {
                  // HEAD failed, try GET but do not stream body here
                  try {
                    const gr = await fetch(cand, { method: "GET" } as any);
                    ok = gr && gr.ok && ((gr.headers.get("content-type") || "").startsWith("image/"));
                  } catch {}
                }

                if (ok) parsed.image = cand;
              } catch {}
            }
          }
        } catch {}
      }
    } catch {}

    // Ensure Beatify handle overrides other name candidates for Beatify hosts.
    try {
      const u = new URL(url.includes("//") ? url : `https://${url}`);
      const host = (u.hostname || "").toLowerCase();
      if (host.includes("beatify") && parsed.handle) {
        app.log.info({ url, beforeName: parsed.name, handle: parsed.handle }, "import-debug.override");
        parsed.name = parsed.handle;
        app.log.info({ url, afterName: parsed.name }, "import-debug.override.after");
      }
    } catch {}

    // If we have an image URL and the authenticated user, attempt to download and store it locally.
    // Keep the original source URL (origImage) so we can persist the external Beatify URL into the user's profile,
    // while still saving a local copy for reliability.
    try {
      const userId = (req.user as JwtUser).sub;
      let origImage: string | null = null;
      let storedImage: string | null = null;
      if (parsed.image && userId) {
        origImage = String(parsed.image);
        try {
          const stored = await fetchAndStoreAvatarForUser(userId, origImage);
          if (stored) storedImage = stored;
        } catch {}
      }

      // For the response, prefer returning the original external URL when present (so UI shows Beatify src),
      // otherwise fall back to the stored copy.
      if (origImage) parsed.image = origImage;
      else if (storedImage) parsed.image = storedImage;

      // Persist parsed profile fields into the user's profile (displayName, bio, avatarUrl) when available.
      // Use the original external URL for avatarUrl if available so the profile element references Beatify's image.
      try {
        const userId = (req.user as JwtUser).sub;
        const updateData: any = {};
        if (parsed.name) updateData.displayName = String(parsed.name).trim() || null;
        if (parsed.description) updateData.bio = String(parsed.description).trim() || null;
        if (origImage) updateData.avatarUrl = String(origImage).trim() || null;
        else if (storedImage) updateData.avatarUrl = String(storedImage).trim() || null;
        if (Object.keys(updateData).length > 0) {
          await prisma.user.update({ where: { id: userId }, data: updateData });
        }
      } catch {}
    } catch {}

    return reply.send(parsed);
  } catch (e: any) {
    return reply.code(500).send({ error: String((e as any)?.message || e) });
  }
});

// Serve stored avatars
async function handlePublicAvatar(req: any, reply: any) {
  try {
    const userId = asString((req.params || {})?.userId || "");
    const filename = asString((req.params || {})?.filename || "");
    if (!userId || !filename) return notFound(reply, "Not found");

    const abs = path.join(CONTENTBOX_ROOT, "avatars", userId, filename);
    if (!fsSync.existsSync(abs)) return notFound(reply, "Not found");

    // basic security: ensure path is inside avatars dir
    const rel = path.relative(path.join(CONTENTBOX_ROOT, "avatars", userId), abs);
    if (rel.startsWith("..")) return notFound(reply, "Not found");

    const stat = await fs.stat(abs);
    const stream = fsSync.createReadStream(abs);
    const ext = path.extname(filename).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".gif" ? "image/gif" : "application/octet-stream";
    reply.type(mime);
    return reply.send(stream);
  } catch {
    return notFound(reply, "Not found");
  }
}

app.get("/public/avatars/:userId/:filename", handlePublicAvatar);

/**
 * PAYOUT METHODS (public for now)
 */
app.get("/payout-methods", async () => {
  return prisma.payoutMethod.findMany({
    where: { isVisible: true },
    orderBy: { sortOrder: "asc" }
  });
});

/**
 * IDENTITIES (auth)
 */
app.get("/identities", { preHandler: requireAuth }, async (req: any) => {
  const userId = (req.user as JwtUser).sub;
  return prisma.identity.findMany({
    where: { userId },
    include: { payoutMethod: true },
    orderBy: { createdAt: "desc" }
  });
});

app.post("/identities", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const body = (req.body ?? {}) as { payoutMethodId?: string; value?: string; label?: string | null };

  if (!body?.payoutMethodId || !body?.value) return badRequest(reply, "payoutMethodId and value are required");

  const method = await prisma.payoutMethod.findUnique({ where: { id: body.payoutMethodId } });
  if (!method || !method.isVisible) return notFound(reply, "Payout method not found");
  if (method.code === "manual" && (!body.label || body.label.trim().length < 2)) {
    return badRequest(reply, "Label is required for manual payout");
  }

  const identity = await prisma.identity.create({
    data: {
      userId,
      payoutMethodId: body.payoutMethodId,
      value: asString(body.value).trim(),
      label: body.label?.trim() || null,
      verifiedAt: method.isEnabled ? new Date() : null
    },
    include: { payoutMethod: true }
  });

  try {
    await prisma.auditEvent.create({
      data: { userId, action: "payout.destination.create", entityType: "Identity", entityId: identity.id, payloadJson: { payoutMethodId: identity.payoutMethodId } as any }
    });
  } catch {}

  return reply.send(identity);
});

app.delete("/identities/:id", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const id = asString((req.params as any).id);
  if (!id) return badRequest(reply, "id required");

  const identity = await prisma.identity.findUnique({ where: { id } });
  if (!identity || identity.userId !== userId) return notFound(reply, "Identity not found");

  await prisma.identity.delete({ where: { id } });
  try {
    await prisma.auditEvent.create({
      data: { userId, action: "payout.destination.delete", entityType: "Identity", entityId: id, payloadJson: { payoutMethodId: identity.payoutMethodId } as any }
    });
  } catch {}
  return reply.send({ ok: true });
});

app.patch("/identities/:id", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const id = asString((req.params as any).id);
  const body = (req.body ?? {}) as { value?: string; label?: string | null };
  if (!id) return badRequest(reply, "id required");

  const identity = await prisma.identity.findUnique({ where: { id }, include: { payoutMethod: true } });
  if (!identity || identity.userId !== userId) return notFound(reply, "Identity not found");
  const nextLabel = body.label !== undefined ? (body.label ? body.label.trim() : "") : (identity.label ? identity.label.trim() : "");
  if (identity.payoutMethod.code === "manual" && nextLabel.length < 2) {
    return badRequest(reply, "Label is required for manual payout");
  }

  const updated = await prisma.identity.update({
    where: { id },
    data: {
      value: body.value !== undefined ? asString(body.value).trim() : identity.value,
      label: body.label !== undefined ? (body.label ? body.label.trim() : null) : identity.label
    },
    include: { payoutMethod: true }
  });
  try {
    await prisma.auditEvent.create({
      data: { userId, action: "payout.destination.update", entityType: "Identity", entityId: id, payloadJson: { payoutMethodId: updated.payoutMethodId } as any }
    });
  } catch {}
  return reply.send(updated);
});

// /api aliases for identities and payout methods
app.get("/api/identities", { preHandler: requireAuth }, async (req: any) => {
  const userId = (req.user as JwtUser).sub;
  return prisma.identity.findMany({
    where: { userId },
    include: { payoutMethod: true },
    orderBy: { createdAt: "desc" }
  });
});

app.post("/api/identities", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const body = (req.body ?? {}) as { payoutMethodCode?: string; value?: string; label?: string | null };
  if (!body?.payoutMethodCode || !body?.value) return badRequest(reply, "payoutMethodCode and value are required");
  const method = await prisma.payoutMethod.findUnique({ where: { code: body.payoutMethodCode as any } });
  if (!method || !method.isVisible) return notFound(reply, "Payout method not found");
  if (method.code === "manual" && (!body.label || body.label.trim().length < 2)) {
    return badRequest(reply, "Label is required for manual payout");
  }
  const identity = await prisma.identity.create({
    data: {
      userId,
      payoutMethodId: method.id,
      value: asString(body.value).trim(),
      label: body.label?.trim() || null,
      verifiedAt: method.isEnabled ? new Date() : null
    },
    include: { payoutMethod: true }
  });
  try {
    await prisma.auditEvent.create({
      data: { userId, action: "payout.destination.create", entityType: "Identity", entityId: identity.id, payloadJson: { payoutMethodId: identity.payoutMethodId } as any }
    });
  } catch {}
  return reply.send(identity);
});

// Basic payout settings (lightning address / lnurl / btc)
app.get("/api/me/payout", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const methods = await prisma.payoutMethod.findMany({
    where: { code: { in: ["lightning_address", "lnurl", "btc_onchain"] as any } }
  });
  const methodByCode = new Map(methods.map((m) => [m.code, m]));
  const identities = await prisma.identity.findMany({
    where: { userId, payoutMethodId: { in: methods.map((m) => m.id) } },
    include: { payoutMethod: true }
  });
  const byCode = new Map(identities.map((i) => [i.payoutMethod.code, i]));
  return reply.send({
    lightningAddress: byCode.get("lightning_address")?.value || "",
    lnurl: byCode.get("lnurl")?.value || "",
    btcAddress: byCode.get("btc_onchain")?.value || ""
  });
});

app.post("/api/me/payout", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const body = (req.body ?? {}) as { lightningAddress?: string; lnurl?: string; btcAddress?: string };

  const methods = await prisma.payoutMethod.findMany({
    where: { code: { in: ["lightning_address", "lnurl", "btc_onchain"] as any } }
  });
  const methodByCode = new Map(methods.map((m) => [m.code, m]));

  async function upsert(code: "lightning_address" | "lnurl" | "btc_onchain", valueRaw: string | undefined) {
    const method = methodByCode.get(code);
    if (!method) return;
    const value = String(valueRaw || "").trim();
    const existing = await prisma.identity.findFirst({
      where: { userId, payoutMethodId: method.id }
    });
    if (!value) {
      if (existing) await prisma.identity.delete({ where: { id: existing.id } });
      return;
    }
    if (existing) {
      await prisma.identity.update({ where: { id: existing.id }, data: { value } });
    } else {
      await prisma.identity.create({
        data: { userId, payoutMethodId: method.id, value, label: null }
      });
    }
  }

  await upsert("lightning_address", body.lightningAddress);
  await upsert("lnurl", body.lnurl);
  await upsert("btc_onchain", body.btcAddress);

  return reply.send({ ok: true });
});

app.patch("/api/identities/:id", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const id = asString((req.params as any).id);
  const body = (req.body ?? {}) as { value?: string; label?: string | null };
  if (!id) return badRequest(reply, "id required");
  const identity = await prisma.identity.findUnique({ where: { id }, include: { payoutMethod: true } });
  if (!identity || identity.userId !== userId) return notFound(reply, "Identity not found");
  const nextLabel = body.label !== undefined ? (body.label ? body.label.trim() : "") : (identity.label ? identity.label.trim() : "");
  if (identity.payoutMethod.code === "manual" && nextLabel.length < 2) {
    return badRequest(reply, "Label is required for manual payout");
  }
  const updated = await prisma.identity.update({
    where: { id },
    data: {
      value: body.value !== undefined ? asString(body.value).trim() : identity.value,
      label: body.label !== undefined ? (body.label ? body.label.trim() : null) : identity.label
    },
    include: { payoutMethod: true }
  });
  try {
    await prisma.auditEvent.create({
      data: { userId, action: "payout.destination.update", entityType: "Identity", entityId: id, payloadJson: { payoutMethodId: updated.payoutMethodId } as any }
    });
  } catch {}
  return reply.send(updated);
});

app.delete("/api/identities/:id", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const id = asString((req.params as any).id);
  if (!id) return badRequest(reply, "id required");
  const identity = await prisma.identity.findUnique({ where: { id } });
  if (!identity || identity.userId !== userId) return notFound(reply, "Identity not found");
  await prisma.identity.delete({ where: { id } });
  try {
    await prisma.auditEvent.create({
      data: { userId, action: "payout.destination.delete", entityType: "Identity", entityId: id, payloadJson: { payoutMethodId: identity.payoutMethodId } as any }
    });
  } catch {}
  return reply.send({ ok: true });
});

app.get("/api/payout-methods", { preHandler: requireAuth }, async () => {
  return prisma.payoutMethod.findMany({
    where: { isVisible: true },
    orderBy: { sortOrder: "asc" }
  });
});

/**
 * CONTENT (auth)
 */
app.get("/content", { preHandler: requireAuth }, async (req: any) => {
  const userId = (req.user as JwtUser).sub;

  const q = (req.query || {}) as { trash?: string; scope?: string };
  const trash = q.trash === "1";
  const scope = String(q.scope || "library").toLowerCase();

  const selectBase = {
    id: true,
    title: true,
    type: true,
    status: true,
    storefrontStatus: true,
    priceSats: true,
    createdAt: true,
    repoPath: true,
    deletedAt: true,
    ownerUserId: true,
    owner: { select: { displayName: true, email: true } },
    manifest: { select: { sha256: true } },
    _count: { select: { files: true } }
  } as const;

  const items: any[] = [];

  if (scope === "local") {
    const local = await prisma.contentItem.findMany({
      where: { deletedAt: trash ? { not: null } : null },
      orderBy: { createdAt: "desc" },
      select: selectBase
    });
    items.push(...local.map((i) => ({ ...i, libraryAccess: i.ownerUserId === userId ? "owned" : "local" })));
  } else if (scope === "mine") {
    const owned = await prisma.contentItem.findMany({
      where: { ownerUserId: userId, deletedAt: trash ? { not: null } : null },
      orderBy: { createdAt: "desc" },
      select: selectBase
    });
    items.push(...owned.map((i) => ({ ...i, libraryAccess: "owned" })));
  } else {
    // library: owned + purchased (entitlements) + public preview
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const meEmail = (me?.email || "").toLowerCase();
    const [owned, purchased, publicPreview, participantLinks] = await prisma.$transaction([
      prisma.contentItem.findMany({
        where: { ownerUserId: userId, deletedAt: trash ? { not: null } : null },
        orderBy: { createdAt: "desc" },
        select: selectBase
      }),
      prisma.entitlement.findMany({
        where: { buyerUserId: userId },
        include: { content: { select: selectBase } },
        orderBy: { grantedAt: "desc" }
      }),
      prisma.contentItem.findMany({
        where: {
          storefrontStatus: { in: ["LISTED", "UNLISTED"] },
          status: "published",
          deletedAt: trash ? { not: null } : null
        },
        orderBy: { createdAt: "desc" },
        select: selectBase
      }),
      prisma.splitParticipant.findMany({
        where: {
          acceptedAt: { not: null },
          OR: [
            { participantUserId: userId },
            meEmail ? { participantEmail: { equals: meEmail, mode: "insensitive" } } : undefined
          ].filter(Boolean) as any
        },
        select: {
          splitVersion: { select: { contentId: true } }
        }
      })
    ]);

    items.push(...owned.map((i) => ({ ...i, libraryAccess: "owned" })));
    items.push(
      ...purchased
        .filter((p) => p.content)
        .map((p) => ({ ...p.content, libraryAccess: "purchased" }))
    );
    items.push(...publicPreview.map((i) => ({ ...i, libraryAccess: "preview" })));
    if (participantLinks.length > 0) {
      const participantIds = Array.from(
        new Set(participantLinks.map((p) => p.splitVersion?.contentId).filter(Boolean) as string[])
      );
      if (participantIds.length > 0) {
        const participantContent = await prisma.contentItem.findMany({
          where: { id: { in: participantIds }, deletedAt: trash ? { not: null } : null },
          orderBy: { createdAt: "desc" },
          select: selectBase
        });
        items.push(...participantContent.map((i) => ({ ...i, libraryAccess: "participant" })));
      }
    }
  }

  // de-dupe by content id (keep first)
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });

  return unique.map((i: any) => ({
    ...i,
    priceSats: i.priceSats != null ? i.priceSats.toString() : null
  }));
});

// Create a new content item and initialize a repo for it
app.post("/content", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const body = (req.body ?? {}) as { title?: string; type?: string; description?: string | null };

  const title = asString(body.title).trim();
  const type = asString(body.type).trim() || "file";
  const description = body.description ? asString(body.description).trim() : null;
  if (!title) return badRequest(reply, "title required");

  // create DB row first
  const content = await prisma.contentItem.create({
    data: { ownerUserId: userId, title, type: type as any, description }
  });

  try {
    // init repo on disk
    const repoPath = await initContentRepo({ root: CONTENTBOX_ROOT, contentId: content.id, type, title });

    // update content with repoPath
    await prisma.contentItem.update({ where: { id: content.id }, data: { repoPath } });

    // create initial split version v1
    await prisma.splitVersion.create({
      data: { contentId: content.id, versionNumber: 1, createdByUserId: userId, status: "draft" }
    });

    // audit: content created + manifest created
    try {
      await prisma.auditEvent.create({
        data: {
          userId,
          action: "content.create",
          entityType: "ContentItem",
          entityId: content.id,
          payloadJson: { title, type } as any
        }
      });
      const manifest = await readManifest(repoPath);
      if (manifest) {
        const manifestHash = computeManifestHash(manifest);
        await prisma.auditEvent.create({
          data: {
            userId,
            action: "content.manifest.create",
            entityType: "ContentItem",
            entityId: content.id,
            payloadJson: { manifestHash } as any
          }
        });
      }
    } catch {}
  } catch (e: any) {
    // cleanup: delete DB row if repo init failed
    await prisma.contentItem.delete({ where: { id: content.id } }).catch(() => {});
    return reply.code(500).send({ error: String((e as any)?.message || String(e)) });
  }

  const created = await prisma.contentItem.findUnique({ where: { id: content.id } });
  return reply.send(created);
});

// Create derivative content (child) with parent links and draft split
app.post("/api/content/:parentId/derivative", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const parentId = asString((req.params as any).parentId);
  const body = (req.body ?? {}) as {
    type?: string;
    title?: string;
    description?: string | null;
    splitDraft?: Array<{ participantEmail?: string; userId?: string; role: string; bps: number }>;
  };

  const title = asString(body.title).trim();
  const typeRaw = asString(body.type || "derivative").trim().toLowerCase();
  const type = (["remix", "mashup", "derivative"] as const).includes(typeRaw as any) ? (typeRaw as any) : "derivative";
  const description = body.description ? asString(body.description).trim() : null;
  if (!title) return badRequest(reply, "title required");

  const parent = await prisma.contentItem.findUnique({ where: { id: parentId } });
  if (!parent) return notFound(reply, "parent content not found");

  let splitDraft = Array.isArray(body.splitDraft) ? body.splitDraft : [];
  if (splitDraft.length === 0) {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const meEmail = me?.email ? normalizeEmail(me.email) : null;
    splitDraft = [
      {
        participantEmail: meEmail || undefined,
        userId,
        role: "writer",
        bps: 10000
      }
    ];
  }

  const child = await prisma.contentItem.create({
    data: { ownerUserId: userId, title, type: type as any, description, status: "draft" as any }
  });

  try {
    const repoPath = await initContentRepo({ root: CONTENTBOX_ROOT, contentId: child.id, type, title });
    await prisma.contentItem.update({ where: { id: child.id }, data: { repoPath } });

    await prisma.$transaction(async (tx) => {
      const link = await tx.contentLink.create({
        data: {
          parentContentId: parentId,
          childContentId: child.id,
          relation: type as any,
          upstreamBps: 0,
          requiresApproval: true
        }
      });

      // Create storefront authorization gate for derivative exposure
      const parentSplit = await tx.splitVersion.findFirst({
        where: { contentId: parentId, status: "locked" },
        orderBy: { versionNumber: "desc" },
        include: { participants: true }
      });
      const parentEmails = parentSplit?.participants
        ?.map((sp) => sp.participantEmail)
        .filter(Boolean)
        .map((e) => String(e).toLowerCase()) || [];
      const parentUsers = parentSplit?.participants?.map((sp) => sp.participantUserId).filter(Boolean) || [];
      const usersFromEmail = parentEmails.length
        ? await tx.user.findMany({ where: { email: { in: parentEmails, mode: "insensitive" } }, select: { id: true } })
        : [];
      const approverIds = Array.from(new Set([...parentUsers.map(String), ...usersFromEmail.map((u) => u.id)]));
      if (approverIds.length === 0) {
        if (parent?.ownerUserId) approverIds.push(parent.ownerUserId);
      }

      await tx.derivativeAuthorization.create({
        data: {
          derivativeLinkId: link.id,
          parentContentId: parentId,
          requiredApprovers: Math.max(1, approverIds.length),
          approvedApprovers: 0,
          approveWeightBps: 0,
          rejectWeightBps: 0,
          approvalPolicy: "BPS_MAJORITY",
          approvalBpsTarget: 6667,
          status: "PENDING"
        }
      });

      const sv = await tx.splitVersion.create({
        data: { contentId: child.id, versionNumber: 1, createdByUserId: userId, status: "draft" }
      });

      for (const sp of splitDraft) {
        const bps = Math.max(0, Math.floor(num(sp.bps)));
        const percent = bps / 100;
        await tx.splitParticipant.create({
          data: {
            splitVersionId: sv.id,
            participantEmail: sp.participantEmail ? normalizeEmail(sp.participantEmail) : null,
            participantUserId: sp.userId || null,
            role: asString(sp.role).trim() || "writer",
            roleCode: "writer" as any,
            percent: String(percent),
            bps
          }
        });
      }
    });
  } catch (e: any) {
    await prisma.contentItem.delete({ where: { id: child.id } }).catch(() => {});
    return reply.code(500).send({ error: String((e as any)?.message || String(e)) });
  }

  return reply.send({ ok: true, childContentId: child.id });
});

// Build and store manifest for content
app.post("/api/content/:contentId/manifest", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).contentId);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) {
    const ok = await isAcceptedParticipant(userId, contentId);
    if (!ok) return forbidden(reply);
  }

  const files = await prisma.contentFile.findMany({ where: { contentId }, orderBy: { createdAt: "asc" } });
  const manifestJson = await buildManifestJson(content, files);
  const previewObjectKey = await ensurePreviewFile(content, files);
  if (previewObjectKey) {
    (manifestJson as any).preview = previewObjectKey;
  }
  const manifestSha256 = hashManifestJson(manifestJson);

  let parentManifestSha256: string | null = null;
  let lineageRelation: any = null;
  const parentLinks = await prisma.contentLink.findMany({ where: { childContentId: contentId } });
  if (parentLinks.length === 1) {
    const parentManifest = await prisma.manifest.findUnique({ where: { contentId: parentLinks[0].parentContentId } });
    parentManifestSha256 = parentManifest?.sha256 || null;
    lineageRelation = parentLinks[0].relation as any;
  }

  const manifest = await prisma.manifest.upsert({
    where: { contentId },
    update: { json: manifestJson as any, sha256: manifestSha256, parentManifestSha256, lineageRelation },
    create: { contentId, json: manifestJson as any, sha256: manifestSha256, parentManifestSha256, lineageRelation }
  });

  await prisma.contentItem.update({ where: { id: contentId }, data: { manifestId: manifest.id } });

  return reply.send({ ok: true, manifestSha256 });
});

// Publish content (locks split + validates upstream)
app.post("/api/content/:contentId/publish", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).contentId);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) {
    const ok = await isAcceptedParticipant(userId, contentId);
    if (!ok) return forbidden(reply);
  }

  const manifest = await prisma.manifest.findUnique({ where: { contentId } });
  if (!manifest) return badRequest(reply, "Manifest missing");

  const parents = await prisma.contentLink.findMany({ where: { childContentId: contentId } });
  const upstreamSum = sumBps(parents.map((p) => ({ bps: p.upstreamBps })));
  if (upstreamSum > 10000) return badRequest(reply, "upstreamBps sum must be <= 10000");

  const sv = await prisma.splitVersion.findFirst({
    where: { contentId },
    orderBy: { versionNumber: "desc" },
    include: { participants: true }
  });
  if (!sv) return badRequest(reply, "Split version missing");

  const totalBps = sumBps(sv.participants.map((p) => ({ bps: toBps(p) })));
  if (totalBps !== 10000) return badRequest(reply, "Split bps must total 10000 to publish");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.splitVersion.update({
      where: { id: sv.id },
      data: { status: "locked", lockedAt: now, lockedManifestSha256: manifest.sha256 }
    });
    await tx.contentItem.update({
      where: { id: contentId },
      data: { status: "published", manifestId: manifest.id, currentSplitId: sv.id }
    });
  });

  // Best-effort: trigger public sharing on publish
  try {
    await triggerPublicStartBestEffort();
  } catch {}

  const publicOrigin = getPublicStatus().publicOrigin;
  return reply.send({ ok: true, publishedAt: now.toISOString(), manifestSha256: manifest.sha256, publicOrigin });
});

// Update storefront status (owner only)
app.patch("/api/content/:id/storefront", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);
  const body = (req.body ?? {}) as { storefrontStatus?: string };

  const status = asString(body.storefrontStatus || "").trim().toUpperCase();
  if (!["DISABLED", "UNLISTED", "LISTED"].includes(status)) {
    return badRequest(reply, "storefrontStatus must be DISABLED|UNLISTED|LISTED");
  }

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) {
    const ok = await isAcceptedParticipant(userId, contentId);
    if (!ok) return forbidden(reply);
  }

  if (status !== "DISABLED") {
    if (!content.manifestId || content.status !== "published") {
      return reply.code(409).send({ code: "CONTENT_NOT_PUBLISHED", message: "Content must be published before listing." });
    }
    const links = await prisma.contentLink.findMany({
      where: {
        childContentId: contentId
      }
    });

    const isDerivativeType = ["derivative", "remix", "mashup"].includes(String(content.type || ""));
    if (isDerivativeType || links.length > 0) {
      if (links.length > 1) {
        return reply.code(409).send({
          code: "MULTIPLE_PARENTS_NOT_SUPPORTED",
          message: "Multiple parent links exist."
        });
      }
      if (links.length === 0) {
        return reply.code(409).send({
          code: "DERIVATIVE_PARENT_REQUIRED",
          message: "Derivative must be linked to an original before being listed publicly."
        });
      }
      for (const link of links) {
        if (link.requiresApproval && !link.approvedAt) {
          return reply.code(409).send({
            code: "DERIVATIVE_NOT_APPROVED",
            message: "Derivative must be approved by upstream owners before being listed publicly."
          });
        }
      }
    }
  }

  const updated = await prisma.contentItem.update({
    where: { id: contentId },
    data: { storefrontStatus: status as any }
  });

  return reply.send({ ok: true, storefrontStatus: updated.storefrontStatus });
});

app.get("/api/content/:id/derivative-authorization", { preHandler: requireAuth }, async (req: any, reply) => {
  const contentId = asString((req.params as any).id);
  const status = await getDerivativeAuthorizationStatus(contentId);
  return reply.send(status);
});

app.get("/api/content/:id/links", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);

  const links = await prisma.contentLink.findMany({
    where: { childContentId: contentId, relation: { in: ["derivative", "remix", "mashup"] as any } },
    orderBy: { createdAt: "asc" }
  });

  const parentLink = links[0] || null;
  const parent = parentLink ? await prisma.contentItem.findUnique({ where: { id: parentLink.parentContentId } }) : null;
  const authStatus = await getDerivativeAuthorizationStatus(contentId);

  return reply.send({
    parentLink: parentLink
      ? {
          id: parentLink.id,
          parentContentId: parentLink.parentContentId,
          parentTitle: parent?.title || "Original work",
          relation: parentLink.relation,
          upstreamBps: parentLink.upstreamBps,
          requiresApproval: parentLink.requiresApproval,
          approvedAt: parentLink.approvedAt || null
        }
      : null,
    authorizationStatus: authStatus?.status || "NONE",
    multipleParents: links.length > 1
  });
});

// List derivatives linked to a parent content item (owner only)
app.get("/api/content/:id/derivatives", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const email = (me?.email || "").toLowerCase();
    const { eligible } = await getEligibleApproversForParent(contentId);
    const ok = eligible.some((a) => matchApproverToUser(a, userId, email));
    if (!ok) return forbidden(reply);
  }

  const links = await prisma.contentLink.findMany({
    where: { parentContentId: contentId },
    include: { childContent: true }
  });

  const auths = await prisma.derivativeAuthorization.findMany({
    where: { derivativeLinkId: { in: links.map((l) => l.id) } }
  });
  const authByLink = new Map(auths.map((a) => [a.derivativeLinkId, a]));

  return reply.send(
    links.map((l) => ({
      linkId: l.id,
      childContentId: l.childContentId,
      childTitle: l.childContent?.title || null,
      childDeletedAt: l.childContent?.deletedAt || null,
      relation: l.relation,
      upstreamBps: l.upstreamBps,
      requiresApproval: l.requiresApproval,
      approvedAt: l.approvedAt || null,
      clearance: authByLink.get(l.id)
        ? {
            status: authByLink.get(l.id)!.status,
            approveWeightBps: authByLink.get(l.id)!.approveWeightBps,
            rejectWeightBps: authByLink.get(l.id)!.rejectWeightBps,
            approvalBpsTarget: authByLink.get(l.id)!.approvalBpsTarget ?? 6667,
            approvedApprovers: authByLink.get(l.id)!.approvedApprovers
          }
        : null
    }))
  );
});

app.get("/content/:id/parent-link", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const email = (me?.email || "").toLowerCase();
    const participant = await prisma.splitParticipant.findFirst({
      where: {
        acceptedAt: { not: null },
        splitVersion: { contentId },
        OR: [
          { participantUserId: userId },
          email ? { participantEmail: { equals: email, mode: "insensitive" } } : undefined
        ].filter(Boolean) as any
      }
    });
    if (!participant) return forbidden(reply);
  }

  const links = await prisma.contentLink.findMany({
    where: { childContentId: contentId },
    orderBy: { id: "asc" }
  });
  if (links.length === 0) return reply.send({ parentLink: null });
  if (links.length > 1) {
    return reply.code(409).send({ code: "MULTIPLE_PARENTS_NOT_SUPPORTED", message: "Multiple parent links exist." });
  }

  const link = links[0];
  const auth = await prisma.derivativeAuthorization.findFirst({ where: { derivativeLinkId: link.id } });
  const parent = await prisma.contentItem.findUnique({ where: { id: link.parentContentId } });
  const { split: parentSplit, eligible } = await getEligibleApproversForParent(link.parentContentId);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const userEmail = (user?.email || "").toLowerCase();
  const isEligibleVoter = eligible.some((p) => matchApproverToUser(p, userId, userEmail));

  return reply.send({
    linkId: link.id,
    relation: link.relation,
    upstreamBps: link.upstreamBps,
    requiresApproval: link.requiresApproval,
    approvedAt: link.approvedAt || null,
    clearance: auth
      ? {
          status: auth.status,
          approveWeightBps: auth.approveWeightBps,
          rejectWeightBps: auth.rejectWeightBps,
          approvalBpsTarget: auth.approvalBpsTarget ?? 6667,
          approvedApprovers: auth.approvedApprovers
        }
      : null,
    parent: parent
      ? {
          id: parent.id,
          title: parent.title,
          type: parent.type,
          status: parent.status,
          storefrontStatus: parent.storefrontStatus
        }
      : null,
    parentSplit: parentSplit
      ? { splitVersionId: parentSplit.id, status: parentSplit.status, lockedAt: parentSplit.lockedAt || null }
      : null,
    canRequestApproval: Boolean(content.ownerUserId === userId) && Boolean(link.requiresApproval) && !link.approvedAt,
    canVote: Boolean(isEligibleVoter) && !link.approvedAt
  });
});

app.post("/content/:id/parent-link", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);
  const body = (req.body ?? {}) as {
    parentContentId?: string;
    relation?: string;
  };

  const child = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!child) return notFound(reply, "Content not found");
  if (child.ownerUserId !== userId) return forbidden(reply);

  const parentContentId = asString(body.parentContentId || "");
  if (!parentContentId) return badRequest(reply, "parentContentId required");
  if (parentContentId === contentId) return badRequest(reply, "Cannot link content to itself");

  const parent = await prisma.contentItem.findUnique({ where: { id: parentContentId } });
  if (!parent) return notFound(reply, "Parent content not found");

  const existingLinks = await prisma.contentLink.findMany({
    where: { childContentId: contentId }
  });
  if (existingLinks.length === 1) {
    return reply.code(409).send({ code: "PARENT_LINK_ALREADY_EXISTS", message: "Parent link already exists." });
  }
  if (existingLinks.length > 1) {
    return reply.code(409).send({ code: "MULTIPLE_PARENTS_NOT_SUPPORTED", message: "Multiple parent links exist." });
  }

  const relation = asString(body.relation || "").toLowerCase();
  if (!["derivative", "remix", "mashup"].includes(relation)) {
    return badRequest(reply, "relation must be derivative|remix|mashup");
  }

  const upstreamBps = 0;
  const requiresApproval = ["derivative", "remix", "mashup"].includes(relation);

  const created = await prisma.contentLink.create({
    data: {
      parentContentId,
      childContentId: contentId,
      relation: relation as any,
      upstreamBps,
      requiresApproval,
      approvedAt: null,
      approvedByUserId: null
    }
  });

  return reply.send(created);
});

app.get("/api/content-links/:id/authorization", { preHandler: requireAuth }, async (req: any, reply) => {
  const id = asString((req.params as any).id);
  const auth = await prisma.derivativeAuthorization.findFirst({ where: { derivativeLinkId: id } });
  if (!auth) return notFound(reply, "Authorization not found");
  return reply.send(auth);
});

app.post("/api/content-links/:id/authorization/request", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const id = asString((req.params as any).id);
  const link = await prisma.contentLink.findUnique({ where: { id } });
  if (!link) return notFound(reply, "Content link not found");
  if (!link.requiresApproval) return badRequest(reply, "Approval not required for this link");

  const child = await prisma.contentItem.findUnique({ where: { id: link.childContentId } });
  if (!child || child.ownerUserId !== userId) return forbidden(reply);

  const { approvers } = await getEligibleApproversForParent(link.parentContentId);
  const existingAuth = await prisma.derivativeAuthorization.findFirst({ where: { derivativeLinkId: link.id } });
  const auth = existingAuth
    ? await prisma.derivativeAuthorization.update({
        where: { id: existingAuth.id },
        data: {
          status: "PENDING",
          approvalPolicy: "BPS_MAJORITY",
          approvalBpsTarget: 6667,
          requiredApprovers: approvers.length
        }
      })
    : await prisma.derivativeAuthorization.create({
        data: {
          derivativeLinkId: link.id,
          parentContentId: link.parentContentId,
          requiredApprovers: approvers.length,
          approvedApprovers: 0,
          approveWeightBps: 0,
          rejectWeightBps: 0,
          approvalPolicy: "BPS_MAJORITY",
          approvalBpsTarget: 6667,
          status: "PENDING"
        }
      });

  return reply.send(auth);
});

app.post("/api/derivative-authorizations/:id/vote", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const id = asString((req.params as any).id);
  const body = (req.body ?? {}) as { decision?: string; upstreamRatePercent?: number };
  const decision = asString(body.decision || "").trim().toUpperCase();
  if (!["APPROVE", "REJECT"].includes(decision)) return badRequest(reply, "decision must be APPROVE|REJECT");

  const auth = await prisma.derivativeAuthorization.findUnique({
    where: { id },
    include: { derivativeLink: true }
  });
  if (!auth) return notFound(reply, "Authorization not found");

  const upstreamRatePctRaw = Number(body.upstreamRatePercent);
  if (decision === "APPROVE" && !Number.isFinite(upstreamRatePctRaw)) {
    return badRequest(reply, "upstreamRatePercent required for approve");
  }
  const upstreamRateBps = Number.isFinite(upstreamRatePctRaw)
    ? Math.max(0, Math.min(10000, Math.round(upstreamRatePctRaw * 100)))
    : 0;

  const participants = await getParentLockedParticipantsForVote(auth.parentContentId);
  const voter = participants.find((p) => p.userId === userId);
  if (!voter) return reply.code(403).send({ code: "NOT_ELIGIBLE", message: "Not eligible to vote." });

  await prisma.derivativeApprovalVote.upsert({
    where: { authorizationId_approverUserId: { authorizationId: auth.id, approverUserId: userId } },
    update: { decision },
    create: { authorizationId: auth.id, approverUserId: userId, approverSplitParticipantId: voter.splitParticipantId, decision }
  });

  const votes = await prisma.derivativeApprovalVote.findMany({ where: { authorizationId: auth.id } });
  const approveVotes = votes.filter((v) => v.decision === "APPROVE");
  if (decision === "APPROVE" && approveVotes.length > 1 && auth.derivativeLink.upstreamBps !== upstreamRateBps) {
    return reply.code(409).send({ code: "UPSTREAM_RATE_MISMATCH", message: "Approve votes must use the same upstream rate." });
  }
  if (decision === "APPROVE" && approveVotes.length === 1 && auth.derivativeLink.upstreamBps !== upstreamRateBps) {
    await prisma.contentLink.update({
      where: { id: auth.derivativeLink.id },
      data: { upstreamBps: upstreamRateBps }
    });
    auth.derivativeLink.upstreamBps = upstreamRateBps;
  }

  const approveWeightBps = votes
    .filter((v) => v.decision === "APPROVE")
    .map((v) => participants.find((p) => p.userId === v.approverUserId)?.bps || 0)
    .reduce((s, b) => s + b, 0);
  const rejectWeightBps = votes
    .filter((v) => v.decision === "REJECT")
    .map((v) => participants.find((p) => p.userId === v.approverUserId)?.bps || 0)
    .reduce((s, b) => s + b, 0);
  const approvedApprovers = votes.filter((v) => v.decision === "APPROVE").length;

  let status = "PENDING";
  const target = auth.approvalBpsTarget ?? 6667;
  if (approveWeightBps >= target) status = "APPROVED";
  else if (rejectWeightBps >= target) status = "REJECTED";

  const updated = await prisma.derivativeAuthorization.update({
    where: { id: auth.id },
    data: { approveWeightBps, rejectWeightBps, approvedApprovers, status }
  });

  if (status === "APPROVED" && !auth.derivativeLink.approvedAt) {
    await prisma.contentLink.update({
      where: { id: auth.derivativeLink.id },
      data: { approvedAt: new Date(), approvedByUserId: userId, requiresApproval: true }
    });
  }

  return reply.send(updated);
});

app.get("/api/derivatives/approvals", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const scopeRaw = asString((req.query || {})?.scope || "pending").toLowerCase();
  const scope = ["pending", "voted", "cleared", "all"].includes(scopeRaw) ? scopeRaw : "pending";
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const meEmail = (me?.email || "").toLowerCase();
  const auths = await prisma.derivativeAuthorization.findMany({
    where: scope === "cleared" ? { status: "APPROVED" } : {},
    include: { derivativeLink: { include: { childContent: true, parentContent: true } } }
  });

  const out: any[] = [];
  for (const a of auths) {
    const { eligible } = await getEligibleApproversForParent(a.parentContentId);
    const parent = await prisma.contentItem.findUnique({
      where: { id: a.parentContentId },
      select: { ownerUserId: true }
    });
    const existingVote = await prisma.derivativeApprovalVote.findUnique({
      where: { authorizationId_approverUserId: { authorizationId: a.id, approverUserId: userId } }
    });
    const isEligible =
      eligible.some((p) => matchApproverToUser(p, userId, meEmail)) || (parent?.ownerUserId === userId);

    if (scope === "pending") {
      if (!isEligible) continue;
      if (a.status !== "PENDING") continue;
      if (existingVote) continue;
    } else if (scope === "voted") {
      if (!existingVote) continue;
    } else if (scope === "cleared") {
      if (a.status !== "APPROVED") continue;
      if (!isEligible && !existingVote) continue;
    } else if (scope === "all") {
      if (!isEligible && !existingVote) continue;
    }
    out.push({
      authorizationId: a.id,
      linkId: a.derivativeLink.id,
      parentContentId: a.parentContentId,
      parentTitle: a.derivativeLink.parentContent?.title || null,
      childContentId: a.derivativeLink.childContentId,
      childTitle: a.derivativeLink.childContent?.title || null,
      relation: a.derivativeLink.relation,
      status: a.status,
      viewerVote: existingVote?.decision || null
    });
  }

  return reply.send(out);
});

// TODO(legacy): remove this alias after UI migrates to /content-links/:linkId/vote (target: 2026-06).
app.post("/api/derivatives/:childId/approve", { preHandler: requireAuth }, async (req: any, reply) => {
  if (process.env.ENABLE_LEGACY_DERIVATIVE_APPROVE === "false") {
    return reply.code(410).send({ error: "Legacy derivative approval route disabled." });
  }
  reply.header("Deprecation", "true");
  if (process.env.NODE_ENV !== "production") {
    app.log.warn({ path: "/api/derivatives/:childId/approve" }, "deprecated.route");
  }

  const userId = (req.user as JwtUser).sub;
  const childId = asString((req.params as any).childId);
  const body = (req.body ?? {}) as { decision?: string; upstreamRatePercent?: number };
  const decision = asString(body.decision || "").trim().toLowerCase();

  const links = await prisma.contentLink.findMany({ where: { childContentId: childId } });
  if (links.length === 0) return notFound(reply, "No parent link found");
  if (links.length > 1) {
    return reply.code(409).send({ code: "MULTIPLE_PARENTS_NOT_SUPPORTED", message: "Multiple parent links exist." });
  }

  return app.inject({
    method: "POST",
    url: `/content-links/${encodeURIComponent(links[0].id)}/vote`,
    headers: { authorization: (req.headers?.authorization as any) || "" },
    payload: { decision, upstreamRatePercent: body.upstreamRatePercent }
  }).then((res) => {
    reply.status(res.statusCode).headers(res.headers as any);
    reply.header("Deprecation", "true");
    let out: any = {};
    if (res.body) {
      try {
        out = JSON.parse(res.body as any);
      } catch {
        out = { message: String(res.body) };
      }
    }
    return reply.send(out);
  });
});

app.post("/content-links/:linkId/request-approval", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const linkId = asString((req.params as any).linkId);
  const link = await prisma.contentLink.findUnique({ where: { id: linkId } });
  if (!link) return notFound(reply, "Content link not found");

  const child = await prisma.contentItem.findUnique({ where: { id: link.childContentId } });
  if (!child) return notFound(reply, "Content not found");
  if (child.ownerUserId !== userId) return forbidden(reply);

  const parentSplit = await getLockedSplitForContent(link.parentContentId);
  if (!parentSplit || parentSplit.status !== "locked") {
    return reply.code(409).send({ code: "PARENT_SPLIT_NOT_LOCKED", message: "Parent split must be locked before approval." });
  }
  const { approvers } = await getApproversForParent(link.parentContentId);

  const existing = await prisma.derivativeAuthorization.findFirst({ where: { derivativeLinkId: linkId } });
  const auth =
    existing ||
    (await prisma.derivativeAuthorization.create({
      data: {
        derivativeLinkId: linkId,
        parentContentId: link.parentContentId,
        requiredApprovers: approvers.length,
        approvedApprovers: 0,
        approveWeightBps: 0,
        rejectWeightBps: 0,
        approvalPolicy: "WEIGHTED_BPS",
        approvalBpsTarget: 6667,
        status: "PENDING"
      }
    }));

  // Create a clearance request record (idempotent on PENDING)
  const clearanceModel = (prisma as any).clearanceRequest;
  const approvalTokenModel = (prisma as any).approvalToken;
  if (!clearanceModel || !approvalTokenModel) {
    return reply.code(501).send({ error: "Clearance requests not enabled. Restart API after migrations." });
  }

  const existingReq = await clearanceModel.findFirst({
    where: { contentLinkId: linkId, status: "PENDING" }
  });
  if (!existingReq) {
    await clearanceModel.create({
      data: { contentLinkId: linkId, requestedByUserId: userId, status: "PENDING" }
    });
  }

  // Generate external approval tokens for parent stakeholders (email-based)
  const ttlHours = Math.max(1, Math.min(24 * 30, num(process.env.CLEARANCE_TOKEN_TTL_HOURS || 168)));
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const approvalUrls: Array<{ email: string; url: string; weightBps: number }> = [];

  for (const p of approvers) {
    const email = p.participantEmail ? normalizeEmail(p.participantEmail) : "";
    if (!email) continue;
    const weightBps = p.weightBps || 0;
    const token = makeApprovalToken();
    const tokenHash = hashApprovalToken(token);
    await approvalTokenModel.create({
      data: {
        contentLinkId: linkId,
        tokenHash,
        approverEmail: email,
        weightBps,
        expiresAt
      }
    });
    approvalUrls.push({ email, url: `${APP_BASE_URL}/clearance/${token}`, weightBps });
  }

  return reply.send({ ok: true, authorization: auth, approvalUrls, expiresAt });
});

// Compatibility: request clearance (musician wording)
app.post("/content-links/:linkId/request-clearance", { preHandler: requireAuth }, async (req: any, reply) => {
  return app
    .inject({
      method: "POST",
      url: `/content-links/${encodeURIComponent(asString((req.params as any).linkId))}/request-approval`,
      headers: { authorization: (req.headers?.authorization as any) || "" }
    })
    .then((res) => {
      reply.status(res.statusCode).headers(res.headers as any);
      let out: any = {};
      if (res.body) {
        try {
          out = JSON.parse(res.body as any);
        } catch {
          out = { message: String(res.body) };
        }
      }
      return reply.send(out);
    });
});

app.post("/content-links/:linkId/vote", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const linkId = asString((req.params as any).linkId);
  const body = (req.body ?? {}) as { decision?: string; upstreamRatePercent?: number };
  const decision = asString(body.decision || "").toLowerCase();
  if (!["approve", "reject"].includes(decision)) return badRequest(reply, "decision must be approve|reject");

  const link = await prisma.contentLink.findUnique({ where: { id: linkId } });
  if (!link) return notFound(reply, "Content link not found");

  const parentSplit = await getLockedSplitForContent(link.parentContentId);
  if (!parentSplit || parentSplit.status !== "locked") {
    return reply.code(409).send({ code: "PARENT_SPLIT_NOT_LOCKED", message: "Parent split must be locked before voting." });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const userEmail = (user?.email || "").toLowerCase();
  const { eligible, approvers } = await getEligibleApproversForParent(link.parentContentId);
  const parent = await prisma.contentItem.findUnique({
    where: { id: link.parentContentId },
    select: { ownerUserId: true }
  });
  const emails = approvers
    .map((a) => (a.participantEmail || "").toLowerCase())
    .filter(Boolean);
  const emailUsers = emails.length
    ? await prisma.user.findMany({ where: { email: { in: emails, mode: "insensitive" } }, select: { email: true } })
    : [];
  const emailsWithUsers = new Set(emailUsers.map((u) => (u.email || "").toLowerCase()));
  function resolveApprover(uId: string, uEmail: string) {
    const direct = eligible.find((p) => matchApproverToUser(p, uId, uEmail));
    if (direct) return direct;
    if (parent?.ownerUserId === uId) {
      const candidates = eligible.filter(
        (p) => p.participantEmail && !emailsWithUsers.has(p.participantEmail.toLowerCase())
      );
      if (candidates.length === 1) return candidates[0];
    }
    return null;
  }
  const ok = Boolean(resolveApprover(userId, userEmail));
  if (!ok) return forbidden(reply);

  const existingAuths = await prisma.derivativeAuthorization.findMany({
    where: { derivativeLinkId: linkId },
    orderBy: { createdAt: "asc" }
  });
  const auth =
    existingAuths[0] ||
    (await prisma.derivativeAuthorization.create({
      data: {
        derivativeLinkId: linkId,
        parentContentId: link.parentContentId,
        requiredApprovers: parentSplit.participants.length,
        approvedApprovers: 0,
        approveWeightBps: 0,
        rejectWeightBps: 0,
        approvalPolicy: "WEIGHTED_BPS",
        approvalBpsTarget: 6667,
        status: "PENDING"
      }
    }));

  const upstreamRatePctRaw = Number(body.upstreamRatePercent);
  if (decision === "approve" && !Number.isFinite(upstreamRatePctRaw)) {
    return badRequest(reply, "upstreamRatePercent required for approve");
  }
  const upstreamRateBps = Number.isFinite(upstreamRatePctRaw)
    ? Math.max(0, Math.min(10000, Math.round(upstreamRatePctRaw * 100)))
    : 0;

  await prisma.derivativeApprovalVote.upsert({
    where: { authorizationId_approverUserId: { authorizationId: auth.id, approverUserId: userId } },
    update: { decision },
    create: { authorizationId: auth.id, approverUserId: userId, decision }
  });

  const votes = await prisma.derivativeApprovalVote.findMany({ where: { authorizationId: auth.id } });
  const approveVotes = votes.filter((v) => String(v.decision).toLowerCase() === "approve");
  if (decision === "approve" && approveVotes.length > 1 && link.upstreamBps !== upstreamRateBps) {
    return reply.code(409).send({ code: "UPSTREAM_RATE_MISMATCH", message: "Approve votes must use the same upstream rate." });
  }
  if (decision === "approve" && approveVotes.length === 1 && link.upstreamBps !== upstreamRateBps) {
    await prisma.contentLink.update({
      where: { id: link.id },
      data: { upstreamBps: upstreamRateBps }
    });
    link.upstreamBps = upstreamRateBps;
  }

  const voteUserIds = votes.map((v) => v.approverUserId);
  const voteUsers = voteUserIds.length
    ? await prisma.user.findMany({ where: { id: { in: voteUserIds } }, select: { id: true, email: true } })
    : [];
  const voteUserEmailById = new Map(voteUsers.map((u) => [u.id, (u.email || "").toLowerCase()]));
  let approveBps = 0;
  let rejectBps = 0;
  for (const v of votes) {
    const vEmail = voteUserEmailById.get(v.approverUserId) || "";
    const p = resolveApprover(v.approverUserId, vEmail);
    const bps = p ? p.weightBps : 0;
    if (String(v.decision).toLowerCase() === "approve") approveBps += bps;
    if (String(v.decision).toLowerCase() === "reject") rejectBps += bps;
  }

  let status: string = "PENDING";
  if (approveBps >= auth.approvalBpsTarget) status = "APPROVED";
  // v1: keep rejections as PENDING

  await prisma.derivativeAuthorization.update({
    where: { id: auth.id },
    data: {
      approvedApprovers: votes.filter((v) => String(v.decision).toLowerCase() === "approve").length,
      approveWeightBps: approveBps,
      rejectWeightBps: rejectBps,
      status
    }
  });

  if (status === "APPROVED" && !link.approvedAt) {
    if (link.upstreamBps !== upstreamRateBps && upstreamRateBps !== 0) {
      return reply.code(409).send({ code: "UPSTREAM_RATE_MISMATCH", message: "Approve votes must use the same upstream rate." });
    }
    const updated = await prisma.contentLink.update({
      where: { id: link.id },
      data: { approvedAt: new Date(), approvedByUserId: userId, requiresApproval: true }
    });
    try {
      await prisma.auditEvent.create({
        data: {
          userId,
          action: "clearance.grant",
          entityType: "ContentLink",
          entityId: updated.id,
          payloadJson: {
            upstreamBps: updated.upstreamBps,
            approvedAt: updated.approvedAt
          } as any
        }
      });
    } catch {}
  }

  return reply.send({ ok: true, status, approveWeightBps: approveBps, rejectWeightBps: rejectBps });
});

// Clearance summary for UI (approvers + votes + progress)
app.get("/content-links/:linkId/clearance", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const linkId = asString((req.params as any).linkId);
  const link = await prisma.contentLink.findUnique({ where: { id: linkId } });
  if (!link) return notFound(reply, "Content link not found");

  const thresholdBps = 6667;
  const { approvers, eligible } = await getEligibleApproversForParent(link.parentContentId);
  const parent = await prisma.contentItem.findUnique({
    where: { id: link.parentContentId },
    select: { ownerUserId: true }
  });
  const emails = approvers
    .map((a) => (a.participantEmail || "").toLowerCase())
    .filter(Boolean);
  const emailUsers = emails.length
    ? await prisma.user.findMany({ where: { email: { in: emails, mode: "insensitive" } }, select: { email: true } })
    : [];
  const emailsWithUsers = new Set(emailUsers.map((u) => (u.email || "").toLowerCase()));
  function resolveApprover(uId: string, uEmail: string) {
    const direct = eligible.find((p) => matchApproverToUser(p, uId, uEmail));
    if (direct) return direct;
    if (parent?.ownerUserId === uId) {
      const candidates = eligible.filter(
        (p) => p.participantEmail && !emailsWithUsers.has(p.participantEmail.toLowerCase())
      );
      if (candidates.length === 1) return candidates[0];
    }
    return null;
  }

  const auths = await prisma.derivativeAuthorization.findMany({ where: { derivativeLinkId: linkId } });
  const authIds = auths.map((a) => a.id);
  const internalVotesRaw =
    authIds.length > 0
      ? await prisma.derivativeApprovalVote.findMany({
          where: { authorizationId: { in: authIds } },
          orderBy: { createdAt: "asc" }
        })
      : [];
  const voteByUserId = new Map<string, typeof internalVotesRaw[number]>();
  for (const v of internalVotesRaw) {
    voteByUserId.set(v.approverUserId, v);
  }
  const internalVotes = Array.from(voteByUserId.values());
  const voteUserIds = internalVotes.map((v) => v.approverUserId);
  const voteUsers = voteUserIds.length
    ? await prisma.user.findMany({ where: { id: { in: voteUserIds } }, select: { id: true, email: true, displayName: true } })
    : [];
  const voteUserById = new Map(voteUsers.map((u) => [u.id, u]));

  const externalVotes = await prisma.approvalToken.findMany({
    where: { contentLinkId: linkId, decision: { not: null } }
  });

  const approvedRatePercent = link.upstreamBps ? link.upstreamBps / 100 : null;

  const votes: any[] = [
    ...internalVotes.map((v) => {
      const u = voteUserById.get(v.approverUserId);
      const email = (u?.email || "").toLowerCase();
      const p = resolveApprover(v.approverUserId, email);
      return {
        kind: "internal",
        approverUserId: v.approverUserId,
        approverEmail: u?.email || null,
        decision: v.decision,
        upstreamRatePercent: approvedRatePercent,
        weightBps: p?.weightBps || 0
      };
    }),
    ...externalVotes.map((v) => ({
      kind: "external",
      approverUserId: null,
      approverEmail: v.approverEmail || null,
      decision: v.decision,
      upstreamRatePercent: v.upstreamRatePercent ?? null,
      weightBps: v.weightBps || 0
    }))
  ];

  const progressBps = votes.reduce((s, v) => {
    if (String(v.decision).toLowerCase() !== "approve") return s;
    if (approvedRatePercent !== null && v.upstreamRatePercent !== null && Number(v.upstreamRatePercent) !== Number(approvedRatePercent)) {
      return s;
    }
    return s + (v.weightBps || 0);
  }, 0);

  const viewer = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const viewerEmail = (viewer?.email || "").toLowerCase();
  const viewerApprover = resolveApprover(userId, viewerEmail);
  const viewerVote = internalVotes.find((v) => v.approverUserId === userId) || null;

  return reply.send({
    requiresApproval: link.requiresApproval,
    approvedAt: link.approvedAt ? link.approvedAt.toISOString() : null,
    upstreamBps: link.upstreamBps || 0,
    thresholdBps,
    approvers,
    votes,
    progressBps,
    viewer: {
      canVote: Boolean(viewerApprover) && !link.approvedAt,
      hasVoted: Boolean(viewerVote),
      decision: viewerVote ? viewerVote.decision : null,
      weightBps: viewerApprover?.weightBps || 0
    }
  });
});

// Access check for a manifest (entitlement-based)
app.get("/api/content/:id/access", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);
  const manifestSha256 = asString((req.query || {})?.manifestSha256 || "").trim();
  if (!manifestSha256) return badRequest(reply, "manifestSha256 required");

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");

  const manifest = await prisma.manifest.findUnique({ where: { contentId } });
  if (!manifest || manifest.sha256 !== manifestSha256) return badRequest(reply, "manifestSha256 does not match content manifest");

  if (content.ownerUserId !== userId) {
    const entitlement = await prisma.entitlement.findUnique({
      where: { buyerUserId_contentId_manifestSha256: { buyerUserId: userId, contentId, manifestSha256 } }
    });
    if (!entitlement) return forbidden(reply);
  }

  const manifestJson = manifest.json as any;
  return reply.send({
    ok: true,
    manifestSha256: manifest.sha256,
    files: Array.isArray(manifestJson?.files) ? manifestJson.files : [],
    manifest: manifestJson
  });
});

// Public access via receipt token (no auth)
async function handlePublicContentAccess(req: any, reply: any) {
  const contentId = asString((req.params as any).id);
  const manifestSha256 = asString((req.query || {})?.manifestSha256 || "").trim();
  const receiptToken = asString((req.query || {})?.receiptToken || "").trim();
  if (!manifestSha256) return badRequest(reply, "manifestSha256 required");
  if (!receiptToken) return badRequest(reply, "receiptToken required");

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.storefrontStatus === "DISABLED") return notFound(reply, "Not found");
  const publicLinks = await prisma.contentLink.findMany({ where: { childContentId: contentId } });
  if (publicLinks.length > 1) return notFound(reply, "Not found");
  const isDerivativeType = ["derivative", "remix", "mashup"].includes(String(content.type || ""));
  if (isDerivativeType || publicLinks.length > 0) {
    if (publicLinks.length === 0) return notFound(reply, "Not found");
    if (publicLinks[0].requiresApproval && !publicLinks[0].approvedAt) return notFound(reply, "Not found");
  }

  const manifest = await prisma.manifest.findUnique({ where: { contentId } });
  if (!manifest || manifest.sha256 !== manifestSha256) return badRequest(reply, "manifestSha256 does not match content manifest");

  const intent = await prisma.paymentIntent.findFirst({
    where: {
      contentId,
      manifestSha256,
      receiptToken,
      status: "paid"
    }
  });

  if (!intent) return forbidden(reply);
  if (intent.receiptTokenExpiresAt && intent.receiptTokenExpiresAt.getTime() < Date.now()) return forbidden(reply);

  const manifestJson = manifest.json as any;
  return reply.send({
    ok: true,
    manifestSha256: manifest.sha256,
    files: Array.isArray(manifestJson?.files) ? manifestJson.files : [],
    manifest: manifestJson
  });
}

app.get("/public/content/:id/access", handlePublicContentAccess);

// Public storefront content metadata (no auth)
async function handlePublicContent(req: any, reply: any) {
  const contentId = asString((req.params as any).id);
  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.storefrontStatus === "DISABLED") return notFound(reply, "Not found");
  const publicLinks = await prisma.contentLink.findMany({ where: { childContentId: contentId } });
  if (publicLinks.length > 1) return notFound(reply, "Not found");
  const isDerivativeType = ["derivative", "remix", "mashup"].includes(String(content.type || ""));
  if (isDerivativeType || publicLinks.length > 0) {
    if (publicLinks.length === 0) return notFound(reply, "Not found");
    if (publicLinks[0].requiresApproval && !publicLinks[0].approvedAt) return notFound(reply, "Not found");
  }

  const manifest = await prisma.manifest.findUnique({ where: { contentId } });
  if (!manifest) return notFound(reply, "Manifest not found");

  const host = (req.headers["x-forwarded-host"] || req.headers["host"]) as string | undefined;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) || (req.protocol as string | undefined) || "http";
  const baseUrl = host ? `${proto}://${host}` : "";
  const normalizePreview = (value: string | null) => {
    if (!value) return null;
    const v = String(value).trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    return baseUrl ? `${baseUrl}/public/content/${contentId}/preview-file?objectKey=${encodeURIComponent(v)}` : null;
  };

  return reply.send({
    contentId: content.id,
    title: content.title,
    description: content.description || null,
    storefrontStatus: content.storefrontStatus,
    manifestSha256: manifest.sha256,
    priceSats: content.priceSats != null ? content.priceSats.toString() : null,
    cover: normalizePreview((manifest.json as any)?.cover || null),
    preview: normalizePreview((manifest.json as any)?.preview || null)
  });
}

app.get("/public/content/:id", handlePublicContent);

// Public preview file (no auth; only when content is publicly visible)
async function handlePublicPreviewFile(req: any, reply: any) {
  const contentId = asString((req.params as any).id);
  const objectKey = asString((req.query || {})?.objectKey || "").trim();
  if (!objectKey) return badRequest(reply, "objectKey required");

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.storefrontStatus === "DISABLED") return notFound(reply, "Not found");
  const publicLinks = await prisma.contentLink.findMany({ where: { childContentId: contentId } });
  if (publicLinks.length > 1) return notFound(reply, "Not found");
  const isDerivativeType = ["derivative", "remix", "mashup"].includes(String(content.type || ""));
  if (isDerivativeType || publicLinks.length > 0) {
    if (publicLinks.length === 0) return notFound(reply, "Not found");
    if (publicLinks[0].requiresApproval && !publicLinks[0].approvedAt) return notFound(reply, "Not found");
  }

  if (!content.repoPath) return notFound(reply, "Content not found");
  const repoRoot = path.resolve(content.repoPath);
  const absPath = path.resolve(repoRoot, objectKey);
  if (!absPath.startsWith(repoRoot)) return forbidden(reply);
  if (!fsSync.existsSync(absPath)) return notFound(reply, "File not found");

  const file = await prisma.contentFile.findFirst({ where: { contentId, objectKey } });
  const mime = file?.mime || "application/octet-stream";

  const stat = fsSync.statSync(absPath);
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d+)-(\d+)?/.exec(range);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : stat.size - 1;
      if (start >= stat.size) return reply.code(416).send();
      reply.code(206);
      reply.header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      reply.header("Accept-Ranges", "bytes");
      reply.header("Content-Length", end - start + 1);
      reply.type(mime);
      return reply.send(fsSync.createReadStream(absPath, { start, end }));
    }
  }

  reply.header("Content-Length", stat.size);
  reply.type(mime);
  return reply.send(fsSync.createReadStream(absPath));
}

app.get("/public/content/:id/preview-file", handlePublicPreviewFile);
app.get("/buy/content/:id/preview-file", handlePublicPreviewFile);

// Public credits (only when content is publicly visible)
async function handlePublicCredits(req: any, reply: any) {
  const contentId = asString((req.params as any).id);
  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.storefrontStatus === "DISABLED") return notFound(reply, "Not found");
  const publicLinks = await prisma.contentLink.findMany({ where: { childContentId: contentId } });
  if (publicLinks.length > 1) return notFound(reply, "Not found");
  const isDerivativeType = ["derivative", "remix", "mashup"].includes(String(content.type || ""));
  if (isDerivativeType || publicLinks.length > 0) {
    if (publicLinks.length === 0) return notFound(reply, "Not found");
    if (publicLinks[0].requiresApproval && !publicLinks[0].approvedAt) return notFound(reply, "Not found");
  }

  const credits = await prisma.contentCredit.findMany({
    where: { contentId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
  return reply.send(credits);
}

app.get("/public/content/:id/credits", handlePublicCredits);

// Short public link -> buy page
async function handleShortPublicLink(req: any, reply: any) {
  const token = asString((req.params as any).token || "").trim();
  if (!token) return notFound(reply, "Not found");
  const content = await prisma.contentItem.findUnique({ where: { id: token } });
  if (!content) return notFound(reply, "Not found");
  if (content.status !== "published") return notFound(reply, "Not found");
  if (content.storefrontStatus === "DISABLED") return notFound(reply, "Not found");
  return reply.redirect(`/buy/${encodeURIComponent(token)}`);
}

app.get("/p/:token", handleShortPublicLink);

// External clearance page (no login required)
app.get("/clearance/:token", async (req: any, reply) => {
  const token = asString((req.params as any).token);
  if (!token) return notFound(reply, "Not found");
  const tokenHash = hashApprovalToken(token);

  const approval = await prisma.approvalToken.findUnique({ where: { tokenHash } });
  if (!approval) return notFound(reply, "Not found");
  if (approval.usedAt) return reply.code(410).send("This clearance link has already been used.");
  if (approval.expiresAt.getTime() < Date.now()) return reply.code(410).send("This clearance link has expired.");

  const link = await prisma.contentLink.findUnique({ where: { id: approval.contentLinkId } });
  if (!link) return notFound(reply, "Not found");
  const parent = await prisma.contentItem.findUnique({ where: { id: link.parentContentId } });
  const child = await prisma.contentItem.findUnique({ where: { id: link.childContentId } });

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clearance / License for Release</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: #0b0b0b; color: #eee; padding: 24px; }
    .card { max-width: 680px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 12px; padding: 20px; }
    .muted { color: #9aa0a6; font-size: 13px; }
    input { padding: 8px 10px; border-radius: 8px; border: 1px solid #333; background: #0e0e0e; color: #fff; }
    button { padding: 10px 14px; border-radius: 10px; border: 1px solid #333; background: #141414; color: #fff; cursor: pointer; }
    button.primary { border-color: #1b4d2b; background: #0f2a1a; }
    button.danger { border-color: #5b1a1a; background: #2a0f0f; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Clearance / License for Release</h2>
    <div class="muted">Original: <strong>${parent?.title || "Original work"}</strong></div>
    <div class="muted">Derivative: <strong>${child?.title || "Derivative"}</strong></div>
    <p class="muted">Set the upstream royalty % and grant clearance to unlock public release.</p>
    <label class="muted">Upstream % (required for clearance)</label><br/>
    <input id="upstreamRatePercent" type="number" min="0" max="100" step="0.01" placeholder="10" required />
    <div style="margin-top: 12px; display:flex; gap:10px;">
      <button class="primary" id="grantBtn" type="button">Grant clearance</button>
      <button class="danger" id="rejectBtn" type="button">Reject</button>
    </div>
    <div id="msg" class="muted" style="margin-top:10px;"></div>
  </div>
  <script>
    const msg = document.getElementById("msg");
    async function submit(decision) {
      const pct = document.getElementById("upstreamRatePercent").value;
      const body = decision === "approve" ? { decision, upstreamRatePercent: pct } : { decision };
      try {
        const r = await fetch("/clearance/${encodeURIComponent(token)}/vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const text = await r.text();
        msg.textContent = text || (r.ok ? "Recorded." : "Failed.");
      } catch (e) {
        msg.textContent = "Failed to submit.";
      }
    }
    document.getElementById("grantBtn").addEventListener("click", () => submit("approve"));
    document.getElementById("rejectBtn").addEventListener("click", () => submit("reject"));
  </script>
</body>
</html>`;

  reply.type("text/html").send(html);
});

app.post("/clearance/:token/vote", async (req: any, reply) => {
  const token = asString((req.params as any).token);
  if (!token) return notFound(reply, "Not found");
  const tokenHash = hashApprovalToken(token);
  const approval = await prisma.approvalToken.findUnique({ where: { tokenHash } });
  if (!approval) return notFound(reply, "Not found");
  if (approval.usedAt) return reply.code(410).send("This clearance link has already been used.");
  if (approval.expiresAt.getTime() < Date.now()) return reply.code(410).send("This clearance link has expired.");

  const bodyRaw = req.body ?? {};
  const body =
    typeof bodyRaw === "string"
      ? Object.fromEntries(new URLSearchParams(bodyRaw))
      : (bodyRaw as Record<string, unknown>);
  const decision = asString((body as any)?.decision || "").toLowerCase();
  if (!["approve", "reject"].includes(decision)) return badRequest(reply, "decision must be approve|reject");

  const link = await prisma.contentLink.findUnique({ where: { id: approval.contentLinkId } });
  if (!link) return notFound(reply, "Not found");

  let upstreamRatePercent: number | null = null;
  if (decision === "approve") {
    const raw = Number((body as any)?.upstreamRatePercent);
    if (!Number.isFinite(raw)) return badRequest(reply, "upstreamRatePercent required");
    if (raw < 0 || raw > 100) return badRequest(reply, "upstreamRatePercent must be 0-100");
    upstreamRatePercent = raw;
  }

  // Enforce single upstream rate across approvals
  if (decision === "approve") {
    const prior = await prisma.approvalToken.findMany({
      where: { contentLinkId: link.id, decision: "approve" }
    });
    const existingRate = prior.find((p) => p.upstreamRatePercent !== null)?.upstreamRatePercent;
    if (existingRate !== null && upstreamRatePercent !== null) {
      const er = Number(existingRate);
      if (Math.abs(er - upstreamRatePercent) > 0.0001) {
        return reply.code(409).send({ code: "UPSTREAM_RATE_MISMATCH", message: "Upstream rate must match existing approvals." });
      }
    }
  }

  await prisma.approvalToken.update({
    where: { tokenHash },
    data: {
      decision,
      upstreamRatePercent: upstreamRatePercent === null ? null : upstreamRatePercent,
      usedAt: new Date()
    }
  });

  // Recompute approval weight (fallback to parent split if token weight is missing/zero)
  const approved = await prisma.approvalToken.findMany({
    where: { contentLinkId: link.id, decision: "approve" }
  });
  const parentSplit = await getLockedSplitForContent(link.parentContentId);
  const approvedWeight = approved.reduce((s, a) => {
    const base = a.weightBps || 0;
    if (base > 0) return s + base;
    if (parentSplit && a.approverEmail) {
      const email = String(a.approverEmail).toLowerCase();
      const p = parentSplit.participants.find(
        (pp) => pp.participantEmail && pp.participantEmail.toLowerCase() === email
      );
      if (p) return s + toBps(p);
    }
    return s;
  }, 0);

  if (process.env.NODE_ENV !== "production") {
    app.log.info({ linkId: link.id, approvedWeight }, "clearance.vote");
  }

  if (approvedWeight >= 6667) {
    const rate = approved.find((a) => a.upstreamRatePercent !== null)?.upstreamRatePercent;
    const upstreamBps = Math.round(num(rate) * 100);

    const updated = await prisma.contentLink.update({
      where: { id: link.id },
      data: { upstreamBps, approvedAt: new Date() }
    });

    await prisma.derivativeAuthorization.updateMany({
      where: { derivativeLinkId: link.id },
      data: { status: "APPROVED" }
    });

    await prisma.clearanceRequest.updateMany({
      where: { contentLinkId: link.id, status: "PENDING" },
      data: { status: "CLEARED" }
    });

    try {
      await prisma.auditEvent.create({
        data: {
          userId: updated.approvedByUserId || "external",
          action: "clearance.grant",
          entityType: "ContentLink",
          entityId: updated.id,
          payloadJson: {
            upstreamBps: updated.upstreamBps,
            approvedAt: updated.approvedAt
          } as any
        }
      });
    } catch {}
  }

  return reply.send("Thanks — your clearance response has been recorded.");
});

async function handleBuyPage(req: any, reply: any) {
  const contentId = asString((req.params as any).contentId || "").trim();
  if (!contentId) return notFound(reply, "Not found");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Buy</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin:0; background:#0b0b0b; color:#f4f4f5; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 24px; }
    .card { background:#111; border:1px solid #222; border-radius:16px; padding:20px; }
    .muted { color:#a1a1aa; font-size:14px; }
    .row { display:flex; gap:16px; flex-wrap:wrap; }
    .rail { flex:1 1 280px; border:1px solid #222; border-radius:12px; padding:12px; background:#0f0f10; }
    .btn { background:#fff; color:#000; border:none; border-radius:10px; padding:10px 14px; font-weight:600; cursor:pointer; }
    .btn:disabled { opacity:0.6; cursor:not-allowed; }
    .code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12px; word-break:break-all; }
    .copy { font-size:12px; border:1px solid #333; background:#151515; color:#fff; padding:6px 10px; border-radius:8px; cursor:pointer; }
    .preview { margin-top:14px; }
    .preview img, .preview video, .preview audio { width:100%; max-width:820px; border-radius:12px; border:1px solid #222; background:#0b0b0b; }
    a { color:#93c5fd; }
    .footer { margin-top:20px; font-size:12px; color:#a1a1aa; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div id="app">Loading…</div>
      <div class="footer">
        <a href="https://beatifyaudio.github.io/contentbox/index.html#mission" target="_blank" rel="noreferrer">Mission</a>
      </div>
    </div>
  </div>
<script>
(function(){
  const contentId = ${JSON.stringify(contentId)};
  const app = document.getElementById("app");
  const apiBase = location.origin;
  let receiptToken = null;
  let pollTimer = null;
  let refreshTimer = null;
  let currentOffer = null;
  let previewSeconds = 20;
  const ENTITLE_TTL_MS = 24 * 60 * 60 * 1000;

  function qs(v){ return encodeURIComponent(v); }
  function qrUrl(data){ return "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encodeURIComponent(data); }
  function copy(text){ if (!navigator.clipboard) return; navigator.clipboard.writeText(text).catch(()=>{}); }

  function entKey(manifestHash){ return "cb:entitlement:" + manifestHash; }
  function getEntitlement(manifestHash){
    try {
      const raw = localStorage.getItem(entKey(manifestHash));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.canStream) return null;
      if (parsed.expiresAt && Date.now() > Number(parsed.expiresAt)) return null;
      return parsed;
    } catch { return null; }
  }
  function setEntitlement(manifestHash, token, status, expiresAt){
    const now = Date.now();
    const payload = {
      canStream: true,
      canDownload: false,
      token,
      status: status || "paid",
      issuedAt: now,
      expiresAt: expiresAt || now + ENTITLE_TTL_MS
    };
    try { localStorage.setItem(entKey(manifestHash), JSON.stringify(payload)); } catch {}
    return payload;
  }
  function clearEntitlement(manifestHash){
    try { localStorage.removeItem(entKey(manifestHash)); } catch {}
  }

  async function fetchJson(path, opts){
    const res = await fetch(apiBase + path, { method: opts?.method || "GET", headers: { "Content-Type":"application/json" }, body: opts?.body ? JSON.stringify(opts.body) : undefined });
    const data = await res.json().catch(()=>null);
    if (!res.ok) throw new Error((data && (data.error || data.message)) || "Request failed");
    return data;
  }

  function streamUrl(offer, token){
    if (!offer?.primaryFileId) return null;
    let url = apiBase + "/content/" + offer.manifestSha256 + "/" + encodeURIComponent(offer.primaryFileId);
    if (token) url += "?t=" + encodeURIComponent(token);
    return url;
  }

  function previewFallbackUrl(offer){
    if (!offer?.previewObjectKey) return null;
    return apiBase + "/buy/content/" + contentId + "/preview-file?objectKey=" + qs(offer.previewObjectKey);
  }

  function renderOffer(offer, entitlement){
    const price = offer.priceSats == null ? "Price unavailable" : offer.priceSats + " sats";
    const isPaid = Number(offer.priceSats || 0) > 0;
    const token = entitlement?.token || receiptToken || null;
    const mediaSrc = token ? streamUrl(offer, token) : previewFallbackUrl(offer) || streamUrl(offer, token);
    const mime = String(offer.primaryFileMime || "");
    const isVideo = offer.type === "video" || mime.startsWith("video/");
    const isAudio = !isVideo && (offer.type === "song" || mime.startsWith("audio/"));
    const canStream = !isPaid || Boolean(token) || entitlement?.status === "preview" || Boolean(previewFallbackUrl(offer));
    const hidePay = !isPaid || entitlement?.status === "paid" || entitlement?.status === "bypassed";
    app.innerHTML = \`
      <div>
        <div style="font-size:22px;font-weight:700;">\${offer.title || "Content"}</div>
        <div class="muted">\${offer.description || ""}</div>
        \${mediaSrc && canStream ? \`
          <div class="preview">
            \${entitlement?.status === "preview" ? \`<div style="margin-bottom:6px;font-size:12px;color:#fbbf24;">Preview</div>\` : ""}
            \${isVideo ? \`<video id="player" controls preload="metadata" src="\${mediaSrc}"></video>\` : ""}
            \${isAudio ? \`<audio id="player" controls preload="metadata" src="\${mediaSrc}"></audio>\` : ""}
            \${!isVideo && !isAudio ? \`<a class="muted" href="\${mediaSrc}" target="_blank" rel="noreferrer">Open preview</a>\` : ""}
          </div>
        \` : \`\${isPaid ? "<div class='muted' style='margin-top:10px;'>Unlock to play.</div>" : ""}\`}
        <div style="margin-top:8px;font-size:18px;">\${price}</div>
        <button id="buyBtn" class="btn" style="margin-top:12px; \${hidePay ? "display:none;" : ""}">Pay</button>
        <div id="status" class="muted" style="margin-top:8px;"></div>
        \${isPaid ? \`<div id="entStatus" class="muted" style="margin-top:6px;">Permit: \${entitlement?.status || "unpaid"}</div>\` : ""}
        \${entitlement?.token ? \`<button id="resetEnt" class="copy" style="margin-top:8px;">Reset entitlement</button>\` : ""}
        <div id="rails" style="margin-top:16px;"></div>
        <div id="downloads" style="margin-top:16px;"></div>
      </div>
    \`;
    const btn = document.getElementById("buyBtn");
    if (btn) btn.onclick = async () => startPurchase(offer);
    if (entitlement?.status === "preview" && isPaid) {
      document.getElementById("status").textContent = "Preview playing…";
      const player = document.getElementById("player");
      const limitSec = Math.max(1, Number(previewSeconds || 25));
      if (player) {
        let previewEnded = false;
        const stop = () => {
          if (previewEnded) return;
          previewEnded = true;
          if (typeof player.pause === "function") player.pause();
          try { player.currentTime = 0; } catch {}
          try { player.controls = false; } catch {}
          document.getElementById("status").textContent = "Preview ended. Pay to unlock.";
        };
        const onTime = () => {
          if (player.currentTime >= limitSec) stop();
        };
        player.addEventListener("timeupdate", onTime);
        player.addEventListener("ended", stop, { once: true });
        player.addEventListener("play", () => {
          if (previewEnded) {
            player.pause();
            return;
          }
          window.setTimeout(() => {
            if (player && !player.paused && player.currentTime >= limitSec - 0.2) stop();
          }, limitSec * 1000);
        });
      }
    }
    const resetBtn = document.getElementById("resetEnt");
    if (resetBtn) {
      resetBtn.onclick = () => {
        clearEntitlement(offer.manifestSha256);
        receiptToken = null;
        renderOffer(offer, null);
      };
    }
  }

  function renderRails(intent){
    const rails = document.getElementById("rails");
    const lightning = intent.paymentOptions?.lightning || {};
    const onchain = intent.paymentOptions?.onchain || {};
    const receiptLink = apiBase + "/buy/receipts/" + intent.receiptToken + "/status";
    rails.innerHTML = \`
      <div class="row">
        <div class="rail">
          <div style="font-weight:600;">Pay with Lightning (recommended)</div>
          \${lightning.available ? \`
            <img alt="Lightning QR" src="\${qrUrl(lightning.bolt11)}" />
            <div class="code">\${lightning.bolt11}</div>
            <button class="copy" data-copy="\${lightning.bolt11}">Copy invoice</button>
          \` : \`<div class="muted">Unavailable: \${lightning.reason || "Not available"}</div>\`}
        </div>
        <div class="rail">
          <div style="font-weight:600;">Pay with Bitcoin</div>
          \${onchain.available ? \`
            <img alt="On-chain QR" src="\${qrUrl(onchain.address)}" />
            <div class="code">\${onchain.address}</div>
            <div class="muted">Min confirmations: \${onchain.minConfirmations || 1}</div>
            <button class="copy" data-copy="\${onchain.address}">Copy address</button>
          \` : \`<div class="muted">Unavailable: \${onchain.reason || "Not available"}</div>\`}
        </div>
      </div>
      <div class="muted" style="margin-top:10px;">Save your receipt link to download again:</div>
      <div class="muted"><span class="code">\${receiptLink}</span> <button class="copy" data-copy="\${receiptLink}">Copy receipt link</button></div>
    \`;
    rails.querySelectorAll(".copy").forEach((btn)=>btn.addEventListener("click", (e)=>copy(e.currentTarget.getAttribute("data-copy")||"")));
  }

  function renderDownloads(payload){
    const downloads = document.getElementById("downloads");
    const list = payload.files || [];
    if (!list.length) {
      downloads.innerHTML = "<div class='muted'>No files available.</div>";
      return;
    }
    downloads.innerHTML = \`
      <div style="font-weight:600;margin-bottom:6px;">Download</div>
      <ul>\${list.map(f=>\`<li><a href="\${apiBase}/buy/receipts/\${receiptToken}/file?objectKey=\${qs(f.objectKey)}">\${f.originalName || f.objectKey}</a> <span class="muted">(\${f.sizeBytes} bytes)</span></li>\`).join("")}</ul>
    \`;
  }

  async function pollStatus(){
    if (!receiptToken) return;
    const status = await fetchJson("/buy/receipts/" + receiptToken + "/status");
    if (status.canFulfill) {
      clearInterval(pollTimer);
      const payload = await fetchJson("/buy/receipts/" + receiptToken + "/fulfill");
      renderDownloads(payload);
      if (currentOffer?.manifestSha256) {
        const ent = setEntitlement(currentOffer.manifestSha256, receiptToken, "paid");
        renderOffer(currentOffer, ent);
      }
      document.getElementById("status").textContent = "Payment received. Download is ready.";
    } else {
      document.getElementById("status").textContent = "Waiting for payment…";
    }
  }

  async function startPurchase(offer){
    document.getElementById("status").textContent = "Creating payment…";
    const amount = offer.priceSats != null ? offer.priceSats : 1000;
    const intent = await fetchJson("/buy/payments/intents", { method:"POST", body:{ contentId, manifestSha256: offer.manifestSha256, amountSats: amount } });
    receiptToken = intent.receiptToken;
    renderRails(intent);
    pollTimer = setInterval(pollStatus, 2000);
    pollStatus().catch(()=>{});
  }

  fetchJson("/buy/content/" + contentId + "/offer")
    .then(async (offer)=> {
      currentOffer = offer;
      const ent = offer?.manifestSha256 ? getEntitlement(offer.manifestSha256) : null;
      if (ent && ent.token) {
        renderOffer(offer, ent);
        return;
      }
      if (Number(offer.priceSats || 0) > 0) {
        try {
          const p = await fetchJson("/buy/permits", {
            method: "POST",
            body: { manifestHash: offer.manifestSha256, fileId: offer.primaryFileId, buyerId: "guest", requestedScope: "preview" }
          });
          previewSeconds = p.previewSeconds || previewSeconds;
          const next = setEntitlement(offer.manifestSha256, p.permit, "preview", Date.parse(p.expiresAt));
          renderOffer(offer, next);
          return;
        } catch {}
      }
      renderOffer(offer, null);
    })
    .catch(err => { app.textContent = err && err.message ? err.message : "Unable to load offer."; console.error(err); });
})();
</script>
</body>
</html>`;

  reply.type("text/html; charset=utf-8");
  return reply.send(html);
}

app.get("/buy/:contentId", handleBuyPage);

app.get("/embed.js", async (req: any, reply) => {
  const js = `(function(){
  const script = document.currentScript;
  const base = script ? new URL(script.src).origin : "";
  function makeOverlay(url){
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.7)";
    overlay.style.zIndex = "9999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.style.width = "90vw";
    frame.style.maxWidth = "900px";
    frame.style.height = "80vh";
    frame.style.border = "1px solid #222";
    frame.style.borderRadius = "16px";
    frame.style.background = "#0b0b0b";
    const close = document.createElement("button");
    close.textContent = "Close";
    close.style.position = "absolute";
    close.style.top = "20px";
    close.style.right = "20px";
    close.style.padding = "8px 12px";
    close.style.borderRadius = "10px";
    close.style.border = "1px solid #333";
    close.style.background = "#111";
    close.style.color = "#fff";
    close.style.cursor = "pointer";
    close.onclick = () => overlay.remove();
    overlay.appendChild(frame);
    overlay.appendChild(close);
    document.body.appendChild(overlay);
  }
  document.querySelectorAll("[data-contentbox-buy]").forEach((el)=>{
    const contentId = el.getAttribute("data-contentbox-buy");
    if (!contentId) return;
    const label = el.getAttribute("data-label") || "Buy";
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.padding = "10px 14px";
    btn.style.borderRadius = "10px";
    btn.style.border = "1px solid #333";
    btn.style.background = "#111";
    btn.style.color = "#fff";
    btn.style.cursor = "pointer";
    btn.onclick = () => makeOverlay(base + "/buy/" + encodeURIComponent(contentId));
    el.innerHTML = "";
    el.appendChild(btn);
  });
})();`;
  reply.type("application/javascript; charset=utf-8");
  return reply.send(js);
});

/**
 * P2P OFFER + RECEIPT TOKEN FLOWS (no marketplace required)
 */
app.get("/p2p/identity", { preHandler: requireAuth }, async (req: any, reply) => {
  const host = (req.headers["x-forwarded-host"] || req.headers["host"]) as string | undefined;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) || (req.protocol as string | undefined) || "http";
  const baseUrl = host ? `${proto}://${host}` : null;
  const peerSeed = `${JWT_SECRET}:${host || "local"}`;
  const peerId = crypto.createHash("sha256").update(peerSeed).digest("hex").slice(0, 32);
  return reply.send({ peerId, baseUrl });
});

async function handlePublicOffer(req: any, reply: any) {
  const contentId = asString((req.params as any).contentId || "").trim();
  const manifestShaQuery = asString((req.query || {})?.manifestSha256 || "").trim();
  if (!contentId) return badRequest(reply, "contentId required");

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.deletedAt) return notFound(reply, "Not found");
  if (content.status !== "published") return notFound(reply, "Not found");

  const manifest = await prisma.manifest.findUnique({ where: { contentId } });
  if (!manifest) return notFound(reply, "Manifest not found");
  if (manifestShaQuery && manifest.sha256 !== manifestShaQuery) return badRequest(reply, "manifestSha256 does not match content manifest");

  const manifestJson = (manifest.json || {}) as any;
  const primaryFileId =
    (typeof manifestJson?.primaryFile === "string" && manifestJson.primaryFile) ||
    (Array.isArray(manifestJson?.files) && (manifestJson.files[0]?.path || manifestJson.files[0]?.objectKey)) ||
    null;
  let primaryFileMime: string | null = null;
  if (primaryFileId) {
    const f = await prisma.contentFile.findFirst({ where: { contentId, objectKey: primaryFileId } });
    primaryFileMime = f?.mime || null;
  }
  const previewObjectKey = typeof manifestJson?.preview === "string" ? manifestJson.preview : null;

  const host = (req.headers["x-forwarded-host"] || req.headers["host"]) as string | undefined;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) || (req.protocol as string | undefined) || "http";
  const baseUrl = host ? `${proto}://${host}` : null;
  const ttlSeconds = Math.max(60, Math.floor(Number(process.env.RECEIPT_TOKEN_TTL_SECONDS || "3600")));

  const priceSats = content.priceSats ?? null;
  if (!priceSats || priceSats < 1) {
    return reply.code(409).send({ code: "PRICE_NOT_SET", message: "Creator has not set a price yet." });
  }

  return reply.send({
    contentId: content.id,
    title: content.title,
    description: content.description || null,
    type: content.type,
    manifestSha256: manifest.sha256,
    priceSats: priceSats.toString(),
    primaryFileId,
    primaryFileMime,
    previewObjectKey,
    seller: { hostOrigin: baseUrl },
    sellerEndpoints: baseUrl ? [{ baseUrl, p2p: `${baseUrl}/p2p`, public: `${baseUrl}/public` }] : [],
    fulfillment: { mode: "receiptToken", ttlSeconds }
  });
}

app.get("/p2p/content/:contentId/offer", { preHandler: optionalAuth }, handlePublicOffer);
app.get("/public/content/:contentId/offer", handlePublicOffer);
app.get("/buy/content/:contentId/offer", handlePublicOffer);

async function handlePublicPaymentsIntents(req: any, reply: any) {
  const body = (req.body ?? {}) as {
    contentId?: string;
    manifestSha256?: string;
    amountSats?: any;
  };

  const contentId = asString(body.contentId || "").trim();
  const amountSatsInput = parseSats(body.amountSats);
  if (!contentId) return badRequest(reply, "contentId required");

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (!content.priceSats || content.priceSats < 1n) {
    return reply.code(409).send({ code: "PRICE_NOT_SET", message: "Creator has not set a price yet." });
  }
  const amountSats = content.priceSats;
  if (amountSatsInput > 0n && amountSatsInput !== content.priceSats) {
    return reply.code(409).send({ code: "AMOUNT_MISMATCH", message: "Amount must match creator price." });
  }

  const manifest = await prisma.manifest.findUnique({ where: { contentId } });
  if (!manifest) return notFound(reply, "Manifest not found");
  const manifestSha256 = asString(body.manifestSha256 || manifest.sha256).trim();
  if (manifest.sha256 !== manifestSha256) return badRequest(reply, "manifestSha256 does not match content manifest");

  const ttlSeconds = Math.max(60, Math.floor(Number(process.env.RECEIPT_TOKEN_TTL_SECONDS || "3600")));
  const receiptToken = crypto.randomBytes(24).toString("hex");
  const receiptTokenExpiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const intent = await prisma.paymentIntent.create({
    data: {
      buyerUserId: null,
      contentId,
      manifestSha256,
      amountSats,
      status: "pending" as any,
      purpose: "CONTENT_PURCHASE" as any,
      subjectType: "CONTENT" as any,
      subjectId: contentId,
      receiptToken,
      receiptTokenExpiresAt
    }
  });

  let onchain: { address: string; derivationIndex?: number | null } | null = null;
  let lightning: null | { bolt11: string; providerId: string; expiresAt: string | null } = null;
  let onchainReason: string | null = null;
  let lightningReason: string | null = null;

  try {
    onchain = await createOnchainAddress(intent.id);
  } catch {
    onchain = null;
    onchainReason = "TEMPORARILY_UNAVAILABLE";
  }
  if (!onchain) {
    const payoutMethod = await prisma.payoutMethod.findUnique({ where: { code: "btc_onchain" as any } });
    if (payoutMethod) {
      const identity = await prisma.identity.findFirst({
        where: { payoutMethodId: payoutMethod.id, userId: content.ownerUserId },
        orderBy: { createdAt: "desc" }
      });
      if (identity?.value) {
        const maxIdx = await prisma.paymentIntent.findFirst({
          where: { contentId, onchainDerivationIndex: { not: null } },
          orderBy: { onchainDerivationIndex: "desc" },
          select: { onchainDerivationIndex: true }
        });
        const nextIdx = (maxIdx?.onchainDerivationIndex ?? -1) + 1;
        try {
          const addr = await deriveFromXpub.addressAt(String(identity.value), nextIdx);
          onchain = { address: addr, derivationIndex: nextIdx };
        } catch {
          onchain = null;
          onchainReason = "ADDRESS_DERIVATION_FAILED";
        }
      }
    }
    if (!onchain && !onchainReason) onchainReason = "XPUB_NOT_CONFIGURED";
  }

  try {
    const invoice = await createLightningInvoice(amountSats, `Contentbox ${contentId.slice(0, 8)} ${manifestSha256.slice(0, 8)}`);
    if (invoice) lightning = invoice;
  } catch (e: any) {
    app.log.warn({ err: e }, "lnbits invoice failed");
    lightningReason = "INVOICE_GENERATION_FAILED";
  }
  if (!lightning?.bolt11 && !lightningReason) {
    lightningReason = "PROVIDER_NOT_CONFIGURED";
  }

  if (!onchain && !lightning) {
    await prisma.paymentIntent.delete({ where: { id: intent.id } }).catch(() => {});
    return reply.code(503).send({
      code: "NO_PAYMENT_RAILS_AVAILABLE",
      message: "No payment rails are available right now.",
      details: { lightningReason, onchainReason }
    });
  }

  await prisma.paymentIntent.update({
    where: { id: intent.id },
    data: {
      onchainAddress: onchain?.address || null,
      onchainDerivationIndex: onchain?.derivationIndex ?? null,
      bolt11: lightning?.bolt11 || null,
      providerId: lightning?.providerId || null,
      lightningExpiresAt: lightning?.expiresAt ? new Date(lightning.expiresAt) : null
    }
  });

  return reply.send({
    ok: true,
    paymentIntentId: intent.id,
    status: intent.status,
    amountSats: intent.amountSats.toString(),
    bolt11: lightning?.bolt11 || null,
    lightningExpiresAt: lightning?.expiresAt || null,
    onchainAddress: onchain?.address || null,
    onchainReason,
    lightningReason,
    onchain: onchain ? { address: onchain.address } : null,
    lightning: lightning ? { bolt11: lightning.bolt11, expiresAt: lightning.expiresAt } : null,
    paymentOptions: {
      lightning: {
        available: Boolean(lightning?.bolt11),
        bolt11: lightning?.bolt11 || null,
        expiresAt: lightning?.expiresAt || null,
        reason: lightning?.bolt11 ? null : lightningReason
      },
      onchain: {
        available: Boolean(onchain?.address),
        address: onchain?.address || null,
        minConfirmations: ONCHAIN_MIN_CONFS,
        reason: onchain?.address ? null : onchainReason
      }
    },
    receiptToken,
    receiptTokenExpiresAt: receiptTokenExpiresAt.toISOString()
  });
}

app.post("/p2p/payments/intents", handlePublicPaymentsIntents);
app.post("/public/payments/intents", handlePublicPaymentsIntents);
app.post("/buy/payments/intents", handlePublicPaymentsIntents);

async function handlePublicPermits(req: any, reply: any) {
  if (!PERMIT_SECRET) return reply.code(500).send({ error: "permit secret missing" });
  const body = (req.body ?? {}) as {
    manifestHash?: string;
    fileId?: string;
    buyerId?: string;
    requestedScope?: "preview" | "stream";
  };

  const manifestHash = asString(body.manifestHash || "").trim().toLowerCase();
  const fileId = asString(body.fileId || "").trim();
  const buyerId = asString(body.buyerId || "").trim() || "guest";
  const requestedScope = body.requestedScope === "stream" ? "stream" : "preview";

  if (!manifestHash || !fileId) return badRequest(reply, "manifestHash and fileId required");

  const manifest = await prisma.manifest.findUnique({ where: { sha256: manifestHash } });
  if (!manifest) return notFound(reply, "Manifest not found");
  const content = await prisma.contentItem.findUnique({ where: { id: manifest.contentId } });
  if (!content) return notFound(reply, "Content not found");

  const devUnlock = String(process.env.DEV_P2P_UNLOCK || "").trim() === "1" || PAYMENT_PROVIDER.kind === "none";
  const accessMode = devUnlock ? "stream" : requestedScope;
  const scopes = accessMode === "stream" ? ["stream"] : ["preview"];
  const now = Date.now();
  const ttlMs = accessMode === "stream" ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000;
  const claims: PermitClaims = {
    manifestHash,
    fileId: fileId || "*",
    buyerId,
    scopes,
    iat: now,
    exp: now + ttlMs,
    nonce: crypto.randomBytes(8).toString("hex")
  };

  const permit = signPermit(claims);
  const previewSeconds = 25;

  return reply.send({
    permit,
    scopes,
    expiresAt: new Date(claims.exp).toISOString(),
    accessMode,
    previewSeconds
  });
}

app.post("/p2p/permits", handlePublicPermits);
app.post("/public/permits", handlePublicPermits);
app.post("/buy/permits", handlePublicPermits);

async function handlePublicReceiptStatus(req: any, reply: any) {
  const receiptToken = asString((req.params as any).receiptToken || "").trim();
  if (!receiptToken) return badRequest(reply, "receiptToken required");

  const intent = await prisma.paymentIntent.findFirst({ where: { receiptToken } });
  if (!intent) return notFound(reply, "Receipt not found");
  if (intent.receiptTokenExpiresAt && intent.receiptTokenExpiresAt.getTime() < Date.now()) {
    return reply.code(410).send({ error: "Receipt token expired" });
  }

  return reply.send({
    paymentStatus: intent.status,
    paymentIntentId: intent.id,
    contentId: intent.contentId,
    manifestSha256: intent.manifestSha256,
    canFulfill: intent.status === "paid"
  });
}

app.get("/public/receipts/:receiptToken/status", handlePublicReceiptStatus);
app.get("/buy/receipts/:receiptToken/status", handlePublicReceiptStatus);

async function handlePublicReceiptFulfill(req: any, reply: any) {
  const receiptToken = asString((req.params as any).receiptToken || "").trim();
  if (!receiptToken) return badRequest(reply, "receiptToken required");

  const intent = await prisma.paymentIntent.findFirst({ where: { receiptToken } });
  if (!intent) return notFound(reply, "Receipt not found");
  if (intent.receiptTokenExpiresAt && intent.receiptTokenExpiresAt.getTime() < Date.now()) {
    return reply.code(410).send({ error: "Receipt token expired" });
  }
  if (intent.status !== "paid") return reply.code(402).send({ error: "Payment not settled" });
  if (!intent.manifestSha256) return badRequest(reply, "manifestSha256 required");

  const content = await prisma.contentItem.findUnique({ where: { id: intent.contentId } });
  if (!content) return notFound(reply, "Content not found");
  const manifest = await prisma.manifest.findUnique({ where: { contentId: intent.contentId } });
  if (!manifest || manifest.sha256 !== intent.manifestSha256) return badRequest(reply, "manifestSha256 does not match content manifest");

  try {
    await finalizePurchase(intent.id, prisma);
  } catch {}

  if (intent.buyerUserId) {
    await prisma.entitlement.upsert({
      where: { buyerUserId_contentId_manifestSha256: { buyerUserId: intent.buyerUserId, contentId: intent.contentId, manifestSha256: intent.manifestSha256 } },
      update: { paymentIntentId: intent.id },
      create: { buyerUserId: intent.buyerUserId, contentId: intent.contentId, manifestSha256: intent.manifestSha256, paymentIntentId: intent.id }
    }).catch(() => {});
  } else {
    const existingEntitlement = await prisma.entitlement.findFirst({
      where: { buyerUserId: null, contentId: intent.contentId, manifestSha256: intent.manifestSha256 }
    });
    if (!existingEntitlement) {
      await prisma.entitlement.create({
        data: { buyerUserId: null, contentId: intent.contentId, manifestSha256: intent.manifestSha256, paymentIntentId: intent.id }
      }).catch(() => {});
    }
  }

  const files = await prisma.contentFile.findMany({
    where: { contentId: intent.contentId },
    orderBy: { createdAt: "asc" }
  });
  const manifestJson = manifest.json as any;
  return reply.send({
    ok: true,
    contentId: intent.contentId,
    manifestSha256: manifest.sha256,
    manifest: manifestJson,
    manifestJson,
    files: files.map((f) => ({
      objectKey: f.objectKey,
      originalName: f.originalName,
      mime: f.mime,
      sizeBytes: f.sizeBytes.toString(),
      sha256: f.sha256,
      cipherSha256: f.cipherSha256,
      encAlg: f.encAlg,
      encDek: f.encDek,
      dekNonce: f.dekNonce,
      fileNonce: f.fileNonce
    }))
  });
}

app.get("/public/receipts/:receiptToken/fulfill", handlePublicReceiptFulfill);
app.get("/buy/receipts/:receiptToken/fulfill", handlePublicReceiptFulfill);

async function handlePublicReceiptFile(req: any, reply: any) {
  const receiptToken = asString((req.params as any).receiptToken || "").trim();
  const objectKey = asString((req.query || {})?.objectKey || "").trim();
  if (!receiptToken) return badRequest(reply, "receiptToken required");
  if (!objectKey) return badRequest(reply, "objectKey required");

  const intent = await prisma.paymentIntent.findFirst({ where: { receiptToken } });
  if (!intent) return notFound(reply, "Receipt not found");
  if (intent.receiptTokenExpiresAt && intent.receiptTokenExpiresAt.getTime() < Date.now()) {
    return reply.code(410).send({ error: "Receipt token expired" });
  }
  if (intent.status !== "paid") return reply.code(402).send({ error: "Payment not settled" });
  if (!intent.manifestSha256) return badRequest(reply, "manifestSha256 required");

  const content = await prisma.contentItem.findUnique({ where: { id: intent.contentId } });
  if (!content || !content.repoPath) return notFound(reply, "Content not found");

  const manifest = await prisma.manifest.findUnique({ where: { contentId: intent.contentId } });
  if (!manifest || manifest.sha256 !== intent.manifestSha256) return badRequest(reply, "manifestSha256 does not match content manifest");
  const manifestJson = manifest.json as any;
  const manifestFiles = Array.isArray(manifestJson?.files) ? manifestJson.files : [];
  const inManifest = manifestFiles.some((f: any) => f?.path === objectKey || f?.filename === objectKey);

  const file = await prisma.contentFile.findFirst({
    where: { contentId: intent.contentId, objectKey }
  });
  if (!file) return notFound(reply, "File not found");
  if (manifestFiles.length > 0 && !inManifest) return forbidden(reply);

  const repoRoot = path.resolve(content.repoPath);
  const absPath = path.resolve(repoRoot, objectKey);
  if (!absPath.startsWith(repoRoot)) return forbidden(reply);
  if (!fsSync.existsSync(absPath)) return notFound(reply, "File not found");

  const safeName = path.basename(file.originalName || "download").replace(/"/g, "");
  reply.header("Content-Disposition", `attachment; filename="${safeName}"`);
  reply.type(file.mime || "application/octet-stream");
  return reply.send(fsSync.createReadStream(absPath));
}

app.get("/public/receipts/:receiptToken/file", handlePublicReceiptFile);
app.get("/buy/receipts/:receiptToken/file", handlePublicReceiptFile);

// List files for a content item
app.get("/content/:id/files", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);

  const files = await prisma.contentFile.findMany({ where: { contentId }, orderBy: { createdAt: "desc" } });

  const manifest = content.repoPath ? await readManifest(content.repoPath) : null;

  const out = files.map((f) => {
    const manifestSha = manifest ? findManifestSha(manifest, f.objectKey) : null;
    const sha256MatchesManifest = manifestSha ? manifestSha.toLowerCase() === (f.sha256 || "").toLowerCase() : null;
    return {
      id: f.id,
      originalName: f.originalName,
      objectKey: f.objectKey,
      mime: f.mime,
      sizeBytes: Number(f.sizeBytes),
      sha256: f.sha256,
      createdAt: f.createdAt,
      manifestSha256: manifestSha,
      sha256MatchesManifest,
      encAlg: f.encAlg || null
    };
  });

  return reply.send(out);
});

// Upload a file into a content repo and record it in DB
app.post("/content/:id/files", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);
  if (!content.repoPath) return reply.code(500).send({ error: "Content repo not initialized" });

  // fastify multipart
  const mp = await req.file();
  if (!mp) return badRequest(reply, "file is required");

  const fileStream = mp.file as NodeJS.ReadableStream;
  const originalName = mp.filename || "upload";
  const mime = mp.mimetype || "application/octet-stream";

  try {
    const fileEntry = await addFileToContentRepo({
      repoPath: content.repoPath,
      contentTitle: content.title,
      originalName,
      mime,
      stream: fileStream,
      setAsPrimary: true,
      preferMasterName: false
    });

    // upsert into DB
    const created = await prisma.contentFile.upsert({
      where: { contentId_objectKey: { contentId, objectKey: fileEntry.path } },
      update: {
        originalName,
        mime,
        sizeBytes: BigInt(fileEntry.sizeBytes || 0),
        sha256: fileEntry.sha256 || "",
        createdAt: new Date(fileEntry.committedAt)
      },
      create: {
        contentId,
        objectKey: fileEntry.path,
        originalName,
        mime,
        sizeBytes: BigInt(fileEntry.sizeBytes || 0),
        sha256: fileEntry.sha256 || "",
        encDek: "",
        encAlg: ""
      }
    });

    // return enriched info
    const manifest = await readManifest(content.repoPath);
    const manifestSha = manifest ? findManifestSha(manifest, fileEntry.path) : null;
    const manifestHash = manifest ? computeManifestHash(manifest) : null;

    try {
      await prisma.auditEvent.create({
        data: {
          userId,
          action: "content.upload",
          entityType: "ContentItem",
          entityId: contentId,
          payloadJson: {
            originalName: created.originalName,
            objectKey: created.objectKey,
            sha256: created.sha256,
            sizeBytes: created.sizeBytes ? created.sizeBytes.toString() : null,
            manifestHash
          } as any
        }
      });
    } catch {}

    return reply.send({
      id: created.id,
      objectKey: created.objectKey,
      originalName: created.originalName,
      mime: created.mime,
      sizeBytes: Number(created.sizeBytes),
      sha256: created.sha256,
      createdAt: created.createdAt,
      manifestSha256: manifestSha,
      sha256MatchesManifest: manifestSha ? manifestSha.toLowerCase() === (created.sha256 || "").toLowerCase() : null
    });
  } catch (e: any) {
    return reply.code(500).send({ error: String((e as any)?.message || String(e)) });
  }
});

// Soft delete (move to trash)
app.post("/content/:id/delete", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);

  await prisma.contentItem.update({ where: { id: contentId }, data: { deletedAt: new Date(), deletedReason: "soft" } });
  return reply.send({ ok: true });
});

// Restore from trash
app.post("/content/:id/restore", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);

  await prisma.contentItem.update({ where: { id: contentId }, data: { deletedAt: null, deletedReason: null } });
  return reply.send({ ok: true });
});

// Permanently delete content and remove repo folder
app.delete("/content/:id", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);

  const repoPath = content.repoPath;
  await prisma.contentItem.delete({ where: { id: contentId } });

  if (repoPath) {
    try {
      // remove folder
      await fs.rm(repoPath, { recursive: true, force: true });
    } catch {
      // ignore remove errors
    }
  }

  return reply.send({ ok: true });
});

// Return the latest split version for a content item (used by ContentLibraryPage)
app.get("/content/:id/splits", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);

  const latest = await prisma.splitVersion.findFirst({ where: { contentId }, orderBy: { versionNumber: "desc" }, include: { participants: true } });
  if (!latest) return reply.send(null);

  return reply.send({
    id: latest.id,
    contentId: latest.contentId,
    versionNumber: latest.versionNumber,
    status: latest.status,
    lockedAt: latest.lockedAt ?? null,
    lockedFileObjectKey: latest.lockedFileObjectKey ?? null,
    lockedFileSha256: latest.lockedFileSha256 ?? null
  });
});

// Get a single content item
app.get("/content/:id", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const c = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!c) return notFound(reply, "Content not found");
  let canEdit = c.ownerUserId === userId;
  if (!canEdit) {
    const ok = await isAcceptedParticipant(userId, contentId);
    if (!ok) return forbidden(reply);
  }

  const credits = await prisma.contentCredit.findMany({
    where: { contentId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });

  const parentLink = await prisma.contentLink.findFirst({
    where: { childContentId: contentId },
    select: {
      id: true,
      parentContentId: true,
      childContentId: true,
      relation: true,
      requiresApproval: true,
      upstreamBps: true,
      approvedAt: true
    }
  });

  return reply.send({
    id: c.id,
    title: c.title,
    type: c.type,
    status: c.status,
    priceSats: c.priceSats != null ? c.priceSats.toString() : null,
    storefrontStatus: c.storefrontStatus,
    createdAt: c.createdAt,
    canEdit,
    credits,
    parentLink: parentLink
      ? {
          linkId: parentLink.id,
          parentContentId: parentLink.parentContentId,
          childContentId: parentLink.childContentId,
          relation: parentLink.relation,
          requiresApproval: parentLink.requiresApproval,
          upstreamBps: parentLink.upstreamBps,
          approvedAt: parentLink.approvedAt ? parentLink.approvedAt.toISOString() : null
        }
      : null
  });
});

// Credits (read: any authed user; write: owner only)
app.get("/content/:id/credits", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const contentId = asString((req.params as any).id);
  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");

  const creditModel = (prisma as any).contentCredit;
  const credits = creditModel
    ? await creditModel.findMany({
        where: { contentId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      })
    : [];
  return reply.send(credits);
});

// Preview derivative content for parent owners (read-only)
async function canAccessReviewPreview(userId: string, contentId: string): Promise<{ ok: boolean; content?: any; linkId?: string | null; reason?: string }> {
  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return { ok: false, reason: "content_not_found" };

  if (content.ownerUserId === userId) return { ok: true, content, linkId: null, reason: "owner" };
  // accepted participant on this content can preview
  if (await isAcceptedParticipant(userId, contentId)) return { ok: true, content, linkId: null, reason: "participant" };

  const links = await prisma.contentLink.findMany({
    where: { childContentId: contentId },
    include: { parentContent: { select: { ownerUserId: true } } }
  });
  if (links.length === 0) return { ok: false, reason: "no_parent_link" };

  const parentLink = links[0];
  if (parentLink?.parentContentId) {
    const parentSplit = await getLockedSplitForContent(parentLink.parentContentId);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const email = (user?.email || "").toLowerCase();
    const isParentOwner = parentLink.parentContent?.ownerUserId === userId;
    const isParentStakeholder = Boolean(
      parentSplit?.participants?.some(
        (p) =>
          (p.participantUserId && p.participantUserId === userId) ||
          (p.participantEmail && email && p.participantEmail.toLowerCase() === email)
      )
    );

    if (isParentOwner || isParentStakeholder) {
      return { ok: true, content, linkId: parentLink.id, reason: "parent_stakeholder" };
    }
  }

  return { ok: false, reason: "no_rights" };
}

app.get("/content/:id/preview", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);
  // avoid logging raw objects here to prevent BigInt serialization errors
  const apiBase =
    (process.env.API_BASE_URL || (req.headers?.host ? `http://${req.headers.host}` : "http://127.0.0.1:4000")).replace(/\/$/, "");

  const access = await canAccessReviewPreview(userId, contentId);
  if (!access.ok || !access.content) {
    if (process.env.NODE_ENV !== "production") {
      try {
        const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
        app.log.info(
          {
            userId,
            email: me?.email || null,
            contentId,
            reason: access.reason || "unknown"
          },
          "preview.denied"
        );
      } catch {}
    }
    const publicMeta = await prisma.manifest.findUnique({ where: { contentId } });
    const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
    if (content && content.storefrontStatus !== "DISABLED" && publicMeta) {
      const publicLinks = await prisma.contentLink.findMany({ where: { childContentId: contentId } });
      const isDerivativeType = ["derivative", "remix", "mashup"].includes(String(content.type || ""));
      if (publicLinks.length === 0 || !isDerivativeType || (publicLinks[0] && (!publicLinks[0].requiresApproval || publicLinks[0].approvedAt))) {
        const manifestJson = (publicMeta.json || {}) as any;
        const previewUrl = manifestJson?.preview || null;
        const payload = {
          content: { id: content.id, title: content.title, type: content.type, status: content.status },
          manifest: { sha256: publicMeta.sha256, preview: manifestJson?.preview || null, cover: manifestJson?.cover || null },
          previewUrl,
          files: []
        };
        const safe = jsonSafe(payload);
        reply.type("application/json");
        reply.code(200);
        return reply.send(jsonStringifySafe(safe));
      }
    }
    return forbidden(reply);
  }

  const content = access.content;
  const manifest = await prisma.manifest.findUnique({ where: { contentId } });
  const files = await prisma.contentFile.findMany({ where: { contentId }, orderBy: { createdAt: "asc" } });

  const manifestJson = (manifest?.json || {}) as any;
  const primaryObjectKey =
    (typeof manifestJson?.preview === "string" && manifestJson.preview) ||
    (typeof manifestJson?.primaryFile === "string" && manifestJson.primaryFile) ||
    (Array.isArray(manifestJson?.files) && manifestJson.files[0]?.path) ||
    files[0]?.objectKey ||
    null;

  if (!primaryObjectKey) {
    return reply.code(400).send({ error: "Upload a master file to preview." });
  }

  const previewUrl = primaryObjectKey
    ? `${apiBase}/content/${encodeURIComponent(contentId)}/preview-file?objectKey=${encodeURIComponent(primaryObjectKey)}&token=${encodeURIComponent(
        createPreviewToken(app, userId, contentId, primaryObjectKey)
      )}`
    : null;

  const payload = {
    content: { id: content.id, title: content.title, type: content.type, status: content.status },
    manifest: manifest ? { sha256: manifest.sha256, preview: manifestJson?.preview || null, cover: manifestJson?.cover || null } : null,
    previewUrl: previewUrl || null,
    files: files.map((f) => ({
      id: f.id,
      originalName: f.originalName,
      objectKey: f.objectKey,
      sizeBytes: f.sizeBytes != null ? f.sizeBytes.toString() : "0",
      mime: f.mime
    }))
  };
  const safe = jsonSafe(payload);
  reply.type("application/json");
  reply.code(200);
  return reply.send(jsonStringifySafe(safe));
});

app.get("/content/:id/preview-file", { preHandler: optionalAuth }, async (req: any, reply: any) => {
  const contentId = asString((req.params as any).id);
  const objectKey = asString((req.query || {})?.objectKey || "");
  const token = asString((req.query || {})?.token || "");
  if (!objectKey) return badRequest(reply, "objectKey required");

  let userId: string | null = null;
  let accessContent: any = null;
  if (token) {
    try {
      const decoded: any = await app.jwt.verify(token);
      if (decoded?.scope !== "preview") return reply.code(401).send({ error: "Unauthorized" });
      if (String(decoded?.contentId || "") !== contentId) return reply.code(401).send({ error: "Unauthorized" });
      if (String(decoded?.objectKey || "") !== objectKey) return reply.code(401).send({ error: "Unauthorized" });
      userId = String(decoded?.sub || "");
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });
      const access = await canAccessReviewPreview(userId, contentId);
      if (!access.ok || !access.content) return reply.code(401).send({ error: "Unauthorized" });
      accessContent = access.content;
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  } else {
    const authUser = (req.user as JwtUser) || null;
    userId = authUser?.sub || null;
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const access = await canAccessReviewPreview(userId, contentId);
    if (!access.ok || !access.content) return reply.code(401).send({ error: "Unauthorized" });
    accessContent = access.content;
  }

  const content = accessContent as any;
  if (!content.repoPath) return notFound(reply, "Content repo not found");

  const file = await prisma.contentFile.findFirst({ where: { contentId, objectKey } });
  if (!file) return notFound(reply, "File not found");

  const repoRoot = path.resolve(content.repoPath);
  const absPath = path.resolve(repoRoot, objectKey);
  if (!absPath.startsWith(repoRoot)) return forbidden(reply);
  if (!fsSync.existsSync(absPath)) return notFound(reply, "File not found");

  const safeName = path.basename(file.originalName || "preview").replace(/\"/g, "");
  const stat = await fs.stat(absPath);
  const fileSize = stat.size;
  const range = req.headers.range as string | undefined;

  reply.header("Content-Disposition", `inline; filename=\"${safeName}\"`);
  reply.header("Accept-Ranges", "bytes");
  reply.type(file.mime || "application/octet-stream");

  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : Math.max(0, fileSize - 1);
      if (start >= fileSize || end >= fileSize) {
        reply.code(416);
        reply.header("Content-Range", `bytes */${fileSize}`);
        return reply.send();
      }
      reply.code(206);
      reply.header("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      reply.header("Content-Length", String(end - start + 1));
      return reply.send(fsSync.createReadStream(absPath, { start, end }));
    }
  }

  reply.code(200);
  reply.header("Content-Length", String(fileSize));
  return reply.send(fsSync.createReadStream(absPath));
});

app.get("/content/:manifestHash/:fileId", async (req: any, reply: any) => {
  const manifestHash = asString((req.params as any).manifestHash || "").trim().toLowerCase();
  const fileId = asString((req.params as any).fileId || "").trim();
  if (!manifestHash || !fileId) return badRequest(reply, "manifestHash and fileId required");

  const tokenHeader = asString(req.headers.authorization || "");
  const tokenQuery = asString((req.query as any)?.t || (req.query as any)?.token || "");
  const token = tokenHeader.toLowerCase().startsWith("bearer ") ? tokenHeader.slice(7).trim() : tokenQuery.trim();
  if (STREAM_TOKEN_MODE === "require" && !token) {
    reply.code(401);
    return reply.send({ error: "Unauthorized" });
  }

  const manifest = await prisma.manifest.findUnique({ where: { sha256: manifestHash } });
  if (!manifest) return notFound(reply, "Manifest not found");

  const content = await prisma.contentItem.findUnique({ where: { id: manifest.contentId } });
  if (!content || content.deletedAt) return notFound(reply, "Content not found");

  const manifestJson = manifest.json as any;
  const files = Array.isArray(manifestJson?.files) ? manifestJson.files : [];
  let fileEntry: any = null;

  if (fileId === "primary" || fileId === "main") {
    const primary = manifestJson?.primaryFile;
    const primaryKey =
      typeof primary === "string"
        ? primary
        : primary && typeof primary === "object"
          ? primary.path || primary.filename || primary.objectKey
          : null;
    if (primaryKey) {
      fileEntry = files.find((f: any) => f.objectKey === primaryKey || f.path === primaryKey || f.filename === primaryKey) || null;
    }
  }

  if (!fileEntry) {
    fileEntry =
      files.find(
        (f: any) =>
          f.objectKey === fileId ||
          f.path === fileId ||
          f.filename === fileId ||
          f.sha256 === fileId ||
          f.originalName === fileId
      ) || null;
  }

  let objectKey: string | null =
    (fileEntry?.objectKey as string) || (fileEntry?.path as string) || (fileEntry?.filename as string) || null;
  let mime: string | null = (fileEntry?.mime as string) || null;

  if (!fileEntry) {
    const fallback = await prisma.contentFile.findFirst({
      where: { contentId: content.id, OR: [{ objectKey: fileId }, { sha256: fileId }] }
    });
    if (fallback) {
      objectKey = fallback.objectKey;
      mime = fallback.mime;
    }
  }

  if (!objectKey || !content.repoPath) return notFound(reply, "File not found");

  const priceSats = content.priceSats ? BigInt(content.priceSats as any) : 0n;
  let accessMode: "preview" | "stream" = "stream";
  let preview: { maxBytes: number } | null = null;
  const previewEnabled = String(process.env.PREVIEW_ENABLED || "1") !== "0";

  if (priceSats > 0n) {
    let entitlementOk = false;
    if (token) {
      if (token.startsWith("permit_")) {
        const res = verifyPermit(token);
        if (res.ok && res.claims) {
          const scopes = Array.isArray(res.claims.scopes) ? res.claims.scopes : [];
          const fileOk = res.claims.fileId === "*" || res.claims.fileId === fileId;
          const manifestOk = res.claims.manifestHash === manifestHash;
          if (manifestOk && fileOk) {
            if (scopes.includes("stream")) {
              accessMode = "stream";
              entitlementOk = true;
            } else if (scopes.includes("preview")) {
              accessMode = "preview";
              preview = { maxBytes: previewMaxBytesFor(mime, content.type) };
            }
          }
        }
      } else if (isPreviewToken(token)) {
        const meta = previewTokens.get(token);
        if (meta && meta.expiresAt >= Date.now() && meta.manifestHash === manifestHash && meta.fileId === fileId) {
          accessMode = "preview";
          preview = { maxBytes: meta.maxBytes };
        }
      } else {
        const intent = await prisma.paymentIntent.findFirst({ where: { receiptToken: token } });
        if (intent && intent.contentId === content.id && intent.status === "paid") {
          entitlementOk = true;
        }
      }
    }

    if (!entitlementOk) {
      if (previewEnabled) {
        accessMode = "preview";
        if (!preview) preview = { maxBytes: previewMaxBytesFor(mime, content.type) };
      } else {
        reply.code(402);
        return reply.send({ error: "Payment required", code: "PAYMENT_REQUIRED" });
      }
    }
  }

  const repoRoot = path.resolve(content.repoPath);
  const absPath = path.resolve(repoRoot, objectKey);
  if (!absPath.startsWith(repoRoot)) return forbidden(reply);
  if (!fsSync.existsSync(absPath)) return notFound(reply, "File not found");

  const stat = await fs.stat(absPath);
  const fileSize = stat.size;
  const range = req.headers.range as string | undefined;

  reply.header("Accept-Ranges", "bytes");
  reply.type(mime || "application/octet-stream");
  reply.header("X-ContentBox-Access", accessMode);

  const maxBytes = previewMaxBytesFor(mime, content.type);
  const effectiveSize = accessMode === "preview" ? Math.min(fileSize, preview?.maxBytes || maxBytes || fileSize) : fileSize;
  if (accessMode === "preview") reply.header("X-ContentBox-Preview-Max-Bytes", String(effectiveSize));

  if (req.method === "HEAD") {
    reply.code(200);
    reply.header("Content-Length", String(effectiveSize));
    return reply.send();
  }

  const parsed = parseRangeHeader(range, effectiveSize);
  if (parsed.kind === "invalid") {
    reply.code(416);
    reply.header("Content-Range", `bytes */${effectiveSize}`);
    return reply.send();
  }
  if (parsed.kind === "ok") {
    reply.code(206);
    reply.header("Content-Range", `bytes ${parsed.start}-${parsed.end}/${effectiveSize}`);
    reply.header("Content-Length", String(parsed.end - parsed.start + 1));
    return reply.send(fsSync.createReadStream(absPath, { start: parsed.start, end: parsed.end }));
  }

  reply.code(200);
  reply.header("Content-Length", String(effectiveSize));
  if (accessMode === "preview" && effectiveSize < fileSize) {
    return reply.send(fsSync.createReadStream(absPath, { start: 0, end: Math.max(0, effectiveSize - 1) }));
  }
  return reply.send(fsSync.createReadStream(absPath));
});

// DJ grants OG read-only review access to a derivative submission.
app.post("/content-links/:linkId/grant-review", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const linkId = asString((req.params as any).linkId);

  const link = await prisma.contentLink.findUnique({
    where: { id: linkId },
    include: { childContent: true }
  });
  if (!link) return notFound(reply, "Content link not found");
  if (!link.childContent || link.childContent.ownerUserId !== userId) return forbidden(reply);

  const now = new Date();
  const existing = await prisma.clearanceRequest.findFirst({
    where: { contentLinkId: linkId },
    orderBy: { createdAt: "desc" }
  });

  const updated = existing
    ? await prisma.clearanceRequest.update({
        where: { id: existing.id },
        data: { reviewGrantedAt: now, reviewGrantedByUserId: userId }
      })
    : await prisma.clearanceRequest.create({
        data: {
          contentLinkId: linkId,
          requestedByUserId: userId,
          status: "PENDING",
          reviewGrantedAt: now,
          reviewGrantedByUserId: userId
        }
      });

  if (process.env.NODE_ENV !== "production") {
    app.log.info({ linkId, userId }, "derivative.review.granted");
  }

  return reply.send({ ok: true, reviewGrantedAt: updated.reviewGrantedAt?.toISOString() || null });
});

// DJ revokes OG read-only review access.
app.post("/content-links/:linkId/revoke-review", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const linkId = asString((req.params as any).linkId);

  const link = await prisma.contentLink.findUnique({
    where: { id: linkId },
    include: { childContent: true }
  });
  if (!link) return notFound(reply, "Content link not found");
  if (!link.childContent || link.childContent.ownerUserId !== userId) return forbidden(reply);

  const existing = await prisma.clearanceRequest.findFirst({
    where: { contentLinkId: linkId },
    orderBy: { createdAt: "desc" }
  });
  if (!existing) return reply.send({ ok: true, reviewGrantedAt: null });

  const updated = await prisma.clearanceRequest.update({
    where: { id: existing.id },
    data: { reviewGrantedAt: null, reviewGrantedByUserId: null }
  });

  if (process.env.NODE_ENV !== "production") {
    app.log.info({ linkId, userId }, "derivative.review.revoked");
  }

  return reply.send({ ok: true, reviewGrantedAt: updated.reviewGrantedAt });
});

app.post("/content/:id/credits", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);
  const body = (req.body ?? {}) as { name?: string; role?: string; userId?: string | null; sortOrder?: number };

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);

  const name = asString(body.name || "").trim();
  const role = asString(body.role || "").trim();
  if (!name || !role) return badRequest(reply, "name and role are required");

  let sortOrder = Number.isFinite(Number(body.sortOrder)) ? Math.floor(Number(body.sortOrder)) : null;
  if (sortOrder === null) {
    const max = await prisma.contentCredit.findFirst({
      where: { contentId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true }
    });
    sortOrder = (max?.sortOrder || 0) + 1;
  }

  const created = await prisma.contentCredit.create({
    data: {
      contentId,
      name,
      role,
      userId: body.userId || null,
      sortOrder
    }
  });
  return reply.send(created);
});

app.patch("/content/:id/credits/:creditId", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);
  const creditId = asString((req.params as any).creditId);
  const body = (req.body ?? {}) as { name?: string; role?: string; userId?: string | null; sortOrder?: number };

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);

  const credit = await prisma.contentCredit.findUnique({ where: { id: creditId } });
  if (!credit || credit.contentId !== contentId) return notFound(reply, "Credit not found");

  const data: any = {};
  if (body.name !== undefined) data.name = asString(body.name).trim();
  if (body.role !== undefined) data.role = asString(body.role).trim();
  if (body.userId !== undefined) data.userId = body.userId || null;
  if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) data.sortOrder = Math.floor(Number(body.sortOrder));

  const updated = await prisma.contentCredit.update({ where: { id: creditId }, data });
  return reply.send(updated);
});

app.delete("/content/:id/credits/:creditId", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);
  const creditId = asString((req.params as any).creditId);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);

  const credit = await prisma.contentCredit.findUnique({ where: { id: creditId } });
  if (!credit || credit.contentId !== contentId) return notFound(reply, "Credit not found");
  await prisma.contentCredit.delete({ where: { id: creditId } });
  return reply.send({ ok: true });
});

// Set sats-only price for content
app.patch("/content/:id/price", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);
  const sats = parseSats((req.body ?? {}).priceSats);
  if (!contentId) return badRequest(reply, "contentId required");
  if (sats < 1n) return badRequest(reply, "priceSats must be >= 1");

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);

  const updated = await prisma.contentItem.update({
    where: { id: contentId },
    data: { priceSats: sats }
  });
  return reply.send({ ok: true, priceSats: updated.priceSats?.toString() ?? null });
});

// Sales summary for a content item (creator)
app.get("/content/:id/sales", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);
  if (!contentId) return badRequest(reply, "contentId required");

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);

  const intents = await prisma.paymentIntent.findMany({
    where: { contentId, status: "paid" as any },
    orderBy: { createdAt: "desc" },
    take: 10
  });
  let total = 0n;
  for (const i of intents) total += i.amountSats;

  return reply.send({
    totalSats: total.toString(),
    recent: intents.map((i) => ({
      id: i.id,
      amountSats: i.amountSats.toString(),
      paidVia: i.paidVia,
      createdAt: i.createdAt.toISOString()
    }))
  });
});

// Open content folder in local file manager (owner only)
app.post("/content/:id/open-folder", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);
  if (!content.repoPath) return reply.code(500).send({ error: "Content repo not initialized" });

  try {
    await openFolderPath(content.repoPath);
    return reply.send({ ok: true });
  } catch (e: any) {
    return reply.code(500).send({ error: String(e?.message || e) });
  }
});

// List split versions for a content item (latest first)
app.get("/content/:id/split-versions", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);

  const versions = await prisma.splitVersion.findMany({
    where: { contentId },
    orderBy: { versionNumber: "desc" },
    include: { participants: { orderBy: { createdAt: "asc" } } }
  });

  return reply.send(
    versions.map((v) => ({
      id: v.id,
      contentId: v.contentId,
      versionNumber: v.versionNumber,
      status: v.status,
      lockedAt: v.lockedAt,
      createdAt: v.createdAt,
      lockedFileObjectKey: v.lockedFileObjectKey,
      lockedFileSha256: v.lockedFileSha256,
      participants: v.participants.map((p) => ({
        ...p,
        percent: percentToPrimitive(p.percent)
      }))
    }))
  );
});

// Update participants for the latest draft split for a content item
app.post("/content/:id/splits", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);

  const validated = validateAndNormalizeParticipants(req.body);
  if (!validated.ok) return badRequest(reply, validated.error);

  const latest = await prisma.splitVersion.findFirst({ where: { contentId }, orderBy: { versionNumber: "desc" } });
  if (!latest) return notFound(reply, "No split version found");
  if (latest.status !== "draft") return reply.code(409).send({ error: "Latest split is not editable" });

  await prisma.$transaction(async (tx) => {
    const before = await tx.splitParticipant.findMany({
      where: { splitVersionId: latest.id },
      orderBy: { createdAt: "asc" },
      select: { participantEmail: true, role: true, percent: true, bps: true }
    });

    // remove existing participants
    await tx.splitParticipant.deleteMany({ where: { splitVersionId: latest.id } });

    // create new participants
    for (const p of validated.participants) {
      await tx.splitParticipant.create({
        data: {
          splitVersionId: latest.id,
          participantEmail: p.participantEmail,
          role: p.role,
          percent: String(p.percent),
          bps: Math.round(num(p.percent) * 100)
        }
      });
    }

    // bind/accept owner participant if present
    try {
      const owner = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
      const ownerEmail = (owner?.email || "").toLowerCase();
      const res = await tx.splitParticipant.updateMany({
        where: {
          splitVersionId: latest.id,
          OR: [
            { participantUserId: userId },
            ownerEmail ? { participantEmail: { equals: ownerEmail, mode: "insensitive" } } : undefined
          ].filter(Boolean) as any
        },
        data: { participantUserId: userId, acceptedAt: new Date() }
      });
      if (process.env.NODE_ENV !== "production") {
        app.log.info({ splitVersionId: latest.id, userId, updated: res.count }, "split.owner.ensure");
      }
    } catch {}

    const after = validated.participants.map((p) => ({
      participantEmail: p.participantEmail,
      role: p.role,
      percent: String(p.percent),
      bps: Math.round(num(p.percent) * 100)
    }));

    await tx.auditEvent.create({
      data: {
        userId,
        action: "split.update",
        entityType: "SplitVersion",
        entityId: latest.id,
        payloadJson: {
          participantsHash: validated.hash,
          diff: {
            before: before.map((p) => ({
              participantEmail: p.participantEmail,
              role: p.role,
              percent: String(p.percent),
              bps: p.bps
            })),
            after
          }
        } as any
      }
    });
  });

  return reply.send({ ok: true });
});

// Create a new split version (copies participants from latest)
app.post("/content/:id/split-versions", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);

  const latest = await prisma.splitVersion.findFirst({ where: { contentId }, orderBy: { versionNumber: "desc" }, include: { participants: true } });

  const nextVersionNumber = latest ? latest.versionNumber + 1 : 1;

  const created = await prisma.$transaction(async (tx) => {
    const sv = await tx.splitVersion.create({
      data: {
        contentId,
        versionNumber: nextVersionNumber,
        createdByUserId: userId,
        status: "draft"
      }
    });

    if (latest?.participants?.length) {
      for (const p of latest.participants) {
        await tx.splitParticipant.create({
          data: {
            splitVersionId: sv.id,
            participantEmail: p.participantEmail,
            role: p.role,
            percent: String(p.percent),
            bps: (p as any).bps ?? Math.round(Number(p.percent || 0) * 100),
            payoutIdentityId: p.payoutIdentityId || null
          }
        });
      }
    }

    // bind/accept owner participant if present
    try {
      const owner = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
      const ownerEmail = (owner?.email || "").toLowerCase();
      const res = await tx.splitParticipant.updateMany({
        where: {
          splitVersionId: sv.id,
          OR: [
            { participantUserId: userId },
            ownerEmail ? { participantEmail: { equals: ownerEmail, mode: "insensitive" } } : undefined
          ].filter(Boolean) as any
        },
        data: { participantUserId: userId, acceptedAt: new Date() }
      });
      if (process.env.NODE_ENV !== "production") {
        app.log.info({ splitVersionId: sv.id, userId, updated: res.count }, "split.owner.ensure");
      }
    } catch {}

    await tx.auditEvent.create({
      data: {
        userId,
        action: "split.createVersion",
        entityType: "ContentItem",
        entityId: contentId,
        payloadJson: { versionNumber: nextVersionNumber } as any
      }
    });

    return sv;
  });

  return reply.send(created);
});

async function buildAndPersistProof(opts: {
  repoPath: string;
  contentId: string;
  splitVersionId: string;
  versionNumber: number;
  lockedAt: Date;
  participants: Array<{ id: string; participantEmail: string | null; role: string; percent: any }>;
  creatorId: string;
}) {
  const manifest = await readManifest(opts.repoPath);
  if (!manifest) throw new Error("manifest.json not found in repo");

  const manifestHash = computeManifestHash(manifest);

  let primary = getPrimaryFileInfo(manifest);
  if ((!primary.objectKey || !primary.sha256) && opts.contentId) {
    // Fallback to DB metadata when manifest is missing primary fields
    try {
      if (!primary.objectKey) {
        const latest = await prisma.contentFile.findFirst({
          where: { contentId: opts.contentId },
          orderBy: { createdAt: "desc" }
        });
        if (latest) {
          primary = {
            objectKey: latest.objectKey,
            sha256: latest.sha256 || null,
            originalName: latest.originalName || null
          };
        }
      }
      if (primary.objectKey && !primary.sha256) {
        const f = await prisma.contentFile.findFirst({
          where: { contentId: opts.contentId, objectKey: primary.objectKey }
        });
        if (f?.sha256) {
          primary = {
            objectKey: primary.objectKey,
            sha256: f.sha256,
            originalName: primary.originalName || f.originalName || null
          };
        }
      }
    } catch {}
  }
  if (!primary.objectKey || !primary.sha256) {
    throw new Error("primary file not found in manifest");
  }

  const splits = normalizeSplitsForProof(
    opts.participants.map((p) => ({
      participantId: p.id,
      participantEmail: p.participantEmail,
      role: p.role,
      percent: p.percent
    }))
  );

  const splitsHash = computeSplitsHash(splits);

  const payload = {
    proofVersion: 1,
    contentId: opts.contentId,
    splitVersion: `v${opts.versionNumber}`,
    lockedAt: opts.lockedAt.toISOString(),
    manifestHash,
    primaryFileSha256: primary.sha256,
    primaryFileObjectKey: primary.objectKey,
    splits,
    creatorId: opts.creatorId
  };

  const proofHash = computeProofHash(payload);

  const proof = {
    proofHash,
    payload,
    splitsHash,
    manifestHash,
    signatures: [
      {
        type: "creator",
        userId: opts.creatorId,
        signature: null,
        createdAt: opts.lockedAt.toISOString()
      }
    ]
  };

  const absProof = proofAbsPath(opts.repoPath, opts.versionNumber);
  await fs.mkdir(path.dirname(absProof), { recursive: true });
  await fs.writeFile(absProof, stableStringify(proof, true), "utf8");

  await commitAll(opts.repoPath, `Lock splits ${opts.contentId} v${opts.versionNumber} proof ${proofHash}`);

  return {
    proof,
    proofHash,
    manifestHash,
    splitsHash,
    lockedFileObjectKey: primary.objectKey,
    lockedFileSha256: primary.sha256,
    lockedFileOriginalName: primary.originalName || null
  };
}

async function issueReceiptIfNeeded(purchase: any, proof: any, repoPath: string, creatorId: string) {
  const existing = await prisma.creditReceiptRef.findUnique({ where: { purchaseId: purchase.id } });
  if (existing && existing.receiptPath) {
    return existing;
  }

  const receiptId = crypto.randomUUID();
  const issuedAt = new Date().toISOString();

  const receiptPayload = {
    receiptVersion: 1,
    receiptId,
    proofHash: purchase.proofHash,
    manifestHash: proof?.payload?.manifestHash || proof?.manifestHash || null,
    contentId: purchase.contentId,
    splitVersion: `v${purchase.splitVersion}`,
    amountSats: purchase.amountSats,
    unitsPurchased: purchase.unitsPurchased,
    rateSatsPerUnit: purchase.rateSatsPerUnit,
    paymentProvider: purchase.provider,
    paymentHash: purchase.paymentHash,
    invoiceId: purchase.invoiceId,
    issuedAt,
    creatorId,
    creatorSig: null
  };

  const receiptPath = path.posix.join("receipts", `${receiptId}.json`);
  const abs = path.join(repoPath, "receipts", `${receiptId}.json`);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, stableStringify(receiptPayload, true), "utf8");

  await commitAll(repoPath, `Receipt issued ${purchase.proofHash} ${receiptId} ${purchase.amountSats}sats`);

  try {
    const ref = await prisma.creditReceiptRef.create({
      data: {
        purchaseId: purchase.id,
        receiptId,
        receiptPath,
        issuedAt: new Date(issuedAt)
      }
    });
    return ref;
  } catch (e: any) {
    const ref = await prisma.creditReceiptRef.findUnique({ where: { purchaseId: purchase.id } });
    if (ref) return ref;
    throw e;
  }
}

async function getLockedSplitForContent(contentId: string) {
  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return null;

  if (content.currentSplitId) {
    const sv = await prisma.splitVersion.findUnique({
      where: { id: content.currentSplitId },
      include: { participants: true }
    });
    if (sv && sv.status === "locked") return sv;
  }

  const sv = await prisma.splitVersion.findFirst({
    where: { contentId, status: "locked" },
    orderBy: { versionNumber: "desc" },
    include: { participants: true }
  });
  return sv;
}

function toBps(p: any): number {
  if (typeof p?.bps === "number" && Number.isFinite(p.bps) && p.bps > 0) return Math.floor(p.bps);
  const percent = num(percentToPrimitive(p?.percent ?? 0));
  return Math.round(percent * 100);
}

async function getApproverUserIdsForParent(parentContentId: string): Promise<string[]> {
  const { eligible } = await getEligibleApproversForParent(parentContentId);
  const userIds = new Set<string>();
  const emails: string[] = [];

  for (const a of eligible) {
    if (a.participantUserId) userIds.add(a.participantUserId);
    else if (a.participantEmail) emails.push(a.participantEmail.toLowerCase());
  }

  if (emails.length > 0) {
    const users = await prisma.user.findMany({
      where: { email: { in: emails, mode: "insensitive" } },
      select: { id: true }
    });
    for (const u of users) userIds.add(u.id);
  }

  return Array.from(userIds);
}

async function getDerivativeAuthorizationStatus(childContentId: string) {
  const auths = await prisma.derivativeAuthorization.findMany({
    where: { derivativeLink: { childContentId } },
    select: { status: true }
  });
  if (auths.length === 0) return { status: "NONE" };
  if (auths.some((a) => a.status === "REJECTED")) return { status: "REJECTED" };
  if (auths.every((a) => a.status === "APPROVED")) return { status: "APPROVED" };
  return { status: "PENDING" };
}

async function isAcceptedParticipant(userId: string, contentId: string) {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const email = (me?.email || "").toLowerCase();
  const participant = await prisma.splitParticipant.findFirst({
    where: {
      acceptedAt: { not: null },
      splitVersion: { contentId },
      OR: [
        { participantUserId: userId },
        email ? { participantEmail: { equals: email, mode: "insensitive" } } : undefined
      ].filter(Boolean) as any
    }
  });
  return Boolean(participant);
}

async function getParentLockedParticipantsForVote(parentContentId: string) {
  const { eligible } = await getEligibleApproversForParent(parentContentId);
  return eligible
    .filter((p) => p.participantUserId)
    .map((p) => ({
      splitParticipantId: p.splitParticipantId || null,
      userId: p.participantUserId as string,
      bps: p.weightBps || 0
    }));
}

type ApproverInfo = {
  splitParticipantId?: string | null;
  participantUserId: string | null;
  participantEmail: string | null;
  role: string | null;
  weightBps: number;
  accepted: boolean;
};

function matchApproverToUser(approver: ApproverInfo, userId: string, userEmail: string): boolean {
  if (approver.participantUserId && approver.participantUserId === userId) return true;
  if (approver.participantEmail && userEmail && approver.participantEmail.toLowerCase() === userEmail) return true;
  return false;
}

async function getApproversForParent(parentContentId: string): Promise<{
  split: any | null;
  approvers: ApproverInfo[];
}> {
  const split = await getLockedSplitForContent(parentContentId);
  const participants = split?.participants || [];

  const acceptedRefs = await prisma.splitParticipant.findMany({
    where: { splitVersion: { contentId: parentContentId }, acceptedAt: { not: null } },
    select: { participantUserId: true, participantEmail: true }
  });
  const acceptedUserIds = new Set(acceptedRefs.map((p) => p.participantUserId).filter(Boolean) as string[]);
  const acceptedEmails = new Set(
    acceptedRefs.map((p) => (p.participantEmail || "").toLowerCase()).filter(Boolean)
  );

  const approvers: ApproverInfo[] = participants.map((p: any) => ({
    splitParticipantId: p.id,
    participantUserId: p.participantUserId || null,
    participantEmail: p.participantEmail || null,
    role: p.role || null,
    weightBps: toBps(p),
    accepted:
      Boolean(p.acceptedAt) ||
      (p.participantUserId ? acceptedUserIds.has(p.participantUserId) : false) ||
      (p.participantEmail ? acceptedEmails.has(String(p.participantEmail).toLowerCase()) : false)
  }));

  const parent = await prisma.contentItem.findUnique({
    where: { id: parentContentId },
    select: { ownerUserId: true, owner: { select: { email: true } } }
  });
  if (parent?.ownerUserId && approvers.length === 0) {
    approvers.push({
      splitParticipantId: null,
      participantUserId: parent.ownerUserId,
      participantEmail: null,
      role: "owner",
      weightBps: 0,
      accepted: true
    });
  }

  // De-dupe by userId or email to avoid double-counting approvers.
  const unique: ApproverInfo[] = [];
  const seen = new Set<string>();
  for (const a of approvers) {
    const email = (a.participantEmail || "").toLowerCase();
    const key = a.participantUserId ? `u:${a.participantUserId}` : email ? `e:${email}` : `x:${a.splitParticipantId || unique.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(a);
  }

  return { split, approvers: unique };
}

async function getEligibleApproversForParent(parentContentId: string) {
  const { split, approvers } = await getApproversForParent(parentContentId);
  const eligible = approvers.filter(
    (a) => a.role === "owner" || a.accepted || a.participantUserId || a.participantEmail
  );
  return { split, approvers, eligible };
}

async function settlePaymentIntent(paymentIntentId: string) {
  const intent = await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });
  if (!intent) throw new Error("PaymentIntent not found");
  if (intent.status !== "paid") throw new Error("PaymentIntent not paid");

  const existing = await prisma.settlement.findUnique({ where: { paymentIntentId } });
  if (existing) return existing;

  const content = await prisma.contentItem.findUnique({ where: { id: intent.contentId } });
  if (!content) throw new Error("Content not found");

  const childSplit = await getLockedSplitForContent(content.id);
  if (!childSplit) throw new Error("Locked child split not found");

  const parents = await prisma.contentLink.findMany({
    where: { childContentId: content.id },
    orderBy: { id: "asc" }
  });
  if (parents.length > 1) {
    throw new Error("MULTIPLE_PARENTS_NOT_SUPPORTED");
  }
  const net = BigInt(intent.amountSats);

  const primaryParent = parents[0] || null;
  const upstreamRaw =
    primaryParent && primaryParent.upstreamBps > 0
      ? [{ parentContentId: primaryParent.parentContentId, upstreamBps: Math.max(0, primaryParent.upstreamBps) }]
      : [];

  let upstreamTotal = 0n;
  const upstreamAlloc: Array<{ parentContentId: string; amountSats: bigint; upstreamBps: number }> = upstreamRaw.map((p) => {
    const amt = (net * BigInt(p.upstreamBps)) / 10000n;
    upstreamTotal += amt;
    return { parentContentId: p.parentContentId, amountSats: amt, upstreamBps: p.upstreamBps };
  });

  const childRemainder = net - upstreamAlloc.reduce((s, a) => s + a.amountSats, 0n);

  if (upstreamAlloc.length > 0) {
    if (process.env.NODE_ENV !== "production") {
      app.log.info(
        {
          contentId: content.id,
          parentContentId: primaryParent?.parentContentId || null,
          upstreamBps: primaryParent?.upstreamBps ?? null,
          upstreamAmountSats: upstreamAlloc[0]?.amountSats?.toString?.() ?? String(upstreamAlloc[0]?.amountSats ?? 0),
          childRemainderSats: childRemainder.toString()
        },
        "settlement.upstream"
      );
    }
    try {
      await prisma.auditEvent.create({
        data: {
          userId: content.ownerUserId,
          action: "settlement.upstream",
          entityType: "ContentItem",
          entityId: content.id,
          payloadJson: {
            parentContentId: primaryParent?.parentContentId || null,
            upstreamBps: primaryParent?.upstreamBps ?? null,
            upstreamAmountSats: upstreamAlloc[0]?.amountSats?.toString?.() ?? String(upstreamAlloc[0]?.amountSats ?? 0),
            childRemainderSats: childRemainder.toString(),
            parentCount: parents.length
          } as any
        }
      });
    } catch {}
  }

  const lines: Array<{ participantId?: string | null; participantEmail?: string | null; role?: string | null; amountSats: bigint }> = [];

  // Child split allocation
  const childItems = childSplit.participants.map((p) => ({ id: p.id, bps: toBps(p), p }));
  const childAlloc = allocateByBps(childRemainder, childItems.map((i) => ({ id: i.id, bps: i.bps })));
  for (const a of childAlloc) {
    const p = childItems.find((i) => i.id === a.id)?.p;
    const childRole = upstreamAlloc.length > 0 ? (p?.role ? `derivative:${p.role}` : "derivative") : (p?.role || null);
    lines.push({
      participantId: p?.id || null,
      participantEmail: p?.participantEmail || null,
      role: childRole,
      amountSats: a.amountSats
    });
  }

  // Parent allocations
  for (const up of upstreamAlloc) {
    const parentSplit = await getLockedSplitForContent(up.parentContentId);
    if (!parentSplit || parentSplit.status !== "locked") {
      const err: any = new Error("Parent split not locked");
      err.statusCode = 409;
      err.code = "PARENT_SPLIT_NOT_LOCKED";
      throw err;
    }

    const parentItems = parentSplit.participants.map((p) => ({ id: p.id, bps: toBps(p), p }));
    const parentAlloc = allocateByBps(up.amountSats, parentItems.map((i) => ({ id: i.id, bps: i.bps })));
    for (const a of parentAlloc) {
      const p = parentItems.find((i) => i.id === a.id)?.p;
      lines.push({
        participantId: p?.id || null,
        participantEmail: p?.participantEmail || null,
        role: "upstream",
        amountSats: a.amountSats
      });
    }
  }

  const settlement = await prisma.settlement.create({
    data: {
      contentId: content.id,
      splitVersionId: childSplit.id,
      netAmountSats: net,
      paymentIntentId: intent.id,
      lines: {
        create: lines.map((l) => ({
          participantId: l.participantId || null,
          participantEmail: l.participantEmail || null,
          role: l.role || null,
          amountSats: l.amountSats
        }))
      }
    }
  });

  if (intent.buyerUserId) {
    await prisma.entitlement.upsert({
      where: { buyerUserId_contentId_manifestSha256: { buyerUserId: intent.buyerUserId, contentId: content.id, manifestSha256: intent.manifestSha256 } },
      update: { paymentIntentId: intent.id },
      create: {
        buyerUserId: intent.buyerUserId,
        contentId: content.id,
        manifestSha256: intent.manifestSha256,
        paymentIntentId: intent.id
      }
    }).catch(() => {});
  } else {
    await prisma.entitlement.create({
      data: {
        buyerUserId: null,
        contentId: content.id,
        manifestSha256: intent.manifestSha256,
        paymentIntentId: intent.id
      }
    }).catch(() => {});
  }

  return settlement;
}

// Lock a split version (owner only)
app.post("/split-versions/:id/lock", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const splitVersionId = asString((req.params as any).id);

  const sv = await prisma.splitVersion.findUnique({
    where: { id: splitVersionId },
    include: { content: true, participants: { orderBy: { createdAt: "asc" } } }
  });
  if (!sv) return notFound(reply, "Split version not found");
  if (sv.content.ownerUserId !== userId) return forbidden(reply);
  if (sv.status !== "draft") return badRequest(reply, "Split version already locked");
  if (!sv.content.repoPath) return reply.code(500).send({ error: "Content repo not initialized" });
  if (!sv.participants?.length) return badRequest(reply, "Split version has no participants");

  const now = new Date();
  let proofResult: any;
  try {
    proofResult = await buildAndPersistProof({
      repoPath: sv.content.repoPath,
      contentId: sv.contentId,
      splitVersionId,
      versionNumber: sv.versionNumber,
      lockedAt: now,
      participants: sv.participants,
      creatorId: userId
    });
  } catch (e: any) {
    return reply.code(500).send({ error: String(e?.message || e) });
  }

  await prisma.splitVersion.update({
    where: { id: splitVersionId },
    data: {
      status: "locked",
      lockedAt: now,
      lockedFileObjectKey: proofResult.lockedFileObjectKey || null,
      lockedFileSha256: proofResult.lockedFileSha256 || null
    }
  });

  try {
    const owner = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const ownerEmail = (owner?.email || "").toLowerCase();
    const res = await prisma.splitParticipant.updateMany({
      where: {
        splitVersionId,
        OR: [
          { participantUserId: userId },
          ownerEmail ? { participantEmail: { equals: ownerEmail, mode: "insensitive" } } : undefined
        ].filter(Boolean) as any
      },
      data: { participantUserId: userId, acceptedAt: new Date() }
    });
    if (process.env.NODE_ENV !== "production") {
      app.log.info({ splitVersionId, userId, updated: res.count }, "split.owner.ensure");
    }
  } catch {}

  await prisma.auditEvent.create({
    data: {
      userId,
      action: "split.lock",
      entityType: "SplitVersion",
      entityId: splitVersionId,
      payloadJson: {
        lockedAt: now,
        proofHash: proofResult.proofHash,
        manifestHash: proofResult.manifestHash,
        splitsHash: proofResult.splitsHash,
        proofPath: proofRelPath(sv.versionNumber)
      } as any
    }
  });

  try {
    await prisma.auditEvent.create({
      data: {
        userId,
        action: "content.proof",
        entityType: "ContentItem",
        entityId: sv.contentId,
        payloadJson: {
          lockedAt: now,
          proofHash: proofResult.proofHash,
          manifestHash: proofResult.manifestHash,
          splitsHash: proofResult.splitsHash,
          splitVersion: sv.versionNumber
        } as any
      }
    });
  } catch {}

  return reply.send({
    ok: true,
    proofHash: proofResult.proofHash,
    manifestHash: proofResult.manifestHash,
    splitsHash: proofResult.splitsHash
  });
});

/**
 * PAYMENTS V1
 */
app.get("/v1/payments/price", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const proofHash = asString((req.query || {})?.proofHash || "").trim();
  if (!proofHash) return badRequest(reply, "proofHash required");

  const found = await findProofByHashForUser(userId, proofHash);
  if (!found) return notFound(reply, "Proof not found");

  const rate = await getRateSatsPerUnitForContent(found.content.repoPath || "");
  return reply.send({ rateSatsPerUnit: rate, unitSeconds: PAYMENT_UNIT_SECONDS, minUnits: 1 });
});

app.post("/v1/payments/quote", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const proofHash = asString((req.body ?? {})?.proofHash || "").trim();
  const units = Math.max(1, Math.floor(num((req.body ?? {})?.units || 0)));
  if (!proofHash) return badRequest(reply, "proofHash required");

  const found = await findProofByHashForUser(userId, proofHash);
  if (!found) return notFound(reply, "Proof not found");

  const rate = await getRateSatsPerUnitForContent(found.content.repoPath || "");
  const amountSats = units * rate;

  return reply.send({ amountSats, expiresInSeconds: 900, rateSatsPerUnit: rate, unitSeconds: PAYMENT_UNIT_SECONDS });
});

app.post("/v1/payments/invoice", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const proofHash = asString((req.body ?? {})?.proofHash || "").trim();
  const units = Math.max(1, Math.floor(num((req.body ?? {})?.units || 0)));
  if (!proofHash) return badRequest(reply, "proofHash required");

  const found = await findProofByHashForUser(userId, proofHash);
  if (!found) return notFound(reply, "Proof not found");

  const rate = await getRateSatsPerUnitForContent(found.content.repoPath || "");
  const amountSats = units * rate;
  const expiresInSeconds = 900;

  let invoice;
  try {
    invoice = await PAYMENT_PROVIDER.createInvoice({
      amountSats,
      memo: `Contentbox ${proofHash.slice(0, 12)} (${units}u)`,
      expiresInSeconds,
      metadata: { proofHash, contentId: found.content.id, splitVersion: found.splitVersion.versionNumber }
    });
  } catch (e: any) {
    return reply.code(400).send({ error: String(e?.message || e) });
  }

  const purchase = await prisma.creditPurchase.create({
    data: {
      userId,
      proofHash,
      contentId: found.content.id,
      splitVersion: found.splitVersion.versionNumber,
      rateSatsPerUnit: rate,
      unitsPurchased: units,
      amountSats,
      invoiceId: invoice.invoiceId,
      paymentHash: invoice.paymentHash,
      provider: PAYMENT_PROVIDER.kind as any,
      status: "unpaid" as any,
      expiresAt: new Date(invoice.expiresAt)
    }
  });

  return reply.send({
    purchaseId: purchase.id,
    bolt11: invoice.bolt11,
    paymentHash: invoice.paymentHash,
    expiresAt: invoice.expiresAt
  });
});

app.get("/v1/payments/status/:purchaseId", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const purchaseId = asString((req.params as any).purchaseId || "").trim();
  if (!purchaseId) return badRequest(reply, "purchaseId required");

  const purchase = await prisma.creditPurchase.findUnique({ where: { id: purchaseId } });
  if (!purchase || purchase.userId !== userId) return notFound(reply, "Purchase not found");

  if (purchase.status === "paid" || purchase.status === "expired") {
    return reply.send({ status: purchase.status, paidAt: purchase.paidAt ? purchase.paidAt.toISOString() : null });
  }

  let status;
  try {
    status = await PAYMENT_PROVIDER.getInvoiceStatus(purchase.invoiceId);
  } catch (e: any) {
    return reply.code(400).send({ error: String(e?.message || e) });
  }

  if (status.status === "paid") {
    await prisma.creditPurchase.update({
      where: { id: purchaseId },
      data: { status: "paid" as any, paidAt: status.paidAt ? new Date(status.paidAt) : new Date() }
    });
  } else if (status.status === "expired") {
    await prisma.creditPurchase.update({
      where: { id: purchaseId },
      data: { status: "expired" as any }
    });
  }

  return reply.send({ status: status.status, paidAt: status.paidAt || null });
});

app.get("/v1/payments/receipt/:purchaseId", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const purchaseId = asString((req.params as any).purchaseId || "").trim();
  if (!purchaseId) return badRequest(reply, "purchaseId required");

  const purchase = await prisma.creditPurchase.findUnique({ where: { id: purchaseId } });
  if (!purchase || purchase.userId !== userId) return notFound(reply, "Purchase not found");
  if (purchase.status !== "paid") return badRequest(reply, "Purchase not paid");

  const found = await findProofByHashForUser(userId, purchase.proofHash);
  if (!found) return notFound(reply, "Proof not found");
  if (!found.content.repoPath) return reply.code(500).send({ error: "Content repo not initialized" });

  let ref;
  try {
    ref = await issueReceiptIfNeeded(purchase, found.proof, found.content.repoPath, userId);
  } catch (e: any) {
    return reply.code(500).send({ error: String(e?.message || e) });
  }

  const abs = path.join(found.content.repoPath, ref.receiptPath);
  try {
    const raw = await fs.readFile(abs, "utf8");
    const json = JSON.parse(raw);
    const spent = await prisma.creditSpend.count({ where: { receiptId: ref.receiptId } });
    const remainingUnits = Math.max(0, purchase.unitsPurchased - spent);
    return reply.send({ receipt: json, receiptId: ref.receiptId, remainingUnits });
  } catch (e: any) {
    return reply.code(500).send({ error: String(e?.message || e) });
  }
});

app.post("/v1/stream/spend", { preHandler: requireAuth }, async (req: any, reply) => {
  const receiptId = asString((req.body ?? {})?.receiptId || "").trim();
  const unitIndex = Math.floor(num((req.body ?? {})?.unitIndex));
  const sessionId = asString((req.body ?? {})?.sessionId || "").trim() || null;
  if (!receiptId) return badRequest(reply, "receiptId required");
  if (!Number.isInteger(unitIndex) || unitIndex < 0) return badRequest(reply, "unitIndex invalid");

  const ref = await prisma.creditReceiptRef.findUnique({ where: { receiptId } });
  if (!ref) return notFound(reply, "Receipt not found");

  const purchase = await prisma.creditPurchase.findUnique({ where: { id: ref.purchaseId } });
  if (!purchase || purchase.status !== "paid") return badRequest(reply, "Receipt not paid");
  if (unitIndex >= purchase.unitsPurchased) return badRequest(reply, "unitIndex out of range");

  try {
    await prisma.creditSpend.create({ data: { receiptId, unitIndex, sessionId } });
  } catch (e: any) {
    return reply.code(409).send({ error: "unitIndex already spent" });
  }

  const spent = await prisma.creditSpend.count({ where: { receiptId } });
  const remainingUnits = Math.max(0, purchase.unitsPurchased - spent);

  const token = app.jwt.sign({
    receiptId,
    proofHash: purchase.proofHash,
    unitIndex,
    exp: Math.floor(Date.now() / 1000) + PAYMENT_UNIT_SECONDS
  });

  return reply.send({ ok: true, remainingUnits, streamPermitToken: token });
});

/**
 * PAYMENT INTENTS (Derivative settlement)
 */
app.post("/api/payments/intents", { preHandler: optionalAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser | undefined)?.sub || null;
  const body = (req.body ?? {}) as {
    purpose?: string;
    subjectType?: string;
    subjectId?: string;
    manifestSha256?: string;
    amountSats?: any;
  };

  const purpose = asString(body.purpose || "CONTENT_PURCHASE").trim();
  const subjectType = asString(body.subjectType || "CONTENT").trim();
  const subjectId = asString(body.subjectId || "").trim();
  const manifestSha256 = asString(body.manifestSha256 || "").trim();
  const amountSats = parseSats(body.amountSats);

  if (purpose !== "CONTENT_PURCHASE") return badRequest(reply, "purpose must be CONTENT_PURCHASE");
  if (subjectType !== "CONTENT") return badRequest(reply, "subjectType must be CONTENT");
  if (!subjectId) return badRequest(reply, "subjectId required");
  if (!manifestSha256) return badRequest(reply, "manifestSha256 required");
  if (amountSats <= 0n) return badRequest(reply, "amountSats must be > 0");

  const content = await prisma.contentItem.findUnique({ where: { id: subjectId } });
  if (!content) return notFound(reply, "Content not found");

  const manifest = await prisma.manifest.findUnique({ where: { contentId: subjectId } });
  if (!manifest || manifest.sha256 !== manifestSha256) return badRequest(reply, "manifestSha256 does not match content manifest");
  const storefrontEnabled = content.storefrontStatus && content.storefrontStatus !== "DISABLED";

  if (!userId) {
    if (!storefrontEnabled) return notFound(reply, "Not found");
    if (content.status !== "published") return notFound(reply, "Not found");
  } else {
    if (content.status !== "published") return reply.code(403).send({ error: "Content not published" });
  }

  const intent = await prisma.paymentIntent.create({
    data: {
      buyerUserId: userId || null,
      contentId: subjectId,
      manifestSha256,
      amountSats,
      status: "pending" as any,
      purpose: "CONTENT_PURCHASE" as any,
      subjectType: "CONTENT" as any,
      subjectId
    }
  });

  let onchainReason: string | null = null;
  let onchain: { address: string; derivationIndex?: number | null } | null = null;
  try {
    onchain = await createOnchainAddress(intent.id);
  } catch (e: any) {
    onchain = null;
  }

  if (!onchain) {
    const payoutMethod = await prisma.payoutMethod.findUnique({ where: { code: "btc_onchain" as any } });
    if (payoutMethod) {
      const identity = await prisma.identity.findFirst({
        where: { payoutMethodId: payoutMethod.id, userId: content.ownerUserId },
        orderBy: { createdAt: "desc" }
      });
      if (identity?.value) {
        const maxIdx = await prisma.paymentIntent.findFirst({
          where: { contentId: subjectId, onchainDerivationIndex: { not: null } },
          orderBy: { onchainDerivationIndex: "desc" },
          select: { onchainDerivationIndex: true }
        });
        const nextIdx = (maxIdx?.onchainDerivationIndex ?? -1) + 1;
        try {
          const addr = await deriveFromXpub.addressAt(String(identity.value), nextIdx);
          onchain = { address: addr, derivationIndex: nextIdx };
        } catch {
          onchain = null;
          onchainReason = "Invalid XPUB";
        }
      }
    }
    if (!onchain && !onchainReason) onchainReason = "On-chain not configured";
  }

  let lightning: null | { bolt11: string; providerId: string; expiresAt: string | null } = null;
  try {
    const invoice = await createLightningInvoice(amountSats, `Contentbox ${subjectId.slice(0, 8)} ${manifestSha256.slice(0, 8)}`);
    if (invoice) lightning = invoice;
  } catch (e: any) {
    app.log.warn({ err: e }, "lnbits invoice failed; continuing with on-chain only");
  }

  if (onchain?.address || lightning?.bolt11) {
    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        onchainAddress: onchain?.address || null,
        onchainDerivationIndex: onchain?.derivationIndex ?? null,
        bolt11: lightning?.bolt11 || null,
        providerId: lightning?.providerId || null,
        lightningExpiresAt: lightning?.expiresAt ? new Date(lightning.expiresAt) : null
      }
    });
  }

  return reply.send({
    ok: true,
    intentId: intent.id,
    status: intent.status,
    onchain: onchain ? { address: onchain.address } : null,
    lightning: lightning ? { bolt11: lightning.bolt11, expiresAt: lightning.expiresAt } : null,
    onchainReason
  });
});

app.get("/api/payments/readiness", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  let lightningReady = false;
  let lightningReason: string | null = "NOT_CONFIGURED";

  if (PAYMENT_PROVIDER.kind === "none") {
    lightningReason = "DISABLED";
  } else if (PAYMENT_PROVIDER.kind === "lnd") {
    const hasUrl = Boolean(String(process.env.LND_REST_URL || "").trim());
    const macHex = String(process.env.LND_MACAROON_HEX || process.env.LND_MACAROON || "").trim();
    const macPath = String(process.env.LND_MACAROON_PATH || "").trim();
    const hasMac = Boolean(macHex) || (macPath ? fsSync.existsSync(macPath) : false);
    if (hasUrl && hasMac) {
      lightningReady = true;
      lightningReason = null;
    } else {
      lightningReason = "NOT_CONFIGURED";
    }
  } else if (PAYMENT_PROVIDER.kind === "btcpay") {
    const hasUrl = Boolean(String(process.env.BTCPAY_URL || "").trim());
    const hasKey = Boolean(String(process.env.BTCPAY_API_KEY || "").trim());
    const hasStore = Boolean(String(process.env.BTCPAY_STORE_ID || "").trim());
    if (hasUrl && hasKey && hasStore) {
      lightningReady = true;
      lightningReason = null;
    } else {
      lightningReason = "NOT_CONFIGURED";
    }
  }

  let onchainReady = false;
  let onchainReason: string | null = "NOT_CONFIGURED";
  const payoutMethod = await prisma.payoutMethod.findUnique({ where: { code: "btc_onchain" as any } });
  if (payoutMethod) {
    const identity = await prisma.identity.findFirst({
      where: { payoutMethodId: payoutMethod.id, userId }
    });
    if (identity?.value) {
      onchainReady = true;
      onchainReason = null;
    }
  }

  return reply.send({
    lightning: { ready: lightningReady, reason: lightningReason },
    onchain: { ready: onchainReady, reason: onchainReason }
  });
});

// ------------------------------
// Finance endpoints (read-only)
// ------------------------------

function buildHealthFromReadiness(readiness: { lightning: { ready: boolean; reason: string | null }; onchain: { ready: boolean; reason: string | null } }) {
  const lightning = readiness.lightning.ready
    ? { status: "healthy", message: "Configured", endpoint: process.env.LND_REST_URL || null, hint: null }
    : { status: "missing", message: readiness.lightning.reason || "Not configured", endpoint: process.env.LND_REST_URL || null, hint: null };
  const onchain = readiness.onchain.ready
    ? { status: "healthy", message: "Configured", endpoint: null, hint: null }
    : { status: "missing", message: readiness.onchain.reason || "Not configured", endpoint: null, hint: null };
  return { lightning, onchain };
}

app.get("/finance/overview", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const contents = await prisma.contentItem.findMany({
    where: { ownerUserId: userId },
    select: { id: true }
  });
  const contentIds = contents.map((c) => c.id);

  const settlements = await prisma.settlement.findMany({
    where: { contentId: { in: contentIds } }
  });

  const now = new Date();
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  let salesSats = 0n;
  let salesSatsLast30d = 0n;
  const seriesMap = new Map<string, bigint>();

  for (const s of settlements) {
    const amt = BigInt(s.netAmountSats as any);
    salesSats += amt;
    if (s.createdAt >= since) {
      salesSatsLast30d += amt;
      const key = s.createdAt.toISOString().slice(0, 10);
      const prev = seriesMap.get(key) || 0n;
      seriesMap.set(key, prev + amt);
    }
  }

  const revenueSeries: Array<{ date: string; amountSats: string }> = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    revenueSeries.push({ date: key, amountSats: (seriesMap.get(key) || 0n).toString() });
  }

  // Reuse readiness logic
  const [lnd, onchain] = await Promise.all([lndHealthCheck(), bitcoindHealthCheck()]);
  const health = { lightning: lnd, onchain };

  return reply.send({
    totals: {
      salesSats: salesSats.toString(),
      salesSatsLast30d: salesSatsLast30d.toString(),
      invoicesTotal: 0,
      invoicesPaid: 0,
      invoicesPending: 0,
      invoicesFailed: 0,
      invoicesExpired: 0,
      paymentsReceivedSats: "0",
      paymentsPendingSats: "0",
      paymentsReceivedCount: 0,
      paymentsPendingCount: 0,
      paymentsLast30d: 0
    },
    revenueSeries,
    health,
    lastUpdatedAt: new Date().toISOString()
  });
});

app.get("/finance/royalties", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const email = (me?.email || "").toLowerCase();

  const contents = await prisma.contentItem.findMany({
    where: { ownerUserId: userId },
    select: { id: true, title: true }
  });
  const contentIds = contents.map((c) => c.id);

  const settlements = await prisma.settlement.findMany({
    where: { contentId: { in: contentIds } }
  });

  const participantRows = await prisma.splitParticipant.findMany({
    where: {
      OR: [
        { participantUserId: userId },
        email ? { participantEmail: { equals: email, mode: "insensitive" } } : undefined
      ].filter(Boolean) as any
    },
    select: { id: true, participantEmail: true }
  });
  const participantIds = new Set(participantRows.map((p) => p.id));
  const participantEmails = new Set(
    participantRows.map((p) => (p.participantEmail ? p.participantEmail.toLowerCase() : "")).filter(Boolean)
  );

  const lines = await prisma.settlementLine.findMany({
    where: {
      OR: [
        participantIds.size ? { participantId: { in: Array.from(participantIds) } } : undefined,
        participantEmails.size ? { participantEmail: { in: Array.from(participantEmails) } } : undefined
      ].filter(Boolean) as any
    },
    include: { settlement: true }
  });

  const rows = new Map<string, { contentId: string; title: string; total: bigint; yourShare: bigint }>();
  for (const c of contents) {
    rows.set(c.id, { contentId: c.id, title: c.title, total: 0n, yourShare: 0n });
  }

  for (const s of settlements) {
    const row = rows.get(s.contentId);
    if (!row) continue;
    row.total += BigInt(s.netAmountSats as any);
  }

  for (const l of lines) {
    if (!l.settlement?.contentId) continue;
    const row = rows.get(l.settlement.contentId);
    if (!row) continue;
    row.yourShare += BigInt(l.amountSats as any);
  }

  let earnedTotal = 0n;
  let pendingTotal = 0n;
  const items = Array.from(rows.values()).map((r) => {
    earnedTotal += r.yourShare;
    return {
      contentId: r.contentId,
      title: r.title,
      totalSalesSats: r.total.toString(),
      grossRevenueSats: r.total.toString(),
      allocationSats: r.yourShare.toString(),
      settledSats: r.yourShare.toString(),
      withdrawnSats: "0",
      pendingSats: "0"
    };
  });

  return reply.send({
    items,
    totals: { earnedSats: earnedTotal.toString(), pendingSats: pendingTotal.toString() },
    cursor: null
  });
});

app.get("/finance/payouts", { preHandler: requireAuth }, async (_req: any, reply: any) => {
  return reply.send({ items: [], totals: { pendingSats: "0", paidSats: "0" }, cursor: null });
});

app.get("/finance/transactions", { preHandler: requireAuth }, async (_req: any, reply: any) => {
  return reply.send({ items: [], cursor: null });
});

app.get("/finance/audit/export", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const userId = (req.user as JwtUser).sub;
  const [overview, royalties, payouts, transactions] = await Promise.all([
    (await (async () => {
      const res = await app.inject({ method: "GET", url: "/finance/overview", headers: { authorization: req.headers.authorization || "" } });
      return res.json();
    })) as any,
    (await (async () => {
      const res = await app.inject({ method: "GET", url: "/finance/royalties", headers: { authorization: req.headers.authorization || "" } });
      return res.json();
    })) as any,
    (await (async () => {
      const res = await app.inject({ method: "GET", url: "/finance/payouts", headers: { authorization: req.headers.authorization || "" } });
      return res.json();
    })) as any,
    (await (async () => {
      const res = await app.inject({ method: "GET", url: "/finance/transactions", headers: { authorization: req.headers.authorization || "" } });
      return res.json();
    })) as any
  ]);

  return reply.send({
    overview,
    royalties,
    payouts,
    transactions,
    exportedAt: new Date().toISOString()
  });
});

app.get("/finance/payment-rails", { preHandler: requireAuth }, async (_req: any, reply: any) => {
  const [lnd, onchain] = await Promise.all([lndHealthCheck(), bitcoindHealthCheck()]);

  const rails: any[] = [];
  rails.push({
    id: "lightning",
    type: "lightning",
    label: "Lightning",
    status: lnd.status,
    endpoint: lnd.endpoint || null,
    details: lnd.message || null,
    hint: lnd.hint || null,
    lastCheckedAt: new Date().toISOString()
  });
  rails.push({
    id: "onchain",
    type: "onchain",
    label: "BTC On-chain",
    status: onchain.status,
    endpoint: onchain.endpoint || null,
    details: onchain.message || null,
    hint: onchain.hint || null,
    lastCheckedAt: new Date().toISOString()
  });

  if (process.env.LNURL_PAY_URL) {
    rails.push({
      id: "lnurl",
      type: "lnurl",
      label: "LNURL-Pay",
      status: "degraded",
      endpoint: process.env.LNURL_PAY_URL,
      details: "Configured",
      lastCheckedAt: new Date().toISOString()
    });
  }

  return reply.send(rails);
});

app.post("/finance/payment-rails/:id/test_connection", { preHandler: requireAuth }, async (req: any, reply: any) => {
  const id = asString((req.params as any).id);
  if (id === "lightning") {
    const res = await lndHealthCheck();
    return reply.send({ ok: res.status === "healthy", status: res.status, message: res.message, endpoint: res.endpoint, hint: res.hint || null });
  }
  if (id === "onchain") {
    const res = await bitcoindHealthCheck();
    return reply.send({ ok: res.status === "healthy", status: res.status, message: res.message, endpoint: res.endpoint, hint: res.hint || null });
  }
  return reply.code(404).send({ error: "Unknown rail" });
});

app.get("/api/payments/intents/:id", { preHandler: optionalAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser | undefined)?.sub || null;
  const id = asString((req.params as any).id || "").trim();
  if (!id) return badRequest(reply, "id required");

  const intent = await prisma.paymentIntent.findUnique({ where: { id } });
  if (!intent) return notFound(reply, "PaymentIntent not found");

  if (userId && intent.buyerUserId !== userId) {
    const content = await prisma.contentItem.findUnique({ where: { id: intent.contentId } });
    if (!content || content.ownerUserId !== userId) return forbidden(reply);
  }
  if (!userId) {
    const content = await prisma.contentItem.findUnique({ where: { id: intent.contentId } });
    if (!content || content.storefrontStatus === "DISABLED") return notFound(reply, "Not found");
  }

  return reply.send({
    id: intent.id,
    status: intent.status,
    paidVia: intent.paidVia,
    amountSats: intent.amountSats.toString(),
    purpose: intent.purpose,
    subjectType: intent.subjectType,
    subjectId: intent.subjectId,
    manifestSha256: intent.manifestSha256,
    paidAt: intent.paidAt ? intent.paidAt.toISOString() : null,
    onchain: intent.onchainAddress
      ? {
          address: intent.onchainAddress,
          txid: intent.onchainTxid,
          vout: intent.onchainVout,
          confirmations: intent.confirmations
        }
      : null,
    lightning: intent.bolt11
      ? { bolt11: intent.bolt11, expiresAt: intent.lightningExpiresAt ? intent.lightningExpiresAt.toISOString() : null }
      : null
  });
});

app.post("/api/payments/intents/:id/refresh", { preHandler: optionalAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser | undefined)?.sub || null;
  const id = asString((req.params as any).id || "").trim();
  if (!id) return badRequest(reply, "id required");

  const intent = await prisma.paymentIntent.findUnique({ where: { id } });
  if (!intent) return notFound(reply, "PaymentIntent not found");

  if (userId && intent.buyerUserId !== userId) {
    const content = await prisma.contentItem.findUnique({ where: { id: intent.contentId } });
    if (!content || content.ownerUserId !== userId) return forbidden(reply);
  }
  if (!userId) {
    const content = await prisma.contentItem.findUnique({ where: { id: intent.contentId } });
    if (!content || content.storefrontStatus === "DISABLED") return notFound(reply, "Not found");
  }

  if (intent.status === "paid") {
    try {
      await finalizePurchase(intent.id, prisma);
    } catch {}
    const updated = await prisma.paymentIntent.findUnique({ where: { id: intent.id } });
    return reply.send({
      ok: true,
      status: intent.status,
      paidAt: intent.paidAt?.toISOString() || null,
      receiptToken: updated?.receiptToken || null,
      receiptTokenExpiresAt: updated?.receiptTokenExpiresAt ? updated.receiptTokenExpiresAt.toISOString() : null
    });
  }

  let paidVia: "lightning" | "onchain" | null = null;
  let paidAt: string | null = null;
  let onchainUpdate: { txid?: string | null; vout?: number | null; confirmations?: number | null } = {};

  if (intent.providerId) {
    try {
      const res = await checkLightningInvoice(intent.providerId);
      if (res.paid) {
        paidVia = "lightning";
        paidAt = res.paidAt || new Date().toISOString();
      }
    } catch (e: any) {
      return reply.code(400).send({ error: String(e?.message || e) });
    }
  }

  if (!paidVia && intent.onchainAddress) {
    try {
      const res = await checkOnchainPayment(intent.onchainAddress, intent.amountSats, ONCHAIN_MIN_CONFS);
      if (res.paid) {
        paidVia = "onchain";
        paidAt = new Date().toISOString();
        onchainUpdate = { txid: res.txid || null, vout: res.vout ?? null, confirmations: res.confirmations ?? ONCHAIN_MIN_CONFS };
      } else if (res.confirmations !== undefined) {
        onchainUpdate = { confirmations: res.confirmations };
      }
    } catch (e: any) {
      return reply.code(400).send({ error: String(e?.message || e) });
    }
  }

  if (paidVia) {
    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: "paid" as any,
        paidVia: paidVia as any,
        paidAt: paidAt ? new Date(paidAt) : new Date(),
        onchainTxid: onchainUpdate.txid ?? intent.onchainTxid,
        onchainVout: onchainUpdate.vout ?? intent.onchainVout,
        confirmations: onchainUpdate.confirmations ?? intent.confirmations
      }
    });

    try {
      await finalizePurchase(intent.id, prisma);
    } catch {}

    const updated = await prisma.paymentIntent.findUnique({ where: { id: intent.id } });
    return reply.send({
      ok: true,
      status: "paid",
      paidVia,
      paidAt,
      receiptToken: updated?.receiptToken || null,
      receiptTokenExpiresAt: updated?.receiptTokenExpiresAt ? updated.receiptTokenExpiresAt.toISOString() : null
    });
  }

  if (onchainUpdate.confirmations !== undefined) {
    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { confirmations: onchainUpdate.confirmations ?? intent.confirmations }
    });
  }

  return reply.send({ ok: true, status: intent.status, paidVia: intent.paidVia, confirmations: onchainUpdate.confirmations ?? intent.confirmations });
});

/**
 * DEV helpers (no auth)
 */
if (process.env.NODE_ENV !== "production") {
  app.post("/api/dev/simulate-pay", async (req: any, reply) => {
    if (process.env.DEV_ALLOW_SIMULATE_PAYMENTS !== "1") {
      return forbidden(reply);
    }

    const body = (req.body ?? {}) as { paymentIntentId?: string; paidVia?: string };
    const paymentIntentId = asString(body.paymentIntentId || "").trim();
    const paidViaRaw = asString(body.paidVia || "").trim().toLowerCase();
    if (!paymentIntentId) return badRequest(reply, "paymentIntentId required");
    if (!["onchain", "lightning", "on-chain", "ln", "lnbits"].includes(paidViaRaw)) {
      return badRequest(reply, "paidVia must be ONCHAIN or LIGHTNING");
    }

    const intent = await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });
    if (!intent) return notFound(reply, "PaymentIntent not found");

    const beforeSettlement = await prisma.settlement.findUnique({ where: { paymentIntentId } });
    const beforeEntitlement = await prisma.entitlement.findFirst({ where: { paymentIntentId } });

    const paidVia = paidViaRaw.startsWith("on") ? "onchain" : "lightning";
    await prisma.paymentIntent.update({
      where: { id: paymentIntentId },
      data: {
        status: "paid" as any,
        paidVia: paidVia as any,
        paidAt: new Date(),
        confirmations: paidVia === "onchain" ? ONCHAIN_MIN_CONFS : intent.confirmations,
        onchainTxid: paidVia === "onchain" ? intent.onchainTxid || crypto.randomUUID().replace(/-/g, "") : intent.onchainTxid,
        onchainVout: paidVia === "onchain" ? intent.onchainVout ?? 0 : intent.onchainVout
      }
    });

    await finalizePurchase(paymentIntentId, prisma);

    const afterSettlement = await prisma.settlement.findUnique({ where: { paymentIntentId } });
    const afterEntitlement = await prisma.entitlement.findFirst({ where: { paymentIntentId } });
    const updatedIntent = await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });

    return reply.send({
      ok: true,
      entitlementCreated: !beforeEntitlement && Boolean(afterEntitlement),
      settlementCreated: !beforeSettlement && Boolean(afterSettlement),
      receiptToken: updatedIntent?.receiptToken || null
    });
  });

  app.get("/api/dev/sample-content", async (req: any, reply) => {
    if (process.env.DEV_ALLOW_SIMULATE_PAYMENTS !== "1") {
      return forbidden(reply);
    }

    const content = await prisma.contentItem.findFirst({
      where: { status: "published", manifestId: { not: null }, storefrontStatus: { not: "DISABLED" as any } },
      orderBy: { createdAt: "desc" }
    });
    if (!content) return notFound(reply, "No published content with manifest");

    const manifest = await prisma.manifest.findUnique({ where: { contentId: content.id } });
    if (!manifest) return notFound(reply, "Manifest not found");

    return reply.send({
      contentId: content.id,
      manifestSha256: manifest.sha256,
      priceSats: null
    });
  });
}

app.post("/api/payment-intents", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const body = (req.body ?? {}) as {
    contentId?: string;
    manifestSha256?: string;
    amountSats?: any;
    paidVia?: string;
    bolt11?: string;
    providerId?: string;
    onchainAddress?: string;
  };

  const contentId = asString(body.contentId).trim();
  const manifestSha256 = asString(body.manifestSha256).trim();
  const amountSats = BigInt(Math.max(0, Math.floor(num(body.amountSats))));
  const paidVia = asString(body.paidVia || "lightning").trim().toLowerCase();

  if (!contentId || !manifestSha256) return badRequest(reply, "contentId and manifestSha256 required");
  if (amountSats <= 0n) return badRequest(reply, "amountSats must be > 0");
  if (!["lightning", "onchain"].includes(paidVia)) return badRequest(reply, "paidVia must be lightning|onchain");

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");

  const intent = await prisma.paymentIntent.create({
    data: {
      buyerUserId: userId,
      contentId,
      manifestSha256,
      amountSats,
      status: "pending" as any,
      purpose: "CONTENT_PURCHASE" as any,
      subjectType: "CONTENT" as any,
      subjectId: contentId,
      paidVia: paidVia as any,
      bolt11: paidVia === "lightning" ? asString(body.bolt11 || "") || null : null,
      providerId: paidVia === "lightning" ? asString(body.providerId || "") || null : null,
      onchainAddress: paidVia === "onchain" ? asString(body.onchainAddress || "") || null : null
    }
  });

  return reply.send({ ok: true, paymentIntentId: intent.id });
});

app.post("/api/payment-intents/:id/mark-paid", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const id = asString((req.params as any).id);
  const body = (req.body ?? {}) as { onchainTxid?: string; onchainVout?: number; confirmations?: number };

  const intent = await prisma.paymentIntent.findUnique({ where: { id } });
  if (!intent) return notFound(reply, "PaymentIntent not found");

  const content = await prisma.contentItem.findUnique({ where: { id: intent.contentId } });
  if (!content || content.ownerUserId !== userId) return forbidden(reply);

  await prisma.paymentIntent.update({
    where: { id },
    data: {
      status: "paid" as any,
      paidAt: new Date(),
      onchainTxid: body.onchainTxid ? asString(body.onchainTxid) : intent.onchainTxid,
      onchainVout: Number.isFinite(Number(body.onchainVout)) ? Math.floor(Number(body.onchainVout)) : intent.onchainVout,
      confirmations: Number.isFinite(Number(body.confirmations)) ? Math.floor(Number(body.confirmations)) : intent.confirmations
    }
  });

  try {
    const settlement = await settlePaymentIntent(id);
    return reply.send({ ok: true, settlementId: settlement.id });
  } catch (e: any) {
    const status = Number(e?.statusCode) || 500;
    const code = e?.code ? String(e.code) : undefined;
    const message = String(e?.message || e);
    return reply.code(status).send(code ? { code, message } : { error: message });
  }
});

// Lock a split version by content + version number (owner only)
app.post("/content/:id/splits/:version/lock", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);
  const versionParam = asString((req.params as any).version);
  const versionNumber = parseSplitVersionParam(versionParam);
  if (!versionNumber) return badRequest(reply, "Invalid split version");

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);
  if (!content.repoPath) return reply.code(500).send({ error: "Content repo not initialized" });

  const sv = await prisma.splitVersion.findFirst({
    where: { contentId, versionNumber },
    include: { content: true, participants: { orderBy: { createdAt: "asc" } } }
  });
  if (!sv) return notFound(reply, "Split version not found");
  if (sv.status !== "draft") return badRequest(reply, "Split version already locked");
  if (!sv.participants?.length) return badRequest(reply, "Split version has no participants");

  const now = new Date();
  let proofResult: any;
  try {
    proofResult = await buildAndPersistProof({
      repoPath: content.repoPath,
      contentId,
      splitVersionId: sv.id,
      versionNumber: sv.versionNumber,
      lockedAt: now,
      participants: sv.participants,
      creatorId: userId
    });
  } catch (e: any) {
    return reply.code(500).send({ error: String(e?.message || e) });
  }

  await prisma.splitVersion.update({
    where: { id: sv.id },
    data: {
      status: "locked",
      lockedAt: now,
      lockedFileObjectKey: proofResult.lockedFileObjectKey || null,
      lockedFileSha256: proofResult.lockedFileSha256 || null
    }
  });

  await prisma.auditEvent.create({
    data: {
      userId,
      action: "split.lock",
      entityType: "SplitVersion",
      entityId: sv.id,
      payloadJson: {
        lockedAt: now,
        proofHash: proofResult.proofHash,
        manifestHash: proofResult.manifestHash,
        splitsHash: proofResult.splitsHash,
        proofPath: proofRelPath(sv.versionNumber)
      } as any
    }
  });

  try {
    await prisma.auditEvent.create({
      data: {
        userId,
        action: "content.proof",
        entityType: "ContentItem",
        entityId: contentId,
        payloadJson: {
          lockedAt: now,
          proofHash: proofResult.proofHash,
          manifestHash: proofResult.manifestHash,
          splitsHash: proofResult.splitsHash,
          splitVersion: sv.versionNumber
        } as any
      }
    });
  } catch {}

  return reply.send({
    ok: true,
    proofHash: proofResult.proofHash,
    manifestHash: proofResult.manifestHash,
    splitsHash: proofResult.splitsHash
  });
});

// Fetch proof.json for a split version (owner only)
app.get("/content/:id/splits/:version/proof", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const contentId = asString((req.params as any).id);
  const versionParam = asString((req.params as any).version);
  const versionNumber = parseSplitVersionParam(versionParam);
  if (!versionNumber) return badRequest(reply, "Invalid split version");

  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  if (!content) return notFound(reply, "Content not found");
  if (content.ownerUserId !== userId) return forbidden(reply);
  if (!content.repoPath) return reply.code(500).send({ error: "Content repo not initialized" });

  const abs = proofAbsPath(content.repoPath, versionNumber);
  if (!fsSync.existsSync(abs)) return notFound(reply, "Proof not found");

  try {
    const raw = await fs.readFile(abs, "utf8");
    const json = JSON.parse(raw);
    return reply.send(json);
  } catch (e: any) {
    return reply.code(500).send({ error: String(e?.message || e) });
  }
});

/**
 * INVITE SYSTEM
 */
app.post("/split-versions/:id/invite", { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = (req.user as JwtUser).sub;
  const splitVersionId = (req.params as any).id as string;

  const ttlHoursIn = num((req.body as Record<string, unknown>).ttlHours ?? 168);
  const ttlHours = Math.max(1, Math.min(24 * 30, ttlHoursIn));
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  const split = await prisma.splitVersion.findUnique({
    where: { id: splitVersionId },
    include: {
      content: true,
      participants: { orderBy: { createdAt: "asc" } }
    }
  });
  if (!split) return notFound(reply, "Split version not found");
  if (split.content.ownerUserId !== userId) return forbidden(reply);

  const pending = split.participants.filter((p) => !p.acceptedAt);

  const createdInvites: Array<{
    participantEmail: string;
    splitParticipantId: string;
    token: string;
    expiresAt: Date;
    inviteUrl: string;
  }> = [];

  await prisma.$transaction(async (tx) => {
    for (const p of pending) {
      const token = makeInviteToken();
      const tokenHash = hashInviteToken(token);

      const createdInv = await tx.invitation.create({
        data: {
          splitParticipantId: p.id,
          tokenHash,
          expiresAt
        }
      });

      await tx.auditEvent.create({
        data: {
          userId,
          action: "invite.create",
          entityType: "Invitation",
          entityId: createdInv.id,
          payloadJson: {
            splitParticipantId: p.id,
            participantEmail: p.participantEmail,
            splitVersionId: splitVersionId,
            contentId: split.contentId,
            expiresAt
          } as any
        }
      });

    const inviteBase =
      String(process.env.PUBLIC_INVITE_ORIGIN || process.env.PUBLIC_BASE_ORIGIN || "").trim() ||
      (getActivePublicOrigin() || APP_BASE_URL);

      createdInvites.push({
        participantEmail: String(p.participantEmail || ""),
        splitParticipantId: p.id,
        token,
        expiresAt,
        inviteUrl: `${inviteBase.replace(/\/$/, "")}/invite/${token}`
      });
    }

    await tx.auditEvent.create({
      data: {
        userId,
        action: "invite.create",
        entityType: "SplitVersion",
        entityId: splitVersionId,
        payloadJson: { contentId: split.contentId, pendingCount: pending.length, expiresAt } as any
      }
    });
  });

  return reply.send({ ok: true, created: createdInvites.length, invites: createdInvites });
});

/**
 * Public invite lookup by token (frontend uses this to show invite details)
 */
app.get("/invites/:token", async (req: any, reply) => {
  const token = asString((req.params as any).token);
  if (!token) return notFound(reply, "Invite not found");

  const tokenHash = hashInviteToken(token);

  const inv = await prisma.invitation.findFirst({
    where: { tokenHash },
    include: {
      splitParticipant: {
        include: { payoutIdentity: true, splitVersion: { include: { content: true, participants: true } } }
      }
    }
  });

  if (!inv) return notFound(reply, "Invite not found");

  const invitation = {
    id: inv.id,
    expiresAt: inv.expiresAt.toISOString(),
    acceptedAt: inv.acceptedAt ? inv.acceptedAt.toISOString() : null
  } as const;

  const sp = inv.splitParticipant;

  const splitParticipant = {
    id: sp.id,
    participantEmail: sp.participantEmail,
    role: sp.role,
    percent: percentToPrimitive(sp.percent),
    payoutIdentityId: sp.payoutIdentityId,
    acceptedAt: sp.acceptedAt ? sp.acceptedAt.toISOString() : null
  } as const;

  const sv = sp.splitVersion;

  const splitVersion = {
    id: sv.id,
    contentId: sv.contentId,
    versionNumber: sv.versionNumber,
    status: sv.status,
    lockedAt: sv.lockedAt ? sv.lockedAt.toISOString() : null,
    lockedFileObjectKey: sv.lockedFileObjectKey || null,
    lockedFileSha256: sv.lockedFileSha256 || null,
    createdAt: sv.createdAt.toISOString(),
    participants: (sv.participants || []).map((p) => ({
      ...p,
      percent: percentToPrimitive(p.percent)
    }))
  } as const;

  const content = sv.content
    ? {
        id: sv.content.id,
        title: sv.content.title,
        type: sv.content.type,
        status: sv.content.status,
        createdAt: sv.content.createdAt.toISOString()
      }
    : null;

  // Additionally, include a list of related invites for this split version
  // (without exposing token values). This helps public invite pages show
  // the set of invites created for the split even when the viewer isn't
  // authenticated.
  let relatedInvites: any[] = [];
  try {
    const svId = inv.splitParticipant?.splitVersionId || null;
    if (svId) {
      const ris = await prisma.invitation.findMany({
        where: { splitParticipant: { splitVersionId: svId } },
        include: { splitParticipant: true },
        orderBy: { createdAt: "desc" }
      });
      relatedInvites = ris.map((r) => ({
        id: r.id,
        splitParticipantId: r.splitParticipantId,
        participantEmail: r.splitParticipant?.participantEmail || null,
        expiresAt: r.expiresAt.toISOString(),
        acceptedAt: r.acceptedAt ? r.acceptedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString()
      }));
    }
  } catch {
    relatedInvites = [];
  }

  return reply.send({ ok: true, invitation, splitParticipant, splitVersion, content, invites: relatedInvites });
});

/**
 * Public invite page (simple HTML) so remote users can accept.
 */
app.get("/invite/:token", async (req: any, reply: any) => {
  const token = asString((req.params as any).token);
  if (!token) return notFound(reply, "Invite not found");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Split Invite</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin:0; background:#0b0b0b; color:#f4f4f5; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 24px; }
    .card { background:#111; border:1px solid #222; border-radius:16px; padding:20px; }
    .muted { color:#a1a1aa; font-size:14px; }
    .btn { background:#fff; color:#000; border:none; border-radius:10px; padding:10px 14px; font-weight:600; cursor:pointer; }
    .btn:disabled { opacity:0.6; cursor:not-allowed; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div id="app">Loading…</div>
    </div>
  </div>
<script>
(function(){
  const token = ${JSON.stringify(token)};
  const app = document.getElementById("app");
  const apiBase = location.origin;

  async function fetchJson(path, opts){
    const res = await fetch(apiBase + path, { method: opts?.method || "GET", headers: { "Content-Type":"application/json" }, body: opts?.body ? JSON.stringify(opts.body) : undefined });
    const data = await res.json().catch(()=>null);
    if (!res.ok) throw new Error((data && (data.error || data.message)) || "Request failed");
    return data;
  }

  function render(inv){
    const c = inv?.content || {};
    const sp = inv?.splitParticipant || {};
    app.innerHTML = \`
      <div style="font-size:22px;font-weight:700;">You’ve been invited to a split</div>
      <div class="muted" style="margin-top:6px;">Content: \${c.title || "Unknown"} (\${c.type || "content"})</div>
      <div class="muted" style="margin-top:4px;">Role: \${sp.role || "participant"} • Share: \${sp.percent || "?"}%</div>
      <button id="acceptBtn" class="btn" style="margin-top:14px;">Accept invite</button>
      <div id="status" class="muted" style="margin-top:8px;"></div>
      <div class="muted" style="margin-top:10px;">Tip: If you want this invite tied to your account, sign in on your own ContentBox first and open this link in the same browser.</div>
    \`;
    document.getElementById("acceptBtn").onclick = async () => {
      document.getElementById("status").textContent = "Accepting…";
      try {
        let authHeader: Record<string, string> = {};
        try {
          const t = localStorage.getItem("contentbox.token");
          if (t) authHeader = { Authorization: "Bearer " + t };
        } catch {}
        const resp = await fetchJson("/invites/" + encodeURIComponent(token) + "/accept", {
          method:"POST",
          body:{},
          headers: authHeader
        });
        if (resp?.alreadyAccepted) {
          document.getElementById("status").textContent = "Already accepted.";
        } else {
          document.getElementById("status").textContent = "Accepted. You’re in the split.";
        }
      } catch (e) {
        document.getElementById("status").textContent = e && e.message ? e.message : "Could not accept invite.";
      }
    };
  }

  fetchJson("/invites/" + encodeURIComponent(token))
    .then(render)
    .catch(err => { app.textContent = err && err.message ? err.message : "Invite not found."; });
})();
</script>
</body>
</html>`;

  reply.type("text/html; charset=utf-8");
  return reply.send(html);
});

/**
 * Accept an invite token. If the requester is authenticated, associate the
 * SplitParticipant.participantUserId with the authenticated user.
 */
app.post("/invites/:token/accept", async (req: any, reply) => {
  const token = asString((req.params as any).token);
  if (!token) return notFound(reply, "Invite not found");

  // Optional auth: bind participation to the local user if Authorization header is present
  let userId: string | undefined;
  try {
    await req.jwtVerify();
    userId = (req.user as JwtUser)?.sub;
  } catch {
    userId = undefined;
  }

  const tokenHash = hashInviteToken(token);

  const inv = await prisma.invitation.findFirst({
    where: { tokenHash },
    include: { splitParticipant: { include: { splitVersion: { include: { content: true } } } } }
  });

  if (!inv) return notFound(reply, "Invite not found");

  const now = new Date();
  if (inv.expiresAt.getTime() < Date.now()) {
    try {
      const ownerId = inv.splitParticipant?.splitVersion?.content?.ownerUserId || "";
      if (ownerId) {
        const prior = await prisma.auditEvent.findFirst({
          where: { entityType: "Invitation", entityId: inv.id, action: "invite.expire" }
        });
        if (!prior) {
          await prisma.auditEvent.create({
            data: {
              userId: ownerId,
              action: "invite.expire",
              entityType: "Invitation",
              entityId: inv.id,
              payloadJson: { expiresAt: inv.expiresAt } as any
            }
          });
        }
      }
    } catch {}
    return badRequest(reply, "Invite expired");
  }

  if (inv.acceptedAt) {
    return reply.send({ ok: true, acceptedAt: inv.acceptedAt.toISOString(), alreadyAccepted: true });
  }

  // If the requester is authenticated, we'll link the participant to that user

  // Optional P2P acceptance info supplied by a remote node
  const remoteNodeUrl = asString((req.body ?? {})?.remoteNodeUrl || "").replace(/\/$/, "");
  const remoteUserId = asString((req.body ?? {})?.remoteUserId || "").trim();
  const signature = asString((req.body ?? {})?.signature || "");
  const payload = (req.body ?? {})?.payload ?? null;

  // If remote info is provided, try to verify the remote node and user exist.
  // Prefer verifying a provided signature + payload (stronger). If not provided, fall back to simple public user check.
  let remoteVerified = false;
  if (remoteNodeUrl && remoteUserId) {
    try {
      // Fetch discovery info from remote node
      const disco = await fetch(`${remoteNodeUrl.replace(/\/$/, "")}/.well-known/contentbox`, { method: "GET", headers: { "Accept": "application/json" } as any } as any);
      let remotePub: string | null = null;
      if (disco && disco.ok) {
        try {
          const j: any = await disco.json();
          remotePub = j?.publicKeyPem || null;
        } catch {
          remotePub = null;
        }
      }

      // If signature+payload provided, validate signature
      if (signature && payload && remotePub) {
        try {
          const payloadStr = JSON.stringify(payload);
          // basic payload checks
          if (String(payload.token) === token && String(payload.remoteUserId) === remoteUserId && String(payload.nodeUrl).replace(/\/$/, "") === remoteNodeUrl) {
            // check timestamp (allow 15m skew)
            const ts = Date.parse(String(payload.ts || ""));
            const okTs = Number.isFinite(ts) && Math.abs(Date.now() - ts) < 15 * 60 * 1000;
            if (okTs) {
              const sigBuf = Buffer.from(signature, "base64");
              try {
                const verified = (crypto.verify as any)(null, Buffer.from(payloadStr), remotePub, sigBuf) as boolean;
                if (verified) remoteVerified = true;
              } catch {
                remoteVerified = false;
              }
            }
          }
        } catch {
          remoteVerified = false;
        }
      }

      // fallback: simple public user check
      if (!remoteVerified) {
        const pu = await fetch(`${remoteNodeUrl.replace(/\/$/, "")}/public/users/${encodeURIComponent(remoteUserId)}`, { method: "GET", headers: { "Accept": "application/json" } as any } as any);
        if (pu && pu.ok) {
          const json: any = await pu.json();
          if (json && String(json.id) === remoteUserId) remoteVerified = true;
        }
      }
    } catch {
      remoteVerified = false;
    }
  }

  // Anti-replay: if a signature is provided, ensure it hasn't been seen for this split version
  if (signature && inv.splitParticipant?.splitVersionId) {
    try {
      const prior = await prisma.auditEvent.findMany({ where: { entityType: "SplitVersion", entityId: inv.splitParticipant.splitVersionId } });
      const already = prior.some((e) => { const p: any = e.payloadJson as any; return p && (p.signature === signature || (p.signedPayload && p.signedPayload.signature === signature)); });
      if (already) return reply.code(400).send({ error: "Signature has already been used" });
    } catch {
      // ignore errors and proceed
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: now } });

    const spUpdate: any = { acceptedAt: now };
    if (userId) spUpdate.participantUserId = userId;

    await tx.splitParticipant.update({ where: { id: inv.splitParticipantId }, data: spUpdate });

    // create audit event: include remote node info when provided
    const ownerId = inv.splitParticipant?.splitVersion?.content?.ownerUserId || userId || "";
    await tx.auditEvent.create({
      data: {
        userId: ownerId,
        action: "invite.accept",
        entityType: "SplitVersion",
        entityId: inv.splitParticipant.splitVersionId,
        payloadJson: {
          invitationId: inv.id,
          splitParticipantId: inv.splitParticipantId,
          remoteNodeUrl: remoteNodeUrl || null,
          remoteUserId: remoteUserId || null,
          remoteVerified,
          signature: signature || null,
          signedPayload: payload || null
        } as any
      }
    });

    await tx.auditEvent.create({
      data: {
        userId: ownerId,
        action: "invite.accept",
        entityType: "Invitation",
        entityId: inv.id,
        payloadJson: {
          splitParticipantId: inv.splitParticipantId,
          participantEmail: inv.splitParticipant?.participantEmail || null,
          contentId: inv.splitParticipant?.splitVersion?.contentId || null,
          acceptedAt: now,
          remoteNodeUrl: remoteNodeUrl || null,
          remoteUserId: remoteUserId || null,
          remoteVerified
        } as any
      }
    });
  });

  if (process.env.NODE_ENV !== "production") {
    app.log.info(
      {
        splitParticipantId: inv.splitParticipantId,
        acceptedAt: now.toISOString(),
        participantUserId: userId || null
      },
      "invite.accept"
    );
  }

  return reply.send({ ok: true, acceptedAt: now.toISOString() });
});

/** ---------- boot ---------- */

async function start() {
  await ensureDirWritable(CONTENTBOX_ROOT);
  // Ensure node keypair exists for signed P2P assertions
  async function ensureNodeKeys() {
    const nodeDir = path.join(CONTENTBOX_ROOT, ".node");
    const privPath = path.join(nodeDir, "node_private.pem");
    const pubPath = path.join(nodeDir, "node_public.pem");

    try {
      await fs.mkdir(nodeDir, { recursive: true });
    } catch {}

    if (!fsSync.existsSync(privPath) || !fsSync.existsSync(pubPath)) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
      const privPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
      const pubPem = publicKey.export({ type: "spki", format: "pem" }) as string;
      await fs.writeFile(privPath, privPem, "utf8");
      await fs.writeFile(pubPath, pubPem, "utf8");
    }
  }

  await ensureNodeKeys();
  const port = Number(process.env.PORT || 4000);
  await app.listen({ port, host: "0.0.0.0" });
  const mode = normalizePublicMode(PUBLIC_MODE);
  if (mode !== "off") {
    const host = getPublicBindHost(mode);
    await startPublicServer(registerPublicRoutes, host);
    if (mode === "quick") {
      const consent = getPublicSharingConsent();
      const consentGranted = consent.granted || consent.dontAskAgain;
      if (consentGranted && getPublicSharingAutoStart()) {
        tunnelManager.startQuick().catch(() => {});
      }
    }
  }
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
