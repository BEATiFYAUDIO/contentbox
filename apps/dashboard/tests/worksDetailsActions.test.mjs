import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const works = readFileSync(new URL('../src/pages/ContentLibraryPage.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../../api/src/server.ts', import.meta.url), 'utf8');

test('Works retains its creator actions and the API routes that persist them', () => {
  for (const [label, handler, route] of [
    ['Save media', 'uploadToRepo(contentId, file', 'app.post("/content/:id/files"'],
    ['Update cover', 'uploadSongCover(contentId, file', 'app.post("/content/:id/cover"'],
    ['Edit splits', 'onOpenSplits?.(it.id)', 'app.post("/content/:id/splits"'],
    ['Publish', 'publishContent(it.id)', 'app.post("/api/content/:contentId/publish"'],
    ['Archive', 'softDelete(it.id)', 'app.post("/content/:id/delete"'],
    ['Save price', '`/content/${it.id}/price`', 'app.patch("/content/:id/price"'],
    ['Save delivery', '`/content/${it.id}/delivery-mode`', 'app.patch("/content/:id/delivery-mode"'],
    ['Save topic', '`/content/${it.id}/primary-topic`', 'app.patch("/content/:id/primary-topic"'],
    ['Add credit', '`/content/${it.id}/credits`', 'app.post("/content/:id/credits"'],
    ['Test public purchase flow', 'setTestPurchaseFor({', 'app.get("/public/content/:id"'],
  ]) {
    assert.ok(works.includes(label), `missing ${label} control`);
    assert.ok(works.includes(handler), `missing ${label} handler`);
    assert.ok(api.includes(route), `missing ${label} API route`);
  }
});

test('Details keeps work-level visibility and read-only technical actions available', () => {
  assert.match(works, /updateStorefrontStatus\(it\.id, e\.target\.value/);
  assert.match(works, /<option value="DISABLED">Hidden<\/option>/);
  assert.match(works, /<option value="UNLISTED">Direct Link<\/option>/);
  assert.match(works, /<option value="LISTED">Discoverable<\/option>/);
  for (const action of ['Open folder', 'View JSON', 'Copy JSON', 'Refresh split',
    'Copy LAN P2P Link', 'Copy Buy P2P Link', 'Preview network payload',
    'Content history']) {
    assert.ok(works.includes(action), `missing ${action}`);
  }
  assert.match(works, /<HistoryFeed[\s\S]*?title="Content history"/);
  assert.match(works, /<AuditPanel[\s\S]*?title="Audit"/);
});

test('visibility mutations remain separate from Core-wide public sharing', () => {
  const start = api.indexOf('app.patch("/api/content/:id/storefront"');
  const end = api.indexOf('app.patch("/api/discovery/public-origin"', start);
  assert.ok(start >= 0 && end > start);
  assert.match(api.slice(start, end), /data: \{ storefrontStatus: status as any \}/);
  assert.doesNotMatch(api.slice(start, end), /triggerPublicStart|cloudflared|setPublicMode/);
});

test('Details keeps publication proof and existing catalog codes visible', () => {
  const receiptStart = works.indexOf('{it.status === "published" && networkPublishByContent[it.id]?.hasReceipt ? (', works.indexOf('>Publication &amp; Proof</div>'));
  const receiptEnd = works.indexOf('</section>', receiptStart);
  const receipt = receiptStart >= 0 && receiptEnd > receiptStart ? works.slice(receiptStart, receiptEnd) : '';
  assert.ok(receipt, 'published receipt block is present');
  for (const label of ['Published to Certifyd Network', 'Status:', 'Published at:', 'Media Hash:', 'Publish receipt ID:', 'Provider node ID:']) {
    assert.ok(receipt.includes(label), `missing visible publication detail: ${label}`);
  }
  assert.doesNotMatch(receipt, /<details|<summary/, 'publication proof must not be collapsed');
  assert.match(receipt, /onClick=\{\(\) => copyText\(networkPublishByContent\[it\.id\]\?\.manifestHash/);
  assert.match(receipt, /onClick=\{\(\) => copyText\(networkPublishByContent\[it\.id\]\?\.receiptId/);
  const identifiersStart = works.indexOf('>Industry Identifiers</div>');
  const identifiersEnd = works.indexOf('>Credits &amp; Rights</div>', identifiersStart);
  const identifiers = identifiersStart >= 0 && identifiersEnd > identifiersStart ? works.slice(identifiersStart, identifiersEnd) : '';
  assert.ok(identifiers, 'industry identifiers are visible in Details');
  for (const type of ['ISRC', 'UPC', 'ISWC', 'EIDR', 'ISBN', 'DOI']) {
    assert.ok(identifiers.includes(type), `missing ${type}`);
  }
  assert.match(identifiers, /addExternalIdentifier\(it\.id\)/);
});

test('Details groups proof, contributor controls, and work sharing by purpose', () => {
  const publication = works.indexOf('>Publication &amp; Proof</div>');
  const credits = works.indexOf('>Credits &amp; Rights</div>', publication);
  const sharing = works.indexOf('>Visibility &amp; Sharing</h3>', credits);
  const history = works.indexOf('>History and audit</summary>', sharing);
  assert.ok(publication >= 0 && credits > publication && sharing > credits && history > sharing);
  assert.match(works.slice(publication, credits), /Published to Certifyd Network/);
  assert.doesNotMatch(works.slice(credits, sharing), /Published to Certifyd Network|Publish receipt ID:/);
  assert.match(works.slice(credits, sharing), /Owner:|Royalty split:|Add credit|Remove this credit\?/);
  const shared = works.slice(sharing, history);
  assert.match(shared, /Work visibility[\s\S]*?Work links/);
  assert.match(shared, /updateStorefrontStatus\(it\.id, e\.target\.value/);
  assert.match(shared, /Public buy link" : "Local, embed & P2P/);
  assert.match(shared, /setBuyLinksTabByContent/);
  assert.doesNotMatch(shared, /tab === "public" \? "Hide" : "Show"/);
});
