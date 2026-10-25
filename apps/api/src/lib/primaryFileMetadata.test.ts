import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Readable } from "node:stream";
import { getPrimaryFileMime, getStoredFileMime, storedMime } from "./primaryFileMetadata.js";
import { metadataFixture, formats } from "./primaryFileMetadata.testSupport.js";
import { initContentRepo, addFileToContentRepo } from "./repo.js";

const baseMime = (value: string | undefined) => (value || "").split(";")[0];

test("primary metadata uses the selected file, never work type, topic, cover or preview", () => {
  const files = [{ objectKey: "cover.jpg", mime: "image/jpeg" }, { objectKey: "preview.mp3", mime: "audio/mpeg" }, { objectKey: "contract.pdf", mime: "application/pdf" }];
  for (const primaryFile of ["contract.pdf", { path: "contract.pdf" }, { filename: "contract.pdf" }, { objectKey: "contract.pdf" }]) {
    assert.equal(getPrimaryFileMime({ primaryFile, cover: "cover.jpg", preview: "preview.mp3", files, type: "derivative", primaryTopic: "music" }, files), "application/pdf");
  }
  for (const primaryFile of [undefined, null, "", {}]) assert.equal(getPrimaryFileMime({ primaryFile, cover: "cover.jpg", files }, files), null);
  assert.equal(getPrimaryFileMime({ preview: { path: "preview.mp3" }, files: [files[1]] }, files), null);
  assert.equal(getPrimaryFileMime({ primaryFile: "missing", files }, files), null);
  assert.equal(getPrimaryFileMime({ primaryFile: "contract.pdf", files }, [{ objectKey: "contract.pdf", mime: "" }]), null);
});

test("legacy manifest metadata fallback is exact; malformed metadata stays unknown", () => {
  const manifest = { primaryFile: { path: "legacy.pdf" }, files: [{ path: "legacy.pdf", mime: "application/pdf" }, { path: "cover.png", mime: "image/png" }] };
  assert.equal(getPrimaryFileMime(manifest, []), "application/pdf");
  assert.equal(getStoredFileMime(manifest, "legacy.pdf", [{ objectKey: "legacy.pdf", mime: "text/plain" }]), "text/plain");
  assert.equal(getPrimaryFileMime({ files: [{ filename: "legacy.pdf", mime: "application/pdf" }] }, []), "application/pdf");
  for (const mime of [null, "", "unknown", "image", "text/plain\r\nX-Secret: bad", { mime: "application/pdf" }]) assert.equal(storedMime(mime), null);
  assert.equal(storedMime("application/octet-stream"), "application/octet-stream");
});

