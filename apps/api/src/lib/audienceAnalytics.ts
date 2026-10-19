import { Prisma, type PrismaClient } from "@prisma/client";
import { AUDIENCE_V2_RETENTION_DAYS, AUDIENCE_VIEW_DEFINITION } from "./audienceViews.js";

export type AudienceRange = "7d" | "30d" | "90d" | "all";
export const AUDIENCE_PAGE_SIZE = 50;
const DAY_MS = 86_400_000;

export function parseAudienceQuery(query: unknown): { range: AudienceRange; page: number } | null {
  if (!query || typeof query !== "object" || Array.isArray(query)) return null;
  const values = query as Record<string, unknown>;
  if (Object.keys(values).some((key) => key !== "range" && key !== "page")) return null;
  const range = values.range ?? "all";
  const page = values.page ?? "1";
  if (range !== "7d" && range !== "30d" && range !== "90d" && range !== "all") return null;
  if (typeof page !== "string" || !/^[1-9]\d{0,3}$/.test(page) || Number(page) > 1000) return null;
  return { range, page: Number(page) };
}

export function audiencePeriod(range: AudienceRange, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = range === "all" ? null : Number(range.slice(0, -1));
  return { from: days === null ? null : new Date(today - (days - 1) * DAY_MS), to: now, days };
}

export function audienceConversion(purchases: number, views: number): number | null {
  return views > 0 ? Number(((purchases / views) * 100).toFixed(2)) : null;
}

type CountRow = { n: bigint | number | string };
type FirstRow = { firstAt: bigint | number | string | null };
type RankRow = {
  contentId: string; title: string; status: string; createdAt: bigint | number;
  updatedAt: bigint | number; views: bigint | number; legacyOpens: bigint | number;
  purchases: bigint | number; conversionPurchases: bigint | number;
};
type SeriesRow = { contentId: string; bucket: string; n: bigint | number };

const count = (value: bigint | number | string | null | undefined) => Number(value || 0);
const date = (value: bigint | number) => new Date(Number(value));
const utcDay = (value: Date) => value.toISOString().slice(0, 10);
const utcMonth = (value: Date) => value.toISOString().slice(0, 7);

function bucketKeys(from: Date, to: Date, granularity: "day" | "month"): string[] {
  const keys: string[] = [];
  let cursor = granularity === "day"
    ? Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
    : Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1);
  while (cursor <= to.getTime()) {
    const current = new Date(cursor);
    keys.push(granularity === "day" ? utcDay(current) : utcMonth(current));
    cursor = granularity === "day" ? cursor + DAY_MS : Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1);
  }
  return keys;
}

