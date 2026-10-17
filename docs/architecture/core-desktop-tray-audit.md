# Certifyd Core desktop lifecycle audit

Development branch: `fix/tunnel-public-routing`. This is a user-story audit note,
not a release or a change to the Sovereign Creator guide.

## Existing implementation and gaps

- Linux already packaged a recognizable `certifyd-core.desktop` entry with
  terminal-free launch and desktop actions backed by `control.sh`. It had no
  persistent tray indicator or visible running/stopped state.
- macOS already packaged `Certifyd Core.app` with a native `NSStatusItem` and
  separate Core process. It had no Start Core menu action or health state, and
  repeated app launches could create multiple menu-bar controllers. View Logs
  ignored `CONTENTBOX_ROOT`.
- Windows already installed one hidden-console desktop shortcut and a persistent
  NotifyIcon controller. It had no explicit Start Core action or health state in
  the tray menu. Existing launcher ownership and Beta 19 PowerShell regression
  checks remained in place.
- All three launchers default the private dashboard/API to 4000. The API's
  separate public creator listener defaults to 4010. Their stop helpers target
  the packaged Core process; API shutdown stops only Core-owned cloudflared
  children and the public listener, not an externally managed OS service.

## Focused correction

- Linux now uses the existing `control.sh` from an optional GTK/AppIndicator tray.
  On desktops without compatible tray support, the desktop actions remain the
  fallback and Core still starts without a terminal. One tray controller is
  allowed per data directory; state is read from owned PID plus local health.
- macOS now offers Start Core, displays owned-process health, prevents duplicate
  menu controllers with a per-data-directory lock, and uses the selected data
  root for View Logs. Closing the dashboard does not stop Core.
- Windows now offers Start Core and reports owned-process health when its tray
  menu opens. Its existing hidden-console controller and installer remain intact.
- Stop Core means stopping the Core process and its public listener. It does not
  revoke saved sharing consent or stop an OS-managed cloudflared service.

## Validation and remaining acceptance

- Focused launcher static tests, Linux syntax and no-tray fallback, and 128 public
  lifecycle tests passed.
- Native CI package/runtime validation passed for Linux x64/ARM64, macOS
  x64/ARM64, and Windows x64. These jobs run headlessly and do not prove the
  visual tray or menu-bar behavior.
- On physical desktops, verify tray/menu appearance, Start/Stop/Quit, status
  after a failed startup, repeated app launches, browser close/reopen, LAN URL,
  and preservation of external SysV/systemd/launchd/Windows cloudflared services.
- On Linux desktops without a StatusNotifier/AppIndicator host, verify the
  desktop shortcut actions are available and no invisible tray process remains.
