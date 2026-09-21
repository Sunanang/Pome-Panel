#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="${FNOS_RUNTIME_DIR:-$ROOT/runtime}"
PID_FILE="${FNOS_PID_FILE:-$RUNTIME_DIR/server.pid}"
DEVICE_PORT_FILE="${FNOS_DEVICE_PORT_FILE:-$RUNTIME_DIR/device-port.txt}"
SOCKET_PATH="${FNOS_SOCKET_PATH:-$RUNTIME_DIR/pomepanel-sync.sock}"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  PORT="—"
  [[ -f "$DEVICE_PORT_FILE" ]] && PORT="$(cat "$DEVICE_PORT_FILE")"
  echo "running pid=$(cat "$PID_FILE") socket=$SOCKET_PATH devicePort=$PORT"
  exit 0
fi
echo "stopped"
exit 1
