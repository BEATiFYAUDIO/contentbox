import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

/** SQLite's VACUUM INTO reads a consistent snapshot, including committed WAL frames. */
export async function createSqliteBackup(db: PrismaClient, directory: string, filename: string) {
  if (path.basename(filename) !== filename || !filename.endsWith(".sqlite")) {
    throw new Error("Invalid SQLite backup filename");
  }
  await fs.mkdir(directory, { recursive: true });
  const destination = path.join(directory, filename);
  const temporary = path.join(directory, `.contentbox-backup-${crypto.randomUUID()}.sqlite`);
  try {
    await db.$executeRawUnsafe("VACUUM INTO ?", temporary);
    const snapshot = new PrismaClient({ datasourceUrl: `file:${temporary}` });
    try {
      const result = await snapshot.$queryRawUnsafe<Array<{ integrity_check: string }>>("PRAGMA integrity_check");
      if (result.length !== 1 || result[0]?.integrity_check !== "ok") {
        throw new Error("SQLite backup integrity check failed");
      }
    } finally {
      await snapshot.$disconnect();
    }
    // Linking a completed snapshot is atomic and refuses to replace an existing backup.
    await fs.link(temporary, destination);
    return destination;
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
