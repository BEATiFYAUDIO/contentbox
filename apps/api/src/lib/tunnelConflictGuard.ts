export type TunnelConflictGuardState = {
  firstDetectedAtMs: number | null;
  persistent: boolean;
};

export type TunnelConflictGuardEvaluation = {
  state: TunnelConflictGuardState;
  persistent: boolean;
  justBecamePersistent: boolean;
};

export function evaluateTunnelConflictGuard(input: {
  hasConflict: boolean;
  nowMs: number;
  thresholdMs: number;
  state: TunnelConflictGuardState;
}): TunnelConflictGuardEvaluation {
  const thresholdMs = Math.max(1_000, Number(input.thresholdMs || 0));
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();
  const prev = input.state;

  if (!input.hasConflict) {
    const next: TunnelConflictGuardState = { firstDetectedAtMs: null, persistent: false };
    return { state: next, persistent: false, justBecamePersistent: false };
  }

  const firstDetectedAtMs = prev.firstDetectedAtMs ?? nowMs;
  const persistent = nowMs - firstDetectedAtMs >= thresholdMs;
  const justBecamePersistent = persistent && !prev.persistent;
  const next: TunnelConflictGuardState = { firstDetectedAtMs, persistent };
  return { state: next, persistent, justBecamePersistent };
}

