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

export default function RoyaltiesTermsPage({ contentId }: RoyaltiesTermsPageProps) {
  const [data, setData] = useState<TermsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contentId) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api<TermsResponse>(`/royalties/${contentId}/terms`, "GET");
        setData(res);
      } catch (e: any) {
        const msg = e?.message || "";
        if (msg.includes("403")) {
          setError("You can view terms once you’ve accepted the invite.");
        } else {
          setError("Failed to load split terms.");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [contentId]);

  if (!contentId) {
    return <div className="text-sm text-neutral-400">Missing content id.</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold">Split terms</div>
        <div className="text-sm text-neutral-400 mt-1">Read-only view of split terms.</div>
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
                    {p.participantEmail || "(no email)"} • {p.role || "participant"}
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
    </div>
  );
}
