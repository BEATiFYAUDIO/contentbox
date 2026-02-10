import process from "node:process";

type RangeCase = { label: string; start: number; end: number };

async function fetchRange(url: string, start: number, end: number) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  const buf = new Uint8Array(await res.arrayBuffer());
  return { res, buf };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: tsx src/scripts/range_test.ts <content_url>");
    process.exit(1);
  }

  const head = await fetch(url, { method: "HEAD" });
  assert(head.ok, `HEAD failed: ${head.status}`);
  const lenHeader = head.headers.get("content-length");
  assert(Boolean(lenHeader), "HEAD missing Content-Length");
  const size = Number(lenHeader || 0);
  assert(Number.isFinite(size) && size > 0, "Invalid Content-Length");
  const acceptRanges = head.headers.get("accept-ranges");
  assert(acceptRanges === "bytes", "Accept-Ranges must be bytes");

  const oneMb = 1024 * 1024;
  const ranges: RangeCase[] = [];
  ranges.push({ label: "first", start: 0, end: Math.min(size - 1, oneMb - 1) });
  const midStart = Math.max(0, Math.floor(size / 2) - Math.floor(oneMb / 2));
  ranges.push({ label: "middle", start: midStart, end: Math.min(size - 1, midStart + oneMb - 1) });
  const lastStart = Math.max(0, size - oneMb);
  ranges.push({ label: "last", start: lastStart, end: Math.max(0, size - 1) });

  for (const r of ranges) {
    const { res, buf } = await fetchRange(url, r.start, r.end);
    assert(res.status === 206, `${r.label} range expected 206, got ${res.status}`);
    const cr = res.headers.get("content-range");
    if (!cr) throw new Error(`${r.label} missing Content-Range`);
    assert(cr.startsWith(`bytes ${r.start}-`), `${r.label} Content-Range start mismatch: ${cr}`);
    const expectedLen = r.end - r.start + 1;
    assert(buf.length === expectedLen, `${r.label} bytes mismatch: ${buf.length} !== ${expectedLen}`);
  }

  console.log("Range tests OK", { url, size });
}

main().catch((err) => {
  console.error("Range tests failed:", err?.message || err);
  process.exit(1);
});
