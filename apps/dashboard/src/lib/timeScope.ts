export type TimeBasis = "earned" | "sale" | "paid";
export type TimePeriod = "1d" | "7d" | "30d" | "90d" | "all";

export const TIME_BASIS_LABEL: Record<TimeBasis, string> = {
  earned: "Earned (accrual)",
  sale: "Sale (recognized)",
  paid: "Paid (remitted)"
};

export const TIME_PERIOD_LABEL: Record<TimePeriod, string> = {
  "1d": "1 day",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All time"
};

export function periodCutoffMs(period: TimePeriod, nowMs = Date.now()): number | null {
  if (period === "all") return null;
  if (period === "1d") return nowMs - 1 * 24 * 60 * 60 * 1000;
  if (period === "7d") return nowMs - 7 * 24 * 60 * 60 * 1000;
  if (period === "30d") return nowMs - 30 * 24 * 60 * 60 * 1000;
  return nowMs - 90 * 24 * 60 * 60 * 1000;
}

export function isWithinPeriod(isoTimestamp: string | null | undefined, period: TimePeriod, nowMs = Date.now()): boolean {
  if (period === "all") return true;
  const ts = Date.parse(String(isoTimestamp || ""));
  if (!Number.isFinite(ts)) return false;
  const cutoff = periodCutoffMs(period, nowMs);
  return cutoff === null ? true : ts >= cutoff;
}
