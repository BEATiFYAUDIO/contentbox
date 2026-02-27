import http from "node:http";
import https from "node:https";
import type { PrismaClient } from "@prisma/client";
import fsSync from "node:fs";
import { decryptSecret, encryptSecret } from "../lib/cryptoConfig.js";
import { Cooldown, Semaphore, SingleFlight, TTLCache } from "../lib/asyncPrimitives.js";

type PrismaLike = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;

type LightningNodeConfigRow = {
  id: string;
  restUrl: string;
  network: string;
  macaroonCiphertext: string;
  macaroonIv: string;
  macaroonTag: string;
  tlsCertPem: string | null;
  lastTestedAt: Date | string | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RuntimeLndConfig = {
  restUrl: string;
  network: string;
  macaroonHex: string;
  tlsCert?: Buffer | null;
};

export type LightningDiscoveryCandidate = { restUrl: string; requiresTlsCertHint?: boolean; notes?: string };
export type LightningReadiness = {
  ok: true;
  configured: boolean;
  nodeReachable: boolean;
  wallet: { syncedToChain: boolean; syncedToGraph: boolean; blockHeight?: number };
  channels: { count: number };
  receiveReady: boolean;
  hints: string[];
};
export type LightningOpenChannelResult = {
  status: "success";
  channelId: string;
  transactionFee: number;
  estimatedConfirmations: number;
  message: string;
};
export type LightningChannelStatusResult = {
  status: "open" | "pending" | "not_found";
  inboundLiquidity: number;
  outboundLiquidity: number;
  peer: string;
  confirmationStatus: "confirmed" | "awaiting_confirmation" | "unknown";
  receiveReady: boolean;
};

export type LightningChannelsResponse = {
  summary: {
    openChannels: number;
    totalCapacitySat: number;
    totalLocalSat: number;
    totalRemoteSat: number;
    activeCount: number;
    inactiveCount: number;
    pendingOpenCount?: number;
    pendingCloseCount?: number;
  };
  channels: Array<{
    channelPoint: string;
    chanId?: string | null;
    peerPubkey?: string;
    remotePubkey: string;
    peerAlias?: string | null;
    remoteAlias?: string | null;
    capacitySats?: number;
    capacitySat: number;
    localSats?: number;
    localSat: number;
    remoteSats?: number;
    remoteSat: number;
    active: boolean;
    private: boolean;
    initiator?: boolean | null;
  }>;
  pendingChannels?: Array<{
    channelPoint: string;
    peerPubkey: string;
    peerAlias?: string | null;
    capacitySats: number;
    localSats: number;
    remoteSats: number;
    active: boolean;
    pendingType: "opening" | "closing" | "force_closing" | "waiting_close";
  }>;
};

export type LightningBalancesResponse = {
  wallet: {
    confirmedSats: number;
    unconfirmedSats: number;
    totalSats: number;
    reservedAnchorSats: number | null;
  };
  channels: {
    openCount: number;
    pendingOpenCount: number;
    pendingCloseCount: number;
  };
  liquidity: {
    outboundSats: number;
    inboundSats: number;
  };
};

export type LightningInvoiceRow = {
  state: "OPEN" | "SETTLED" | "CANCELED" | "ACCEPTED" | "UNKNOWN";
  valueSats: number;
  amtPaidSats: number;
  creationDate: string;
  settleDate?: string | null;
  memo: string;
  rHashHex: string;
  rHashB64?: string | null;
  bolt11?: string | null;
};

export type LightningNodeConfigStatus = {
  configured: boolean;
  hasTlsCert: boolean;
  hasMacaroon: boolean;
  decryptOk: boolean;
  endpoint: string | null;
  network: string | null;
  lastUpdated: string | null;
  lastTestedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  warnings: string[];
};

export type LightningPeerSuggestion = {
  pubkey: string;
  alias?: string;
  hostPort: string;
  score: number;
  reachableNow: boolean;
  reason?: string;
};

type GraphCandidate = {
  pubkey: string;
  alias?: string;
  hostPort: string;
  score: number;
  source: "graph";
};

type SuggestionResult = {
  peers: LightningPeerSuggestion[];
  meta: { cachedGraph: boolean; probed: number };
};

const TRUSTED_PEER_MIN_FUNDING_SATS: Record<string, number> = {
  // LNBIG (example/placeholder in UI starter list)
  "03d0674b16c5b333c65fbc0146d6f0b58a5b0f3f31b17f4f0de5f2f1f4f7d8b9aa": 200_000,
  // LightningPool (example/placeholder in UI starter list)
  "02aa0d36e56f9c2f4f2b1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcd12": 200_000,
  // ACINQ
  "03864ef025fde8fb587d989186ce6a4a186895ee44a926bfc370e2c366597a3f8f": 400_000
};

const GRAPH_CACHE_TTL_MS = 15 * 60 * 1000;
const GRAPH_STALE_TTL_MS = 60 * 60 * 1000;
const PROBE_CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_GRAPH_CANDIDATES = 500;

const graphFreshCache = new TTLCache<string, GraphCandidate[]>();
const graphStaleCache = new TTLCache<string, GraphCandidate[]>();
const graphSingleFlight = new SingleFlight();
const aliasCache = new TTLCache<string, string | null>();
const aliasSingleFlight = new SingleFlight();
const aliasSemaphore = new Semaphore(4);
const probeSuccessCache = new TTLCache<string, { reachableNow: boolean; reason?: string }>();
const probeSingleFlight = new SingleFlight();
const ensureConnectSingleFlight = new SingleFlight();
const openChannelSingleFlight = new SingleFlight();
const probeSemaphore = new Semaphore(4);
const connectSemaphore = new Semaphore(2);
const probeCooldown = new Cooldown();
const connectCooldown = new Cooldown();
const invoiceLifecycleSingleFlight = new SingleFlight();

function stripTrailingSlash(s: string) {
  return s.replace(/\/+$/, "");
}

function normalizeRestUrl(s: string) {
  const raw = String(s || "").trim();
  if (!raw) throw new Error("restUrl required");
  const url = new URL(raw);
  if (!/^https?:$/i.test(url.protocol)) throw new Error("LND REST URL must be http/https");
  if (String(url.port || "") === "10009") {
    throw new Error("Port 10009 is usually LND gRPC, not REST. Use the REST port (often 8080).");
  }
  return stripTrailingSlash(url.toString());
}

function normalizeMacaroonHex(value: string, codeIfInvalid = "NODE_MACAROON_INVALID_FORMAT"): string {
  const v = String(value || "").trim();
  if (!v) throw new Error("NODE_MACAROON_MISSING");
  if (!/^[0-9a-fA-F]+$/.test(v)) throw new Error(codeIfInvalid);
  if (v.length % 2 !== 0) throw new Error(codeIfInvalid);
  if (v.length < 100) throw new Error(codeIfInvalid);
  return v.toUpperCase();
}

function isValidCompressedPubkey(pubkey: string): boolean {
  return /^(02|03)[0-9a-fA-F]{64}$/.test(String(pubkey || "").trim());
}

function parseHostPort(hostPortRaw: string): { host: string; port: number; normalized: string } | null {
  const s = String(hostPortRaw || "").trim();
  if (!s) return null;
  if (s.includes("://") || s.includes("/") || /\s/.test(s)) return null;
  const idx = s.lastIndexOf(":");
  if (idx <= 0 || idx === s.length - 1) return null;
  const host = s.slice(0, idx).trim();
  const portStr = s.slice(idx + 1).trim();
  if (!host || !/^\d{1,5}$/.test(portStr)) return null;
  const port = Number(portStr);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  return { host, port, normalized: `${host}:${port}` };
}

function dateToIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

async function readLightningNodeConfigRow(prisma: PrismaLike): Promise<LightningNodeConfigRow | null> {
  const rows = await prisma.$queryRaw<LightningNodeConfigRow[]>`
    SELECT
      "id",
      "restUrl",
      "network",
      "macaroonCiphertext",
      "macaroonIv",
      "macaroonTag",
      "tlsCertPem",
      "lastTestedAt",
      "lastStatus",
      "lastError",
      "createdAt",
      "updatedAt"
    FROM "LightningNodeConfig"
    WHERE "id" = 'singleton'
    LIMIT 1
  `;
  return rows[0] || null;
}

async function upsertLightningNodeConfigRow(
  prisma: PrismaLike,
  data: {
    restUrl: string;
    network: string;
    macaroonCiphertext: string;
    macaroonIv: string;
    macaroonTag: string;
    tlsCertPem: string | null;
    lastStatus: string | null;
    lastError: string | null;
    lastTestedAt: Date | null;
  }
) {
  const now = new Date();
  await prisma.$executeRaw`
    INSERT INTO "LightningNodeConfig" (
      "id",
      "restUrl",
      "network",
      "macaroonCiphertext",
      "macaroonIv",
      "macaroonTag",
      "tlsCertPem",
      "lastTestedAt",
      "lastStatus",
      "lastError",
      "createdAt",
      "updatedAt"
    ) VALUES (
      'singleton',
      ${data.restUrl},
      ${data.network},
      ${data.macaroonCiphertext},
      ${data.macaroonIv},
      ${data.macaroonTag},
      ${data.tlsCertPem},
      ${data.lastTestedAt},
      ${data.lastStatus},
      ${data.lastError},
      ${now},
      ${now}
    )
    ON CONFLICT ("id")
    DO UPDATE SET
      "restUrl" = EXCLUDED."restUrl",
      "network" = EXCLUDED."network",
      "macaroonCiphertext" = EXCLUDED."macaroonCiphertext",
      "macaroonIv" = EXCLUDED."macaroonIv",
      "macaroonTag" = EXCLUDED."macaroonTag",
      "tlsCertPem" = EXCLUDED."tlsCertPem",
      "lastTestedAt" = EXCLUDED."lastTestedAt",
      "lastStatus" = EXCLUDED."lastStatus",
      "lastError" = EXCLUDED."lastError",
      "updatedAt" = ${now}
  `;
}

function parseMacaroonBase64ToHex(macaroonBase64: string): string {
  const raw = String(macaroonBase64 || "").trim();
  if (!raw) throw new Error("macaroonBase64 required");
  const buf = Buffer.from(raw, "base64");
  if (!buf.length) throw new Error("Invalid macaroonBase64");
  return normalizeMacaroonHex(buf.toString("hex"));
}

function readPemMaybeFile(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.includes("BEGIN")) return trimmed;
  try {
    if (fsSync.existsSync(trimmed)) return fsSync.readFileSync(trimmed, "utf8");
  } catch {}
  return trimmed;
}

