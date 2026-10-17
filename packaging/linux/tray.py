#!/usr/bin/env python3
"""Optional desktop indicator; the packaged control.sh remains the lifecycle owner."""

import fcntl
import os
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


APP = Path(__file__).resolve().parent
CONTROL = APP / "control.sh"
ROOT = Path(os.environ.get("CONTENTBOX_ROOT") or Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "contentbox")
STATE = ROOT / "state"


def dashboard_url():
    env_file = ROOT / "config/api.env"
    values = {}
    try:
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                if key in ("PORT", "APP_BASE_URL"):
                    values[key] = value.strip().strip("\"'")
    except OSError:
        pass
    return values.get("APP_BASE_URL") or "http://127.0.0.1:{}".format(values.get("PORT", "4000"))


def healthy():
    try:
        pid = int((STATE / "certifyd-core.pid").read_text().strip())
        command = (Path("/proc") / str(pid) / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
        if str(APP / "runtime/node/bin/node") not in command or "src/server.ts" not in command:
            return False
    except (OSError, ValueError):
        return False
    url = dashboard_url()
    # Health must be checked locally even when APP_BASE_URL is a LAN address.
    port = urllib.parse.urlparse(url).port or 4000
    try:
        with urllib.request.urlopen("http://127.0.0.1:{}/health".format(port), timeout=1.5) as response:
            return 200 <= response.status < 300
    except (OSError, urllib.error.URLError):
        return False


def control(action):
    env = dict(os.environ, CONTENTBOX_ROOT=str(ROOT))
    return subprocess.run([str(CONTROL), action], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode


def open_dashboard():
    subprocess.Popen(["xdg-open", dashboard_url()], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    STATE.mkdir(parents=True, exist_ok=True)
    lock = open(STATE / "desktop-tray.lock", "a+")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        open_dashboard()
        return 0

    try:
        import gi
        gi.require_version("Gtk", "3.0")
        from gi.repository import GLib, Gtk
        try:
            gi.require_version("AyatanaAppIndicator3", "0.1")
            from gi.repository import AyatanaAppIndicator3 as Indicator
        except (ImportError, ValueError):
            try:
                gi.require_version("AppIndicator3", "0.1")
                from gi.repository import AppIndicator3 as Indicator
            except (ImportError, ValueError):
                Indicator = None
    except (ImportError, ValueError):
        control("start")
        return 0

    menu = Gtk.Menu()
    status = Gtk.MenuItem(label="Checking Core…")
    status.set_sensitive(False)
    menu.append(status)

    def add(label, callback):
        item = Gtk.MenuItem(label=label)
        item.connect("activate", lambda _item: callback())
        menu.append(item)
        return item

    open_item = add("Open Dashboard", open_dashboard)
    start_item = add("Start Core", lambda: run_action("start"))
    stop_item = add("Stop Core", lambda: run_action("stop"))
    menu.append(Gtk.SeparatorMenuItem())
    add("View Logs", lambda: subprocess.Popen(["xdg-open", str(ROOT / "logs")]))
    add("Quit Certifyd Core", lambda: run_action("quit"))
    menu.show_all()

    icon_path = str(APP / "assets/certifyd-core.png")
    if Indicator:
        icon = Indicator.Indicator.new("certifyd-core", icon_path, Indicator.IndicatorCategory.APPLICATION_STATUS)
        icon.set_status(Indicator.IndicatorStatus.ACTIVE)
        icon.set_menu(menu)
    else:
        icon = Gtk.StatusIcon.new_from_file(icon_path)
        icon.set_tooltip_text("Certifyd Core")
        icon.connect("popup-menu", lambda _icon, button, when: menu.popup(None, None, Gtk.StatusIcon.position_menu, icon, button, when))
        icon.connect("activate", lambda _icon: open_dashboard())

    busy = False

    def refresh():
        if not busy:
            def check():
                running = healthy()
                GLib.idle_add(lambda: update(running))
            threading.Thread(target=check, daemon=True).start()
        return True

    def update(running):
        if busy:
            return False
        status.set_label("Core running" if running else "Core stopped or unavailable")
        start_item.set_sensitive(not running and not busy)
        stop_item.set_sensitive(running and not busy)
        open_item.set_sensitive(running)
        return False

    def run_action(action):
        nonlocal busy
        if busy:
            return
        busy = True
        status.set_label("Stopping Core…" if action in ("stop", "quit") else "Starting Core…")
        start_item.set_sensitive(False)
        stop_item.set_sensitive(False)

        def work():
            control("stop" if action == "quit" else action)
            if action == "quit":
                GLib.idle_add(Gtk.main_quit)
            else:
                GLib.idle_add(done)

        def done():
            nonlocal busy
            busy = False
            refresh()
            return False

        threading.Thread(target=work, daemon=True).start()

    GLib.timeout_add_seconds(8, refresh)
    if not Indicator:
        def tray_available():
            if not icon.is_embedded():
                if busy:
                    return True
                Gtk.main_quit()
            return False
        GLib.timeout_add_seconds(3, tray_available)
    initially_running = healthy()
    update(initially_running)
    if not initially_running:
        run_action("start")
    Gtk.main()
    return 0


if __name__ == "__main__":
    sys.exit(main())