export async function buildAudienceReport(
  db: PrismaClient, userId: string, isBasicPosture: boolean,
  range: AudienceRange, page = 1, now = new Date()
) {
  const period = audiencePeriod(range, now);
  const retentionFrom = new Date(now.getTime() - AUDIENCE_V2_RETENTION_DAYS * DAY_MS);
  const viewFrom = period.from && period.from > retentionFrom ? period.from : retentionFrom;
  const trendFrom = range === "all" ? retentionFrom : period.from!;
  const granularity = range === "all" ? "month" as const : "day" as const;
  const keys = bucketKeys(trendFrom, now, granularity);
  const bucketExpression = (column: Prisma.Sql) => granularity === "day"
    ? Prisma.sql`strftime('%Y-%m-%d', ${column} / 1000, 'unixepoch')`
    : Prisma.sql`strftime('%Y-%m', ${column} / 1000, 'unixepoch')`;
  const owned = Prisma.sql`c."ownerUserId" = ${userId} AND c."deletedAt" IS NULL`;
  const viewWhere = Prisma.sql`a."eventType" = 'view' AND a."definition" = ${AUDIENCE_VIEW_DEFINITION}
    AND a."createdAt" >= ${viewFrom} AND a."createdAt" < ${now}`;
  const legacyWhere = Prisma.sql`a."eventType" = 'view' AND a."definition" IS NULL
    ${period.from ? Prisma.sql`AND a."createdAt" >= ${period.from}` : Prisma.empty}
    AND a."createdAt" < ${now}`;
  const paidBase = Prisma.sql`p."purpose" = 'CONTENT_PURCHASE' AND p."status" = 'paid'`;
  const paidWhere = range === "all" ? Prisma.sql`${paidBase} AND (p."paidAt" IS NULL OR p."paidAt" < ${now})` : Prisma.sql`${paidBase}
    AND p."paidAt" IS NOT NULL AND p."paidAt" >= ${period.from!} AND p."paidAt" < ${now}`;
  const datedPaidWhere = Prisma.sql`${paidBase} AND p."paidAt" IS NOT NULL AND p."paidAt" < ${now}`;

  // The first observed event is a conservative measurement boundary, not a claimed deployment date.
  const [first] = await db.$queryRaw<FirstRow[]>`SELECT MIN(a."createdAt") AS "firstAt"
    FROM "AudienceEvent" a JOIN "ContentItem" c ON c."id" = a."contentId"
    WHERE ${owned} AND a."eventType" = 'view' AND a."definition" = ${AUDIENCE_VIEW_DEFINITION}
      AND a."createdAt" < ${now}`;
  const firstAt = first?.firstAt == null ? null : new Date(Number(first.firstAt));
  const conversionFrom = firstAt && firstAt > viewFrom ? firstAt : viewFrom;
  const activation = await db.audienceTrackingActivation.findUnique({ where: { userId }, select: { activatedAt: true, freshAccount: true } });
  const trackingWindows = await db.audienceTrackingWindow.findMany({
    where: { startedAt: { lt: now }, coveredUntil: { gt: viewFrom } },
    orderBy: { startedAt: "asc" }, take: 1000,
    select: { startedAt: true, coveredUntil: true, endedAt: true }
  });
  const coverageFrom = activation?.activatedAt ?? null;
  const covered = (start: Date, end: Date): "unknown" | "partial" | "observed" => {
    if (!activation || end <= start) return "unknown";
    const finish = end.getTime();
    let cursor = activation.freshAccount ? Math.max(start.getTime(), activation.activatedAt.getTime()) : start.getTime();
    if (cursor >= finish) return activation.freshAccount ? "observed" : "unknown";
    let gap = cursor < retentionFrom.getTime();
    cursor = Math.max(cursor, retentionFrom.getTime());
    let any = false;
    for (const window of trackingWindows) {
      const from = window.startedAt.getTime();
      const through = window.endedAt ? window.coveredUntil.getTime()
        : now.getTime() - window.coveredUntil.getTime() <= 120_000 ? now.getTime() : window.coveredUntil.getTime();
      if (through <= cursor || from >= finish) continue;
      if (from > cursor) gap = true;
      cursor = Math.max(cursor, through);
      any = true;
      if (cursor >= finish) return gap ? "partial" : "observed";
    }
    return any ? "partial" : "unknown";
  };
  const reportCoverage = !activation ? "unknown" :
    period.from ? covered(period.from, now) :
    activation.freshAccount && activation.activatedAt >= retentionFrom ? covered(activation.activatedAt, now) : "partial";
  const conversionPaidWhere = Prisma.sql`${datedPaidWhere} AND p."paidAt" >= ${conversionFrom}`;

  const [works] = await db.$queryRaw<CountRow[]>`SELECT COUNT(*) AS n FROM "ContentItem" c WHERE ${owned}`;
  const [views] = await db.$queryRaw<CountRow[]>`SELECT COUNT(*) AS n FROM "AudienceEvent" a
    JOIN "ContentItem" c ON c."id" = a."contentId" WHERE ${owned} AND ${viewWhere}`;
  const [legacy] = await db.$queryRaw<CountRow[]>`SELECT COUNT(*) AS n FROM "AudienceEvent" a
    JOIN "ContentItem" c ON c."id" = a."contentId" WHERE ${owned} AND ${legacyWhere}`;
  const [purchases] = isBasicPosture ? [{ n: 0 }] : await db.$queryRaw<CountRow[]>`SELECT COUNT(*) AS n FROM "PaymentIntent" p
    JOIN "ContentItem" c ON c."id" = p."contentId" WHERE ${owned} AND ${paidWhere}`;
  const [undatedPurchases] = isBasicPosture ? [{ n: 0 }] : await db.$queryRaw<CountRow[]>`SELECT COUNT(*) AS n FROM "PaymentIntent" p
    JOIN "ContentItem" c ON c."id" = p."contentId" WHERE ${owned} AND ${paidBase} AND p."paidAt" IS NULL`;
  const [conversionPurchases] = isBasicPosture || !firstAt ? [{ n: 0 }] : await db.$queryRaw<CountRow[]>`SELECT COUNT(*) AS n FROM "PaymentIntent" p
    JOIN "ContentItem" c ON c."id" = p."contentId" WHERE ${owned} AND ${conversionPaidWhere}`;

  const viewRank = Prisma.sql`(SELECT COUNT(*) FROM "AudienceEvent" a WHERE a."contentId" = c."id" AND ${viewWhere})`;
  const legacyRank = Prisma.sql`(SELECT COUNT(*) FROM "AudienceEvent" a WHERE a."contentId" = c."id" AND ${legacyWhere})`;
  const paidRank = isBasicPosture ? Prisma.sql`0` : Prisma.sql`(SELECT COUNT(*) FROM "PaymentIntent" p WHERE p."contentId" = c."id" AND ${paidWhere})`;
  const conversionRank = isBasicPosture || !firstAt ? Prisma.sql`0` : Prisma.sql`(SELECT COUNT(*) FROM "PaymentIntent" p WHERE p."contentId" = c."id" AND ${conversionPaidWhere})`;
  const ranked = await db.$queryRaw<RankRow[]>`
    SELECT c."id" AS "contentId", c."title", c."status", c."createdAt", c."updatedAt",
      ${viewRank} AS views, ${legacyRank} AS "legacyOpens", ${paidRank} AS purchases,
      ${conversionRank} AS "conversionPurchases"
    FROM "ContentItem" c WHERE ${owned}
    ORDER BY views DESC, purchases DESC, c."id" ASC
    LIMIT ${AUDIENCE_PAGE_SIZE} OFFSET ${(page - 1) * AUDIENCE_PAGE_SIZE}`;

  const ids = ranked.map((row) => row.contentId);
  const [viewSeries, purchaseSeries] = ids.length ? await Promise.all([
    db.$queryRaw<SeriesRow[]>`SELECT a."contentId" AS "contentId", ${bucketExpression(Prisma.sql`a."createdAt"`)} AS bucket, COUNT(*) AS n
      FROM "AudienceEvent" a WHERE a."contentId" IN (${Prisma.join(ids)}) AND ${viewWhere}
      AND a."createdAt" >= ${trendFrom} GROUP BY a."contentId", bucket`,
    isBasicPosture ? Promise.resolve([] as SeriesRow[]) : db.$queryRaw<SeriesRow[]>`
      SELECT p."contentId" AS "contentId", ${bucketExpression(Prisma.sql`p."paidAt"`)} AS bucket, COUNT(*) AS n
      FROM "PaymentIntent" p WHERE p."contentId" IN (${Prisma.join(ids)}) AND ${datedPaidWhere}
      AND p."paidAt" >= ${trendFrom} GROUP BY p."contentId", bucket`
  ]) : [[], []];
  const [accountViews, accountPurchases] = await Promise.all([
    db.$queryRaw<Array<Omit<SeriesRow, "contentId">>>`SELECT ${bucketExpression(Prisma.sql`a."createdAt"`)} AS bucket, COUNT(*) AS n
      FROM "AudienceEvent" a JOIN "ContentItem" c ON c."id" = a."contentId"
      WHERE ${owned} AND ${viewWhere} AND a."createdAt" >= ${trendFrom} GROUP BY bucket`,
    isBasicPosture ? Promise.resolve([] as Array<Omit<SeriesRow, "contentId">>) : db.$queryRaw<Array<Omit<SeriesRow, "contentId">>>`
      SELECT ${bucketExpression(Prisma.sql`p."paidAt"`)} AS bucket, COUNT(*) AS n
      FROM "PaymentIntent" p JOIN "ContentItem" c ON c."id" = p."contentId"
      WHERE ${owned} AND ${datedPaidWhere} AND p."paidAt" >= ${trendFrom} GROUP BY bucket`
  ]);
  const accountViewMap = new Map(accountViews.map((row) => [row.bucket, count(row.n)]));
  const accountPurchaseMap = new Map(accountPurchases.map((row) => [row.bucket, count(row.n)]));
  const bucketConversion = (bucket: string, viewsInBucket: number, purchasesInBucket: number) => {
    if (isBasicPosture || !firstAt) return null;
    const bucketStart = new Date(`${bucket}${granularity === "month" ? "-01" : ""}T00:00:00.000Z`);
    return bucketStart >= firstAt && bucketStart >= retentionFrom
      ? audienceConversion(purchasesInBucket, viewsInBucket) : null;
  };
  const series = (viewMap: Map<string, number>, purchaseMap: Map<string, number>) => keys.map((bucket) => {
    const bucketStart = new Date(`${bucket}${granularity === "month" ? "-01" : ""}T00:00:00.000Z`);
    const bucketEnd = granularity === "day"
      ? new Date(bucketStart.getTime() + DAY_MS)
      : new Date(Date.UTC(bucketStart.getUTCFullYear(), bucketStart.getUTCMonth() + 1, 1));
    const viewCoverage = covered(bucketStart, bucketEnd > now ? now : bucketEnd);
    const bucketViews = viewMap.get(bucket) || 0;
    const bucketPurchases = purchaseMap.get(bucket) || 0;
    return { bucket, views: viewCoverage === "unknown" ? null : bucketViews, viewCoverage,
      purchases: isBasicPosture ? null : bucketPurchases,
      conversionRate: bucketConversion(bucket, bucketViews, bucketPurchases) };
  });
  const items = ranked.map((row, index) => {
    const byView = new Map(viewSeries.filter((entry) => entry.contentId === row.contentId).map((entry) => [entry.bucket, count(entry.n)]));
    const byPurchase = new Map(purchaseSeries.filter((entry) => entry.contentId === row.contentId).map((entry) => [entry.bucket, count(entry.n)]));
    return {
      contentId: row.contentId, title: row.title || "Untitled", status: row.status.toLowerCase(),
      createdAt: date(row.createdAt), updatedAt: date(row.updatedAt),
      views: count(row.views), legacyOpens: count(row.legacyOpens),
      purchases: isBasicPosture ? null : count(row.purchases),
      conversionRate: isBasicPosture || !firstAt ? null : audienceConversion(count(row.conversionPurchases), count(row.views)),
      rank: (page - 1) * AUDIENCE_PAGE_SIZE + index + 1,
      series: series(byView, byPurchase)
    };
  });
  return {
    posture: isBasicPosture ? "basic" : "sovereign", supportsCommerceMetrics: !isBasicPosture,
    range, totalViews: count(views?.n), totalLegacyOpens: count(legacy?.n),
    viewWindowDays: AUDIENCE_V2_RETENTION_DAYS,
    totalPurchases: isBasicPosture ? null : count(purchases?.n),
    undatedPaidPurchases: isBasicPosture ? null : count(undatedPurchases?.n),
    conversionRate: isBasicPosture || !firstAt ? null : audienceConversion(count(conversionPurchases?.n), count(views?.n)),
    series: series(accountViewMap, accountPurchaseMap), items,
    pagination: { page, pageSize: AUDIENCE_PAGE_SIZE, totalItems: count(works?.n), totalPages: Math.ceil(count(works?.n) / AUDIENCE_PAGE_SIZE) },
    metadata: {
      periodStart: period.from?.toISOString() || null, periodEndExclusive: now.toISOString(),
      periodDefinition: range === "all" ? "all available history" : "UTC calendar days including today",
      trendStart: trendFrom.toISOString(), granularity, viewRetentionStart: retentionFrom.toISOString(),
      earliestAvailableBuyPageViewAt: firstAt?.toISOString() || null,
      trackingActivationAt: activation?.activatedAt.toISOString() || null,
      coverageFrom: coverageFrom?.toISOString() || null,
      viewCoverage: reportCoverage === "observed" ? "observed_after_boundary" : reportCoverage === "unknown" ? "unknown" : "incomplete",
      coverageNote: "Tracking activation and operational windows establish observed coverage. Earlier periods, interrupted tracking, and expired retention are not assumed to have zero views.",
      conversionStart: firstAt ? conversionFrom.toISOString() : null,
      conversionDefinition: "paid CONTENT_PURCHASE intents in the comparable retained-view window divided by recorded Buy-page views; not unique-visitor conversion",
      viewDefinition: AUDIENCE_VIEW_DEFINITION,
      legacyDefinition: "pre-checkpoint content opens; separate from Buy-page views",
      paidPurchaseDefinition: "Paid CONTENT_PURCHASE intents; dated ranges and trends use paidAt, while all-time totals also include paid intents with no paidAt timestamp"
    }
  };
}
