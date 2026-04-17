import { useCallback, useEffect, useState } from "react";
import { fetchWitnessIdentity, registerWitnessPublicKey, type WitnessIdentity } from "./witnessClient";

export type CreateResult = {
  identity: WitnessIdentity;
  createdLocal: boolean;
};

export type WitnessIdentityState =
  | "noIdentity"
  | "ready"
  | "registeredMissingLocalKey"
  | "localKeyUnregistered"
  | "error";

type LocalWitnessRecord = {
  id: string;
  algorithm: "ed25519";
  publicKey: string;
  createdAt: string;
  privateKeyCrypto?: CryptoKey;
  publicKeyCrypto?: CryptoKey;
  privateKeyRawHex?: string;
};

const DB_NAME = "contentbox-witness";
const STORE_NAME = "keys";
const LOCAL_KEY_ID = "witness-ed25519-v1";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

async function readLocalKey(): Promise<LocalWitnessRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(LOCAL_KEY_ID);
    req.onsuccess = () => resolve((req.result as LocalWitnessRecord | undefined) || null);
    req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
  });
}

async function writeLocalKey(record: LocalWitnessRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB write aborted"));
  });
}

async function generateWithWebCrypto(): Promise<LocalWitnessRecord> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WEBCRYPTO_UNAVAILABLE");

  const keys = await subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  const publicKeyRaw = new Uint8Array(await subtle.exportKey("raw", keys.publicKey));
  const publicKey = toBase64(publicKeyRaw);

  return {
    id: LOCAL_KEY_ID,
    algorithm: "ed25519",
    publicKey,
    createdAt: new Date().toISOString(),
    privateKeyCrypto: keys.privateKey,
    publicKeyCrypto: keys.publicKey
  };
}

async function generateWithNoble(): Promise<LocalWitnessRecord> {
  const noble = await import("@noble/ed25519");
  const privateKey = noble.utils.randomPrivateKey();
  const publicKeyBytes = await noble.getPublicKeyAsync(privateKey);

  return {
    id: LOCAL_KEY_ID,
    algorithm: "ed25519",
    publicKey: toBase64(publicKeyBytes),
    createdAt: new Date().toISOString(),
    privateKeyRawHex: toHex(privateKey)
  };
}

async function ensureLocalKey(): Promise<{ key: LocalWitnessRecord; createdLocal: boolean }> {
  const existing = await readLocalKey();
  if (existing?.publicKey) return { key: existing, createdLocal: false };

  let created: LocalWitnessRecord;
  try {
    created = await generateWithWebCrypto();
  } catch {
    created = await generateWithNoble();
  }

  await writeLocalKey(created);
  return { key: created, createdLocal: true };
}

export async function getLocalWitnessPublicKey(): Promise<string | null> {
  const local = await readLocalKey();
  return local?.publicKey || null;
}

export async function signWithLocalWitnessKey(challengeText: string): Promise<{ publicKey: string; signature: string }> {
  const local = await readLocalKey();
  if (!local?.publicKey) throw new Error("LOCAL_WITNESS_KEY_UNAVAILABLE");

  const payload = new TextEncoder().encode(String(challengeText || ""));
  if (local.privateKeyCrypto && globalThis.crypto?.subtle) {
    const sig = await globalThis.crypto.subtle.sign({ name: "Ed25519" }, local.privateKeyCrypto, payload);
    return {
      publicKey: local.publicKey,
      signature: toBase64(new Uint8Array(sig))
    };
  }

  if (local.privateKeyRawHex) {
    const noble = await import("@noble/ed25519");
    const sig = await noble.signAsync(payload, local.privateKeyRawHex);
    return {
      publicKey: local.publicKey,
      signature: toBase64(sig)
    };
  }

  throw new Error("LOCAL_WITNESS_KEY_UNAVAILABLE");
}

export function useWitnessIdentity() {
  const [identity, setIdentity] = useState<WitnessIdentity | null>(null);
  const [hasLocalKey, setHasLocalKey] = useState(false);
  const [localKeyPublicKey, setLocalKeyPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [next, local] = await Promise.all([fetchWitnessIdentity(), readLocalKey()]);
      setIdentity(next);
      setHasLocalKey(Boolean(local?.publicKey));
      setLocalKeyPublicKey(local?.publicKey || null);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load creator identity."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const createIdentity = useCallback(async (): Promise<CreateResult | null> => {
    if (creating) return null;
    setCreating(true);
    setError(null);
    try {
      const { key, createdLocal } = await ensureLocalKey();
      const registered = await registerWitnessPublicKey({
        publicKey: key.publicKey,
        algorithm: "ed25519"
      });
      setIdentity(registered);
      setHasLocalKey(true);
      setLocalKeyPublicKey(key.publicKey);
      return { identity: registered, createdLocal };
    } catch (e: any) {
      setError(String(e?.message || "Failed to create creator identity key."));
      return null;
    } finally {
      setCreating(false);
    }
  }, [creating]);

  const isServerIdentityPresent = Boolean(identity && !identity.revokedAt);
  const localMatchesServer = Boolean(
    isServerIdentityPresent &&
      hasLocalKey &&
      identity?.publicKey &&
      localKeyPublicKey &&
      identity.publicKey === localKeyPublicKey
  );

  let state: WitnessIdentityState;
  if (error) {
    state = "error";
  } else if (isServerIdentityPresent && localMatchesServer) {
    state = "ready";
  } else if (isServerIdentityPresent) {
    state = "registeredMissingLocalKey";
  } else if (!isServerIdentityPresent && hasLocalKey) {
    state = "localKeyUnregistered";
  } else {
    state = "noIdentity";
  }

  return {
    state,
    identity,
    hasLocalKey,
    localKeyPublicKey,
    loading,
    creating,
    error,
    createIdentity,
    refresh
  };
}

export type WitnessIdentityHookResult = ReturnType<typeof useWitnessIdentity>;
