import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { stableStringify } from "../lib/proof.js";
import { finalizePurchase } from "../payments/finalizePurchase.js";

const baseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function postJson(url: string, body: any, token?: string | null) {
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

async function getJson(url: string, token?: string | null) {
  const res = await fetch(url, {
    method: "GET",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
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

function sha256Json(json: any): string {
  return crypto.createHash("sha256").update(stableStringify(json)).digest("hex");
}

async function run() {
  let userA: any = null;
  let userB: any = null;
  let userC: any = null;
  let parentId: string | null = null;
  let childId: string | null = null;
  let parentSplitId: string | null = null;
  let childSplitId: string | null = null;
  let parentManifestId: string | null = null;
  let childManifestId: string | null = null;
  let contentLinkId: string | null = null;
  let authorizationId: string | null = null;

  try {
    const signupA = await postJson(`${baseUrl}/auth/signup`, { email: `oga+${Date.now()}@contentbox.local`, password: "password123" });
    const signupB = await postJson(`${baseUrl}/auth/signup`, { email: `ogb+${Date.now()}@contentbox.local`, password: "password123" });
    const signupC = await postJson(`${baseUrl}/auth/signup`, { email: `child+${Date.now()}@contentbox.local`, password: "password123" });
    userA = signupA.json?.user;
    userB = signupB.json?.user;
    userC = signupC.json?.user;
    const tokenA = signupA.json?.token;
    const tokenB = signupB.json?.token;
    const tokenC = signupC.json?.token;
    assert.ok(userA?.id && userB?.id && userC?.id && tokenA && tokenB && tokenC, "signup must return tokens");

    const parent = await prisma.contentItem.create({
      data: { ownerUserId: userA.id, title: `[test] og parent ${Date.now()}`, type: "file", status: "published" }
    });
    parentId = parent.id;

    const parentSplit = await prisma.splitVersion.create({
      data: { contentId: parent.id, versionNumber: 1, status: "locked", createdByUserId: userA.id, lockedAt: new Date() }
    });
    parentSplitId = parentSplit.id;

    await prisma.splitParticipant.createMany({
      data: [
        { splitVersionId: parentSplit.id, participantEmail: userA.email, participantUserId: userA.id, role: "writer", roleCode: "writer", percent: "50", bps: 5000, acceptedAt: new Date() },
        { splitVersionId: parentSplit.id, participantEmail: userB.email, participantUserId: userB.id, role: "writer", roleCode: "writer", percent: "50", bps: 5000, acceptedAt: new Date() }
      ]
    });

    const parentManifestJson = { contentId: parent.id, title: parent.title, description: null, type: parent.type, status: parent.status, createdAt: new Date().toISOString(), files: [] };
    const parentSha = sha256Json(parentManifestJson);
    const parentManifest = await prisma.manifest.create({ data: { contentId: parent.id, json: parentManifestJson as any, sha256: parentSha } });
    parentManifestId = parentManifest.id;

    await prisma.contentItem.update({ where: { id: parent.id }, data: { manifestId: parentManifest.id, currentSplitId: parentSplit.id } });

    const child = await prisma.contentItem.create({
      data: { ownerUserId: userC.id, title: `[test] derivative ${Date.now()}`, type: "derivative", status: "published" as any }
    });
    childId = child.id;

    const childSplit = await prisma.splitVersion.create({
      data: { contentId: child.id, versionNumber: 1, status: "locked", createdByUserId: userC.id, lockedAt: new Date() }
    });
    childSplitId = childSplit.id;

    await prisma.splitParticipant.create({
      data: { splitVersionId: childSplit.id, participantEmail: userC.email, participantUserId: userC.id, role: "writer", roleCode: "writer", percent: "100", bps: 10000 }
    });

    const childManifestJson = { contentId: child.id, title: child.title, description: null, type: child.type, status: child.status, createdAt: new Date().toISOString(), files: [] };
    const childSha = sha256Json(childManifestJson);
    const childManifest = await prisma.manifest.create({ data: { contentId: child.id, json: childManifestJson as any, sha256: childSha } });
    childManifestId = childManifest.id;

    await prisma.contentItem.update({ where: { id: child.id }, data: { manifestId: childManifest.id, currentSplitId: childSplit.id } });

    const link = await prisma.contentLink.create({
      data: { parentContentId: parent.id, childContentId: child.id, relation: "derivative" as any, upstreamBps: 1000, requiresApproval: true }
    });
    contentLinkId = link.id;

    const reqRes = await postJson(`${baseUrl}/api/content-links/${link.id}/authorization/request`, {}, tokenC);
    assert.equal(reqRes.status, 200, `request expected 200, got ${reqRes.status}: ${reqRes.text}`);
    authorizationId = reqRes.json?.id || null;
    assert.ok(authorizationId, "authorization id must be returned");

    const pendingA = await getJson(`${baseUrl}/api/derivatives/approvals?scope=pending`, tokenA);
    assert.equal(pendingA.status, 200, `pending approvals (A) expected 200, got ${pendingA.status}`);
    assert.ok(Array.isArray(pendingA.json), "pending approvals (A) must be array");
    assert.ok(pendingA.json.some((r: any) => r.linkId === link.id), "User A should see pending approval");

    const pendingB = await getJson(`${baseUrl}/api/derivatives/approvals?scope=pending`, tokenB);
    assert.equal(pendingB.status, 200, `pending approvals (B) expected 200, got ${pendingB.status}`);
    assert.ok(Array.isArray(pendingB.json), "pending approvals (B) must be array");
    assert.ok(pendingB.json.some((r: any) => r.linkId === link.id), "User B should see pending approval");

    const clearanceA = await getJson(`${baseUrl}/content-links/${link.id}/clearance`, tokenA);
    assert.equal(clearanceA.status, 200, `clearance (A) expected 200, got ${clearanceA.status}: ${clearanceA.text}`);
    assert.ok(Array.isArray(clearanceA.json?.approvers), "clearance approvers must be array");
    assert.equal(clearanceA.json?.approvers?.length, 2, "approver count should be 2");
    assert.equal(clearanceA.json?.viewer?.canVote, true, "User A should be able to vote");

    const clearanceB = await getJson(`${baseUrl}/content-links/${link.id}/clearance`, tokenB);
    assert.equal(clearanceB.status, 200, `clearance (B) expected 200, got ${clearanceB.status}: ${clearanceB.text}`);
    assert.ok(Array.isArray(clearanceB.json?.approvers), "clearance approvers must be array");
    assert.equal(clearanceB.json?.approvers?.length, 2, "approver count should be 2");
    assert.equal(clearanceB.json?.viewer?.canVote, true, "User B should be able to vote");

    const storefrontRes = await postJson(`${baseUrl}/api/content/${child.id}/storefront`, { storefrontStatus: "UNLISTED" }, tokenC);
    assert.ok([403, 404, 409].includes(storefrontRes.status), `expected 403/404/409, got ${storefrontRes.status}`);
    if (storefrontRes.status === 409) {
      assert.equal(storefrontRes.json?.code, "DERIVATIVE_NOT_AUTHORIZED_FOR_STOREFRONT");
    }

    const voteRes = await postJson(
      `${baseUrl}/api/derivative-authorizations/${authorizationId}/vote`,
      { decision: "APPROVE", upstreamRatePercent: 10 },
      tokenA
    );
    assert.equal(voteRes.status, 200, `vote expected 200, got ${voteRes.status}`);
    assert.equal(voteRes.json?.status, "PENDING");

    const storefrontOk = await postJson(`${baseUrl}/api/content/${child.id}/storefront`, { storefrontStatus: "UNLISTED" }, tokenC);
    assert.ok([200, 404].includes(storefrontOk.status), `storefront update expected 200/404, got ${storefrontOk.status}`);

    const intent = await prisma.paymentIntent.create({
      data: {
        buyerUserId: userC.id,
        contentId: child.id,
        manifestSha256: childSha,
        amountSats: 10000n,
        status: "paid",
        purpose: "CONTENT_PURCHASE",
        subjectType: "CONTENT",
        subjectId: child.id,
        paidVia: "onchain"
      }
    });

    await finalizePurchase(intent.id, prisma);

    const settlement = await prisma.settlement.findUnique({ where: { paymentIntentId: intent.id }, include: { lines: true } });
    assert.ok(settlement, "settlement should exist");
    const total = settlement!.lines.reduce((s, l) => s + l.amountSats, 0n);
    assert.equal(total, 10000n, "settlement lines must sum to amount");

    const parentLines = settlement!.lines.filter((l) => l.participantEmail === userA.email || l.participantEmail === userB.email);
    const parentTotal = parentLines.reduce((s, l) => s + l.amountSats, 0n);
    assert.equal(parentTotal, 1000n, "upstream payout should be 10% (1000 sats)");
    const childLines = settlement!.lines.filter((l) => l.participantEmail === userC.email);
    const childTotal = childLines.reduce((s, l) => s + l.amountSats, 0n);
    assert.equal(childTotal, 9000n, "child payout should be 90% (9000 sats)");
  } finally {
    if (childId) {
      await prisma.derivativeApprovalVote.deleteMany({ where: { authorization: { derivativeLink: { childContentId: childId } } } }).catch(() => {});
      await prisma.derivativeAuthorization.deleteMany({ where: { derivativeLink: { childContentId: childId } } }).catch(() => {});
      await prisma.contentLink.deleteMany({ where: { childContentId: childId } }).catch(() => {});
      await prisma.settlementLine.deleteMany({ where: { settlement: { contentId: childId } } }).catch(() => {});
      await prisma.settlement.deleteMany({ where: { contentId: childId } }).catch(() => {});
      await prisma.entitlement.deleteMany({ where: { contentId: childId } }).catch(() => {});
      await prisma.paymentIntent.deleteMany({ where: { contentId: childId } }).catch(() => {});
      if (childSplitId) await prisma.splitParticipant.deleteMany({ where: { splitVersionId: childSplitId } }).catch(() => {});
      await prisma.splitVersion.deleteMany({ where: { contentId: childId } }).catch(() => {});
      if (childManifestId) await prisma.manifest.deleteMany({ where: { contentId: childId } }).catch(() => {});
      await prisma.contentItem.deleteMany({ where: { id: childId } }).catch(() => {});
    }
    if (parentId) {
      await prisma.splitParticipant.deleteMany({ where: { splitVersionId: parentSplitId || undefined } }).catch(() => {});
      await prisma.splitVersion.deleteMany({ where: { contentId: parentId } }).catch(() => {});
      if (parentManifestId) await prisma.manifest.deleteMany({ where: { contentId: parentId } }).catch(() => {});
      await prisma.contentItem.deleteMany({ where: { id: parentId } }).catch(() => {});
    }
    if (userA?.id) await prisma.user.deleteMany({ where: { id: userA.id } }).catch(() => {});
    if (userB?.id) await prisma.user.deleteMany({ where: { id: userB.id } }).catch(() => {});
    if (userC?.id) await prisma.user.deleteMany({ where: { id: userC.id } }).catch(() => {});
  }
}

run()
  .then(() => {
    console.log("derivative_authorization_test OK");
    return prisma.$disconnect();
  })
  .catch((err) => {
    console.error("derivative_authorization_test FAILED", err);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
