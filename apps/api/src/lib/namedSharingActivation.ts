export function activateVerifiedNamedSharing(input: {
  isCurrent: () => boolean;
  persistSelection: () => boolean;
}): "activated" | "stale" | "save_failed" {
  if (!input.isCurrent()) return "stale";
  return input.persistSelection() ? "activated" : "save_failed";
}
