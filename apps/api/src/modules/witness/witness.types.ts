export const WITNESS_ALGORITHM = "ed25519" as const;

export type WitnessAlgorithm = typeof WITNESS_ALGORITHM;

export type WitnessIdentityDto = {
  id: string;
  algorithm: WitnessAlgorithm;
  publicKey: string;
  fingerprint: string;
  createdAt: string;
  revokedAt: string | null;
};

export type WitnessRegisterBody = {
  publicKey?: string;
  algorithm?: string;
};
