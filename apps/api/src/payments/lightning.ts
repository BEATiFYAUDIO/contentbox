import fsSync from "node:fs";
import crypto from "node:crypto";
import { Agent } from "undici";
import { base64ToHex, is32ByteHex, normalizeProviderIdFromLnd, providerIdToLndBase64 } from "./lndHash.js";

type LightningInvoice = { bolt11: string; providerId: string; expiresAt: string | null };
type LightningStatus = { paid: boolean; paidAt?: string | null; status?: "pending" | "paid" | "expired" | "failed" };

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
      return fsSync.readFileSync(trimmed).toString("hex");
    } catch {
      return null;
    }
  }
  return trimmed;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { dispatcher?: any },
  timeoutMs = 8000,
  retries = 1
): Promise<Response> {
  let lastErr: any = null;
  for (let i = 0; i <= retries; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal } as any);
      clearTimeout(timer);
      return res;
    } catch (e: any) {
      clearTimeout(timer);
      lastErr = e;
      if (i === retries) throw e;
    }
  }
  throw lastErr;
}

function lndConfig() {
  const baseUrl = String(process.env.LND_REST_URL || "").replace(/\/$/, "");
  const macVal =
    process.env.LND_MACAROON_PATH ||
    process.env.LND_INVOICE_MACAROON_PATH ||
    process.env.LND_MACAROON_HEX ||
    process.env.LND_MACAROON ||
    "";
  const macaroon = readMacaroon(macVal);
  const cert = readPemMaybeFile(process.env.LND_TLS_CERT_PATH || process.env.LND_TLS_CERT_PEM || "");
  const dispatcher = cert ? new Agent({ connect: { ca: cert } }) : undefined;
  if (!baseUrl || !macaroon) return null;
  return { baseUrl, macaroon, dispatcher };
}

function lnbitsConfig() {
  const url = process.env.LNBITS_URL;
  const key = process.env.LNBITS_INVOICE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

async function createLndInvoice(amountSats: bigint, memo: string): Promise<LightningInvoice> {
  const cfg = lndConfig();
  if (!cfg) throw new Error("LND not configured");
  const res = await fetchWithTimeout(
    `${cfg.baseUrl}/v1/invoices`,
    {
      method: "POST",
      headers: {
        "Grpc-Metadata-Macaroon": cfg.macaroon,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ value: Number(amountSats), memo, expiry: 600, private: true }),
      dispatcher: cfg.dispatcher
    } as any,
    8000,
    1
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`LND invoice error: ${text}`);
  const data: any = text ? JSON.parse(text) : null;
  const bolt11 = data?.payment_request || "";
  const rHashHex = data?.r_hash ? normalizeProviderIdFromLnd(data.r_hash) : "";
  if (!bolt11 || !rHashHex) throw new Error("LND invoice response missing fields");
  const expiresAt = new Date(Date.now() + 600 * 1000).toISOString();
  return { bolt11, providerId: rHashHex, expiresAt };
}

async function checkLndInvoice(providerId: string): Promise<LightningStatus> {
  const cfg = lndConfig();
  if (!cfg) return { paid: false as const };
  const rHashHex = is32ByteHex(providerId) ? providerId.toLowerCase() : base64ToHex(providerId).toLowerCase();
  let res = await fetchWithTimeout(
    `${cfg.baseUrl}/v1/invoice/${encodeURIComponent(rHashHex)}`,
    {
      method: "GET",
      headers: { "Grpc-Metadata-Macaroon": cfg.macaroon },
      dispatcher: cfg.dispatcher
    } as any,
    8000,
    1
  );
  let text = await res.text();
  if (!res.ok && res.status === 404) {
    const rHashB64 = providerIdToLndBase64(providerId);
    res = await fetchWithTimeout(
      `${cfg.baseUrl}/v1/invoice/${encodeURIComponent(rHashB64)}`,
      {
        method: "GET",
        headers: { "Grpc-Metadata-Macaroon": cfg.macaroon },
        dispatcher: cfg.dispatcher
      } as any,
      8000,
      1
    );
    text = await res.text();
  }
  if (!res.ok) throw new Error(`LND check error: ${text}`);
  const data: any = text ? JSON.parse(text) : null;
  const state = String(data?.state || "").toUpperCase();
  const settled = state === "SETTLED" || Boolean(data?.settled);
  if (!settled) {
    const created = Number(data?.creation_date || 0);
    const expiry = Number(data?.expiry || 0);
    if (created > 0 && expiry > 0) {
      const expiresAtSec = created + expiry;
      if (Date.now() / 1000 > expiresAtSec) return { paid: false as const, status: "expired" };
    }
    if (state === "CANCELED" || state === "EXPIRED") return { paid: false as const, status: "expired" };
    return { paid: false as const, status: "pending" };
  }
  const paidAt = data?.settle_date ? new Date(Number(data.settle_date) * 1000).toISOString() : null;
  return { paid: true as const, paidAt, status: "paid" };
}

