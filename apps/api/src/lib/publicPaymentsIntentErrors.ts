export type PublicPaymentsIntentMappedError = {
  statusCode: number;
  body: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  category: string;
};

type KnownError = {
  code?: string;
  message?: string;
  meta?: Record<string, unknown>;
};

function hasMessage(err: unknown, needle: string): boolean {
  const msg = String((err as KnownError)?.message || "");
  return msg.toLowerCase().includes(needle.toLowerCase());
}

export function mapPublicPaymentsIntentError(err: unknown): PublicPaymentsIntentMappedError {
  const e = (err || {}) as KnownError;
  const code = String(e.code || "");

  if (code === "P2002") {
    return {
      statusCode: 409,
      category: "duplicate",
      body: {
        code: "PENDING_PURCHASE_EXISTS",
        message: "A pending payment already exists for this content."
      }
    };
  }

  if (code === "P2021" || code === "P2022") {
    return {
      statusCode: 503,
      category: "db_not_ready",
      body: {
        code: "PAYMENTS_NOT_READY",
        message: "Payment storage is not initialized. Complete bootstrap and retry."
      }
    };
  }

  if (hasMessage(err, "NODE_NOT_CONFIGURED") || hasMessage(err, "NODE_MACAROON_MISSING")) {
    return {
      statusCode: 502,
      category: "lightning_not_configured",
      body: {
        code: "LIGHTNING_NOT_CONFIGURED",
        message: "Lightning is not configured on this node."
      }
    };
  }

  if (
    hasMessage(err, "ECONNREFUSED") ||
    hasMessage(err, "ETIMEDOUT") ||
    hasMessage(err, "CERT") ||
    hasMessage(err, "TLS") ||
    hasMessage(err, "UNAUTHORIZED")
  ) {
    return {
      statusCode: 502,
      category: "lightning_unavailable",
      body: {
        code: "LIGHTNING_UNAVAILABLE",
        message: "Lightning is temporarily unavailable."
      }
    };
  }

  return {
    statusCode: 500,
    category: "unknown",
    body: {
      code: "PAYMENT_INTENT_INTERNAL_ERROR",
      message: "Internal Server Error"
    }
  };
}
