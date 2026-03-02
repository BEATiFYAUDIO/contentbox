export function resolveBuyPermitAccessMode(input: {
  requestedScope?: "preview" | "stream";
  devUnlock?: boolean;
  paidContent?: boolean;
  hasPaidAccess?: boolean;
}): "preview" | "stream" {
  const requested = input?.requestedScope === "stream" ? "stream" : "preview";
  const devUnlock = Boolean(input?.devUnlock);
  const paidContent = Boolean(input?.paidContent);
  const hasPaidAccess = Boolean(input?.hasPaidAccess);

  if (devUnlock) return "stream";
  if (!paidContent) return "stream";
  if (hasPaidAccess) return "stream";
  return requested === "stream" ? "preview" : "preview";
}
