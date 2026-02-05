import React from "react";

type HistoryActor = {
  kind: "user" | "external" | "system";
  id?: string | null;
  email?: string | null;
  displayName?: string | null;
};

export type HistoryEvent = {
  id: string;
  ts: string;
  category: string;
  type: string;
  title: string;
  summary?: string | null;
  actor?: HistoryActor | null;
  details?: any;
  diff?: any;
};

type HistoryFeedProps = {
  title: string;
  items: HistoryEvent[];
  loading?: boolean;
  emptyText?: string;
  onRefresh?: () => void;
  exportName?: string;
  defaultOpen?: boolean;
};

function formatTs(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "Unknown time";
  return d.toLocaleString();
}

function actorLabel(actor?: HistoryActor | null) {
  if (!actor) return "";
  if (actor.kind === "external") return actor.email ? `external:${actor.email}` : "external";
  if (actor.kind === "system") return "system";
  return actor.displayName || actor.email || actor.id || "user";
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

export default function HistoryFeed({
  title,
  items,
  loading,
  emptyText = "No history yet.",
  onRefresh,
  exportName,
  defaultOpen = false
}: HistoryFeedProps) {
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const [show, setShow] = React.useState<boolean>(defaultOpen);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-neutral-300 font-medium">{title}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
            onClick={() => setShow((s) => !s)}
          >
            {show ? "Hide" : "Show"}
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
          {onRefresh ? (
            <button
              type="button"
              className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
              onClick={() => onRefresh()}
            >
              Refresh
            </button>
          ) : null}
        </div>
      </div>

      {show ? (
        <div className="mt-2 space-y-2 text-xs text-neutral-200">
        {loading ? (
          <div className="text-neutral-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-neutral-500">{emptyText}</div>
        ) : (
          items.map((e) => {
            const isOpen = open[e.id] ?? false;
            return (
              <div key={e.id} className="rounded-md border border-neutral-800 bg-neutral-950 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] text-neutral-400">{formatTs(e.ts)}</div>
                    <div className="text-sm text-neutral-100 truncate">{e.title}</div>
                    {e.summary ? <div className="text-[11px] text-neutral-400">{e.summary}</div> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {actorLabel(e.actor) ? (
                      <div className="text-[11px] text-neutral-500">{actorLabel(e.actor)}</div>
                    ) : null}
                    <button
                      type="button"
                      className="text-[11px] rounded border border-neutral-800 px-2 py-0.5 hover:bg-neutral-900"
                      onClick={() => setOpen((m) => ({ ...m, [e.id]: !isOpen }))}
                    >
                      {isOpen ? "Hide" : "Details"}
                    </button>
                  </div>
                </div>
                {isOpen ? (
                  <div className="mt-2 space-y-2">
                    {e.details ? (
                      <pre className="text-[11px] text-neutral-300 whitespace-pre-wrap break-all">{JSON.stringify(e.details, null, 2)}</pre>
                    ) : null}
                    {e.diff ? (
                      <pre className="text-[11px] text-neutral-300 whitespace-pre-wrap break-all">{JSON.stringify(e.diff, null, 2)}</pre>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
        </div>
      ) : null}
    </div>
  );
}
