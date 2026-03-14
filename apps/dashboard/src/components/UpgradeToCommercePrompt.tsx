type AttemptedCapability =
  | "set_price"
  | "durable_buy_link"
  | "invoice_minting"
  | "buyer_recovery"
  | "replay_recovery";

type Props = {
  selectedMode: "basic_creator" | "sovereign_creator_with_provider" | "sovereign_node";
  effectiveMode:
    | "basic_creator"
    | "sovereign_creator_with_provider"
    | "sovereign_node_operator"
    | "sovereign_creator_unready";
  readinessBlockers?: string[];
  attemptedCapability: AttemptedCapability;
  providerFeePercent?: number | null;
  onEnablePaidCommerce?: () => void;
  onRunOwnNode?: () => void;
};

function capLabel(cap: AttemptedCapability): string {
  if (cap === "set_price") return "paid pricing";
  if (cap === "durable_buy_link") return "durable buy links";
  if (cap === "invoice_minting") return "invoice minting";
  if (cap === "buyer_recovery") return "buyer recovery";
  return "replay recovery";
}

export default function UpgradeToCommercePrompt(props: Props) {
  const {
    selectedMode,
    effectiveMode,
    readinessBlockers = [],
    attemptedCapability,
    providerFeePercent,
    onEnablePaidCommerce,
    onRunOwnNode
  } = props;

  if (selectedMode === "basic_creator") {
    return (
      <div className="rounded-lg border border-amber-800/70 bg-amber-950/20 p-3 text-xs">
        <div className="font-medium text-amber-200">Enable durable paid commerce</div>
        <div className="mt-1 text-amber-100">
          Durable paid commerce requires Sovereign Creator mode. Basic mode supports publish, tips, and preview links only.
        </div>
        <div className="mt-2 text-amber-100">
          Upgrade to enable stable buy links, invoices, receipts, buyer library, and replay recovery.
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="rounded-md border border-amber-700 px-2 py-1 hover:bg-amber-900/40"
            onClick={onEnablePaidCommerce}
          >
            Enable Paid Commerce
          </button>
        </div>
      </div>
    );
  }

  if (effectiveMode === "sovereign_creator_unready") {
    return (
      <div className="rounded-lg border border-rose-800/70 bg-rose-950/20 p-3 text-xs">
        <div className="font-medium text-rose-200">Sovereign Node requested but not ready</div>
        <div className="mt-1 text-rose-100">
          Your node is not yet ready to provide {capLabel(attemptedCapability)} locally. Certifyd will use provider infrastructure until dependencies are ready.
        </div>
        {readinessBlockers.length > 0 ? (
          <ul className="mt-2 list-disc pl-5 text-rose-100 space-y-0.5">
            {readinessBlockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : null}
        <div className="mt-2">
          <button
            type="button"
            className="rounded-md border border-rose-700 px-2 py-1 hover:bg-rose-900/40"
            onClick={onRunOwnNode}
          >
            Run Your Own Node
          </button>
        </div>
      </div>
    );
  }

  if (effectiveMode === "sovereign_creator_with_provider") {
    return (
      <div className="rounded-lg border border-sky-800/70 bg-sky-950/20 p-3 text-xs">
        <div className="font-medium text-sky-200">Provider-backed durable commerce active</div>
        <div className="mt-1 text-sky-100">
          This is the first durable paid-commerce tier. Provider infrastructure currently handles invoices, buyer recovery, and replay.
        </div>
        <div className="mt-1 text-sky-100">
          {typeof providerFeePercent === "number"
            ? `Provider infrastructure fee: ${providerFeePercent}%`
            : "Provider infrastructure fee applies in this mode."}
        </div>
        <div className="mt-2">
          <button
            type="button"
            className="rounded-md border border-sky-700 px-2 py-1 hover:bg-sky-900/40"
            onClick={onRunOwnNode}
          >
            Run Your Own Node
          </button>
        </div>
      </div>
    );
  }

  return null;
}
