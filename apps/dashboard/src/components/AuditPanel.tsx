import React from "react";
import { api } from "../lib/api";

type AuditActor = {
  kind: "user" | "external" | "system";
  userId?: string | null;
  email?: string | null;
  displayName?: string | null;
};

type AuditEvent = {
  id: string;
  ts: string;
  type: string;
  summary?: string | null;
  actor?: AuditActor | null;
  details?: any;
  diff?: any;
};

type AuditResponse = {
  ok: true;
  scopeType: string;
  scopeId?: string | null;
  audit: AuditEvent[];
};

type AuditPanelProps = {
  scopeType: string;
  scopeId?: string | null;
  title?: string;
  defaultOpen?: boolean;
  exportName?: string;
};

function formatTs(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "Unknown time";
  return d.toLocaleString();
}

function actorLabel(actor?: AuditActor | null) {
  if (!actor) return "";
  if (actor.kind === "external") return actor.email ? `external:${actor.email}` : "external";
  if (actor.kind === "system") return "system";
  return actor.displayName || actor.email || actor.userId || "user";
}

function downloadJson(filename: string, data: any) {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    // ignore
  }
}

export default function AuditPanel({
  scopeType,
  scopeId,
  title = "Audit",
  defaultOpen = false,
  exportName
}: AuditPanelProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [loading, setLoading] = React.useState(false);
  const [items, setItems] = React.useState<AuditEvent[]>([]);
  const [showTombstones, setShowTombstones] = React.useState(false);

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("scopeType", scopeType);
      if (scopeId) qs.set("scopeId", scopeId);
      const res = await api<AuditResponse>(`/audit?${qs.toString()}`, "GET");
      setItems(res?.audit || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scopeType, scopeId]);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-neutral-300 font-medium">{title}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
            onClick={() => setShowTombstones((s) => !s)}
          >
            {showTombstones ? "Hide tombstones" : "Show tombstones"}
          </button>
          <button
            type="button"
            className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
            onClick={() => setOpen((s) => !s)}
          >
            {open ? "Hide" : "Show"}
          </button>
          {exportName ? (
            <button
              type="button"
              className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
              onClick={() => downloadJson(exportName, items)}
            >
              Export JSON
            </button>
          ) : null}
          {open ? (
            <button
              type="button"
              className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
              onClick={load}
            >
              Refresh
            </button>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="mt-2 space-y-2 text-xs text-neutral-200">
          {loading ? (
            <div className="text-neutral-400">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-neutral-500">No audit events.</div>
          ) : (
            items
              .filter((e) => (showTombstones ? true : !String(e.type || "").includes("tombstone")))
              .map((e) => (
              <div key={e.id} className="rounded-md border border-neutral-800 bg-neutral-950 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] text-neutral-400">{formatTs(e.ts)}</div>
                    <div className="text-sm text-neutral-100 truncate">{e.type}</div>
                    {e.summary ? <div className="text-[11px] text-neutral-400">{e.summary}</div> : null}
                  </div>
                  {actorLabel(e.actor) ? (
                    <div className="text-[11px] text-neutral-500">{actorLabel(e.actor)}</div>
                  ) : null}
                </div>
                {e.details ? (
                  <pre className="mt-2 text-[11px] text-neutral-300 whitespace-pre-wrap break-all">{JSON.stringify(e.details, null, 2)}</pre>
                ) : null}
                {e.diff ? (
                  <pre className="mt-2 text-[11px] text-neutral-300 whitespace-pre-wrap break-all">{JSON.stringify(e.diff, null, 2)}</pre>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
