import React from "react";
import AuditPanel from "../components/AuditPanel";

export default function SalesPage() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Sales</div>
        <div className="text-sm text-neutral-400 mt-1">
          Sales reporting is coming soon. You can still view payments and receipts in Purchase history.
        </div>
      </div>

      <AuditPanel scopeType="royalty" title="Audit" exportName="royalty-audit.json" />
    </div>
  );
}
