import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { uploadMultipart } from "../src/pages/ContentLibraryPage.js";

type ProgressEventHandler = ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
type EventHandler = (() => void) | null;

class FakeXMLHttpRequest {
  static latest: FakeXMLHttpRequest | null = null;

  readonly upload: { onprogress: ProgressEventHandler; onload: EventHandler } = {
    onprogress: null,
    onload: null
  };
  onload: EventHandler = null;
  onerror: EventHandler = null;
  onabort: EventHandler = null;
  status = 0;
  responseText = "";
  method = "";
  url = "";
  body: FormData | null = null;
  headers = new Map<string, string>();

  constructor() {
    FakeXMLHttpRequest.latest = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }

  send(body: FormData) {
    this.body = body;
  }
}

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pageSource = readFileSync(path.join(dashboardRoot, "src/pages/ContentLibraryPage.tsx"), "utf8");
const originalXMLHttpRequest = globalThis.XMLHttpRequest;

function installFakeXMLHttpRequest() {
  FakeXMLHttpRequest.latest = null;
  globalThis.XMLHttpRequest = FakeXMLHttpRequest as unknown as typeof XMLHttpRequest;
}

test.afterEach(() => {
  globalThis.XMLHttpRequest = originalXMLHttpRequest;
});

test("multipart upload reports real byte progress and waits for the server response", async () => {
  installFakeXMLHttpRequest();
  const progress: Array<number | null> = [];
  let saving = false;
  let resolved = false;
  const form = new FormData();
  form.append("file", new Blob(["media"]), "media.mp4");

  const request = uploadMultipart("http://127.0.0.1:4000/content/work/files", "token", "upload-key", form, {
    onProgress: (value) => progress.push(value),
    onTransferComplete: () => {
      saving = true;
    }
  }).then((result) => {
    resolved = true;
    return result;
  });

  const xhr = FakeXMLHttpRequest.latest;
  assert.ok(xhr);
  assert.equal(xhr.method, "POST");
  assert.equal(xhr.url, "http://127.0.0.1:4000/content/work/files");
  assert.equal(xhr.headers.get("Authorization"), "Bearer token");
  assert.equal(xhr.headers.get("x-idempotency-key"), "upload-key");
  assert.equal(xhr.body, form);

  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 47, total: 100 });
  assert.deepEqual(progress, [47]);
  xhr.upload.onload?.();
  await Promise.resolve();
  assert.equal(saving, true);
  assert.equal(resolved, false, "transfer completion must not be treated as persistence success");

  xhr.status = 200;
  xhr.responseText = '{"ok":true}';
  xhr.onload?.();
  assert.deepEqual(await request, { ok: true, status: 200, text: '{"ok":true}' });
});

test("multipart upload reports indeterminate progress and preserves failure handling", async () => {
  installFakeXMLHttpRequest();
  const progress: Array<number | null> = [];
  const request = uploadMultipart("/content/work/files", "token", "upload-key", new FormData(), {
    onProgress: (value) => progress.push(value),
    onTransferComplete: () => {}
  });

  const xhr = FakeXMLHttpRequest.latest;
  assert.ok(xhr);
  xhr.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });
  assert.deepEqual(progress, [null]);
  xhr.onerror?.();
  await assert.rejects(request, /Media could not be saved/);
});

test("Works UI keeps saving visible through persistence checks and prevents overlap", () => {
  assert.match(pageSource, /Saving and verifying your media… This may take a while for large videos\./);
  assert.match(pageSource, /Uploading \$\{upload\.progressPercent\}%/);
  assert.match(pageSource, /<span>Saved successfully<\/span>/);
  assert.match(pageSource, /if \(!file \|\| uploadSubmissionRef\.current\) return;/);
  assert.match(pageSource, /const triggerDisabled = Boolean\(disabled \|\| uploadBusy \|\| !authReady\);/);
  assert.equal((pageSource.match(/uploadSubmissionRef\.current = false;/g) || []).length, 2);

  const mainStart = pageSource.indexOf("const uploaded = await uploadToRepo");
  const mainReadback = pageSource.indexOf("const visible = visibleFiles.some", mainStart);
  const mainSuccess = pageSource.indexOf('setUpload({ status: "done", kind: "content"', mainStart);
  assert.ok(mainStart >= 0 && mainReadback > mainStart && mainSuccess > mainReadback);

  const coverStart = pageSource.indexOf("const uploaded = await uploadSongCover");
  const coverRefresh = pageSource.indexOf("const refreshed = await load();", coverStart);
  const coverSuccess = pageSource.indexOf('setUpload({ status: "done", kind: "cover"', coverStart);
  assert.ok(coverStart >= 0 && coverRefresh > coverStart && coverSuccess > coverRefresh);
  assert.match(pageSource.slice(coverRefresh, coverSuccess), /if \(!refreshed\)/);
  assert.match(pageSource, /status: "error", kind: "content"/);
  assert.match(pageSource, /status: "error", kind: "cover"/);
});
