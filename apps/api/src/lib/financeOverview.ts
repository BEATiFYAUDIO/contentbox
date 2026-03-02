type IntentLite = {
  amountSats: bigint;
  status: string;
  createdAt: Date;
  updatedAt?: Date | null;
  paidAt?: Date | null;
  lightningExpiresAt?: Date | null;
};

type ComputeInput = {
  now: Date;
  intents: IntentLite[];
};

function dayKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function addDaysUtc(base: Date, delta: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

export function computeFinanceOverviewFromIntents(input: ComputeInput): {
  totals: {
    salesSats: string;
    pendingSats: string;
    invoicesPaid: number;
    invoicesPending: number;
    invoicesFailed: number;
    invoicesExpired: number;
  };
  revenueSeries: Array<{ date: string; sats: string }>;
} {
  const now = input?.now instanceof Date ? input.now : new Date();
  const intents = Array.isArray(input?.intents) ? input.intents : [];

  let paid = 0n;
  let pending = 0n;
  let invoicesPaid = 0;
  let invoicesPending = 0;
  let invoicesFailed = 0;
  let invoicesExpired = 0;

  const seriesMap = new Map<string, bigint>();
  const start = addDaysUtc(now, -29);
  for (let i = 0; i < 30; i += 1) {
    seriesMap.set(dayKey(addDaysUtc(start, i)), 0n);
  }

  for (const intent of intents) {
    const status = String(intent?.status || "").trim().toLowerCase();
    const amt = BigInt(intent?.amountSats || 0n);
    if (status === "paid") {
      paid += amt;
      invoicesPaid += 1;
      const when = intent?.paidAt instanceof Date ? intent.paidAt : intent?.updatedAt instanceof Date ? intent.updatedAt : intent?.createdAt;
      const key = dayKey(when || now);
      if (seriesMap.has(key)) {
        seriesMap.set(key, (seriesMap.get(key) || 0n) + amt);
      }
      continue;
    }
    if (status === "pending") {
      const expired = intent?.lightningExpiresAt instanceof Date && intent.lightningExpiresAt.getTime() <= now.getTime();
      if (expired) invoicesExpired += 1;
      else invoicesPending += 1;
      pending += amt;
      continue;
    }
    if (status === "failed" || status === "canceled" || status === "cancelled" || status === "expired") {
      invoicesFailed += 1;
      continue;
    }
    invoicesPending += 1;
    pending += amt;
  }

  const revenueSeries = Array.from(seriesMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, sats]) => ({ date, sats: sats.toString() }));

  return {
    totals: {
      salesSats: paid.toString(),
      pendingSats: pending.toString(),
      invoicesPaid,
      invoicesPending,
      invoicesFailed,
      invoicesExpired
    },
    revenueSeries
  };
}
