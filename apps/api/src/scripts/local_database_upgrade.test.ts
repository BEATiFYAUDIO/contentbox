import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
test('packaged database preparation initializes empty DBs but preserves existing runtime data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'core-db-upgrade-'));
  const url = `file:${path.join(root, 'contentbox.db')}`;
  const run = () => spawnSync(process.execPath, [path.join(apiDir, 'scripts/prepare-local-database.mjs')], {
    cwd: apiDir, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8'
  });
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    await db.$executeRawUnsafe('CREATE TABLE RuntimeOnly (id TEXT PRIMARY KEY, balance INTEGER)');
    await db.$executeRawUnsafe("INSERT INTO RuntimeOnly VALUES ('preserve', 100)");
    await db.$executeRawUnsafe('ALTER TABLE User ADD COLUMN legacyExtra TEXT');
    await db.$executeRawUnsafe("INSERT INTO User (id,email,legacyExtra) VALUES ('buyer','buyer@fixture.invalid','keep')");
    const snapshot = () => db.$queryRawUnsafe("SELECT type,name,sql FROM sqlite_master ORDER BY type,name");
    const before = await snapshot();
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await db.$queryRawUnsafe('SELECT * FROM RuntimeOnly'), [{ id: 'preserve', balance: 100 }]);
    assert.deepEqual(await db.$queryRawUnsafe('SELECT legacyExtra FROM User'), [{ legacyExtra: 'keep' }]);
    await db.$executeRawUnsafe('DROP TABLE ContentCredit');
    const incompatible = await snapshot();
    result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reviewed migration.*no schema changes made/);
    assert.deepEqual(await snapshot(), incompatible);
    assert.deepEqual(await db.$queryRawUnsafe('SELECT * FROM RuntimeOnly'), [{ id: 'preserve', balance: 100 }]);
  } finally { await db.$disconnect(); await fs.rm(root, { recursive: true, force: true }); }
});
