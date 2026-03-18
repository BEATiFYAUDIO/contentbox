import FinanceOverviewPage from "./FinanceOverviewPage";

type NodeLightningPageProps = {
  legacyRoute?: boolean;
  tunnelActive: boolean | null;
  identityVerified: boolean | null;
  lightningConfigured: boolean | null;
  onOpenPrimaryRoute?: () => void;
};

function statusText(value: boolean | null, positive: string, negative: string) {
  if (value === null) return "Unknown";
  return value ? positive : negative;
}

export default function NodeLightningPage({
  legacyRoute = false,
  tunnelActive,
  identityVerified,
  lightningConfigured,
  onOpenPrimaryRoute
}: NodeLightningPageProps) {
  return (
    <div className="space-y-4">
      {legacyRoute ? (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-200">
          <div className="font-medium">Lightning configuration has moved to Node Settings.</div>
          <button
            onClick={onOpenPrimaryRoute}
            className="mt-2 text-xs rounded-lg border border-amber-800 px-3 py-1 hover:bg-amber-900/30"
          >
            Open /node/lightning
          </button>
        </div>
      ) : null}

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Node Settings · Lightning</div>
        <div className="text-sm text-neutral-400 mt-1">
          Lightning is infrastructure for your node. Revenue surfaces consumption, not configuration.
        </div>

        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Node Status</div>
          <div className="mt-2 grid gap-2 text-sm text-neutral-200">
            <div>🌐 Tunnel: {statusText(tunnelActive, "Active", "Inactive")}</div>
            <div>🪪 Identity: {statusText(identityVerified, "Verified", "Not verified")}</div>
            <div>⚡ Lightning: {statusText(lightningConfigured, "Configured", "Not configured")}</div>
          </div>
          <div className="mt-3">
            <button
              onClick={onOpenPrimaryRoute}
              className="text-xs rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
            >
              Configure Lightning
            </button>
          </div>
        </div>
      </div>

      <FinanceOverviewPage />
    </div>
  );
}

