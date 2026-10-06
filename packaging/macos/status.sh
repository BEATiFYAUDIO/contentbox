#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
resources_dir="$script_dir"
node_bin="$resources_dir/runtime/node/bin/node"
data_root="${CONTENTBOX_ROOT:-"$HOME/Library/Application Support/ContentBox"}"
pid_file="$data_root/state/certifyd-core.pid"
port="${PORT:-4000}"
health_url="http://127.0.0.1:$port/health"

process_id="none"
alive="false"
if [[ -f "$pid_file" ]]; then
  parsed_pid="$(tr -dc '0-9' <"$pid_file" || true)"
  if [[ -n "$parsed_pid" ]]; then
    process_id="$parsed_pid"
    if kill -0 "$parsed_pid" >/dev/null 2>&1; then
      alive="true"
    fi
  fi
fi

health="false"
if [[ -x "$node_bin" ]]; then
  if "$node_bin" -e '
    const http = require("http");
    const req = http.get(process.argv[1], { timeout: 1500 }, (res) => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      res.resume();
      res.on("end", () => process.exit(ok ? 0 : 1));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => process.exit(1));
  ' "$health_url" >/dev/null 2>&1; then
    health="true"
  fi
fi

echo "Certifyd Core"
echo "  Data:   $data_root"
echo "  PID:    $process_id"
echo "  Alive:  $alive"
echo "  Health: $health"
echo "  URL:    http://127.0.0.1:$port"
