export type ReceiptAvailability = "available" | "creator_offline" | "removed";

export type ResolvedReceiptIntent = {
  id: string;
  contentId: string;
  manifestSha256?: string | null;
  amountSats?: bigint | number | string | null;
  status: string;
  bolt11?: string | null;
  lightningExpiresAt?: Date | string | null;
  onchainAddress?: string | null;
  receiptToken?: string | null;
  receiptTokenExpiresAt?: Date | string | null;
  receiptId?: string | null;
  paidAt?: Date | string | null;
  providerId?: string | null;
};

export type ReceiptResolverResult = {
  intent: ResolvedReceiptIntent;
  matchedBy: "receiptToken" | "receiptId" | "paymentIntentId";
  authenticity: {
    paymentIntentId: string;
    receiptId: string | null;
    contentId: string;
    manifestSha256: string | null;
    creator: {
      userId: string | null;
      displayName: string | null;
      handle: string | null;
    };
  };
  entitlement: {
    purchased: boolean;
  };
  availability: ReceiptAvailability;
  token: {
    provided: string | null;
    current: string | null;
    matchesCurrent: boolean;
    expired: boolean;
    expiresAt: string | null;
    canReissue: boolean;
  };
};

export type ReceiptAccessPresentation = {
  canFulfill: boolean;
  access: "unlocked" | "pending" | "unavailable";
  entitled: boolean;
};

export type ReceiptResolverInput = {
  receiptToken?: string | null;
  receiptId?: string | null;
  paymentIntentId?: string | null;
  nowMs?: number;
  findByReceiptToken: (receiptToken: string) => Promise<ResolvedReceiptIntent | null>;
  findByReceiptId: (receiptId: string) => Promise<ResolvedReceiptIntent | null>;
  findByPaymentIntentId: (paymentIntentId: string) => Promise<ResolvedReceiptIntent | null>;
  refreshIntentIfPending?: (paymentIntentId: string) => Promise<ResolvedReceiptIntent | null>;
  ensureStableReceiptId?: (intent: ResolvedReceiptIntent) => Promise<ResolvedReceiptIntent>;
  getAuthenticityContext: (intent: ResolvedReceiptIntent) => Promise<ReceiptResolverResult["authenticity"]>;
  getAvailability: (intent: ResolvedReceiptIntent) => Promise<ReceiptAvailability>;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function computeReceiptAccessPresentation(input: {
  purchased: boolean;
  entitled: boolean;
  availability: ReceiptAvailability;
  buyerId?: string | null;
  warning?: string | null;
}): ReceiptAccessPresentation {
  const purchased = Boolean(input.purchased);
  const entitled = Boolean(input.entitled);
  const buyerId = asString(input.buyerId || "") || null;
  const warning = asString(input.warning || "") || null;
  const availability = input.availability;

  if (!purchased) {
    return {
      canFulfill: false,
      access: availability === "available" ? "pending" : "unavailable",
      entitled: false
    };
  }

  if (availability !== "available") {
    return {
      canFulfill: false,
      access: "unavailable",
      entitled
    };
  }

  if (!buyerId || warning || !entitled) {
    return {
      canFulfill: false,
      access: "pending",
      entitled
    };
  }

  return {
    canFulfill: true,
    access: "unlocked",
    entitled: true
  };
}

export async function resolveReceiptContext(input: ReceiptResolverInput): Promise<ReceiptResolverResult | null> {
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();
  const receiptToken = asString(input.receiptToken || "");
  const receiptId = asString(input.receiptId || "");
  const paymentIntentId = asString(input.paymentIntentId || "");

  let intent: ResolvedReceiptIntent | null = null;
  let matchedBy: ReceiptResolverResult["matchedBy"] | null = null;

  if (receiptToken) {
    intent = await input.findByReceiptToken(receiptToken);
    if (intent) {
      matchedBy = "receiptToken";
    } else {
      intent = await input.findByPaymentIntentId(receiptToken);
      if (intent) matchedBy = "paymentIntentId";
    }
  }

  if (!intent && receiptId) {
    intent = await input.findByReceiptId(receiptId);
    if (intent) matchedBy = "receiptId";
  }

  if (!intent && paymentIntentId) {
    intent = await input.findByPaymentIntentId(paymentIntentId);
    if (intent) matchedBy = "paymentIntentId";
  }

  if (!intent || !matchedBy) return null;

  if (input.refreshIntentIfPending && String(intent.status || "").toLowerCase() !== "paid") {
    const refreshed = await input.refreshIntentIfPending(intent.id).catch(() => null);
    if (refreshed) intent = refreshed;
  }

  if (input.ensureStableReceiptId) {
    intent = await input.ensureStableReceiptId(intent);
  }

  const expiresAtMs = intent.receiptTokenExpiresAt ? new Date(intent.receiptTokenExpiresAt as any).getTime() : null;
  const currentToken = asString(intent.receiptToken || "") || null;
  const providedToken = receiptToken || null;
  const matchesCurrent = Boolean(providedToken && currentToken && providedToken === currentToken);
  const expired = Boolean(typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs);
  const purchased = String(intent.status || "").toLowerCase() === "paid";

  const authenticity = await input.getAuthenticityContext(intent);
  const availability = await input.getAvailability(intent);

  return {
    intent,
    matchedBy,
    authenticity,
    entitlement: {
      purchased
    },
    availability,
    token: {
      provided: providedToken,
      current: currentToken,
      matchesCurrent,
      expired,
      expiresAt: toIso(intent.receiptTokenExpiresAt as any),
      canReissue: purchased && (expired || !currentToken)
    }
  };
}
