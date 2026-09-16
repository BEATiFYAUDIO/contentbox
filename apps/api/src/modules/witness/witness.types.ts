export const WITNESS_ALGORITHM = "ed25519" as const;

export type WitnessAlgorithm = typeof WITNESS_ALGORITHM;

export type WitnessIdentityDto = {
  id: string;
  algorithm: WitnessAlgorithm;
  publicKey: string;
  fingerprint: string;
  createdAt: string;
  revokedAt: string | null;
  keyHistory?: WitnessIdentityKeyDto[];
};

export type WitnessRegisterBody = {
  publicKey?: string;
  algorithm?: string;
};

export type WitnessIdentityKeyDto = {
  id: string;
  algorithm: WitnessAlgorithm;
  fingerprint: string;
  status: string;
  statusReason: string | null;
  createdAt: string;
  activatedAt: string | null;
  retiredAt: string | null;
  revokedAt: string | null;
};
