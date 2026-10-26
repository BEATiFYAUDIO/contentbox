/** Read stored metadata only. Work type, topic, artwork and file extensions are not MIME evidence. */
export function storedMime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const mime = value.trim().toLowerCase();
  // Preserve valid parameters (e.g. text/plain; charset=utf-8), reject unsafe headers.
  if (/[\r\n\x00-\x1f\x7f]/.test(mime)) return null;
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:\s*;[^\r\n]+)?$/.test(mime) ? mime : null;
}

export function getPrimaryFileObjectKeyFromManifest(manifestJson: any): string | null {
  const primary = manifestJson?.primaryFile;
  const primaryKey =
    typeof primary === "string"
      ? primary
      : primary && typeof primary === "object"
        ? primary.path || primary.filename || primary.objectKey
        : null;
  if (primaryKey) return String(primaryKey).trim() || null;
  const first = Array.isArray(manifestJson?.files) ? manifestJson.files[0] : null;
  return String(first?.objectKey || first?.path || first?.filename || "").trim() || null;
}

type FileMetadata = { objectKey: string; mime: unknown };

export function getStoredFileMime(manifestJson: any, objectKey: string | null, files: readonly FileMetadata[]): string | null {
  if (!objectKey) return null;
  const row = files.find((file) => file.objectKey === objectKey);
  // An existing row is authoritative, including an explicitly unavailable MIME.
  if (row) return storedMime(row.mime);
  // Legacy manifests can retain file metadata without a ContentFile projection.
  const entry = Array.isArray(manifestJson?.files)
    ? manifestJson.files.find((file: any) => [file?.objectKey, file?.path, file?.filename].includes(objectKey))
    : null;
  return storedMime(entry?.mime);
}

export function getPrimaryFileMime(manifestJson: any, files: readonly FileMetadata[]): string | null {
  const key = getPrimaryFileObjectKeyFromManifest(manifestJson);
  if (!getPrimaryFileObjectKeyFromManifest({ primaryFile: manifestJson?.primaryFile })) {
    // Preserve the legacy first-file convention only when it is not a labelled attachment.
    const assetKey = (asset: any) => typeof asset === "string" ? asset : asset?.path || asset?.filename || asset?.objectKey;
    if (key === assetKey(manifestJson?.cover) || key === assetKey(manifestJson?.preview)) return null;
  }
  return getStoredFileMime(manifestJson, key, files);
}
