import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { WITNESS_ALGORITHM, type WitnessAlgorithm, type WitnessIdentityDto, type WitnessIdentityKeyDto } from "./witness.types.js";

const RECOVERY_CHALLENGE_TTL_MS = 5 * 60_000;

function toKeyDto(row: {
  id: string;
  algorithm: string;
  fingerprint: string;
  status: string;
  statusReason: string | null;
  createdAt: Date;
  activatedAt: Date | null;
  retiredAt: Date | null;
  revokedAt: Date | null;
}): WitnessIdentityKeyDto {
  return {
    id: row.id,
    algorithm: (row.algorithm || WITNESS_ALGORITHM) as WitnessAlgorithm,
    fingerprint: row.fingerprint,
    status: row.status,
    statusReason: row.statusReason,
    createdAt: row.createdAt.toISOString(),
    activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
    retiredAt: row.retiredAt ? row.retiredAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null
  };
}

function toDto(row: {
  id: string;
  algorithm: string;
  publicKey: string;
  fingerprint: string;
  createdAt: Date;
  revokedAt: Date | null;
  keys?: Array<{
    id: string;
    algorithm: string;
    fingerprint: string;
    status: string;
    statusReason: string | null;
    createdAt: Date;
    activatedAt: Date | null;
    retiredAt: Date | null;
    revokedAt: Date | null;
  }>;
}): WitnessIdentityDto {
  return {
    id: row.id,
    algorithm: (row.algorithm || WITNESS_ALGORITHM) as WitnessAlgorithm,
    publicKey: row.publicKey,
    fingerprint: row.fingerprint,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    keyHistory: Array.isArray(row.keys) ? row.keys.map(toKeyDto) : undefined
  };
}

export function computeWitnessFingerprint(publicKey: string): string {
  return createHash("sha256").update(publicKey, "utf8").digest("hex");
}

export function validateWitnessPublicKey(publicKey: string): boolean {
  try {
    return Buffer.from(String(publicKey || "").trim(), "base64").length === 32;
  } catch {
    return false;
  }
}

async function backfillInitialKeyIfNeeded(prisma: any, witness: {
  id: string;
  userId: string;
  algorithm: string;
  publicKey: string;
  fingerprint: string;
  createdAt: Date;
  revokedAt: Date | null;
}) {
  const existing = await prisma.witnessIdentityKey.findFirst({
    where: { witnessIdentityId: witness.id },
    select: { id: true }
  });
  if (existing?.id) return;
  const key = await prisma.witnessIdentityKey.create({
    data: {
      witnessIdentityId: witness.id,
      userId: witness.userId,
      algorithm: witness.algorithm,
      publicKey: witness.publicKey,
      fingerprint: witness.fingerprint,
      status: witness.revokedAt ? "revoked" : "active",
      statusReason: "initial",
      createdAt: witness.createdAt,
      activatedAt: witness.createdAt,
      revokedAt: witness.revokedAt
    },
    select: { id: true }
  });
  await prisma.witnessIdentityEvent.create({
    data: {
      witnessIdentityId: witness.id,
      userId: witness.userId,
      type: "initial",
      newKeyId: key.id,
      authorization: "migration",
      reason: "backfilled from legacy WitnessIdentity row",
      createdAt: witness.createdAt
    }
  });
}

