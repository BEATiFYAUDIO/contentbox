import process from "node:process";

async function main() {
  const apiBase = process.argv[2] || "http://127.0.0.1:4000";
  const manifestHash = process.argv[3];
  const fileId = process.argv[4];
  if (!manifestHash || !fileId) {
    console.error("Usage: tsx src/scripts/permit_range_test.ts <apiBase> <manifestHash> <fileId>");
    process.exit(1);
  }

  const permitRes = await fetch(`${apiBase}/p2p/permits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manifestHash, fileId, buyerId: "test@example.com", requestedScope: "preview" })
  });
  const permit: any = await permitRes.json();
  if (!permit?.permit) throw new Error("Permit missing");

  const url = `${apiBase}/content/${manifestHash}/${encodeURIComponent(fileId)}?t=${encodeURIComponent(permit.permit)}`;
  const head = await fetch(url, { method: "HEAD" });
  console.log("HEAD", head.status, head.headers.get("x-contentbox-access"), head.headers.get("content-length"));

  const range = await fetch(url, { headers: { Range: "bytes=0-1048575" } });
  console.log("RANGE", range.status, range.headers.get("content-range"), range.headers.get("x-contentbox-access"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
