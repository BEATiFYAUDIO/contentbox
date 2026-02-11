export type RailHealthStatus = "healthy" | "locked" | "degraded" | "disconnected" | "missing";

export type RailHealthResult = {
  status: RailHealthStatus;
  reason: string;
  hint?: string | null;
};

export function mapLightningErrorMessage(message: string): RailHealthResult {
  const msg = (message || "").toLowerCase();

  if (!msg) {
    return { status: "degraded", reason: "Unknown error", hint: null };
  }

  if (msg.includes("connection refused") || msg.includes("econnrefused") || msg.includes("fetch failed")) {
    return { status: "disconnected", reason: "LND REST is unreachable", hint: "Confirm lnd is running on 127.0.0.1:8080" };
  }

  if (msg.includes("wallet locked") || msg.includes("wallet is locked") || msg.includes("unavailable") || msg.includes("not unlocked")) {
    return { status: "locked", reason: "LND wallet is locked", hint: "Run: lncli unlock" };
  }

  if (msg.includes("signature mismatch") || msg.includes("verification failed") || msg.includes("macaroon")) {
    return {
      status: "degraded",
      reason: "Macaroon verification failed",
      hint: "Use the correct macaroon for this LND instance (invoice.macaroon or admin.macaroon)"
    };
  }

  if (msg.includes("certificate") || msg.includes("self signed") || msg.includes("tls") || msg.includes("ssl")) {
    return {
      status: "degraded",
      reason: "TLS verification failed",
      hint: "Check LND_TLS_CERT_PATH or switch to http:// if REST is not using TLS"
    };
  }

  return { status: "degraded", reason: message, hint: null };
}
