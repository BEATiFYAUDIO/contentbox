export type ContentSaleMode = "free" | "tip" | "paid";
export type ContentRoutingTarget = "none" | "provider" | "local";

export type ContentCommerceValidity = {
  contentValid: boolean;
  saleMode: ContentSaleMode;
  commerceValid: boolean;
  routingTarget: ContentRoutingTarget;
  blockingReason: string | null;
};

export function resolveContentCommerceValidity(input: {
  title?: string | null;
  status?: string | null;
  filesCount?: number | null;
  manifestHash?: string | null;
  publishedAt?: string | null;
  hasPublishRecord?: boolean;
  saleMode: ContentSaleMode;
  paidCommerceAllowed: boolean;
  paidCommerceReason?: string | null;
  paidRoutingTarget?: Exclude<ContentRoutingTarget, "none">;
}): ContentCommerceValidity {
  const title = String(input.title || "").trim();
  const status = String(input.status || "").trim().toLowerCase();
  const filesCount = Number(input.filesCount || 0);
  const manifestHash = String(input.manifestHash || "").trim();
  const publishedAt = String(input.publishedAt || "").trim();
  const hasPublishRecord = Boolean(input.hasPublishRecord || publishedAt);

  let contentBlocker: string | null = null;
  if (!title) contentBlocker = "Content title is missing.";
  else if (filesCount < 1) contentBlocker = "Upload a primary file to validate this content item.";
  else if (status === "published" && !manifestHash) contentBlocker = "Published content requires a manifest hash.";
  else if (status === "published" && !hasPublishRecord) contentBlocker = "Published content is missing a publish record.";

  if (contentBlocker) {
    return {
      contentValid: false,
      saleMode: input.saleMode,
      commerceValid: false,
      routingTarget: "none",
      blockingReason: contentBlocker
    };
  }

  if (input.saleMode !== "paid") {
    return {
      contentValid: true,
      saleMode: input.saleMode,
      commerceValid: true,
      routingTarget: "none",
      blockingReason: null
    };
  }

  if (!input.paidCommerceAllowed) {
    return {
      contentValid: true,
      saleMode: input.saleMode,
      commerceValid: false,
      routingTarget: "none",
      blockingReason: String(input.paidCommerceReason || "").trim() || "Paid commerce requires durable host routing."
    };
  }

  return {
    contentValid: true,
    saleMode: input.saleMode,
    commerceValid: true,
    routingTarget: input.paidRoutingTarget || "provider",
    blockingReason: null
  };
}
