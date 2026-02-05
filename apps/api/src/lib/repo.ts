// apps/api/src/lib/repo.ts
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";

const execFileAsync = promisify(execFile);

function slugify(input: string) {
  return (input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function safeExt(originalName: string) {
  const ext = path.extname(originalName || "").toLowerCase();
  if (!ext) return "";
  if (!/^\.[a-z0-9]{1,8}$/.test(ext)) return "";
  return ext;
}

async function exists(p: string) {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function git(cwd: string, args: string[]) {
  await execFileAsync("git", args, { cwd });
}

async function gitCommitMaybe(repoPath: string, message: string) {
  try {
    await git(repoPath, ["commit", "-m", message]);
  } catch (e: any) {
    const msg = String(e?.stderr || e?.message || "");
    if (!msg.toLowerCase().includes("nothing to commit")) throw e;
  }
}

async function readJson<T>(p: string): Promise<T> {
  const raw = await fsp.readFile(p, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJson(p: string, data: any) {
  await fsp.writeFile(p, JSON.stringify(data, null, 2), "utf8");
}

export type ManifestFile = {
  path: string; // repo-relative (posix style)
  filename: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  committedAt: string; // ISO
};

type Manifest = {
  contentId: string;
  type: string;
  title: string;
  status: "draft" | "published";
  createdAt: string;
  primaryFile: null | ManifestFile;
  splits: { latestVersion: number; lockedVersions: number[]; file: string };
  files: ManifestFile[];
  payments: { railsEnabled: string[]; receipts: any[] };
};

export async function initContentRepo(opts: {
  root: string;
  contentId: string;
  type: string;
  title: string;
}) {
  const slug = slugify(opts.title || "untitled");
  const folder = `${slug}-${opts.contentId.slice(-6)}`;
  const repoPath = path.join(opts.root, opts.type + "s", folder);

  await fsp.mkdir(repoPath, { recursive: true });

  // init git repo
  await git(repoPath, ["init"]);

  const createdAt = new Date().toISOString();

  const contentbox = {
    contentId: opts.contentId,
    type: opts.type,
    title: opts.title,
    createdAt,
    repoFormat: 1
  };

  const manifest: Manifest = {
    contentId: opts.contentId,
    type: opts.type,
    title: opts.title,
    status: "draft",
    createdAt,
    primaryFile: null,
    splits: { latestVersion: 1, lockedVersions: [], file: "splits/v1.json" },
    files: [],
    payments: { railsEnabled: [], receipts: [] }
  };

  await fsp.mkdir(path.join(repoPath, "splits"), { recursive: true });
  await fsp.mkdir(path.join(repoPath, "files"), { recursive: true });
  await fsp.mkdir(path.join(repoPath, "receipts"), { recursive: true });
  await fsp.mkdir(path.join(repoPath, "access"), { recursive: true });

  await writeJson(path.join(repoPath, "contentbox.json"), contentbox);
  await writeJson(path.join(repoPath, "manifest.json"), manifest);

  // v1 splits placeholder
  await fsp.writeFile(
    path.join(repoPath, "splits", "v1.json"),
    JSON.stringify(
      {
        contentId: opts.contentId,
        versionNumber: 1,
        status: "draft",
        createdAt,
        participants: []
      },
      null,
      2
    ),
    "utf8"
  );

  // initial commit
  await git(repoPath, ["config", "user.email", "contentbox@local"]);
  await git(repoPath, ["config", "user.name", "Contentbox"]);
  await git(repoPath, ["add", "."]);
  await git(repoPath, ["commit", "-m", "init content repo"]);

  return repoPath;
}

export async function commitAll(repoPath: string, message: string) {
  await git(repoPath, ["add", "."]);
  await gitCommitMaybe(repoPath, message);
}

/**
 * Writes an uploaded file into repoPath/files/ with clean naming,
 * updates manifest.json (files[] + primaryFile), and commits.
 *
 * Naming rules:
 * - Primary upload: files/<slug(contentTitle)>.<ext> (unless taken -> -2)
 * - Non-primary: files/<slug(contentTitle)>.<ext> (unless taken -> -2)
 */
export async function addFileToContentRepo(opts: {
  repoPath: string;
  contentTitle: string;
  originalName: string;
  mime: string;
  stream: NodeJS.ReadableStream;
  setAsPrimary?: boolean; // default true if no primary yet
  preferMasterName?: boolean; // if true -> master.ext (best for primary upload)
}): Promise<ManifestFile> {
  const manifestPath = path.join(opts.repoPath, "manifest.json");
  const manifest = await readJson<Manifest>(manifestPath);

  const ext = safeExt(opts.originalName);

  const shouldSetPrimary =
    typeof opts.setAsPrimary === "boolean" ? opts.setAsPrimary : manifest.primaryFile === null;

  const baseForNonPrimary = slugify(opts.contentTitle || "content") || "content";
  const baseName = opts.preferMasterName ? "master" : baseForNonPrimary;
  let filename = `${baseName}${ext || ""}`;

  const absFilesDir = path.join(opts.repoPath, "files");
  await fsp.mkdir(absFilesDir, { recursive: true });

  // ensure unique filename
  let absTarget = path.join(absFilesDir, filename);
  if (await exists(absTarget)) {
    let i = 2;
    while (true) {
      const candidate = `${baseName}-${i}${ext || ""}`;
      const absCandidate = path.join(absFilesDir, candidate);
      if (!(await exists(absCandidate))) {
        filename = candidate;
        absTarget = absCandidate;
        break;
      }
      i++;
    }
  }

  const relPath = path.posix.join("files", filename);

  // stream to disk while hashing
  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;

  const out = fs.createWriteStream(absTarget);

  opts.stream.on("data", (chunk: Buffer) => {
    sizeBytes += chunk.length;
    hash.update(chunk);
  });

  await pipeline(opts.stream, out);

  const sha256 = hash.digest("hex");
  const committedAt = new Date().toISOString();

  const fileEntry: ManifestFile = {
    path: relPath,
    filename,
    originalName: opts.originalName,
    mime: opts.mime,
    sizeBytes,
    sha256,
    committedAt
  };

  manifest.files = Array.isArray(manifest.files) ? manifest.files : [];

  // avoid duplicates by (path + sha256)
  const already = manifest.files.some((f) => f.path === fileEntry.path && f.sha256 === fileEntry.sha256);
  if (!already) {
    manifest.files.push(fileEntry);
  }

  if (shouldSetPrimary) {
    manifest.primaryFile = fileEntry;
  }

  await writeJson(manifestPath, manifest);

  await git(opts.repoPath, ["add", relPath, "manifest.json"]);
  await gitCommitMaybe(opts.repoPath, `add file ${filename}`);

  return fileEntry;
}

/**
 * Back-compat export. Prefer addFileToContentRepo going forward.
 * Keeps older call sites working while still using the canonical naming/manifest logic.
 */
export async function commitUploadedFile(opts: {
  repoPath: string;
  originalName: string;
  mime: string;
  stream: NodeJS.ReadableStream;
}) {
  return addFileToContentRepo({
    repoPath: opts.repoPath,
    contentTitle: "content",
    originalName: opts.originalName,
    mime: opts.mime,
    stream: opts.stream,
    setAsPrimary: false,
    preferMasterName: false
  });
}
