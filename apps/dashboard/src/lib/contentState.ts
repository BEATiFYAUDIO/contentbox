export type ContentUiState = "draft" | "published" | "trash" | "archived";

export function computeContentUiState(item: { status?: string | null; deletedAt?: string | null }): ContentUiState {
  const status = String(item?.status || "").toLowerCase();
  const deleted = Boolean(item?.deletedAt);
  if (deleted && status === "published") return "archived";
  if (deleted && status !== "published") return "trash";
  if (status === "published") return "published";
  return "draft";
}

export function canTrash(state: ContentUiState): boolean {
  return state === "draft";
}

export function canPublish(state: ContentUiState): boolean {
  return state === "draft";
}

export function canArchive(state: ContentUiState): boolean {
  return state === "published";
}

export function canRestore(state: ContentUiState): boolean {
  return state === "trash";
}

export function canUpload(state: ContentUiState): boolean {
  return state === "draft";
}
