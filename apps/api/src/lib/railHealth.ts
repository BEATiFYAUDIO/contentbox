export function mapLightningErrorMessage(message: string) {
  const msg = (message || "").toLowerCase();
  if (msg.includes("wallet locked") || msg.includes("unlock")) {
    return { status: "locked", reason: "Wallet locked", hint: "Run lncli unlock" };
  }
  if (msg.includes("macaroon") || msg.includes("signature mismatch") || msg.includes("permission denied")) {
    return { status: "authFailed", reason: "Macaroon auth failed", hint: "Use the correct macaroon for this LND instance" };
  }
  if (msg.includes("self signed") || msg.includes("certificate") || msg.includes("tls") || msg.includes("ssl")) {
    return { status: "tlsError", reason: "TLS error", hint: "Check tls.cert and REST URL scheme" };
  }
  if (msg.includes("econnrefused") || msg.includes("connection refused")) {
    return { status: "disconnected", reason: "LND not reachable", hint: "Check LND_REST_URL and service status" };
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return { status: "disconnected", reason: "Timeout", hint: "Check LND REST connectivity" };
  }
  return { status: "degraded", reason: message || "LND error", hint: null };
}
