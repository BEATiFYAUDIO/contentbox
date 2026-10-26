import type { PrismaClient } from "@prisma/client";

// A window starts only after schema preflight. An unclosed window from a crashed
// process ends at its last durable heartbeat, never at the next startup.
export async function beginAudienceTracking(db: PrismaClient, enabled: boolean, now = new Date()): Promise<string | null> {
  await db.$executeRaw`UPDATE "AudienceTrackingWindow" SET "endedAt" = "coveredUntil" WHERE "endedAt" IS NULL`;
  if (!enabled) return null;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT OR IGNORE INTO "AudienceTrackingActivation" ("userId", "activatedAt", "freshAccount")
      SELECT "id", ${now}, 0 FROM "User"`;
    const window = await tx.audienceTrackingWindow.create({ data: { startedAt: now, coveredUntil: now } });
    return window.id;
  });
}

export async function heartbeatAudienceTracking(db: PrismaClient, id: string, now = new Date()): Promise<string> {
  const window = await db.audienceTrackingWindow.findUnique({ where: { id }, select: { coveredUntil: true, endedAt: true } });
  if (!window || window.endedAt) throw new Error("Audience tracking window is unavailable");
  if (now.getTime() - window.coveredUntil.getTime() <= 120_000) {
    await db.audienceTrackingWindow.update({ where: { id }, data: { coveredUntil: now } });
    return id;
  }
  return db.$transaction(async (tx) => {
    await tx.audienceTrackingWindow.update({ where: { id }, data: { endedAt: window.coveredUntil } });
    const next = await tx.audienceTrackingWindow.create({ data: { startedAt: now, coveredUntil: now } });
    return next.id;
  });
}

export async function endAudienceTracking(db: PrismaClient, id: string, now = new Date()): Promise<void> {
  // If heartbeat writes have stalled, do not claim the unmeasured interval.
  const window = await db.audienceTrackingWindow.findUnique({ where: { id }, select: { coveredUntil: true } });
  const until = window && now.getTime() - window.coveredUntil.getTime() <= 120_000 ? now : window?.coveredUntil;
  if (until) await db.audienceTrackingWindow.updateMany({ where: { id, endedAt: null }, data: { coveredUntil: until, endedAt: until } });
}
