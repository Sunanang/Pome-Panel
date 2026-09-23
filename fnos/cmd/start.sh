#!/usr/bin/env bash
# FPK start — launch Pome Panel (Unix gateway socket + the install-time device port).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="${FNOS_RUNTIME_DIR:-$ROOT/runtime}"
DATA_DIR="${FNOS_DATA_DIR:-${TRIM_PKGVAR:-$ROOT/data}}"
mkdir -p "$RUNTIME_DIR" "$DATA_DIR"
if [[ -n "${TRIM_APPDEST:-}" ]]; then
  SOCKET_PATH="${FNOS_SOCKET_PATH:-$TRIM_APPDEST/app.sock}"
else
  SOCKET_PATH="${FNOS_SOCKET_PATH:-$RUNTIME_DIR/pomepanel-sync.sock}"
fi
PID_FILE="${FNOS_PID_FILE:-$RUNTIME_DIR/server.pid}"

# Official install writes TRIM_PKGETC/device-port. Data-dir copy survives local restarts.
if [[ -n "${FNOS_DEVICE_PORT_FILE:-}" ]]; then
  DEVICE_PORT_FILE="$FNOS_DEVICE_PORT_FILE"
elif [[ -n "${TRIM_PKGETC:-}" && -f "$TRIM_PKGETC/device-port" ]]; then
  DEVICE_PORT_FILE="$TRIM_PKGETC/device-port"
else
  DEVICE_PORT_FILE="$DATA_DIR/device-port"
fi
LEGACY_DEVICE_PORT_FILE="$RUNTIME_DIR/device-port.txt"
if [[ ! -f "$DEVICE_PORT_FILE" && -f "$LEGACY_DEVICE_PORT_FILE" && "$DEVICE_PORT_FILE" != "$LEGACY_DEVICE_PORT_FILE" ]]; then
  mkdir -p "$(dirname "$DEVICE_PORT_FILE")"
  cp "$LEGACY_DEVICE_PORT_FILE" "$DEVICE_PORT_FILE"
  chmod 600 "$DEVICE_PORT_FILE" || true
fi

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "already running pid=$(cat "$PID_FILE")"
  exit 0
fi

port_ok() {
  local p="$1"
  [[ "$p" =~ ^[0-9]+$ ]] || return 1
  (( p >= 1 && p <= 65535 ))
}

CHOSEN=""
if port_ok "${FNOS_DEVICE_PORT:-}"; then
  CHOSEN="$FNOS_DEVICE_PORT"
elif port_ok "${wizard_port:-}"; then
  CHOSEN="$wizard_port"
elif [[ -f "$DEVICE_PORT_FILE" ]]; then
  CHOSEN="$(tr -d '[:space:]' <"$DEVICE_PORT_FILE")"
fi

if ! port_ok "$CHOSEN"; then
  MSG="未配置设备同步端口。请在飞牛安装向导或应用设置中填写端口后再启动。"
  echo "$MSG" >&2
  if [[ -n "${TRIM_TEMP_LOGFILE:-}" ]]; then
    printf '%s\n' "$MSG" >>"$TRIM_TEMP_LOGFILE"
  fi
  exit 1
fi

mkdir -p "$(dirname "$DEVICE_PORT_FILE")"
printf '%s\n' "$CHOSEN" >"$DEVICE_PORT_FILE"
chmod 600 "$DEVICE_PORT_FILE" || true

export FNOS_SOCKET_PATH="$SOCKET_PATH"
export FNOS_DATA_DIR="$DATA_DIR"
export FNOS_DEVICE_PORT="$CHOSEN"
export FNOS_DEVICE_PORT_FILE="$DEVICE_PORT_FILE"
export FNOS_SERVER_ID_FILE="${FNOS_SERVER_ID_FILE:-$DATA_DIR/server-id}"

NODE_BIN="${NODE_BIN:-node}"
nohup "$NODE_BIN" "$ROOT/app/server/index.js" \
  >"$RUNTIME_DIR/server.log" 2>&1 &
echo $! >"$PID_FILE"
echo "started pid=$(cat "$PID_FILE") socket=$SOCKET_PATH devicePort=$CHOSEN"
