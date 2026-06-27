import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const baseUrl = String(process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");
const prisma = new PrismaClient();

async function request(pathname: string, opts: RequestInit & { token?: string; expectStatus?: number } = {}) {
  const headers = new Headers(opts.headers || {});
  headers.set("Accept", "application/json");
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  const res = await fetch(`${baseUrl}${pathname}`, { ...opts, headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (typeof opts.expectStatus === "number") {
    assert.equal(res.status, opts.expectStatus, `Expected ${opts.expectStatus}, got ${res.status}: ${JSON.stringify(json)}`);
  } else {
    assert.ok(res.ok, `Request failed ${res.status}: ${JSON.stringify(json)}`);
  }
  return { status: res.status, json };
}

async function signup() {
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `dashboard-upload-${runId}@local.test`;
  const { json } = await request("/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!", displayName: "Dashboard Upload Smoke" })
  });
  assert.ok(json?.token, "signup response missing token");
  return json.token as string;
}

async function createWork(token: string) {
  const { json } = await request("/content", {
    method: "POST",
    token,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: `Dashboard Upload ${Date.now()}`, type: "song" })
  });
  assert.ok(json?.id, "content create response missing id");
  return json.id as string;
}

async function upload(contentId: string, token: string, body: Blob, filename: string, expectStatus?: number) {
  const form = new FormData();
  form.append("file", body, filename);
  return request(`/content/${encodeURIComponent(contentId)}/files`, {
    method: "POST",
    token,
    headers: { "x-idempotency-key": `smoke-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    body: form,
    expectStatus
  });
}

async function main() {
  const token = await signup();
  const contentId = await createWork(token);
  const content = await prisma.contentItem.findUnique({ where: { id: contentId } });
  assert.ok(content?.repoPath, "created work missing repoPath");

  const body = new Blob([`dashboard upload smoke ${new Date().toISOString()}`], { type: "text/plain" });
  const uploaded = await upload(contentId, token, body, "dashboard-upload-smoke.txt");
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.json?.ok, true);
  assert.ok(uploaded.json?.id, "upload response missing file id");
  assert.ok(uploaded.json?.objectKey, "upload response missing objectKey");
  assert.ok(Number(uploaded.json?.sizeBytes || 0) > 0, "upload response missing non-zero size");
  assert.notEqual(uploaded.json?.sha256MatchesManifest, false, "upload response reports manifest mismatch");

  const contentFile = await prisma.contentFile.findUnique({
    where: { contentId_objectKey: { contentId, objectKey: uploaded.json.objectKey } }
  });
  assert.ok(contentFile, "DB contentFile row missing");
  assert.ok(Number(contentFile.sizeBytes || 0) > 0, "DB contentFile size is zero");

  const abs = path.join(content.repoPath, uploaded.json.objectKey);
  const stat = await fs.stat(abs);
  assert.ok(stat.isFile(), "uploaded file missing on disk");
  assert.ok(stat.size > 0, "uploaded file is empty on disk");

  const listed = await request(`/content/${encodeURIComponent(contentId)}/files`, { token });
  assert.ok(Array.isArray(listed.json), "file listing is not an array");
  assert.ok(
    listed.json.some((f: any) => f.id === uploaded.json.id && Number(f.sizeBytes || 0) > 0),
    "file listing does not include uploaded file"
  );

  const emptyContentId = await createWork(token);
  const empty = await upload(emptyContentId, token, new Blob([], { type: "text/plain" }), "empty.txt", 400);
  assert.match(String(empty.json?.error || ""), /empty|file is required/i, "empty upload should return clear failure");

  console.log("dashboard_upload_smoke_test OK", {
    contentId,
    fileId: uploaded.json.id,
    objectKey: uploaded.json.objectKey,
    sizeBytes: uploaded.json.sizeBytes
  });
}

main()
  .catch((err) => {
    console.error("dashboard_upload_smoke_test failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
