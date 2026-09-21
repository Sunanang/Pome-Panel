#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="${FNOS_RUNTIME_DIR:-$ROOT/runtime}"
PID_FILE="${FNOS_PID_FILE:-$RUNTIME_DIR/server.pid}"
SOCKET_PATH="${FNOS_SOCKET_PATH:-$RUNTIME_DIR/pomepanel-sync.sock}"

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