function normalizeTlsCertPem(value?: string | null): string | null {
  const s = String(value || "").replace(/^\uFEFF/, "").trim();
  if (!s) return null;
  if (!s.includes("BEGIN CERTIFICATE")) throw new Error("tlsCertPem must be a PEM certificate");
  return s.replace(/\r\n/g, "\n");
}

function getLegacyEnvLndConfig(): RuntimeLndConfig | null {
  const restUrl = process.env.LND_REST_URL;
  const invoiceMacB64 =
    process.env.LND_INVOICE_MACAROON_B64 ||
    process.env.LND_MACAROON_B64 ||
    "";
  const invoiceMacHex = String(process.env.LND_MACAROON_HEX || process.env.LND_MACAROON || "").trim();
  if (!restUrl || (!invoiceMacB64 && !invoiceMacHex)) return null;
  const tlsCertPem = readPemMaybeFile(process.env.LND_TLS_CERT_PATH || process.env.LND_TLS_CERT_PEM || "");
  return {
    restUrl: stripTrailingSlash(restUrl),
    network: "mainnet",
    macaroonHex: invoiceMacHex ? normalizeMacaroonHex(invoiceMacHex) : normalizeMacaroonHex(Buffer.from(invoiceMacB64, "base64").toString("hex")),
    tlsCert: tlsCertPem ? Buffer.from(tlsCertPem, "utf8") : null
  };
}

async function lndRestJson(
  cfg: RuntimeLndConfig | null,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
) {
  if (!cfg) throw new Error("LND not configured");
  const u = new URL(`${cfg.restUrl}${path}`);
  if (u.protocol !== "https:") {
    throw new Error("LND REST must use HTTPS. Check protocol and use the LND REST port (often 8080).");
  }
  if (!cfg.tlsCert || !Buffer.from(cfg.tlsCert).length) {
    throw new Error("LND TLS cert missing. Upload tls.cert (PEM) in the Lightning setup wizard.");
  }
  const tlsCert = Buffer.from(cfg.tlsCert);
  const macaroonHex = normalizeMacaroonHex(cfg.macaroonHex, "NODE_MACAROON_INVALID_FORMAT");
  const bodyStr = body === undefined ? undefined : JSON.stringify(body);

  const reqHeaders: Record<string, string> = {
    Accept: "application/json",
    Connection: "close",
    "Grpc-Metadata-macaroon": macaroonHex,
    ...extraHeaders
  };
  if (bodyStr !== undefined) reqHeaders["Content-Type"] = reqHeaders["Content-Type"] || "application/json";
  if (bodyStr !== undefined) reqHeaders["Content-Length"] = String(Buffer.byteLength(bodyStr));

  try {
    console.info("[lndRestJson]", {
      path,
      urlHost: u.hostname,
      urlPort: u.port || "443",
      macaroonLen: macaroonHex.length,
      tlsLen: cfg.tlsCert ? Buffer.byteLength(cfg.tlsCert) : 0
    });
  } catch {}

  const res = await new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; text: string }>((resolve, reject) => {
    const req = https.request(
      {
        protocol: "https:",
        hostname: u.hostname,
        port: Number(u.port || 443),
        path: `${u.pathname}${u.search || ""}`,
        method: method.toUpperCase(),
        headers: reqHeaders,
        agent: false,
        ca: tlsCert,
        ALPNProtocols: ["http/1.1"],
        rejectUnauthorized: true
      },
      (resp) => {
        const chunks: Buffer[] = [];
        resp.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        resp.on("end", () => {
          resolve({
            statusCode: Number(resp.statusCode || 0),
            headers: resp.headers,
            text: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );
    req.setTimeout(8000);
    req.on("timeout", () => {
      const err: any = new Error("timeout");
      err.code = "ETIMEDOUT";
      req.destroy(err);
    });
    req.on("error", (e: any) => {
      try {
        console.info("[lndRestJson:error]", {
          path,
          code: e?.code || null,
          syscall: e?.syscall || null,
          message: String(e?.message || e || "unknown error")
        });
      } catch {}
      reject(e);
    });
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });

  let json: any;
  try {
    json = res.text ? JSON.parse(res.text) : {};
  } catch (e: any) {
    // parse failure handled below with raw body fallback
    json = { raw: res.text || "" };
  }

  if (!(res.statusCode >= 200 && res.statusCode < 300)) {
    const msg = json?.message || json?.error || json?.detail || res.text || `HTTP ${res.statusCode}`;
    try {
      console.error("[lndRestJson:http_error]", {
        endpoint: `${u.origin}${u.pathname}`,
        status: res.statusCode,
        message: String(msg).slice(0, 300)
      });
    } catch {}
    throw new Error(`LND ${path} failed: ${msg}`);
  }
  return json;
}

async function lndFetchJson(cfg: RuntimeLndConfig | null, path: string, init?: RequestInit) {
  const method = String((init as any)?.method || "GET").toUpperCase();
  let body: unknown = undefined;
  if ((init as any)?.body !== undefined) {
    const rawBody = (init as any).body;
    if (typeof rawBody === "string" && rawBody.length) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    } else {
      body = rawBody;
    }
  }
  try {
    return await lndRestJson(cfg, method, path, body, (init?.headers as any) || undefined);
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    const lower = msg.toLowerCase();
    if (lower.includes("eof") || lower.includes("socket hang up") || lower.includes("unexpected eof")) {
      throw new Error("LND connection failed (EOF). Check REST URL protocol/port (use HTTPS REST port, often 8080) and TLS cert.");
    }
    if (lower.includes("self signed certificate") || lower.includes("self-signed")) {
      throw new Error("LND TLS validation failed. Upload your tls.cert (PEM) in the Lightning setup wizard.");
    }
    throw e;
  }
}

function b64ToHexReverseMaybe(b64: string): string | null {
  try {
    const buf = Buffer.from(String(b64 || ""), "base64");
    if (!buf.length) return null;
    return Buffer.from(buf).reverse().toString("hex");
  } catch {
    return null;
  }
}

export function parseChannelPoint(input: string): { txid: string; outputIndex: number } | null {
  const s = String(input || "").trim();
  const m = s.match(/^([0-9a-fA-F]{64}):(\d+)$/);
  if (!m) return null;
  return { txid: m[1].toLowerCase(), outputIndex: Number(m[2]) };
}

function listPeersContainsPubkey(peersJson: any, pubkey: string): boolean {
  const want = String(pubkey || "").toLowerCase();
  const peers = Array.isArray(peersJson?.peers) ? peersJson.peers : [];
  return peers.some((p: any) => {
    const candidate = String(p?.pub_key || p?.pubKey || p?.pubkey || "").toLowerCase();
    return candidate === want;
  });
}

function lndCacheKey(lnd: RuntimeLndConfig): string {
  try {
    const u = new URL(lnd.restUrl);
    return `${String(lnd.network || "mainnet").toLowerCase()}|${u.hostname}:${u.port || "443"}`;
  } catch {
    return `${String(lnd.network || "mainnet").toLowerCase()}|${lnd.restUrl}`;
  }
}

async function connectPeer(lnd: RuntimeLndConfig, peerPubKey: string, hostPort: string) {
  await lndFetchJson(lnd, "/v1/peers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      addr: { pubkey: peerPubKey, host: hostPort },
      perm: false,
      timeout: 10
    })
  });
}

