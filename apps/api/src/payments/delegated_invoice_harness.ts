import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";

type JsonObject = Record<string, unknown>;

type HttpResult<T = any> = {
  status: number;
  ok: boolean;
  url: string;
  json: T | null;
  text: string;
  headers: Headers;
  elapsedMs: number;
};

type RuntimeTruth = {
  delegatedInvoiceSupport: boolean | null;
  providerConfigured: boolean | null;
  providerUrl: string | null;
  trustAllowed: boolean | null;
  computedDelegatedSupport: boolean | null;
};

type DelegatedCreateResponse = {
  ok: boolean;
  paymentIntentId: string;
  bolt11: string | null;
  providerInvoiceRef: string | null;
  status: string;
};

type DelegatedStatusResponse = {
  ok: boolean;
  paymentIntentId: string;
  status: string;
  paid: boolean;
  paidAt: string | null;
  paymentReceiptId: string | null;
};

type ProviderIntentRow = {
  id: string;
  paymentIntentId: string;
  bolt11: string | null;
  providerInvoiceRef: string | null;
  status: string;
};

type HarnessConfig = {
  providerBaseUrl: string;
  creatorApiBaseUrl: string;
  contentId: string;
  creatorNodeId: string;
  amountSats: string;
  paymentIntentId: string;
  buyerSessionId: string | null;
  timeoutMs: number;
  pollIntervalMs: number;
  pollAttempts: number;
  expectSettled: boolean;
  expectUiConsistent: boolean;
  creatorAuthToken: string | null;
  providerAuthToken: string | null;
  creatorPaymentIntentId: string | null;
  creatorReceiptToken: string | null;
};

type Warning = {
  code: string;
  message: string;
  route?: string;
  detail?: unknown;
};

type UiPaymentAccessProof = {
  contentId?: string | null;
  paymentState?: string | null;
  entitlementState?: string | null;
  paymentReceiptId?: string | null;
  paidAt?: string | null;
  paymentMethod?: string | null;
  invoiceProviderNodeId?: string | null;
  bolt11?: string | null;
  providerInvoiceRef?: string | null;
  paymentIntentId?: string | null;
};

function requiredEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnv(name: string): string | null {
  const value = String(process.env[name] || "").trim();
  return value || null;
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
  return Math.floor(n);
}

function sanitizeBaseUrl(input: string): string {
  return input.replace(/\/+$/, "");
}

function buildConfig(): HarnessConfig {
  const providerBaseUrl = sanitizeBaseUrl(requiredEnv("PROVIDER_BASE_URL"));
  const creatorApiBaseUrl = sanitizeBaseUrl(optionalEnv("CREATOR_API_BASE_URL") || providerBaseUrl);
  const contentId = requiredEnv("CONTENT_ID");
  const creatorNodeId = requiredEnv("CREATOR_NODE_ID");
  const amountSats = requiredEnv("AMOUNT_SATS");
  if (!/^\d+$/.test(amountSats) || Number(amountSats) <= 0) {
    throw new Error("AMOUNT_SATS must be a positive integer");
  }
  const paymentIntentId = optionalEnv("PAYMENT_INTENT_ID") || `qa_pi_${crypto.randomBytes(6).toString("hex")}`;
  return {
    providerBaseUrl,
    creatorApiBaseUrl,
    contentId,
    creatorNodeId,
    amountSats,
    paymentIntentId,
    buyerSessionId: optionalEnv("BUYER_SESSION_ID"),
    timeoutMs: parsePositiveIntEnv("FETCH_TIMEOUT_MS", 8000),
    pollIntervalMs: parsePositiveIntEnv("POLL_INTERVAL_MS", 2000),
    pollAttempts: parsePositiveIntEnv("POLL_ATTEMPTS", 10),
    expectSettled: String(process.env.EXPECT_SETTLED || "").trim() === "1",
    expectUiConsistent: String(process.env.EXPECT_UI_CONSISTENT || "").trim() === "1",
    creatorAuthToken: optionalEnv("CREATOR_AUTH_TOKEN"),
    providerAuthToken: optionalEnv("PROVIDER_AUTH_TOKEN"),
    creatorPaymentIntentId: optionalEnv("CREATOR_PAYMENT_INTENT_ID"),
    creatorReceiptToken: optionalEnv("CREATOR_RECEIPT_TOKEN")
  };
}

