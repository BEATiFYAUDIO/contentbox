export function allocateByBps(
  poolSats: bigint,
  items: Array<{ id: string; bps: number }>
): Array<{ id: string; amountSats: bigint }> {
  if (!items.length) return [];
  const normalized = items.map((i) => ({ id: i.id, bps: Math.max(0, Math.floor(i.bps)) }));
  const totalBps = normalized.reduce((s, i) => s + i.bps, 0);
  if (totalBps <= 0) {
    return normalized.map((i) => ({ id: i.id, amountSats: 0n }));
  }

  const base = normalized.map((i) => {
    const amt = (poolSats * BigInt(i.bps)) / BigInt(totalBps);
    return { id: i.id, amountSats: amt, bps: i.bps };
  });

  const allocated = base.reduce((s, i) => s + i.amountSats, 0n);
  const leftover = poolSats - allocated;

  if (leftover > 0n) {
    let maxBps = -1;
    let maxIdx = 0;
    base.forEach((i, idx) => {
      if (i.bps > maxBps || (i.bps === maxBps && i.id.localeCompare(base[maxIdx].id) < 0)) {
        maxBps = i.bps;
        maxIdx = idx;
      }
    });
    base[maxIdx] = { ...base[maxIdx], amountSats: base[maxIdx].amountSats + leftover };
  }

  return base.map((i) => ({ id: i.id, amountSats: i.amountSats }));
}

export function sumBps(values: Array<{ bps: number }>): number {
  return values.reduce((s, v) => s + Math.max(0, Math.floor(v.bps)), 0);
}
