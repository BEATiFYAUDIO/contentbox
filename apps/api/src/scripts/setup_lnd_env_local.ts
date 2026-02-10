import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";

function expandHome(input: string): string {
  if (!input.startsWith("~")) return input;
  return path.join(os.homedir(), input.slice(1));
}

function maskPath(p: string) {
  const parts = p.split(path.sep).filter(Boolean);
  if (parts.length <= 2) return p;
  return `${path.sep}…${path.sep}${parts.slice(-2).join(path.sep)}`;
}

function hasProcessEnv() {
  const rest = String(process.env.LND_REST_URL || "").trim();
  const mac = String(process.env.LND_MACAROON_HEX || process.env.LND_MACAROON || "").trim();
  const cert = String(process.env.LND_TLS_CERT_PEM || process.env.LND_TLS_CERT_PATH || "").trim();
  return Boolean(rest && mac && cert);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const urlArg = args.find((arg) => arg.startsWith("--url="));
  const url = urlArg ? urlArg.replace("--url=", "").trim() : "";
  return { force, url };
}

function findReadableFile(candidates: string[]) {
  for (const candidate of candidates) {
    const expanded = expandHome(candidate);
    if (!fsSync.existsSync(expanded)) continue;
    try {
      fsSync.accessSync(expanded, fsSync.constants.R_OK);
      return fsSync.realpathSync(expanded);
    } catch {
      continue;
    }
  }
  return null;
}

function printMissingHints() {
  console.error("Could not auto-discover LND files.");
  console.error("Checked:");
  console.error("- ~/.lnd/tls.cert");
  console.error("- ~/.lnd/data/chain/bitcoin/<network>/invoices.macaroon");
  console.error("Next steps:");
  console.error("- If LND runs under systemd/docker, set env there (LND_REST_URL, LND_MACAROON_HEX, LND_TLS_CERT_PATH).");
  console.error("- Or create apps/api/.env.local manually with the values.");
}

async function main() {
  const { force, url } = parseArgs();

  if (hasProcessEnv()) {
    console.log("LND env already present in process.env; no file written.");
    process.exit(0);
  }

  const tlsCert = findReadableFile(["~/.lnd/tls.cert"]);
  const macaroon = findReadableFile([
    "~/.lnd/data/chain/bitcoin/mainnet/invoices.macaroon",
    "~/.lnd/data/chain/bitcoin/testnet/invoices.macaroon",
    "~/.lnd/data/chain/bitcoin/regtest/invoices.macaroon"
  ]);

  if (!tlsCert || !macaroon) {
    printMissingHints();
    process.exit(2);
  }

  const cwd = process.cwd();
  const envLocalPath = path.resolve(cwd, ".env.local");
  if (fsSync.existsSync(envLocalPath) && !force) {
    console.log("apps/api/.env.local already exists. Use --force to overwrite.");
    process.exit(0);
  }

  const restUrl = url || "https://127.0.0.1:8080";
  const macaroonHex = fsSync.readFileSync(macaroon).toString("hex");

  const contents = [
    `LND_REST_URL=${restUrl}`,
    `LND_MACAROON_HEX=${macaroonHex}`,
    `LND_TLS_CERT_PATH=${tlsCert}`,
    ""
  ].join("\n");

  fsSync.writeFileSync(envLocalPath, contents, { mode: 0o600 });
  fsSync.chmodSync(envLocalPath, 0o600);

  console.log("Wrote apps/api/.env.local with LND settings.");
  console.log("LND_REST_URL:", restUrl);
  console.log("Macaroon length:", String(macaroonHex.length));
  console.log("TLS cert:", maskPath(tlsCert));
  console.log("Macaroon file:", maskPath(macaroon));
}

main().catch((err) => {
  console.error("Setup failed:", String(err?.message || err));
  process.exit(99);
});
