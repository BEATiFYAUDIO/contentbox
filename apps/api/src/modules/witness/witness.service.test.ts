import assert from "node:assert/strict";
import test from "node:test";
import {
  completeWitnessLegacyRecovery,
  computeWitnessFingerprint,
  createWitnessRecoveryChallenge,
  getActiveWitnessIdentityKey,
  getWitnessIdentity,
  validateWitnessPublicKey
} from "./witness.service.js";

function publicKey(seed: number): string {
  return Buffer.alloc(32, seed).toString("base64");
}

type Row = Record<string, any>;

class WitnessPrismaStub {
  users: Row[];
  witnesses: Row[];
  keys: Row[];
  events: Row[] = [];
  challenges: Row[] = [];

  constructor() {
    const createdAt = new Date("2026-03-18T03:06:18.115Z");
    const publicKeyValue = publicKey(1);
    this.users = [{ id: "user-1", tokenVersion: 0 }];
    this.witnesses = [{
      id: "witness-1",
      userId: "user-1",
      algorithm: "ed25519",
      publicKey: publicKeyValue,
      fingerprint: computeWitnessFingerprint(publicKeyValue),
      createdAt,
      revokedAt: null
    }];
    this.keys = [];
  }

  witnessIdentity = {
    findUnique: async ({ where, select }: any) => {
      const row = this.witnesses.find((w) => {
        if (where.id) return w.id === where.id;
        return w.userId === where.userId;
      });
      if (!row) return null;
      return this.applyWitnessSelect(row, select);
    },
    update: async ({ where, data, select }: any) => {
      const row = this.witnesses.find((w) => w.id === where.id);
      if (!row) throw new Error("missing witness");
      Object.assign(row, data);
      return this.applyWitnessSelect(row, select);
    }
  };

  witnessIdentityKey = {
    findFirst: async ({ where }: any) => {
      return this.keys.find((key) => this.matchesKey(key, where)) || null;
    },
    findMany: async ({ where }: any) => {
      return this.keys.filter((key) => this.matchesKey(key, where));
    },
    create: async ({ data }: any) => {
      const row = { id: data.id || `key-${this.keys.length + 1}`, createdAt: data.createdAt || new Date(), ...data };
      this.keys.push(row);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const key of this.keys) {
        if (this.matchesKey(key, where)) {
          Object.assign(key, data);
          count += 1;
        }
      }
      return { count };
    }
  };

  witnessIdentityEvent = {
    create: async ({ data }: any) => {
      const row = { id: data.id || `event-${this.events.length + 1}`, createdAt: data.createdAt || new Date(), ...data };
      this.events.push(row);
      return row;
    }
  };

  witnessIdentityRecoveryChallenge = {
    create: async ({ data }: any) => {
      const row = { createdAt: new Date(), usedAt: null, ...data };
      this.challenges.push(row);
      return row;
    },
    findUnique: async ({ where }: any) => {
      return this.challenges.find((challenge) => challenge.id === where.id) || null;
    },
    update: async ({ where, data }: any) => {
      const row = this.challenges.find((challenge) => challenge.id === where.id);
      if (!row) throw new Error("missing challenge");
      Object.assign(row, data);
      return row;
    }
  };

  user = {
    update: async ({ where, data }: any) => {
      const row = this.users.find((user) => user.id === where.id);
      if (!row) throw new Error("missing user");
      if (data.tokenVersion?.increment) row.tokenVersion += data.tokenVersion.increment;
      return row;
    }
  };

  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    return fn(this);
  }

  private applyWitnessSelect(row: Row, select: any) {
    const out = { ...row };
    if (select?.keys) {
      out.keys = this.keys
        .filter((key) => key.witnessIdentityId === row.id)
        .sort((a, b) => Number(b.activatedAt || b.createdAt) - Number(a.activatedAt || a.createdAt));
    }
    return out;
  }

  private matchesKey(key: Row, where: any) {
    if (where.witnessIdentityId && key.witnessIdentityId !== where.witnessIdentityId) return false;
    if (where.userId && key.userId !== where.userId) return false;
    if (where.publicKey && key.publicKey !== where.publicKey) return false;
    if (where.status && key.status !== where.status) return false;
    if (where.revokedAt === null && key.revokedAt !== null && key.revokedAt !== undefined) return false;
    return true;
  }
}

