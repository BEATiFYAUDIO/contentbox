import fsSync from "node:fs";
import { Agent } from "undici";

export type InvoiceCreateOptions = {
  amountSats: number;
  memo: string;
  expiresInSeconds: number;
  metadata?: Record<string, any>;
};

export type InvoiceCreateResult = {
  invoiceId: string;
  bolt11: string;
  paymentHash: string;
  expiresAt: string;
};

export type InvoiceStatus = {
  status: "unpaid" | "paid" | "expired";
  paidAt?: string | null;
  settleIndex?: string | null;
  preimage?: string | null;
};

export interface PaymentProvider {
  kind: "lnd" | "btcpay" | "none";
  createInvoice(opts: InvoiceCreateOptions): Promise<InvoiceCreateResult>;
  getInvoiceStatus(invoiceId: string): Promise<InvoiceStatus>;
  getNodeInfo?(): Promise<{ alias?: string | null; pubkey?: string | null; network?: string | null }>;
}

function readMaybeFile(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("BEGIN CERTIFICATE") || trimmed.includes("BEGIN")) return trimmed;
  if (fsSync.existsSync(trimmed)) {
    try {
      return fsSync.readFileSync(trimmed, "utf8");
    } catch {
      return null;
    }
  }
  return trimmed;
}

class LndProvider implements PaymentProvider {
  kind: "lnd" = "lnd";
  private baseUrl: string;
  private macaroon: string | null;
  private dispatcher?: Agent;

  constructor() {
    this.baseUrl = String(process.env.LND_REST_URL || "").replace(/\/$/, "");
    const macVal = process.env.LND_MACAROON_HEX || process.env.LND_MACAROON || "";
    this.macaroon = readMaybeFile(macVal);

    const cert = readMaybeFile(process.env.LND_TLS_CERT_PATH || process.env.LND_TLS_CERT_PEM || "");
    if (cert) {
      this.dispatcher = new Agent({
        connect: {
          ca: cert
        }
      });
    }
  }

  private ensureConfig() {
    if (!this.baseUrl) throw new Error("LND_REST_URL not configured");
    if (!this.macaroon) throw new Error("LND_MACAROON_HEX (or file path) not configured");
  }

  private headers() {
    return {
      "Grpc-Metadata-Macaroon": this.macaroon as string,
      "Content-Type": "application/json"
    };
  }

  async createInvoice(opts: InvoiceCreateOptions): Promise<InvoiceCreateResult> {
    this.ensureConfig();
    const resp = await fetch(`${this.baseUrl}/v1/invoices`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        value: opts.amountSats,
        memo: opts.memo,
        expiry: opts.expiresInSeconds,
        private: true
      }),
      dispatcher: this.dispatcher
    } as any);

    const text = await resp.text();
    if (!resp.ok) throw new Error(`LND invoice error: ${text}`);
    const data: any = text ? JSON.parse(text) : null;

    const paymentHash = data?.r_hash ? Buffer.from(data.r_hash, "base64").toString("hex") : "";
    const bolt11 = data?.payment_request || "";
    if (!paymentHash || !bolt11) throw new Error("LND invoice response missing fields");

    const expiresAt = new Date(Date.now() + opts.expiresInSeconds * 1000).toISOString();
    return {
      invoiceId: paymentHash,
      bolt11,
      paymentHash,
      expiresAt
    };
  }

  async getInvoiceStatus(invoiceId: string): Promise<InvoiceStatus> {
    this.ensureConfig();
    const resp = await fetch(`${this.baseUrl}/v1/invoice/${encodeURIComponent(invoiceId)}`, {
      method: "GET",
      headers: this.headers(),
      dispatcher: this.dispatcher
    } as any);

    const text = await resp.text();
    if (!resp.ok) throw new Error(`LND invoice status error: ${text}`);
    const data: any = text ? JSON.parse(text) : null;

    const settled = Boolean(data?.settled);
    const state = String(data?.state || "").toUpperCase();
    if (settled || state === "SETTLED") {
      const paidAt = data?.settle_date ? new Date(Number(data.settle_date) * 1000).toISOString() : null;
      return { status: "paid", paidAt };
    }
    if (state === "CANCELED" || state === "EXPIRED") {
      return { status: "expired" };
    }
    return { status: "unpaid" };
  }
}

