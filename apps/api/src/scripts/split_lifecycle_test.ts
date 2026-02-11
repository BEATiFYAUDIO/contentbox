import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const baseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = (process.env.JWT_SECRET || "").trim();

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!jwtSecret) throw new Error("JWT_SECRET is required");

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function signJwt(payload: Record<string, any>, secret: string) {
  const header = { alg: "HS256", typ: "JWT" };
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
  const encoded = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  const sig = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

async function postJson(url: string, body: any, token?: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function run() {
  let ownerId: string | null = null;
  let collaboratorId: string | null = null;
  let splitId: string | null = null;
  let inviteToken: string | null = null;

  try {
    const owner = await prisma.user.create({
      data: { email: `owner+${Date.now()}@contentbox.local` }
    });
    ownerId = owner.id;
    const collaborator = await prisma.user.create({
      data: { email: `collab+${Date.now()}@contentbox.local` }
    });
    collaboratorId = collaborator.id;

    const content = await prisma.contentItem.create({
      data: {
        ownerUserId: owner.id,
        title: `Split lifecycle test ${Date.now()}`,
        type: "video",
        status: "draft",
        storefrontStatus: "DISABLED"
      }
    });

    const split = await prisma.splitVersion.create({
      data: {
        contentId: content.id,
        versionNumber: 1,
        createdByUserId: owner.id,
        status: "draft"
      }
    });
    splitId = split.id;

    await prisma.splitParticipant.createMany({
      data: [
        {
          splitVersionId: split.id,
          participantEmail: owner.email,
          participantUserId: owner.id,
          role: "writer",
          roleCode: "writer",
          percent: "60",
          bps: 6000,
          acceptedAt: new Date()
        },
        {
          splitVersionId: split.id,
          participantEmail: collaborator.email,
          participantUserId: null,
          role: "writer",
          roleCode: "writer",
          percent: "40",
          bps: 4000
        }
      ]
    });

    const ownerToken = signJwt({ sub: owner.id }, jwtSecret);
    const inviteRes = await postJson(`${baseUrl}/split-versions/${split.id}/invite`, {}, ownerToken);
    assert.equal(inviteRes.status, 200, `invite create failed: ${inviteRes.text}`);
    inviteToken = inviteRes.json?.invites?.[0]?.token || null;
    assert.ok(inviteToken, "invite token missing");

    const afterInvite = await prisma.splitVersion.findUnique({ where: { id: split.id } });
    assert.equal(afterInvite?.status, "pending_acceptance", "status should be pending_acceptance after invites");

    const collabToken = signJwt({ sub: collaborator.id }, jwtSecret);
    const acceptRes = await postJson(`${baseUrl}/invites/${inviteToken}/accept`, {}, collabToken);
    assert.equal(acceptRes.status, 200, `invite accept failed: ${acceptRes.text}`);

    const afterAccept = await prisma.splitVersion.findUnique({ where: { id: split.id } });
    assert.equal(afterAccept?.status, "ready", "status should be ready after all accepts");

    console.log("split_lifecycle_test OK");
  } finally {
    if (splitId) {
      await prisma.invitation.deleteMany({ where: { splitParticipant: { splitVersionId: splitId } } }).catch(() => {});
      await prisma.splitParticipant.deleteMany({ where: { splitVersionId: splitId } }).catch(() => {});
      await prisma.splitVersion.deleteMany({ where: { id: splitId } }).catch(() => {});
    }
    if (ownerId) await prisma.contentItem.deleteMany({ where: { ownerUserId: ownerId } }).catch(() => {});
    if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } }).catch(() => {});
    if (collaboratorId) await prisma.user.deleteMany({ where: { id: collaboratorId } }).catch(() => {});
    await prisma.$disconnect();
  }
}

run().catch((err) => {
  console.error("split_lifecycle_test failed:", err);
  process.exit(1);
});
