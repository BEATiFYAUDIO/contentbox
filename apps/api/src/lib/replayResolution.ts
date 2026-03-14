export type ReplayMode = "edge_ticket" | "buy_page";

export function resolveReplayMode(input: {
  edgeDeliveryEnabled: boolean;
  edgeTicketSecretConfigured: boolean;
  edgeBaseUrlConfigured: boolean;
  manifestSha256Present: boolean;
  primaryObjectKeyPresent: boolean;
}): ReplayMode {
  if (
    input.edgeDeliveryEnabled &&
    input.edgeTicketSecretConfigured &&
    input.edgeBaseUrlConfigured &&
    input.manifestSha256Present &&
    input.primaryObjectKeyPresent
  ) {
    return "edge_ticket";
  }
  return "buy_page";
}
