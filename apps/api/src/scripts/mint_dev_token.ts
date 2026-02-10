import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import crypto from "node:crypto";
import fsSync from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

function loadEnvWithPriority() {
  const cwd = process.cwd();
  const envLocalPath = path.resolve(cwd, ".env.local");
  const envPath = path.resolve(cwd, ".env");
  const parsedLocal = fsSync.existsSync(envLocalPath)
    ? dotenv.parse(fsSync.readFileSync(envLocalPath))
    : null;
  const parsedEnv = fsSync.existsSync(envPath)
    ? dotenv.parse(fsSync.readFileSync(envPath))
    : null;

  dotenv.config({ path: envLocalPath, override: false });
  dotenv.config({ path: envPath, override: false });

  function sourceFor(name: string) {
    if (process.env[name]) return "process.env";
    if (parsedLocal && Object.prototype.hasOwnProperty.call(parsedLocal, name)) return ".env.local";
    if (parsedEnv && Object.prototype.hasOwnProperty.call(parsedEnv, name)) return ".env";
    return "not found";
  }

  return { sourceFor };
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function signJwt(payload: Record<string, any>, secret: string) {
  const header = { alg: "HS256", typ: "JWT" };
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
  const encoded = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  const sig = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

let prisma: PrismaClient | null = null;

async function main() {
  const { sourceFor } = loadEnvWithPriority();
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    console.error(`Missing DATABASE_URL (source: ${sourceFor("DATABASE_URL")}). Length=0`);
    process.exit(2);
  }

  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret) {
    console.error(`Missing JWT_SECRET (source: ${sourceFor("JWT_SECRET")}). Length=0`);
    process.exit(2);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });

  const userIdArg = process.argv.find((a) => a.startsWith("--userId="));
  const userId = userIdArg ? userIdArg.split("=").slice(1).join("=") : "";

  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });

  if (!user) {
    console.error("No user found. Provide --userId=<id> or create a user first.");
    process.exit(2);
  }

  const token = signJwt({ sub: user.id }, secret);
  console.log(token);
}

main()
  .catch((err) => {
    console.error("mint_dev_token failed:", String(err?.message || err));
    process.exit(1);
  })
  .finally(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });
