export type CanonicalPlaybackMode = "full" | "preview" | "none";

export type CanonicalPlayback = {
  mode: CanonicalPlaybackMode;
  streamUrl: string | null;
  previewLimitSeconds: number | null;
  canPlayFull: boolean;
  reason?: string;
};

export type BuildCanonicalPlaybackInput = {
  hasFullAccess: boolean;
  fullStreamUrl?: string | null;
  previewStreamUrl?: string | null;
  previewLimitSeconds?: number | null;
};

function cleanUrl(value: string | null | undefined): string | null {
  const out = String(value || "").trim();
  return out || null;
}

function cleanPreviewLimit(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  const next = Math.trunc(value);
  return next > 0 ? next : null;
}

export function buildCanonicalPlayback(input: BuildCanonicalPlaybackInput): CanonicalPlayback {
  const fullStreamUrl = cleanUrl(input.fullStreamUrl);
  const previewStreamUrl = cleanUrl(input.previewStreamUrl);

  if (input.hasFullAccess) {
    if (fullStreamUrl) {
      return {
        mode: "full",
        streamUrl: fullStreamUrl,
        previewLimitSeconds: null,
        canPlayFull: true
      };
    }
    return {
      mode: "none",
      streamUrl: null,
      previewLimitSeconds: null,
      canPlayFull: true,
      reason: "full_stream_unavailable"
    };
  }

  if (previewStreamUrl) {
    return {
      mode: "preview",
      streamUrl: previewStreamUrl,
      previewLimitSeconds: cleanPreviewLimit(input.previewLimitSeconds),
      canPlayFull: false,
      reason: "full_access_required"
    };
  }

  return {
    mode: "none",
    streamUrl: null,
    previewLimitSeconds: null,
    canPlayFull: false,
    reason: "preview_unavailable"
  };
}
