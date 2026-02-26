import { Agent } from "undici";
import type { PrismaClient } from "@prisma/client";
import fsSync from "node:fs";
import { decryptSecret, encryptSecret } from "../lib/cryptoConfig.js";

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
  macaroon: Buffer;
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

const TRUSTED_PEER_MIN_FUNDING_SATS: Record<string, number> = {
  // LNBIG (example/placeholder in UI starter list)
  "03d0674b16c5b333c65fbc0146d6f0b58a5b0f3f31b17f4f0de5f2f1f4f7d8b9aa": 200_000,
  // LightningPool (example/placeholder in UI starter list)
  "02aa0d36e56f9c2f4f2b1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcd12": 200_000,
  // ACINQ
  "03864ef025fde8fb587d989186ce6a4a186895ee44a926bfc370e2c366597a3f8f": 400_000
};

function stripTrailingSlash(s: string) {
  return s.replace(/\/+$/, "");
}

function normalizeRestUrl(s: string) {
  const raw = String(s || "").trim();
  if (!raw) throw new Error("restUrl required");
  const url = new URL(raw);
  if (!/^https?:$/i.test(url.protocol)) throw new Error("LND REST URL must be http/https");
  return stripTrailingSlash(url.toString());
}

function macaroonHexFromBuffer(buf: Buffer) {
  return Buffer.from(buf).toString("hex");
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

function parseMacaroonBase64(macaroonBase64: string): Buffer {
  const raw = String(macaroonBase64 || "").trim();
  if (!raw) throw new Error("macaroonBase64 required");
  const buf = Buffer.from(raw, "base64");
  if (!buf.length) throw new Error("Invalid macaroonBase64");
  return buf;
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
  const s = String(value || "").trim();
  if (!s) return null;
  if (!s.includes("BEGIN CERTIFICATE")) throw new Error("tlsCertPem must be a PEM certificate");
  return s;
}

function getLegacyEnvLndConfig(): { restUrl: string; tlsCert?: Buffer | null; macaroon: Buffer } | null {
  const restUrl = process.env.LND_REST_URL;
  const invoiceMacB64 =
    process.env.LND_INVOICE_MACAROON_B64 ||
    process.env.LND_MACAROON_B64 ||
    "";
  if (!restUrl || !invoiceMacB64) return null;
  const tlsCertPem = readPemMaybeFile(process.env.LND_TLS_CERT_PATH || process.env.LND_TLS_CERT_PEM || "");
  return {
    restUrl: stripTrailingSlash(restUrl),
    network: "mainnet",
    macaroon: Buffer.from(invoiceMacB64, "base64"),
    tlsCert: tlsCertPem ? Buffer.from(tlsCertPem, "utf8") : null
  };
}

async function lndFetchJson(cfg: RuntimeLndConfig | null, path: string, init?: RequestInit) {
  if (!cfg) throw new Error("LND not configured");

  const dispatcher = cfg.tlsCert
    ? new Agent({
        connect: { ca: cfg.tlsCert }
      })
    : undefined;

  const res = await fetch(`${cfg.restUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Grpc-Metadata-macaroon": macaroonHexFromBuffer(cfg.macaroon)
    },
    // @ts-ignore undici fetch supports dispatcher in node
    dispatcher
  });

  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const msg = json?.message || json?.error || json?.detail || text || `HTTP ${res.status}`;
    throw new Error(`LND ${path} failed: ${msg}`);
  }

  return json;
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

function parseChannelPointId(input: string): { txid: string; outputIndex: number } | null {
  const s = String(input || "").trim();
  const m = s.match(/^([0-9a-fA-F]{64}):(\d+)$/);
  if (!m) return null;
  return { txid: m[1].toLowerCase(), outputIndex: Number(m[2]) };
}

async function ensurePeerConnected(lnd: RuntimeLndConfig, peerPubKey: string, host?: string | null) {
  if (!host) return;
  try {
    await lndFetchJson(lnd, "/v1/peers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        addr: {
          pubkey: peerPubKey,
          host: String(host).trim()
        },
        perm: false,
        timeout: 10
      })
    });
  } catch (e: any) {
    const msg = String(e?.message || e || "").toLowerCase();
    // Treat already-connected style errors as success.
    if (msg.includes("already connected") || msg.includes("already connected to peer")) return;
    throw e;
  }
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
  const macaroon = decryptSecret({
    ciphertextB64: row.macaroonCiphertext,
    ivB64: row.macaroonIv,
    tagB64: row.macaroonTag
  });
  return {
    restUrl: stripTrailingSlash(row.restUrl),
    network: row.network || "mainnet",
    macaroon,
    tlsCert: row.tlsCertPem ? Buffer.from(row.tlsCertPem, "utf8") : null
  };
}

export async function getLightningReadiness(prisma: PrismaLike): Promise<LightningReadiness> {
  const lnd = await getLndConfig(prisma);
  if (!lnd) {
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

export async function openLightningChannel(
  prisma: PrismaLike,
  input: { peerPubKey: string; capacitySats: number; host?: string | null }
): Promise<LightningOpenChannelResult> {
  const lnd = await getLndConfig(prisma);
  if (!lnd) throw new Error("Lightning node not configured");

  const peerPubKey = String(input.peerPubKey || "").trim();
  if (!/^[0-9a-fA-F]{66}$/.test(peerPubKey)) throw new Error("Invalid peer pubkey");
  const capacitySats = Math.floor(Number(input.capacitySats || 0));
  if (!Number.isFinite(capacitySats) || capacitySats < 20000) throw new Error("capacitySats must be at least 20000");
  const trustedMin = TRUSTED_PEER_MIN_FUNDING_SATS[peerPubKey.toLowerCase()];
  if (trustedMin && capacitySats < trustedMin) {
    throw new Error(`You need at least ${trustedMin.toLocaleString()} sats for this peer.`);
  }

  if (input.host) await ensurePeerConnected(lnd, peerPubKey, input.host);

  const openRes = await lndFetchJson(lnd, "/v1/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      node_pubkey_string: peerPubKey,
      local_funding_amount: String(capacitySats)
    })
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
  const parsed = parseChannelPointId(requestedId);

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

export async function getLightningNodeConfigMeta(prisma: PrismaLike) {
  const row = await readLightningNodeConfigRow(prisma);
  if (!row) {
    return {
      configured: false,
      restUrl: null,
      network: null,
      lastTestedAt: null,
      lastStatus: null,
      lastError: null
    };
  }
  return {
    configured: true,
    restUrl: row.restUrl || null,
    network: row.network || null,
    lastTestedAt: dateToIso(row.lastTestedAt),
    lastStatus: row.lastStatus || null,
    lastError: row.lastError || null
  };
}

export async function deleteLightningNodeConfig(prisma: PrismaLike) {
  await prisma.$executeRaw`DELETE FROM "LightningNodeConfig" WHERE "id" = 'singleton'`;
}

export async function probeLndConnection(input: { restUrl: string; macaroon: Buffer; network?: string | null; tlsCertPem?: string | null; tlsCert?: Buffer | null }) {
  const cfg: RuntimeLndConfig = {
    restUrl: normalizeRestUrl(input.restUrl),
    network: String(input.network || "mainnet"),
    macaroon: Buffer.from(input.macaroon),
    tlsCert: input.tlsCert
      ? Buffer.from(input.tlsCert)
      : input.tlsCertPem
        ? Buffer.from(normalizeTlsCertPem(input.tlsCertPem), "utf8")
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
    const macaroon = parseMacaroonBase64(input.macaroonBase64);
    const info = await probeLndConnection({ restUrl: input.restUrl, network: input.network, macaroon, tlsCertPem: input.tlsCertPem || null });
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
  const macaroon = parseMacaroonBase64(input.macaroonBase64);
  const tlsCertPem = normalizeTlsCertPem(input.tlsCertPem || null);
  const enc = encryptSecret(macaroon);

  const test = await testLightningNodeConnection({ restUrl, network, macaroonBase64: macaroon.toString("base64"), tlsCertPem });
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
    const lnd = await getLndConfig(prisma);
    if (!lnd) throw new Error("Lightning node not configured");

    const rHashB64 = providerId.slice("lnd:".length);
    const data = await lndFetchJson(lnd, `/v1/invoice/${encodeURIComponent(rHashB64)}`, {
      method: "GET"
    });

    const paid = Boolean(data?.settled);
    const paidAt = data?.settle_date ? new Date(Number(data.settle_date) * 1000).toISOString() : null;
    return { paid, paidAt };
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
  return { paid: Boolean(data?.paid), paidAt: data?.paid_at ? new Date(Number(data.paid_at) * 1000).toISOString() : null };
}
