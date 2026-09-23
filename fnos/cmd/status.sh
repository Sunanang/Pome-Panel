#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="${FNOS_RUNTIME_DIR:-$ROOT/runtime}"
DATA_DIR="${FNOS_DATA_DIR:-$ROOT/data}"
PID_FILE="${FNOS_PID_FILE:-$RUNTIME_DIR/server.pid}"
if [[ -n "${FNOS_DEVICE_PORT_FILE:-}" ]]; then
  DEVICE_PORT_FILE="$FNOS_DEVICE_PORT_FILE"
elif [[ -n "${TRIM_PKGETC:-}" && -f "$TRIM_PKGETC/device-port" ]]; then
  DEVICE_PORT_FILE="$TRIM_PKGETC/device-port"
else
  DEVICE_PORT_FILE="$DATA_DIR/device-port"
fi
LEGACY_DEVICE_PORT_FILE="$RUNTIME_DIR/device-port.txt"
SOCKET_PATH="${FNOS_SOCKET_PATH:-$RUNTIME_DIR/pomepanel-sync.sock}"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  PORT="—"
  if [[ -f "$DEVICE_PORT_FILE" ]]; then
    PORT="$(tr -d '[:space:]' <"$DEVICE_PORT_FILE")"
  elif [[ -f "$LEGACY_DEVICE_PORT_FILE" ]]; then
    PORT="$(tr -d '[:space:]' <"$LEGACY_DEVICE_PORT_FILE")"
  fi
  echo "running pid=$(cat "$PID_FILE") socket=$SOCKET_PATH devicePort=$PORT"
  exit 0
fi
echo "stopped"
exit 1
