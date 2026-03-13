import { computeManifestHash } from "./proof.js";

export type CanonicalManifest = Record<string, unknown> & {
  schemaVersion: 1;
  manifestVersion: 1;
};

export type ContentPublishReceiptPayload = {
  contentId: string;
  manifestHash: string;
  title: string | null;
  type: string | null;
  primaryFile: string | null;
  publishedAt: string;
  creatorNodeId: string;
  providerNodeId: string | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

export function normalizeManifestForPublish(manifest: unknown): CanonicalManifest {
  const base = manifest && typeof manifest === "object" ? ({ ...(manifest as Record<string, unknown>) }) : {};
  base.schemaVersion = 1;
  base.manifestVersion = 1;
  return base as CanonicalManifest;
}

export function computeCanonicalManifestHash(manifest: unknown): string {
  return computeManifestHash(normalizeManifestForPublish(manifest));
}

export function buildContentPublishReceiptPayload(input: {
  contentId: string;
  manifestHash: string;
  title?: unknown;
  type?: unknown;
  primaryFile?: unknown;
  publishedAt: string;
  creatorNodeId: string;
  providerNodeId?: string | null;
}): ContentPublishReceiptPayload {
  return {
    contentId: asString(input.contentId).trim(),
    manifestHash: asString(input.manifestHash).trim(),
    title: asString(input.title).trim() || null,
    type: asString(input.type).trim() || null,
    primaryFile: asString(input.primaryFile).trim() || null,
    publishedAt: asString(input.publishedAt).trim(),
    creatorNodeId: asString(input.creatorNodeId).trim(),
    providerNodeId: input.providerNodeId ? asString(input.providerNodeId).trim() : null
  };
}
