export type LibraryOwnershipKind = "owned" | "collaboration" | "derivative" | "unknown";
export type LibrarySplitState = "solo" | "shared" | "draft_incomplete" | "missing" | "unknown";
export type LibraryCommercialReadiness =
  | "ready"
  | "needs_split"
  | "not_published"
  | "missing_payment_config"
  | "awaiting_clearance"
  | "unknown";
export type LibraryDerivativeClearanceStatus = "awaiting" | "partial" | "cleared" | "rejected" | "blocked" | "unknown";

export type LibraryRightsSummary = {
  ownershipKind: LibraryOwnershipKind;
  sellerOfRecord: boolean;
  myRole: string | null;
  mySplitBps: number | null;
  splitState: LibrarySplitState;
  participantCount: number | null;
  commercialReadiness: LibraryCommercialReadiness;
  derivative: {
    isDerivative: boolean;
    parentContentId: string | null;
    parentTitle: string | null;
    clearanceStatus: LibraryDerivativeClearanceStatus;
    approvedApprovers: number | null;
    requiredApprovers: number | null;
    approvedWeightBps: number | null;
    approvalBpsTarget: number | null;
  } | null;
};

type BuildLibraryRightsSummaryInput = {
  isOwner: boolean;
  isCollaboration: boolean;
  isDerivative: boolean;
  contentStatus: string | null | undefined;
  storefrontStatus: string | null | undefined;
  priceSats: string | number | bigint | null | undefined;
  splitState?: LibrarySplitState | null;
  participantCount?: number | null;
  myRole?: string | null;
  mySplitBps?: number | null;
  derivative?: {
    parentContentId?: string | null;
    parentTitle?: string | null;
    status?: string | null;
    approvedApprovers?: number | null;
    requiredApprovers?: number | null;
    approvedWeightBps?: number | null;
    approvalBpsTarget?: number | null;
  } | null;
};

function normalizeStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizePriceSats(value: string | number | bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.round(num));
}

function resolveOwnershipKind(input: BuildLibraryRightsSummaryInput): LibraryOwnershipKind {
  if (input.isDerivative) return "derivative";
  if (input.isCollaboration) return "collaboration";
  if (input.isOwner) return "owned";
  return "unknown";
}

function resolveDerivativeClearanceStatus(
  derivative: BuildLibraryRightsSummaryInput["derivative"]
): LibraryDerivativeClearanceStatus {
  if (!derivative) return "unknown";
  const status = normalizeStatus(derivative.status);
  if (status === "approved" || status === "cleared") return "cleared";
  if (status === "rejected") return "rejected";
  if (status === "blocked") return "blocked";
  if (status === "pending") {
    const approvedWeightBps = Number(derivative.approvedWeightBps || 0);
    return approvedWeightBps > 0 ? "partial" : "awaiting";
  }
  return "unknown";
}

function resolveCommercialReadiness(input: {
  contentStatus: string | null | undefined;
  storefrontStatus: string | null | undefined;
  priceSats: string | number | bigint | null | undefined;
  splitState: LibrarySplitState;
  ownershipKind: LibraryOwnershipKind;
  derivativeClearanceStatus: LibraryDerivativeClearanceStatus;
}): LibraryCommercialReadiness {
  const contentStatus = normalizeStatus(input.contentStatus);
  if (contentStatus !== "published") return "not_published";

  if (input.ownershipKind === "derivative") {
    if (input.derivativeClearanceStatus !== "cleared") return "awaiting_clearance";
  }

  if (input.ownershipKind === "owned") {
    if (input.splitState === "missing" || input.splitState === "draft_incomplete") return "needs_split";
    const storefrontStatus = normalizeStatus(input.storefrontStatus);
    const priceSats = normalizePriceSats(input.priceSats);
    const hasPriceSignal = priceSats !== null;
    const potentiallyMonetized = storefrontStatus === "listed" || storefrontStatus === "unlisted";
    if (potentiallyMonetized && !hasPriceSignal) return "missing_payment_config";
  }

  return "ready";
}

export function deriveSplitStateFromLatestVersion(input: {
  latestVersionStatus: string | null | undefined;
  participantCount: number | null | undefined;
}): LibrarySplitState {
  const status = normalizeStatus(input.latestVersionStatus);
  const participantCount = Number(input.participantCount || 0);
  if (!status) return "missing";
  if (status !== "locked") return "draft_incomplete";
  if (participantCount <= 1) return "solo";
  return "shared";
}

export function buildLibraryRightsSummary(input: BuildLibraryRightsSummaryInput): LibraryRightsSummary {
  const ownershipKind = resolveOwnershipKind(input);
  const splitState = input.splitState || "unknown";
  const derivativeClearanceStatus = resolveDerivativeClearanceStatus(input.derivative || null);

  const derivative = input.isDerivative
    ? {
        isDerivative: true,
        parentContentId: input.derivative?.parentContentId || null,
        parentTitle: input.derivative?.parentTitle || null,
        clearanceStatus: derivativeClearanceStatus,
        approvedApprovers: Number.isFinite(Number(input.derivative?.approvedApprovers))
          ? Number(input.derivative?.approvedApprovers)
          : null,
        requiredApprovers: Number.isFinite(Number(input.derivative?.requiredApprovers))
          ? Number(input.derivative?.requiredApprovers)
          : null,
        approvedWeightBps: Number.isFinite(Number(input.derivative?.approvedWeightBps))
          ? Number(input.derivative?.approvedWeightBps)
          : null,
        approvalBpsTarget: Number.isFinite(Number(input.derivative?.approvalBpsTarget))
          ? Number(input.derivative?.approvalBpsTarget)
          : null
      }
    : null;

  return {
    ownershipKind,
    sellerOfRecord: Boolean(input.isOwner),
    myRole: input.myRole || null,
    mySplitBps: Number.isFinite(Number(input.mySplitBps)) ? Number(input.mySplitBps) : null,
    splitState,
    participantCount: Number.isFinite(Number(input.participantCount)) ? Number(input.participantCount) : null,
    commercialReadiness: resolveCommercialReadiness({
      contentStatus: input.contentStatus,
      storefrontStatus: input.storefrontStatus,
      priceSats: input.priceSats,
      splitState,
      ownershipKind,
      derivativeClearanceStatus
    }),
    derivative
  };
}
