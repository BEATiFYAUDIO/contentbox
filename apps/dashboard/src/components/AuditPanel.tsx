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
  archetype?: string | null;
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
  showTombstoneToggle?: boolean;
  openSignal?: number;
  eventFilter?: "all" | "commerce";
  showFilterToggle?: boolean;
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

function archetypeLabel(raw?: string | null) {
  const v = String(raw || "").trim();
  if (!v) return "";
  return v.replace(/_/g, " ");
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
  exportName,
  showTombstoneToggle = true,
  openSignal = 0,
  eventFilter = "all",
  showFilterToggle = false
}: AuditPanelProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [loading, setLoading] = React.useState(false);
  const [items, setItems] = React.useState<AuditEvent[]>([]);
  const [showTombstones, setShowTombstones] = React.useState(false);
  const [filterMode, setFilterMode] = React.useState<"all" | "commerce">(eventFilter);

  React.useEffect(() => {
    setFilterMode(eventFilter);
  }, [eventFilter]);

  const isCommerceAuditEvent = React.useCallback((evt: AuditEvent) => {
    const t = String(evt?.type || "").toLowerCase();
    if (!t) return false;
    if (t.startsWith("sale.") || t.startsWith("sales.")) return true;
    if (t.startsWith("payment.") || t.startsWith("payments.")) return true;
    if (t.startsWith("invoice.") || t.startsWith("invoices.")) return true;
    if (t.startsWith("settlement.") || t.startsWith("settlements.")) return true;
    if (t.startsWith("payout.") || t.startsWith("payouts.")) return true;
    if (t.startsWith("royalty.") || t.startsWith("royalties.")) return true;
    if (t.startsWith("split.") || t.startsWith("splits.")) return true;
    if (t.startsWith("revenue.")) return true;
    if (t === "content.proof") return true;
    return false;
  }, []);

  const visibleItems = React.useMemo(() => {
    return items
      .filter((e) => (showTombstones ? true : !String(e.type || "").includes("tombstone")))
      .filter((e) => (filterMode === "commerce" ? isCommerceAuditEvent(e) : true));
  }, [items, showTombstones, filterMode, isCommerceAuditEvent]);

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

  React.useEffect(() => {
    if (!openSignal) return;
    setOpen(true);
  }, [openSignal]);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-xs text-neutral-300 font-medium">{title}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {showTombstoneToggle ? (
            <button
              type="button"
              className="rounded-lg border border-neutral-800 px-2 py-1 text-[11px] leading-none hover:bg-neutral-900"
              onClick={() => setShowTombstones((s) => !s)}
            >
              {showTombstones ? "Hide tombstones" : "Show tombstones"}
            </button>
          ) : null}
          {showFilterToggle ? (
            <button
              type="button"
              className="rounded-lg border border-neutral-800 px-2 py-1 text-[11px] leading-none hover:bg-neutral-900"
              onClick={() => setFilterMode((m) => (m === "commerce" ? "all" : "commerce"))}
            >
              {filterMode === "commerce" ? "Full audit" : "Commerce only"}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-lg border border-neutral-800 px-2 py-1 text-[11px] leading-none hover:bg-neutral-900"
            onClick={() => setOpen((s) => !s)}
          >
            {open ? "Hide" : "Show"}
          </button>
          {exportName ? (
            <button
              type="button"
              className="rounded-lg border border-neutral-800 px-2 py-1 text-[11px] leading-none hover:bg-neutral-900"
              onClick={() => downloadJson(exportName, items)}
            >
              Export
            </button>
          ) : null}
          {open ? (
            <button
              type="button"
              className="rounded-lg border border-neutral-800 px-2 py-1 text-[11px] leading-none hover:bg-neutral-900"
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
          ) : visibleItems.length === 0 ? (
            <div className="text-neutral-500">No audit events.</div>
          ) : (
            visibleItems.map((e) => (
              <div key={e.id} className="rounded-md border border-neutral-800 bg-neutral-950 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] text-neutral-400">{formatTs(e.ts)}</div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-sm text-neutral-100 truncate">{e.type}</span>
                      {e.archetype ? (
                        <span className="inline-flex items-center rounded-full border border-neutral-700 bg-neutral-900/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-300">
                          {archetypeLabel(e.archetype)}
                        </span>
                      ) : null}
                    </div>
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
