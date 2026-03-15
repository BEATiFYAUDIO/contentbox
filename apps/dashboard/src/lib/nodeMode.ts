import type { NodeMode } from "./identity";

export function modeLabel(mode: NodeMode | undefined | null) {
  if (mode === "advanced") return "Advanced (Sovereign Node)";
  if (mode === "lan") return "LAN (Studio)";
  return "Basic (Trial)";
}

