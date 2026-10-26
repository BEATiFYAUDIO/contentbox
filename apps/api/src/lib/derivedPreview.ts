export function availablePreviewKey(input: {
  contentId: string;
  primaryKey: string | null;
  manifestPreview?: string | null;
  exists: (key: string) => boolean;
}): string | null {
  const keys = ["mp3", "mp4"].map(ext => `previews/${input.contentId}-preview.${ext}`);
  const declared = String(input.manifestPreview || "").trim();
  const candidates = keys.includes(declared) ? [declared, ...keys.filter(key => key !== declared)] : keys;
  return candidates.find(key => key !== input.primaryKey && input.exists(key)) || null;
}
