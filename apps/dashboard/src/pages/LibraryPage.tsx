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

type LibraryItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  archivedAt?: string | null;
  trashedAt?: string | null;
  deletedAt?: string | null;
  tombstonedAt?: string | null;
  storefrontStatus?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  ownerUserId?: string | null;
  owner?: { displayName?: string | null; email?: string | null } | null;
  libraryAccess?: "owned" | "purchased" | "preview" | "local" | "participant";
  coverUrl?: string | null;
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
  creatorUserId: string | null;
  creatorDisplayName: string | null;
  creatorEmail: string | null;
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
  contentType: LibraryTypeFilter;
  relationshipType: LibraryRelationshipType;
  relationshipTags: LibraryRelationshipFilter[];
  availabilityState: ReturnType<typeof getAvailabilityState>;
  relation: LibraryRelation;
  publicPageUrl: string | null;
  participation: LibraryParticipation | null;
};

const ACCESS_BADGE: Record<NonNullable<LibraryItem["libraryAccess"]>, { label: string; cls: string }> = {
  owned: { label: "Owned", cls: "border-emerald-600/40 bg-emerald-500/10 text-emerald-300" },
  purchased: { label: "Purchased", cls: "border-sky-600/40 bg-sky-500/10 text-sky-300" },
  preview: { label: "Preview only", cls: "border-amber-600/40 bg-amber-500/10 text-amber-300" },
  local: { label: "Local", cls: "border-neutral-700 bg-neutral-700/20 text-neutral-300" },
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
  if (String(inviteStatus || "").trim().toLowerCase() === "accepted") return "published";
  return "draft";
}

