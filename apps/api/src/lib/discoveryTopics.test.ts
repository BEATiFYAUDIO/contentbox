import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { serverConstant } from "./primaryFileMetadata.testSupport.js";
import { topicFixture } from "./discoveryTopics.testSupport.js";

const historical = ["entertainment", "music", "news", "gaming", "sports", "technology"];
const added = ["legal", "business-work", "education-reference", "art-design", "books-writing"];
const topics = [...historical, ...added];

test("existing topic values remain intact and dashboard options match the additive API contract", () => {
  assert.deepEqual(Array.from(serverConstant("ALLOWED_PRIMARY_TOPICS")), topics);
  const source = fs.readFileSync(new URL("../../../dashboard/src/pages/ContentLibraryPage.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations])
    .find(d => d.name.getText(ast) === "PRIMARY_TOPIC_OPTIONS")!;
  const options = vm.runInNewContext(ts.transpileModule(`(${declaration.initializer!.getText(ast)})`, {}).outputText);
  assert.deepEqual(Array.from(options, (o: any) => o.value), topics);
  assert.deepEqual(Array.from(options.slice(0, 6), (o: any) => o.label), ["Entertainment", "Music", "News", "Gaming", "Sports", "Technology"]);
});

test("subject categories through real create, edit, publish and public handlers", async t => {
  const f = await topicFixture();
  try {
    const fixtures: Array<Awaited<ReturnType<typeof f.seed>>> = [];
    for (const [index, topic] of [...topics, null].entries()) {
      await t.test(`${topic ?? "uncategorized"}: optional creation, publication, filtering and MIME independence`, async () => {
        const create = await f.app.inject({ method: "POST", url: "/content", headers: f.headers,
          payload: { title: `Subject ${topic}`, type: "file", ...(topic === null ? {} : { primaryTopic: topic }) } });
        assert.equal(create.statusCode, 200, create.body);
        assert.equal(create.json().primaryTopic, topic);
        assert.equal(create.json().status, "draft");
        assert.ok(fs.existsSync(`${create.json().repoPath}/manifest.json`));
        const item = await f.seed("pdf", "application/pdf", { type: index % 2 ? "derivative" : "file", paid: index % 2 === 1, historical: true });
        fixtures.push(item);
        await f.db.contentItem.update({ where: { id: item.id }, data: { primaryTopic: topic, status: "draft" } });
        if (item.content.type === "derivative") {
          await f.db.contentLink.create({ data: { parentContentId: fixtures[0].id, childContentId: item.id,
            relation: "derivative", upstreamBps: 0, requiresApproval: true, approvedAt: new Date() } });
        }
        await f.db.splitVersion.create({ data: { contentId: item.id, createdByUserId: f.owner.id, versionNumber: 1, status: "locked",
          participants: { create: { participantEmail: f.owner.email, role: "owner", percent: "100" } } } });
        const publish = await f.app.inject({ method: "POST", url: `/api/content/${item.id}/publish`, headers: f.headers });
        assert.equal(publish.statusCode, 200, publish.body);
        const stored = await f.db.contentItem.findUniqueOrThrow({ where: { id: item.id }, include: { manifest: true } });
        assert.equal(stored.status, "published"); assert.equal(stored.primaryTopic, topic);
        const work = await f.app.inject(`/public/content/${item.id}`);
        const offer = await f.app.inject(`/buy/content/${item.id}/offer`);
        for (const response of [work, offer]) {
          assert.equal(response.statusCode, 200, response.body);
          assert.equal(response.json().primaryTopic, topic);
          assert.equal(response.json().primaryFileMime, "application/pdf");
        }
        assert.equal(offer.json().type, item.content.type);
        const discover = await f.app.inject(`/public/discoverable-content?limit=50${topic ? `&topic=${topic}` : ""}`);
        assert.equal(discover.statusCode, 200, discover.body);
        assert.equal(discover.json().items.find((x: any) => x.contentId === item.id)?.primaryTopic, topic);
        if (topic) assert.ok(discover.json().items.every((x: any) => x.primaryTopic === topic));
        assert.equal(new Date(stored.createdAt).getTime(), new Date("2023-01-01").getTime());
        assert.deepEqual(await f.db.contentItem.findUniqueOrThrow({ where: { id: item.id }, include: { manifest: true } }), stored);
      });
    }
    await t.test("editing changes only topic and updatedAt; proofs, files, publication, split and entitlement survive", async () => {
      const item = fixtures[1];
      const manifest = await f.db.manifest.findFirstOrThrow({ where: { contentId: item.id } });
      await f.db.entitlement.create({ data: { buyerId: f.buyer.id, contentId: item.id, manifestSha256: manifest.sha256 } });
      const snapshot = () => f.db.contentItem.findUniqueOrThrow({ where: { id: item.id }, include: { files: true, manifest: true, childLinks: true, splitVersions: { include: { participants: true } }, entitlements: true } });
      const before = await snapshot();
      const publications = await f.db.publishEvent.findMany();
      for (const primaryTopic of [...added, null, "music"]) {
        const r = await f.app.inject({ method: "PATCH", url: `/content/${item.id}/primary-topic`, headers: f.headers, payload: { primaryTopic } });
        assert.equal(r.statusCode, 200, r.body);
        const { primaryTopic: saved, updatedAt, ...after } = await snapshot();
        const { primaryTopic: previous, updatedAt: oldTime, ...unchanged } = before;
        assert.equal(saved, primaryTopic); assert.deepEqual(after, unchanged);
        const fresh = await f.app.inject(`/public/discoverable-content?limit=50${primaryTopic ? `&topic=${primaryTopic}` : ""}`);
        assert.match(String(fresh.headers["cache-control"]), /no-store/);
        assert.equal(fresh.json().items.find((x: any) => x.contentId === item.id)?.primaryTopic, primaryTopic);
        if (primaryTopic !== "music") {
          const old = await f.app.inject("/public/discoverable-content?topic=music");
          assert.ok(!old.json().items.some((x: any) => x.contentId === item.id));
        }
      }
      assert.deepEqual(await f.db.publishEvent.findMany(), publications);
      assert.equal(await f.db.sale.count(), 0); assert.equal(await f.db.settlement.count(), 0);
    });
    await t.test("unknown values rejected, canonical normalization retained, no category guesses", async () => {
      for (const value of ["unknown", "pdf", "software-tools", "", " "]) {
        for (const [method, url, payload] of [["POST", "/content", { title: "Invalid", primaryTopic: value }], ["PATCH", `/content/${fixtures[0].id}/primary-topic`, { primaryTopic: value }]] as const) {
          const r = await f.app.inject({ method, url, headers: f.headers, payload }); assert.equal(r.statusCode, 400, r.body);
        }
      }
      assert.equal((await f.app.inject("/public/discoverable-content?topic=unknown")).statusCode, 400);
      const r = await f.app.inject({ method: "PATCH", url: `/content/${fixtures[0].id}/primary-topic`, headers: f.headers, payload: { primaryTopic: " LEGAL " } });
      assert.equal(r.json().primaryTopic, "legal");
    });
    await t.test("unauthorized changes and paid downloads remain denied; entitled access survives category changes and revocation", async () => {
      const item = fixtures[1];
      const stored = await f.db.contentItem.findUniqueOrThrow({ where: { id: item.id }, include: { manifest: true } });
      const url = `/content/${stored.manifest!.sha256}/${encodeURIComponent(item.key)}`;
      for (const headers of [{}, { range: "bytes=0-7" }]) assert.equal((await f.app.inject({ url, headers })).statusCode, 402);
      const headers = { "x-fixture-buyer": f.buyer.id };
      const offer = await f.app.inject({ url: `/buy/content/${item.id}/offer`, headers });
      assert.equal(offer.json().hasFullAccess, true, offer.body);
      const delivery = new URL(offer.json().fullMediaUrl);
      const authorized = delivery.pathname + delivery.search;
      assert.equal((await f.app.inject({ url: authorized, headers })).statusCode, 200);
      await f.db.entitlement.deleteMany({ where: { contentId: item.id } });
      assert.equal((await f.app.inject({ url: authorized, headers })).statusCode, 401);
      for (const headers of [{}, { authorization: `Bearer ${f.app.jwt.sign({ sub: "different-owner" })}` }]) {
        const r = await f.app.inject({ method: "PATCH", url: `/content/${item.id}/primary-topic`, headers, payload: { primaryTopic: "legal" } });
        assert.ok([401,403].includes(r.statusCode), r.body);
      }
    });
    await t.test("visibility and Basic discovery exclusions remain; topic does not override derivative clearance", async () => {
      const item = fixtures[0];
      for (const data of [{ storefrontStatus: "UNLISTED" }, { storefrontStatus: "DISABLED" }, { storefrontStatus: "LISTED", deletedAt: new Date() }]) {
        await f.db.contentItem.update({ where: { id: item.id }, data: data as any });
        const r = await f.app.inject("/public/discoverable-content?topic=legal");
        assert.ok(!r.json().items.some((x: any) => x.contentId === item.id));
      }
      f.setNodeMode("basic");
      const basic = await f.app.inject("/public/discoverable-content?limit=50");
      assert.ok(basic.json().items.every((x: any) => Number(x.priceSats ?? 0) === 0));
      f.setNodeMode("advanced"); f.setClearance(false);
      const denied = await f.app.inject({ method: "POST", url: `/api/content/${fixtures[1].id}/publish`, headers: f.headers });
      assert.equal(denied.statusCode, 403, denied.body);
      assert.equal(denied.json().code, "derivative_requires_advanced_clearance");
    });
  } finally { await f.close(); }
});
