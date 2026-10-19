import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  AUDIENCE_VIEW_WINDOW_MS,
  AudienceRateLimiter,
  isAudienceCollectionEnabled,
  isAutomatedAudienceRequest,
  makeAudienceSession,
  pruneAudienceV2,
  recordBuyPageView,
  validateAudienceViewBody,
  verifyAudienceSession
} from "./audienceViews.js";

async function withDatabase(run: (db: PrismaClient) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "certifyd-audience-test-"));
  const priorUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(dir, "audience.db").replace(/\\/g, "/")}`;
  const db = new PrismaClient();
  try {
    await db.$executeRawUnsafe(`CREATE TABLE "AudienceEvent" (
      "id" TEXT NOT NULL PRIMARY KEY, "contentId" TEXT NOT NULL,
      "eventType" TEXT NOT NULL, "sessionId" TEXT, "actorUserId" TEXT,
      "definition" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.$executeRawUnsafe(`CREATE TABLE "AudienceViewClaim" (
      "contentId" TEXT NOT NULL, "sessionId" TEXT NOT NULL,
      "lastRecordedAtMs" BIGINT NOT NULL, PRIMARY KEY ("contentId", "sessionId")
    )`);
    await run(db);
  } finally {
    await db.$disconnect();
    if (priorUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorUrl;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("strict view payload and signed session reject spoofed identifiers", () => {
  assert.equal(validateAudienceViewBody({ contentId: "c12345678901234567890", eventType: "view" }), "c12345678901234567890");
  for (const body of [null, [], { contentId: "bad!", eventType: "view" }, { contentId: "c12345678901234567890", eventType: "play" }, { contentId: "c12345678901234567890", eventType: "view", sessionId: "forged" }]) {
    assert.equal(validateAudienceViewBody(body), null);
  }
  const signed = makeAudienceSession("secret");
  assert.equal(verifyAudienceSession(signed.cookieValue, "secret"), signed.id);
  assert.equal(verifyAudienceSession(signed.id, "secret"), null);
  assert.equal(verifyAudienceSession(signed.cookieValue, "different-secret"), null);
  assert.equal(verifyAudienceSession(`${signed.id}.${crypto.randomBytes(32).toString("hex")}`, "secret"), null);
});

test("analytics can be disabled without collecting a session", () => {
  assert.equal(isAudienceCollectionEnabled("0"), false);
  assert.equal(isAudienceCollectionEnabled(undefined), true);
});

test("known crawlers and previews are filtered without using a fingerprint", () => {
  assert.equal(isAutomatedAudienceRequest({ "user-agent": "Googlebot" }), true);
  assert.equal(isAutomatedAudienceRequest({ "sec-purpose": "prefetch" }), true);
  assert.equal(isAutomatedAudienceRequest({ "user-agent": "Mozilla/5.0" }), false);
});

test("metadata, offer, and Buy-page GET handlers do not write audience events", () => {
  const source = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  // This guards the actual Core route file against restoring one of the old
  // server-side view producers alongside the browser's visible-page event.
  assert.equal((source.match(/recordBuyPageView\(/g) || []).length, 1);
  assert.equal((source.match(/recordAudienceViewEvent\(/g) || []).length, 0);
  assert.equal((source.match(/prisma\.audienceEvent\.create\(/g) || []).length, 0);
});

test("rate limiter has a bounded per-session and global budget", () => {
  const limiter = new AudienceRateLimiter();
  for (let n = 0; n < 60; n++) assert.equal(limiter.allow("session-a", 100_000), true);
  assert.equal(limiter.allow("session-a", 100_000), false);
  assert.equal(limiter.allow("session-a", 160_000), true);
  const global = new AudienceRateLimiter();
  for (let n = 0; n < 1200; n++) assert.equal(global.allow(`session-${n}`, 100_000), true);
  assert.equal(global.allow("new-session", 100_000), false);
});

test("rolling-window claim atomically deduplicates concurrent views and permits a later visit", async () => {
  await withDatabase(async (db) => {
    const now = Date.now();
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => recordBuyPageView(db, "c12345678901234567890", "aud_11111111111111111111111111111111", now)));
    assert.deepEqual(attempts.filter((result) => result.status === "rejected").map((result) => String(result.reason?.code || result.reason?.message)), []);
    assert.equal(attempts.filter((result) => result.status === "fulfilled" && result.value).length, 1);
    assert.equal(await db.audienceEvent.count(), 1);
    assert.equal(await recordBuyPageView(db, "c12345678901234567890", "aud_11111111111111111111111111111111", now + AUDIENCE_VIEW_WINDOW_MS - 1), false);
    assert.equal(await recordBuyPageView(db, "c12345678901234567890", "aud_11111111111111111111111111111111", now + AUDIENCE_VIEW_WINDOW_MS), true);
    assert.equal(await db.audienceEvent.count(), 2);
    const otherVisitors = await Promise.all(Array.from({ length: 12 }, (_, n) => recordBuyPageView(db, "c12345678901234567890", `aud_${String(n).padStart(32, "0")}`, now)));
    assert.equal(otherVisitors.filter(Boolean).length, 12);
    assert.equal(await db.audienceEvent.count(), 14);
  });
});

test("migration preserves existing view rows as legacy while adding v2 storage", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "certifyd-audience-migration-"));
  const priorUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(dir, "legacy.db").replace(/\\/g, "/")}`;
  const db = new PrismaClient();
  try {
    await db.$executeRawUnsafe(`CREATE TABLE "AudienceEvent" (
      "id" TEXT NOT NULL PRIMARY KEY, "contentId" TEXT NOT NULL,
      "eventType" TEXT NOT NULL, "sessionId" TEXT, "actorUserId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.$executeRawUnsafe(`INSERT INTO "AudienceEvent" ("id", "contentId", "eventType") VALUES ('legacy-one', 'c12345678901234567890', 'view')`);
    const migration = fs.readFileSync(new URL("../../prisma/migrations/20261018120000_audience_view_integrity/migration.sql", import.meta.url), "utf8");
    for (const statement of migration.split(";").map((value) => value.trim()).filter(Boolean)) {
      await db.$executeRawUnsafe(statement);
    }
    const rows = await db.audienceEvent.findMany();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].definition, null);
    assert.equal(await recordBuyPageView(db, "c12345678901234567890", "aud_33333333333333333333333333333333"), true);
    assert.equal(await db.audienceEvent.count(), 2);
  } finally {
    await db.$disconnect();
    if (priorUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorUrl;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed audience insert rolls back its claim and does not prevent retry", async () => {
  await withDatabase(async (db) => {
    await db.$executeRawUnsafe(`CREATE TRIGGER "reject_view" BEFORE INSERT ON "AudienceEvent" BEGIN SELECT RAISE(ABORT, 'audience write failed'); END`);
    await assert.rejects(recordBuyPageView(db, "c12345678901234567890", "aud_22222222222222222222222222222222"));
    const claims = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM "AudienceViewClaim"`;
    assert.equal(Number(claims[0].n), 0);
    await db.$executeRawUnsafe(`DROP TRIGGER "reject_view"`);
    assert.equal(await recordBuyPageView(db, "c12345678901234567890", "aud_22222222222222222222222222222222"), true);
  });
});

test("bounded audience load does not prevent concurrent commerce-table writes", async () => {
  await withDatabase(async (audienceDb) => {
    await audienceDb.$executeRawUnsafe(`CREATE TABLE "PaymentIntent" ("id" TEXT NOT NULL PRIMARY KEY, "status" TEXT NOT NULL)`);
    await audienceDb.$executeRawUnsafe(`INSERT INTO "PaymentIntent" ("id", "status") VALUES ('synthetic-commerce-intent', 'pending')`);
    const commerceDb = new PrismaClient();
    const writeCommerce = async () => {
      const times: number[] = [];
      for (let n = 0; n < 30; n++) {
        const start = performance.now();
        await commerceDb.$executeRaw`UPDATE "PaymentIntent" SET "status" = ${n % 2 ? "pending" : "paid"} WHERE "id" = ${"synthetic-commerce-intent"}`;
        times.push(performance.now() - start);
      }
      return times;
    };
    try {
      const baseline = await writeCommerce();
      const audience = Array.from({ length: 125 }, (_, n) => recordBuyPageView(
        audienceDb,
        "c12345678901234567890",
        `aud_${n.toString(16).padStart(32, "0")}`
      ));
      const [loadedWrites, commerceTimes] = await Promise.all([Promise.allSettled(audience), writeCommerce()]);
      const rejected = loadedWrites.filter((result) => result.status === "rejected");
      assert.ok(rejected.length > 0, "the bounded audience queue should reject excess analytics work");
      assert.ok(rejected.every((result) => String(result.reason?.message || "").includes("queue full")));
      assert.equal(commerceTimes.length, 30, "every commerce write completed under audience load");
      assert.equal(await audienceDb.audienceEvent.count(), loadedWrites.length - rejected.length);
      const final = await commerceDb.$queryRaw<Array<{ status: string }>>`SELECT "status" FROM "PaymentIntent" WHERE "id" = ${"synthetic-commerce-intent"}`;
      assert.equal(final[0]?.status, "pending");
      // Timing is diagnostic rather than a brittle CI threshold.
      console.log(`commerce write p95: baseline=${baseline.sort((a, b) => a - b)[28].toFixed(1)}ms, audience-load=${commerceTimes.sort((a, b) => a - b)[28].toFixed(1)}ms`);
    } finally {
      await commerceDb.$disconnect();
    }
  });
});

test("retention removes only old v2 records and expired claims, preserving legacy events", async () => {
  await withDatabase(async (db) => {
    const oldDate = new Date("2024-01-01T00:00:00.000Z");
    await db.audienceEvent.create({ data: { contentId: "c12345678901234567890", eventType: "view", createdAt: oldDate } });
    await db.audienceEvent.create({ data: { contentId: "c12345678901234567890", eventType: "view", definition: "buy_page_v2", createdAt: oldDate } });
    await db.$executeRaw`INSERT INTO "AudienceViewClaim" ("contentId", "sessionId", "lastRecordedAtMs") VALUES (${"c12345678901234567890"}, ${"aud_old"}, ${oldDate.getTime()})`;
    await pruneAudienceV2(db, new Date("2026-10-19T00:00:00.000Z"));
    const rows = await db.audienceEvent.findMany();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].definition, null);
    const claims = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM "AudienceViewClaim"`;
    assert.equal(Number(claims[0].n), 0);
  });
});
