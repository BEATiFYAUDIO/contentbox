import React from "react";
import AuditPanel from "../components/AuditPanel";

export default function DownloadsPage() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Downloads</div>
        <div className="text-sm text-neutral-400 mt-1">
          Download manager is coming soon. Use your receipt to download files today.
        </div>
      </div>

      <AuditPanel scopeType="library" title="Audit" exportName="library-audit.json" />
    </div>
  );
}
