// Existing SQLite installations may contain runtime-managed tables/columns that
// are intentionally absent from Prisma's schema. Never synchronize them away.
import { Prisma, PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!String(process.env.DATABASE_URL || '').startsWith('file:')) {
  throw new Error('Packaged local database preparation requires a SQLite file URL.');
}
const db = new PrismaClient();
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
try {
  const tables = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  if (tables.length === 0) {
    await db.$disconnect();
    // Schema creation is permitted only for a genuinely empty database.
    execFileSync(process.execPath, [path.join(apiDir, 'node_modules/prisma/build/index.js'),
      'db', 'push', '--schema', path.join(apiDir, 'prisma/schema.prisma'), '--skip-generate'],
    { cwd: apiDir, env: process.env, stdio: 'inherit' });
    console.log('[database] Initialized an empty local database.');
  } else {
    const existing = new Set(tables.map((row) => row.name));
    const missing = [];
    for (const model of Prisma.dmmf.datamodel.models) {
      const table = model.dbName || model.name;
      if (!existing.has(table)) { missing.push(table); continue; }
      const columns = await db.$queryRawUnsafe(`PRAGMA table_info(${quote(table)})`);
      const names = new Set(columns.map((row) => row.name));
      for (const field of model.fields.filter((field) => field.kind !== 'object')) {
        const column = field.dbName || field.name;
        if (!names.has(column)) missing.push(`${table}.${column}`);
      }
    }
    if (missing.length) {
      throw new Error(`Existing database needs a reviewed migration; no schema changes made. Missing: ${missing.join(', ')}. Do not use reset or --accept-data-loss.`);
    }
    console.log('[database] Existing database is compatible; schema and records preserved.');
  }
} finally {
  await db.$disconnect();
}
