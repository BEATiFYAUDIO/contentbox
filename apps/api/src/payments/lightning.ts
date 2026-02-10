export async function createLightningInvoice(amountSats: bigint, memo: string) {
  const url = process.env.LNBITS_URL;
  const key = process.env.LNBITS_INVOICE_KEY;
  if (!url || !key) return null;

  const res = await fetch(`${url.replace(/\/$/, "")}/api/v1/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": key },
    body: JSON.stringify({ out: false, amount: Number(amountSats), memo })
  });

  const data: any = await res.json();
  if (!res.ok) throw new Error(data?.detail || "LNbits invoice error");

  return {
    bolt11: data.payment_request as string,
    providerId: data.payment_hash as string,
    expiresAt: data.expires_at ? new Date(Number(data.expires_at) * 1000).toISOString() : null
  };
}

export async function checkLightningInvoice(providerId: string) {
  const url = process.env.LNBITS_URL;
  const key = process.env.LNBITS_INVOICE_KEY;
  if (!url || !key) return { paid: false as const };

  const res = await fetch(`${url.replace(/\/$/, "")}/api/v1/payments/${encodeURIComponent(providerId)}`, {
    method: "GET",
    headers: { "X-Api-Key": key }
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data?.detail || "LNbits check error");
  return { paid: Boolean(data?.paid), paidAt: data?.paid_at ? new Date(Number(data.paid_at) * 1000).toISOString() : null };
}
