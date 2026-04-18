export const MULTI_PARENT_DERIVATIVE_COMMERCE_BLOCK = {
  code: "MULTIPLE_PARENTS_NOT_SUPPORTED",
  message: "This derivative has multiple parent works and cannot be sold in beta yet."
} as const;

export function isUnsupportedMultiParentDerivativeCommerce(input: {
  parentCount: number;
  priceSats: bigint | number | null | undefined;
}) {
  const parentCount = Number.isFinite(input.parentCount) ? Math.max(0, Math.floor(input.parentCount)) : 0;
  const rawPrice =
    typeof input.priceSats === "bigint"
      ? input.priceSats
      : input.priceSats == null
        ? 0n
        : BigInt(input.priceSats);
  return rawPrice > 0n && parentCount > 1;
}
