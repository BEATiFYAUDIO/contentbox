import fs from 'node:fs/promises';
import sync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Private keys never enter the content tree, including during encoding.
// Promotion is synchronous so other handlers in this process cannot observe its
// intermediate renames. A private journal allows recovery after process death.
type Paths = { playlistPath: string; privateKeyPath: string };
type Journal = { version: 1; id: string; keyDigest: string; hadMedia: boolean };
const hash = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');

export async function isCompleteHlsRendition({ playlistPath, privateKeyPath }: Paths): Promise<boolean> {
  try {
    if (!(await fs.lstat(privateKeyPath)).isFile()) return false;
    const key = await fs.readFile(privateKeyPath);
    if (key.length !== 16 || !(await fs.lstat(playlistPath)).isFile()) return false;
    const playlist = await fs.readFile(playlistPath, 'utf8');
    if (!playlist.startsWith('#EXTM3U') || !/^#EXT-X-ENDLIST\s*$/m.test(playlist)) return false;
    const keyLines = playlist.split(/\r?\n/).filter((line) => line.startsWith('#EXT-X-KEY:'));
    if (keyLines.length !== 1 || !/METHOD=AES-128(?:,|$)/.test(keyLines[0])) return false;
    if (!/URI="enc\.key"/.test(keyLines[0])) return false;
    const ivHex = /(?:^|,)IV=0x([a-fA-F0-9]{32})(?:,|$)/.exec(keyLines[0])?.[1];
    if (!ivHex) return false;
    const segments = playlist.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
    if (!segments.length || segments.length !== (playlist.match(/^#EXTINF:/gm) || []).length) return false;
    for (const segment of segments) {
      if (!/^[A-Za-z0-9._-]+\.ts$/.test(segment)) return false;
      const file = path.join(path.dirname(playlistPath), segment);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size < 576 || stat.size % 16 !== 0) return false;
      const handle = await fs.open(file, 'r');
      try {
        // Validate the key against MPEG-TS framing, not merely file existence.
        const first = Buffer.alloc(576);
        if ((await handle.read(first, 0, first.length, 0)).bytesRead !== first.length) return false;
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, Buffer.from(ivHex, 'hex'));
        decipher.setAutoPadding(false);
        const clear = Buffer.concat([decipher.update(first), decipher.final()]);
        if ([0, 188, 376].some((offset) => clear[offset] !== 0x47)) return false;
        const tail = Buffer.alloc(32);
        if ((await handle.read(tail, 0, 32, stat.size - 32)).bytesRead !== 32) return false;
        const last = crypto.createDecipheriv('aes-128-cbc', key, tail.subarray(0, 16));
        const end = Buffer.concat([last.update(tail.subarray(16)), last.final()]);
        if ((stat.size - 16 + end.length) % 188 !== 0) return false;
      } finally { await handle.close(); }
    }
    return true;
  } catch { return false; }
}

function transactionPaths(input: Paths, id: string) {
  const directory = path.dirname(input.playlistPath);
  return {
    directory,
    staged: `${directory}.hls-stage-${id}`,
    previous: `${directory}.hls-previous-${id}`,
    key: `${input.privateKeyPath}.${id}.tmp`,
    journal: `${input.privateKeyPath}.promotion.json`
  };
}

export function recoverHlsPromotion(input: Paths) {
  const journalPath = `${input.privateKeyPath}.promotion.json`;
  if (!sync.existsSync(journalPath)) return;
  const entry: Journal = JSON.parse(sync.readFileSync(journalPath, 'utf8'));
  if (entry.version !== 1 || !/^[a-f0-9-]{36}$/.test(entry.id) || !/^[a-f0-9]{64}$/.test(entry.keyDigest)) {
    throw new Error('Invalid private HLS promotion journal');
  }
  const tx = transactionPaths(input, entry.id);
  const committed = sync.existsSync(input.privateKeyPath) && hash(sync.readFileSync(input.privateKeyPath)) === entry.keyDigest;
  if (committed) {
    // Key promotion is last, after the complete media directory is in place.
    if (!sync.existsSync(input.playlistPath)) throw new Error('Committed HLS media missing');
    sync.rmSync(tx.previous, { recursive: true, force: true });
  } else if (sync.existsSync(tx.previous)) {
    sync.rmSync(tx.directory, { recursive: true, force: true });
    sync.renameSync(tx.previous, tx.directory);
  } else if (!entry.hadMedia) {
    sync.rmSync(tx.directory, { recursive: true, force: true });
  }
  sync.rmSync(tx.staged, { recursive: true, force: true });
  sync.rmSync(tx.key, { force: true });
  sync.unlinkSync(journalPath);
}

export async function stageAndPromoteHls(
  input: Paths,
  encode: (paths: { playlistPath: string; segmentPattern: string; keyInfoPath: string }) => Promise<void>
): Promise<void> {
  recoverHlsPromotion(input);
  // A legacy/custom manifest must not make promotion replace a directory that
  // also contains originals or other content. Only a dedicated rendition can
  // be swapped as a unit; leave unexpected files untouched and fail closed.
  try {
    const entries = await fs.readdir(path.dirname(input.playlistPath), { withFileTypes: true });
    if (entries.some((entry) => !entry.isFile() ||
      (entry.name !== path.basename(input.playlistPath) && entry.name !== 'enc.key' && !/^[A-Za-z0-9._-]+\.ts$/.test(entry.name)))) {
      throw new Error('HLS promotion requires a dedicated rendition directory');
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const id = crypto.randomUUID();
  const tx = transactionPaths(input, id);
  const keyDirectory = path.dirname(input.privateKeyPath);
  await fs.mkdir(keyDirectory, { recursive: true, mode: 0o700 });
  await fs.chmod(path.dirname(keyDirectory), 0o700);
  await fs.chmod(keyDirectory, 0o700);
  await fs.mkdir(path.dirname(tx.directory), { recursive: true });
  await fs.mkdir(tx.staged, { mode: 0o700 });
  const key = crypto.randomBytes(16);
  const keyInfoPath = `${tx.key}.info`;
  const playlistPath = path.join(tx.staged, path.basename(input.playlistPath));
  try {
    await fs.writeFile(tx.key, key, { mode: 0o600, flag: 'wx' });
    await fs.writeFile(keyInfoPath, `enc.key\n${tx.key}\n${crypto.randomBytes(16).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
    await encode({ playlistPath, segmentPattern: path.join(tx.staged, 'seg%05d.ts'), keyInfoPath });
    if (!(await isCompleteHlsRendition({ playlistPath, privateKeyPath: tx.key }))) {
      throw new Error('Generated HLS rendition is incomplete or invalid');
    }
    const entry: Journal = { version: 1, id, keyDigest: hash(key), hadMedia: sync.existsSync(tx.directory) };
    const fd = sync.openSync(tx.journal, 'wx', 0o600);
    try { sync.writeFileSync(fd, JSON.stringify(entry)); sync.fsyncSync(fd); } finally { sync.closeSync(fd); }
    try {
      if (entry.hadMedia) sync.renameSync(tx.directory, tx.previous);
      sync.renameSync(tx.staged, tx.directory);
      sync.renameSync(tx.key, input.privateKeyPath);
    } catch (error) {
      recoverHlsPromotion(input);
      throw error;
    }
    recoverHlsPromotion(input);
  } finally {
    await fs.rm(keyInfoPath, { force: true });
    // If recovery itself failed, keep the journal and assets for the next retry.
    if (!sync.existsSync(tx.journal)) {
      await fs.rm(tx.key, { force: true });
      await fs.rm(tx.staged, { recursive: true, force: true });
    }
  }
}
