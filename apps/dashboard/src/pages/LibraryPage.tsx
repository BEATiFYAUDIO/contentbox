import React from "react";
import { api, getApiBase } from "../lib/api";
import AuditPanel from "../components/AuditPanel";
import {
  canFeatureOnProfile,
  classifyLibraryEligibility,
  getAvailabilityState,
  isActiveLibraryVisible,
  isEntitlementHistoryVisible,
  logLibraryEligibilityDecision,
  logVisibilityDecision,
  type LibraryRelation,
  type LibrarySection
} from "../lib/libraryEligibility";
import {
  buildLibraryRightsSummary,
  deriveSplitStateFromLatestVersion,
  type LibraryRightsSummary
} from "../lib/libraryRightsSummary";

type LibraryItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  lifecycle?: "active" | "shadow" | "tombstone" | null;
  isShadow?: boolean;
  archivedAt?: string | null;
  trashedAt?: string | null;
  deletedAt?: string | null;
  deletedReason?: string | null;
  tombstonedAt?: string | null;
  tombstoned?: boolean;
  storefrontStatus?: string | null;
  priceSats?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  ownerUserId?: string | null;
  owner?: { displayName?: string | null; email?: string | null } | null;
  libraryAccess?: "owned" | "purchased" | "preview" | "local" | "participant" | "shared";
  appearsBecause?: string[] | null;
  libraryScopes?: Array<"all" | "authored" | "shared_splits" | "derivatives"> | null;
  coverUrl?: string | null;
  coverImageUrl?: string | null;
  artworkUrl?: string | null;
  thumbnailUrl?: string | null;
  posterUrl?: string | null;
  manifestCoverPath?: string | null;
  manifestCoverUrl?: string | null;
  libraryCoverCandidates?: string[] | null;
  manifestPrimaryFilePath?: string | null;
  manifestPrimaryFileUrl?: string | null;
  libraryPreviewCandidates?: string[] | null;
  primaryFile?: string | null;
  fileUrl?: string | null;
  previewFileUrl?: string | null;
  previewUrl?: string | null;
  mediaUrl?: string | null;
  attributionUrl?: string | null;
  buyUrl?: string | null;
  remoteOrigin?: string | null;
  isLocalAuthored?: boolean;
  isDirectSharedSplit?: boolean;
  isUpstreamRoyaltyWork?: boolean;
  isDerivativeWork?: boolean;
  isActionableShadow?: boolean;
  isParentOfDerivative?: boolean;
  manifest?: { sha256?: string | null } | null;
  featureOnProfile?: boolean;
  _count?: { files: number };
};
type LibraryParticipation = {
  kind: "local" | "remote";
  contentId: string;
  contentTitle: string | null;
  contentType: string | null;
  contentStatus: string | null;
  contentDeletedAt: string | null;
  splitParticipantId: string | null;
  remoteInviteId: string | null;
  remoteOrigin: string | null;
  status: string | null;
  acceptedAt?: string | null;
  verifiedAt?: string | null;
  revokedAt?: string | null;
  tombstonedAt?: string | null;
  highlightedOnProfile: boolean;
  attributionUrl?: string | null;
  buyUrl?: string | null;
  creatorUserId: string | null;
  creatorDisplayName: string | null;
  creatorEmail: string | null;
  participantRole?: string | null;
  participantBps?: number | null;
  participantPercent?: number | null;
  derivativeContext?: {
    parentContentId?: string | null;
    parentSplitVersionId?: string | null;
    upstreamBps?: number | null;
  } | null;
  libraryScopes?: Array<"all" | "authored" | "shared_splits" | "derivatives">;
};

type EntitlementInventoryRow = {
  id: string;
  contentId: string;
  unlockedAt?: string | null;
  grantedAt: string;
  receiptToken?: string | null;
  accessMode?: "stream_only" | "download_only" | "stream_and_download";
  canStream?: boolean;
  canDownload?: boolean;
};

type RemoteRoyaltyParticipation = {
  id: string;
  remoteOrigin: string | null;
  contentId: string | null;
  contentTitle: string | null;
  contentType: string | null;
  contentStatus: string | null;
  contentDeletedAt?: string | null;
  status: string | null;
  acceptedAt?: string | null;
  revokedAt?: string | null;
  tombstonedAt?: string | null;
  highlightedOnProfile?: boolean;
  clearanceInbox?: Array<{
    childContentId?: string | null;
    childTitle?: string | null;
    childOrigin?: string | null;
    relation?: string | null;
    status?: string | null;
    childStatus?: string | null;
    childDeletedAt?: string | null;
  }>;
};

type LibraryTypeFilter = "all" | "songs" | "videos" | "books" | "files";
const LIBRARY_TYPE_FILTERS: LibraryTypeFilter[] = ["all", "songs", "videos", "books", "files"];
const LIBRARY_TYPE_LABEL: Record<LibraryTypeFilter, string> = {
  all: "All",
  songs: "Songs",
  videos: "Videos",
  books: "Books",
  files: "Files"
};

type LibraryRelationshipFilter = "all" | "authored_work" | "shared_splits" | "derivatives";
const LIBRARY_RELATIONSHIP_FILTERS: LibraryRelationshipFilter[] = ["all", "authored_work", "shared_splits", "derivatives"];
const LIBRARY_RELATIONSHIP_LABEL: Record<LibraryRelationshipFilter, string> = {
  all: "All",
  authored_work: "Authored work",
  shared_splits: "Shared splits",
  derivatives: "Derivatives"
};

type LibraryRelationshipType = "authored_work" | "shared_splits" | "derivatives" | "other";

type NormalizedLibraryItem = {
  item: LibraryItem;
  libraryScopes: Set<"all" | "authored" | "shared_splits" | "derivatives">;
  contentType: LibraryTypeFilter;
  relationshipType: LibraryRelationshipType;
  relationshipTags: LibraryRelationshipFilter[];
  isLocalAuthored: boolean;
  isDirectSharedSplit: boolean;
  isUpstreamRoyaltyWork: boolean;
  isDerivativeWork: boolean;
  isActionableShadow: boolean;
  isDerivativeChild: boolean;
  isDerivativeParent: boolean;
  availabilityState: ReturnType<typeof getAvailabilityState>;
  relation: LibraryRelation;
  publicPageUrl: string | null;
  participation: LibraryParticipation | null;
};