class BtcpayProvider implements PaymentProvider {
  kind: "btcpay" = "btcpay";
  private baseUrl: string;
  private apiKey: string;
  private storeId: string;

  constructor() {
    this.baseUrl = String(process.env.BTCPAY_URL || "").replace(/\/$/, "");
    this.apiKey = String(process.env.BTCPAY_API_KEY || "");
    this.storeId = String(process.env.BTCPAY_STORE_ID || "");
  }

  private ensureConfig() {
    if (!this.baseUrl || !this.apiKey || !this.storeId) {
      throw new Error("BTCPAY_URL/BTCPAY_API_KEY/BTCPAY_STORE_ID not configured");
    }
  }

  private headers() {
    return {
      Authorization: `token ${this.apiKey}`,
      "Content-Type": "application/json"
    };
  }

  async createInvoice(opts: InvoiceCreateOptions): Promise<InvoiceCreateResult> {
    this.ensureConfig();
    const expirationMinutes = Math.max(1, Math.round(opts.expiresInSeconds / 60));
    const createResp = await fetch(`${this.baseUrl}/api/v1/stores/${this.storeId}/invoices`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        amount: opts.amountSats,
        currency: "SATS",
        metadata: opts.metadata || {},
        checkout: { expirationMinutes }
      })
    });

    const text = await createResp.text();
    if (!createResp.ok) throw new Error(`BTCPay invoice error: ${text}`);
    const data: any = text ? JSON.parse(text) : null;

    const invoiceId = data?.id || "";
    if (!invoiceId) throw new Error("BTCPay invoice response missing id");

    let bolt11 = "";
    try {
      const pm = await fetch(`${this.baseUrl}/api/v1/stores/${this.storeId}/invoices/${invoiceId}/payment-methods`, {
        method: "GET",
        headers: this.headers()
      });
      const pmText = await pm.text();
      if (pm.ok) {
        const arr: any[] = pmText ? JSON.parse(pmText) : [];
        for (const method of arr) {
          const code = String(method?.paymentMethod || method?.paymentMethodId || "");
          if (code.toLowerCase().includes("lightning")) {
            bolt11 = method?.paymentMethodData?.paymentRequest || method?.invoice?.paymentRequest || "";
            break;
          }
        }
      }
    } catch {
      // ignore
    }

    const expiresAt = data?.expirationTime
      ? new Date(Number(data.expirationTime) * 1000).toISOString()
      : new Date(Date.now() + opts.expiresInSeconds * 1000).toISOString();

    return {
      invoiceId,
      bolt11,
      paymentHash: invoiceId,
      expiresAt
    };
  }

  async getInvoiceStatus(invoiceId: string): Promise<InvoiceStatus> {
    this.ensureConfig();
    const resp = await fetch(`${this.baseUrl}/api/v1/stores/${this.storeId}/invoices/${invoiceId}`, {
      method: "GET",
      headers: this.headers()
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`BTCPay status error: ${text}`);
    const data: any = text ? JSON.parse(text) : null;
    const status = String(data?.status || "").toLowerCase();
    if (status === "paid" || status === "settled") {
      const paidAt = data?.paidTime ? new Date(Number(data.paidTime) * 1000).toISOString() : null;
      return { status: "paid", paidAt };
    }
    if (status === "expired" || status === "invalid") return { status: "expired" };
    return { status: "unpaid" };
  }
}

class NoneProvider implements PaymentProvider {
  kind: "none" = "none";
  async createInvoice(): Promise<InvoiceCreateResult> {
    throw new Error("Payments are disabled (PAYMENT_PROVIDER=none)");
  }
  async getInvoiceStatus(): Promise<InvoiceStatus> {
    return { status: "expired" };
  }
}

export function createPaymentProvider(): PaymentProvider {
  const kind = String(process.env.PAYMENT_PROVIDER || "lnd").toLowerCase();
  if (kind === "btcpay") return new BtcpayProvider();
  if (kind === "none") return new NoneProvider();
  return new LndProvider();
}
