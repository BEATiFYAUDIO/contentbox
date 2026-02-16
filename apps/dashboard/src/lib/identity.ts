import { api } from "./api";

export type IdentityLevel = "BASIC" | "PERSISTENT";

export type IdentityDetail = {
  level: IdentityLevel;
  dbMode: "basic" | "advanced";
  persistentConfigured: boolean;
  reason: string;
  publicOrigin: string | null;
};

export async function fetchIdentityDetail(): Promise<IdentityDetail> {
  return api<IdentityDetail>("/api/identity", "GET");
}
