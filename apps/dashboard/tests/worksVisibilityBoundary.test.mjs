import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const works = readFileSync(new URL('../src/pages/ContentLibraryPage.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../../api/src/server.ts', import.meta.url), 'utf8');

test('Works visibility controls cannot start, stop, or configure Core-wide public sharing', () => {
  assert.match(works, /\/api\/content\/\$\{contentId\}\/storefront[\s\S]*?"PATCH"/);
  assert.match(works, /value="DISABLED">Hidden/);
  assert.match(works, /value="UNLISTED">Direct Link/);
  assert.match(works, /value="LISTED">Discoverable/);
  assert.doesNotMatch(works, /["'`]\/api\/public\/(?:go|stop|autostart|consent\/reset)["'`]/);
});

test('individual storefront update persists only work visibility, not public mode or tunnel state', () => {
  const start = api.indexOf('app.patch("/api/content/:id/storefront"');
  const end = api.indexOf('app.patch("/api/discovery/public-origin"', start);
  assert.ok(start >= 0 && end > start);
  const handler = api.slice(start, end);
  assert.match(handler, /data: \{ storefrontStatus: status as any \}/);
  assert.doesNotMatch(handler, /triggerPublicStart|stopPublic|setPublicMode|cloudflared|\/api\/public\/stop/);
});

test('both public discovery projections include only discoverable works', () => {
  for (const [startName, endName] of [
    ['async function handlePublicDiscoverySignals', 'async function handlePublicDiscoverableContent'],
    ['async function handlePublicDiscoverableContent', 'app.get("/public/discoverable-content"'],
  ]) {
    const start = api.indexOf(startName);
    const end = api.indexOf(endName, start + startName.length);
    assert.ok(start >= 0 && end > start);
    assert.match(api.slice(start, end), /storefrontStatus: "LISTED"/);
  }
});