async function fetchJson<T = any>(
  url: string,
  input: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs: number }
): Promise<HttpResult<T>> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const res = await fetch(url, {
      method: input.method || "GET",
      headers: input.headers,
      body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
      signal: controller.signal
    });
    const text = await res.text();
    let json: T | null = null;
    try {
      json = text ? (JSON.parse(text) as T) : null;
    } catch {
      json = null;
    }
    return {
      status: res.status,
      ok: res.ok,
      url,
      json,
      text,
      headers: res.headers,
      elapsedMs: Date.now() - started
    };
  } finally {
    clearTimeout(timeout);
  }
}

function assertJsonObject(result: HttpResult, label: string): asserts result is HttpResult<JsonObject> {
  assert.ok(result.json && typeof result.json === "object", `${label} must return JSON object`);
}

async function readRuntimeTruth(cfg: HarnessConfig, warnings: Warning[]): Promise<RuntimeTruth> {
  const truth: RuntimeTruth = {
    delegatedInvoiceSupport: null,
    providerConfigured: null,
    providerUrl: null,
    trustAllowed: null,
    computedDelegatedSupport: null
  };

  if (!cfg.creatorAuthToken) {
    warnings.push({
      code: "CREATOR_AUTH_TOKEN_MISSING",
      message: "Runtime truth check skipped: CREATOR_AUTH_TOKEN missing."
    });
    return truth;
  }

  const authHeader = { Authorization: `Bearer ${cfg.creatorAuthToken}` };

  const summary = await fetchJson<JsonObject>(`${cfg.creatorApiBaseUrl}/api/network/summary`, {
    headers: authHeader,
    timeoutMs: cfg.timeoutMs
  });
  if (summary.status === 200) {
    assertJsonObject(summary, "/api/network/summary");
    const summaryJson = summary.json as JsonObject;
    truth.delegatedInvoiceSupport = Boolean(
      (summaryJson.paymentCapability as JsonObject | undefined)?.delegatedInvoiceSupport
    );
    truth.providerConfigured = Boolean((summaryJson.providerBinding as JsonObject | undefined)?.configured);
  } else {
    warnings.push({
      code: "SUMMARY_UNAVAILABLE",
      message: "Could not read /api/network/summary",
      route: "/api/network/summary",
      detail: { status: summary.status, body: summary.json || summary.text }
    });
  }

  const providerCfg = await fetchJson<JsonObject>(`${cfg.creatorApiBaseUrl}/api/network/provider`, {
    headers: authHeader,
    timeoutMs: cfg.timeoutMs
  });
  if (providerCfg.status === 200) {
    assertJsonObject(providerCfg, "/api/network/provider");
    const providerCfgJson = providerCfg.json as JsonObject;
    truth.providerUrl = String(providerCfgJson.providerUrl || "").trim() || null;
    if (truth.providerConfigured == null) {
      truth.providerConfigured = Boolean(providerCfgJson.configured);
    }
  } else {
    warnings.push({
      code: "PROVIDER_CONFIG_UNAVAILABLE",
      message: "Could not read /api/network/provider",
      route: "/api/network/provider",
      detail: { status: providerCfg.status, body: providerCfg.json || providerCfg.text }
    });
  }

  const trust = await fetchJson<JsonObject>(`${cfg.creatorApiBaseUrl}/api/network/provider/trust-readiness`, {
    headers: authHeader,
    timeoutMs: cfg.timeoutMs
  });
  if (trust.status === 200) {
    assertJsonObject(trust, "/api/network/provider/trust-readiness");
    const trustJson = trust.json as JsonObject;
    truth.trustAllowed = Boolean(trustJson.allowed);
  } else {
    warnings.push({
      code: "TRUST_READINESS_UNAVAILABLE",
      message: "Could not read provider trust readiness",
      route: "/api/network/provider/trust-readiness",
      detail: { status: trust.status, body: trust.json || trust.text }
    });
  }

  truth.computedDelegatedSupport =
    truth.providerUrl != null && truth.providerUrl.length > 0 && truth.trustAllowed != null
      ? Boolean(truth.trustAllowed)
      : null;

  if (
    truth.delegatedInvoiceSupport != null &&
    truth.computedDelegatedSupport != null &&
    truth.delegatedInvoiceSupport !== truth.computedDelegatedSupport
  ) {
    warnings.push({
      code: "DELEGATED_SUPPORT_MISMATCH",
      message: "delegatedInvoiceSupport does not match runtime computed truth",
      detail: {
        delegatedInvoiceSupport: truth.delegatedInvoiceSupport,
        computedDelegatedSupport: truth.computedDelegatedSupport,
        providerUrl: truth.providerUrl,
        trustAllowed: truth.trustAllowed
      }
    });
  }

  return truth;
}

