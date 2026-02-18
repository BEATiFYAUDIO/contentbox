#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="$ROOT_DIR/apps/api/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

DB_URL="${DATABASE_URL:-}"
if [[ -z "$DB_URL" ]]; then
  echo "DATABASE_URL not set. Check apps/api/.env" >&2
  exit 1
fi

if [[ "$DB_URL" != postgres* ]]; then
  echo "DATABASE_URL is not Postgres. Backups require DB_MODE=advanced." >&2
  exit 1
fi

DATA_ROOT="${CONTENTBOX_ROOT:-$ROOT_DIR}"
BACKUP_DIR="${CONTENTBOX_BACKUP_DIR:-$DATA_ROOT/backups}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
OUT="$BACKUP_DIR/contentbox-$STAMP.dump"

pg_dump --format=custom --file "$OUT" "$DB_URL"
echo "Backup created: $OUT"
