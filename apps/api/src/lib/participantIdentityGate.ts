export type ParticipantIdentityGate = {
  active: boolean;
  readinessReason: "INVITE_UNRESOLVED" | "KEY_UNVERIFIED" | null;
};

export type ParticipantIdentityGateEvaluationInput = {
  userId: string;
  splitParticipantId: string;
  splitParticipantExists: boolean;
  splitParticipantUserId: string;
  signedAccepted: boolean;
  splitSnapshotVerified: boolean;
  localWitnessVerified: boolean;
};

export function evaluateParticipantIdentityGate(input: ParticipantIdentityGateEvaluationInput): ParticipantIdentityGate {
  if (!input.splitParticipantId && !input.userId) {
    return { active: false, readinessReason: "INVITE_UNRESOLVED" };
  }
  if (input.splitParticipantId && !input.splitParticipantExists) {
    return { active: false, readinessReason: "INVITE_UNRESOLVED" };
  }
  if (input.splitParticipantUserId && input.userId && input.splitParticipantUserId !== input.userId) {
    return { active: false, readinessReason: "INVITE_UNRESOLVED" };
  }
  const effectiveUserId = String(input.splitParticipantUserId || input.userId || "").trim();
  if (!effectiveUserId) {
    return { active: false, readinessReason: "INVITE_UNRESOLVED" };
  }
  if (!input.signedAccepted) {
    return { active: false, readinessReason: "INVITE_UNRESOLVED" };
  }
  if (!input.splitSnapshotVerified && !input.localWitnessVerified) {
    return { active: false, readinessReason: "KEY_UNVERIFIED" };
  }
  return { active: true, readinessReason: null };
}
