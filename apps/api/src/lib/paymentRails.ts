import crypto from "node:crypto";
import { createLightningInvoice, checkLightningInvoice } from "../payments/lightning.js";

export type PaymentRailType = "lightning_address" | "lnd";

export type RailInvoice = {
  paymentRequest: string;
  providerRef: string;
  expiresAt?: string | null;
};

export type RailConfirm = {
  status: "paid" | "unpaid" | "expired";
  paidAt?: string | null;
  paymentHash?: string | null;
  amountSats?: string | null;
  feesSats?: string | null;
};

export interface PaymentRail {
  kind: PaymentRailType;
  createInvoice(opts: { amountSats: bigint; memo: string; metadata?: Record<string, any> }): Promise<RailInvoice>;
  confirmPayment(opts: { providerRef: string; paymentRequest?: string | null }): Promise<RailConfirm>;
}

function isLocalHostName(host: string) {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h.endsWith(".local");
}

function lnurlpUrlForLightningAddress(address: string): string {
  const raw = address.trim();
  const parts = raw.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid lightning address");
  }
  const name = parts[0];
  const host = parts[1];
  const scheme = isLocalHostName(host) ? "http" : "https";
  return `${scheme}://${host}/.well-known/lnurlp/${encodeURIComponent(name)}`;
}

async function fetchLnurlPayRequest(lightningAddress: string) {
  const url = lnurlpUrlForLightningAddress(lightningAddress);
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } as any } as any);
  const text = await res.text();
  if (!res.ok) throw new Error(`LNURL pay request error: ${text}`);
  const json: any = text ? JSON.parse(text) : null;
  if (!json || json.tag !== "payRequest" || !json.callback) {
    throw new Error("LNURL pay request invalid");
  }
  return json;
}

async function fetchLnurlInvoice(callback: string, amountMsats: number, comment?: string | null) {
  const url = new URL(callback);
  url.searchParams.set("amount", String(amountMsats));
  if (comment) url.searchParams.set("comment", comment);
  const res = await fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" } as any } as any);
  const text = await res.text();
  if (!res.ok) throw new Error(`LNURL invoice error: ${text}`);
  const json: any = text ? JSON.parse(text) : null;
  if (!json || !json.pr) throw new Error("LNURL invoice missing pr");
  return json;
}

export class LightningAddressRail implements PaymentRail {
  kind: PaymentRailType = "lightning_address";
  private address: string;

  constructor(address: string) {
    this.address = address.trim();
  }

  async createInvoice(opts: { amountSats: bigint; memo: string }): Promise<RailInvoice> {
    const payReq = await fetchLnurlPayRequest(this.address);
    const msats = Number(opts.amountSats) * 1000;
    const minSendable = Number(payReq.minSendable || 0);
    const maxSendable = Number(payReq.maxSendable || 0);
    if (msats < minSendable || (maxSendable > 0 && msats > maxSendable)) {
      throw new Error("Amount outside LNURL pay range");
    }
    const inv = await fetchLnurlInvoice(payReq.callback, msats, opts.memo || null);
    const bolt11 = String(inv.pr || "");
    if (!bolt11) throw new Error("LNURL invoice missing pr");
    const providerRef = `lnaddr:${this.address}`;
    return { paymentRequest: bolt11, providerRef, expiresAt: null };
  }

  async confirmPayment(): Promise<RailConfirm> {
    if (process.env.DEV_ALLOW_SIMULATE_PAYMENTS === "1") {
      return { status: "paid", paidAt: new Date().toISOString(), paymentHash: crypto.randomBytes(32).toString("hex") };
    }
    return { status: "unpaid" };
  }
}

export class LndRail implements PaymentRail {
  kind: PaymentRailType = "lnd";

  async createInvoice(opts: { amountSats: bigint; memo: string }): Promise<RailInvoice> {
    const invoice = await createLightningInvoice(opts.amountSats, opts.memo);
    if (!invoice) throw new Error("Lightning not configured");
    return {
      paymentRequest: invoice.bolt11,
      providerRef: invoice.providerId,
      expiresAt: invoice.expiresAt || null
    };
  }

  async confirmPayment(opts: { providerRef: string }): Promise<RailConfirm> {
    const status = await checkLightningInvoice(opts.providerRef);
    if (status.paid) {
      return { status: "paid", paidAt: status.paidAt || new Date().toISOString() };
    }
    return { status: status.status === "expired" ? "expired" : "unpaid" };
  }
}

