import { useEffect, useState } from "react";
import { api } from "../lib/api";

type TermsResponse = {
  content: {
    id: string;
    title: string;
    type: string;
    status: string;
  };
  splitVersion: {
    id: string;
    versionNumber: number;
    status: string;
    lockedAt: string | null;
  };
  participants: Array<{
    participantUserId?: string | null;
    participantDisplayName?: string | null;
    participantEmail: string | null;
    role: string | null;
    percent: any;
    acceptedAt: string | null;
  }>;
  canEdit: boolean;
};

type RoyaltiesTermsPageProps = {
  contentId: string | null;
};

type RoyaltiesContextResponse = {
  works: Array<{
    contentId: string;
    title: string;
    type: string;
    contentStatus?: string | null;
    splitSummary?: Array<{
      participantUserId?: string | null;
      participantEmail?: string | null;
      displayName?: string | null;
      role?: string | null;
      bps?: number | null;
      percent?: any;
      acceptedAt?: string | null;
    }>;
  }>;
};

type RemoteRoyaltyRow = {
  id: string;
  contentId?: string | null;
  contentTitle?: string | null;
  contentType?: string | null;
  role?: string | null;
  percent?: any;
  participantEmail?: string | null;
  acceptedAt?: string | null;
  splitVersionNum?: number | null;
};

type FallbackTerms = {
  source: "local_cache" | "remote_cache";
  content: {
    id: string;
    title: string;
    type: string;
    status: string;
  };
  splitVersionLabel: string;
  participants: TermsResponse["participants"];
};

