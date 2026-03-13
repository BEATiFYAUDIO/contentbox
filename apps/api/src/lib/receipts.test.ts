import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendLifecycleReceipt,
  canonicalJsonString,
  computeReceiptPayloadHash,
  getLifecycleReceiptById,
  isLifecycleReceipt,
  listLifecycleReceipts,
  summarizeLifecycleReceipts,
  verifyLifecycleReceipt
} from "./receipts.js";

function makeTempReceiptsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "certifyd-receipts-test-"));
}

test("canonical payload hashing is stable regardless of object key order", () => {
  const a = { z: 1, a: { y: 2, x: [3, { b: 1, a: 9 }] } };
  const b = { a: { x: [3, { a: 9, b: 1 }], y: 2 }, z: 1 };

  const sa = canonicalJsonString(a);
  const sb = canonicalJsonString(b);
  assert.equal(sa, sb);
  assert.equal(computeReceiptPayloadHash(a), computeReceiptPayloadHash(b));
});

test("creates and persists receipt chain for all V1 types", () => {
  const dir = makeTempReceiptsDir();
  const subjectNodeId = "node:local";
  const providerNodeId = "node:provider";

  const ack = appendLifecycleReceipt(dir, {
    type: "provider_acknowledgment",
    subjectNodeId,
    providerNodeId,
    objectId: "ack-1",
    payload: { status: "accepted" }
  });
  const permit = appendLifecycleReceipt(dir, {
    type: "operation_permit",
    subjectNodeId,
    providerNodeId,
    objectId: "permit-1",
    payload: { status: "accepted" }
  });
  const activation = appendLifecycleReceipt(dir, {
    type: "profile_activation",
    subjectNodeId,
    providerNodeId,
    objectId: "activation-1",
    payload: { status: "activated" }
  });
  const publish = appendLifecycleReceipt(dir, {
    type: "profile_publish",
    subjectNodeId,
    providerNodeId,
    objectId: "pub-1",
    payload: { status: "published" }
  });
  const contentPublish = appendLifecycleReceipt(dir, {
    type: "content_publish",
    subjectNodeId,
    providerNodeId,
    objectId: "content-1",
    payload: { status: "published" }
  });

  assert.equal(ack.prevReceiptId, null);
  assert.equal(permit.prevReceiptId, ack.id);
  assert.equal(activation.prevReceiptId, permit.id);
  assert.equal(publish.prevReceiptId, activation.id);

  const listed = listLifecycleReceipts(dir, 10);
  assert.equal(listed.length, 5);
  assert.equal(listed[0].id, contentPublish.id);
  assert.equal(listed[1].id, publish.id);
  assert.equal(listed[4].id, ack.id);

  const loaded = getLifecycleReceiptById(dir, publish.id);
  assert.ok(loaded);
  assert.equal(isLifecycleReceipt(loaded), true);
});

test("receipt verification detects payload tampering", () => {
  const dir = makeTempReceiptsDir();
  const receipt = appendLifecycleReceipt(dir, {
    type: "profile_publish",
    subjectNodeId: "node:local",
    providerNodeId: "node:provider",
    objectId: "pub-2",
    payload: { name: "before" }
  });

  const ok = verifyLifecycleReceipt(dir, receipt.id);
  assert.equal(ok.exists, true);
  assert.equal(ok.hashValid, true);
  assert.equal(ok.structuralValid, true);
  assert.equal(ok.type, "profile_publish");

  const receiptFile = path.join(dir, `${receipt.id}.json`);
  const parsed = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  parsed.payload = { name: "after" };
  fs.writeFileSync(receiptFile, JSON.stringify(parsed, null, 2));

  const tampered = verifyLifecycleReceipt(dir, receipt.id);
  assert.equal(tampered.exists, true);
  assert.equal(tampered.hashValid, false);
  assert.equal(tampered.structuralValid, true);
});

test("receipt summary returns latest lifecycle receipts and total count", () => {
  const dir = makeTempReceiptsDir();
  const subjectNodeId = "node:local";
  const providerNodeId = "node:provider";

  appendLifecycleReceipt(dir, {
    type: "provider_acknowledgment",
    subjectNodeId,
    providerNodeId,
    payload: { idx: 1 }
  });
  const ack2 = appendLifecycleReceipt(dir, {
    type: "provider_acknowledgment",
    subjectNodeId,
    providerNodeId,
    payload: { idx: 2 }
  });
  const permit = appendLifecycleReceipt(dir, {
    type: "operation_permit",
    subjectNodeId,
    providerNodeId,
    payload: { idx: 3 }
  });
  const activation = appendLifecycleReceipt(dir, {
    type: "profile_activation",
    subjectNodeId,
    providerNodeId,
    payload: { idx: 4 }
  });
  const publish = appendLifecycleReceipt(dir, {
    type: "profile_publish",
    subjectNodeId,
    providerNodeId,
    payload: { idx: 5 }
  });
  const contentPublish = appendLifecycleReceipt(dir, {
    type: "content_publish",
    subjectNodeId,
    providerNodeId,
    payload: { idx: 6 }
  });

  const summary = summarizeLifecycleReceipts(dir);
  assert.equal(summary.totalReceiptCount, 6);
  assert.equal(summary.latestAcknowledgmentReceipt?.id, ack2.id);
  assert.equal(summary.latestPermitReceipt?.id, permit.id);
  assert.equal(summary.latestActivationReceipt?.id, activation.id);
  assert.equal(summary.latestPublishReceipt?.id, publish.id);
  assert.equal(summary.latestContentPublishReceipt?.id, contentPublish.id);
});
