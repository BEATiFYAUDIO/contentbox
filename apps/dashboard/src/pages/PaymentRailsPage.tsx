import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Rail = {
  id: string;
  type: string;
  label: string;
  status: string;
  endpoint: string | null;
  details: string | null;
  hint?: string | null;
  lastCheckedAt: string;
};

type PaymentRailsPageProps = {
  refreshSignal?: number;
};

const SHOW_LNURL = (import.meta as any).env?.VITE_SHOW_LNURL_RAILS === "1";

export default function PaymentRailsPage({ refreshSignal }: PaymentRailsPageProps) {
  const [rails, setRails] = useState<Rail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api<Rail[]>("/finance/payment-rails");
        if (!active) return;
        setRails(res);
      } catch (e: any) {
        if (!active) return;
        setError(e.message || "Failed to load payment rails.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshSignal, retryTick]);

  const visibleRails = rails.filter((r) => (r.type === "lnurl" ? SHOW_LNURL : true));

  function statusTone(status: string) {
    if (status === "healthy") return "border-emerald-500/40 text-emerald-300";
    if (status === "locked") return "border-amber-500/40 text-amber-300";
    if (status === "degraded") return "border-amber-500/40 text-amber-300";
    return "border-red-500/40 text-red-300";
  }

  if (loading) return <div className="text-sm text-neutral-400">Loading payment rails…</div>;
  if (error) {
    return (
      <div className="rounded-lg border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 flex items-center justify-between">
        <span>Couldn’t load payment rails. {error}</span>
        <button
          onClick={() => setRetryTick((t) => t + 1)}
          className="rounded-lg border border-amber-700 px-2 py-1 text-xs hover:bg-amber-900/30"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="text-base font-semibold">Buyer Intake Rails</div>
        <div className="text-sm text-neutral-400 mt-1">
          These rails control how revenue enters the system. Configure locally and keep them bound to localhost.
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {visibleRails.map((r) => (
          <div key={r.id} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{r.label}</div>
              <span
                className={["text-xs px-2 py-1 rounded-full border", statusTone(r.status)].join(" ")}
              >
                {r.status}
              </span>
            </div>
            <div className="mt-2 text-xs text-neutral-400">Endpoint</div>
            <div className="text-sm text-neutral-200 break-all">{r.endpoint || "Not configured"}</div>
            <div className="mt-2 text-xs text-neutral-400">Health</div>
            <div className="text-sm text-neutral-300">{r.details || "—"}</div>
            {r.hint ? <div className="mt-2 text-xs text-neutral-500">Hint: {r.hint}</div> : null}
            <div className="mt-2 text-xs text-neutral-500">Last checked: {new Date(r.lastCheckedAt).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <details className="text-xs text-neutral-500">
        <summary className="cursor-pointer select-none">More rails</summary>
        <div className="mt-2">Stripe/PayPal/LNURL-Pay are hidden behind feature flags. Enable when needed.</div>
      </details>
    </div>
  );
}
