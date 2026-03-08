#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const schemaFile = path.join(rootDir, "apps", "api", "prisma", "schema.prisma");
const lockFile = path.join(
  rootDir,
  "apps",
  "api",
  "prisma",
  "migrations",
  "migration_lock.toml",
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readFileOrFail(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`[prisma-provider-check] Missing ${label}: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseSchemaProvider(schemaText) {
  const datasourceBlockMatch = schemaText.match(/datasource\s+\w+\s*\{[\s\S]*?\}/m);
  if (!datasourceBlockMatch) return "";
  const providerMatch = datasourceBlockMatch[0].match(/provider\s*=\s*"([^"]+)"/);
  return providerMatch ? providerMatch[1] : "";
}

function parseLockProvider(lockText) {
  const providerMatch = lockText.match(/provider\s*=\s*"([^"]+)"/);
  return providerMatch ? providerMatch[1] : "";
}

const schemaText = readFileOrFail(schemaFile, "schema file");
const lockText = readFileOrFail(lockFile, "migration lock file");

const schemaProvider = parseSchemaProvider(schemaText);
const lockProvider = parseLockProvider(lockText);

if (!schemaProvider || !lockProvider) {
  fail("[prisma-provider-check] Could not parse provider values.");
}

if (schemaProvider !== lockProvider) {
  fail(
    [
      "[prisma-provider-check] Provider mismatch detected.",
      `[prisma-provider-check] schema.prisma provider: ${schemaProvider}`,
      `[prisma-provider-check] migration_lock provider: ${lockProvider}`,
    ].join("\n"),
  );
}

console.log(`[prisma-provider-check] Provider aligned: ${schemaProvider}`);
