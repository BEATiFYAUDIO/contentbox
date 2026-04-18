function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

export function canIssueEdgeTicketFromReceiptContext(input: {
  tokenAuthorized: boolean;
  purchased: boolean;
  buyerId?: string | null;
  warning?: string | null;
  entitled: boolean;
}): boolean {
  if (!input.tokenAuthorized) return false;
  if (!input.purchased) return false;
  if (!asString(input.buyerId || "")) return false;
  if (asString(input.warning || "")) return false;
  if (!input.entitled) return false;
  return true;
}
