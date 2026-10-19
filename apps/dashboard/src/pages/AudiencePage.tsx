import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

type AudienceItem = {
  contentId: string;
  title: string;
  status: string;
  views: number;
  legacyOpens: number;
  purchases: number | null;
  conversionRate: number | null;
};

type AudienceSummary = {
  posture?: "basic" | "sovereign";
  supportsCommerceMetrics?: boolean;
  totalViews: number;
  totalLegacyOpens: number;
  viewWindowDays: number;
  totalPurchases: number | null;
  conversionRate: number | null;
  items: AudienceItem[];
};

function metricCard(label: string, value: string) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-neutral-100">{value}</div>
    </div>
  );
}

export default function AudiencePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AudienceSummary | null>(null);

  const sortedItems = useMemo(() => {
    const rows = [...(summary?.items || [])];
    rows.sort((a, b) => {
      if (b.views !== a.views) return b.views - a.views;
      const bPurchases = Number(b.purchases || 0);
      const aPurchases = Number(a.purchases || 0);
      if (bPurchases !== aPurchases) return bPurchases - aPurchases;
      return a.title.localeCompare(b.title);
    });
    return rows;
  }, [summary]);
  const supportsCommerceMetrics = summary?.supportsCommerceMetrics === true && summary?.posture !== "basic";

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const payload = await api<AudienceSummary>("/audience/summary");
      setSummary(payload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load audience summary.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-neutral-800 bg-neutral-950">
        <header className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div>
            <h2 className="text-2xl font-semibold text-neutral-100">Audience</h2>
            <div className="mt-1 text-sm text-neutral-400">Recorded Buy-page visits and historical activity for your content.</div>
          </div>
          <button
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </header>

        {!supportsCommerceMetrics ? (
          <div className="grid gap-3 px-4 py-4 md:grid-cols-3">
            {metricCard(`Buy-page views (${summary?.viewWindowDays || 395} days)`, String(summary?.totalViews || 0))}
            <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-400 md:col-span-2">
              Legacy recorded opens: {summary?.totalLegacyOpens || 0}. Basic mode does not show commerce metrics.
            </div>
          </div>
        ) : (
          <div className="grid gap-3 px-4 py-4 md:grid-cols-3">
            {metricCard(`Buy-page views (${summary?.viewWindowDays || 395} days)`, String(summary?.totalViews || 0))}
            {metricCard("Legacy recorded opens", String(summary?.totalLegacyOpens || 0))}
            {metricCard("Paid purchase intents (lifetime)", String(summary?.totalPurchases || 0))}
          </div>
        )}
      </section>

      {supportsCommerceMetrics && (
        <p className="px-1 text-xs text-neutral-400">Conversion is unavailable: recorded visits and purchases cannot yet be linked to the same visitor cohort. Legacy opens use a different counting definition.</p>
      )}

      <section className="rounded-xl border border-neutral-800 bg-neutral-950">
        <header className="border-b border-neutral-800 px-4 py-3">
          <h3 className="text-lg font-semibold text-neutral-100">Per Content</h3>
        </header>

        {error ? (
          <div className="px-4 py-6 text-sm text-rose-300">{error}</div>
        ) : loading ? (
          <div className="px-4 py-6 text-sm text-neutral-400">Loading audience data...</div>
        ) : sortedItems.length === 0 ? (
          <div className="px-4 py-6 text-sm text-neutral-400">No owned content yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Content</th>
                  <th className="px-4 py-3 font-medium">Buy-page views</th>
                  <th className="px-4 py-3 font-medium">Legacy opens</th>
                  {supportsCommerceMetrics && <th className="px-4 py-3 font-medium">Purchases</th>}
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((row) => (
                  <tr key={row.contentId} className="border-t border-neutral-800">
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-100">{row.title}</div>
                      <div className="text-xs text-neutral-500">{row.status}</div>
                    </td>
                    <td className="px-4 py-3 text-neutral-200">{row.views}</td>
                    <td className="px-4 py-3 text-neutral-200">{row.legacyOpens || 0}</td>
                    {supportsCommerceMetrics && <td className="px-4 py-3 text-neutral-200">{row.purchases ?? 0}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
