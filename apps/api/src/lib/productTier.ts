import { readNodeConfigSync } from "./nodeConfig.js";
import { resolveRuntimeConfig } from "./nodeMode.js";

export type ProductTier = "basic" | "advanced" | "lan";
export type PaymentsMode = "wallet" | "node";

function normalizeTier(raw: string | undefined): ProductTier | null {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "basic" || v === "advanced" || v === "lan") return v as ProductTier;
  return null;
}

function normalizePayments(raw: string | undefined): PaymentsMode | null {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "wallet" || v === "node") return v as PaymentsMode;
  return null;
}

export type ProductTierResolution = {
  productTier: ProductTier;
  source: "env" | "file" | "legacy";
};

export function resolveProductTier(): ProductTierResolution {
  const explicit = normalizeTier(process.env.PRODUCT_TIER);
  if (explicit) return { productTier: explicit, source: "env" };

  const fileTier = normalizeTier(readNodeConfigSync()?.productTier as any);
  if (fileTier) return { productTier: fileTier, source: "file" };

  const nodeMode = resolveRuntimeConfig().nodeMode;
  if (nodeMode === "advanced") return { productTier: "advanced", source: "legacy" };
  if (nodeMode === "lan") return { productTier: "lan", source: "legacy" };
  return { productTier: "basic", source: "legacy" };
}

export function getProductTier(): ProductTier {
  return resolveProductTier().productTier;
}

export function getPaymentsMode(productTier?: ProductTier): PaymentsMode {
  const explicit = normalizePayments(process.env.PAYMENTS_MODE);
  if (explicit) return explicit;
  if (productTier === "advanced" || productTier === "lan") return "node";
  return "wallet";
}
