# Crash Recovery (ContentBox / Certifyd)

This runbook restores a local node after crash/corruption using the existing backup path and account recovery flow.

## What already exists

- Account recovery key is issued at first signup.
- Backups are written under:
  - `${CONTENTBOX_ROOT}/backups`
  - default Linux example: `/home/<user>/contentbox-data/backups`

## 1. Stop app processes

Stop API + dashboard before restoring the database.

## 2. Locate backup file

Pick a backup from `${CONTENTBOX_ROOT}/backups`, for example:

- `contentbox-2026-04-02T12-00-00Z.sqlite`

## 3. Restore database (SQLite)

### Linux/macOS

```bash
bash ops/recovery/restore_db.sh /absolute/path/to/contentbox-YYYY-MM-DDTHH-mm-ssZ.sqlite
```

### Windows PowerShell

```powershell
powershell -ExecutionPolicy Bypass -File .\ops\recovery\restore_db.ps1 -BackupFile "C:\path\to\contentbox-YYYY-MM-DDTHH-mm-ssZ.sqlite"
```

Notes:

- A pre-restore safety copy of the current DB is created automatically.
- Restore script uses `apps/api/.env` (`DATABASE_URL`) to find destination DB.

## 4. Restart services

Start API/dashboard normally after restore.

## 5. If login fails after restart

- Use account recovery flow in auth UI (`/auth/recovery/reset`) with your recovery key.
- If JWT/session drift happened, sign out and sign in again.

## 6. Quick integrity checks

- `/health` returns `{ "ok": true }`
- Profile loads with expected avatar/content
- Revenue/Royalties pages show expected historical rows
- Recent receipts and payouts appear in Diagnostics/Finance
