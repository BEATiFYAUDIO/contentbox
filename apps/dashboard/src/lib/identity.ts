import { api } from "./api";

export type IdentityLevel = "BASIC" | "PERSISTENT";
export type NodeMode = "basic" | "advanced" | "lan";

export type FeatureMatrix = {
  publicShare: boolean;
  derivatives: boolean;
  advancedSplits: boolean;
  multiUser: boolean;
};

export type IdentityDetail = {
  level: IdentityLevel;
  dbMode: "basic" | "advanced";
  persistentConfigured: boolean;
  reason: string;
  publicOrigin: string | null;
  nodeMode?: NodeMode;
  features?: FeatureMatrix;
  lockReasons?: Record<string, string>;
};

export async function fetchIdentityDetail(): Promise<IdentityDetail> {
  return api<IdentityDetail>("/api/identity", "GET");
}