function applyLibraryFilters(
  items: NormalizedLibraryItem[],
  typeFilter: LibraryTypeFilter,
  relationshipFilter: LibraryRelationshipFilter
): NormalizedLibraryItem[] {
  return items.filter((entry) => {
    const typeMatch = typeFilter === "all" || entry.contentType === typeFilter;
    const relationMatch =
      relationshipFilter === "all" ||
      entry.relationshipTags.includes(relationshipFilter);
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
  const [featureBusyById, setFeatureBusyById] = React.useState<Record<string, boolean>>({});
  const [featureMsgById, setFeatureMsgById] = React.useState<Record<string, string>>({});
  const [msg, setMsg] = React.useState<string | null>(null);
  const [libraryTypeFilter, setLibraryTypeFilter] = React.useState<LibraryTypeFilter>(() => readLibraryTypeFromUrl());
  const [libraryRelationshipFilter, setLibraryRelationshipFilter] = React.useState<LibraryRelationshipFilter>(() => readLibraryRelationshipFromUrl());
  const [previewById, setPreviewById] = React.useState<Record<string, any | null>>({});
  const [previewLoading, setPreviewLoading] = React.useState<Record<string, boolean>>({});
  const [previewError, setPreviewError] = React.useState<Record<string, string>>({});
  const [previewOpenById, setPreviewOpenById] = React.useState<Record<string, boolean>>({});
  const [coverLoadErrorById, setCoverLoadErrorById] = React.useState<Record<string, boolean>>({});
  const [entitlementByContentId, setEntitlementByContentId] = React.useState<Record<string, EntitlementInventoryRow>>({});
  const autoLoadedRef = React.useRef(false);

  React.useEffect(() => {
    (async () => {
      try {
        const normalize = (list: LibraryItem[]) =>
          (list || []).map((i) => ({
            ...i,
            libraryAccess: i.libraryAccess || (i.ownerUserId ? "owned" : "preview")
          }));
        const [lib, mine, localParticipationsRes, remoteParticipationsRes, royaltiesRes, entitlementsRes] = await Promise.all([
          api<LibraryItem[]>(`/content?scope=library`, "GET").catch(() => []),
          api<LibraryItem[]>(`/content?scope=mine`, "GET").catch(() => []),
          api<{ items: LibraryParticipation[] }>("/my/participations", "GET").catch(() => ({ items: [] as LibraryParticipation[] })),
          api<RemoteRoyaltyParticipation[]>("/my/royalties/remote", "GET").catch(() => [] as RemoteRoyaltyParticipation[]),
          api<{ upstreamIncome?: Array<{ parentContentId?: string | null; childContentId?: string | null }> }>("/my/royalties", "GET").catch(() => null),
          api<EntitlementInventoryRow[]>("/me/entitlements", "GET").catch(() => [] as EntitlementInventoryRow[])
        ]);
        const nextEntitlementByContentId: Record<string, EntitlementInventoryRow> = {};
        for (const row of Array.isArray(entitlementsRes) ? entitlementsRes : []) {
          const contentId = String(row?.contentId || "").trim();
          if (!contentId) continue;
          nextEntitlementByContentId[contentId] = row;
        }
        setEntitlementByContentId(nextEntitlementByContentId);
        const derivativeLinkedContentIds = new Set<string>();
        const upstreamRows = Array.isArray(royaltiesRes?.upstreamIncome) ? royaltiesRes.upstreamIncome : [];
        for (const row of upstreamRows) {
          const childContentId = String(row?.childContentId || "").trim();
          if (childContentId) derivativeLinkedContentIds.add(childContentId);
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
            creatorUserId: row?.creatorUserId || null,
            creatorDisplayName: row?.creatorDisplayName || null,
          creatorEmail: row?.creatorEmail || null
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
          .map((row) => ({
            kind: "remote",
            contentId: String(row.contentId || "").trim(),
            contentTitle: row.contentTitle || null,
            contentType: row.contentType || null,
            contentStatus: normalizeRemoteParticipationContentStatus(row.contentStatus, row.status),
            contentDeletedAt: row.contentDeletedAt || null,
            splitParticipantId: null,
            remoteInviteId: String(row.id || "").trim() || null,
            remoteOrigin: String(row.remoteOrigin || "").replace(/\/+$/, "") || null,
            status: row.status || null,
            acceptedAt: row.acceptedAt || null,
            verifiedAt: null,
            revokedAt: row.revokedAt || null,
            tombstonedAt: row.tombstonedAt || null,
            highlightedOnProfile: Boolean(row.highlightedOnProfile),
            creatorUserId: null,
            creatorDisplayName: null,
            creatorEmail: null
          }));
        const remoteDerivativeParticipations: LibraryParticipation[] = remoteParticipationsRaw
          .filter((row) => String(row?.status || "").toLowerCase() === "accepted")
          .flatMap((row) => {
            const inviteId = String(row?.id || "").trim() || null;
            const defaultOrigin = String(row?.remoteOrigin || "").replace(/\/+$/, "") || null;
            const inbox = Array.isArray(row?.clearanceInbox) ? row.clearanceInbox : [];
            return inbox
              .filter((entry) => {
                const status = String(entry?.status || "").toLowerCase();
                // Status labels can vary across mirrored nodes; only exclude terminal-denied states.
                return status !== "rejected" && status !== "revoked";
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
                  contentStatus: "published",
                  contentDeletedAt: null,
                  splitParticipantId: null,
                  remoteInviteId: inviteId,
                  remoteOrigin: String(entry?.childOrigin || "").replace(/\/+$/, "") || defaultOrigin,
                  status: row?.status || "accepted",
                  acceptedAt: row?.acceptedAt || null,
                  verifiedAt: null,
                  revokedAt: row?.revokedAt || null,
                  tombstonedAt: row?.tombstonedAt || null,
                  highlightedOnProfile: Boolean(row?.highlightedOnProfile),
                  creatorUserId: null,
                  creatorDisplayName: null,
                  creatorEmail: null
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
              contentDeletedAt: null,
              splitParticipantId: null,
              remoteInviteId: remoteInviteMeta?.remoteInviteId || null,
              remoteOrigin: origin,
              status: "accepted",
              acceptedAt: null,
              verifiedAt: null,
              revokedAt: null,
              tombstonedAt: null,
              highlightedOnProfile: Boolean(remoteInviteMeta?.highlightedOnProfile),
              creatorUserId: null,
              creatorDisplayName: null,
              creatorEmail: null
            } satisfies LibraryParticipation;
          });

        for (const p of [...localParticipations, ...remoteParticipations, ...remoteDerivativeParticipations, ...upstreamDerivativeParticipations]) {
          const contentId = String(p?.contentId || "").trim();
          if (!contentId) continue;
          const existing = participationByContentId.get(contentId);
          if (!existing || p.kind === "local") participationByContentId.set(contentId, p);
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
            libraryAccess: "participant"
          }));
        const combined = [...baseList, ...participationOnlyItems];
        const normalized: NormalizedLibraryItem[] = [];
        for (const item of combined) {
          const contentId = String(item.id || "").trim();
          const participation = participationByContentId.get(contentId) || null;
          const relation: LibraryRelation =
            item.libraryAccess === "owned"
              ? "owner"
              : item.libraryAccess === "purchased"
                ? "buyer"
                : item.libraryAccess === "participant"
                  ? "participant"
                  : item.libraryAccess === "preview"
                    ? "preview"
                    : "unknown";
          const activeVisibility = isActiveLibraryVisible(item, relation, participation);
          const entitlementVisibility = isEntitlementHistoryVisible(item, relation, participation);
          const decision = classifyLibraryEligibility({
            item,
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
          if (!decision.included) continue;
          const section = decision.section as Exclude<LibrarySection, "excluded">;
          const normalizedItem: LibraryItem = {
            ...item,
            libraryAccess: section
          };
          const contentType = mapContentType(normalizedItem.type);
          const derivativeByType = ["derivative", "remix", "mashup"].includes(String(normalizedItem.type || "").toLowerCase());
          const derivativeLinked = derivativeByType || derivativeLinkedContentIds.has(contentId);
          const relationshipTags: LibraryRelationshipFilter[] = [];
          if (section === "owned") relationshipTags.push("authored_work");
          if (section === "participant") relationshipTags.push("shared_splits");
          if (derivativeLinked) relationshipTags.push("derivatives");
          const relationshipType: LibraryRelationshipType = relationshipTags.includes("derivatives")
            ? "derivatives"
            : relationshipTags.includes("shared_splits")
              ? "shared_splits"
              : relationshipTags.includes("authored_work")
                ? "authored_work"
                : "other";
          normalized.push({
            item: normalizedItem,
            contentType,
            relationshipType,
            relationshipTags: relationshipTags.length ? relationshipTags : ["all"],
            availabilityState: getAvailabilityState(normalizedItem),
            relation,
            publicPageUrl: buildPublicPageUrl(contentId, participation?.remoteOrigin || null),
            participation
          });
        }
        setParticipationByContentId(nextParticipationByContentId);
        setItems(applyLibraryFilters(normalized, libraryTypeFilter, libraryRelationshipFilter));
      } catch (e: any) {
        const err = String(e?.message || "Failed to load library");
        setMsg(err.includes("INVALID_TYPE") ? "Invalid type filter." : err);
      }
    })();
  }, [libraryTypeFilter, libraryRelationshipFilter]);

  React.useEffect(() => {
    const onPopState = () => {
      setLibraryTypeFilter(readLibraryTypeFromUrl());
      setLibraryRelationshipFilter(readLibraryRelationshipFromUrl());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  React.useEffect(() => {
    if (!items.length || autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    const limit = 6;
    const toLoad = items.slice(0, limit);
    toLoad.forEach((entry) => {
      const id = entry.item.id;
      if (entry.relation === "participant") return;
      if (!previewById[id] && !previewLoading[id]) {
        loadPreview(id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const groupedEntries = {
    owned: items.filter((e) => e.item.libraryAccess === "owned"),
    purchased: items.filter((e) => e.item.libraryAccess === "purchased"),
    preview: items.filter((e) => e.item.libraryAccess === "preview"),
    participant: items.filter((e) => e.item.libraryAccess === "participant")
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

  function handlePrimaryPreviewAction(entry: NormalizedLibraryItem) {
    void loadPreview(entry.item.id);
  }

  async function setFeatureOnProfile(entry: NormalizedLibraryItem, next: boolean) {
    const contentId = entry.item.id;
    setFeatureBusyById((m) => ({ ...m, [contentId]: true }));
    setFeatureMsgById((m) => ({ ...m, [contentId]: "" }));
    try {
      const participation = entry.participation || participationByContentId[contentId] || null;
      const shouldUseParticipationHighlight =
        Boolean(participation) &&
        (entry.relation === "participant" || participation?.kind === "remote");

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

      if (entry.relation === "owner") {
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

  function renderInlinePreview(previewUrl: string | null | undefined, mimeRaw: string | null | undefined, typeRaw: string | null | undefined) {
    if (!previewUrl) return null;
    const mime = String(mimeRaw || "").toLowerCase();
    const type = String(typeRaw || "").toLowerCase();
    const isVideo = mime.startsWith("video/") || type === "video";
    const isAudio = mime.startsWith("audio/") || type === "song";
    const isImage = mime.startsWith("image/");
    const isPdf = mime === "application/pdf";
    const isTextLike =
      mime.startsWith("text/") ||
      mime === "application/json" ||
      mime === "application/xml" ||
      mime === "application/javascript";

    if (isVideo) return <video className="w-full rounded-md" controls src={previewUrl} />;
    if (isAudio) return <audio className="w-full" controls src={previewUrl} />;
    if (isImage) {
      return (
        <img
          className="w-full rounded-md object-contain bg-neutral-950 max-h-[28rem]"
          src={previewUrl}
          alt="Preview"
          loading="lazy"
        />
      );
    }
    if (isPdf || isTextLike) {
      return (
        <iframe
          className="w-full min-h-[28rem] rounded-md border border-neutral-800 bg-neutral-950"
          src={previewUrl}
          title="Preview"
        />
      );
    }
    return (
      <iframe
        className="w-full min-h-[22rem] rounded-md border border-neutral-800 bg-neutral-950"
        src={previewUrl}
        title="Preview"
      />
    );
  }

function formatDateLabel(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function normalizeAssetUrl(apiBase: string, raw: string | null | undefined): string | null {
  const source = String(raw || "").trim();
  if (!source) return null;
  try {
    const asUrl = new URL(source, apiBase);
    const pathAndQuery = `${asUrl.pathname}${asUrl.search}`;
    return `${apiBase.replace(/\/$/, "")}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;
  } catch {
    return `${apiBase.replace(/\/$/, "")}/${source.replace(/^\/+/, "")}`;
  }
}

function isForbiddenPreviewError(message?: string | null): boolean {
  const text = String(message || "").toLowerCase();
  return text.includes("403") || text.includes("forbidden");
}

function buildPublicPageUrl(contentId: string, remoteOrigin?: string | null): string {
  const origin = String(remoteOrigin || "").trim().replace(/\/+$/, "");
  if (origin) return `${origin}/p/${encodeURIComponent(contentId)}`;
  return `/p/${encodeURIComponent(contentId)}`;
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

function songCoverUrl(contentId: string, preview: any, itemCoverUrl?: string | null): string | null {
  const preferred = normalizeAssetUrl(apiBase, String(itemCoverUrl || "").trim());
  if (preferred) return preferred;
  const coverObjectKey = String(preview?.manifest?.cover || "").trim();
  if (!coverObjectKey) return null;
  return `${apiBase.replace(/\/$/, "")}/public/content/${encodeURIComponent(contentId)}/preview-file?objectKey=${encodeURIComponent(coverObjectKey)}`;
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
          {(["owned", "purchased", "preview", "participant"] as const).map((key) => {
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
                    const shouldUseParticipationHighlight =
                      Boolean(participationInfo) &&
                      (entry.relation === "participant" || participationInfo?.kind === "remote");
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
                    }).allowed;
                    const currentlyFeatured = shouldUseParticipationHighlight ? participationFeatured : ownerFeatured;
                    const preview = previewById[it.id];
                    const previewUrl = preview?.previewUrl || null;
                    const pf = previewFileFor(previewUrl, preview?.files || []);
                    const mime = String(pf?.mime || "").toLowerCase();
                    const type = String(it.type || "").toLowerCase();
                    const isVideo = mime.startsWith("video/") || type === "video";
                    const isAudio = mime.startsWith("audio/") || type === "song";
                    const isImage = mime.startsWith("image/");
                    const version =
                      String(it.manifest?.sha256 || "").trim() ||
                      String(preview?.manifest?.sha256 || "").trim() ||
                      String(it.updatedAt || "").trim() ||
                      String(it.createdAt || "").trim();
                    const participantCoverFallback =
                      entry.relation === "participant"
                        ? buildPublicAssetUrl(
                            it.id,
                            "cover",
                            participationInfo?.kind === "remote" ? participationInfo.remoteOrigin : null
                          )
                        : null;
                    const participantVideoPreviewFallback =
                      entry.relation === "participant" && isVideo
                        ? buildPublicAssetUrl(
                            it.id,
                            "preview-file",
                            participationInfo?.kind === "remote" ? participationInfo.remoteOrigin : null
                          )
                        : null;
                    const rawCoverUrl = isAudio
                      ? songCoverUrl(it.id, preview, it.coverUrl || null) || participantCoverFallback
                      : normalizeAssetUrl(apiBase, it.coverUrl || null) || participantCoverFallback;
                    const coverUrl =
                      rawCoverUrl && version
                        ? `${rawCoverUrl}${rawCoverUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`
                        : rawCoverUrl;
                    const isOpen = previewOpenById[it.id] ?? true;
                    const hasInlineImagePreview = Boolean(preview && isOpen && previewUrl && isImage);
                    const hasMediaCard = Boolean(coverUrl || hasInlineImagePreview || participantVideoPreviewFallback);
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
                    return (
                      <div key={it.id} className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-3 flex flex-col gap-2.5">
                        {hasMediaCard ? (
                          <div className="w-full aspect-video rounded-md border border-neutral-800 bg-neutral-950/60 overflow-hidden flex items-center justify-center">
                            {coverUrl ? (
                              <img
                                className="w-full h-full object-cover"
                                src={coverUrl}
                                alt={`${it.title || "Content"} cover`}
                                loading="lazy"
                                onError={(e) => {
                                  setCoverLoadErrorById((m) => ({ ...m, [it.id]: true }));
                                  const el = e.currentTarget;
                                  const parent = el.parentElement;
                                  if (!parent) return;
                                  parent.style.display = "none";
                                }}
                                onLoad={() => setCoverLoadErrorById((m) => ({ ...m, [it.id]: false }))}
                              />
                            ) : hasInlineImagePreview ? (
                              <img className="w-full h-full object-cover" src={previewUrl as string} alt={it.title || "Preview"} />
                            ) : participantVideoPreviewFallback ? (
                              <video
                                className="w-full h-full object-cover"
                                autoPlay
                                muted
                                loop
                                playsInline
                                preload="metadata"
                                src={participantVideoPreviewFallback}
                              />
                            ) : null}
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
                            <span className="text-[11px] text-neutral-500">Created {formatDateLabel(it.createdAt)}</span>
                          </div>
                          {it.owner?.displayName || it.owner?.email ? (
                            <div className="text-[11px] text-neutral-500 mt-1">
                              Owner: {it.owner?.displayName || it.owner?.email}
                            </div>
                          ) : null}
                          <div className="mt-1 text-[11px] text-neutral-500">
                            Relationship: {LIBRARY_RELATIONSHIP_LABEL[entry.relationshipType === "other" ? "all" : entry.relationshipType]}
                          </div>
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

                        {isAudio && coverLoadErrorById[it.id] ? (
                          <div className="text-[11px] text-amber-300">Cover missing on disk or not set in manifest.</div>
                        ) : null}

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
                            <button
                              type="button"
                              className="text-xs rounded border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                              onClick={() => handlePrimaryPreviewAction(entry)}
                            >
                              {previewLoading[it.id] ? "Loading…" : "Load preview"}
                            </button>
                            {entry.relation === "participant" ? (
                              <a
                                className="text-xs rounded border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                href={entry.publicPageUrl || buildPublicPageUrl(it.id)}
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
                            {entitlement?.receiptToken ? (
                              <a
                                href={`/receipt/${encodeURIComponent(entitlement.receiptToken)}`}
                                className="text-xs rounded border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                              >
                                View receipt
                              </a>
                            ) : null}
                          </div>
                          {featureMsgById[it.id] ? (
                            <div className="mt-2 text-xs text-amber-300">{featureMsgById[it.id]}</div>
                          ) : null}
                          {previewError[it.id] ? (
                            <div className="mt-2 text-xs text-amber-300 space-y-2">
                              <div>{previewError[it.id]}</div>
                              {isForbiddenPreviewError(previewError[it.id]) ? (
                                <a
                                  className="inline-flex rounded border border-neutral-800 px-2 py-1 text-xs text-emerald-300 hover:bg-neutral-900"
                                  href={entry.publicPageUrl || buildPublicPageUrl(it.id)}
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
                                const participantPreviewFallback =
                                  entry.relation === "participant"
                                    ? buildPublicAssetUrl(
                                        it.id,
                                        "preview-file",
                                        participationInfo?.kind === "remote" ? participationInfo.remoteOrigin : null
                                      )
                                    : null;
                                const effectivePreviewUrl = previewUrl || participantPreviewFallback;
                                if (effectivePreviewUrl) {
                                  return <div>{renderInlinePreview(effectivePreviewUrl, mime, type)}</div>;
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