test("witness public keys must be base64 encoded Ed25519 public keys", () => {
  assert.equal(validateWitnessPublicKey(publicKey(7)), true);
  assert.equal(validateWitnessPublicKey(Buffer.alloc(31, 7).toString("base64")), false);
  assert.equal(validateWitnessPublicKey("not-base64"), false);
});

test("legacy recovery rotates the active creator identity key without replacing the identity", async () => {
  const prisma = new WitnessPrismaStub();
  const oldFingerprint = prisma.witnesses[0].fingerprint;
  const candidatePublicKey = publicKey(2);
  const candidateFingerprint = computeWitnessFingerprint(candidatePublicKey);

  const firstRead = await getWitnessIdentity(prisma as any, "user-1");
  assert.equal(firstRead?.id, "witness-1");
  assert.equal(firstRead?.keyHistory?.length, 1);
  assert.equal(firstRead?.keyHistory?.[0]?.fingerprint, oldFingerprint);

  const challenge = await createWitnessRecoveryChallenge(prisma as any, {
    userId: "user-1",
    publicKey: candidatePublicKey,
    algorithm: "ed25519"
  });
  assert.match(challenge.challengeText, new RegExp(oldFingerprint));
  assert.match(challenge.challengeText, new RegExp(candidateFingerprint));

  const recovered = await completeWitnessLegacyRecovery(prisma as any, {
    userId: "user-1",
    challengeId: challenge.challengeId,
    publicKey: candidatePublicKey,
    signatureValid: true
  });

  assert.equal(recovered.id, "witness-1");
  assert.equal(recovered.publicKey, candidatePublicKey);
  assert.equal(recovered.fingerprint, candidateFingerprint);
  assert.equal(prisma.users[0].tokenVersion, 1);
  assert.equal(prisma.witnesses[0].publicKey, candidatePublicKey);
  assert.equal(prisma.keys.find((key) => key.fingerprint === oldFingerprint)?.status, "retired");
  assert.equal(prisma.keys.find((key) => key.fingerprint === candidateFingerprint)?.status, "active");
  assert.deepEqual(prisma.events.map((event) => event.type), ["initial", "legacy_recovery"]);
  assert.equal(Boolean(prisma.challenges[0].usedAt), true);

  const active = await getActiveWitnessIdentityKey(prisma as any, "user-1");
  assert.equal(active?.publicKey, candidatePublicKey);
  assert.equal(active?.fingerprint, candidateFingerprint);
});

test("failed recovery completion leaves the candidate challenge available for retry", async () => {
  const prisma = new WitnessPrismaStub();
  const candidatePublicKey = publicKey(3);
  const challenge = await createWitnessRecoveryChallenge(prisma as any, {
    userId: "user-1",
    publicKey: candidatePublicKey,
    algorithm: "ed25519"
  });

  await assert.rejects(
    completeWitnessLegacyRecovery(prisma as any, {
      userId: "user-1",
      challengeId: challenge.challengeId,
      publicKey: candidatePublicKey,
      signatureValid: false
    }),
    /INVALID_SIGNATURE/
  );

  assert.equal(prisma.challenges[0].usedAt, null);
  assert.equal(prisma.keys.length, 1);
  assert.equal(prisma.keys[0].status, "active");
  assert.equal(prisma.users[0].tokenVersion, 0);

  await completeWitnessLegacyRecovery(prisma as any, {
    userId: "user-1",
    challengeId: challenge.challengeId,
    publicKey: candidatePublicKey,
    signatureValid: true
  });
  assert.equal(prisma.users[0].tokenVersion, 1);
});
