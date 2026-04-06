export type DelegatedPublishFailureAction = "skip_relationship_required" | "conflict" | "bad_gateway";

export function classifyDelegatedPublishFailure(input: {
  providerStatus: number;
  providerCode: string | null;
}): DelegatedPublishFailureAction {
  const status = Number(input.providerStatus || 0);
  const code = String(input.providerCode || "").trim();
  if (status === 409 && code === "PROVIDER_CREATOR_RELATIONSHIP_REQUIRED") {
    return "skip_relationship_required";
  }
  if (status === 409) return "conflict";
  return "bad_gateway";
}