function extractOriginFromUrl(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    const u = new URL(value);
    if (!u.origin) return null;
    return u.origin.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function canonicalEntryOrigin(entry: NormalizedLibraryItem): string | null {
  const itemRemoteOrigin = String(entry.item?.remoteOrigin || "").trim() || null;
  const participationRemoteOrigin = String(entry.participation?.remoteOrigin || "").trim() || null;
  return (
    itemRemoteOrigin ||
    participationRemoteOrigin ||
    extractOriginFromUrl(entry.item?.buyUrl || null) ||
    extractOriginFromUrl(entry.item?.attributionUrl || null) ||
    extractOriginFromUrl(entry.publicPageUrl || null) ||
    null
  );
}

function firstNonEmptyString(...values: Array<unknown>): string | null {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return null;
}

function derivativeClassifier(input: {
  type?: string | null;
  appearsBecause?: Set<string>;
  contentId: string;
  derivativeChildContentIds: Set<string>;
  derivativeParentContentIds: Set<string>;
  upstreamDerivativeChildContentIds: Set<string>;
  participation?: LibraryParticipation | null;
  relation?: LibraryRelation;
  itemIsParentOfDerivative?: boolean;
}): { isDerivativeChild: boolean; isDerivativeParent: boolean; isDerivative: boolean } {
  const typeNormalized = String(input.type || "").trim().toLowerCase();
  const appearsBecause = input.appearsBecause || new Set<string>();
  const isDerivativeByType = ["derivative", "remix", "mashup"].includes(typeNormalized);
  const isDerivativeChild =
    isDerivativeByType ||
    input.derivativeChildContentIds.has(input.contentId) ||
    input.upstreamDerivativeChildContentIds.has(input.contentId) ||
    appearsBecause.has("derivative_child");
  const isDerivativeParent =
    Boolean(input.itemIsParentOfDerivative) ||
    input.derivativeParentContentIds.has(input.contentId);
  return {
    isDerivativeChild,
    isDerivativeParent,
    isDerivative: isDerivativeChild || isDerivativeParent
  };
}

function toOrigin(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

function hasLocalOriginMismatch(apiBase: string, item: LibraryItem): boolean {
  const localOrigin = toOrigin(apiBase);
  const rowRemoteOrigin = toOrigin(String(item.remoteOrigin || "").trim());
  const rowBuyOrigin = toOrigin(String(item.buyUrl || "").trim());
  const rowAttributionOrigin = toOrigin(String(item.attributionUrl || "").trim());
  const foreignOrigin = rowRemoteOrigin || rowBuyOrigin || rowAttributionOrigin;
  if (!localOrigin || !foreignOrigin) return false;
  return localOrigin !== foreignOrigin;
}

function isActionableShadowRow(item: LibraryItem, appearsBecause: Set<string>): boolean {
  if (!Boolean(item.isActionableShadow)) return false;
  return appearsBecause.has("derivative_parent") || appearsBecause.has("derivative_child");
}

function shouldRenderActiveLibraryRow(entry: NormalizedLibraryItem): boolean {
  const item = entry.item;
  const deletedReason = String(item.deletedReason || "").trim().toLowerCase();
  const isDeleted = Boolean(String(item.deletedAt || "").trim());
  const isTombstoned = Boolean(item.tombstoned) || Boolean(String(item.tombstonedAt || "").trim());
  const isStaleDeletedReason = [
    "tombstone",
    "stale",
    "remote_deleted",
    "local_deleted",
    "deleted",
    "hard_deleted",
    "reformulation_cleanup",
    "superseded"
  ].includes(deletedReason);
  if ((isDeleted || isTombstoned || isStaleDeletedReason) && !entry.isActionableShadow) return false;
  const status = String(item.status || "").trim().toLowerCase();
  if (["deleted", "archived", "inactive", "tombstoned"].includes(status) && !entry.isActionableShadow) return false;
  if (status !== "published" && !entry.isActionableShadow) return false;
  return true;
}

function libraryAccessRank(value: LibraryItem["libraryAccess"] | null | undefined): number {
  const access = String(value || "").trim().toLowerCase();
  if (access === "owned") return 5;
  if (access === "shared" || access === "participant") return 4;
  if (access === "purchased") return 3;
  if (access === "preview") return 2;
  if (access === "local") return 1;
  return 0;
}

function relationRank(value: LibraryRelation | null | undefined): number {
  const relation = String(value || "").trim().toLowerCase();
  if (relation === "owner") return 5;
  if (relation === "participant") return 4;
  if (relation === "buyer") return 3;
  if (relation === "preview") return 2;
  return 1;
}

function dedupeCanonicalLibraryEntries(entries: NormalizedLibraryItem[]): NormalizedLibraryItem[] {
  const deduped = new Map<string, NormalizedLibraryItem>();
  for (const entry of entries) {
    const contentId = String(entry.item?.id || "").trim();
    if (!contentId) continue;
    const origin = canonicalEntryOrigin(entry) || "local";
    const key = `${origin}::${contentId}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, entry);
      continue;
    }
    const existingScore = libraryAccessRank(existing.item.libraryAccess) * 10 + relationRank(existing.relation);
    const incomingScore = libraryAccessRank(entry.item.libraryAccess) * 10 + relationRank(entry.relation);
    const winner = incomingScore >= existingScore ? entry : existing;
    const loser = winner === entry ? existing : entry;
    const mergedAppearsBecause = Array.from(
      new Set([
        ...(Array.isArray(winner.item?.appearsBecause) ? winner.item.appearsBecause : []),
        ...(Array.isArray(loser.item?.appearsBecause) ? loser.item.appearsBecause : [])
      ])
    );
    const mergedRelationshipTags = Array.from(new Set([...(winner.relationshipTags || []), ...(loser.relationshipTags || [])]));
    deduped.set(key, {
      ...winner,
      item: {
        ...winner.item,
        appearsBecause: mergedAppearsBecause,
        remoteOrigin: firstNonEmptyString(
          winner.item.remoteOrigin,
          loser.item.remoteOrigin,
          origin === "local" ? null : origin
        ),
        coverUrl: firstNonEmptyString(winner.item.coverUrl, loser.item.coverUrl),
        coverImageUrl: firstNonEmptyString(winner.item.coverImageUrl, loser.item.coverImageUrl),
        artworkUrl: firstNonEmptyString(winner.item.artworkUrl, loser.item.artworkUrl),
        thumbnailUrl: firstNonEmptyString(winner.item.thumbnailUrl, loser.item.thumbnailUrl),
        posterUrl: firstNonEmptyString(winner.item.posterUrl, loser.item.posterUrl),
        manifestCoverPath: firstNonEmptyString(winner.item.manifestCoverPath, loser.item.manifestCoverPath),
        manifestCoverUrl: firstNonEmptyString(winner.item.manifestCoverUrl, loser.item.manifestCoverUrl),
        manifestPrimaryFilePath: firstNonEmptyString(winner.item.manifestPrimaryFilePath, loser.item.manifestPrimaryFilePath),
        manifestPrimaryFileUrl: firstNonEmptyString(winner.item.manifestPrimaryFileUrl, loser.item.manifestPrimaryFileUrl),
        primaryFile: firstNonEmptyString(winner.item.primaryFile, loser.item.primaryFile),
        fileUrl: firstNonEmptyString(winner.item.fileUrl, loser.item.fileUrl),
        previewFileUrl: firstNonEmptyString(winner.item.previewFileUrl, loser.item.previewFileUrl),
        previewUrl: firstNonEmptyString(winner.item.previewUrl, loser.item.previewUrl),
        mediaUrl: firstNonEmptyString(winner.item.mediaUrl, loser.item.mediaUrl),
        libraryCoverCandidates: Array.from(
          new Set([
            ...(Array.isArray(winner.item.libraryCoverCandidates) ? winner.item.libraryCoverCandidates : []),
            ...(Array.isArray(loser.item.libraryCoverCandidates) ? loser.item.libraryCoverCandidates : [])
          ])
        ),
        libraryPreviewCandidates: Array.from(
          new Set([
            ...(Array.isArray(winner.item.libraryPreviewCandidates) ? winner.item.libraryPreviewCandidates : []),
            ...(Array.isArray(loser.item.libraryPreviewCandidates) ? loser.item.libraryPreviewCandidates : [])
          ])
        ),
        deletedReason: winner.item.deletedReason || loser.item.deletedReason || null,
        tombstoned: Boolean(winner.item.tombstoned || loser.item.tombstoned),
        buyUrl: firstNonEmptyString(winner.item.buyUrl, loser.item.buyUrl, winner.publicPageUrl, loser.publicPageUrl),
        attributionUrl: firstNonEmptyString(winner.item.attributionUrl, loser.item.attributionUrl),
        isLocalAuthored: Boolean(winner.item.isLocalAuthored || loser.item.isLocalAuthored),
        isDirectSharedSplit: Boolean(winner.item.isDirectSharedSplit || loser.item.isDirectSharedSplit),
        isUpstreamRoyaltyWork: Boolean(winner.item.isUpstreamRoyaltyWork || loser.item.isUpstreamRoyaltyWork),
        isDerivativeWork: Boolean(winner.item.isDerivativeWork || loser.item.isDerivativeWork),
        isActionableShadow: Boolean(winner.item.isActionableShadow || loser.item.isActionableShadow),
        isParentOfDerivative: Boolean(winner.item.isParentOfDerivative || loser.item.isParentOfDerivative),
        libraryScopes: Array.from(new Set([...(winner.item.libraryScopes || []), ...(loser.item.libraryScopes || [])]))
      },
      libraryScopes: new Set([...(winner.libraryScopes || new Set()), ...(loser.libraryScopes || new Set())]),
      relationshipTags: mergedRelationshipTags,
      relationshipType: mergedRelationshipTags.includes("derivatives")
        ? "derivatives"
        : mergedRelationshipTags.includes("shared_splits")
          ? "shared_splits"
          : mergedRelationshipTags.includes("authored_work")
            ? "authored_work"
            : "other",
      isDerivativeChild: winner.isDerivativeChild || loser.isDerivativeChild,
      isDerivativeParent: winner.isDerivativeParent || loser.isDerivativeParent,
      isLocalAuthored: winner.isLocalAuthored || loser.isLocalAuthored || Boolean(winner.item.isLocalAuthored || loser.item.isLocalAuthored),
      isDirectSharedSplit:
        winner.isDirectSharedSplit || loser.isDirectSharedSplit || Boolean(winner.item.isDirectSharedSplit || loser.item.isDirectSharedSplit),
      isUpstreamRoyaltyWork:
        winner.isUpstreamRoyaltyWork || loser.isUpstreamRoyaltyWork || Boolean(winner.item.isUpstreamRoyaltyWork || loser.item.isUpstreamRoyaltyWork),
      isDerivativeWork: winner.isDerivativeWork || loser.isDerivativeWork || Boolean(winner.item.isDerivativeWork || loser.item.isDerivativeWork),
      isActionableShadow:
        winner.isActionableShadow || loser.isActionableShadow || Boolean(winner.item.isActionableShadow || loser.item.isActionableShadow),
      publicPageUrl: winner.publicPageUrl || loser.publicPageUrl || null,
      participation: winner.participation || loser.participation
    });
  }
  return Array.from(deduped.values());
}

type DerivativeApprovalRow = {
  authorizationId: string;
  linkId?: string | null;
  childContentId: string;
  parentContentId?: string | null;
  parentTitle?: string | null;
  status?: string | null;
  approvedApprovers?: number | null;
  approverCount?: number | null;
  approveWeightBps?: number | null;
  approvalBpsTarget?: number | null;
  clearanceRequest?: {
    requestedAt?: string | null;
  } | null;
};

type SplitVersionSummary = {
  status: string | null;
  participantCount: number | null;
};

type PublicAttributionContributor = {
  displayName: string;
  handle: string | null;
  role: string | null;
  bps: number;
  profilePath?: string | null;
};

type PublicAttributionPayload = {
  split?: { state?: "active" | "draft" | "none" } | null;
  primaryCreator?: { displayName?: string | null; handle?: string | null } | null;
  contributors?: PublicAttributionContributor[] | null;
};

function remoteParticipationsCacheKey(apiBase: string): string {
  return `cb.library.remoteParticipations:${String(apiBase || "").replace(/\/+$/, "")}`;
}

function readCachedRemoteParticipations(apiBase: string): RemoteRoyaltyParticipation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(remoteParticipationsCacheKey(apiBase));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RemoteRoyaltyParticipation[]) : [];
  } catch {
    return [];
  }
}

function writeCachedRemoteParticipations(apiBase: string, rows: RemoteRoyaltyParticipation[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(remoteParticipationsCacheKey(apiBase), JSON.stringify(Array.isArray(rows) ? rows : []));
  } catch {
    // ignore storage write failures
  }
}

const ACCESS_BADGE: Record<NonNullable<LibraryItem["libraryAccess"]>, { label: string; cls: string }> = {
  owned: { label: "Owned", cls: "border-emerald-600/40 bg-emerald-500/10 text-emerald-300" },
  purchased: { label: "Purchased", cls: "border-sky-600/40 bg-sky-500/10 text-sky-300" },
  preview: { label: "Preview only", cls: "border-amber-600/40 bg-amber-500/10 text-amber-300" },
  local: { label: "Local", cls: "border-neutral-700 bg-neutral-700/20 text-neutral-300" },
  shared: { label: "Shared", cls: "border-fuchsia-600/40 bg-fuchsia-500/10 text-fuchsia-300" },
  participant: { label: "Shared", cls: "border-fuchsia-600/40 bg-fuchsia-500/10 text-fuchsia-300" }
};

function normalizeLibraryTypeFilter(raw: string | null | undefined): LibraryTypeFilter {
  const v = String(raw || "").toLowerCase();
  return (LIBRARY_TYPE_FILTERS as string[]).includes(v) ? (v as LibraryTypeFilter) : "all";
}

function readLibraryTypeFromUrl(): LibraryTypeFilter {
  if (typeof window === "undefined") return "all";
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeLibraryTypeFilter(params.get("libraryType") ?? params.get("type"));
  } catch {
    return "all";
  }
}

function normalizeLibraryRelationshipFilter(raw: string | null | undefined): LibraryRelationshipFilter {
  const v = String(raw || "").toLowerCase();
  return (LIBRARY_RELATIONSHIP_FILTERS as string[]).includes(v)
    ? (v as LibraryRelationshipFilter)
    : "all";
}

function readLibraryRelationshipFromUrl(): LibraryRelationshipFilter {
  if (typeof window === "undefined") return "all";
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeLibraryRelationshipFilter(params.get("libraryRelationship") ?? params.get("relationship"));
  } catch {
    return "all";
  }
}

function writeLibraryFiltersToUrl(type: LibraryTypeFilter, relationship: LibraryRelationshipFilter) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("type");
  url.searchParams.delete("relationship");
  if (type === "all") url.searchParams.delete("libraryType");
  else url.searchParams.set("libraryType", type);
  if (relationship === "all") url.searchParams.delete("libraryRelationship");
  else url.searchParams.set("libraryRelationship", relationship);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function mapContentType(type: string | null | undefined): LibraryTypeFilter {
  const normalized = String(type || "").trim().toLowerCase();
  if (normalized === "song") return "songs";
  if (normalized === "video") return "videos";
  if (normalized === "book") return "books";
  return "files";
}

function normalizeRemoteParticipationContentStatus(value: string | null | undefined, inviteStatus?: string | null): string {
  const v = String(value || "").trim().toLowerCase();
  if (v === "published" || v === "draft") return v;
  // Accepted remote split participation should surface in Library even when upstream omits status.
  if (String(inviteStatus || "").trim().toLowerCase() === "accepted") return "published";
  return "draft";
}

function applyLibraryFilters(
  items: NormalizedLibraryItem[],
  typeFilter: LibraryTypeFilter,
  relationshipFilter: LibraryRelationshipFilter
): NormalizedLibraryItem[] {
  return items.filter((entry) => {
    if (!shouldRenderActiveLibraryRow(entry)) return false;
    const typeMatch = typeFilter === "all" || entry.contentType === typeFilter;
    const relationMatch = (() => {
      const hasScope = (scope: "all" | "authored" | "shared_splits" | "derivatives") => entry.libraryScopes.has(scope);
      if (relationshipFilter === "all") return true;
      if (relationshipFilter === "authored_work") return hasScope("authored");
      if (relationshipFilter === "shared_splits") return hasScope("shared_splits");
      if (relationshipFilter === "derivatives") return hasScope("derivatives");
      return entry.relationshipTags.includes(relationshipFilter);
    })();
    const include = typeMatch && relationMatch;
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("libraryFilters.axis_decision", {
        contentId: entry.item.id,
        typeFilter,
        relationshipFilter,
        contentType: entry.contentType,
        relationshipType: entry.relationshipType,
        relationshipTags: entry.relationshipTags,
        availabilityState: entry.availabilityState,
        included: include,
        exclusionReason: include ? null : !typeMatch ? "type_mismatch" : "relationship_mismatch"
      });
    }
    return include;
  });
}

export default function LibraryPage() {
  const apiBase = getApiBase();
  const [items, setItems] = React.useState<NormalizedLibraryItem[]>([]);
  const [participationByContentId, setParticipationByContentId] = React.useState<Record<string, LibraryParticipation>>({});
  const [derivativeApprovalByChildId, setDerivativeApprovalByChildId] = React.useState<Record<string, DerivativeApprovalRow>>({});
  const [ownedSplitSummaryByContentId, setOwnedSplitSummaryByContentId] = React.useState<Record<string, SplitVersionSummary>>({});
  const splitSummaryLoadingRef = React.useRef<Set<string>>(new Set());
  const [featureBusyById, setFeatureBusyById] = React.useState<Record<string, boolean>>({});
  const [featureMsgById, setFeatureMsgById] = React.useState<Record<string, string>>({});
  const [msg, setMsg] = React.useState<string | null>(null);
  const [libraryTypeFilter, setLibraryTypeFilter] = React.useState<LibraryTypeFilter>(() => readLibraryTypeFromUrl());
  const [libraryRelationshipFilter, setLibraryRelationshipFilter] = React.useState<LibraryRelationshipFilter>(() => readLibraryRelationshipFromUrl());
  const [previewById, setPreviewById] = React.useState<Record<string, any | null>>({});
  const [previewLoading, setPreviewLoading] = React.useState<Record<string, boolean>>({});
  const [previewError, setPreviewError] = React.useState<Record<string, string>>({});
  const [previewOpenById, setPreviewOpenById] = React.useState<Record<string, boolean>>({});
  const [coverCandidateIndexById, setCoverCandidateIndexById] = React.useState<Record<string, number>>({});
  const [lockedCoverUrlById, setLockedCoverUrlById] = React.useState<Record<string, string | null>>({});
  const [previewCandidateIndexById, setPreviewCandidateIndexById] = React.useState<Record<string, number>>({});
  const [lockedPlaybackUrlById, setLockedPlaybackUrlById] = React.useState<Record<string, string | null>>({});
  const [entitlementByContentId, setEntitlementByContentId] = React.useState<Record<string, EntitlementInventoryRow>>({});
  const [attributionByContentId, setAttributionByContentId] = React.useState<Record<string, PublicAttributionPayload | null>>({});
  const attributionLoadingRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    (async () => {
      try {
        const normalize = (list: LibraryItem[]) =>
          (list || []).map((i) => ({
            ...i,
            libraryAccess: i.libraryAccess || (i.ownerUserId ? "owned" : "preview")
          }));
        const remoteParticipationsPromise = api<RemoteRoyaltyParticipation[]>("/my/royalties/remote", "GET")
          .then((rows) => {
            const normalizedRows = Array.isArray(rows) ? rows : [];
            if (normalizedRows.length > 0) {
              writeCachedRemoteParticipations(apiBase, normalizedRows);
              return normalizedRows;
            }
            // Keep last known remote participation snapshot when backend returns empty
            // (for example transient/offline mirror gaps) so Library does not blank out.
            const cached = readCachedRemoteParticipations(apiBase);
            return cached.length > 0 ? cached : normalizedRows;
          })
          .catch(() => readCachedRemoteParticipations(apiBase));
        const [lib, mine, localParticipationsRes, remoteParticipationsRes, royaltiesRes, entitlementsRes, derivativeApprovalsRes] = await Promise.all([
          api<LibraryItem[]>(`/content?scope=library`, "GET").catch(() => []),
          api<LibraryItem[]>(`/content?scope=mine`, "GET").catch(() => []),
          api<{ items: LibraryParticipation[] }>("/my/participations", "GET").catch(() => ({ items: [] as LibraryParticipation[] })),
          remoteParticipationsPromise,
          api<{ upstreamIncome?: Array<{ parentContentId?: string | null; childContentId?: string | null }> }>("/my/royalties", "GET").catch(() => null),
          api<EntitlementInventoryRow[]>("/me/entitlements", "GET").catch(() => [] as EntitlementInventoryRow[]),
          api<DerivativeApprovalRow[]>("/api/derivatives/approvals?scope=all", "GET").catch(() => [] as DerivativeApprovalRow[])
        ]);
        const nextDerivativeApprovalByChildId: Record<string, DerivativeApprovalRow> = {};
        const derivativeChildContentIds = new Set<string>();
        const derivativeParentContentIds = new Set<string>();
        for (const row of Array.isArray(derivativeApprovalsRes) ? derivativeApprovalsRes : []) {
          const childContentId = String(row?.childContentId || "").trim();
          const parentContentId = String(row?.parentContentId || "").trim();
          if (childContentId) derivativeChildContentIds.add(childContentId);
          if (parentContentId) derivativeParentContentIds.add(parentContentId);
          if (!childContentId) continue;
          const existing = nextDerivativeApprovalByChildId[childContentId];
          if (!existing) {
            nextDerivativeApprovalByChildId[childContentId] = row;
            continue;
          }
          const existingRequestedAt = Date.parse(String(existing?.clearanceRequest?.requestedAt || "")) || 0;
          const incomingRequestedAt = Date.parse(String(row?.clearanceRequest?.requestedAt || "")) || 0;
          if (incomingRequestedAt >= existingRequestedAt) nextDerivativeApprovalByChildId[childContentId] = row;
        }
        setDerivativeApprovalByChildId(nextDerivativeApprovalByChildId);
        const nextEntitlementByContentId: Record<string, EntitlementInventoryRow> = {};
        for (const row of Array.isArray(entitlementsRes) ? entitlementsRes : []) {
          const contentId = String(row?.contentId || "").trim();
          if (!contentId) continue;
          nextEntitlementByContentId[contentId] = row;
        }
        setEntitlementByContentId(nextEntitlementByContentId);
        const upstreamDerivativeChildContentIds = new Set<string>();
        const upstreamRows = Array.isArray(royaltiesRes?.upstreamIncome) ? royaltiesRes.upstreamIncome : [];
        for (const row of upstreamRows) {
          const childContentId = String(row?.childContentId || "").trim();
          const parentContentId = String(row?.parentContentId || "").trim();
          if (childContentId) {
            derivativeChildContentIds.add(childContentId);
            upstreamDerivativeChildContentIds.add(childContentId);
          }
          if (parentContentId) derivativeParentContentIds.add(parentContentId);
        }

        const baseListRaw = Array.isArray(lib) && lib.length > 0 ? lib : mine;
        const baseList = normalize(baseListRaw || []);
        const knownContentIds = new Set(baseList.map((it) => String(it.id || "").trim()).filter(Boolean));
        const participationByContentId = new Map<string, LibraryParticipation>();

        const localParticipationsRaw = Array.isArray(localParticipationsRes?.items) ? localParticipationsRes.items : [];
        const localParticipations: LibraryParticipation[] = localParticipationsRaw.map((row: any) => ({
          kind: "local",
          contentId: String(row?.contentId || "").trim(),
          contentTitle: row?.contentTitle || null,
          contentType: row?.contentType || null,
          contentStatus: row?.contentStatus || null,
          contentDeletedAt: row?.contentDeletedAt || null,
          splitParticipantId: String(row?.splitParticipantId || "").trim() || null,
            remoteInviteId: null,
            remoteOrigin: null,
            status: String(row?.status || "").trim() || null,
            acceptedAt: row?.acceptedAt || null,
            verifiedAt: row?.verifiedAt || null,
            revokedAt: row?.revokedAt || null,
            tombstonedAt: row?.tombstonedAt || null,
            highlightedOnProfile: Boolean(row?.highlightedOnProfile),
            attributionUrl: String(row?.attributionUrl || "").trim() || null,
            buyUrl: String(row?.buyUrl || "").trim() || null,
            creatorUserId: row?.creatorUserId || null,
            creatorDisplayName: row?.creatorDisplayName || null,
            creatorEmail: row?.creatorEmail || null,
            participantRole: row?.participantRole || null,
            participantBps: Number.isFinite(Number(row?.participantBps)) ? Number(row?.participantBps) : null,
            participantPercent: Number.isFinite(Number(row?.participantPercent)) ? Number(row?.participantPercent) : null,
            derivativeContext: row?.derivativeContext || null,
            libraryScopes: ["all", "shared_splits"]
        }));
        const remoteParticipationsRaw = Array.isArray(remoteParticipationsRes) ? remoteParticipationsRes : [];
        const remoteOriginByParentContentId = new Map<string, string>();
        const remoteInviteMetaByParentContentId = new Map<
          string,
          { remoteInviteId: string | null; highlightedOnProfile: boolean }
        >();
        for (const row of remoteParticipationsRaw) {
          const parentContentId = String(row?.contentId || "").trim();
          const origin = String(row?.remoteOrigin || "").replace(/\/+$/, "");
          if (!parentContentId || !origin || remoteOriginByParentContentId.has(parentContentId)) continue;
          remoteOriginByParentContentId.set(parentContentId, origin);
          remoteInviteMetaByParentContentId.set(parentContentId, {
            remoteInviteId: String(row?.id || "").trim() || null,
            highlightedOnProfile: Boolean(row?.highlightedOnProfile)
          });
        }
        const remoteParticipations: LibraryParticipation[] = remoteParticipationsRaw
          .filter((row) => String(row?.status || "").toLowerCase() === "accepted")
          .filter((row) => Boolean(String(row?.contentId || "").trim()))
          .map((row) => {
            const remoteOrigin = String(row.remoteOrigin || "").replace(/\/+$/, "") || null;
            const contentId = String(row.contentId || "").trim();
            return {
              kind: "remote",
              contentId,
              contentTitle: row.contentTitle || null,
              contentType: row.contentType || null,
              contentStatus: normalizeRemoteParticipationContentStatus(row.contentStatus, row.status),
              contentDeletedAt: row.contentDeletedAt || null,
              splitParticipantId: null,
              remoteInviteId: String(row.id || "").trim() || null,
              remoteOrigin,
              status: row.status || null,
              acceptedAt: row.acceptedAt || null,
              verifiedAt: null,
              revokedAt: row.revokedAt || null,
              tombstonedAt: row.tombstonedAt || null,
              highlightedOnProfile: Boolean(row.highlightedOnProfile),
              attributionUrl: remoteOrigin ? `${remoteOrigin}/public/content/${encodeURIComponent(contentId)}/attribution` : null,
              buyUrl: remoteOrigin ? `${remoteOrigin}/buy/${encodeURIComponent(contentId)}` : null,
              creatorUserId: null,
              creatorDisplayName: null,
              creatorEmail: null,
              libraryScopes: ["all", "shared_splits"]
            };
          });
        const remoteDerivativeParticipations: LibraryParticipation[] = remoteParticipationsRaw
          .filter((row) => String(row?.status || "").toLowerCase() === "accepted")
          .flatMap((row) => {
            const inviteId = String(row?.id || "").trim() || null;
            const defaultOrigin = String(row?.remoteOrigin || "").replace(/\/+$/, "") || null;
            const inbox = Array.isArray(row?.clearanceInbox) ? row.clearanceInbox : [];
            for (const entry of inbox) {
              const status = String(entry?.status || "").trim().toLowerCase();
              const parentContentId = String((entry as any)?.parentContentId || "").trim();
              const childContentId = String(entry?.childContentId || "").trim();
              if (!parentContentId || !childContentId) continue;
              if (["pending", "rejected", "approved", "cleared"].includes(status)) {
                derivativeParentContentIds.add(parentContentId);
                derivativeChildContentIds.add(childContentId);
              }
            }
            return inbox
              .filter((entry) => {
                const status = String(entry?.status || "").toLowerCase();
                const childStatus = String(entry?.childStatus || "").toLowerCase();
                const childDeletedAt = String(entry?.childDeletedAt || "").trim();
                // Library cards should only surface published/cleared derivative works.
                if (!(status === "approved" || status === "cleared")) return false;
                if (childDeletedAt) return false;
                if (childStatus && childStatus !== "published") return false;
                return true;
              })
              .map((entry) => {
                const childContentId = String(entry?.childContentId || "").trim();
                if (!childContentId) return null;
                const relation = String(entry?.relation || "").trim().toLowerCase();
                const childType = relation === "remix" || relation === "mashup" || relation === "derivative" ? relation : "derivative";
                return {
                  kind: "remote" as const,
                  contentId: childContentId,
                  contentTitle: entry?.childTitle || "Untitled derivative",
                  contentType: childType,
                  contentStatus: String(entry?.childStatus || "published").toLowerCase() || "published",
                  contentDeletedAt: String(entry?.childDeletedAt || "").trim() || null,
                  splitParticipantId: null,
                  remoteInviteId: inviteId,
                  remoteOrigin: String(entry?.childOrigin || "").replace(/\/+$/, "") || defaultOrigin,
                  status: row?.status || "accepted",
                  acceptedAt: row?.acceptedAt || null,
                  verifiedAt: null,
                  revokedAt: row?.revokedAt || null,
                  tombstonedAt: row?.tombstonedAt || null,
                  highlightedOnProfile: Boolean(row?.highlightedOnProfile),
                  attributionUrl: (String(entry?.childOrigin || "").replace(/\/+$/, "") || defaultOrigin)
                    ? `${(String(entry?.childOrigin || "").replace(/\/+$/, "") || defaultOrigin)}/public/content/${encodeURIComponent(childContentId)}/attribution`
                    : null,
                  buyUrl: (String(entry?.childOrigin || "").replace(/\/+$/, "") || defaultOrigin)
                    ? `${(String(entry?.childOrigin || "").replace(/\/+$/, "") || defaultOrigin)}/buy/${encodeURIComponent(childContentId)}`
                    : null,
                  creatorUserId: null,
                  creatorDisplayName: null,
                  creatorEmail: null,
                  libraryScopes: ["all", "derivatives"]
                } as LibraryParticipation;
              })
              .filter(Boolean) as LibraryParticipation[];
          });
        const upstreamDerivativeParticipations: LibraryParticipation[] = upstreamRows
          .filter((row) => {
            const childContentId = String(row?.childContentId || "").trim();
            if (!childContentId) return false;
            const status = String((row as any)?.status || "").toLowerCase();
            const approvedAt = String((row as any)?.approvedAt || "").trim();
            const childDeletedAt = String((row as any)?.childDeletedAt || "").trim();
            if (childDeletedAt) return false;
            return status === "approved" || Boolean(approvedAt);
          })
          .map((row) => {
            const parentContentId = String(row?.parentContentId || "").trim();
            const childContentId = String(row?.childContentId || "").trim();
            const childTitle = String((row as any)?.childTitle || "").trim() || "Untitled derivative";
            const origin = remoteOriginByParentContentId.get(parentContentId) || null;
            const remoteInviteMeta = remoteInviteMetaByParentContentId.get(parentContentId) || null;
            return {
              kind: "remote" as const,
              contentId: childContentId,
              contentTitle: childTitle,
              contentType: "derivative",
              contentStatus: "published",
              contentDeletedAt: String((row as any)?.childDeletedAt || "").trim() || null,
              splitParticipantId: null,
              remoteInviteId: remoteInviteMeta?.remoteInviteId || null,
              remoteOrigin: origin,
              status: "accepted",
              acceptedAt: null,
              verifiedAt: null,
              revokedAt: null,
              tombstonedAt: null,
              highlightedOnProfile: Boolean(remoteInviteMeta?.highlightedOnProfile),
              attributionUrl: origin
                ? `${origin}/public/content/${encodeURIComponent(childContentId)}/attribution`
                : null,
              buyUrl: origin ? `${origin}/buy/${encodeURIComponent(childContentId)}` : null,
              creatorUserId: null,
              creatorDisplayName: null,
              creatorEmail: null,
              libraryScopes: ["all", "derivatives"]
            } satisfies LibraryParticipation;
          });

        for (const p of [...localParticipations, ...remoteParticipations, ...remoteDerivativeParticipations, ...upstreamDerivativeParticipations]) {
          const contentId = String(p?.contentId || "").trim();
          if (!contentId) continue;
          const existing = participationByContentId.get(contentId);
          if (!existing) {
            participationByContentId.set(contentId, p);
            continue;
          }
          if (existing.kind === "local" && p.kind === "remote") {
            participationByContentId.set(contentId, {
              ...existing,
              remoteInviteId: existing.remoteInviteId || p.remoteInviteId,
              remoteOrigin: existing.remoteOrigin || p.remoteOrigin,
              attributionUrl: existing.attributionUrl || p.attributionUrl,
              buyUrl: existing.buyUrl || p.buyUrl
            });
            continue;
          }
          if (existing.kind !== "local" && p.kind === "local") {
            participationByContentId.set(contentId, {
              ...p,
              remoteInviteId: p.remoteInviteId || existing.remoteInviteId,
              remoteOrigin: p.remoteOrigin || existing.remoteOrigin,
              attributionUrl: p.attributionUrl || existing.attributionUrl,
              buyUrl: p.buyUrl || existing.buyUrl
            });
          }
        }
        const nextParticipationByContentId: Record<string, LibraryParticipation> = {};
        for (const [contentId, participation] of participationByContentId.entries()) {
          nextParticipationByContentId[contentId] = participation;
        }

        const participationOnlyItems: LibraryItem[] = [
          ...localParticipations,
          ...remoteParticipations,
          ...remoteDerivativeParticipations,
          ...upstreamDerivativeParticipations
        ]
          .filter((p) => p?.contentId && !knownContentIds.has(p.contentId))
          .filter((p) => {
            const active = isActiveLibraryVisible(
              {
                id: p.contentId,
                status: p.contentStatus || "published",
                deletedAt: p.contentDeletedAt || null
              },
              "participant",
              p
            );
            logVisibilityDecision({
              surface: "library.participation_only",
              sourceModelQuery: p.kind === "remote" ? "GET /my/royalties/remote" : "GET /my/participations",
              relation: "participant",
              content: {
                id: p.contentId,
                status: p.contentStatus || "published",
                deletedAt: p.contentDeletedAt || null
              },
              included: active.visible,
              reason: active.visible ? "active_library_visible" : active.reason || "excluded"
            });
            return active.visible;
          })
          .map((p) => ({
            id: p.contentId,
            title: p.contentTitle || "Untitled",
            type: p.contentType || "file",
            status: p.contentStatus || "published",
            deletedAt: p.contentDeletedAt || null,
            createdAt: "",
            ownerUserId: p.creatorUserId || null,
            owner: {
              displayName: p.creatorDisplayName || null,
              email: p.creatorEmail || null
            },
            libraryAccess: "participant",
            libraryScopes: Array.isArray(p.libraryScopes) ? p.libraryScopes : ["all"],
            attributionUrl: p.attributionUrl || null,
            buyUrl: p.buyUrl || null,
            remoteOrigin: p.remoteOrigin || null
          }));
        const combined = [...baseList, ...participationOnlyItems];
        const normalized: NormalizedLibraryItem[] = [];
        for (const item of combined) {
          const contentId = String(item.id || "").trim();
          const participation = participationByContentId.get(contentId) || null;
          const appearsBecause = new Set(
            (Array.isArray(item.appearsBecause) ? item.appearsBecause : [])
              .map((value) => String(value || "").trim().toLowerCase())
              .filter(Boolean)
          );
          const normalizeScopes = (raw: unknown): Array<"all" | "authored" | "shared_splits" | "derivatives"> => {
            const allowed = new Set(["all", "authored", "shared_splits", "derivatives"]);
            const values = Array.isArray(raw) ? raw : [];
            return Array.from(
              new Set(
                values
                  .map((value) => String(value || "").trim().toLowerCase())
                  .filter((value) => allowed.has(value))
              )
            ) as Array<"all" | "authored" | "shared_splits" | "derivatives">;
          };
          const hasParticipantReason =
            appearsBecause.has("split_participant") ||
            appearsBecause.has("shared_with_me") ||
            appearsBecause.has("remote_mirror");
          const explicitOwnedReason = appearsBecause.has("owned");
          const normalizedAccess: LibraryItem["libraryAccess"] =
            hasParticipantReason && !explicitOwnedReason
              ? "participant"
              : (item.libraryAccess as LibraryItem["libraryAccess"]);
          const scopes = new Set<"all" | "authored" | "shared_splits" | "derivatives">(
            normalizeScopes(item.libraryScopes)
          );
          if (scopes.size === 0) {
            if (normalizedAccess === "owned" && !hasLocalOriginMismatch(apiBase, item)) scopes.add("authored");
            if (appearsBecause.has("split_participant") || appearsBecause.has("shared_with_me")) scopes.add("shared_splits");
            if (appearsBecause.has("derivative_parent")) scopes.add("derivatives");
          }
          if (!scopes.has("all")) scopes.add("all");
          const normalizedItemForEligibility: LibraryItem = {
            ...item,
            libraryAccess: normalizedAccess,
            libraryScopes: Array.from(scopes)
          };
          const relation: LibraryRelation =
            normalizedAccess === "owned"
              ? "owner"
              : normalizedAccess === "purchased"
                ? "buyer"
                : normalizedAccess === "participant" || normalizedAccess === "shared"
                  ? "participant"
                  : normalizedAccess === "preview"
                    ? "preview"
                    : "unknown";
          const activeVisibility = isActiveLibraryVisible(normalizedItemForEligibility, relation, participation);
          const entitlementVisibility = isEntitlementHistoryVisible(normalizedItemForEligibility, relation, participation);
          const decision = classifyLibraryEligibility({
            item: normalizedItemForEligibility,
            participation
          });
          logLibraryEligibilityDecision({
            scope: "library_page",
            contentId,
            decision,
            extra: {
              access: item.libraryAccess || null
            }
          });
          logVisibilityDecision({
            surface: "library.active",
            sourceModelQuery: "GET /content?scope=library + projections",
            relation,
            content: item,
            included: decision.included,
            reason: decision.included ? "classify_included" : decision.reason || "excluded",
            extra: {
              activeVisible: activeVisibility.visible,
              activeReason: activeVisibility.reason || null,
              entitlementHistoryVisible: entitlementVisibility.visible,
              entitlementHistoryReason: entitlementVisibility.reason || null,
              availabilityState: getAvailabilityState(item)
            }
          });
          const actionableDerivativeChildShadow =
            Boolean(normalizedItemForEligibility.isActionableShadow) &&
            scopes.has("derivatives") &&
            appearsBecause.has("derivative_child") &&
            !Boolean(normalizedItemForEligibility.isParentOfDerivative);
          if (!decision.included && !actionableDerivativeChildShadow) continue;
          const section: Exclude<LibrarySection, "excluded"> = decision.included
            ? (decision.section as Exclude<LibrarySection, "excluded">)
            : "participant";
          if (import.meta.env.DEV && actionableDerivativeChildShadow) {
            // eslint-disable-next-line no-console
            console.debug("libraryEligibility.override_actionable_derivative_shadow", {
              contentId,
              title: item.title || null,
              originalReason: decision.reason || null,
              appearsBecause: Array.from(appearsBecause),
              libraryScopes: Array.from(scopes)
            });
          }
          const normalizedItem: LibraryItem = {
            ...normalizedItemForEligibility,
            libraryAccess: section
          };
          const contentType = mapContentType(normalizedItem.type);
          const viewerOwnsItem = section === "owned" || appearsBecause.has("owned");
          const viewerParticipatesInSplit = section === "participant" || appearsBecause.has("split_participant");
          const explicitSharedMembership =
            appearsBecause.has("split_participant") ||
            appearsBecause.has("shared_with_me") ||
            appearsBecause.has("remote_mirror");
          const derivativeFlags = derivativeClassifier({
            type: normalizedItem.type,
            appearsBecause,
            contentId,
            derivativeChildContentIds,
            derivativeParentContentIds,
            upstreamDerivativeChildContentIds,
            participation,
            relation,
            itemIsParentOfDerivative: Boolean(normalizedItemForEligibility?.isParentOfDerivative)
          });
          const isDerivativeChild = derivativeFlags.isDerivativeChild;
          const isDerivativeParent = derivativeFlags.isDerivativeParent;
          const derivativeLinked = derivativeFlags.isDerivative;
          const ownedByViewer = section === "owned" || appearsBecause.has("owned");
          const localAuthoredFallback =
            ownedByViewer &&
            !hasLocalOriginMismatch(apiBase, normalizedItemForEligibility);
          const localAuthored =
            scopes.has("authored") ||
            Boolean(normalizedItemForEligibility?.isLocalAuthored) ||
            localAuthoredFallback;
          const directSharedSplit =
            scopes.has("shared_splits") ||
            Boolean(normalizedItemForEligibility?.isDirectSharedSplit) ||
            appearsBecause.has("split_participant") ||
            appearsBecause.has("shared_with_me") ||
            (section === "participant" && !appearsBecause.has("derivative_parent"));
          const upstreamRoyaltyWork =
            scopes.has("derivatives") ||
            Boolean(normalizedItemForEligibility?.isUpstreamRoyaltyWork) ||
            (appearsBecause.has("derivative_parent") &&
              (isDerivativeChild || appearsBecause.has("derivative_child")));
          const actionableShadow = isActionableShadowRow(normalizedItemForEligibility, appearsBecause);
          const hasSharedSplitMembership =
            explicitSharedMembership || (viewerParticipatesInSplit && !viewerOwnsItem);
          const relationshipTagSet = new Set<LibraryRelationshipFilter>();
          if (scopes.has("authored")) relationshipTagSet.add("authored_work");
          if (scopes.has("shared_splits") || hasSharedSplitMembership) relationshipTagSet.add("shared_splits");
          if (scopes.has("derivatives") || derivativeLinked) relationshipTagSet.add("derivatives");
          const relationshipTags = Array.from(relationshipTagSet);
          const relationshipType: LibraryRelationshipType = relationshipTags.includes("derivatives")
            ? "derivatives"
            : relationshipTags.includes("shared_splits")
              ? "shared_splits"
              : relationshipTags.includes("authored_work")
                ? "authored_work"
                : "other";
          normalized.push({
            item: normalizedItem,
            libraryScopes: scopes,
            contentType,
            relationshipType,
            relationshipTags: relationshipTags.length ? relationshipTags : ["all"],
            isLocalAuthored: localAuthored,
            isDirectSharedSplit: directSharedSplit,
            isUpstreamRoyaltyWork: upstreamRoyaltyWork,
            isDerivativeWork: derivativeLinked,
            isActionableShadow: actionableShadow,
            isDerivativeChild,
            isDerivativeParent,
            availabilityState: getAvailabilityState(normalizedItem),
            relation,
            publicPageUrl: asNonEmptyString(normalizedItem.buyUrl) || buildPublicPageUrl(contentId, participation?.remoteOrigin || normalizedItem.remoteOrigin || null),
            participation
          });
        }
        const dedupedNormalized = dedupeCanonicalLibraryEntries(normalized);
        setParticipationByContentId(nextParticipationByContentId);
        setItems(applyLibraryFilters(dedupedNormalized, libraryTypeFilter, libraryRelationshipFilter));
      } catch (e: any) {
        const err = String(e?.message || "Failed to load library");
        setMsg(err.includes("INVALID_TYPE") ? "Invalid type filter." : err);
      }
    })();
  }, [libraryTypeFilter, libraryRelationshipFilter]);

  React.useEffect(() => {
    const ownedIds = Array.from(
      new Set(
        items
          .filter((entry) => entry.relation === "owner")
          .map((entry) => String(entry.item.id || "").trim())
          .filter(Boolean)
      )
    ).filter((id) => !ownedSplitSummaryByContentId[id] && !splitSummaryLoadingRef.current.has(id));
    if (!ownedIds.length) return;

    for (const id of ownedIds) splitSummaryLoadingRef.current.add(id);
    (async () => {
      const entries = await Promise.all(
        ownedIds.map(async (contentId) => {
          try {
            const versions = await api<any[]>(`/content/${encodeURIComponent(contentId)}/split-versions`, "GET");
            const latest = Array.isArray(versions) && versions.length > 0 ? versions[0] : null;
            return [
              contentId,
              {
                status: latest?.status || null,
                participantCount: Array.isArray(latest?.participants) ? latest.participants.length : null
              } as SplitVersionSummary
            ] as const;
          } catch {
            return [contentId, { status: null, participantCount: null } as SplitVersionSummary] as const;
          }
        })
      );
      setOwnedSplitSummaryByContentId((prev) => {
        const next = { ...prev };
        for (const [contentId, summary] of entries) next[contentId] = summary;
        return next;
      });
      for (const id of ownedIds) splitSummaryLoadingRef.current.delete(id);
    })();
  }, [items, ownedSplitSummaryByContentId]);

  React.useEffect(() => {
    const onPopState = () => {
      setLibraryTypeFilter(readLibraryTypeFromUrl());
      setLibraryRelationshipFilter(readLibraryRelationshipFromUrl());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  React.useEffect(() => {
    if (!items.length) return;
    const toLoad = items.filter((entry) => entry.relation !== "participant");
    toLoad.forEach((entry) => {
      const id = entry.item.id;
      if (!previewById[id] && !previewLoading[id]) {
        loadPreview(id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, previewById, previewLoading]);

  React.useEffect(() => {
    const targetEntries = items;
    const missingEntries = targetEntries.filter((entry) => {
      const contentId = String(entry.item.id || "").trim();
      return (
        contentId &&
        attributionByContentId[contentId] === undefined &&
        !attributionLoadingRef.current.has(contentId)
      );
    });
    if (!missingEntries.length) return;

    for (const entry of missingEntries) {
      attributionLoadingRef.current.add(String(entry.item.id || "").trim());
    }

    (async () => {
      const updates = await Promise.all(
        missingEntries.map(async (entry) => {
          const contentId = String(entry.item.id || "").trim();
          const explicitAttributionUrl = asNonEmptyString(entry.item.attributionUrl);
          if (explicitAttributionUrl) {
            try {
              const res = await fetch(explicitAttributionUrl, { method: "GET", credentials: "omit" });
              if (!res.ok) return [contentId, null] as const;
              const payload = (await res.json()) as PublicAttributionPayload;
              return [contentId, payload || null] as const;
            } catch {
              return [contentId, null] as const;
            }
          }
          const participation = entry.participation || participationByContentId[contentId] || null;
          const baseOrigin =
            participation?.kind === "remote" && participation.remoteOrigin
              ? String(participation.remoteOrigin).replace(/\/+$/, "")
              : asNonEmptyString(entry.item.remoteOrigin) || apiBase.replace(/\/+$/, "");
          const url = `${baseOrigin}/public/content/${encodeURIComponent(contentId)}/attribution`;
          try {
            const res = await fetch(url, { method: "GET", credentials: "omit" });
            if (!res.ok) return [contentId, null] as const;
            const payload = (await res.json()) as PublicAttributionPayload;
            return [contentId, payload || null] as const;
          } catch {
            return [contentId, null] as const;
          }
        })
      );
      setAttributionByContentId((prev) => {
        const next = { ...prev };
        for (const [contentId, payload] of updates) {
          next[contentId] = payload;
          attributionLoadingRef.current.delete(contentId);
        }
        return next;
      });
    })();
  }, [apiBase, items, attributionByContentId, participationByContentId]);

  const groupedEntries = {
    owned: items.filter((e) => e.item.libraryAccess === "owned"),
    purchased: items.filter((e) => e.item.libraryAccess === "purchased"),
    preview: items.filter((e) => e.item.libraryAccess === "preview"),
    participant: items.filter((e) => e.item.libraryAccess === "participant" || e.item.libraryAccess === "shared")
  };

  async function loadPreview(contentId: string) {
    setPreviewLoading((m) => ({ ...m, [contentId]: true }));
    setPreviewError((m) => ({ ...m, [contentId]: "" }));
    try {
      const res = await api<any>(`/content/${contentId}/preview`, "GET");
      setPreviewById((m) => ({ ...m, [contentId]: res || null }));
    } catch (e: any) {
      setPreviewById((m) => ({ ...m, [contentId]: null }));
      setPreviewError((m) => ({ ...m, [contentId]: e?.message || "Preview failed" }));
    } finally {
      setPreviewLoading((m) => ({ ...m, [contentId]: false }));
    }
  }

  async function setFeatureOnProfile(entry: NormalizedLibraryItem, next: boolean) {
    const contentId = entry.item.id;
    setFeatureBusyById((m) => ({ ...m, [contentId]: true }));
    setFeatureMsgById((m) => ({ ...m, [contentId]: "" }));
    try {
      const participation = entry.participation || participationByContentId[contentId] || null;
      const shouldUseParticipationHighlight = shouldUseParticipationFeatureHighlight(entry, participation);
      const stakeholderScopes = entry.libraryScopes || new Set<"all" | "authored" | "shared_splits" | "derivatives">();
      const isShadowLifecycle = entry.item.lifecycle === "shadow" || Boolean(entry.item.isShadow);
      const isVisibleActionableState = entry.availabilityState === "active" || isShadowLifecycle;
      const hasPublicTarget = Boolean(entry.publicPageUrl) || Boolean(String(contentId || "").trim());
      const isStakeholderScope =
        stakeholderScopes.has("derivatives") || stakeholderScopes.has("shared_splits") || stakeholderScopes.has("all");
      const shadowStakeholderFeatureEligible = isVisibleActionableState && hasPublicTarget && isStakeholderScope;

      if (shouldUseParticipationHighlight) {
        if (!participation) throw new Error("Participation info not found.");
        const res =
          participation.kind === "remote" && participation.remoteInviteId
            ? await api<{ highlightedOnProfile: boolean }>(
                `/my/royalties/remote/${encodeURIComponent(String(participation.remoteInviteId))}/highlight`,
                "PATCH",
                { enabled: next, contentId }
              )
            : await api<{ highlightedOnProfile: boolean }>(
                `/my/participations/${encodeURIComponent(String(participation.splitParticipantId || ""))}/highlight`,
                "PATCH",
                { enabled: next }
              );
        const highlightedOnProfile = Boolean(res?.highlightedOnProfile);
        setParticipationByContentId((prev) => ({
          ...prev,
          [contentId]: {
            ...(prev[contentId] || participation),
            highlightedOnProfile
          }
        }));
        setItems((prev) =>
          prev.map((row) =>
            row.item.id === contentId
              ? {
                  ...row,
                  participation: row.participation
                    ? { ...row.participation, highlightedOnProfile }
                    : row.participation
                }
              : row
          )
        );
        return;
      }

      if (entry.relation === "owner" || shadowStakeholderFeatureEligible) {
        const res = await api<{ featureOnProfile: boolean }>(
          `/content/${encodeURIComponent(contentId)}/feature-on-profile`,
          "PATCH",
          { featureOnProfile: next }
        );
        setItems((prev) =>
          prev.map((row) =>
            row.item.id === contentId
              ? { ...row, item: { ...row.item, featureOnProfile: Boolean(res?.featureOnProfile) } }
              : row
          )
        );
        return;
      }
      throw new Error("Feature on profile is only available for owned or split-participation content.");
    } catch (e: any) {
      setFeatureMsgById((m) => ({ ...m, [contentId]: e?.message || "Failed to update profile feature status." }));
    } finally {
      setFeatureBusyById((m) => ({ ...m, [contentId]: false }));
    }
  }

function previewFileFor(previewUrl: string | null | undefined, files: any[] | null | undefined) {
    if (!previewUrl || !Array.isArray(files) || files.length === 0) return null;
    try {
      const u = new URL(previewUrl, window.location.origin);
      const objectKey = u.searchParams.get("objectKey");
      if (!objectKey) return null;
      return files.find((f: any) => f?.objectKey === objectKey) || null;
    } catch {
      return null;
    }
  }

function asNonEmptyString(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}

function shouldUseParticipationFeatureHighlight(
  entry: NormalizedLibraryItem,
  participation: LibraryParticipation | null | undefined
): boolean {
  if (!participation) return false;
  const access = String(entry.item?.libraryAccess || "").trim().toLowerCase();
  // Owned content must always toggle the owner feature flag, even when the
  // owner is also a split participant.
  if (entry.relation === "owner" || access === "owned") return false;
  if (participation.kind === "remote") return true;
  if (access === "participant" || access === "shared") return true;
  if (entry.relation === "participant") return true;
  return Array.isArray(entry.relationshipTags) && entry.relationshipTags.includes("shared_splits");
}

function formatDateLabel(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function normalizeAssetUrl(
  apiBase: string,
  raw: string | null | undefined,
  preferredOrigin?: string | null
): string | null {
  const source = String(raw || "").trim();
  if (!source) return null;
  const baseOrigin = String(preferredOrigin || apiBase || "").trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(source)) return source;
  if (source.startsWith("/")) {
    if (baseOrigin) return `${baseOrigin}${source}`;
    return source;
  }
  try {
    const asUrl = new URL(source, baseOrigin || apiBase);
    const pathAndQuery = `${asUrl.pathname}${asUrl.search}`;
    const root = (baseOrigin || apiBase).replace(/\/$/, "");
    return `${root}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;
  } catch {
    const root = (baseOrigin || apiBase).replace(/\/$/, "");
    return `${root}/${source.replace(/^\/+/, "")}`;
  }
}

function isLocalDevAssetOrigin(origin: string | null | undefined): boolean {
  const value = String(origin || "").trim().toLowerCase();
  if (!value) return false;
  return value.includes("localhost") || value.includes("127.0.0.1") || value.includes(":5173");
}

function isUsableLibraryAssetUrl(url: string | null | undefined): boolean {
  const value = String(url || "").trim();
  if (!value) return false;
  if (value.startsWith("/public/content/")) return true;
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function scoreLibraryAssetUrl(
  apiBase: string,
  url: string | null | undefined,
  preferredOrigin?: string | null
): number {
  const normalized = String(url || "").trim();
  if (!isUsableLibraryAssetUrl(normalized)) return -1;
  const preferred = toOrigin(preferredOrigin || null);
  const localOrigin = toOrigin(apiBase);
  let score = 0;
  if (/^https?:\/\//i.test(normalized)) score += 50;
  if (normalized.startsWith("/public/content/")) score += 25;
  if (normalized.includes("/public/content/")) score += 10;
  if (normalized.includes("objectKey=")) score += 5;
  const origin = toOrigin(normalized);
  if (origin && preferred && origin === preferred) score += 40;
  if (origin && localOrigin && origin === localOrigin) score += 20;
  if (origin && preferred && origin !== preferred) score -= 10;
  if (origin && preferred && isLocalDevAssetOrigin(origin)) score -= 20;
  return score;
}

function rankLibraryCoverCandidates(
  apiBase: string,
  preferredOrigin: string | null,
  candidates: Array<string | null | undefined>
): string[] {
  const scored = candidates
    .map((candidate) => normalizeAssetUrl(apiBase, candidate || null, preferredOrigin))
    .filter((value): value is string => Boolean(value))
    .map((url) => ({ url, score: scoreLibraryAssetUrl(apiBase, url, preferredOrigin) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    if (seen.has(row.url)) continue;
    seen.add(row.url);
    unique.push(row.url);
  }
  return unique;
}

function rankLibraryMediaCandidates(
  apiBase: string,
  preferredOrigin: string | null,
  candidates: Array<string | null | undefined>
): string[] {
  const scored = candidates
    .map((candidate) => normalizeAssetUrl(apiBase, candidate || null, preferredOrigin))
    .filter((value): value is string => Boolean(value))
    .map((url) => ({ url, score: scoreLibraryAssetUrl(apiBase, url, preferredOrigin) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    if (seen.has(row.url)) continue;
    seen.add(row.url);
    unique.push(row.url);
  }
  return unique;
}

function isForbiddenPreviewError(message?: string | null): boolean {
  const text = String(message || "").toLowerCase();
  return text.includes("403") || text.includes("forbidden");
}

function readinessLabel(readiness: LibraryRightsSummary["commercialReadiness"]): string {
  if (readiness === "ready") return "Ready to sell";
  if (readiness === "needs_split") return "Needs split setup";
  if (readiness === "not_published") return "Not published";
  if (readiness === "missing_payment_config") return "No price/payment config";
  if (readiness === "awaiting_clearance") return "Awaiting clearance";
  return "Readiness unknown";
}

function clearanceStatusLabel(status: NonNullable<LibraryRightsSummary["derivative"]>["clearanceStatus"]): string {
  if (status === "awaiting") return "Awaiting clearance";
  if (status === "partial") return "Partially approved";
  if (status === "cleared") return "Cleared";
  if (status === "rejected") return "Rejected / needs changes";
  if (status === "blocked") return "Blocked";
  return "Clearance unknown";
}

function splitSummaryLabel(summary: LibraryRightsSummary): string {
  if (summary.ownershipKind !== "owned") return "Shared split";
  if (summary.splitState === "solo") return "100% owner";
  if (summary.splitState === "shared") {
    const count = Number.isFinite(Number(summary.participantCount)) ? Number(summary.participantCount) : null;
    return count && count > 0 ? `Shared split • ${count} participants` : "Shared split";
  }
  if (summary.splitState === "draft_incomplete") return "Split draft incomplete";
  if (summary.splitState === "missing") return "Needs split setup";
  return "Split state unknown";
}

function relationshipDisplayLabel(
  entry: NormalizedLibraryItem,
  relationshipFilter: LibraryRelationshipFilter
): string {
  const scopes = entry.libraryScopes || new Set<"all" | "authored" | "shared_splits" | "derivatives">();
  const appearsBecause = new Set(
    (Array.isArray(entry.item?.appearsBecause) ? entry.item.appearsBecause : [])
      .map((v) => String(v || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const isShadowDerivativeChild =
    (entry.item.lifecycle === "shadow" || Boolean(entry.item.isShadow)) &&
    scopes.has("derivatives") &&
    appearsBecause.has("derivative_child");
  if (relationshipFilter === "derivatives" && (isShadowDerivativeChild || scopes.has("derivatives"))) {
    return "Derivative";
  }
  if (
    (isShadowDerivativeChild || scopes.has("derivatives")) &&
    !(relationshipFilter === "shared_splits" || (scopes.has("shared_splits") && !scopes.has("derivatives")))
  ) {
    return "Upstream royalty";
  }
  if (relationshipFilter === "shared_splits" || (scopes.has("shared_splits") && !scopes.has("derivatives"))) {
    return "Shared splits";
  }
  return LIBRARY_RELATIONSHIP_LABEL[entry.relationshipType === "other" ? "all" : entry.relationshipType];
}

function toPercentLabel(bps: number | null | undefined): string {
  const safe = Number.isFinite(Number(bps)) ? Math.max(0, Number(bps)) : 0;
  return `${(safe / 100).toFixed(2)}%`;
}

function buildPublicPageUrl(contentId: string, remoteOrigin?: string | null): string | null {
  const origin = String(remoteOrigin || "").trim().replace(/\/+$/, "");
  if (origin) return `${origin}/buy/${encodeURIComponent(contentId)}`;
  return null;
}

function buildPublicAssetUrl(
  contentId: string,
  asset: "cover" | "preview-file",
  remoteOrigin?: string | null
): string {
  const origin = String(remoteOrigin || "").trim().replace(/\/+$/, "");
  const path = `/public/content/${encodeURIComponent(contentId)}/${asset}`;
  if (origin) return `${origin}${path}`;
  return path;
}

function songCoverUrl(
  contentId: string,
  preview: any,
  itemCoverUrl?: string | null,
  preferredOrigin?: string | null
): string | null {
  const coverObjectKey = String(preview?.manifest?.cover || "").trim();
  if (coverObjectKey) {
    const root = String(preferredOrigin || apiBase || "").trim().replace(/\/+$/, "");
    return `${root}/public/content/${encodeURIComponent(contentId)}/preview-file?objectKey=${encodeURIComponent(coverObjectKey)}`;
  }
  const preferred = normalizeAssetUrl(apiBase, String(itemCoverUrl || "").trim(), preferredOrigin);
  if (preferred) return preferred;
  return null;
}

function manifestCoverUrl(
  contentId: string,
  preview: any,
  preferredOrigin?: string | null
): string | null {
  const coverObjectKey = String(preview?.manifest?.cover || "").trim();
  if (!coverObjectKey) return null;
  const root = String(preferredOrigin || apiBase || "").trim().replace(/\/+$/, "");
  return `${root}/public/content/${encodeURIComponent(contentId)}/preview-file?objectKey=${encodeURIComponent(coverObjectKey)}`;
}

function looksLikeImageAssetUrl(raw: string | null | undefined): boolean {
  const source = String(raw || "").trim();
  if (!source) return false;
  try {
    const u = new URL(source, window.location.origin);
    const objectKey = String(u.searchParams.get("objectKey") || "").trim().toLowerCase();
    const path = String(u.pathname || "").toLowerCase();
    const candidate = objectKey || path;
    return /\.(png|jpe?g|webp|gif|avif)$/.test(candidate);
  } catch {
    return /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(source);
  }
}

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4 sm:p-5">
        <div className="text-lg font-semibold">Library</div>
        <div className="text-sm text-neutral-400 mt-1">Private creator library: owned, purchased, and preview-access content.</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="text-xs text-neutral-500">Type</div>
          {LIBRARY_TYPE_FILTERS.map((value) => {
            const active = libraryTypeFilter === value;
            return (
              <button
                key={value}
                type="button"
                className={`text-xs rounded-full border px-3 py-1 ${active ? "border-white/30 bg-white/5 text-white" : "border-neutral-800 text-neutral-300 hover:bg-neutral-900"}`}
                onClick={() => {
                  setLibraryTypeFilter(value);
                  writeLibraryFiltersToUrl(value, libraryRelationshipFilter);
                }}
              >
                {LIBRARY_TYPE_LABEL[value]}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="text-xs text-neutral-500">Relationship</div>
          {LIBRARY_RELATIONSHIP_FILTERS.map((value) => {
            const active = libraryRelationshipFilter === value;
            return (
              <button
                key={value}
                type="button"
                className={`text-xs rounded-full border px-3 py-1 ${active ? "border-white/30 bg-white/5 text-white" : "border-neutral-800 text-neutral-300 hover:bg-neutral-900"}`}
                onClick={() => {
                  setLibraryRelationshipFilter(value);
                  writeLibraryFiltersToUrl(libraryTypeFilter, value);
                }}
              >
                {LIBRARY_RELATIONSHIP_LABEL[value]}
              </button>
            );
          })}
          <div className="text-xs text-neutral-500 sm:ml-auto">
            Showing: {LIBRARY_TYPE_LABEL[libraryTypeFilter]} · {LIBRARY_RELATIONSHIP_LABEL[libraryRelationshipFilter]}
          </div>
        </div>
      </div>

      {msg ? <div className="text-sm text-red-300">{msg}</div> : null}

      {items.length === 0 ? (
        <div className="text-sm text-neutral-400">No items yet.</div>
      ) : (
        <div className="space-y-6">
          {(
            libraryRelationshipFilter === "shared_splits"
              ? (["participant", "owned", "purchased", "preview"] as const)
              : (["owned", "purchased", "preview", "participant"] as const)
          ).map((key) => {
            const list = groupedEntries[key];
            if (!list.length) return null;
            const label =
              key === "owned" ? "Owned" : key === "purchased" ? "Purchased" : key === "preview" ? "Preview" : "Shared splits";
            return (
              <div key={key} className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((entry) => {
                    const it = entry.item;
                    const participationInfo = entry.participation || participationByContentId[it.id] || null;
                    const participationFeatured = Boolean(participationInfo?.highlightedOnProfile);
                    const ownerFeatured = Boolean(it.featureOnProfile);
                    const shouldUseParticipationHighlight = shouldUseParticipationFeatureHighlight(
                      entry,
                      participationInfo
                    );
                    const stakeholderScopes = entry.libraryScopes || new Set<"all" | "authored" | "shared_splits" | "derivatives">();
                    const isShadowLifecycle = it.lifecycle === "shadow" || Boolean(it.isShadow);
                    const isVisibleActionableState = entry.availabilityState === "active" || isShadowLifecycle;
                    const hasPublicTarget = Boolean(entry.publicPageUrl) || Boolean(String(it.id || "").trim());
                    const isStakeholderScope =
                      stakeholderScopes.has("derivatives") || stakeholderScopes.has("shared_splits") || stakeholderScopes.has("all");
                    const shadowStakeholderFeatureEligible = isVisibleActionableState && hasPublicTarget && isStakeholderScope;
                    const featureAllowed = canFeatureOnProfile({
                      item: {
                        ...it,
                        libraryAccess: shouldUseParticipationHighlight
                          ? "participant"
                          : entry.relation === "owner"
                            ? "owned"
                            : entry.relation === "participant"
                              ? "participant"
                              : it.libraryAccess
                      },
                      participation: participationInfo
                    }).allowed || shadowStakeholderFeatureEligible;
                    const currentlyFeatured = shouldUseParticipationHighlight ? participationFeatured : ownerFeatured;
                    const preview = previewById[it.id];
                    const previewUrl = preview?.previewUrl || null;
                    const pf = previewFileFor(previewUrl, preview?.files || []);
                    const mime = String(pf?.mime || "").toLowerCase();
                    const type = String(it.type || "").toLowerCase();
                    const mediaPathHint = String(
                      it.manifestPrimaryFilePath ||
                        it.primaryFile ||
                        preview?.manifest?.primaryFile ||
                        ""
                    )
                      .trim()
                      .toLowerCase();
                    const isVideoByPath = /\.(mp4|mov|m4v|webm|mkv|avi|wmv|ogv)$/.test(mediaPathHint);
                    const isAudioByPath = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus)$/.test(mediaPathHint);
                    const isImageByPath = /\.(png|jpe?g|webp|gif|bmp|svg)$/.test(mediaPathHint);
                    const derivativeLinked = entry.isDerivativeChild || entry.isDerivativeParent;
                    const derivativeParentOnly = entry.isDerivativeParent && !entry.isDerivativeChild;
                    const isVideo = mime.startsWith("video/") || type === "video" || type === "remix" || isVideoByPath;
                    const isAudio = mime.startsWith("audio/") || type === "song" || isAudioByPath;
                    const isImage = mime.startsWith("image/") || isImageByPath;
                    const version =
                      String(it.manifest?.sha256 || "").trim() ||
                      String(preview?.manifest?.sha256 || "").trim() ||
                      String(it.updatedAt || "").trim() ||
                      String(it.createdAt || "").trim();
                    const remoteAssetOrigin =
                      (participationInfo?.kind === "remote"
                        ? participationInfo.remoteOrigin
                        : null) || asNonEmptyString(it.remoteOrigin) || null;
                    const participantCoverFallback = entry.relation === "participant"
                      ? buildPublicAssetUrl(it.id, "cover", remoteAssetOrigin || apiBase)
                      : null;
                    const remoteCoverFallback = remoteAssetOrigin
                      ? buildPublicAssetUrl(it.id, "cover", remoteAssetOrigin)
                      : null;
                    const localCoverFallback = buildPublicAssetUrl(it.id, "cover", apiBase);
                    const cardAssetOrigin = remoteAssetOrigin;
                    const participantPreviewFallback =
                      entry.relation === "participant"
                        ? buildPublicAssetUrl(
                            it.id,
                            "preview-file",
                            remoteAssetOrigin
                          )
                        : null;
                    const manifestCoverFallback = manifestCoverUrl(it.id, preview, cardAssetOrigin);
                    const candidateFiles = Array.isArray(preview?.files) ? preview.files : [];
                    const preferredPublishedObjectKey = (() => {
                      if (String(it.status || "").toLowerCase() !== "published") return null;
                      if (!candidateFiles.length) return null;
                      if (isVideo) {
                        const hit = candidateFiles.find((f: any) => String(f?.mime || "").toLowerCase().startsWith("video/"));
                        return String(hit?.objectKey || "").trim() || null;
                      }
                      if (isAudio) {
                        const hit = candidateFiles.find((f: any) => String(f?.mime || "").toLowerCase().startsWith("audio/"));
                        return String(hit?.objectKey || "").trim() || null;
                      }
                      return null;
                    })();
                    const preferredPublishedPlaybackUrl =
                      preferredPublishedObjectKey
                        ? `${buildPublicAssetUrl(it.id, "preview-file", cardAssetOrigin)}?objectKey=${encodeURIComponent(
                            preferredPublishedObjectKey
                          )}`
                        : null;
                    const apiPreviewCandidates = Array.isArray(it.libraryPreviewCandidates) ? it.libraryPreviewCandidates : [];
                    const previewPrimaryObjectKey = String(preview?.manifest?.primaryFile || "").trim();
                    const previewPrimaryObjectUrl = previewPrimaryObjectKey
                      ? `${buildPublicAssetUrl(it.id, "preview-file", cardAssetOrigin || apiBase)}?objectKey=${encodeURIComponent(
                          previewPrimaryObjectKey
                        )}`
                      : null;
                    const previewAvObjectKey = (() => {
                      const files = Array.isArray(preview?.files) ? preview.files : [];
                      for (const file of files) {
                        const mime = String(file?.mime || "").toLowerCase();
                        if (!mime.startsWith("video/") && !mime.startsWith("audio/")) continue;
                        const key = String(file?.objectKey || "").trim();
                        if (key) return key;
                      }
                      return null;
                    })();
                    const previewAvObjectUrl = previewAvObjectKey
                      ? `${buildPublicAssetUrl(it.id, "preview-file", cardAssetOrigin || apiBase)}?objectKey=${encodeURIComponent(
                          previewAvObjectKey
                        )}`
                      : null;
                    const genericPreviewFallback = buildPublicAssetUrl(it.id, "preview-file", cardAssetOrigin || apiBase);
                    const rankedPlaybackCandidates = rankLibraryMediaCandidates(apiBase, cardAssetOrigin || apiBase, [
                      ...apiPreviewCandidates,
                      it.manifestPrimaryFileUrl,
                      it.previewFileUrl,
                      it.previewUrl,
                      it.mediaUrl,
                      it.fileUrl,
                      previewPrimaryObjectUrl,
                      previewAvObjectUrl,
                      preferredPublishedPlaybackUrl,
                      previewUrl,
                      participantPreviewFallback,
                      genericPreviewFallback
                    ]);
                    const selectedPlaybackIndex = Math.max(0, Number(previewCandidateIndexById[it.id] || 0));
                    const fallbackPlaybackUrl =
                      rankedPlaybackCandidates[selectedPlaybackIndex] || rankedPlaybackCandidates[0] || null;
                    const lockedPlaybackUrl = lockedPlaybackUrlById[it.id];
                    const effectivePlaybackUrl = isUsableLibraryAssetUrl(lockedPlaybackUrl)
                      ? lockedPlaybackUrl
                      : fallbackPlaybackUrl;
                    const hasPlaybackCandidate = Boolean(effectivePlaybackUrl && isUsableLibraryAssetUrl(effectivePlaybackUrl));
                    const prioritizedParticipantCover = entry.relation === "participant" ? participantCoverFallback : null;
                    const manifestArtworkObjectKey = String(preview?.manifest?.artwork || "").trim();
                    const manifestArtworkFallback = manifestArtworkObjectKey
                      ? `${buildPublicAssetUrl(it.id, "preview-file", cardAssetOrigin || apiBase)}?objectKey=${encodeURIComponent(
                          manifestArtworkObjectKey
                        )}`
                      : null;
                    const songCoverFallback = songCoverUrl(it.id, preview, it.coverUrl || null, cardAssetOrigin || apiBase);
                    const apiCoverCandidates = Array.isArray(it.libraryCoverCandidates) ? it.libraryCoverCandidates : [];
                    const mediaCoverCandidates = [
                      ...apiCoverCandidates,
                      it.manifestCoverUrl,
                      it.coverUrl,
                      it.coverImageUrl,
                      it.artworkUrl,
                      it.thumbnailUrl,
                      it.posterUrl,
                      manifestCoverFallback,
                      manifestArtworkFallback,
                      songCoverFallback,
                      remoteCoverFallback,
                      localCoverFallback,
                      prioritizedParticipantCover,
                      participantCoverFallback
                    ];
                    const rankedCoverCandidates = rankLibraryCoverCandidates(apiBase, cardAssetOrigin || apiBase, mediaCoverCandidates);
                    const selectedCoverIndex = Math.max(0, Number(coverCandidateIndexById[it.id] || 0));
                    const fallbackCoverUrl = rankedCoverCandidates[selectedCoverIndex] || rankedCoverCandidates[0] || null;
                    const lockedCoverUrl = lockedCoverUrlById[it.id];
                    const chosenCoverBaseUrl = isUsableLibraryAssetUrl(lockedCoverUrl) ? lockedCoverUrl : fallbackCoverUrl;
                    const coverUrl = chosenCoverBaseUrl
                      ? `${chosenCoverBaseUrl}${chosenCoverBaseUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`
                      : null;
                    const coverRenderable = Boolean(coverUrl);
                    const isOpen = previewOpenById[it.id] ?? true;
                    const hasInlineImagePreview = Boolean(preview && isOpen && previewUrl && isImage);
                    const hasMediaCard = true;
                    const access = ACCESS_BADGE[(it.libraryAccess || "preview") as NonNullable<LibraryItem["libraryAccess"]>] || ACCESS_BADGE.preview;
                    const entitlement = entitlementByContentId[it.id] || null;
                    const accessModeLabel =
                      entitlement?.accessMode === "stream_and_download"
                        ? "Stream + download"
                        : entitlement?.accessMode === "download_only"
                          ? "Download only"
                        : entitlement?.accessMode === "stream_only"
                          ? "Stream only"
                          : null;
                    const derivativeApproval = derivativeApprovalByChildId[it.id] || null;
                    const splitSummary = ownedSplitSummaryByContentId[it.id] || null;
                    const attribution = attributionByContentId[it.id] || null;
                    const contributors = Array.isArray(attribution?.contributors)
                      ? attribution.contributors.filter((row) => Number.isFinite(Number(row?.bps)) && Number(row?.bps) > 0)
                      : [];
                    const splitState =
                      entry.relation === "owner"
                        ? deriveSplitStateFromLatestVersion({
                            latestVersionStatus: splitSummary?.status || null,
                            participantCount: splitSummary?.participantCount ?? null
                          })
                        : entry.relation === "participant"
                          ? "shared"
                          : "unknown";
                    const mySplitBps =
                      Number.isFinite(Number(participationInfo?.participantBps))
                        ? Number(participationInfo?.participantBps)
                        : Number.isFinite(Number(participationInfo?.participantPercent))
                          ? Math.round(Number(participationInfo?.participantPercent) * 100)
                          : null;
                    const rightsSummary = buildLibraryRightsSummary({
                      isOwner: entry.relation === "owner",
                      isCollaboration: entry.relation === "participant" && !derivativeLinked,
                      isDerivative: derivativeLinked,
                      contentStatus: it.status,
                      storefrontStatus: it.storefrontStatus,
                      priceSats: it.priceSats,
                      splitState,
                      participantCount:
                        splitSummary?.participantCount ??
                        (entry.relation === "participant" ? 2 : null),
                      myRole: participationInfo?.participantRole || null,
                      mySplitBps,
                      derivative: derivativeLinked
                        ? {
                            parentContentId: derivativeApproval?.parentContentId || participationInfo?.derivativeContext?.parentContentId || null,
                            parentTitle: derivativeApproval?.parentTitle || null,
                            status: derivativeApproval?.status || null,
                            approvedApprovers: derivativeApproval?.approvedApprovers ?? null,
                            requiredApprovers: derivativeApproval?.approverCount ?? null,
                            approvedWeightBps: derivativeApproval?.approveWeightBps ?? null,
                            approvalBpsTarget: derivativeApproval?.approvalBpsTarget ?? null
                          }
                        : null
                    });
                    const hasPublicPage = entry.availabilityState === "active" && Boolean(entry.publicPageUrl);
                    const rightsBadgeLabel =
                      derivativeParentOnly
                        ? "Parent of derivative"
                        : rightsSummary.ownershipKind === "owned"
                        ? "Owned work"
                        : rightsSummary.ownershipKind === "collaboration"
                          ? "Collaboration"
                          : rightsSummary.ownershipKind === "derivative"
                            ? "Derivative"
                            : "Unknown";
                    const rightsBadgeClass =
                      rightsSummary.ownershipKind === "owned"
                        ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-300"
                        : rightsSummary.ownershipKind === "collaboration"
                          ? "border-fuchsia-600/40 bg-fuchsia-500/10 text-fuchsia-300"
                          : rightsSummary.ownershipKind === "derivative"
                            ? "border-amber-600/40 bg-amber-500/10 text-amber-200"
                            : "border-neutral-700 bg-neutral-700/20 text-neutral-300";
                    return (
                      <div key={it.id} className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-3 flex flex-col gap-2.5">
                        {hasMediaCard ? (
                          <div className="w-full aspect-[4/3] rounded-md border border-neutral-800 bg-neutral-950/60 overflow-hidden flex items-center justify-center">
                            {coverRenderable ? (
                              <img
                                className="w-full h-full object-cover object-center bg-black"
                                src={coverUrl || undefined}
                                alt={`${it.title || "Content"} cover`}
                                loading="lazy"
                                onLoad={() => {
                                  if (!chosenCoverBaseUrl) return;
                                  setLockedCoverUrlById((prev) => {
                                    const existing = String(prev[it.id] || "").trim();
                                    if (!existing) return { ...prev, [it.id]: chosenCoverBaseUrl };
                                    const existingScore = scoreLibraryAssetUrl(apiBase, existing, cardAssetOrigin || apiBase);
                                    const incomingScore = scoreLibraryAssetUrl(
                                      apiBase,
                                      chosenCoverBaseUrl,
                                      cardAssetOrigin || apiBase
                                    );
                                    if (incomingScore >= existingScore) return { ...prev, [it.id]: chosenCoverBaseUrl };
                                    return prev;
                                  });
                                }}
                                onError={() => {
                                  setLockedCoverUrlById((prev) => {
                                    const existing = String(prev[it.id] || "").trim();
                                    if (!existing) return prev;
                                    return { ...prev, [it.id]: null };
                                  });
                                  setCoverCandidateIndexById((prev) => {
                                    const current = Math.max(0, Number(prev[it.id] || 0));
                                    const next = Math.min(current + 1, Math.max(0, rankedCoverCandidates.length - 1));
                                    if (next === current && rankedCoverCandidates.length <= 1) return prev;
                                    return { ...prev, [it.id]: next };
                                  });
                                }}
                              />
                            ) : hasInlineImagePreview ? (
                              <img
                                className="w-full h-full object-cover object-center bg-black"
                                src={previewUrl as string}
                                alt={it.title || "Preview"}
                              />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-neutral-900 via-neutral-950 to-black flex items-end">
                                <div className="w-full px-3 py-2 border-t border-neutral-800/80 bg-black/45">
                                  <div className="text-[11px] uppercase tracking-wide text-neutral-400">
                                    {String(it.type || "content")}
                                  </div>
                                  <div className="text-sm font-medium text-neutral-200 truncate">{it.title || "Untitled"}</div>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : null}
                        <div>
                          <div className="text-sm font-medium">{it.title || "Content"}</div>
                          <div className="mt-1 text-xs text-neutral-500">
                            {String(it.type || "").toUpperCase()} · {it.status?.toUpperCase?.() || "STATUS"}
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${access.cls}`}>
                              {access.label}
                            </span>
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${rightsBadgeClass}`}>
                              {rightsBadgeLabel}
                            </span>
                            <span className="text-[11px] text-neutral-500">Created {formatDateLabel(it.createdAt)}</span>
                          </div>
                          {it.owner?.displayName || it.owner?.email ? (
                            <div className="text-[11px] text-neutral-500 mt-1">
                              Owner: {it.owner?.displayName || it.owner?.email}
                            </div>
                          ) : null}
                          <div className="mt-1 text-[11px] text-neutral-500">
                            Relationship: {relationshipDisplayLabel(entry, libraryRelationshipFilter)}
                          </div>
                          <div className="mt-1 text-[11px] text-neutral-400">
                            {entry.isDerivativeChild ? "Upstream royalty" : splitSummaryLabel(rightsSummary)}
                          </div>
                          {contributors.length > 0 ? (
                            <div className="mt-1 rounded-md border border-neutral-800/80 bg-neutral-950/40 p-2">
                              <div className="text-[11px] font-medium text-neutral-300">Attribution split</div>
                              <ul className="mt-1 space-y-1 text-[11px] text-neutral-400">
                                {contributors.map((row, idx) => (
                                  <li key={`${it.id}:attribution:${idx}`}>
                                    <span className="text-neutral-200">{row.displayName || "Contributor"}</span>
                                    {row.handle ? <span className="text-neutral-500"> ({row.handle})</span> : null}
                                    {row.role ? <span className="text-neutral-500"> • {row.role}</span> : null}
                                    <span className="text-neutral-300"> • {toPercentLabel(row.bps)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {rightsSummary.myRole ? (
                            <div className="text-[11px] text-neutral-400">
                              My role: {rightsSummary.myRole}
                              {Number.isFinite(Number(rightsSummary.mySplitBps))
                                ? ` • ${(Number(rightsSummary.mySplitBps) / 100).toFixed(2)}%`
                                : ""}
                            </div>
                          ) : null}
                          <div className="mt-1 text-[11px] text-neutral-300">
                            Readiness: {readinessLabel(rightsSummary.commercialReadiness)}
                          </div>
                          {rightsSummary.ownershipKind === "derivative" && rightsSummary.derivative ? (
                            <div className="mt-1 space-y-1 text-[11px] text-neutral-400">
                              <div>
                                Source: {rightsSummary.derivative.parentTitle || rightsSummary.derivative.parentContentId || "Unknown parent"}
                              </div>
                              <div>Clearance: {clearanceStatusLabel(rightsSummary.derivative.clearanceStatus)}</div>
                              <div>
                                Rights holders approved: {Number(rightsSummary.derivative.approvedApprovers || 0)} of{" "}
                                {Number(rightsSummary.derivative.requiredApprovers || 0)}
                              </div>
                              <div>
                                Progress: {Number(rightsSummary.derivative.approvedWeightBps || 0)}/
                                {Number(rightsSummary.derivative.approvalBpsTarget || 6667)} bps
                              </div>
                              {rightsSummary.commercialReadiness === "awaiting_clearance" ? (
                                <>
                                  <div>Network publish: Awaiting clearance</div>
                                  <div>Public discovery: Awaiting clearance</div>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                          {entitlement ? (
                            <div className="mt-1 text-[11px] text-neutral-500">
                              Unlocked: {formatDateLabel(entitlement.unlockedAt || entitlement.grantedAt)}
                              {accessModeLabel ? ` · ${accessModeLabel}` : ""}
                            </div>
                          ) : null}
                          {currentlyFeatured ? (
                            <div className="mt-1 text-[11px] text-sky-300">FEATURED ON PROFILE</div>
                          ) : null}
                        </div>

                        <div className="rounded-md border border-neutral-800 bg-neutral-950/60 p-2">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold text-neutral-100">
                              {entry.relation === "participant" ? "Actions" : "Player"}
                            </div>
                            <button
                              type="button"
                              className="text-[11px] rounded border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                              onClick={() => setPreviewOpenById((m) => ({ ...m, [it.id]: !isOpen }))}
                            >
                              {isOpen ? "Hide" : "Show"}
                            </button>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            {hasPublicPage ? (
                              <a
                                className="text-xs rounded border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                href={entry.publicPageUrl || undefined}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open public page
                              </a>
                            ) : null}
                            <button
                              type="button"
                              disabled={featureBusyById[it.id] || !featureAllowed}
                              className={`text-xs rounded border px-2 py-1 ${
                                featureAllowed
                                  ? "border-neutral-800 hover:bg-neutral-900"
                                  : "border-neutral-900 text-neutral-600 cursor-not-allowed"
                              }`}
                              onClick={() => setFeatureOnProfile(entry, !currentlyFeatured)}
                              title={featureAllowed ? "" : "Only owned or accepted split participation content can be featured."}
                            >
                              {featureBusyById[it.id]
                                ? "Updating…"
                                : currentlyFeatured
                                  ? "Unfeature on profile"
                                  : "Feature on profile"}
                            </button>
                          </div>
                          {featureMsgById[it.id] ? (
                            <div className="mt-2 text-xs text-amber-300">{featureMsgById[it.id]}</div>
                          ) : null}
                          {previewError[it.id] ? (
                            <div className="mt-2 text-xs text-amber-300 space-y-2">
                              <div>{previewError[it.id]}</div>
                              {isForbiddenPreviewError(previewError[it.id]) && hasPublicPage ? (
                                <a
                                  className="inline-flex rounded border border-neutral-800 px-2 py-1 text-xs text-emerald-300 hover:bg-neutral-900"
                                  href={entry.publicPageUrl || undefined}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open public page
                                </a>
                              ) : null}
                            </div>
                          ) : null}
                          {isOpen ? (
                            <div className="mt-2">
                              {(() => {
                                if (effectivePlaybackUrl && isVideo) {
                                  return (
                                    <div className="w-full aspect-[4/3] rounded-md border border-neutral-800 bg-black overflow-hidden">
                                      <video
                                        className="w-full h-full object-cover object-center bg-black"
                                        controls
                                        src={effectivePlaybackUrl}
                                        onLoadedData={() => {
                                          setLockedPlaybackUrlById((prev) => {
                                            const existing = String(prev[it.id] || "").trim();
                                            if (!existing) return { ...prev, [it.id]: effectivePlaybackUrl };
                                            const existingScore = scoreLibraryAssetUrl(apiBase, existing, cardAssetOrigin || apiBase);
                                            const incomingScore = scoreLibraryAssetUrl(
                                              apiBase,
                                              effectivePlaybackUrl,
                                              cardAssetOrigin || apiBase
                                            );
                                            if (incomingScore >= existingScore) return { ...prev, [it.id]: effectivePlaybackUrl };
                                            return prev;
                                          });
                                        }}
                                        onError={() => {
                                          setLockedPlaybackUrlById((prev) => {
                                            const existing = String(prev[it.id] || "").trim();
                                            if (!existing) return prev;
                                            return { ...prev, [it.id]: null };
                                          });
                                          setPreviewCandidateIndexById((prev) => {
                                            const current = Math.max(0, Number(prev[it.id] || 0));
                                            const next = Math.min(
                                              current + 1,
                                              Math.max(0, rankedPlaybackCandidates.length - 1)
                                            );
                                            if (next === current && rankedPlaybackCandidates.length <= 1) return prev;
                                            return { ...prev, [it.id]: next };
                                          });
                                        }}
                                      />
                                    </div>
                                  );
                                }
                                if (effectivePlaybackUrl && !isAudio && !isImage && hasPlaybackCandidate) {
                                  // For remote shadow rows, mime/type hints can be absent; try video playback first.
                                  return (
                                    <div className="w-full aspect-[4/3] rounded-md border border-neutral-800 bg-black overflow-hidden">
                                      <video
                                        className="w-full h-full object-cover object-center bg-black"
                                        controls
                                        src={effectivePlaybackUrl}
                                      />
                                    </div>
                                  );
                                }
                                if (effectivePlaybackUrl && isAudio) {
                                  return (
                                    <div className="w-full rounded-md border border-neutral-800 bg-black/60 p-2">
                                      <audio
                                        className="w-full"
                                        controls
                                        src={effectivePlaybackUrl}
                                        onCanPlay={() => {
                                          setLockedPlaybackUrlById((prev) => {
                                            const existing = String(prev[it.id] || "").trim();
                                            if (!existing) return { ...prev, [it.id]: effectivePlaybackUrl };
                                            const existingScore = scoreLibraryAssetUrl(apiBase, existing, cardAssetOrigin || apiBase);
                                            const incomingScore = scoreLibraryAssetUrl(
                                              apiBase,
                                              effectivePlaybackUrl,
                                              cardAssetOrigin || apiBase
                                            );
                                            if (incomingScore >= existingScore) return { ...prev, [it.id]: effectivePlaybackUrl };
                                            return prev;
                                          });
                                        }}
                                        onError={() => {
                                          setLockedPlaybackUrlById((prev) => {
                                            const existing = String(prev[it.id] || "").trim();
                                            if (!existing) return prev;
                                            return { ...prev, [it.id]: null };
                                          });
                                          setPreviewCandidateIndexById((prev) => {
                                            const current = Math.max(0, Number(prev[it.id] || 0));
                                            const next = Math.min(
                                              current + 1,
                                              Math.max(0, rankedPlaybackCandidates.length - 1)
                                            );
                                            if (next === current && rankedPlaybackCandidates.length <= 1) return prev;
                                            return { ...prev, [it.id]: next };
                                          });
                                        }}
                                      />
                                    </div>
                                  );
                                }
                                if (effectivePlaybackUrl && (isImage || looksLikeImageAssetUrl(effectivePlaybackUrl))) {
                                  return (
                                    <div className="w-full aspect-[4/3] rounded-md border border-neutral-800 bg-black overflow-hidden flex items-center justify-center">
                                      <img
                                        className="w-full h-full object-cover object-center bg-black"
                                        src={effectivePlaybackUrl}
                                        alt={it.title || "Preview"}
                                        onLoad={() => {
                                          setLockedPlaybackUrlById((prev) => {
                                            const existing = String(prev[it.id] || "").trim();
                                            if (!existing) return { ...prev, [it.id]: effectivePlaybackUrl };
                                            const existingScore = scoreLibraryAssetUrl(apiBase, existing, cardAssetOrigin || apiBase);
                                            const incomingScore = scoreLibraryAssetUrl(
                                              apiBase,
                                              effectivePlaybackUrl,
                                              cardAssetOrigin || apiBase
                                            );
                                            if (incomingScore >= existingScore) return { ...prev, [it.id]: effectivePlaybackUrl };
                                            return prev;
                                          });
                                        }}
                                        onError={() => {
                                          setLockedPlaybackUrlById((prev) => {
                                            const existing = String(prev[it.id] || "").trim();
                                            if (!existing) return prev;
                                            return { ...prev, [it.id]: null };
                                          });
                                          setPreviewCandidateIndexById((prev) => {
                                            const current = Math.max(0, Number(prev[it.id] || 0));
                                            const next = Math.min(
                                              current + 1,
                                              Math.max(0, rankedPlaybackCandidates.length - 1)
                                            );
                                            if (next === current && rankedPlaybackCandidates.length <= 1) return prev;
                                            return { ...prev, [it.id]: next };
                                          });
                                        }}
                                      />
                                    </div>
                                  );
                                }
                                return <div className="text-xs text-neutral-500">No preview available.</div>;
                              })()}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="pt-2 border-t border-neutral-900">
        <AuditPanel scopeType="library" title="Audit & tools" exportName="library-audit.json" />
      </div>
    </div>
  );
}
