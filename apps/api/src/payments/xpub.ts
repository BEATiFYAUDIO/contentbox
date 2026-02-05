import * as bitcoin from "bitcoinjs-lib";
import { BIP32Factory } from "bip32";
import * as ecc from "tiny-secp256k1";

const bip32 = BIP32Factory(ecc as any);

const NETWORK = (process.env.ONCHAIN_NETWORK || "mainnet").toLowerCase() === "testnet"
  ? bitcoin.networks.testnet
  : bitcoin.networks.bitcoin;

export const deriveFromXpub = {
  async nextIndex(): Promise<number> {
    const current = Number(process.env.ONCHAIN_XPUB_INDEX || "0");
    const next = current + 1;
    process.env.ONCHAIN_XPUB_INDEX = String(next);
    return next;
  },
  async addressAt(xpub: string, index: number): Promise<string> {
    const node = bip32.fromBase58(xpub, NETWORK);
    const child = node.derive(0).derive(index);
    const { address } = bitcoin.payments.p2wpkh({ pubkey: child.publicKey, network: NETWORK });
    if (!address) throw new Error("Failed to derive address");
    return address;
  }
};
