# Certifyd Core Windows x64 Packaging

This packaging layer wraps the existing Certifyd Core local web runtime. It does not replace Core with a desktop framework.

Installer choice: Inno Setup. It is lightweight, supports per-user installs, Start Menu/Desktop shortcuts, uninstall entries, icons, version metadata, post-install launch, and leaves user data outside the replaceable application directory.

## Layout

- Application/runtime files: `%LOCALAPPDATA%\Certifyd Core`
- Persistent Core user data: `%LOCALAPPDATA%\ContentBox`
- User runtime config: `%LOCALAPPDATA%\ContentBox\config\api.env`
- SQLite database: `%LOCALAPPDATA%\ContentBox\contentbox.db`
- Logs: `%LOCALAPPDATA%\ContentBox\logs`

Uninstall removes installed application/runtime files. It does not remove `%LOCALAPPDATA%\ContentBox`.

## Build Host

Build this artifact on Windows 10/11 x64 so native dependencies and Prisma engines are Windows-compatible.

Required on the build machine:

- PowerShell
- Internet access for the Node runtime download
- Inno Setup 6 with `ISCC.exe` available in PATH or installed under `Program Files`

The end user does not need Git, Node.js, npm, or Prisma.

## Build

From the repository root on Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-windows-installer.ps1
```

The script bundles Node `20.19.0` for Windows x64, installs Windows-compatible dependencies into staging, builds the dashboard, generates the Prisma client, validates the expected runtime files, and invokes Inno Setup.

Output:

```text
.dist\windows-x64\installer\Certifyd-Core-Setup-<version>-win-x64.exe
```

## First Run

The Start Menu/Desktop launcher:

1. Uses the bundled Node binary.
2. Creates `%LOCALAPPDATA%\ContentBox` if missing.
3. Creates `%LOCALAPPDATA%\ContentBox\config\api.env` if missing.
4. Generates a JWT secret if missing.
5. Sets SQLite `DATABASE_URL` to `%LOCALAPPDATA%\ContentBox\contentbox.db`.
6. Creates the SQLite file only if missing.
7. Runs bundled Prisma validate/generate/db push.
8. Starts the existing API/runtime.
9. Opens `http://127.0.0.1:4000`.

Existing databases and user data are never truncated, overwritten, replaced, or deleted by the launcher.

## Optional External Tools

Cloudflared remains optional and managed by existing Core behavior when public sharing is enabled. FFmpeg is not bundled in this first Windows packaging pass; media flows that shell out to `ffmpeg` still require it when those optional transformations are used.
