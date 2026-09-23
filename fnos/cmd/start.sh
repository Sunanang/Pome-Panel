#!/bin/bash
# FPK start — launch Pome Panel (Unix socket + optional device TCP).
# Missing device port must not fail enable. The server reuses a saved port or asks the OS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Install tree /var/apps/<app> is not writable for run-as:package.
# Runtime: FNOS_RUNTIME_DIR, else $TRIM_PKGVAR/runtime, else a local dir for tests.
# Data: FNOS_DATA_DIR, else TRIM_PKGVAR, else TRIM_PKGHOME, else a local dir for tests.
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
mkdir -p "$RUNTIME_DIR" "$DATA_DIR"
if [[ -n "${FNOS_SOCKET_PATH:-}" ]]; then
  SOCKET_PATH="$FNOS_SOCKET_PATH"
elif [[ -n "${TRIM_APPDEST:-}" ]]; then
  SOCKET_PATH="$TRIM_APPDEST/app.sock"
else
  SOCKET_PATH="$RUNTIME_DIR/pomepanel-sync.sock"
fi
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

export PATH="/var/apps/nodejs_v24/target/bin:/var/apps/nodejs_v22/target/bin:${PATH:-/usr/local/bin:/usr/bin}"

# fnpack extracts app/ into TRIM_APPDEST (target/). There is no app/ under /var/apps/<id>.
if [[ -n "${TRIM_APPDEST:-}" ]]; then
  APP_ENTRY="$TRIM_APPDEST/server/index.js"
else
  APP_ENTRY="$ROOT/app/server/index.js"
fi

NODE_BIN="${NODE_BIN:-node}"
nohup "$NODE_BIN" "$APP_ENTRY" \
  >"$RUNTIME_DIR/server.log" 2>&1 &
echo $! >"$PID_FILE"
echo "started pid=$(cat "$PID_FILE") socket=$SOCKET_PATH entry=$APP_ENTRY"
