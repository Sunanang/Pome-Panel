#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Same path order as start.sh. Do not create directories under the install tree.
if [[ -n "${FNOS_RUNTIME_DIR:-}" ]]; then
  RUNTIME_DIR="$FNOS_RUNTIME_DIR"
elif [[ -n "${TRIM_PKGVAR:-}" ]]; then
  RUNTIME_DIR="$TRIM_PKGVAR/runtime"
else
  RUNTIME_DIR="$ROOT/runtime"
fi
PID_FILE="${FNOS_PID_FILE:-$RUNTIME_DIR/server.pid}"
if [[ -n "${FNOS_SOCKET_PATH:-}" ]]; then
  SOCKET_PATH="$FNOS_SOCKET_PATH"
elif [[ -n "${TRIM_APPDEST:-}" ]]; then
  SOCKET_PATH="$TRIM_APPDEST/app.sock"
else
  SOCKET_PATH="$RUNTIME_DIR/pomepanel-sync.sock"
fi

if [[ ! -f "$PID_FILE" ]]; then
  echo "not running"
  exit 0
fi
PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID" || true
  for _ in 1 2 3 4 5; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.2
  done
  kill -9 "$PID" 2>/dev/null || true
fi
rm -f "$PID_FILE"
rm -f "$SOCKET_PATH"
echo "stopped"
