export function resolveDerivativeParentMode(input: {
  parent?: {
    description?: string | null;
    repoPath?: string | null;
    deletedReason?: string | null;
  } | null;
  parentOrigin?: string | null;
}) {
  const parent = input.parent || null;
  const explicitParentOrigin = String(input.parentOrigin || "").trim().replace(/\/+$/, "");
  const description = String(parent?.description || "").trim();
  const lower = description.toLowerCase();
  const shadowRemoteOrigin =
    parent &&
    parent.deletedReason === "hard" &&
    !parent.repoPath &&
    lower.startsWith("remote origin:")
      ? description.slice("remote origin:".length).trim().replace(/\/+$/, "")
      : "";

  const remoteOrigin = shadowRemoteOrigin || explicitParentOrigin || "";
  return {
    remoteOrigin: remoteOrigin || null,
    requiresLocalLockedSplit: !remoteOrigin
  };
}
