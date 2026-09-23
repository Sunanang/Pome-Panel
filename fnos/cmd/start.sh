#!/usr/bin/env bash
# FPK start — launch Pome Panel Sync server (Unix socket + optional device TCP).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="${FNOS_RUNTIME_DIR:-$ROOT/runtime}"
DATA_DIR="${FNOS_DATA_DIR:-$ROOT/data}"
mkdir -p "$RUNTIME_DIR" "$DATA_DIR"
SOCKET_PATH="${FNOS_SOCKET_PATH:-$RUNTIME_DIR/pomepanel-sync.sock}"
PID_FILE="${FNOS_PID_FILE:-$RUNTIME_DIR/server.pid}"
# Stable data-dir file so an FPK upgrade that resets runtime/ keeps the FRP local port.
# FNOS_DEVICE_PORT_FILE still overrides. Legacy runtime/device-port.txt is copied once.
DEVICE_PORT_FILE="${FNOS_DEVICE_PORT_FILE:-$DATA_DIR/device-port}"
LEGACY_DEVICE_PORT_FILE="$RUNTIME_DIR/device-port.txt"
if [[ ! -f "$DEVICE_PORT_FILE" && -f "$LEGACY_DEVICE_PORT_FILE" && "$DEVICE_PORT_FILE" != "$LEGACY_DEVICE_PORT_FILE" ]]; then
  cp "$LEGACY_DEVICE_PORT_FILE" "$DEVICE_PORT_FILE"
  chmod 600 "$DEVICE_PORT_FILE" || true
fi

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "already running pid=$(cat "$PID_FILE")"
  exit 0
fi

# Empty or 0 → reuse DEVICE_PORT_FILE, else OS-assigned ephemeral. Never hardcode a listen port.
export FNOS_SOCKET_PATH="$SOCKET_PATH"
export FNOS_DATA_DIR="$DATA_DIR"
if [[ -n "${FNOS_DEVICE_PORT:-}" && "${FNOS_DEVICE_PORT}" != "0" ]]; then
  export FNOS_DEVICE_PORT
else
  unset FNOS_DEVICE_PORT
fi
export FNOS_DEVICE_PORT_FILE="$DEVICE_PORT_FILE"
export FNOS_SERVER_ID_FILE="${FNOS_SERVER_ID_FILE:-$DATA_DIR/server-id}"

NODE_BIN="${NODE_BIN:-node}"
nohup "$NODE_BIN" "$ROOT/app/server/index.js" \
  >"$RUNTIME_DIR/server.log" 2>&1 &
echo $! >"$PID_FILE"
echo "started pid=$(cat "$PID_FILE") socket=$SOCKET_PATH"
