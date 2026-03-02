type PaidIntentRow = {
  id: string;
  buyerId: string;
  contentId: string;
  manifestSha256?: string | null;
  status?: string;
};

type EntitlementRow = {
  id: string;
  buyerId: string;
  contentId: string;
};

type ReconcileDeps = {
  listPaidIntents: (buyerId: string, contentId?: string) => Promise<PaidIntentRow[]>;
  getEntitlement: (buyerId: string, contentId: string) => Promise<EntitlementRow | null>;
  upsertEntitlement: (input: {
    buyerId: string;
    contentId: string;
    manifestSha256?: string | null;
    paymentIntentId: string;
  }) => Promise<void>;
};

export async function reconcileMissingEntitlementsForBuyer(
  deps: ReconcileDeps,
  input: { buyerId: string; contentId?: string }
): Promise<{ healedCount: number }> {
  const buyerId = String(input?.buyerId || "").trim();
  if (!buyerId) return { healedCount: 0 };

  const rows = await deps.listPaidIntents(buyerId, input?.contentId);
  let healedCount = 0;

  for (const row of rows || []) {
    const cid = String(row?.contentId || "").trim();
    if (!cid) continue;
    const exists = await deps.getEntitlement(buyerId, cid);
    if (exists) continue;
    await deps.upsertEntitlement({
      buyerId,
      contentId: cid,
      manifestSha256: row?.manifestSha256 || "",
      paymentIntentId: row.id
    });
    healedCount += 1;
  }

  return { healedCount };
}

export function shouldAllowDebugEntitlementReset(input: {
  nodeEnv?: string | null;
  isAdmin?: boolean | null;
}): boolean {
  const env = String(input?.nodeEnv || "").trim().toLowerCase();
  const isProd = env === "production";
  return !isProd && Boolean(input?.isAdmin);
}