async function withTimeout<T>(p: Promise<T>, ms: number, code: string): Promise<T> {
  const timeout = Math.max(250, Math.floor(ms));
  return await new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(code)), timeout);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function graphCacheSet(key: string, candidates: GraphCandidate[]) {
  graphFreshCache.set(key, candidates, GRAPH_CACHE_TTL_MS);
  graphStaleCache.set(key, candidates, GRAPH_STALE_TTL_MS);
}

async function fetchAndScoreGraphCandidates(lnd: RuntimeLndConfig): Promise<GraphCandidate[]> {
  const graph = await withTimeout(lndFetchJson(lnd, "/v1/graph", { method: "GET" }), 5000, "GRAPH_FETCH_TIMEOUT");
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const degree = new Map<string, number>();
  for (const e of edges) {
    const n1 = String(e?.node1_pub || "").toLowerCase();
    const n2 = String(e?.node2_pub || "").toLowerCase();
    if (isValidCompressedPubkey(n1)) degree.set(n1, (degree.get(n1) || 0) + 1);
    if (isValidCompressedPubkey(n2)) degree.set(n2, (degree.get(n2) || 0) + 1);
  }

  const candidates: GraphCandidate[] = [];
  for (const n of nodes) {
    const pubkey = String(n?.pub_key || n?.pubKey || "").trim();
    if (!isValidCompressedPubkey(pubkey)) continue;

    const addresses = Array.isArray(n?.addresses) ? n.addresses : [];
    let selected: string | null = null;
    let onionOnly: string | null = null;
    for (const addrObj of addresses) {
      const addr = parseHostPort(String(addrObj?.addr || ""));
      if (!addr) continue;
      if (addr.host.toLowerCase().endsWith(".onion")) {
        onionOnly = onionOnly || addr.normalized;
        continue;
      }
      selected = addr.normalized;
      break;
    }
    const hostPort = selected || onionOnly;
    if (!hostPort) continue;

    const lowered = pubkey.toLowerCase();
    const numChannels = Number(n?.num_channels ?? n?.numChannels ?? 0);
    const degreeCount = degree.get(lowered) || 0;
    const score = (Number.isFinite(numChannels) ? numChannels : 0) * 2 + degreeCount;
    candidates.push({
      pubkey,
      alias: String(n?.alias || "").trim() || undefined,
      hostPort,
      score,
      source: "graph"
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.pubkey.localeCompare(b.pubkey));
  return candidates.slice(0, MAX_GRAPH_CANDIDATES);
}

async function buildGraphCandidates(lnd: RuntimeLndConfig): Promise<{ candidates: GraphCandidate[]; fromCache: boolean }> {
  const key = lndCacheKey(lnd);
  const fresh = graphFreshCache.get(key);
  if (fresh) return { candidates: fresh, fromCache: true };

  const stale = graphStaleCache.get(key);
  if (stale) {
    graphSingleFlight
      .do(`graph:${key}`, async () => {
        const next = await fetchAndScoreGraphCandidates(lnd);
        graphCacheSet(key, next);
      })
      .catch(() => {});
    return { candidates: stale, fromCache: true };
  }

  const fetched = await graphSingleFlight.do(`graph:${key}`, async () => {
    const next = await fetchAndScoreGraphCandidates(lnd);
    graphCacheSet(key, next);
    return next;
  });
  return { candidates: fetched, fromCache: false };
}

function mapProbeFailureReason(error: unknown): string {
  const msg = String((error as any)?.message || error || "");
  const low = msg.toLowerCase();
  if (low.includes("timeout") || low.includes("etimedout")) return "CONNECT_TIMEOUT";
  if (low.includes("econnrefused") || low.includes("connection refused")) return "CONNECT_REFUSED";
  if (low.includes("already connected")) return "ALREADY_CONNECTED";
  if (low.includes("invalid peer")) return "CONNECT_FAILED";
  if (low.includes("eof")) return "CONNECT_FAILED";
  return "CONNECT_FAILED";
}

async function runWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let idx = 0;
  const workers = new Array(Math.max(1, limit)).fill(0).map(async () => {
    while (idx < items.length) {
      const cur = idx;
      idx += 1;
      out[cur] = await task(items[cur]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function probePeer(
  prisma: PrismaLike,
  input: { pubkey: string; hostPort: string; timeoutMs?: number }
): Promise<{ reachableNow: boolean; reason?: string }> {
  const pubkey = String(input.pubkey || "").trim();
  const hostPortRaw = String(input.hostPort || "").trim();
  if (!isValidCompressedPubkey(pubkey)) throw new Error("INVALID_PUBKEY");
  const parsedHost = parseHostPort(hostPortRaw);
  if (!parsedHost) throw new Error("INVALID_HOSTPORT");

  const cacheKey = `${pubkey.toLowerCase()}@${parsedHost.normalized.toLowerCase()}`;
  const cached = probeSuccessCache.get(cacheKey);
  if (cached) return cached;
  const cd = probeCooldown.get(cacheKey);
  if (cd) return { reachableNow: false, reason: "CONNECT_COOLDOWN" };

  const timeoutMs = Math.max(500, Math.min(10000, Math.floor(Number(input.timeoutMs || 2500))));
  const lnd = await getLndConfig(prisma);
  if (!lnd) throw new Error("Lightning node not configured");

  const run = async (): Promise<{ reachableNow: boolean; reason?: string }> => {
    return await probeSemaphore.use(async () => {
      try {
        const peers = await lndFetchJson(lnd, "/v1/peers", { method: "GET" });
        if (listPeersContainsPubkey(peers, pubkey)) {
          const ok = { reachableNow: true as const };
          probeSuccessCache.set(cacheKey, ok, PROBE_CACHE_TTL_MS);
          probeCooldown.clear(cacheKey);
          return ok;
        }
      } catch {}

      try {
        await connectPeer(lnd, pubkey, parsedHost.normalized);
      } catch (e: any) {
        const reason = mapProbeFailureReason(e);
        if (reason !== "ALREADY_CONNECTED") {
          probeCooldown.set(cacheKey, 25 * 60 * 1000, reason);
          return { reachableNow: false as const, reason };
        }
      }

      try {
        const peersAfter = await lndFetchJson(lnd, "/v1/peers", { method: "GET" });
        if (listPeersContainsPubkey(peersAfter, pubkey)) {
          const ok = { reachableNow: true as const };
          probeSuccessCache.set(cacheKey, ok, PROBE_CACHE_TTL_MS);
          probeCooldown.clear(cacheKey);
          return ok;
        }
        probeCooldown.set(cacheKey, 25 * 60 * 1000, "NOT_CONNECTED_AFTER_CONNECT");
        return { reachableNow: false as const, reason: "NOT_CONNECTED_AFTER_CONNECT" };
      } catch {
        probeCooldown.set(cacheKey, 25 * 60 * 1000, "NOT_CONNECTED_AFTER_CONNECT");
        return { reachableNow: false as const, reason: "NOT_CONNECTED_AFTER_CONNECT" };
      }
    });
  };

  return await probeSingleFlight.do(`probe:${cacheKey}`, async () => {
    try {
      return await withTimeout(run(), timeoutMs, "CONNECT_TIMEOUT");
    } catch (e: any) {
      const reason = String(e?.message || "CONNECT_FAILED");
      probeCooldown.set(cacheKey, 25 * 60 * 1000, reason);
      return { reachableNow: false as const, reason };
    }
  });
}

export async function ensurePeerConnected(
  prisma: PrismaLike,
  input: { pubkey: string; hostPort: string; timeoutMs?: number }
) {
  const pubkey = String(input.pubkey || "").trim();
  const pubkeyLower = pubkey.toLowerCase();
  const hostPortRaw = String(input.hostPort || "").trim();
  if (!isValidCompressedPubkey(pubkey)) throw new Error("INVALID_PUBKEY");
  const parsedHost = parseHostPort(hostPortRaw);
  if (!parsedHost) throw new Error("INVALID_HOSTPORT");

  const timeoutMs = Math.max(1000, Math.min(2500, Math.floor(Number(input.timeoutMs || 2500))));
  const key = pubkeyLower;
  const lnd = await getLndConfig(prisma);
  if (!lnd) throw new Error("Lightning node not configured");

  return await ensureConnectSingleFlight.do(`ensure:${pubkeyLower}`, async () => {
    const cd = connectCooldown.get(key);
    if (cd) throw new Error("connect_cooldown");

    const already = await lndFetchJson(lnd, "/v1/peers", { method: "GET" }).catch(() => null);
    if (already && listPeersContainsPubkey(already, pubkey)) return;

    await connectSemaphore.use(async () => {
      try {
        await connectPeer(lnd, pubkey, parsedHost.normalized);
      } catch (e: any) {
        const reason = mapProbeFailureReason(e);
        if (reason !== "ALREADY_CONNECTED") {
          connectCooldown.set(key, 30 * 1000, reason);
          throw new Error("peer_not_ready");
        }
      }
    });

    const deadline = Date.now() + timeoutMs;
    let waitMs = 200;
    while (Date.now() < deadline) {
      try {
        const peers = await lndFetchJson(lnd, "/v1/peers", { method: "GET" });
        if (listPeersContainsPubkey(peers, pubkey)) {
          connectCooldown.clear(key);
          return;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, waitMs));
      waitMs = Math.min(700, Math.floor(waitMs * 1.5));
    }
    connectCooldown.set(key, 30 * 1000, "peer_not_ready");
    throw new Error("peer_not_ready");
  });
}

export async function getPeerSuggestions(
  prisma: PrismaLike,
  input?: { limit?: number; probeTop?: number }
): Promise<SuggestionResult> {
  const lnd = await getLndConfig(prisma);
  if (!lnd) throw new Error("Lightning node not configured");

  const limit = Math.max(1, Math.min(100, Math.floor(Number(input?.limit ?? 20))));
  const probeTop = Math.max(0, Math.min(12, Math.floor(Number(input?.probeTop ?? 12))));

  let graphRes: { candidates: GraphCandidate[]; fromCache: boolean };
  try {
    graphRes = await buildGraphCandidates(lnd);
  } catch {
    graphRes = { candidates: [], fromCache: false };
  }
  const top = graphRes.candidates.slice(0, 50);
  const toProbe = top.slice(0, probeTop);
  const probeMap = new Map<string, { reachableNow: boolean; reason?: string }>();

  await runWithConcurrency(toProbe, 2, async (c) => {
    const p = await probePeer(prisma, { pubkey: c.pubkey, hostPort: c.hostPort, timeoutMs: 2500 });
    probeMap.set(`${c.pubkey.toLowerCase()}@${c.hostPort.toLowerCase()}`, p);
    return p;
  });

  const rows: LightningPeerSuggestion[] = top.map((c) => {
    const key = `${c.pubkey.toLowerCase()}@${c.hostPort.toLowerCase()}`;
    const probed = probeMap.get(key);
    return {
      pubkey: c.pubkey,
      alias: c.alias,
      hostPort: c.hostPort,
      score: c.score,
      reachableNow: Boolean(probed?.reachableNow),
      reason: probed?.reachableNow ? undefined : probed?.reason
    };
  });

  rows.sort((a, b) => {
    if (a.reachableNow !== b.reachableNow) return a.reachableNow ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return (a.alias || a.pubkey).localeCompare(b.alias || b.pubkey);
  });

  return {
    peers: rows.slice(0, limit),
    meta: { cachedGraph: graphRes.fromCache, probed: toProbe.length }
  };
}

export function interpretLightningDiscoveryHttpProbe(input: {
  restUrl: string;
  status: number;
  text?: string | null;
  json?: any;
}): LightningDiscoveryCandidate | null {
  const msg = String(input.json?.message || input.json?.error || input.json?.detail || input.text || "");
  const lower = msg.toLowerCase();

  if (
    lower.includes("expected 1 macaroon, got 0") ||
    lower.includes("macaroon") ||
    lower.includes("permission denied") ||
    input.status === 401 ||
    input.status === 403
  ) {
    return { restUrl: input.restUrl, notes: "LND REST reachable. Upload macaroon (and TLS cert if self-signed) to continue." };
  }

  if (input.status >= 200 && input.status < 300) {
    return { restUrl: input.restUrl, notes: "LND REST reachable." };
  }

  if (lower.includes("client sent an http request to an https server")) {
    try {
      const u = new URL(input.restUrl);
      if (u.protocol === "http:") {
        u.protocol = "https:";
        return { restUrl: u.toString().replace(/\/$/, ""), notes: "Endpoint expects HTTPS." };
      }
    } catch {}
    return { restUrl: input.restUrl, notes: "Endpoint expects HTTPS." };
  }

  return null;
}

export function interpretLightningDiscoveryError(restUrl: string, error: unknown): LightningDiscoveryCandidate | null {
  const msg = String((error as any)?.message || error || "");
  const lower = msg.toLowerCase();
  if (
    lower.includes("self signed certificate") ||
    lower.includes("self-signed") ||
    lower.includes("depth_zero_self_signed_cert") ||
    lower.includes("self_signed_cert_in_chain")
  ) {
    return {
      restUrl,
      requiresTlsCertHint: true,
      notes: "LND REST endpoint found, but a TLS CA cert is required (self-signed certificate)."
    };
  }
  if (lower.includes("client sent an http request to an https server")) {
    try {
      const u = new URL(restUrl);
      if (u.protocol === "http:") {
        u.protocol = "https:";
        return { restUrl: u.toString().replace(/\/$/, ""), notes: "Endpoint expects HTTPS." };
      }
    } catch {}
    return { restUrl, notes: "Endpoint expects HTTPS." };
  }
  return null;
}

export function mapLightningReadinessFromLnd(input: { getinfo: any; channels: any }): LightningReadiness {
  const gi = input.getinfo || {};
  const channelsList = Array.isArray(input.channels?.channels) ? input.channels.channels : [];
  const syncedToChain = Boolean(gi.synced_to_chain ?? gi.syncedToChain ?? false);
  const syncedToGraph = Boolean(gi.synced_to_graph ?? gi.syncedToGraph ?? false);
  const blockHeightRaw = Number(gi.block_height ?? gi.blockHeight ?? 0);
  const blockHeight = Number.isFinite(blockHeightRaw) && blockHeightRaw > 0 ? blockHeightRaw : undefined;
  const channelCount = channelsList.length;

  const hints: string[] = [];
  if (!syncedToChain) hints.push("Node is not yet synced to chain.");
  if (!syncedToGraph) hints.push("Node graph is still syncing.");
  if (channelCount === 0) hints.push("No channels. You can’t receive Lightning yet.");

  return {
    ok: true,
    configured: true,
    nodeReachable: true,
    wallet: { syncedToChain, syncedToGraph, blockHeight },
    channels: { count: channelCount },
    receiveReady: syncedToChain && syncedToGraph && channelCount > 0,
    hints
  };
}

export async function getLndConfig(prisma: PrismaLike): Promise<RuntimeLndConfig | null> {
  const row = await readLightningNodeConfigRow(prisma);
  if (!row) return null;
  let macaroonHex = "";
  try {
    const decrypted = decryptSecret({
      ciphertextB64: row.macaroonCiphertext,
      ivB64: row.macaroonIv,
      tagB64: row.macaroonTag
    });
    macaroonHex = normalizeMacaroonHex(decrypted.toString("utf8"));
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    if (msg === "NODE_MACAROON_MISSING" || msg === "NODE_MACAROON_INVALID_FORMAT") throw e;
    throw new Error("NODE_KEY_MISMATCH");
  }
  return {
    restUrl: stripTrailingSlash(row.restUrl),
    network: row.network || "mainnet",
    macaroonHex,
    tlsCert: row.tlsCertPem ? Buffer.from(row.tlsCertPem, "utf8") : null
  };
}

export async function getLightningNodeConfigStatus(prisma: PrismaLike): Promise<LightningNodeConfigStatus> {
  const row = await readLightningNodeConfigRow(prisma);
  if (!row) {
    return {
      configured: false,
      hasTlsCert: false,
      hasMacaroon: false,
      decryptOk: false,
      endpoint: null,
      network: null,
      lastUpdated: null,
      lastTestedAt: null,
      lastStatus: null,
      lastError: null,
      warnings: []
    };
  }

  const hasTlsCert = Boolean(String(row.tlsCertPem || "").trim());
  const hasMacaroon = Boolean(row.macaroonCiphertext && row.macaroonIv && row.macaroonTag);
  const warnings: string[] = [];
  let decryptOk = false;

  if (hasMacaroon) {
    try {
      const buf = decryptSecret({
        ciphertextB64: row.macaroonCiphertext,
        ivB64: row.macaroonIv,
        tagB64: row.macaroonTag
      });
      const hex = normalizeMacaroonHex(buf.toString("utf8"));
      decryptOk = Boolean(hex.length);
      if (!decryptOk) warnings.push("Stored macaroon could not be decrypted.");
    } catch (e: any) {
      decryptOk = false;
      const code = String(e?.message || e || "");
      if (code === "NODE_MACAROON_INVALID_FORMAT" || code === "NODE_MACAROON_MISSING") {
        warnings.push(code);
      } else {
        warnings.push("Stored macaroon cannot be decrypted. The encryption key may have changed.");
      }
    }
  }

  let endpoint: string | null = null;
  try {
    const u = new URL(String(row.restUrl || ""));
    endpoint = `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}`;
  } catch {
    endpoint = String(row.restUrl || "").trim() || null;
    warnings.push("Saved LND REST URL is invalid.");
  }

  return {
    configured: Boolean(endpoint && hasMacaroon),
    hasTlsCert,
    hasMacaroon,
    decryptOk,
    endpoint,
    network: row.network || null,
    lastUpdated: dateToIso(row.updatedAt),
    lastTestedAt: dateToIso(row.lastTestedAt),
    lastStatus: row.lastStatus || null,
    lastError: row.lastError || null,
    warnings
  };
}

export async function getLightningReadiness(prisma: PrismaLike): Promise<LightningReadiness> {
  const status = await getLightningNodeConfigStatus(prisma);
  if (!status.configured) {
    return {
      ok: true,
      configured: false,
      nodeReachable: false,
      wallet: { syncedToChain: false, syncedToGraph: false },
      channels: { count: 0 },
      receiveReady: false,
      hints: ["Lightning node not configured."]
    };
  }
  if (!status.decryptOk) {
    return {
      ok: true,
      configured: true,
      nodeReachable: false,
      wallet: { syncedToChain: false, syncedToGraph: false },
      channels: { count: 0 },
      receiveReady: false,
      hints: ["Stored Lightning credentials cannot be decrypted. The encryption key may have changed."]
    };
  }

  const lnd = await getLndConfig(prisma);
  if (!lnd) {
    return {
      ok: true,
      configured: true,
      nodeReachable: false,
      wallet: { syncedToChain: false, syncedToGraph: false },
      channels: { count: 0 },
      receiveReady: false,
      hints: ["Lightning node config exists, but credentials are unavailable."]
    };
  }

  try {
    const [getinfo, channels] = await Promise.all([
      lndFetchJson(lnd, "/v1/getinfo", { method: "GET" }),
      lndFetchJson(lnd, "/v1/channels", { method: "GET" })
    ]);
    return mapLightningReadinessFromLnd({ getinfo, channels });
  } catch (e: any) {
    return {
      ok: true,
      configured: true,
      nodeReachable: false,
      wallet: { syncedToChain: false, syncedToGraph: false },
      channels: { count: 0 },
      receiveReady: false,
      hints: [String(e?.message || e || "Failed to reach LND")]
    };
  }
}

export function getLightningChannelGuidanceSteps(): string[] {
  return [
    "Use an LSP to open a channel with inbound liquidity.",
    "If you already know a peer, open a channel to it.",
    "Start small while you validate your setup and backups.",
    "To add inbound liquidity, try paying yourself from a mobile Lightning wallet to this node.",
    "Confirm your node is fully synced before testing inbound payments.",
    "After opening a channel, wait for confirmations and re-check receive readiness."
  ];
}

function mapOpenChannelErrorCode(error: unknown): string {
  const msg = String((error as any)?.message || error || "");
  const code = msg.trim();
  if (
    code === "NOT_SYNCED" ||
    code === "WALLET_LOCKED" ||
    code === "INSUFFICIENT_FUNDS" ||
    code === "PEER_REJECTED" ||
    code === "MIN_CHAN_SIZE" ||
    code === "PEER_OFFLINE" ||
    code === "PEER_NOT_READY" ||
    code === "UNKNOWN"
  ) {
    return code;
  }

  const lower = msg.toLowerCase();
  if (lower.includes("not synced") || lower.includes("syncing")) return "NOT_SYNCED";
  if (lower.includes("wallet locked") || lower.includes("unlock")) return "WALLET_LOCKED";
  if (lower.includes("insufficient") && (lower.includes("fund") || lower.includes("balance"))) return "INSUFFICIENT_FUNDS";
  if (lower.includes("minimum") && lower.includes("channel")) return "MIN_CHAN_SIZE";
  if (lower.includes("rejected") || lower.includes("rejecting channel")) return "PEER_REJECTED";
  if (lower.includes("not online") || lower.includes("connection refused") || lower.includes("unreachable")) return "PEER_OFFLINE";
  if (lower.includes("peer_not_ready") || lower.includes("connect_cooldown") || lower.includes("not connected")) return "PEER_NOT_READY";
  return "UNKNOWN";
}

export async function openLightningChannel(
  prisma: PrismaLike,
  input: { peerPubKey: string; capacitySats: number; host?: string | null }
): Promise<LightningOpenChannelResult> {
  const lnd = await getLndConfig(prisma);
  if (!lnd) throw new Error("Lightning node not configured");

  const peerPubKey = String(input.peerPubKey || "").trim();
  if (!isValidCompressedPubkey(peerPubKey)) throw new Error("INVALID_PUBKEY");
  const capacitySats = Math.floor(Number(input.capacitySats || 0));
  if (!Number.isFinite(capacitySats) || capacitySats < 20000) throw new Error("capacitySats must be at least 20000");
  const trustedMin = TRUSTED_PEER_MIN_FUNDING_SATS[peerPubKey.toLowerCase()];
  if (trustedMin && capacitySats < trustedMin) {
    throw new Error(`You need at least ${trustedMin.toLocaleString()} sats for this peer.`);
  }

  if (!input.host) throw new Error("INVALID_HOSTPORT");
  const hostPort = String(input.host);

  const openRes = await openChannelSingleFlight.do(`open:${peerPubKey.toLowerCase()}`, async () => {
    try {
      await ensurePeerConnected(prisma, { pubkey: peerPubKey, hostPort });
    } catch (e: any) {
      const code = String(e?.message || "");
      if (code === "connect_cooldown") throw new Error("PEER_NOT_READY");
      if (code === "peer_not_ready") throw new Error("PEER_NOT_READY");
      throw e;
    }

    try {
      return await lndFetchJson(lnd, "/v1/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node_pubkey_string: peerPubKey,
          local_funding_amount: String(capacitySats)
        })
      });
    } catch (e: any) {
      throw new Error(mapOpenChannelErrorCode(e));
    }
  });

  const txid =
    String(openRes?.funding_txid_str || "").trim() ||
    b64ToHexReverseMaybe(String(openRes?.funding_txid_bytes || "")) ||
    "";
  const outputIndex = Number(openRes?.output_index ?? 0);
  const channelId = txid && Number.isFinite(outputIndex) ? `${txid}:${Math.max(0, outputIndex)}` : `${peerPubKey.slice(0, 16)}:pending`;

  // Friendly rough estimate for UX only; exact fee depends on mempool and wallet coin selection.
  const estimatedFeeSats = Math.max(500, Math.round(capacitySats * 0.002));

  return {
    status: "success",
    channelId,
    transactionFee: estimatedFeeSats / 100_000_000,
    estimatedConfirmations: 3,
    message: "Channel successfully opened. Please wait for confirmation."
  };
}

export async function getLightningChannelStatus(
  prisma: PrismaLike,
  input: { channelId: string; peerPubKey?: string | null }
): Promise<LightningChannelStatusResult> {
  const lnd = await getLndConfig(prisma);
  if (!lnd) throw new Error("Lightning node not configured");

  const requestedId = String(input.channelId || "").trim();
  const parsed = parseChannelPoint(requestedId);

  const [openChannels, pendingChannels] = await Promise.all([
    lndFetchJson(lnd, "/v1/channels", { method: "GET" }),
    lndFetchJson(lnd, "/v1/channels/pending", { method: "GET" }).catch(() => ({ }))
  ]);

  const openList = Array.isArray(openChannels?.channels) ? openChannels.channels : [];
  for (const c of openList) {
    const cp = String(c?.channel_point || "");
    const remotePubkey = String(c?.remote_pubkey || input.peerPubKey || "");
    if ((parsed && cp.toLowerCase() === requestedId.toLowerCase()) || (!parsed && remotePubkey === input.peerPubKey)) {
      const inboundLiquidity = Number(c?.remote_balance ?? 0) || 0;
      const outboundLiquidity = Number(c?.local_balance ?? 0) || 0;
      return {
        status: "open",
        inboundLiquidity,
        outboundLiquidity,
        peer: remotePubkey,
        confirmationStatus: "confirmed",
        receiveReady: inboundLiquidity > 0
      };
    }
  }

  const pendingGroups = [
    ...(Array.isArray(pendingChannels?.pending_open_channels) ? pendingChannels.pending_open_channels : []),
    ...(Array.isArray(pendingChannels?.pending_closing_channels) ? pendingChannels.pending_closing_channels : [])
  ];
  for (const p of pendingGroups) {
    const ch = p?.channel || p;
    const cp = String(ch?.channel_point || "");
    const remotePubkey = String(ch?.remote_node_pub || ch?.remote_pubkey || input.peerPubKey || "");
    if ((parsed && cp.toLowerCase() === requestedId.toLowerCase()) || (!parsed && remotePubkey === input.peerPubKey)) {
      const outboundLiquidity = Number(ch?.local_balance ?? 0) || 0;
      const inboundLiquidity = Number(ch?.remote_balance ?? 0) || 0;
      return {
        status: "pending",
        inboundLiquidity,
        outboundLiquidity,
        peer: remotePubkey,
        confirmationStatus: "awaiting_confirmation",
        receiveReady: false
      };
    }
  }

  return {
    status: "not_found",
    inboundLiquidity: 0,
    outboundLiquidity: 0,
    peer: String(input.peerPubKey || ""),
    confirmationStatus: "unknown",
    receiveReady: false
  };
}

function numberField(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

async function resolveAliasesBestEffortInBackground(lnd: RuntimeLndConfig, pubkeys: string[]) {
  const uniq = Array.from(new Set(pubkeys.map((p) => String(p || "").trim()).filter((p) => isValidCompressedPubkey(p))));
  for (const pubkey of uniq) {
    if (aliasCache.get(pubkey.toLowerCase()) !== undefined) continue;
    aliasSingleFlight
      .do(`alias:${pubkey.toLowerCase()}`, async () => {
        await aliasSemaphore.use(async () => {
          try {
            const data = await withTimeout(
              lndFetchJson(lnd, `/v1/graph/node/${encodeURIComponent(pubkey)}`, { method: "GET" }),
              2500,
              "ALIAS_TIMEOUT"
            );
            const alias = String(data?.node?.alias || data?.alias || "").trim() || null;
            aliasCache.set(pubkey.toLowerCase(), alias, 6 * 60 * 60 * 1000);
          } catch {
            aliasCache.set(pubkey.toLowerCase(), null, 15 * 60 * 1000);
          }
        });
      })
      .catch(() => {});
  }
}

export async function getLightningChannels(prisma: PrismaLike): Promise<LightningChannelsResponse> {
  const lnd = await getLndConfig(prisma);
  if (!lnd) throw new Error("Lightning node not configured");

  const [openRes, pendingRes] = await Promise.all([
    lndFetchJson(lnd, "/v1/channels", { method: "GET" }),
    lndFetchJson(lnd, "/v1/channels/pending", { method: "GET" }).catch(() => ({}))
  ]);

  const list = Array.isArray(openRes?.channels) ? openRes.channels : [];
  const rows: LightningChannelsResponse["channels"] = list.map((c: any) => {
    const remotePubkey = String(c?.remote_pubkey || "").trim();
    const channelPoint = String(c?.channel_point || "").trim();
    const cap = numberField(c?.capacity);
    const local = numberField(c?.local_balance);
    const remote = numberField(c?.remote_balance);
    const alias = aliasCache.get(remotePubkey.toLowerCase()) ?? null;
    return {
      channelPoint,
      chanId: String(c?.chan_id || c?.chanId || "").trim() || null,
      peerPubkey: remotePubkey,
      remotePubkey,
      peerAlias: alias,
      remoteAlias: alias,
      capacitySats: cap,
      capacitySat: cap,
      localSats: local,
      localSat: local,
      remoteSats: remote,
      remoteSat: remote,
      active: Boolean(c?.active),
      private: Boolean(c?.private),
      initiator: c?.initiator === undefined || c?.initiator === null ? null : Boolean(c?.initiator)
    };
  });

  const missingAliases = rows.filter((r) => !r.remoteAlias && r.remotePubkey).map((r) => r.remotePubkey);
  if (missingAliases.length > 0) {
    resolveAliasesBestEffortInBackground(lnd, missingAliases).catch(() => {});
  }

  const summary = rows.reduce(
    (acc, ch) => {
      acc.openChannels += 1;
      acc.totalCapacitySat += ch.capacitySat;
      acc.totalLocalSat += ch.localSat;
      acc.totalRemoteSat += ch.remoteSat;
      if (ch.active) acc.activeCount += 1;
      else acc.inactiveCount += 1;
      return acc;
    },
    {
      openChannels: 0,
      totalCapacitySat: 0,
      totalLocalSat: 0,
      totalRemoteSat: 0,
      activeCount: 0,
      inactiveCount: 0,
      pendingOpenCount: 0,
      pendingCloseCount: 0
    }
  );
  summary.pendingOpenCount = Array.isArray((pendingRes as any)?.pending_open_channels)
    ? (pendingRes as any).pending_open_channels.length
    : 0;
  summary.pendingCloseCount =
    (Array.isArray((pendingRes as any)?.pending_closing_channels) ? (pendingRes as any).pending_closing_channels.length : 0) +
    (Array.isArray((pendingRes as any)?.pending_force_closing_channels) ? (pendingRes as any).pending_force_closing_channels.length : 0) +
    (Array.isArray((pendingRes as any)?.waiting_close_channels) ? (pendingRes as any).waiting_close_channels.length : 0);

  const pendingOpen = Array.isArray((pendingRes as any)?.pending_open_channels) ? (pendingRes as any).pending_open_channels : [];
  const pendingClosing = Array.isArray((pendingRes as any)?.pending_closing_channels) ? (pendingRes as any).pending_closing_channels : [];
  const pendingForceClosing = Array.isArray((pendingRes as any)?.pending_force_closing_channels) ? (pendingRes as any).pending_force_closing_channels : [];
  const waitingClose = Array.isArray((pendingRes as any)?.waiting_close_channels) ? (pendingRes as any).waiting_close_channels : [];
  const pendingChannels: NonNullable<LightningChannelsResponse["pendingChannels"]> = [
    ...pendingOpen.map((p: any) => ({ pendingType: "opening" as const, raw: p?.channel || p })),
    ...pendingClosing.map((p: any) => ({ pendingType: "closing" as const, raw: p?.channel || p })),
    ...pendingForceClosing.map((p: any) => ({ pendingType: "force_closing" as const, raw: p?.channel || p })),
    ...waitingClose.map((p: any) => ({ pendingType: "waiting_close" as const, raw: p?.channel || p }))
  ].map((x) => {
    const ch = x.raw || {};
    const peerPubkey = String(ch?.remote_node_pub || ch?.remote_pubkey || "").trim();
    const channelPoint = String(ch?.channel_point || "");
    const alias = aliasCache.get(peerPubkey.toLowerCase()) ?? null;
    return {
      channelPoint,
      peerPubkey,
      peerAlias: alias,
      capacitySats: numberField(ch?.capacity),
      localSats: numberField(ch?.local_balance),
      remoteSats: numberField(ch?.remote_balance),
      active: false,
      pendingType: x.pendingType
    };
  });

  return { summary, channels: rows, pendingChannels };
}

export async function getLightningBalances(prisma: PrismaLike): Promise<LightningBalancesResponse> {
  const lnd = await getLndConfig(prisma);
  if (!lnd) throw new Error("Lightning node not configured");

  const [wallet, openRes, pendingRes, anchors] = await Promise.all([
    lndFetchJson(lnd, "/v1/balance/blockchain", { method: "GET" }),
    lndFetchJson(lnd, "/v1/channels", { method: "GET" }),
    lndFetchJson(lnd, "/v1/channels/pending", { method: "GET" }).catch(() => ({})),
    lndFetchJson(lnd, "/v1/wallet/anchors", { method: "GET" }).catch(() => null)
  ]);

  const openChannels = Array.isArray(openRes?.channels) ? openRes.channels : [];
  const outboundSats = openChannels.reduce((sum: number, c: any) => sum + numberField(c?.local_balance), 0);
  const inboundSats = openChannels.reduce((sum: number, c: any) => sum + numberField(c?.remote_balance), 0);
  const pendingOpenCount = Array.isArray((pendingRes as any)?.pending_open_channels) ? (pendingRes as any).pending_open_channels.length : 0;
  const pendingCloseCount = (
    (Array.isArray((pendingRes as any)?.pending_closing_channels) ? (pendingRes as any).pending_closing_channels.length : 0) +
    (Array.isArray((pendingRes as any)?.pending_force_closing_channels) ? (pendingRes as any).pending_force_closing_channels.length : 0) +
    (Array.isArray((pendingRes as any)?.waiting_close_channels) ? (pendingRes as any).waiting_close_channels.length : 0)
  );
  const reservedAnchorSats = anchors
    ? numberField((anchors as any)?.reserved_balance_anchor_chan || (anchors as any)?.reserved_balance_anchor || 0)
    : null;

  return {
    wallet: {
      confirmedSats: numberField((wallet as any)?.confirmed_balance),
      unconfirmedSats: numberField((wallet as any)?.unconfirmed_balance),
      totalSats: numberField((wallet as any)?.total_balance),
      reservedAnchorSats: reservedAnchorSats && reservedAnchorSats > 0 ? reservedAnchorSats : null
    },
    channels: {
      openCount: openChannels.length,
      pendingOpenCount,
      pendingCloseCount
    },
    liquidity: {
      outboundSats,
      inboundSats
    }
  };
}

function normalizeRHashHexAndB64(input: any): { rHashHex: string; rHashB64: string | null } {
  const raw = String(input?.r_hash || input?.rHash || "").trim();
  if (!raw) return { rHashHex: "", rHashB64: null };
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return { rHashHex: raw.toLowerCase(), rHashB64: null };
  try {
    const buf = Buffer.from(raw, "base64");
    return { rHashHex: buf.toString("hex"), rHashB64: raw };
  } catch {
    return { rHashHex: raw, rHashB64: null };
  }
}

export function normalizeLndInvoice(input: any): LightningInvoiceRow {
  const state = normalizeInvoiceState(String(input?.state || (input?.settled ? "SETTLED" : "OPEN")));
  const creationDateNum = Number(input?.creation_date || input?.creationDate || 0);
  const settleDateNum = Number(input?.settle_date || input?.settleDate || 0);
  const hashes = normalizeRHashHexAndB64(input);
  return {
    state,
    valueSats: numberField(input?.value ?? input?.value_sat),
    amtPaidSats: numberField(input?.amt_paid_sat ?? input?.amtPaidSat),
    creationDate: creationDateNum > 0 ? new Date(creationDateNum * 1000).toISOString() : new Date(0).toISOString(),
    settleDate: settleDateNum > 0 ? new Date(settleDateNum * 1000).toISOString() : null,
    memo: String(input?.memo || ""),
    rHashHex: hashes.rHashHex,
    rHashB64: hashes.rHashB64,
    bolt11: String(input?.payment_request || input?.paymentRequest || "").trim() || null
  };
}

export async function getLightningInvoices(prisma: PrismaLike, input?: { limit?: number }): Promise<LightningInvoiceRow[]> {
  const lnd = await getLndConfig(prisma);
  if (!lnd) throw new Error("Lightning node not configured");
  const limit = Math.max(1, Math.min(200, Math.floor(Number(input?.limit ?? 50))));
  const res = await lndFetchJson(
    lnd,
    `/v1/invoices?reversed=true&num_max_invoices=${encodeURIComponent(String(limit))}`,
    { method: "GET" }
  );
  const invoices = Array.isArray((res as any)?.invoices) ? (res as any).invoices : [];
  return invoices.map((x: any) => normalizeLndInvoice(x));
}

function mapCloseChannelErrorCode(error: unknown): string {
  const msg = String((error as any)?.message || error || "").toLowerCase();
  if (msg.includes("not found") || msg.includes("unable to find channel")) return "CHANNEL_NOT_FOUND";
  if (msg.includes("already closing") || msg.includes("pending close")) return "ALREADY_CLOSING";
  if (msg.includes("not online") || msg.includes("unreachable") || msg.includes("connection refused")) return "PEER_OFFLINE";
  if (msg.includes("eof") || msg.includes("timeout") || msg.includes("unavailable")) return "PEER_OFFLINE";
  return "UNKNOWN";
}

export async function closeLightningChannel(
  prisma: PrismaLike,
  input: { channelPoint: string; force?: boolean | null }
): Promise<{ status: "ok"; channelPoint: string; force: boolean; message: string }> {
  const parsed = parseChannelPoint(input.channelPoint);
  if (!parsed) throw new Error("INVALID_CHANNEL_POINT");
  const lnd = await getLndConfig(prisma);
  if (!lnd) throw new Error("Lightning node not configured");
  const force = Boolean(input.force);
  const path = `/v1/channels/${encodeURIComponent(parsed.txid)}/${parsed.outputIndex}${force ? "?force=true" : ""}`;
  try {
    await lndFetchJson(lnd, path, { method: "DELETE" });
    return {
      status: "ok",
      channelPoint: `${parsed.txid}:${parsed.outputIndex}`,
      force,
      message: force
        ? "Force close requested. Funds may be timelocked until the close confirms."
        : "Close requested. Funds return on-chain after close confirms."
    };
  } catch (e: any) {
    throw new Error(mapCloseChannelErrorCode(e));
  }
}

export async function getLightningNodeConfigMeta(prisma: PrismaLike) {
  const status = await getLightningNodeConfigStatus(prisma);
  return {
    configured: status.configured,
    restUrl: status.endpoint,
    network: status.network,
    lastTestedAt: status.lastTestedAt,
    lastStatus: status.lastStatus,
    lastError: status.lastError
  };
}

export async function deleteLightningNodeConfig(prisma: PrismaLike) {
  await prisma.$executeRaw`DELETE FROM "LightningNodeConfig" WHERE "id" = 'singleton'`;
}

export async function probeLndConnection(input: { restUrl: string; macaroonHex: string; network?: string | null; tlsCertPem?: string | null; tlsCert?: Buffer | null }) {
  const normalizedTlsPem = input.tlsCertPem ? normalizeTlsCertPem(input.tlsCertPem) : null;
  const cfg: RuntimeLndConfig = {
    restUrl: normalizeRestUrl(input.restUrl),
    network: String(input.network || "mainnet"),
    macaroonHex: normalizeMacaroonHex(input.macaroonHex),
    tlsCert: input.tlsCert
      ? Buffer.from(input.tlsCert)
      : normalizedTlsPem
        ? Buffer.from(normalizedTlsPem, "utf8")
        : null
  };
  const data = await lndFetchJson(cfg, "/v1/getinfo", { method: "GET" });
  const chains = Array.isArray(data?.chains) ? data.chains : [];
  const reportedNetwork = String(chains[0]?.network || "").toLowerCase();
  const expectedNetwork = String(input.network || "").toLowerCase();
  if (expectedNetwork && reportedNetwork && expectedNetwork !== reportedNetwork) {
    throw new Error(`LND network mismatch: expected ${expectedNetwork}, got ${reportedNetwork}`);
  }
  return {
    alias: String(data?.alias || ""),
    version: String(data?.version || ""),
    identityPubkey: String(data?.identity_pubkey || ""),
    network: reportedNetwork || null
  };
}

export async function testLightningNodeConnection(input: { restUrl: string; network: string; macaroonBase64: string; tlsCertPem?: string | null }) {
  try {
    const macaroonHex = parseMacaroonBase64ToHex(input.macaroonBase64);
    const info = await probeLndConnection({ restUrl: input.restUrl, network: input.network, macaroonHex, tlsCertPem: input.tlsCertPem || null });
    return { ok: true as const, info };
  } catch (e: any) {
    return { ok: false as const, error: String(e?.message || e) };
  }
}

export async function saveLightningNodeConfig(
  prisma: PrismaLike,
  input: { restUrl: string; network: string; macaroonBase64: string; tlsCertPem?: string | null }
) {
  const restUrl = normalizeRestUrl(input.restUrl);
  const network = String(input.network || "mainnet").trim().toLowerCase() || "mainnet";
  const macaroonHex = parseMacaroonBase64ToHex(input.macaroonBase64);
  const tlsCertPem = normalizeTlsCertPem(input.tlsCertPem || null);
  const enc = encryptSecret(Buffer.from(macaroonHex, "utf8"));

  const test = await testLightningNodeConnection({
    restUrl,
    network,
    macaroonBase64: Buffer.from(macaroonHex, "hex").toString("base64"),
    tlsCertPem
  });
  await upsertLightningNodeConfigRow(prisma, {
    restUrl,
    network,
    macaroonCiphertext: enc.ciphertextB64,
    macaroonIv: enc.ivB64,
    macaroonTag: enc.tagB64,
    tlsCertPem,
    lastStatus: test.ok ? "connected" : "error",
    lastError: test.ok ? null : test.error || "Connection test failed",
    lastTestedAt: new Date()
  });
  return test.ok ? { ok: true as const } : { ok: false as const, error: test.error || "Connection test failed" };
}

export type InvoiceLifecycleIntent = {
  id: string;
  status: "pending" | "paid";
  lnInvoice: string | null;
  lnRHashB64: string | null;
  memo?: string | null;
  paidAt?: string | null;
  invoiceCreatedAtMs?: number | null;
};

export type InvoiceLifecycleLookup = { state: string; amt_paid_sat?: number | string | null };
export type InvoiceLifecycleAdd = { payment_request: string; r_hash: string };
export type InvoiceLifecycleLnd = {
  lookupInvoice: (rHashB64: string) => Promise<InvoiceLifecycleLookup>;
  addInvoice: (input: { amountSats: string; memo: string }) => Promise<InvoiceLifecycleAdd>;
};

function normalizeInvoiceState(s: string | null | undefined): "SETTLED" | "OPEN" | "ACCEPTED" | "CANCELED" | "UNKNOWN" {
  const st = String(s || "").trim().toUpperCase();
  if (st === "SETTLED" || st === "PAID") return "SETTLED";
  if (st === "OPEN") return "OPEN";
  if (st === "ACCEPTED") return "ACCEPTED";
  if (st === "CANCELED" || st === "CANCELLED" || st === "EXPIRED") return "CANCELED";
  return "UNKNOWN";
}

export async function ensureActiveInvoiceForIntent(
  intent: InvoiceLifecycleIntent,
  deps: {
    amountSats: bigint | number | string;
    memo: string;
    lnd: InvoiceLifecycleLnd;
    nowMs?: number;
    staleAfterMs?: number;
    singleFlight?: SingleFlight;
  }
): Promise<{ intent: InvoiceLifecycleIntent; created: boolean; state: "SETTLED" | "OPEN" | "ACCEPTED" | "CANCELED" | "UNKNOWN"; settled: boolean }> {
  const sf = deps.singleFlight || invoiceLifecycleSingleFlight;
  const key = `invoice-intent:${String(intent.id || "").trim() || "unknown"}`;
  return await sf.do(key, async () => {
    const amountSats = String(deps.amountSats ?? "0");
    const memo = String(deps.memo || "").trim();
    const nowMs = Number.isFinite(Number(deps.nowMs)) ? Number(deps.nowMs) : Date.now();
    const staleAfterMs = Math.max(1_000, Number(deps.staleAfterMs || 2 * 60 * 1000));

    if (intent.lnRHashB64 && intent.lnInvoice) {
      try {
        const lk = await deps.lnd.lookupInvoice(intent.lnRHashB64);
        const st = normalizeInvoiceState(lk?.state);
        if (st === "OPEN" || st === "ACCEPTED") {
          return { intent, created: false, state: st, settled: false };
        }
        if (st === "SETTLED") {
          return { intent, created: false, state: st, settled: true };
        }
        // CANCELED / UNKNOWN => rotate below
      } catch {
        const createdAtMs = Number(intent.invoiceCreatedAtMs || 0);
        const fresh = createdAtMs > 0 && nowMs - createdAtMs < staleAfterMs;
        if (fresh) {
          return { intent, created: false, state: "UNKNOWN", settled: false };
        }
        // stale + lookup failed => rotate below
      }
    }

    const created = await deps.lnd.addInvoice({ amountSats, memo });
    const next: InvoiceLifecycleIntent = {
      ...intent,
      lnInvoice: String(created.payment_request || ""),
      lnRHashB64: String(created.r_hash || "")
    };
    return { intent: next, created: true, state: "OPEN", settled: false };
  });
}

export async function refreshIntentFromLnd(
  intent: InvoiceLifecycleIntent,
  lnd: Pick<InvoiceLifecycleLnd, "lookupInvoice">
): Promise<{ intent: InvoiceLifecycleIntent; paid: boolean }> {
  if (intent.status === "paid") return { intent, paid: true };
  if (!intent.lnRHashB64) return { intent, paid: false };

  const lk = await lnd.lookupInvoice(intent.lnRHashB64);
  const st = normalizeInvoiceState(lk?.state);
  if (st === "SETTLED") {
    const next: InvoiceLifecycleIntent = {
      ...intent,
      status: "paid",
      paidAt: intent.paidAt || new Date().toISOString()
    };
    return { intent: next, paid: true };
  }
  return { intent, paid: false };
}

/**
 * Multi-provider Lightning:
 * - If LND env vars exist, prefer local LND REST (invoice-only).
 *   providerId encoded as: "lnd:<r_hash_base64>"
 * - Else fallback to LNbits (existing behavior).
 */
export async function createLightningInvoice(prisma: PrismaLike, amountSats: bigint, memo: string) {
  const lnd = (await getLndConfig(prisma)) || getLegacyEnvLndConfig();
  if (lnd) {
    const expirySeconds = Math.max(60, Math.floor(Number(process.env.RECEIPT_TOKEN_TTL_SECONDS || "3600")));

    const data = await lndFetchJson(lnd, "/v1/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        value: amountSats.toString(),
        memo,
        expiry: expirySeconds
      })
    });

    const bolt11 = data.payment_request as string | undefined;
    const rHashB64 = data.r_hash as string | undefined;
    if (!bolt11 || !rHashB64) throw new Error("LND invoice response missing payment_request or r_hash");

    const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();

    return {
      bolt11,
      providerId: `lnd:${rHashB64}`,
      expiresAt
    };
  }

  // LNbits fallback
  const url = process.env.LNBITS_URL;
  const key = process.env.LNBITS_INVOICE_KEY;
  if (!url || !key) return null;

  const res = await fetch(`${stripTrailingSlash(url)}/api/v1/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": key },
    body: JSON.stringify({ out: false, amount: Number(amountSats), memo })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "LNbits invoice error");

  return {
    bolt11: data.payment_request as string,
    providerId: data.payment_hash as string,
    expiresAt: data.expires_at ? new Date(Number(data.expires_at) * 1000).toISOString() : null
  };
}

export async function checkLightningInvoice(prisma: PrismaLike, providerId: string) {
  if (providerId?.startsWith("lnd:")) {
    const paymentHashHex = derivePaymentHashHexFromProvider(providerId);
    if (!paymentHashHex) throw new Error("Invalid LND providerId: missing/invalid payment hash");
    const data = await getInvoiceByPaymentHashHex(prisma, paymentHashHex);

    const stateRaw = String(data?.state || "").toUpperCase();
    const state =
      stateRaw === "SETTLED" || stateRaw === "OPEN" || stateRaw === "CANCELED" || stateRaw === "ACCEPTED"
        ? stateRaw
        : Boolean(data?.settled)
          ? "SETTLED"
          : "OPEN";
    const paid = state === "SETTLED" || Boolean(data?.settled);
    const paidAt = data?.settle_date ? new Date(Number(data.settle_date) * 1000).toISOString() : null;
    return { paid, paidAt, state };
  }

  // LNbits fallback
  const url = process.env.LNBITS_URL;
  const key = process.env.LNBITS_INVOICE_KEY;
  if (!url || !key) return { paid: false as const };

  const res = await fetch(`${stripTrailingSlash(url)}/api/v1/payments/${encodeURIComponent(providerId)}`, {
    method: "GET",
    headers: { "X-Api-Key": key }
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "LNbits check error");
  return {
    paid: Boolean(data?.paid),
    paidAt: data?.paid_at ? new Date(Number(data.paid_at) * 1000).toISOString() : null,
    state: Boolean(data?.paid) ? "SETTLED" : "OPEN"
  };
}

function isHex64(value: string | null | undefined): boolean {
  return /^[0-9a-fA-F]{64}$/.test(String(value || "").trim());
}

function derivePaymentHashHexFromProvider(providerId: string, paymentHashMaybe?: string | null): string | null {
  const explicit = String(paymentHashMaybe || "").trim();
  if (isHex64(explicit)) return explicit.toLowerCase();
  const p = String(providerId || "").trim();
  if (!p.startsWith("lnd:")) return null;
  const b64 = p.slice("lnd:".length).trim();
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, "base64");
    const hex = buf.toString("hex");
    if (!isHex64(hex)) return null;
    return hex.toLowerCase();
  } catch {
    return null;
  }
}

export async function getInvoiceByPaymentHashHex(prisma: PrismaLike, paymentHashHex: string) {
  const lnd = await getLndConfig(prisma);
  if (!lnd) throw new Error("Lightning node not configured");
  const paymentHash = String(paymentHashHex || "").trim().toLowerCase();
  if (!isHex64(paymentHash)) throw new Error("Invalid payment hash hex");
  return await lndFetchJson(lnd, `/v1/invoice/${encodeURIComponent(paymentHash)}`, {
      method: "GET"
  });
}
