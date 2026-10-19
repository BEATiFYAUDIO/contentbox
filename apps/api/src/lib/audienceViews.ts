import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export const AUDIENCE_VIEW_DEFINITION = "buy_page_v2";
export const AUDIENCE_VIEW_WINDOW_MS = 30 * 60 * 1000;
export const AUDIENCE_V2_RETENTION_DAYS = 395;
let audienceWriteQueue: Promise<void> = Promise.resolve();
let queuedAudienceWrites = 0;
const SESSION_PATTERN = /^aud_[a-f0-9]{32}$/;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;
const CONTENT_ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;

export function isAudienceCollectionEnabled(setting: string | undefined): boolean {
  return setting !== "0";
}

export function validateAudienceViewBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "contentId,eventType") return null;
  if (value.eventType !== "view" || typeof value.contentId !== "string") return null;
  return CONTENT_ID_PATTERN.test(value.contentId) ? value.contentId : null;
}

export function isAutomatedAudienceRequest(headers: Record<string, unknown>): boolean {
  const header = (name: string) => String(headers[name] || "").toLowerCase();
  const agent = header("user-agent");
  return /(?:bot\b|crawler|spider|preview|facebookexternalhit|twitterbot|slackbot|discordbot|googleother)/i.test(agent) ||
    /prefetch|prerender/.test(`${header("purpose")} ${header("sec-purpose")} ${header("x-moz")}`);
}

export function makeAudienceSession(secret: string): { id: string; cookieValue: string } {
  const id = `aud_${crypto.randomBytes(16).toString("hex")}`;
  return { id, cookieValue: `${id}.${crypto.createHmac("sha256", secret).update(id).digest("hex")}` };
}

export function verifyAudienceSession(cookieValue: string, secret: string): string | null {
  const [id, signature, extra] = String(cookieValue || "").split(".");
  if (extra || !SESSION_PATTERN.test(id || "") || !SIGNATURE_PATTERN.test(signature || "")) return null;
  const expected = crypto.createHmac("sha256", secret).update(id).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected) ? id : null;
}

export class AudienceRateLimiter {
  private windowStart = 0;
  private globalCount = 0;
  private sessionCounts = new Map<string, number>();

  allow(sessionId: string, now = Date.now()): boolean {
    if (now - this.windowStart >= 60_000 || now < this.windowStart) {
      this.windowStart = now;
      this.globalCount = 0;
      this.sessionCounts.clear();
    }
    // Bounds both database writes and the limiter's own memory. No forwarded IP is trusted.
    if (this.globalCount >= 1200 || (this.sessionCounts.get(sessionId) || 0) >= 60) return false;
    this.globalCount += 1;
    this.sessionCounts.set(sessionId, (this.sessionCounts.get(sessionId) || 0) + 1);
    return true;
  }
}

export async function recordBuyPageView(
  db: PrismaClient,
  contentId: string,
  sessionId: string,
  nowMs = Date.now()
): Promise<boolean> {
  // SQLite permits one writer. Serializing only analytics writes avoids lock timeouts
  // when a Buy page submits alongside another visitor; the SQL claim remains atomic
  // across Core processes. Reject excess analytics work rather than queue indefinitely.
  if (queuedAudienceWrites >= 100) throw new Error("Audience write queue full");
  queuedAudienceWrites += 1;
  const operation = audienceWriteQueue.then(async () => {
    return db.$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`
        INSERT INTO "AudienceViewClaim" ("contentId", "sessionId", "lastRecordedAtMs")
        VALUES (${contentId}, ${sessionId}, ${nowMs})
        ON CONFLICT ("contentId", "sessionId") DO UPDATE
        SET "lastRecordedAtMs" = excluded."lastRecordedAtMs"
        WHERE "AudienceViewClaim"."lastRecordedAtMs" <= ${nowMs - AUDIENCE_VIEW_WINDOW_MS}
      `;
      if (claimed !== 1) return false;
      await tx.audienceEvent.create({
        data: { contentId, eventType: "view", sessionId, definition: AUDIENCE_VIEW_DEFINITION }
      });
      return true;
    });
  });
  audienceWriteQueue = operation.then(() => undefined, () => undefined);
  try { return await operation; }
  finally { queuedAudienceWrites -= 1; }
}

export async function pruneAudienceV2(db: PrismaClient, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - AUDIENCE_V2_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  // Bounded batches keep retention work from holding SQLite's write lock for a long time.
  const expired = await db.audienceEvent.findMany({
    where: { definition: AUDIENCE_VIEW_DEFINITION, createdAt: { lt: cutoff } },
    select: { id: true },
    take: 1500
  });
  if (expired.length) await db.audienceEvent.deleteMany({ where: { id: { in: expired.map((row) => row.id) } } });
  await db.$executeRaw`
    DELETE FROM "AudienceViewClaim" WHERE ("contentId", "sessionId") IN (
      SELECT "contentId", "sessionId" FROM "AudienceViewClaim"
      WHERE "lastRecordedAtMs" < ${now.getTime() - AUDIENCE_VIEW_WINDOW_MS} LIMIT 1500
    )
  `;
}
