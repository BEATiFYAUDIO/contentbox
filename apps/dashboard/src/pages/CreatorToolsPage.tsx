import React from "react";

export default function CreatorToolsPage(props: {
  onOpenContent: () => void;
  onOpenSplits: () => void;
  onOpenSales: () => void;
  onOpenPayments: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Creator tools</div>
        <div className="text-sm text-neutral-400 mt-1">Publish, split, and get paid.</div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={props.onOpenContent}
          className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4 text-left hover:bg-neutral-900/40"
        >
          <div className="text-sm font-medium">Content</div>
          <div className="text-xs text-neutral-400 mt-1">Create and manage your catalog.</div>
        </button>
        <button
          onClick={props.onOpenSplits}
          className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4 text-left hover:bg-neutral-900/40"
        >
          <div className="text-sm font-medium">Splits</div>
          <div className="text-xs text-neutral-400 mt-1">Draft, lock, and manage revenue splits.</div>
        </button>
        <button
          onClick={props.onOpenSales}
          className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4 text-left hover:bg-neutral-900/40"
        >
          <div className="text-sm font-medium">Sales</div>
          <div className="text-xs text-neutral-400 mt-1">Orders and receipts (coming soon).</div>
        </button>
        <button
          onClick={props.onOpenPayments}
          className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4 text-left hover:bg-neutral-900/40"
        >
          <div className="text-sm font-medium">Payment setup</div>
          <div className="text-xs text-neutral-400 mt-1">Configure rails and payout destinations.</div>
        </button>
      </div>
    </div>
  );
}
