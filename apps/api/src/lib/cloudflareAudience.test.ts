import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  CloudflareAudienceError, fetchCloudflareAudienceAggregates,
  normalizeCloudflareAudienceScope, verifyCloudflareAudienceAccess
} from "./cloudflareAudience.js";

const zoneId = "a".repeat(32);
const accountId = "b".repeat(32);
const scope = { zoneId, accountId, hostname: "creator.beatifygroup.com" };

test("connection scope rejects malformed IDs and hostnames", () => {
  assert.deepEqual(normalizeCloudflareAudienceScope(scope), scope);
  assert.equal(normalizeCloudflareAudienceScope({ ...scope, hostname: "-bad.example.com" }), null);
  assert.equal(normalizeCloudflareAudienceScope({ ...scope, hostname: "bad-.example.com" }), null);
  assert.equal(normalizeCloudflareAudienceScope({ ...scope, zoneId: "wrong" }), null);
});

test("verification checks the selected zone and optional account without returning a token", async () => {
  const queries: string[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    queries.push(body.query);
    assert.equal(init.headers && (init.headers as Record<string, string>).Authorization, "Bearer synthetic-secret");
    if (body.query.includes("viewer { zones")) return Response.json({ data: { viewer: { zones: [{ settings: {
      httpRequestsAdaptiveGroups: { enabled: true, notOlderThan: 2678400, maxDuration: 2592000 }
    } }] } } });
    return Response.json({ data: { viewer: { accounts: [{ settings: {
      rumPageloadEventsAdaptiveGroups: { enabled: true, notOlderThan: 15897600, maxDuration: 8035200 }
    } }] } } });
  }) as typeof fetch;
  const result = await verifyCloudflareAudienceAccess("synthetic-secret", scope, fetcher);
  assert.deepEqual(result, { http: true, webAnalytics: true, httpRetentionDays: 31, httpMaxQueryDays: 30 });
  assert.equal(queries.length, 2);
  assert.ok(!JSON.stringify(result).includes("synthetic-secret"));
});

test("aggregate queries remain zone and hostname scoped, with Buy paths separate", async () => {
  const queries: string[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const query = JSON.parse(String(init.body)).query as string;
    queries.push(query);
    const dimension = query.includes("clientCountryName") ? { clientCountryName: "Canada" } :
      query.includes("refererHost") ? { refererHost: "example.org" } : {};
    const group = { count: 12, avg: { sampleInterval: 4 }, dimensions: { date: "2026-10-18", ...dimension } };
    const key = query.includes("rumPageloadEventsAdaptiveGroups") ? "accounts" : "zones";
    return Response.json({ data: { viewer: { [key]: [{ rows: [group] }] } } });
  }) as typeof fetch;
  const rows = await fetchCloudflareAudienceAggregates("synthetic-secret", scope,
    { now: new Date("2026-10-19T12:00:00.000Z"), webAnalytics: true, fetcher });
  assert.equal(queries.length, 7);
  assert.ok(queries.every((query) => query.includes(scope.hostname)));
  assert.ok(queries.filter((query) => query.includes("httpRequestsAdaptiveGroups")).every((query) => query.includes(zoneId)));
  assert.ok(queries.filter((query) => query.includes("rumPageloadEventsAdaptiveGroups")).every((query) => query.includes(accountId)));
  assert.equal(queries.filter((query) => query.includes("clientRequestPath_like")).length, 1);
  assert.ok(queries.every((query) => !query.includes("visitorId") && !query.includes("clientIP")));
  const country = rows.find((row) => row.metric === "country" && row.day === "2026-10-18");
  assert.deepEqual(country?.rows, [{ label: "Canada", count: 12 }]);
  assert.equal(country?.sampleInterval, 4);
  assert.equal(country?.coverage, "observed");
  assert.equal(rows.find((row) => row.metric === "referrer" && row.day === "2026-10-17")?.coverage, "unknown");
  assert.ok(!JSON.stringify(rows).includes("synthetic-secret"));
});

