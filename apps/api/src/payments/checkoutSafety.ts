const messages = {
  LIGHTNING_RECEIVE_UNAVAILABLE: "Lightning receiving readiness could not be verified. Please try again later.",
  LIGHTNING_NODE_NOT_SYNCED: "Lightning checkout is unavailable while the receiving node is syncing.",
  LIGHTNING_NO_ACTIVE_CHANNEL: "Lightning checkout is unavailable because the receiving node has no active channel.",
  LIGHTNING_INBOUND_CAPACITY_REQUIRED: "Lightning checkout is unavailable because the receiving node lacks capacity for this payment.",
  LIGHTNING_INVOICE_UNAVAILABLE: "A Lightning invoice could not be issued. Please try again later.",
  PAYMENT_VERIFICATION_UNAVAILABLE: "Payment confirmation is temporarily unavailable. Keep the existing invoice; do not pay again."
} as const;

export type CheckoutFailureCode = keyof typeof messages;

export function isCheckoutFailureCode(code: unknown): code is CheckoutFailureCode {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(messages, code);
}

export class CheckoutSafetyError extends Error {
  readonly statusCode = 503;
  constructor(readonly code: CheckoutFailureCode) {
    super(messages[code]);
    this.name = "CheckoutSafetyError";
  }
}

export function checkoutFailureBody(error: unknown, fallback: CheckoutFailureCode = "LIGHTNING_INVOICE_UNAVAILABLE") {
  const code = error instanceof CheckoutSafetyError ? error.code : fallback;
  return { ok: false, error: code, code, message: messages[code] };
}

function unsigned(value: unknown): bigint | null {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  const text = String(value ?? "");
  return /^\d+$/.test(text) ? BigInt(text) : null;
}

// A current local capacity check, not a promise that the payer has a route.
// Local funds and balances in inactive/pending channels cannot receive payment.
export function lndReceiveFailure(getinfo: any, response: any, amountSats: bigint): CheckoutFailureCode | null {
  if (!getinfo || !Array.isArray(response?.channels) || amountSats <= 0n) return "LIGHTNING_RECEIVE_UNAVAILABLE";
  if (getinfo.synced_to_chain !== true || getinfo.synced_to_graph !== true) return "LIGHTNING_NODE_NOT_SYNCED";
  const active = response.channels.filter((c: any) => c?.active === true);
  if (!active.length) return "LIGHTNING_NO_ACTIVE_CHANNEL";
  let capacity = 0n;
  for (const channel of active) {
    const remote = unsigned(channel.remote_balance);
    const reserve = unsigned(channel.remote_constraints?.chan_reserve_sat ?? channel.remote_chan_reserve_sat);
    if (remote === null || reserve === null) return "LIGHTNING_RECEIVE_UNAVAILABLE";
    capacity += remote > reserve ? remote - reserve : 0n;
  }
  return capacity >= amountSats ? null : "LIGHTNING_INBOUND_CAPACITY_REQUIRED";
}

export function verifiedLndInvoice(data: any, paymentHashHex: string, expectedAmountSats?: bigint) {
  const fail = () => { throw new CheckoutSafetyError("PAYMENT_VERIFICATION_UNAVAILABLE"); };
  const returnedHash = typeof data?.r_hash === "string" ? Buffer.from(data.r_hash, "base64").toString("hex") : "";
  if (returnedHash !== paymentHashHex.toLowerCase()) return fail();
  const state = String(data?.state || "").toUpperCase();
  if (!["OPEN", "ACCEPTED", "SETTLED", "CANCELED"].includes(state)) return fail();
  const value = unsigned(data.value);
  if (value === null || (expectedAmountSats !== undefined && value !== expectedAmountSats)) return fail();
  if (state !== "SETTLED") return { paid: false, paidAt: null, state };
  const received = unsigned(data.amt_paid_sat);
  if (received === null || received < (expectedAmountSats ?? value)) return fail();
  const settledSeconds = Number(data.settle_date);
  const settledAt = new Date(settledSeconds * 1000);
  if (!Number.isFinite(settledSeconds) || settledSeconds <= 0 || !Number.isFinite(settledAt.getTime())) return fail();
  return { paid: true, paidAt: settledAt.toISOString(), state };
}

export function verifiedProviderStatus(data: any, paymentIntentId: string) {
  if (data?.paymentIntentId !== paymentIntentId || typeof data?.paid !== "boolean") {
    throw new CheckoutSafetyError("PAYMENT_VERIFICATION_UNAVAILABLE");
  }
  const status = String(data.status || "").toLowerCase();
  if (data.paid !== (status === "paid")) throw new CheckoutSafetyError("PAYMENT_VERIFICATION_UNAVAILABLE");
  if (!data.paid) return { paid: false, paidAt: null, status };
  const paidAt = new Date(data.paidAt || "");
  if (!Number.isFinite(paidAt.getTime()) || paidAt.getTime() <= 0) throw new CheckoutSafetyError("PAYMENT_VERIFICATION_UNAVAILABLE");
  return { paid: true, paidAt: paidAt.toISOString(), status };
}