async function createDelegatedIntent(cfg: HarnessConfig): Promise<HttpResult<DelegatedCreateResponse>> {
  return fetchJson<DelegatedCreateResponse>(`${cfg.providerBaseUrl}/public/provider/payment-intents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: {
      creatorNodeId: cfg.creatorNodeId,
      contentId: cfg.contentId,
      amountSats: cfg.amountSats,
      paymentIntentId: cfg.paymentIntentId,
      buyerSessionId: cfg.buyerSessionId
    },
    timeoutMs: cfg.timeoutMs
  });
}

async function pollDelegatedStatus(
  cfg: HarnessConfig,
  paymentIntentId: string
): Promise<{ final: HttpResult<DelegatedStatusResponse>; attempts: HttpResult<DelegatedStatusResponse>[] }> {
  const attempts: HttpResult<DelegatedStatusResponse>[] = [];
  let final: HttpResult<DelegatedStatusResponse> | null = null;
  for (let i = 0; i < cfg.pollAttempts; i += 1) {
    const res = await fetchJson<DelegatedStatusResponse>(
      `${cfg.providerBaseUrl}/public/provider/payment-intents/${encodeURIComponent(paymentIntentId)}/status`,
      {
        method: "GET",
        timeoutMs: cfg.timeoutMs
      }
    );
    attempts.push(res);
    final = res;
    if (res.status === 200 && (res.json as any)?.paid === true) break;
    if (i < cfg.pollAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, cfg.pollIntervalMs));
    }
  }
  assert.ok(final, "status polling must produce at least one response");
  return { final, attempts };
}

async function fetchProviderIntentRow(cfg: HarnessConfig, paymentIntentId: string): Promise<ProviderIntentRow | null> {
  if (!cfg.providerAuthToken) return null;
  const result = await fetchJson<JsonObject>(`${cfg.providerBaseUrl}/api/provider/payments/intents`, {
    headers: { Authorization: `Bearer ${cfg.providerAuthToken}` },
    timeoutMs: cfg.timeoutMs
  });
  if (result.status !== 200 || !result.json) return null;
  const items = Array.isArray((result.json as any).items) ? ((result.json as any).items as any[]) : [];
  const row = items.find((item) => String(item?.paymentIntentId || "") === paymentIntentId);
  if (!row) return null;
  return {
    id: String(row.id || ""),
    paymentIntentId: String(row.paymentIntentId || ""),
    bolt11: String(row.bolt11 || "").trim() || null,
    providerInvoiceRef: String(row.providerInvoiceRef || "").trim() || null,
    status: String(row.status || "").trim() || "unknown"
  };
}

async function fetchCreatorIntentState(
  cfg: HarnessConfig,
  paymentIntentId: string
): Promise<{ status: number; body: JsonObject | null }> {
  if (!cfg.creatorReceiptToken) return { status: 0, body: null };
  const intentId = cfg.creatorPaymentIntentId || paymentIntentId;
  const result = await fetchJson<JsonObject>(`${cfg.creatorApiBaseUrl}/api/payments/intents/${encodeURIComponent(intentId)}`, {
    method: "GET",
    headers: { "x-receipt-token": cfg.creatorReceiptToken },
    timeoutMs: cfg.timeoutMs
  });
  return { status: result.status, body: result.json };
}

function firstSetCookie(headers: Headers): string | null {
  const raw = headers.get("set-cookie");
  if (!raw) return null;
  return raw.split(",")[0] || raw;
}

function cookieFromSetCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  return setCookie.split(";")[0] || null;
}

async function fetchUiPaymentAccessProof(cfg: HarnessConfig): Promise<{ status: number; proof: UiPaymentAccessProof | null; raw: unknown }> {
  const boot = await fetchJson<JsonObject>(`${cfg.creatorApiBaseUrl}/api/buyer/bootstrap`, {
    method: "POST",
    timeoutMs: cfg.timeoutMs
  });
  if (boot.status !== 200) {
    return { status: boot.status, proof: null, raw: boot.json || boot.text };
  }
  const buyerCookie = cookieFromSetCookie(firstSetCookie(boot.headers));
  if (!buyerCookie) {
    return { status: 0, proof: null, raw: "buyer cookie missing from /api/buyer/bootstrap" };
  }

  const offer = await fetchJson<JsonObject>(`${cfg.creatorApiBaseUrl}/buy/content/${encodeURIComponent(cfg.contentId)}/offer`, {
    method: "GET",
    headers: { Cookie: buyerCookie },
    timeoutMs: cfg.timeoutMs
  });
  if (offer.status !== 200 || !offer.json) {
    return { status: offer.status, proof: null, raw: offer.json || offer.text };
  }
  const proof = ((offer.json as any).paymentAccessProof || null) as UiPaymentAccessProof | null;
  return { status: offer.status, proof, raw: offer.json };
}

function isUiPaidState(paymentState: string | null | undefined, entitlementState: string | null | undefined): boolean {
  const p = String(paymentState || "").toLowerCase();
  const e = String(entitlementState || "").toLowerCase();
  return p === "paid" || p === "owned" || p === "unlocked" || e === "entitled";
}

function formatNow(): string {
  return new Date().toISOString();
}

async function main() {
  const cfg = buildConfig();
  const warnings: Warning[] = [];

  console.log(`[${formatNow()}] delegated-invoice-harness start`);
  console.log(
    JSON.stringify(
      {
        providerBaseUrl: cfg.providerBaseUrl,
        creatorApiBaseUrl: cfg.creatorApiBaseUrl,
        contentId: cfg.contentId,
        creatorNodeId: cfg.creatorNodeId,
        amountSats: cfg.amountSats,
        paymentIntentId: cfg.paymentIntentId,
        pollAttempts: cfg.pollAttempts,
        pollIntervalMs: cfg.pollIntervalMs,
        timeoutMs: cfg.timeoutMs
      },
      null,
      2
    )
  );

  // Delegated lifecycle summary:
  // 1) creator/buyer path asks provider for delegated invoice using /public/provider/payment-intents.
  // 2) provider emits bolt11 + providerInvoiceRef (invoice identity on provider rail).
  // 3) caller polls /public/provider/payment-intents/:id/status until paid.
  // 4) creator/local payment intent + UI paymentAccessProof should reconcile with provider invoice state.
  //
  // Warning codes:
  // - *_MISMATCH => data disagreement between sources
  // - *_MISSING  => required field absent
  // - *_UNREACHABLE / *_UNAVAILABLE => transport/runtime access problems
  const runtimeTruth = await readRuntimeTruth(cfg, warnings);

  const created = await createDelegatedIntent(cfg);
  assertJsonObject(created, "POST /public/provider/payment-intents");
  if (created.status >= 500) {
    warnings.push({
      code: "PROVIDER_UNREACHABLE",
      message: "Provider returned 5xx when creating delegated intent",
      route: "/public/provider/payment-intents",
      detail: { status: created.status, body: created.json || created.text }
    });
  }
  if (created.status !== 200) {
    console.log(
      JSON.stringify(
        {
          success: false,
          stage: "create",
          route: "/public/provider/payment-intents",
          status: created.status,
          body: created.json || created.text,
          runtimeTruth,
          warnings
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const createJson = created.json;
  assert.ok(createJson, "create response JSON missing");
  assert.ok(typeof createJson.paymentIntentId === "string" && createJson.paymentIntentId.length > 0, "paymentIntentId missing");
  const delegatedIntentId = createJson.paymentIntentId;
  if (!createJson.bolt11) {
    warnings.push({
      code: "DELEGATED_INVOICE_NOT_ISSUED",
      message: "Delegated intent created but bolt11 is missing",
      route: "/public/provider/payment-intents",
      detail: createJson
    });
  }
  if (!createJson.providerInvoiceRef) {
    warnings.push({
      code: "PROVIDER_INVOICE_REF_MISSING",
      message: "providerInvoiceRef missing on delegated create response",
      route: "/public/provider/payment-intents",
      detail: createJson
    });
  }

  const polled = await pollDelegatedStatus(cfg, delegatedIntentId);
  const finalStatus = polled.final;
  assertJsonObject(finalStatus, "GET /public/provider/payment-intents/:paymentIntentId/status");
  if (finalStatus.status !== 200) {
    console.log(
      JSON.stringify(
        {
          success: false,
          stage: "status",
          route: "/public/provider/payment-intents/:paymentIntentId/status",
          status: finalStatus.status,
          body: finalStatus.json || finalStatus.text,
          attempts: polled.attempts.map((a) => ({ status: a.status, body: a.json || a.text })),
          runtimeTruth,
          warnings
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const providerRow = await fetchProviderIntentRow(cfg, delegatedIntentId);
  const creatorIntent = await fetchCreatorIntentState(cfg, delegatedIntentId);
  const uiOffer = await fetchUiPaymentAccessProof(cfg);
  const uiPaymentAccessProof = uiOffer.proof;

  if (providerRow) {
    if ((providerRow.bolt11 || null) !== (createJson.bolt11 || null)) {
      warnings.push({
        code: "BOLT11_MISMATCH",
        message: "Provider API row bolt11 differs from delegated create response",
        detail: { createBolt11: createJson.bolt11, providerBolt11: providerRow.bolt11, paymentIntentId: delegatedIntentId }
      });
    }
    if ((providerRow.providerInvoiceRef || null) !== (createJson.providerInvoiceRef || null)) {
      warnings.push({
        code: "PROVIDER_REF_MISMATCH",
        message: "Provider API row providerInvoiceRef differs from delegated create response",
        detail: {
          createProviderInvoiceRef: createJson.providerInvoiceRef,
          providerProviderInvoiceRef: providerRow.providerInvoiceRef,
          paymentIntentId: delegatedIntentId
        }
      });
    }
  } else if (cfg.providerAuthToken) {
    warnings.push({
      code: "PROVIDER_INTENT_ROW_MISSING",
      message: "Provider authenticated list did not include delegated paymentIntentId",
      route: "/api/provider/payments/intents",
      detail: { paymentIntentId: delegatedIntentId }
    });
  }

  if (cfg.expectSettled && !(finalStatus.json as DelegatedStatusResponse).paid) {
    warnings.push({
      code: "SETTLEMENT_TIMEOUT",
      message: "Intent did not settle within polling window",
      route: "/public/provider/payment-intents/:paymentIntentId/status",
      detail: { paymentIntentId: delegatedIntentId, pollAttempts: cfg.pollAttempts, pollIntervalMs: cfg.pollIntervalMs }
    });
  }

  if (creatorIntent.status > 0) {
    const creatorBolt11 = String((creatorIntent.body as any)?.lightning?.bolt11 || "").trim() || null;
    const creatorStatus = String((creatorIntent.body as any)?.status || "").trim() || null;
    if (createJson.bolt11 && creatorBolt11 && creatorBolt11 !== createJson.bolt11) {
      warnings.push({
        code: "LOCAL_PROVIDER_MISMATCH",
        message: "Creator local payment intent bolt11 differs from provider-issued bolt11",
        route: "/api/payments/intents/:id",
        detail: {
          paymentIntentId: delegatedIntentId,
          providerBolt11: createJson.bolt11,
          creatorBolt11,
          creatorStatus
        }
      });
    }
  }

  if (uiOffer.status !== 200) {
    warnings.push({
      code: "UI_OFFER_UNAVAILABLE",
      message: "Could not fetch /buy/content/:id/offer for UI reconciliation",
      route: "/buy/content/:id/offer",
      detail: { status: uiOffer.status, body: uiOffer.raw }
    });
  } else if (!uiPaymentAccessProof) {
    warnings.push({
      code: "UI_PAYMENT_ACCESS_PROOF_MISSING",
      message: "Offer response missing paymentAccessProof",
      route: "/buy/content/:id/offer",
      detail: uiOffer.raw
    });
  } else {
    const uiBolt11 = String(uiPaymentAccessProof.bolt11 || "").trim() || null;
    const uiProviderRef = String(uiPaymentAccessProof.providerInvoiceRef || "").trim() || null;
    const uiIntentId = String(uiPaymentAccessProof.paymentIntentId || "").trim() || null;
    const uiPaid = isUiPaidState(uiPaymentAccessProof.paymentState, uiPaymentAccessProof.entitlementState);
    const providerPaid = Boolean((finalStatus.json as DelegatedStatusResponse).paid);

    // Compare raw invoice identity fields when UI exposes them.
    if (uiBolt11 && (createJson.bolt11 || null) !== uiBolt11) {
      warnings.push({
        code: "UI_MISMATCH_BOLT11",
        message: "UI paymentAccessProof bolt11 differs from delegated/provider value",
        route: "/buy/content/:id/offer",
        detail: { uiBolt11, delegatedBolt11: createJson.bolt11, paymentIntentId: delegatedIntentId }
      });
    }

    if (uiProviderRef && (createJson.providerInvoiceRef || null) !== uiProviderRef) {
      warnings.push({
        code: "UI_MISMATCH_PROVIDER_REF",
        message: "UI paymentAccessProof providerInvoiceRef differs from delegated/provider value",
        route: "/buy/content/:id/offer",
        detail: {
          uiProviderRef,
          delegatedProviderRef: createJson.providerInvoiceRef,
          paymentIntentId: delegatedIntentId
        }
      });
    }

    if (uiIntentId && uiIntentId !== delegatedIntentId) {
      warnings.push({
        code: "UI_MISMATCH_STATUS",
        message: "UI paymentAccessProof paymentIntentId does not match delegated intent id",
        route: "/buy/content/:id/offer",
        detail: { uiIntentId, delegatedIntentId }
      });
    }

    if (cfg.expectSettled && providerPaid !== uiPaid) {
      warnings.push({
        code: "UI_MISMATCH_STATUS",
        message: "UI payment/access state does not reflect provider settled state",
        route: "/buy/content/:id/offer",
        detail: {
          providerPaid,
          uiPaid,
          paymentState: uiPaymentAccessProof.paymentState || null,
          entitlementState: uiPaymentAccessProof.entitlementState || null
        }
      });
    }
  }

  const failureCodes = new Set(
    warnings
      .map((w) => w.code)
      .filter((code) => code.endsWith("MISMATCH") || code.includes("MISSING") || code.includes("UNREACHABLE"))
  );
  if (!cfg.expectUiConsistent) {
    failureCodes.delete("UI_MISMATCH_BOLT11");
    failureCodes.delete("UI_MISMATCH_PROVIDER_REF");
    failureCodes.delete("UI_MISMATCH_STATUS");
  }
  const success = failureCodes.size === 0;

  console.log(
    JSON.stringify(
      {
        success,
        runtimeTruth,
        delegatedIntent: {
          paymentIntentId: delegatedIntentId,
          bolt11: createJson.bolt11,
          providerInvoiceRef: createJson.providerInvoiceRef,
          createStatus: createJson.status
        },
        status: finalStatus.json,
        providerRow,
        creatorIntent,
        uiPaymentAccessProof,
        warnings
      },
      null,
      2
    )
  );

  if (!success) process.exit(1);
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        error: String((err as any)?.message || err),
        stack: (err as any)?.stack || null
      },
      null,
      2
    )
  );
  process.exit(1);
});