async function createLnbitsInvoice(amountSats: bigint, memo: string): Promise<LightningInvoice | null> {
  const cfg = lnbitsConfig();
  if (!cfg) return null;
  const res = await fetchWithTimeout(
    `${cfg.url}/api/v1/payments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": cfg.key },
      body: JSON.stringify({ out: false, amount: Number(amountSats), memo })
    },
    8000,
    1
  );
  const data: any = await res.json();
  if (!res.ok) throw new Error(data?.detail || "LNbits invoice error");
  return {
    bolt11: data.payment_request as string,
    providerId: data.payment_hash as string,
    expiresAt: data.expires_at ? new Date(Number(data.expires_at) * 1000).toISOString() : null
  };
}

async function checkLnbitsInvoice(providerId: string): Promise<LightningStatus> {
  const cfg = lnbitsConfig();
  if (!cfg) return { paid: false as const };
  const res = await fetchWithTimeout(
    `${cfg.url}/api/v1/payments/${encodeURIComponent(providerId)}`,
    { method: "GET", headers: { "X-Api-Key": cfg.key } },
    8000,
    1
  );
  const data: any = await res.json();
  if (!res.ok) throw new Error(data?.detail || "LNbits check error");
  return { paid: Boolean(data?.paid), paidAt: data?.paid_at ? new Date(Number(data.paid_at) * 1000).toISOString() : null };
}

export async function createLightningInvoice(amountSats: bigint, memo: string): Promise<LightningInvoice | null> {
  if (lndConfig()) return createLndInvoice(amountSats, memo);
  return createLnbitsInvoice(amountSats, memo);
}

export async function checkLightningInvoice(providerId: string): Promise<LightningStatus> {
  if (lndConfig()) return checkLndInvoice(providerId);
  return checkLnbitsInvoice(providerId);
}

export async function payLightningInvoice(bolt11: string): Promise<{ paymentHash: string; feeSats: number }> {
  if (process.env.DEV_ALLOW_SIMULATE_PAYOUTS === "1") {
    return { paymentHash: crypto.randomBytes(32).toString("hex"), feeSats: 0 };
  }
  const cfg = lndConfig();
  if (!cfg) throw new Error("LND not configured");
  const res = await fetchWithTimeout(
    `${cfg.baseUrl}/v1/channels/transactions`,
    {
      method: "POST",
      headers: {
        "Grpc-Metadata-Macaroon": cfg.macaroon,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ payment_request: bolt11 }),
      dispatcher: cfg.dispatcher
    } as any,
    15000,
    0
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`LND pay error: ${text}`);
  const data: any = text ? JSON.parse(text) : null;
  if (data?.payment_error) throw new Error(`LND pay error: ${data.payment_error}`);
  const feeMsat = Number(data?.payment_route?.total_fees_msat || 0);
  const feeSats = Number.isFinite(feeMsat) ? Math.round(feeMsat / 1000) : 0;
  return {
    paymentHash: String(data?.payment_hash || ""),
    feeSats
  };
}
