import type { NodeMode } from "./identity";

export function modeLabel(mode: NodeMode | undefined | null) {
  if (mode === "advanced") return "Sovereign Creator";
  if (mode === "lan") return "Sovereign Creator (LAN Studio)";
  return "Basic Creator";
}
