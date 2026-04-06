#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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

BACKUP_INPUT="${1:-${BACKUP_FILE:-}}"
if [[ -z "$BACKUP_INPUT" ]]; then
  echo "Usage: $0 <backup-file>" >&2
  echo "Example: $0 /home/<user>/contentbox-data/backups/contentbox-2026-04-02T12-00-00Z.sqlite" >&2
  exit 1
fi

if [[ "$DB_URL" == postgres* ]]; then
  echo "Postgres restore is intentionally manual in this script." >&2
  echo "Use: pg_restore --clean --if-exists --no-owner --dbname \"\$DATABASE_URL\" \"$BACKUP_INPUT\"" >&2
  exit 2
fi

if [[ "$DB_URL" != file:* ]]; then
  echo "Unsupported DATABASE_URL for restore: $DB_URL" >&2
  exit 1
fi

REL_PATH="${DB_URL#file:}"
REL_PATH="${REL_PATH%%\?*}"
REL_PATH="${REL_PATH%%\#*}"
if [[ -z "$REL_PATH" ]]; then
  echo "Invalid SQLite DATABASE_URL path." >&2
  exit 1
fi

if [[ "$REL_PATH" = /* ]]; then
  DEST_DB="$REL_PATH"
else
  DEST_DB="$(cd "$ROOT_DIR/apps/api" && realpath "$REL_PATH")"
fi

if [[ ! -f "$BACKUP_INPUT" ]]; then
  echo "Backup file not found: $BACKUP_INPUT" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST_DB")"
STAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
PRE_RESTORE_BACKUP="${DEST_DB}.pre-restore-${STAMP}.sqlite"

if [[ -f "$DEST_DB" ]]; then
  cp "$DEST_DB" "$PRE_RESTORE_BACKUP"
  echo "Created safety backup: $PRE_RESTORE_BACKUP"
fi

cp "$BACKUP_INPUT" "$DEST_DB"
echo "Restored SQLite database from: $BACKUP_INPUT"
echo "Destination: $DEST_DB"
echo "Next: restart API/dashboard processes."
