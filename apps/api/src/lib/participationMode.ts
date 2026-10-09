import type { NodeMode } from "./nodeMode.js";
import type { ProductTier } from "./productTier.js";

export type ParticipationMode =
  | "basic_creator"
  | "sovereign_creator"
  | "sovereign_creator_with_provider"
  | "sovereign_node";

export function resolveSelectedParticipationMode(input: {
  nodeMode: NodeMode;
  productTier: ProductTier;
  providerConnected: boolean;
}): ParticipationMode {
  // Both values are persisted by the explicit posture transition. Fail closed
  // during a partial/mismatched write rather than inferring an upgrade from
  // transport or readiness state.
  if (input.nodeMode === "lan" && input.productTier === "lan") return "sovereign_node";
  if (input.nodeMode === "advanced" && input.productTier === "advanced") {
    return input.providerConnected ? "sovereign_creator_with_provider" : "sovereign_creator";
  }
  return "basic_creator";
}
