#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
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

DATA_ROOT="${CONTENTBOX_ROOT:-$ROOT_DIR}"
BACKUP_DIR="${CONTENTBOX_BACKUP_DIR:-$DATA_ROOT/backups}"
RETENTION_DAYS="${CONTENTBOX_BACKUP_RETENTION_DAYS:-30}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
if [[ "$DB_URL" == postgres* ]]; then
  OUT="$BACKUP_DIR/contentbox-$STAMP.dump"
  pg_dump --format=custom --file "$OUT" "$DB_URL"
  echo "Postgres backup created: $OUT"
elif [[ "$DB_URL" == file:* ]]; then
  REL_PATH="${DB_URL#file:}"
  REL_PATH="${REL_PATH%%\?*}"
  REL_PATH="${REL_PATH%%\#*}"
  if [[ -z "$REL_PATH" ]]; then
    echo "Invalid SQLite DATABASE_URL path." >&2
    exit 1
  fi
  if [[ "$REL_PATH" = /* ]]; then
    SRC="$REL_PATH"
  else
    SRC="$(cd "$ROOT_DIR/apps/api" && realpath "$REL_PATH")"
  fi
  if [[ ! -f "$SRC" ]]; then
    echo "SQLite database file not found: $SRC" >&2
    exit 1
  fi
  OUT="$BACKUP_DIR/contentbox-$STAMP.sqlite"
  cp "$SRC" "$OUT"
  echo "SQLite backup created: $OUT"
else
  echo "Unsupported DATABASE_URL for backup: $DB_URL" >&2
  exit 1
fi

# Retention: delete old backups
find "$BACKUP_DIR" -type f \( -name "contentbox-*.dump" -o -name "contentbox-*.sqlite" \) -mtime +"$RETENTION_DAYS" -print -delete
