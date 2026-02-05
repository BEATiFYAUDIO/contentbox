import crypto from "node:crypto";

type RpcResult = { result: any; error?: any };

function rpcUrl(): string | null {
  const base = process.env.BITCOIND_RPC_URL;
  if (!base) return null;
  const wallet = process.env.BITCOIND_WALLET;
  if (wallet) {
    return base.replace(/\/$/, "") + `/wallet/${encodeURIComponent(wallet)}`;
  }
  return base.replace(/\/$/, "");
}

async function rpcCall(method: string, params: any[] = []) {
  const url = rpcUrl();
  if (!url) throw new Error("BITCOIND_RPC_URL not configured");
  const user = process.env.BITCOIND_RPC_USER || "";
  const pass = process.env.BITCOIND_RPC_PASS || "";
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");

  const body = JSON.stringify({ jsonrpc: "1.0", id: crypto.randomUUID(), method, params });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body
  });
  const data = (await res.json()) as RpcResult;
  if (data.error) throw new Error(data.error?.message || "RPC error");
  return data.result;
}

export async function createOnchainAddress(intentId: string): Promise<{ address: string; derivationIndex?: number | null }> {
  const url = rpcUrl();
  if (url) {
    const address = await rpcCall("getnewaddress", [`contentbox_${intentId}`]);
    return { address, derivationIndex: null };
  }

  const xpub = process.env.ONCHAIN_RECEIVE_XPUB;
  if (!xpub) throw new Error("No on-chain receive strategy configured");
  const { deriveFromXpub } = await import("./xpub.js");
  const derivationIndex = await deriveFromXpub.nextIndex();
  const address = await deriveFromXpub.addressAt(xpub, derivationIndex);
  return { address, derivationIndex };
}

export async function checkOnchainPayment(address: string, minSats: bigint, minConfs: number) {
  const url = rpcUrl();
  if (!url) {
    return { paid: false as const, confirmations: 0 };
  }
  const received = await rpcCall("getreceivedbyaddress", [address, minConfs]);
  const sats = BigInt(Math.floor(Number(received) * 1e8));
  if (sats < minSats) return { paid: false as const, confirmations: minConfs };

  const txs = await rpcCall("listtransactions", ["*", 1000]);
  const match = Array.isArray(txs) ? txs.find((t: any) => t.address === address) : null;
  return {
    paid: true as const,
    txid: match?.txid || null,
    confirmations: match?.confirmations || minConfs,
    vout: match?.vout ?? null
  };
}
