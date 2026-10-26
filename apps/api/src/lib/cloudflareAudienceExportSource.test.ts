import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { cloudflareAudienceExportSource } from "./cloudflareAudienceExportSource.js";

test("Cloudflare export reads only committed aggregates owned by the authenticated creator", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "certifyd-cloudflare-export-"));
  const priorUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(dir, "export.db")}`;
  const db = new PrismaClient();
  try {
    await db.$executeRawUnsafe('CREATE TABLE "User" ("id" TEXT PRIMARY KEY)');
    const migration = fs.readFileSync(new URL("../../prisma/migrations/20261019160000_cloudflare_audience_aggregates/migration.sql", import.meta.url), "utf8");
    for (const statement of migration.split(";").map((entry) => entry.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
    await db.$executeRawUnsafe('INSERT INTO "User" ("id") VALUES (\'creator-a\'), (\'creator-b\')');
    await db.cloudflareAnalyticsConnection.create({ data: { userId: "creator-a", zoneId: "a".repeat(32),
      hostname: "creator.example.com", tokenCiphertext: "synthetic-secret-marker", tokenIv: "iv", tokenTag: "tag" } });
    const base = { zoneId: "a".repeat(32), hostname: "creator.example.com", source: "cloudflare_http",
      metric: "traffic", day: "2026-10-18", rowsJson: '[{"label":"all","count":1}]', coverage: "observed",
      fetchedAt: new Date("2026-10-19T08:00:00Z") };
    await db.cloudflareAnalyticsSnapshot.create({ data: { ...base, userId: "creator-a", committed: true } });
    await db.cloudflareAnalyticsSnapshot.create({ data: { ...base, userId: "creator-a", day: "2026-10-17", committed: false } });
    await db.cloudflareAnalyticsSnapshot.create({ data: { ...base, userId: "creator-a", day: "2026-10-16",
      fetchedAt: new Date("2026-10-20T08:00:00Z"), committed: true } });
    await db.cloudflareAnalyticsSnapshot.create({ data: { ...base, userId: "creator-b", committed: true } });
    const source = cloudflareAudienceExportSource(db, "creator-a");
    const asOf = new Date("2026-10-19T12:00:00Z");
    assert.equal((await source.fingerprint(asOf)).count, 1);
    const page = await source.page(null, asOf);
    assert.equal(page.length, 1);
    assert.equal(page[0].day, "2026-10-18");
    assert.doesNotMatch(JSON.stringify(page), /synthetic-secret-marker|tokenCiphertext|userId/);
    assert.equal((await cloudflareAudienceExportSource(db, "creator-b").page(null, asOf)).length, 1);
  } finally {
    await db.$disconnect();
    if (priorUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorUrl;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
