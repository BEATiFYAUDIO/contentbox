import crypto from "node:crypto";
import { getOrCreateMasterKey } from "./masterKey.js";

type EncodedSecret = {
  ciphertextB64: string;
  ivB64: string;
  tagB64: string;
};

export function encryptSecret(plaintext: Buffer): EncodedSecret {
  const key = getOrCreateMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertextB64: ciphertext.toString("base64"),
    ivB64: iv.toString("base64"),
    tagB64: tag.toString("base64")
  };
}

export function decryptSecret(input: { ciphertextB64: string; ivB64: string; tagB64: string }): Buffer {
  const key = getOrCreateMasterKey();
  const iv = Buffer.from(input.ivB64, "base64");
  const tag = Buffer.from(input.tagB64, "base64");
  const ciphertext = Buffer.from(input.ciphertextB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

