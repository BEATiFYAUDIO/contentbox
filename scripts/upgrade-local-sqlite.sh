#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="${ROOT_DIR}/apps/api"
SCHEMA_PATH="prisma/schema.prisma"

echo "[upgrade-local-sqlite] Repo: ${ROOT_DIR}"
echo "[upgrade-local-sqlite] API:  ${API_DIR}"

cd "${API_DIR}"

echo "[upgrade-local-sqlite] Step 1/2: prisma generate"
npx prisma generate --schema "${SCHEMA_PATH}"

echo "[upgrade-local-sqlite] Step 2/2: prisma migrate deploy"
set +e
MIGRATE_OUTPUT="$(npx prisma migrate deploy --schema "${SCHEMA_PATH}" 2>&1)"
MIGRATE_EXIT=$?
set -e

if [[ ${MIGRATE_EXIT} -eq 0 ]]; then
  echo "${MIGRATE_OUTPUT}"
  echo "[upgrade-local-sqlite] Done. Restart your services."
  exit 0
fi

echo "${MIGRATE_OUTPUT}"

if echo "${MIGRATE_OUTPUT}" | grep -q "P3005"; then
  cat <<'MSG'
[upgrade-local-sqlite] Prisma reported P3005 (schema not empty / not baselined).
[upgrade-local-sqlite] This is common for long-lived local SQLite installs.

If your upgrade is additive metadata only, apply the known safe additive column manually:

  ALTER TABLE ContentItem ADD COLUMN primaryTopic TEXT;

Then run:

  cd apps/api
  npx prisma generate --schema prisma/schema.prisma

And restart:

  npm run dev:down
  npm run dev:up

See: docs/UPGRADING_LOCAL_NODE.md
MSG
  exit 2
fi

echo "[upgrade-local-sqlite] migrate deploy failed for a reason other than P3005."
exit ${MIGRATE_EXIT}

