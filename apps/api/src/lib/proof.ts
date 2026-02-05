import crypto from "node:crypto";

export type ProofSplitParticipant = {
  participantId?: string | null;
  participantEmail?: string | null;
  role: string;
  percent: string; // normalized string with 3 decimals
};

export type ProofPayload = {
  proofVersion: number;
  contentId: string;
  splitVersion: string;
  lockedAt: string;
  manifestHash: string;
  primaryFileSha256: string;
  primaryFileObjectKey?: string | null;
  splits: ProofSplitParticipant[];
  creatorId: string;
};

function canonicalize(value: any): any {
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (value && typeof value === "object") {
    const out: any = {};
    const keys = Object.keys(value).sort();
    for (const k of keys) {
      const v = (value as any)[k];
      if (v === undefined) continue;
      out[k] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function stableStringify(value: any, pretty = false): string {
  const canonical = canonicalize(value);
  return JSON.stringify(canonical, null, pretty ? 2 : 0);
}

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function normalizePercentString(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.000";
  const rounded = Math.round(n * 1000) / 1000;
  return rounded.toFixed(3);
}

export function normalizeSplitsForProof(splits: ProofSplitParticipant[]): ProofSplitParticipant[] {
  const normalized = splits.map((s) => ({
    participantId: s.participantId || null,
    participantEmail: s.participantEmail || null,
    role: String(s.role || "").trim(),
    percent: normalizePercentString(s.percent)
  }));

  return normalized.sort((a, b) => {
    const ea = (a.participantEmail || "").toLowerCase();
    const eb = (b.participantEmail || "").toLowerCase();
    if (ea !== eb) return ea.localeCompare(eb);
    const ia = (a.participantId || "").toLowerCase();
    const ib = (b.participantId || "").toLowerCase();
    if (ia !== ib) return ia.localeCompare(ib);
    return a.role.localeCompare(b.role);
  });
}

export function computeSplitsHash(splits: ProofSplitParticipant[]): string {
  const normalized = normalizeSplitsForProof(splits);
  return sha256Hex(stableStringify(normalized));
}

export function computeManifestHash(manifest: any): string {
  return sha256Hex(stableStringify(manifest || {}));
}

export function computeProofHash(payload: ProofPayload): string {
  return sha256Hex(stableStringify(payload));
}
