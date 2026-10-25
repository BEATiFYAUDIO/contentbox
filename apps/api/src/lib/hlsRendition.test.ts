import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { isCompleteHlsRendition, recoverHlsPromotion, stageAndPromoteHls } from './hlsRendition.js';

async function fixture(t: any) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hls-transaction-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, playlistPath: path.join(root, 'content/streams/master.m3u8'), privateKeyPath: path.join(root, 'private/content/source.key') };
}
async function encode({ playlistPath, segmentPattern, keyInfoPath }: { playlistPath: string; segmentPattern: string; keyInfoPath: string }) {
  const [, keyFile, ivHex] = (await fs.readFile(keyInfoPath, 'utf8')).trim().split('\n');
  const key = await fs.readFile(keyFile);
  const plain = Buffer.alloc(188 * 8);
  for (let i = 0; i < plain.length; i += 188) plain[i] = 0x47;
  const cipher = crypto.createCipheriv('aes-128-cbc', key, Buffer.from(ivHex, 'hex'));
  await fs.writeFile(segmentPattern.replace('%05d', '00000'), Buffer.concat([cipher.update(plain), cipher.final()]));
  await fs.writeFile(playlistPath, `#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="enc.key",IV=0x${ivHex}\n#EXTINF:6,\nseg00000.ts\n#EXT-X-ENDLIST\n`);
}

test('complete encrypted media uses private keys; wrong keys and missing segments are rejected', async (t) => {
  const f = await fixture(t);
  await stageAndPromoteHls(f, encode);
  assert.equal(await isCompleteHlsRendition(f), true);
  assert.equal((await fs.stat(f.privateKeyPath)).mode & 0o777, 0o600);
  await assert.rejects(fs.stat(path.join(path.dirname(f.playlistPath), 'enc.key')));
  const key = await fs.readFile(f.privateKeyPath);
  await fs.writeFile(f.privateKeyPath, crypto.randomBytes(16));
  assert.equal(await isCompleteHlsRendition(f), false);
  await fs.writeFile(f.privateKeyPath, key);
  await fs.unlink(path.join(path.dirname(f.playlistPath), 'seg00000.ts'));
  assert.equal(await isCompleteHlsRendition(f), false);
  await stageAndPromoteHls(f, encode);
  assert.equal(await isCompleteHlsRendition(f), true);
  assert.notDeepEqual(await fs.readFile(f.privateKeyPath), key);
});

test('partial encoding failure leaves old media and key byte-identical; retry succeeds', async (t) => {
  const f = await fixture(t);
  await stageAndPromoteHls(f, encode);
  const segment = path.join(path.dirname(f.playlistPath), 'seg00000.ts');
  const old = await Promise.all([f.playlistPath, f.privateKeyPath, segment].map((p) => fs.readFile(p)));
  await assert.rejects(stageAndPromoteHls(f, async (p) => {
    await fs.writeFile(p.segmentPattern.replace('%05d', '00000'), 'partial output');
    throw new Error('encoder stopped');
  }), /encoder stopped/);
  assert.deepEqual(await Promise.all([f.playlistPath, f.privateKeyPath, segment].map((p) => fs.readFile(p))), old);
  assert.equal(await isCompleteHlsRendition(f), true);
  assert.deepEqual(await fs.readdir(path.dirname(f.privateKeyPath)), ['source.key']);
  await stageAndPromoteHls(f, encode);
  assert.notDeepEqual(await fs.readFile(f.privateKeyPath), old[1]);
  assert.equal(await isCompleteHlsRendition(f), true);
});

test('encoder exit success with invalid or incomplete output never promotes', async (t) => {
  const f = await fixture(t);
  await stageAndPromoteHls(f, encode);
  const oldKey = await fs.readFile(f.privateKeyPath);
  await assert.rejects(stageAndPromoteHls(f, async (p) => {
    await encode(p);
    await fs.unlink(p.segmentPattern.replace('%05d', '00000'));
  }), /incomplete or invalid/);
  assert.deepEqual(await fs.readFile(f.privateKeyPath), oldKey);
  assert.equal(await isCompleteHlsRendition(f), true);
});

test('a custom rendition path cannot replace originals or unrelated files', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.dirname(f.playlistPath), { recursive: true });
  const original = path.join(path.dirname(f.playlistPath), 'original.mp4');
  await fs.writeFile(original, 'must remain untouched');
  let called = false;
  await assert.rejects(stageAndPromoteHls(f, async () => { called = true; }), /dedicated rendition/);
  assert.equal(called, false);
  assert.equal(await fs.readFile(original, 'utf8'), 'must remain untouched');
});

test('truncated, traversal and non-final playlists are not reusable', async (t) => {
  const f = await fixture(t);
  await stageAndPromoteHls(f, encode);
  const playlist = await fs.readFile(f.playlistPath, 'utf8');
  for (const bad of [playlist.replace('#EXT-X-ENDLIST', ''), playlist.replace('seg00000.ts', '../seg00000.ts')]) {
    await fs.writeFile(f.playlistPath, bad);
    assert.equal(await isCompleteHlsRendition(f), false);
  }
  await fs.writeFile(f.playlistPath, playlist);
  await fs.truncate(path.join(path.dirname(f.playlistPath), 'seg00000.ts'), 576);
  assert.equal(await isCompleteHlsRendition(f), false);
});

for (const committed of [false, true]) {
  test(`interrupted promotion recovers a coherent ${committed ? 'new' : 'old'} pair`, async (t) => {
    const f = await fixture(t);
    await stageAndPromoteHls(f, encode);
    const oldKey = await fs.readFile(f.privateKeyPath);
    const directory = path.dirname(f.playlistPath);
    const id = crypto.randomUUID();
    const previous = `${directory}.hls-previous-${id}`;
    await fs.rename(directory, previous);
    await stageAndPromoteHls(f, encode);
    const newKey = await fs.readFile(f.privateKeyPath);
    if (!committed) await fs.writeFile(f.privateKeyPath, oldKey);
    await fs.writeFile(`${f.privateKeyPath}.promotion.json`, JSON.stringify({
      version: 1, id, keyDigest: crypto.createHash('sha256').update(newKey).digest('hex'), hadMedia: true
    }), { mode: 0o600 });
    recoverHlsPromotion(f);
    assert.equal(await isCompleteHlsRendition(f), true);
    assert.deepEqual(await fs.readFile(f.privateKeyPath), committed ? newKey : oldKey);
    await assert.rejects(fs.stat(previous));
    await assert.rejects(fs.stat(`${f.privateKeyPath}.promotion.json`));
  });
}
