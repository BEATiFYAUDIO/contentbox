import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const baseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const contentId = String(process.env.PREVIEW_TEST_CONTENT_ID || "").trim();
const authToken = String(process.env.PREVIEW_TEST_AUTH_TOKEN || "").trim();

async function getPreview() {
  assert.ok(contentId, "PREVIEW_TEST_CONTENT_ID is required");
  assert.ok(authToken, "PREVIEW_TEST_AUTH_TOKEN is required");
  const res = await fetch(`${baseUrl}/content/${encodeURIComponent(contentId)}/preview`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  const text = await res.text();
  assert.equal(res.status, 200, `preview request failed: ${res.status} ${text}`);
  return JSON.parse(text) as any;
}

async function run() {
  try {
    const beforeFiles = await prisma.contentFile.findMany({ where: { contentId }, orderBy: { createdAt: "asc" } });
    for (let i = 0; i < 3; i++) {
      await getPreview();
    }

    const manifest = await prisma.manifest.findUnique({ where: { contentId } });
    const preview = String((manifest?.json as any)?.preview || "");
    assert.match(preview, new RegExp(`^previews/${contentId}-preview\\.(mp4|mp3)$`), "manifest.preview should be stable");

    const afterFiles = await prisma.contentFile.findMany({ where: { contentId }, orderBy: { createdAt: "asc" } });
    const duplicateGeneratedRows = afterFiles.filter((f) => /^.+-preview\.(mp4|mp3)$/i.test(String(f.originalName || "")));
    assert.equal(duplicateGeneratedRows.length, 0, "generated preview must not be stored as normal content files");
    assert.ok(afterFiles.length <= beforeFiles.length, "preview reads must not append content files");

    console.log("content_preview_idempotency_test OK");
  } finally {
    await prisma.$disconnect();
  }
}

run().catch(async (err) => {
  await prisma.$disconnect();
  console.error(err);
  process.exit(1);
});
