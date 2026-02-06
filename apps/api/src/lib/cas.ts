import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

type CasEntry = {
  sizeBytes: number;
  lastAccessMs: number;
};

type CasIndex = {
  version: 1;
  maxBytes: number;
  entries: Record<string, CasEntry>;
};

type CasOpts = {
  root: string;
  maxBytes: number;
};

function isHexHash(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

export class LocalCasCache {
  private readonly root: string;
  private readonly maxBytes: number;
  private readonly baseDir: string;
  private readonly indexPath: string;
  private entries: Record<string, CasEntry> = {};
  private totalBytes = 0;
  private ready: Promise<void> | null = null;

  constructor(opts: CasOpts) {
    this.root = opts.root;
    this.maxBytes = Math.max(0, Math.floor(opts.maxBytes));
    this.baseDir = path.join(this.root, ".cache", "cas");
    this.indexPath = path.join(this.baseDir, "index.json");
  }

  private async init() {
    await fsp.mkdir(this.baseDir, { recursive: true });
    const loaded = await this.readIndex();
    if (loaded) {
      this.entries = loaded.entries || {};
      this.totalBytes = Object.values(this.entries).reduce((acc, v) => acc + (v.sizeBytes || 0), 0);
    }
  }

  private ensureReady() {
    if (!this.ready) this.ready = this.init();
    return this.ready;
  }

  private async readIndex(): Promise<CasIndex | null> {
    try {
      const raw = await fsp.readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as CasIndex;
      if (!parsed || parsed.version !== 1 || typeof parsed.entries !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async writeIndex() {
    const payload: CasIndex = {
      version: 1,
      maxBytes: this.maxBytes,
      entries: this.entries
    };
    await fsp.writeFile(this.indexPath, JSON.stringify(payload, null, 2), "utf8");
  }

  private hashToPath(hash: string) {
    const normalized = hash.toLowerCase();
    const dir = path.join(this.baseDir, normalized.slice(0, 2));
    const filePath = path.join(dir, normalized);
    return { dir, filePath, hash: normalized };
  }

  private async dropEntry(hash: string) {
    const entry = this.entries[hash];
    if (entry) {
      this.totalBytes = Math.max(0, this.totalBytes - (entry.sizeBytes || 0));
      delete this.entries[hash];
    }
    const { filePath } = this.hashToPath(hash);
    await fsp.unlink(filePath).catch(() => {});
  }

  private async evictIfNeeded() {
    if (this.maxBytes <= 0) return;
    if (this.totalBytes <= this.maxBytes) return;
    const candidates = Object.entries(this.entries).sort((a, b) => a[1].lastAccessMs - b[1].lastAccessMs);
    for (const [hash] of candidates) {
      await this.dropEntry(hash);
      if (this.totalBytes <= this.maxBytes) break;
    }
  }

  async has(hash: string): Promise<boolean> {
    if (this.maxBytes <= 0) return false;
    await this.ensureReady();
    const normalized = hash.toLowerCase();
    const entry = this.entries[normalized];
    if (!entry) return false;
    const { filePath } = this.hashToPath(normalized);
    try {
      await fsp.stat(filePath);
      return true;
    } catch {
      await this.dropEntry(normalized);
      await this.writeIndex();
      return false;
    }
  }

  async get(hash: string): Promise<Buffer | null> {
    if (this.maxBytes <= 0) return null;
    await this.ensureReady();
    const normalized = hash.toLowerCase();
    if (!isHexHash(normalized)) return null;
    const { filePath } = this.hashToPath(normalized);
    try {
      const data = await fsp.readFile(filePath);
      const now = Date.now();
      const entry = this.entries[normalized];
      if (entry) entry.lastAccessMs = now;
      else this.entries[normalized] = { sizeBytes: data.length, lastAccessMs: now };
      await this.writeIndex();
      return data;
    } catch {
      await this.dropEntry(normalized);
      await this.writeIndex();
      return null;
    }
  }

  async getPath(hash: string): Promise<{ filePath: string; sizeBytes: number } | null> {
    if (this.maxBytes <= 0) return null;
    await this.ensureReady();
    const normalized = hash.toLowerCase();
    if (!isHexHash(normalized)) return null;
    const { filePath } = this.hashToPath(normalized);
    try {
      const stat = await fsp.stat(filePath);
      const now = Date.now();
      const entry = this.entries[normalized];
      if (entry) entry.lastAccessMs = now;
      else this.entries[normalized] = { sizeBytes: stat.size, lastAccessMs: now };
      await this.writeIndex();
      return { filePath, sizeBytes: stat.size };
    } catch {
      await this.dropEntry(normalized);
      await this.writeIndex();
      return null;
    }
  }

  async put(hash: string, bytes: Buffer): Promise<void> {
    if (this.maxBytes <= 0) return;
    await this.ensureReady();
    const normalized = hash.toLowerCase();
    if (!isHexHash(normalized)) return;
    const { dir, filePath } = this.hashToPath(normalized);
    await fsp.mkdir(dir, { recursive: true });
    if (!fs.existsSync(filePath)) {
      await fsp.writeFile(filePath, bytes);
    }
    const sizeBytes = bytes.length;
    const existing = this.entries[normalized];
    if (!existing) this.totalBytes += sizeBytes;
    else this.totalBytes = this.totalBytes - existing.sizeBytes + sizeBytes;
    this.entries[normalized] = { sizeBytes, lastAccessMs: Date.now() };
    await this.evictIfNeeded();
    await this.writeIndex();
  }
}
