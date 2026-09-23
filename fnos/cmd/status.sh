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
if [[ -n "${FNOS_DATA_DIR:-}" ]]; then
  DATA_DIR="$FNOS_DATA_DIR"
elif [[ -n "${TRIM_PKGVAR:-}" ]]; then
  DATA_DIR="$TRIM_PKGVAR"
elif [[ -n "${TRIM_PKGHOME:-}" ]]; then
  DATA_DIR="$TRIM_PKGHOME"
else
  DATA_DIR="$ROOT/data"
fi
PID_FILE="${FNOS_PID_FILE:-$RUNTIME_DIR/server.pid}"
if [[ -n "${FNOS_DEVICE_PORT_FILE:-}" ]]; then
  DEVICE_PORT_FILE="$FNOS_DEVICE_PORT_FILE"
elif [[ -n "${TRIM_PKGETC:-}" && -f "$TRIM_PKGETC/device-port" ]]; then
  DEVICE_PORT_FILE="$TRIM_PKGETC/device-port"
else
  DEVICE_PORT_FILE="$DATA_DIR/device-port"
fi
LEGACY_DEVICE_PORT_FILE="$RUNTIME_DIR/device-port.txt"
if [[ -n "${FNOS_SOCKET_PATH:-}" ]]; then
  SOCKET_PATH="$FNOS_SOCKET_PATH"
elif [[ -n "${TRIM_APPDEST:-}" ]]; then
  SOCKET_PATH="$TRIM_APPDEST/app.sock"
else
  SOCKET_PATH="$RUNTIME_DIR/pomepanel-sync.sock"
fi

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
