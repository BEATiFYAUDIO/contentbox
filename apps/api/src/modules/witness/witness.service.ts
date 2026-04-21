import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { WITNESS_ALGORITHM, type WitnessAlgorithm, type WitnessIdentityDto } from "./witness.types.js";

function toDto(row: {
  id: string;
  algorithm: string;
  publicKey: string;
  fingerprint: string;
  createdAt: Date;
  revokedAt: Date | null;
}): WitnessIdentityDto {
  return {
    id: row.id,
    algorithm: (row.algorithm || WITNESS_ALGORITHM) as WitnessAlgorithm,
    publicKey: row.publicKey,
    fingerprint: row.fingerprint,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null
  };
}

export function computeWitnessFingerprint(publicKey: string): string {
  return createHash("sha256").update(publicKey, "utf8").digest("hex");
}

export async function getWitnessIdentity(prisma: PrismaClient, userId: string): Promise<WitnessIdentityDto | null> {
  const row = await prisma.witnessIdentity.findUnique({
    where: { userId },
    select: {
      id: true,
      algorithm: true,
      publicKey: true,
      fingerprint: true,
      createdAt: true,
      revokedAt: true
    }
  });
  return row ? toDto(row) : null;
}

export async function registerWitnessIdentity(prisma: PrismaClient, args: {
  userId: string;
  algorithm: string;
  publicKey: string;
}): Promise<WitnessIdentityDto> {
  const algorithm = String(args.algorithm || "").trim().toLowerCase();
  if (algorithm !== WITNESS_ALGORITHM) {
    throw new Error("INVALID_ALGORITHM");
  }
  const publicKey = String(args.publicKey || "").trim();
  if (!publicKey) {
    throw new Error("PUBLIC_KEY_REQUIRED");
  }
  const fingerprint = computeWitnessFingerprint(publicKey);

  const existing = await prisma.witnessIdentity.findUnique({
    where: { userId: args.userId },
    select: {
      id: true,
      algorithm: true,
      publicKey: true,
      fingerprint: true,
      createdAt: true,
      revokedAt: true
    }
  });

  if (existing && !existing.revokedAt) {
    // Idempotent re-register of the same active key is allowed.
    if (
      String(existing.algorithm || "").toLowerCase() === algorithm &&
      String(existing.publicKey || "") === publicKey
    ) {
      return toDto(existing);
    }
    throw new Error("WITNESS_IDENTITY_EXISTS");
  }

  const row = await prisma.witnessIdentity.upsert({
    where: { userId: args.userId },
    create: {
      userId: args.userId,
      algorithm,
      publicKey,
      fingerprint,
      revokedAt: null
    },
    update: {
      algorithm,
      publicKey,
      fingerprint,
      revokedAt: null
    },
    select: {
      id: true,
      algorithm: true,
      publicKey: true,
      fingerprint: true,
      createdAt: true,
      revokedAt: true
    }
  });

  return toDto(row);
}

export async function revokeWitnessIdentity(prisma: PrismaClient, userId: string): Promise<WitnessIdentityDto | null> {
  const existing = await prisma.witnessIdentity.findUnique({
    where: { userId },
    select: {
      id: true,
      algorithm: true,
      publicKey: true,
      fingerprint: true,
      createdAt: true,
      revokedAt: true
    }
  });
  if (!existing) return null;
  if (existing.revokedAt) return toDto(existing);

  const row = await prisma.witnessIdentity.update({
    where: { userId },
    data: { revokedAt: new Date() },
    select: {
      id: true,
      algorithm: true,
      publicKey: true,
      fingerprint: true,
      createdAt: true,
      revokedAt: true
    }
  });
  return toDto(row);
}