test("SQLite public routes: primary MIME, format coverage, publication compatibility and delivery protection", async t => {
  const f = await metadataFixture();
  try {
    const fixtures: Awaited<ReturnType<typeof f.seed>>[] = [];
    for (const [ext, mime] of formats) fixtures.push(await f.seed(ext, mime, { legacyObject: ext === "docx", coverMime: ext === "docx" ? "image/png" : "image/jpeg", historical: ext === "pdf" }));
    const before = await f.db.contentItem.findMany({ include: { files: true, manifest: true } });
    const discover = await f.app.inject("/public/discoverable-content?limit=50");
    assert.equal(discover.statusCode, 200, discover.body);
    const items = discover.json().items;
    for (const fixture of fixtures) {
      await t.test(`${fixture.mime}: discovery, offer, individual metadata and byte delivery agree`, async () => {
        assert.equal(items.find((x: any) => x.contentId === fixture.id).primaryFileMime, fixture.mime);
        const offer = await f.app.inject(`/buy/content/${fixture.id}/offer`);
        assert.equal(offer.statusCode, 200, offer.body); assert.equal(offer.json().primaryFileMime, fixture.mime);
        assert.equal(offer.json().primaryFileId, fixture.key);
        const work = await f.app.inject(`/public/content/${fixture.id}`);
        assert.equal(work.statusCode, 200, work.body); assert.equal(work.json().primaryFileMime, fixture.mime);
        for (const url of [`/content/${fixture.sha256}/${encodeURIComponent(fixture.key)}`, new URL(offer.json().fullMediaUrl).pathname + new URL(offer.json().fullMediaUrl).search]) {
          const delivered = await f.app.inject(url);
          assert.equal(delivered.statusCode, 200, delivered.body);
          assert.equal(baseMime(delivered.headers["content-type"]), fixture.mime);
          assert.deepEqual(delivered.rawPayload, fixture.bytes);
        }
      });
    }
    await t.test("metadata reads do not modify legacy publications, manifests, files or financial tables", async () => {
      assert.deepEqual(await f.db.contentItem.findMany({ include: { files: true, manifest: true } }), before);
      for (const table of [f.db.sale, f.db.settlement, f.db.paymentIntent, f.db.entitlement]) assert.equal(await (table as any).count(), 0);
      assert.equal(discover.headers["cache-control"], "no-store");
      const serialized = JSON.stringify(items);
      for (const forbidden of [f.dir, "encDek", "repoPath", "receiptToken", "primary.pdf", "objectKey"]) assert.ok(!serialized.includes(forbidden));
    });
    await t.test("narrow discovery projection preserves cards, visibility and fresh buyer ownership", async () => {
      const first = fixtures[0];
      // Unrelated proof/publication payloads can be large and contain stale MIME hints.
      await f.db.contentItem.update({ where: { id: first.id }, data: {
        publicationManifestJson: { primaryFileMime: "image/jpeg", proof: "fixture-private-proof".repeat(1000) },
        updatedAt: before.find(row => row.id === first.id)!.updatedAt
      } });
      const refreshed = await f.app.inject("/public/discoverable-content?limit=50");
      assert.deepEqual(refreshed.json(), discover.json());
      const hidden = await f.seed("pdf", "application/pdf");
      for (const data of [{ status: "draft" }, { status: "published", storefrontStatus: "UNLISTED" },
        { storefrontStatus: "DISABLED" }, { storefrontStatus: "LISTED", deletedAt: new Date() }]) {
        await f.db.contentItem.update({ where: { id: hidden.id }, data: data as any });
        assert.ok(!(await f.app.inject("/public/discoverable-content?limit=50")).json().items.some((item: any) => item.contentId === hidden.id));
      }
      const paid = await f.seed("pdf", "application/pdf", { paid: true });
      const headers = { "x-fixture-buyer": f.buyer.id };
      const read = async () => (await f.app.inject({ url: "/public/discoverable-content?limit=50", headers })).json().items.find((item: any) => item.contentId === paid.id);
      assert.equal((await read()).accessMode, "locked");
      await f.db.entitlement.create({ data: { buyerId: f.buyer.id, contentId: paid.id, manifestSha256: paid.sha256 } });
      assert.equal((await read()).accessMode, "owned");
      assert.equal((await read()).primaryFileMime, "application/pdf");
      assert.equal((await f.app.inject("/public/discoverable-content?limit=50")).json().items.find((item: any) => item.contentId === paid.id).accessMode, "locked");
      await f.db.entitlement.deleteMany({ where: { buyerId: f.buyer.id, contentId: paid.id } });
      assert.equal((await read()).accessMode, "locked");
      // Restore the fixture population used by the pagination checks below.
      await f.db.contentItem.deleteMany({ where: { id: { in: [hidden.id, paid.id] } } });
    });
    await t.test("fresh discovery reflects changed primary selection and MIME without republishing; paging has fixed query cost", async () => {
      const fixture = fixtures[0];
      // Older manifests can be addressable by contentId without the optional reverse relation.
      await f.db.contentItem.update({ where: { id: fixture.id }, data: { manifestId: null } });
      assert.equal((await f.app.inject("/public/discoverable-content?limit=50")).json().items.find((x: any) => x.contentId === fixture.id).primaryFileMime, fixture.mime);
      f.queries.length = 0; await f.app.inject("/public/discoverable-content?limit=1");
      const one = f.queries.filter(q => /^SELECT/.test(q)).length;
      f.queries.length = 0; const firstPage = await f.app.inject("/public/discoverable-content?limit=24");
      const many = f.queries.filter(q => /^SELECT/.test(q)).length;
      assert.equal(many, one); assert.ok(many <= 9, `SQL count ${many}`);
      assert.ok(firstPage.json().cursor);
      const next = await f.app.inject(`/public/discoverable-content?limit=24&cursor=${encodeURIComponent(firstPage.json().cursor)}`);
      assert.equal(next.json().items.length, 1);
      // Changes only this disposable fixture; unchanged manifest mimics a stale projection.
      await f.db.contentFile.update({ where: { contentId_objectKey: { contentId: fixture.id, objectKey: fixture.key } }, data: { mime: "text/plain" } });
      let refreshed = (await f.app.inject("/public/discoverable-content?limit=50")).json();
      assert.equal(refreshed.items.find((x: any) => x.contentId === fixture.id).primaryFileMime, "text/plain");
      for (const url of [`/buy/content/${fixture.id}/offer`, `/public/content/${fixture.id}`]) assert.equal((await f.app.inject(url)).json().primaryFileMime, "text/plain");
      assert.equal(baseMime((await f.app.inject(`/content/${fixture.sha256}/${encodeURIComponent(fixture.key)}`)).headers["content-type"]), "text/plain");
      await f.db.manifest.update({ where: { contentId: fixture.id }, data: { json: { ...fixture.manifest, primaryFile: fixture.previewKey } } });
      refreshed = (await f.app.inject("/public/discoverable-content?limit=50")).json();
      assert.equal(refreshed.items.find((x: any) => x.contentId === fixture.id).primaryFileMime, "audio/mpeg");
      t.diagnostic(`Discovery SQL SELECT count: one work=${one}, 24 works=${many}`);
    });
    await t.test("missing MIME and generic binary are explicit, never replaced by artwork", async () => {
      const unknown = await f.seed("unknown", ""); const binary = await f.seed("bin", "application/octet-stream");
      for (const fixture of [unknown, binary]) {
        const expected = fixture.mime || null;
        assert.equal((await f.app.inject(`/buy/content/${fixture.id}/offer`)).json().primaryFileMime, expected);
        assert.equal((await f.app.inject(`/public/content/${fixture.id}`)).json().primaryFileMime, expected);
        const items = (await f.app.inject("/public/discoverable-content?limit=50")).json().items;
        assert.equal(items.find((x: any) => x.contentId === fixture.id).primaryFileMime, expected);
      }
    });
    await t.test("approved derivative keeps its type, topic and rights gate", async () => {
      const derivative = await f.seed("pdf", "application/pdf", { type: "derivative" });
      assert.equal((await f.app.inject(`/public/content/${derivative.id}`)).statusCode, 404);
      const split = await f.db.splitVersion.create({ data: { contentId: fixtures[0].id, versionNumber: 1, createdByUserId: fixtures[0].content.ownerUserId, status: "locked" } });
      await f.db.contentLink.create({ data: { childContentId: derivative.id, parentContentId: fixtures[0].id, parentSplitVersionId: split.id, relation: "derivative", upstreamBps: 1000, requiresApproval: true, approvedAt: new Date() } });
      const response = await f.app.inject(`/public/content/${derivative.id}`); assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().primaryFileMime, "application/pdf");
      const item = (await f.app.inject("/public/discoverable-content?limit=50")).json().items.find((x: any) => x.contentId === derivative.id);
      assert.equal(item.contentType, "derivative"); assert.equal(item.primaryTopic, "news");
    });
    await t.test("paid originals require authorization; preview and Range cannot bypass access; revocation denies old tokens", async () => {
      const fixture = await f.seed("pdf", "application/pdf", { paid: true });
      const original = `/public/content/${fixture.id}/preview-file?objectKey=${encodeURIComponent(fixture.key)}`;
      assert.equal((await f.app.inject(original)).statusCode, 402);
      assert.equal((await f.app.inject({ url: original, headers: { range: "bytes=0-3" } })).statusCode, 402);
      const preview = `/public/content/${fixture.id}/preview-file?objectKey=${encodeURIComponent(fixture.previewKey)}`;
      assert.equal((await f.app.inject(preview)).statusCode, 200);
      const locked = (await f.app.inject(`/buy/content/${fixture.id}/offer`)).json();
      assert.equal(locked.hasFullAccess, false); assert.equal(locked.fullMediaUrl, null); assert.equal(locked.primaryFileMime, fixture.mime);
      await f.db.entitlement.create({ data: { buyerId: f.buyer.id, contentId: fixture.id, manifestSha256: fixture.sha256 } });
      const headers = { "x-fixture-buyer": f.buyer.id };
      const owned = (await f.app.inject({ url: `/buy/content/${fixture.id}/offer`, headers })).json();
      assert.equal(owned.hasFullAccess, true);
      const u = new URL(owned.fullMediaUrl); const authorized = u.pathname + u.search;
      const delivered = await f.app.inject({ url: authorized, headers });
      assert.equal(delivered.statusCode, 200, delivered.body); assert.equal(baseMime(delivered.headers["content-type"]), fixture.mime);
      assert.equal((await f.app.inject(authorized)).statusCode, 401);
      assert.equal((await f.app.inject({ url: authorized.replace(fixture.id, fixtures[0].id), headers })).statusCode, 401);
      await f.db.entitlement.deleteMany({ where: { buyerId: f.buyer.id, contentId: fixture.id } });
      assert.equal((await f.app.inject({ url: authorized, headers })).statusCode, 401);
      for (const ext of ["mp3", "mp4"]) {
        const media = await f.seed(ext, ext === "mp3" ? "audio/mpeg" : "video/mp4", { paid: true });
        const url = `/public/content/${media.id}/preview-file?objectKey=${encodeURIComponent(media.key)}`;
        assert.equal((await f.app.inject({ url, headers: { range: "bytes=0-3" } })).statusCode, 403);
        await f.db.entitlement.create({ data: { buyerId: f.buyer.id, contentId: media.id, manifestSha256: media.sha256 } });
        const offer = (await f.app.inject({ url: `/buy/content/${media.id}/offer`, headers })).json();
        assert.equal(offer.hlsRequired, true); assert.ok(offer.fullMediaUrl.includes("/hls/master.m3u8"));
      }
    });
    await t.test("Basic discovery still excludes paid works while reporting free file MIME", async () => {
      f.setNodeMode("basic"); const items = (await f.app.inject("/public/discoverable-content?limit=50")).json().items;
      assert.ok(items.length); assert.ok(items.every((x: any) => x.priceSats === 0)); assert.ok(items.every((x: any) => "primaryFileMime" in x));
    });
    await t.test("existing upload repository supports arbitrary named files and keeps primary separate from later cover", async () => {
      const repoPath = await initContentRepo({ root: f.dir, contentId: "upload-fixture", type: "file", title: "Upload fixture" });
      for (const [ext, mime] of formats) {
        const file = await addFileToContentRepo({ repoPath, contentTitle: "Upload fixture", originalName: `source.${ext}`, mime, stream: Readable.from(`opaque fixture ${ext}`), setAsPrimary: true });
        const manifest = JSON.parse(fs.readFileSync(`${repoPath}/manifest.json`, "utf8"));
        assert.equal(manifest.primaryFile.path, file.path); assert.equal(getPrimaryFileMime(manifest, []), mime);
      }
      const before = JSON.parse(fs.readFileSync(`${repoPath}/manifest.json`, "utf8")).primaryFile;
      await addFileToContentRepo({ repoPath, contentTitle: "Artwork", originalName: "cover.jpg", mime: "image/jpeg", stream: Readable.from("fixture-cover"), setAsPrimary: false });
      assert.deepEqual(JSON.parse(fs.readFileSync(`${repoPath}/manifest.json`, "utf8")).primaryFile, before);
    });
  } finally { await f.close(); }
});
