import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const baseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const prisma = new PrismaClient();

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

async function patchJson(url: string, body: any, token?: string | null) {
  const res = await fetch(url, {
    method: "PATCH",
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

async function getText(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  return { status: res.status, text };
}

async function run() {
  const stamp = Date.now();
  const email = `profile-feature-${stamp}@contentbox.local`;
  const password = "password123";
  const featuredTitle = `[test] featured content ${stamp}`;
  const draftTitle = `[test] draft hidden ${stamp}`;

  let userId: string | null = null;
  let token: string | null = null;
  let featuredContentId: string | null = null;
  let draftContentId: string | null = null;

  try {
    const signup = await postJson(`${baseUrl}/auth/signup`, { email, password });
    assert.equal(signup.status, 200, `signup failed: ${signup.status}`);
    userId = signup.json?.user?.id || null;
    token = signup.json?.token || null;
    assert.ok(userId && token, "signup should return user and token");

    const published = await prisma.contentItem.create({
      data: {
        ownerUserId: userId!,
        title: featuredTitle,
        type: "video",
        status: "published",
        storefrontStatus: "UNLISTED",
        featureOnProfile: false
      }
    });
    featuredContentId = published.id;

    const draft = await prisma.contentItem.create({
      data: {
        ownerUserId: userId!,
        title: draftTitle,
        type: "song",
        status: "draft",
        storefrontStatus: "UNLISTED",
        featureOnProfile: true
      }
    });
    draftContentId = draft.id;

    const handle = email.split("@")[0];

    const initialProfile = await getText(`${baseUrl}/u/${encodeURIComponent(handle)}`);
    assert.equal(initialProfile.status, 200, `profile fetch failed: ${initialProfile.status}`);
    assert.ok(!initialProfile.text.includes(featuredTitle), "unfeatured published content should not show");
    assert.ok(!initialProfile.text.includes(draftTitle), "draft content should never show even if featureOnProfile=true");

    const featureOn = await patchJson(
      `${baseUrl}/content/${encodeURIComponent(featuredContentId)}/feature-on-profile`,
      { featureOnProfile: true },
      token
    );
    assert.equal(featureOn.status, 200, `feature on failed: ${featureOn.status}`);

    const afterFeatureProfile = await getText(`${baseUrl}/u/${encodeURIComponent(handle)}`);
    assert.equal(afterFeatureProfile.status, 200, `profile fetch failed after feature: ${afterFeatureProfile.status}`);
    assert.ok(afterFeatureProfile.text.includes(featuredTitle), "featured published content should appear on profile");
    assert.ok(!afterFeatureProfile.text.includes(draftTitle), "draft featured content must remain hidden");

    const featureOff = await patchJson(
      `${baseUrl}/content/${encodeURIComponent(featuredContentId)}/feature-on-profile`,
      { featureOnProfile: false },
      token
    );
    assert.equal(featureOff.status, 200, `feature off failed: ${featureOff.status}`);

    const afterUnfeatureProfile = await getText(`${baseUrl}/u/${encodeURIComponent(handle)}`);
    assert.equal(afterUnfeatureProfile.status, 200, `profile fetch failed after unfeature: ${afterUnfeatureProfile.status}`);
    assert.ok(!afterUnfeatureProfile.text.includes(featuredTitle), "unfeatured content should be removed from profile");
    assert.ok(!afterUnfeatureProfile.text.includes(draftTitle), "draft featured content must remain hidden");
  } finally {
    if (featuredContentId) {
      await prisma.contentItem.deleteMany({ where: { id: featuredContentId } }).catch(() => {});
    }
    if (draftContentId) {
      await prisma.contentItem.deleteMany({ where: { id: draftContentId } }).catch(() => {});
    }
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    }
  }
}

run()
  .then(async () => {
    console.log("profile_feature_projection_test OK");
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error("profile_feature_projection_test FAILED", err);
    await prisma.$disconnect();
    process.exit(1);
  });
