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

STORAGE_MODE="${STORAGE:-}"
if [[ -z "$STORAGE_MODE" ]]; then
  if [[ "${DB_MODE:-basic}" == "advanced" ]]; then
    STORAGE_MODE="postgres"
  else
    STORAGE_MODE="sqlite"
  fi
fi

if [[ "$STORAGE_MODE" != "postgres" ]]; then
  echo "Backups require STORAGE=postgres." >&2
  exit 1
fi

if [[ "$DB_URL" != postgres* ]]; then
  echo "DATABASE_URL is not Postgres. Backups require STORAGE=postgres." >&2
  exit 1
fi

DATA_ROOT="${CONTENTBOX_ROOT:-$ROOT_DIR}"
BACKUP_DIR="${CONTENTBOX_BACKUP_DIR:-$DATA_ROOT/backups}"
RETENTION_DAYS="${CONTENTBOX_BACKUP_RETENTION_DAYS:-30}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
OUT="$BACKUP_DIR/contentbox-$STAMP.dump"

pg_dump --format=custom --file "$OUT" "$DB_URL"
echo "Backup created: $OUT"

# Retention: delete old backups
find "$BACKUP_DIR" -type f -name "contentbox-*.dump" -mtime +"$RETENTION_DAYS" -print -delete
