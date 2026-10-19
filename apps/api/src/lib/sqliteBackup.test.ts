import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createSqliteBackup } from "./sqliteBackup.js";

test("backup captures committed WAL transactions while writes continue and restores intact", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "certifyd-backup-"));
  const source = path.join(dir, "source.sqlite");
  const db = new PrismaClient({ datasourceUrl: `file:${source}` });
  try {
    await db.$queryRawUnsafe("PRAGMA journal_mode=WAL");
    for (const table of ["PaymentIntent", "Sale", "Receipt", "Entitlement", "AudienceEvent"]) {
      await db.$executeRawUnsafe(`CREATE TABLE "${table}" (id TEXT PRIMARY KEY, kind TEXT NOT NULL)`);
    }
    for (const table of ["PaymentIntent", "Sale", "Receipt", "Entitlement"]) {
      await db.$executeRawUnsafe(`INSERT INTO "${table}" (id, kind) VALUES ('${table}', 'commerce')`);
    }
    await db.$executeRawUnsafe("INSERT INTO \"AudienceEvent\" (id, kind) VALUES ('new', 'buy_page_v2'), ('old', 'legacy')");
    const wal = await fs.stat(`${source}-wal`);
    assert.ok(wal.size > 0, "committed records should still be in the WAL");
    const backup = await createSqliteBackup(db, dir, "snapshot.sqlite");
    await db.$executeRawUnsafe("INSERT INTO \"AudienceEvent\" (id, kind) VALUES ('later', 'after-snapshot')");
    const restored = new PrismaClient({ datasourceUrl: `file:${backup}` });
    try {
      for (const table of ["PaymentIntent", "Sale", "Receipt", "Entitlement"]) {
        const rows = await restored.$queryRawUnsafe<Array<{ kind: string }>>(`SELECT kind FROM "${table}"`);
        assert.deepEqual(rows.map((row) => row.kind), ["commerce"]);
      }
      const audience = await restored.$queryRawUnsafe<Array<{ kind: string }>>("SELECT kind FROM \"AudienceEvent\" ORDER BY id");
      assert.deepEqual(audience.map((row) => row.kind), ["buy_page_v2", "legacy"]);
      assert.deepEqual(await restored.$queryRawUnsafe("PRAGMA integrity_check"), [{ integrity_check: "ok" }]);
    } finally { await restored.$disconnect(); }
    await assert.rejects(createSqliteBackup(db, dir, "snapshot.sqlite"));
    assert.ok((await fs.stat(backup)).size > 0, "failed duplicate must not replace the previous backup");
  } finally { await db.$disconnect(); await fs.rm(dir, { recursive: true, force: true }); }
});

test("backup failures leave no published or temporary backup", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "certifyd-backup-fail-"));
  try {
    const broken = { $executeRawUnsafe: async (_sql: string, temporary: string) => {
      await fs.writeFile(temporary, "partial");
      throw new Error("simulated snapshot failure");
    } } as unknown as PrismaClient;
    await assert.rejects(createSqliteBackup(broken, dir, "failed.sqlite"), /simulated snapshot failure/);
    assert.equal((await fs.readdir(dir)).filter((name) => name.includes("backup-") || name === "failed.sqlite").length, 0);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("backup under concurrent transactional writes preserves a single consistent point in time", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "certifyd-backup-concurrent-"));
  const source = path.join(dir, "source.sqlite");
  const writer = new PrismaClient({ datasourceUrl: `file:${source}` });
  const reader = new PrismaClient({ datasourceUrl: `file:${source}` });
  try {
    await writer.$queryRawUnsafe("PRAGMA journal_mode=WAL");
    await writer.$executeRawUnsafe("CREATE TABLE commerce (id INTEGER PRIMARY KEY)");
    await writer.$executeRawUnsafe("CREATE TABLE audience (id INTEGER PRIMARY KEY)");
    const writePair = async (id: number) => writer.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO commerce (id) VALUES (${id})`;
      await tx.$executeRaw`INSERT INTO audience (id) VALUES (${id})`;
    });
    for (let n = 1; n <= 10; n++) await writePair(n);
    const snapshot = createSqliteBackup(reader, dir, "concurrent.sqlite");
    const writes = (async () => { for (let n = 11; n <= 40; n++) await writePair(n); })();
    await Promise.all([snapshot, writes]);
    const restored = new PrismaClient({ datasourceUrl: `file:${path.join(dir, "concurrent.sqlite")}` });
    try {
      const [commerce] = await restored.$queryRawUnsafe<Array<{ n: bigint }>>("SELECT COUNT(*) AS n FROM commerce");
      const [audience] = await restored.$queryRawUnsafe<Array<{ n: bigint }>>("SELECT COUNT(*) AS n FROM audience");
      assert.ok(Number(commerce.n) >= 10 && Number(commerce.n) <= 40);
      assert.equal(Number(commerce.n), Number(audience.n), "a transaction cannot be half-copied");
      assert.deepEqual(await restored.$queryRawUnsafe("PRAGMA integrity_check"), [{ integrity_check: "ok" }]);
    } finally { await restored.$disconnect(); }
  } finally {
    await reader.$disconnect(); await writer.$disconnect();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
