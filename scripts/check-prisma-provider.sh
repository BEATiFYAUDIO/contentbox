#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA_FILE="${ROOT_DIR}/apps/api/prisma/schema.prisma"
LOCK_FILE="${ROOT_DIR}/apps/api/prisma/migrations/migration_lock.toml"

if [[ ! -f "${SCHEMA_FILE}" ]]; then
  echo "[prisma-provider-check] Missing schema file: ${SCHEMA_FILE}" >&2
  exit 1
fi

if [[ ! -f "${LOCK_FILE}" ]]; then
  echo "[prisma-provider-check] Missing migration lock file: ${LOCK_FILE}" >&2
  exit 1
fi

schema_provider="$(grep -E '^[[:space:]]*provider[[:space:]]*=' "${SCHEMA_FILE}" | head -n 2 | tail -n 1 | sed -E 's/.*"([^"]+)".*/\1/')"
lock_provider="$(grep -E '^[[:space:]]*provider[[:space:]]*=' "${LOCK_FILE}" | head -n 1 | sed -E 's/.*"([^"]+)".*/\1/')"

if [[ -z "${schema_provider}" || -z "${lock_provider}" ]]; then
  echo "[prisma-provider-check] Could not parse provider values." >&2
  exit 1
fi

if [[ "${schema_provider}" != "${lock_provider}" ]]; then
  echo "[prisma-provider-check] Provider mismatch detected." >&2
  echo "[prisma-provider-check] schema.prisma provider: ${schema_provider}" >&2
  echo "[prisma-provider-check] migration_lock provider: ${lock_provider}" >&2
  exit 1
fi

echo "[prisma-provider-check] Provider aligned: ${schema_provider}"
