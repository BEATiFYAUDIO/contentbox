import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const baseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const prisma = new PrismaClient();

async function postJson(url: string, body: any, token?: string | null) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {})
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

async function del(url: string, token?: string | null) {
  const res = await fetch(url, {
    method: "DELETE",
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

async function getText(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  return { status: res.status, text };
}

async function getJson(url: string, token?: string | null) {
  const res = await fetch(url, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
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
  const stamp = Date.now();
  const ownerEmail = `lifecycle-owner-${stamp}@contentbox.local`;
  const buyerEmail = `lifecycle-buyer-${stamp}@contentbox.local`;
  const password = "password123";

  let ownerId: string | null = null;
  let ownerToken: string | null = null;
  let buyerId: string | null = null;
  let draftId: string | null = null;
  let publishedId: string | null = null;
  let purchasedDraftId: string | null = null;
  let paymentIntentId: string | null = null;
  let entitlementId: string | null = null;

  try {
    const ownerSignup = await postJson(`${baseUrl}/auth/signup`, { email: ownerEmail, password });
    assert.equal(ownerSignup.status, 200, `owner signup failed: ${ownerSignup.status}`);
    ownerId = ownerSignup.json?.user?.id || null;
    ownerToken = ownerSignup.json?.token || null;
    assert.ok(ownerId && ownerToken, "owner signup should return id/token");

    const buyerSignup = await postJson(`${baseUrl}/auth/signup`, { email: buyerEmail, password });
    assert.equal(buyerSignup.status, 200, `buyer signup failed: ${buyerSignup.status}`);
    buyerId = buyerSignup.json?.user?.id || null;
    assert.ok(buyerId, "buyer signup should return id");

    const draft = await prisma.contentItem.create({
      data: {
        ownerUserId: ownerId,
        title: `[test] draft ${stamp}`,
        type: "video",
        status: "draft",
        storefrontStatus: "DISABLED"
      }
    });
    draftId = draft.id;

    const published = await prisma.contentItem.create({
      data: {
        ownerUserId: ownerId,
        title: `[test] published ${stamp}`,
        type: "song",
        status: "published",
        storefrontStatus: "LISTED",
        featureOnProfile: true
      }
    });
    publishedId = published.id;

    // draft delete => trash
    const trashDraft = await postJson(`${baseUrl}/content/${encodeURIComponent(draftId)}/delete`, {}, ownerToken);
    assert.equal(trashDraft.status, 200, `draft delete failed: ${trashDraft.status}`);
    const draftAfterTrash = await prisma.contentItem.findUnique({ where: { id: draftId } });
    assert.ok(draftAfterTrash?.deletedAt, "draft should be moved to trash");
    assert.equal(String(draftAfterTrash?.deletedReason || ""), "trash", "draft deleteReason should be trash");

    // draft restore => active draft
    const restoreDraft = await postJson(`${baseUrl}/content/${encodeURIComponent(draftId)}/restore`, {}, ownerToken);
    assert.equal(restoreDraft.status, 200, `draft restore failed: ${restoreDraft.status}`);
    const draftAfterRestore = await prisma.contentItem.findUnique({ where: { id: draftId } });
    assert.equal(draftAfterRestore?.deletedAt, null, "draft restore should clear deletedAt");
    assert.equal(draftAfterRestore?.deletedReason, null, "draft restore should clear deletedReason");

    // published delete => archive
    const archivePublished = await postJson(`${baseUrl}/content/${encodeURIComponent(publishedId)}/delete`, {}, ownerToken);
    assert.equal(archivePublished.status, 200, `published delete/archive failed: ${archivePublished.status}`);
    const publishedAfterArchive = await prisma.contentItem.findUnique({ where: { id: publishedId } });
    assert.ok(publishedAfterArchive?.deletedAt, "published delete should archive");
    assert.equal(String(publishedAfterArchive?.deletedReason || ""), "archive", "published deleteReason should be archive");

    // catalog tabs should classify by deletedAt + status (not deletedReason legacy values)
    const archivedTab = await getJson(`${baseUrl}/content?tombstones=1&scope=mine`, ownerToken);
    assert.equal(archivedTab.status, 200, "archived catalog tab should load");
    const archivedIds = Array.isArray(archivedTab.json?.items) ? archivedTab.json.items.map((it: any) => String(it?.id || "")) : [];
    assert.ok(archivedIds.includes(publishedId), "published archived item should appear in archived tab");

    const trashTabAfterPublishedArchive = await getJson(`${baseUrl}/content?trash=1&scope=mine`, ownerToken);
    assert.equal(trashTabAfterPublishedArchive.status, 200, "trash catalog tab should load");
    const trashIdsAfterPublishedArchive = Array.isArray(trashTabAfterPublishedArchive.json?.items)
      ? trashTabAfterPublishedArchive.json.items.map((it: any) => String(it?.id || ""))
      : [];
    assert.ok(!trashIdsAfterPublishedArchive.includes(publishedId), "published archived item must not appear in trash tab");

    // archived published excluded from profile/discovery
    const handle = ownerEmail.split("@")[0];
    const profileAfterArchive = await getText(`${baseUrl}/u/${encodeURIComponent(handle)}`);
    assert.equal(profileAfterArchive.status, 200, "profile should load");
    assert.ok(!profileAfterArchive.text.includes(`[test] published ${stamp}`), "archived published should not be on profile");
    const discoveryAfterArchive = await getJson(`${baseUrl}/public/discoverable-content?limit=50`);
    assert.equal(discoveryAfterArchive.status, 200, "discoverable endpoint should load");
    const discoverIds = Array.isArray(discoveryAfterArchive.json?.items)
      ? discoveryAfterArchive.json.items.map((it: any) => String(it?.contentId || ""))
      : [];
    assert.ok(!discoverIds.includes(publishedId), "archived published should not appear in discoverable feed");

    // published restore => unarchive
    const unarchivePublished = await postJson(`${baseUrl}/content/${encodeURIComponent(publishedId)}/restore`, {}, ownerToken);
    assert.equal(unarchivePublished.status, 200, `published unarchive failed: ${unarchivePublished.status}`);
    const publishedAfterRestore = await prisma.contentItem.findUnique({ where: { id: publishedId } });
    assert.equal(publishedAfterRestore?.deletedAt, null, "unarchive should clear deletedAt");
    assert.equal(publishedAfterRestore?.deletedReason, null, "unarchive should clear deletedReason");

    // published archived content should never allow permanent delete path
    const reArchivePublished = await postJson(`${baseUrl}/content/${encodeURIComponent(publishedId)}/delete`, {}, ownerToken);
    assert.equal(reArchivePublished.status, 200, "published should archive again");
    const hardDeleteArchivedPublished = await del(`${baseUrl}/content/${encodeURIComponent(publishedId)}`, ownerToken);
    assert.equal(hardDeleteArchivedPublished.status, 409, "archived published should not be hard-deletable");
    assert.equal(
      String(hardDeleteArchivedPublished.json?.code || ""),
      "CONTENT_PERMANENT_DELETE_ONLY_FROM_TRASH",
      "archived published hard-delete should return trash-only error"
    );
    const unarchivePublishedAgain = await postJson(`${baseUrl}/content/${encodeURIComponent(publishedId)}/restore`, {}, ownerToken);
    assert.equal(unarchivePublishedAgain.status, 200, "published should unarchive again after hard-delete guard check");

    // setup a trashed unpublished content with history, ensure permanent delete blocked
    const purchasedDraft = await prisma.contentItem.create({
      data: {
        ownerUserId: ownerId,
        title: `[test] purchased-draft ${stamp}`,
        type: "file",
        status: "draft",
        storefrontStatus: "DISABLED"
      }
    });
    purchasedDraftId = purchasedDraft.id;

    const paidIntent = await prisma.paymentIntent.create({
      data: {
        buyerUserId: buyerId,
        contentId: purchasedDraftId,
        amountSats: BigInt(123),
        status: "paid",
        purpose: "CONTENT_PURCHASE",
        subjectType: "CONTENT",
        subjectId: purchasedDraftId
      }
    });
    paymentIntentId = paidIntent.id;

    const entitlement = await prisma.entitlement.create({
      data: {
        buyerUserId: buyerId,
        contentId: purchasedDraftId,
        manifestSha256: `m-${stamp}`,
        paymentIntentId: paidIntent.id
      }
    });
    entitlementId = entitlement.id;

    const trashPurchasedDraft = await postJson(`${baseUrl}/content/${encodeURIComponent(purchasedDraftId)}/delete`, {}, ownerToken);
    assert.equal(trashPurchasedDraft.status, 200, "purchased draft should be movable to trash");

    const trashTabAfterDraftTrash = await getJson(`${baseUrl}/content?trash=1&scope=mine`, ownerToken);
    assert.equal(trashTabAfterDraftTrash.status, 200, "trash catalog tab should load after draft trash");
    const trashIdsAfterDraftTrash = Array.isArray(trashTabAfterDraftTrash.json?.items)
      ? trashTabAfterDraftTrash.json.items.map((it: any) => String(it?.id || ""))
      : [];
    assert.ok(trashIdsAfterDraftTrash.includes(purchasedDraftId), "trashed unpublished item should appear in trash tab");

    const hardDeleteBlocked = await del(`${baseUrl}/content/${encodeURIComponent(purchasedDraftId)}`, ownerToken);
    assert.equal(hardDeleteBlocked.status, 409, `hard delete should be blocked: ${hardDeleteBlocked.status}`);
    assert.equal(
      String(hardDeleteBlocked.json?.code || ""),
      "CONTENT_HISTORY_DELETE_BLOCKED",
      "history content hard-delete should be blocked"
    );

    // plain trashed unpublished with no history => permanent delete allowed
    const plainDraft = await prisma.contentItem.create({
      data: {
        ownerUserId: ownerId,
        title: `[test] plain-trash ${stamp}`,
        type: "book",
        status: "draft",
        storefrontStatus: "DISABLED"
      }
    });
    const plainTrash = await postJson(`${baseUrl}/content/${encodeURIComponent(plainDraft.id)}/delete`, {}, ownerToken);
    assert.equal(plainTrash.status, 200, "plain draft should trash");
    const plainDelete = await del(`${baseUrl}/content/${encodeURIComponent(plainDraft.id)}`, ownerToken);
    assert.equal(plainDelete.status, 200, "plain trashed unpublished should hard-delete");
  } finally {
    if (entitlementId) await prisma.entitlement.deleteMany({ where: { id: entitlementId } }).catch(() => {});
    if (paymentIntentId) await prisma.paymentIntent.deleteMany({ where: { id: paymentIntentId } }).catch(() => {});
    if (purchasedDraftId) await prisma.contentItem.deleteMany({ where: { id: purchasedDraftId } }).catch(() => {});
    if (draftId) await prisma.contentItem.deleteMany({ where: { id: draftId } }).catch(() => {});
    if (publishedId) await prisma.contentItem.deleteMany({ where: { id: publishedId } }).catch(() => {});
    if (buyerId) await prisma.user.deleteMany({ where: { id: buyerId } }).catch(() => {});
    if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } }).catch(() => {});
  }
}

run()
  .then(async () => {
    console.log("content_lifecycle_projection_test OK");
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error("content_lifecycle_projection_test FAILED", err);
    await prisma.$disconnect();
    process.exit(1);
  });