test("expired token fails closed and does not become an empty report", async () => {
  const fetcher = (async () => new Response(null, { status: 403 })) as typeof fetch;
  await assert.rejects(verifyCloudflareAudienceAccess("expired", scope, fetcher),
    (error: unknown) => error instanceof CloudflareAudienceError && error.code === "unauthorized");
});

test("optional Web Analytics outage does not erase HTTP aggregate results", async () => {
  const fetcher = (async (_url: string, init: RequestInit) => {
    const query = JSON.parse(String(init.body)).query as string;
    if (query.includes("rumPageloadEventsAdaptiveGroups")) return new Response(null, { status: 503 });
    return Response.json({ data: { viewer: { zones: [{ rows: [{ count: 3,
      avg: { sampleInterval: 1 }, dimensions: { date: "2026-10-18" } }] }] } } });
  }) as typeof fetch;
  const rows = await fetchCloudflareAudienceAggregates("synthetic-secret", scope,
    { now: new Date("2026-10-19T12:00:00.000Z"), webAnalytics: true, fetcher });
  assert.equal(rows.filter((row) => row.metric === "traffic" && row.day === "2026-10-18")[0].rows[0].count, 3);
  assert.equal(rows.some((row) => row.metric === "referrer"), false);
});

test("oversized responses are rejected before parsing", async () => {
  const fetcher = (async () => new Response("x".repeat(2 * 1024 * 1024 + 1))) as typeof fetch;
  await assert.rejects(fetchCloudflareAudienceAggregates("synthetic-secret", scope,
    { now: new Date("2026-10-19T12:00:00.000Z"), fetcher }),
  (error: unknown) => error instanceof CloudflareAudienceError && error.code === "invalid_response");
});

test("migration stages aggregates without exposing a failed batch or another creator", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "certifyd-cloudflare-cache-"));
  const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(dir, "cache.db")}`;
  const db = new PrismaClient();
  try {
    await db.$executeRawUnsafe('CREATE TABLE "User" ("id" TEXT PRIMARY KEY)');
    const migration = fs.readFileSync(new URL("../../prisma/migrations/20261019160000_cloudflare_audience_aggregates/migration.sql", import.meta.url), "utf8");
    for (const statement of migration.split(";").map((entry) => entry.trim()).filter(Boolean)) {
      await db.$executeRawUnsafe(statement);
    }
    await db.$executeRawUnsafe('INSERT INTO "User" ("id") VALUES (\'creator-a\'), (\'creator-b\')');
    const common = { zoneId, hostname: scope.hostname, source: "cloudflare_http",
      metric: "traffic", day: "2026-10-18", rowsJson: '[{"label":"all","count":2}]', coverage: "observed" };
    await db.cloudflareAnalyticsSnapshot.create({ data: { ...common, userId: "creator-a", fetchedAt: new Date("2026-10-19T00:00:00Z"), committed: true } });
    await db.cloudflareAnalyticsSnapshot.create({ data: { ...common, userId: "creator-a", fetchedAt: new Date("2026-10-19T01:00:00Z"), committed: false } });
    await db.cloudflareAnalyticsSnapshot.create({ data: { ...common, userId: "creator-b", fetchedAt: new Date("2026-10-19T01:00:00Z"), committed: true } });
    const visible = await db.cloudflareAnalyticsSnapshot.findMany({ where: { userId: "creator-a", committed: true } });
    assert.equal(visible.length, 1);
    assert.equal(visible[0].fetchedAt.toISOString(), "2026-10-19T00:00:00.000Z");
    await db.cloudflareAnalyticsSnapshot.deleteMany({ where: { userId: "creator-a", committed: false } });
    assert.equal(await db.cloudflareAnalyticsSnapshot.count({ where: { userId: "creator-b" } }), 1);
  } finally {
    await db.$disconnect();
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
