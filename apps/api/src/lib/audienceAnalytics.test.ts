import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { audienceConversion, audiencePeriod, buildAudienceReport, parseAudienceQuery } from "./audienceAnalytics.js";

const NOW = new Date("2026-10-19T12:00:00.000Z");
const at = (value: string) => new Date(value);

async function withDatabase(run: (db: PrismaClient) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "certifyd-audience-report-"));
  const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(dir, "report.db")}`;
  const db = new PrismaClient();
  try {
    await db.$executeRawUnsafe(`CREATE TABLE "ContentItem" (
      "id" TEXT PRIMARY KEY, "ownerUserId" TEXT NOT NULL, "title" TEXT NOT NULL,
      "status" TEXT NOT NULL, "createdAt" DATETIME NOT NULL,
      "updatedAt" DATETIME NOT NULL, "deletedAt" DATETIME
    )`);
    await db.$executeRawUnsafe(`CREATE TABLE "AudienceEvent" (
      "id" TEXT PRIMARY KEY, "contentId" TEXT NOT NULL, "eventType" TEXT NOT NULL,
      "definition" TEXT, "createdAt" DATETIME NOT NULL
    )`);
    await db.$executeRawUnsafe(`CREATE INDEX "audience_lookup" ON "AudienceEvent"("contentId", "definition", "createdAt")`);
    await db.$executeRawUnsafe(`CREATE TABLE "PaymentIntent" (
      "id" TEXT PRIMARY KEY, "contentId" TEXT NOT NULL, "purpose" TEXT NOT NULL,
      "status" TEXT NOT NULL, "paidAt" DATETIME
    )`);
    await db.$executeRawUnsafe(`CREATE INDEX "payment_lookup" ON "PaymentIntent"("contentId", "status", "paidAt")`);
    await run(db);
  } finally {
    await db.$disconnect();
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function work(db: PrismaClient, id: string, owner = "creator", deleted = false) {
  await db.$executeRaw`INSERT INTO "ContentItem" ("id", "ownerUserId", "title", "status", "createdAt", "updatedAt", "deletedAt")
    VALUES (${id}, ${owner}, ${`Title ${id}`}, 'published', ${at("2026-01-01T00:00:00Z")}, ${at("2026-01-01T00:00:00Z")}, ${deleted ? at("2026-10-01T00:00:00Z") : null})`;
}
async function view(db: PrismaClient, id: string, workId: string, when: string, definition: string | null = "buy_page_v2") {
  await db.$executeRaw`INSERT INTO "AudienceEvent" ("id", "contentId", "eventType", "definition", "createdAt")
    VALUES (${id}, ${workId}, 'view', ${definition}, ${at(when)})`;
}
async function purchase(db: PrismaClient, id: string, workId: string, when: string | null, status = "paid", purpose = "CONTENT_PURCHASE") {
  await db.$executeRaw`INSERT INTO "PaymentIntent" ("id", "contentId", "purpose", "status", "paidAt")
    VALUES (${id}, ${workId}, ${purpose}, ${status}, ${when ? at(when) : null})`;
}

test("date ranges use inclusive UTC calendar starts and an exclusive now boundary", () => {
  assert.equal(audiencePeriod("7d", NOW).from?.toISOString(), "2026-10-13T00:00:00.000Z");
  assert.equal(audiencePeriod("30d", NOW).from?.toISOString(), "2026-09-20T00:00:00.000Z");
  assert.equal(audiencePeriod("90d", NOW).from?.toISOString(), "2026-07-22T00:00:00.000Z");
  assert.equal(audiencePeriod("all", NOW).from, null);
  assert.deepEqual(parseAudienceQuery({}), { range: "all", page: 1 });
  assert.deepEqual(parseAudienceQuery({ range: "7d", page: "2" }), { range: "7d", page: 2 });
  for (const invalid of [{ range: "week" }, { range: ["7d"] }, { page: "0" }, { page: "1001" }, { period: "30d" }]) {
    assert.equal(parseAudienceQuery(invalid), null);
  }
  assert.equal(audienceConversion(2, 4), 50);
  assert.equal(audienceConversion(0, 0), null);
});

test("reports reconcile owned works, paid timestamps, zero days, and incomplete coverage", async () => {
  await withDatabase(async (db) => {
    await work(db, "a"); await work(db, "b"); await work(db, "c");
    await work(db, "not-mine", "someone-else"); await work(db, "deleted", "creator", true);
    await view(db, "v-old", "a", "2026-10-12T23:59:59.999Z");
    await view(db, "v-start", "a", "2026-10-13T00:00:00.000Z");
    await view(db, "v-b", "b", "2026-10-18T11:00:00.000Z");
    await view(db, "v-legacy", "a", "2026-10-18T11:00:00.000Z", null);
    await view(db, "v-other", "not-mine", "2026-10-18T11:00:00.000Z");
    await view(db, "v-deleted", "deleted", "2026-10-18T11:00:00.000Z");
    await purchase(db, "p-old", "a", "2026-10-12T23:59:59.999Z");
    await purchase(db, "p-before-view-retention", "a", "2024-01-01T00:00:00.000Z");
    await purchase(db, "p-start", "a", "2026-10-13T00:00:00.000Z");
    await purchase(db, "p-b", "b", "2026-10-18T12:00:00.000Z");
    await purchase(db, "p-pending", "a", "2026-10-18T12:00:00.000Z", "pending");
    await purchase(db, "p-failed", "a", "2026-10-18T12:00:00.000Z", "failed");
    await purchase(db, "p-tip", "a", "2026-10-18T12:00:00.000Z", "paid", "TIP");
    await purchase(db, "p-undated", "a", null);
    await purchase(db, "p-other", "not-mine", "2026-10-18T12:00:00.000Z");
    const report = await buildAudienceReport(db, "creator", false, "7d", 1, NOW);
    assert.equal(report.totalViews, 2);
    assert.equal(report.totalLegacyOpens, 1);
    assert.equal(report.totalPurchases, 2);
    assert.equal(report.conversionRate, 100);
    assert.deepEqual(report.items.map((item) => item.contentId), ["a", "b", "c"]);
    assert.equal(report.items.reduce((sum, item) => sum + item.views, 0), report.totalViews);
    assert.equal(report.items.reduce((sum, item) => sum + Number(item.purchases), 0), report.totalPurchases);
    assert.equal(report.series.length, 7);
    assert.equal(report.series[0].bucket, "2026-10-13");
    assert.equal(report.series[0].viewCoverage, "observed");
    assert.equal(report.series[1].views, 0);
    assert.equal(report.series[5].views, 1);
    assert.equal(report.items[2].views, 0);
    assert.equal(report.items[2].purchases, 0);
    assert.equal(report.metadata.trackingActivationAt, null);
    assert.equal(report.metadata.earliestAvailableBuyPageViewAt, "2026-10-12T23:59:59.999Z");
    assert.equal(report.metadata.viewCoverage, "observed_after_boundary");
    const all = await buildAudienceReport(db, "creator", false, "all", 1, NOW);
    assert.equal(all.totalPurchases, 5);
    assert.equal(all.undatedPaidPurchases, 1);
    assert.equal(all.totalViews, 3);
    assert.equal(all.conversionRate, 100, "older purchases must not inflate conversion over retained views");
    assert.equal(all.metadata.granularity, "month");
    assert.equal(all.metadata.viewCoverage, "incomplete");
    assert.equal(all.metadata.trackingActivationAt, null);
    const basic = await buildAudienceReport(db, "creator", true, "7d", 1, NOW);
    assert.equal(basic.totalPurchases, null);
    assert.equal(basic.conversionRate, null);
    assert.ok(basic.series.every((point) => point.purchases === null));
  });
});

test("legacy-only history is separate and unknown view periods are not zero-filled", async () => {
  await withDatabase(async (db) => {
    await work(db, "a");
    await view(db, "legacy", "a", "2026-10-18T00:00:00.000Z", null);
    await purchase(db, "paid", "a", "2026-10-18T00:00:00.000Z");
    const report = await buildAudienceReport(db, "creator", false, "7d", 1, NOW);
    assert.equal(report.totalViews, 0);
    assert.equal(report.totalLegacyOpens, 1);
    assert.equal(report.totalPurchases, 1);
    assert.equal(report.conversionRate, null);
    assert.equal(report.metadata.viewCoverage, "unknown");
    assert.ok(report.series.every((point) => point.views === null && point.viewCoverage === "unknown"));
  });
});

test("30- and 90-day filters include UTC midnight and exclude the preceding instant", async () => {
  await withDatabase(async (db) => {
    await work(db, "a");
    await view(db, "before-90", "a", "2026-07-21T23:59:59.999Z");
    await view(db, "at-90", "a", "2026-07-22T00:00:00.000Z");
    await view(db, "before-30", "a", "2026-09-19T23:59:59.999Z");
    await view(db, "at-30", "a", "2026-09-20T00:00:00.000Z");
    await purchase(db, "paid-before-90", "a", "2026-07-21T23:59:59.999Z");
    await purchase(db, "paid-at-90", "a", "2026-07-22T00:00:00.000Z");
    await purchase(db, "paid-before-30", "a", "2026-09-19T23:59:59.999Z");
    await purchase(db, "paid-at-30", "a", "2026-09-20T00:00:00.000Z");
    const thirty = await buildAudienceReport(db, "creator", false, "30d", 1, NOW);
    const ninety = await buildAudienceReport(db, "creator", false, "90d", 1, NOW);
    assert.equal(thirty.totalViews, 1);
    assert.equal(thirty.totalPurchases, 1);
    assert.equal(thirty.series.length, 30);
    assert.equal(ninety.totalViews, 3);
    assert.equal(ninety.totalPurchases, 3);
    assert.equal(ninety.series.length, 90);
    assert.equal(thirty.series.reduce((sum, point) => sum + (point.views || 0), 0), thirty.totalViews);
    assert.equal(ninety.series.reduce((sum, point) => sum + (point.views || 0), 0), ninety.totalViews);
  });
});

test("empty periods and later first events expose unknown coverage instead of fabricated zeros", async () => {
  await withDatabase(async (db) => {
    await work(db, "a");
    await view(db, "first", "a", "2026-10-18T15:00:00.000Z");
    await purchase(db, "older-paid", "a", "2026-10-15T00:00:00.000Z");
    await purchase(db, "newer-paid", "a", "2026-10-19T01:00:00.000Z");
    const report = await buildAudienceReport(db, "creator", false, "7d", 1, NOW);
    assert.equal(report.totalPurchases, 2);
    assert.equal(report.totalViews, 1);
    assert.equal(report.conversionRate, 100, "the older purchase is outside the comparable window");
    assert.equal(report.metadata.viewCoverage, "incomplete");
    assert.equal(report.metadata.conversionStart, "2026-10-18T15:00:00.000Z");
    assert.ok(report.series.slice(0, 5).every((point) => point.views === null && point.viewCoverage === "unknown"));
    assert.equal(report.series[5].viewCoverage, "partial");
    assert.equal(report.series[5].conversionRate, null);
    assert.equal(report.series[6].views, 0);
    assert.equal(report.series[6].conversionRate, null);
    const empty = await buildAudienceReport(db, "creator", false, "7d", 1, at("2026-10-01T12:00:00.000Z"));
    assert.equal(empty.totalViews, 0);
    assert.equal(empty.totalPurchases, 0);
    assert.equal(empty.series.length, 7);
    assert.equal(empty.metadata.viewCoverage, "unknown", "future events do not establish past coverage");
  });
});

test("ranking has stable ties and paginated per-work results", async () => {
  await withDatabase(async (db) => {
    for (let index = 0; index < 53; index++) await work(db, `work-${String(index).padStart(2, "0")}`);
    await view(db, "view-00", "work-00", "2026-10-18T00:00:00.000Z");
    await view(db, "view-52", "work-52", "2026-10-18T00:00:00.000Z");
    await purchase(db, "paid-52", "work-52", "2026-10-18T01:00:00.000Z");
    const first = await buildAudienceReport(db, "creator", false, "30d", 1, NOW);
    const second = await buildAudienceReport(db, "creator", false, "30d", 2, NOW);
    assert.equal(first.items.length, 50);
    assert.equal(second.items.length, 3);
    assert.equal(first.items[0].contentId, "work-52");
    assert.equal(first.items[1].contentId, "work-00");
    assert.equal(second.items[0].contentId, "work-49");
    assert.equal(second.items[0].rank, 51);
    assert.equal(first.pagination.totalItems, 53);
    assert.equal(second.pagination.totalPages, 2);
    assert.equal(first.totalViews, 2);
    assert.equal(second.totalViews, 2);
    assert.equal([...first.items, ...second.items].reduce((sum, item) => sum + item.views, 0), first.totalViews);
    assert.equal([...first.items, ...second.items].reduce((sum, item) => sum + Number(item.purchases), 0), first.totalPurchases);
  });
});

test("audience route keeps authentication and delegated report ownership", () => {
  const source = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(source, /app\.get\("\/audience\/summary", \{ preHandler: \[requireAuth\] \}/);
  assert.match(source, /buildAudienceReport\(prisma, userId, isBasicPosture, query\.range, query\.page\)/);
  assert.match(source, /INVALID_AUDIENCE_QUERY/);
});

test("large event history is aggregated in SQLite and response size remains bounded", async () => {
  await withDatabase(async (db) => {
    await work(db, "a");
    await purchase(db, "commerce-write", "a", null, "pending");
    for (let batch = 0; batch < 100; batch++) {
      const tuples = Array.from({ length: 100 }, (_, n) => `('v-${batch}-${n}', 'a', 'view', 'buy_page_v2', ${Date.parse("2026-10-18T00:00:00.000Z")})`);
      await db.$executeRawUnsafe(`INSERT INTO "AudienceEvent" ("id", "contentId", "eventType", "definition", "createdAt") VALUES ${tuples.join(",")}`);
    }
    const commerceDb = new PrismaClient();
    const start = performance.now();
    let report: Awaited<ReturnType<typeof buildAudienceReport>>;
    try {
      [report] = await Promise.all([
        buildAudienceReport(db, "creator", false, "7d", 1, NOW),
        (async () => {
          for (let index = 0; index < 30; index++) {
            await commerceDb.$executeRaw`UPDATE "PaymentIntent" SET "status" = ${index % 2 ? "pending" : "failed"} WHERE "id" = 'commerce-write'`;
          }
        })()
      ]);
    } finally {
      await commerceDb.$disconnect();
    }
    assert.equal(report.totalViews, 10000);
    assert.equal(report.series.length, 7);
    assert.equal(report.items.length, 1);
    // Diagnostic rather than an environment-dependent pass/fail threshold.
    console.log(`10000-event report plus 30 commerce writes: ${(performance.now() - start).toFixed(1)}ms`);
  });
});