export default function RoyaltiesTermsPage({ contentId }: RoyaltiesTermsPageProps) {
  const [data, setData] = useState<TermsResponse | null>(null);
  const [fallback, setFallback] = useState<FallbackTerms | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contentId) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setFallback(null);
        const res = await api<TermsResponse>(`/royalties/${contentId}/terms`, "GET");
        setData(res);
      } catch (e: any) {
        const msg = e?.message || "";
        // Fallback for remote/offline authorities: render any locally cached split context.
        try {
          const [localRes, remoteRes] = await Promise.all([
            api<RoyaltiesContextResponse>("/my/royalties", "GET").catch(() => null),
            api<RemoteRoyaltyRow[]>("/my/royalties/remote", "GET").catch(() => [] as RemoteRoyaltyRow[])
          ]);
          const localWorks = Array.isArray(localRes?.works) ? localRes!.works : [];
          const localMatch = localWorks.find((w) => String(w.contentId || "").trim() === contentId);
          if (localMatch && Array.isArray(localMatch.splitSummary) && localMatch.splitSummary.length > 0) {
            setFallback({
              source: "local_cache",
              content: {
                id: String(localMatch.contentId || contentId),
                title: String(localMatch.title || "Untitled"),
                type: String(localMatch.type || "content"),
                status: String(localMatch.contentStatus || "published")
              },
              splitVersionLabel: "cached local terms",
              participants: localMatch.splitSummary.map((s) => ({
                participantUserId: s.participantUserId || null,
                participantDisplayName: s.displayName || null,
                participantEmail: s.participantEmail || null,
                role: s.role || null,
                percent:
                  typeof s.bps === "number" && Number.isFinite(s.bps)
                    ? Number((s.bps / 100).toFixed(2))
                    : s.percent ?? null,
                acceptedAt: s.acceptedAt || null
              }))
            });
            setData(null);
            setError("Primary split authority unavailable. Showing cached local split terms.");
          } else {
            const remoteMatch = (Array.isArray(remoteRes) ? remoteRes : []).find(
              (r) => String(r.contentId || "").trim() === contentId
            );
            if (remoteMatch) {
              setFallback({
                source: "remote_cache",
                content: {
                  id: contentId,
                  title: String(remoteMatch.contentTitle || "Untitled"),
                  type: String(remoteMatch.contentType || "content"),
                  status: "remote"
                },
                splitVersionLabel:
                  typeof remoteMatch.splitVersionNum === "number"
                    ? `remote split v${remoteMatch.splitVersionNum}`
                    : "remote split terms",
                participants: [
                  {
                    participantUserId: null,
                    participantDisplayName: null,
                    participantEmail: remoteMatch.participantEmail || null,
                    role: remoteMatch.role || "participant",
                    percent: remoteMatch.percent ?? null,
                    acceptedAt: remoteMatch.acceptedAt || null
                  }
                ]
              });
              setData(null);
              setError("Primary split authority unavailable. Showing cached remote collaboration terms.");
            } else if (msg.includes("403")) {
              setError("You can view terms once you’ve accepted the invite.");
            } else {
              setError("Failed to load split terms.");
            }
          }
        } catch {
          if (msg.includes("403")) {
            setError("You can view terms once you’ve accepted the invite.");
          } else {
            setError("Failed to load split terms.");
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [contentId]);

  if (!contentId) {
    return <div className="text-sm text-neutral-400">Missing content id.</div>;
  }

  const participantIdentifier = (p: TermsResponse["participants"][number]) => {
    const displayName = String(p.participantDisplayName || "").trim();
    if (displayName) return displayName;
    const email = String(p.participantEmail || "").trim();
    if (email) return email;
    const userId = String(p.participantUserId || "").trim();
    if (userId) return `user:${userId}`;
    return "(unresolved participant)";
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold">Locked split terms</div>
        <div className="text-sm text-neutral-400 mt-1">Read-only split participants and locked share terms.</div>
      </div>

      {loading ? <div className="text-sm text-neutral-400">Loading…</div> : null}
      {error ? <div className="text-sm text-amber-300">{error}</div> : null}

      {!loading && data ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
          <div>
            <div className="text-sm font-medium text-neutral-100">{data.content.title}</div>
            <div className="text-xs text-neutral-400 mt-1">
              {data.content.type?.toUpperCase?.() || "CONTENT"} • {data.content.status}
            </div>
          </div>

          <div className="text-xs text-neutral-400">
            Split version: v{data.splitVersion.versionNumber} • {data.splitVersion.status}
            {data.splitVersion.lockedAt ? ` • locked ${new Date(data.splitVersion.lockedAt).toLocaleString()}` : ""}
          </div>

          <div className="pt-2">
            <div className="text-sm font-medium">Participants</div>
            <div className="mt-2 space-y-2">
              {data.participants.map((p, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm border-b border-neutral-900 pb-2">
                  <div className="text-neutral-200">
                    {participantIdentifier(p)} • {p.role || "participant"}
                  </div>
                  <div className="text-neutral-300">
                    {p.percent != null ? `${Number(p.percent)}%` : "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {!data.canEdit ? (
            <div className="text-xs text-neutral-500">You have read-only access to these terms.</div>
          ) : null}
        </div>
      ) : null}

      {!loading && !data && fallback ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
          <div>
            <div className="text-sm font-medium text-neutral-100">{fallback.content.title}</div>
            <div className="text-xs text-neutral-400 mt-1">
              {fallback.content.type?.toUpperCase?.() || "CONTENT"} • {fallback.content.status}
            </div>
          </div>

          <div className="text-xs text-neutral-400">
            Split version: {fallback.splitVersionLabel}
          </div>

          <div className="pt-2">
            <div className="text-sm font-medium">Participants</div>
            <div className="mt-2 space-y-2">
              {fallback.participants.map((p, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm border-b border-neutral-900 pb-2">
                  <div className="text-neutral-200">
                    {participantIdentifier(p)} • {p.role || "participant"}
                  </div>
                  <div className="text-neutral-300">
                    {p.percent != null ? `${Number(p.percent)}%` : "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-xs text-neutral-500">
            {fallback.source === "local_cache"
              ? "Showing cached split terms from local royalty context."
              : "Showing cached collaboration terms available from remote invite context."}
          </div>
        </div>
      ) : null}
    </div>
  );
}
