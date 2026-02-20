import { api } from "./api";

export type IdentityLevel = "BASIC" | "PERSISTENT";
export type NodeMode = "basic" | "advanced" | "lan";
export type ProductTier = "basic" | "advanced" | "lan";
export type PaymentsMode = "wallet" | "node";

export type FeatureMatrix = {
  publicShare: boolean;
  derivatives: boolean;
  advancedSplits: boolean;
  multiUser: boolean;
};

export type CapabilitySet = {
  useSplits: boolean;
  useDerivatives: boolean;
  sendInvite: boolean;
  lockSplits: boolean;
  publish: boolean;
  requestClearance: boolean;
  publicShare: boolean;
  proofBundles: boolean;
};

export type IdentityDetail = {
  level: IdentityLevel;
  dbMode: "basic" | "advanced";
  persistentConfigured: boolean;
  reason: string;
  publicOrigin: string | null;
  nodeMode?: NodeMode;
  productTier?: ProductTier;
  productTierSource?: "env" | "file" | "legacy";
  paymentsMode?: PaymentsMode;
  namedReady?: boolean;
  ownerEmail?: string | null;
  storage?: "sqlite" | "postgres";
  features?: FeatureMatrix;
  capabilities?: CapabilitySet;
  capabilityReasons?: Record<string, string>;
  lockReasons?: Record<string, string>;
};

export async function fetchIdentityDetail(): Promise<IdentityDetail> {
  return api<IdentityDetail>("/api/identity", "GET");
}
