import type { PrismaClient } from "@prisma/client";
import type { CloudflareExportSource } from "./audienceExportAll.js";

/** Reads committed aggregate cache rows for one authenticated creator; never reads credentials. */
export function cloudflareAudienceExportSource(db: PrismaClient, userId: string): CloudflareExportSource {
  return {
    fingerprint: async (asOf) => {
      const value = await db.cloudflareAnalyticsSnapshot.aggregate({
        where: { userId, committed: true, fetchedAt: { lte: asOf } },
        _count: { _all: true }, _max: { updatedAt: true }
      });
      return { count: value._count._all, latestUpdatedAt: value._max.updatedAt };
    },
    page: (cursor, asOf) => db.cloudflareAnalyticsSnapshot.findMany({
      where: { userId, committed: true, fetchedAt: { lte: asOf } },
      orderBy: [{ fetchedAt: "desc" }, { id: "desc" }], take: 50,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, zoneId: true, hostname: true, source: true, metric: true,
        day: true, rowsJson: true, sampleInterval: true, coverage: true, fetchedAt: true }
    })
  };
}