export async function getActiveWitnessIdentityKey(prisma: PrismaClient | any, userId: string): Promise<{
  witnessIdentityId: string;
  keyId: string;
  algorithm: WitnessAlgorithm;
  publicKey: string;
  fingerprint: string;
} | null> {
  const witness = await prisma.witnessIdentity.findUnique({
    where: { userId },
    select: {
      id: true,
      userId: true,
      algorithm: true,
      publicKey: true,
      fingerprint: true,
      createdAt: true,
      revokedAt: true
    }
  });
  if (!witness || witness.revokedAt) return null;
  await backfillInitialKeyIfNeeded(prisma, witness);
  const key = await prisma.witnessIdentityKey.findFirst({
    where: {
      witnessIdentityId: witness.id,
      status: "active",
      revokedAt: null
    },
    orderBy: [{ activatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      algorithm: true,
      publicKey: true,
      fingerprint: true
    }
  });
  if (!key?.id) return null;
  return {
    witnessIdentityId: witness.id,
    keyId: key.id,
    algorithm: (key.algorithm || WITNESS_ALGORITHM) as WitnessAlgorithm,
    publicKey: key.publicKey,
    fingerprint: key.fingerprint
  };
}

const witnessIdentitySelect: Prisma.WitnessIdentitySelect = {
  id: true,
  userId: true,
  algorithm: true,
  publicKey: true,
  fingerprint: true,
  createdAt: true,
  revokedAt: true,
  keys: {
    orderBy: [{ activatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      algorithm: true,
      fingerprint: true,
      status: true,
      statusReason: true,
      createdAt: true,
      activatedAt: true,
      retiredAt: true,
      revokedAt: true
    }
  }
};

export async function getWitnessIdentity(prisma: PrismaClient, userId: string): Promise<WitnessIdentityDto | null> {
  let row: any = await prisma.witnessIdentity.findUnique({
    where: { userId },
    select: witnessIdentitySelect
  });
  if (row && !row.keys?.length) {
    await backfillInitialKeyIfNeeded(prisma as any, row);
    row = await prisma.witnessIdentity.findUnique({
      where: { userId },
      select: witnessIdentitySelect
    });
  }
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
  if (!publicKey || !validateWitnessPublicKey(publicKey)) {
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
    await backfillInitialKeyIfNeeded(prisma as any, { ...existing, userId: args.userId });
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
  await backfillInitialKeyIfNeeded(prisma as any, { ...row, userId: args.userId });

  return toDto(row);
}

export async function createWitnessRecoveryChallenge(prisma: PrismaClient | any, args: {
  userId: string;
  publicKey: string;
  algorithm: string;
}): Promise<{ challengeId: string; challengeText: string; expiresAt: string; algorithm: WitnessAlgorithm }> {
  const algorithm = String(args.algorithm || "").trim().toLowerCase();
  if (algorithm !== WITNESS_ALGORITHM) throw new Error("INVALID_ALGORITHM");
  const publicKey = String(args.publicKey || "").trim();
  if (!publicKey || !validateWitnessPublicKey(publicKey)) throw new Error("PUBLIC_KEY_REQUIRED");
  const active = await getActiveWitnessIdentityKey(prisma, args.userId);
  if (!active) throw new Error("WITNESS_IDENTITY_REQUIRED");
  if (active.publicKey === publicKey) throw new Error("RECOVERY_KEY_ALREADY_ACTIVE");

  const nonce = randomBytes(16).toString("hex");
  const challengeId = cryptoRandomId();
  const expiresAt = new Date(Date.now() + RECOVERY_CHALLENGE_TTL_MS);
  const candidateFingerprint = computeWitnessFingerprint(publicKey);
  const challengeText = [
    "Certifyd Creator Identity Legacy Recovery",
    `Challenge ID: ${challengeId}`,
    `User ID: ${args.userId}`,
    `Current Fingerprint: ${active.fingerprint}`,
    `New Fingerprint: ${candidateFingerprint}`,
    `Nonce: ${nonce}`,
    `Expires At: ${expiresAt.toISOString()}`
  ].join("\n");

  await prisma.witnessIdentityRecoveryChallenge.create({
    data: {
      id: challengeId,
      userId: args.userId,
      witnessIdentityId: active.witnessIdentityId,
      candidatePublicKey: publicKey,
      candidateFingerprint,
      challengeText,
      nonce,
      expiresAt
    }
  });

  return { challengeId, challengeText, expiresAt: expiresAt.toISOString(), algorithm: WITNESS_ALGORITHM };
}

function cryptoRandomId(): string {
  return `wir_${randomBytes(16).toString("hex")}`;
}

export async function completeWitnessLegacyRecovery(prisma: PrismaClient | any, args: {
  userId: string;
  challengeId: string;
  publicKey: string;
  signatureValid: boolean;
}): Promise<WitnessIdentityDto> {
  const publicKey = String(args.publicKey || "").trim();
  if (!publicKey || !validateWitnessPublicKey(publicKey)) throw new Error("PUBLIC_KEY_REQUIRED");
  if (!args.signatureValid) throw new Error("INVALID_SIGNATURE");
  const now = new Date();
  const candidateFingerprint = computeWitnessFingerprint(publicKey);

  return prisma.$transaction(async (tx: any) => {
    const challenge = await tx.witnessIdentityRecoveryChallenge.findUnique({
      where: { id: args.challengeId },
      select: {
        id: true,
        userId: true,
        witnessIdentityId: true,
        candidatePublicKey: true,
        candidateFingerprint: true,
        expiresAt: true,
        usedAt: true
      }
    });
    if (!challenge || challenge.userId !== args.userId) throw new Error("RECOVERY_CHALLENGE_NOT_FOUND");
    if (challenge.usedAt) throw new Error("RECOVERY_CHALLENGE_USED");
    if (challenge.expiresAt <= now) throw new Error("RECOVERY_CHALLENGE_EXPIRED");
    if (challenge.candidatePublicKey !== publicKey || challenge.candidateFingerprint !== candidateFingerprint) {
      throw new Error("RECOVERY_PUBLIC_KEY_MISMATCH");
    }

    const witness = await tx.witnessIdentity.findUnique({
      where: { userId: args.userId },
      select: {
        id: true,
        userId: true,
        algorithm: true,
        publicKey: true,
        fingerprint: true,
        createdAt: true,
        revokedAt: true
      }
    });
    if (!witness || witness.revokedAt || witness.id !== challenge.witnessIdentityId) {
      throw new Error("WITNESS_IDENTITY_REQUIRED");
    }

    await backfillInitialKeyIfNeeded(tx, witness);
    const activeKey = await tx.witnessIdentityKey.findFirst({
      where: { witnessIdentityId: witness.id, status: "active", revokedAt: null },
      orderBy: [{ activatedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, publicKey: true, fingerprint: true }
    });
    if (!activeKey?.id) throw new Error("ACTIVE_WITNESS_KEY_REQUIRED");
    if (activeKey.publicKey === publicKey) throw new Error("RECOVERY_KEY_ALREADY_ACTIVE");

    await tx.witnessIdentityKey.updateMany({
      where: { witnessIdentityId: witness.id, status: "active", revokedAt: null },
      data: {
        status: "retired",
        statusReason: "recovery",
        retiredAt: now
      }
    });
    const newKey = await tx.witnessIdentityKey.create({
      data: {
        witnessIdentityId: witness.id,
        userId: args.userId,
        algorithm: WITNESS_ALGORITHM,
        publicKey,
        fingerprint: candidateFingerprint,
        status: "active",
        statusReason: "legacy_recovery",
        activatedAt: now
      },
      select: { id: true }
    });
    const updated = await tx.witnessIdentity.update({
      where: { id: witness.id },
      data: {
        algorithm: WITNESS_ALGORITHM,
        publicKey,
        fingerprint: candidateFingerprint,
        revokedAt: null
      },
      select: {
        id: true,
        algorithm: true,
        publicKey: true,
        fingerprint: true,
        createdAt: true,
        revokedAt: true,
        keys: {
          orderBy: [{ activatedAt: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            algorithm: true,
            fingerprint: true,
            status: true,
            statusReason: true,
            createdAt: true,
            activatedAt: true,
            retiredAt: true,
            revokedAt: true
          }
        }
      }
    });
    await tx.witnessIdentityEvent.create({
      data: {
        witnessIdentityId: witness.id,
        userId: args.userId,
        type: "legacy_recovery",
        previousKeyId: activeKey.id,
        newKeyId: newKey.id,
        authorization: "recent_password",
        reason: "stranded local signing key recovery",
        createdAt: now
      }
    });
    await tx.witnessIdentityRecoveryChallenge.update({
      where: { id: challenge.id },
      data: { usedAt: now }
    });
    await tx.user.update({
      where: { id: args.userId },
      data: { tokenVersion: { increment: 1 } }
    });
    return toDto(updated);
  });
}
