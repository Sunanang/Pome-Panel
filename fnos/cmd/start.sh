#!/usr/bin/env bash
# FPK start — launch Pome Panel (Unix gateway socket + the install-time device port).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="${FNOS_RUNTIME_DIR:-$ROOT/runtime}"
if [[ -n "${FNOS_DATA_DIR:-}" ]]; then
  DATA_DIR="$FNOS_DATA_DIR"
elif [[ -n "${TRIM_PKGVAR:-}" ]]; then
  DATA_DIR="$TRIM_PKGVAR"
else
  DATA_DIR="$ROOT/data"
fi
mkdir -p "$RUNTIME_DIR" "$DATA_DIR"
if [[ -n "${TRIM_APPDEST:-}" ]]; then
  SOCKET_PATH="${FNOS_SOCKET_PATH:-$TRIM_APPDEST/app.sock}"
else
  SOCKET_PATH="${FNOS_SOCKET_PATH:-$RUNTIME_DIR/pomepanel-sync.sock}"
fi
PID_FILE="${FNOS_PID_FILE:-$RUNTIME_DIR/server.pid}"

report_fail() {
  local msg="$1"
  echo "$msg" >&2
  if [[ -n "${TRIM_TEMP_LOGFILE:-}" ]]; then
    printf '%s\n' "$msg" >>"$TRIM_TEMP_LOGFILE"
  fi
  exit 1
}

port_ok() {
  local p="$1"
  [[ "$p" =~ ^[1-9][0-9]*$ ]] || return 1
  (( 10#$p >= 1 && 10#$p <= 65535 ))
}

read_file_port() {
  local file="$1"
  [[ -n "$file" && -f "$file" ]] || return 1
  local value
  value="$(tr -d '[:space:]' <"$file")"
  port_ok "$value" || return 1
  printf '%s' "$value"
}

# Official install writes TRIM_PKGETC/device-port. Data-dir copy survives local restarts.
LEGACY_DEVICE_PORT_FILE="$RUNTIME_DIR/device-port.txt"
PRIMARY_PORT_FILE="$DATA_DIR/device-port"
if [[ ! -f "$PRIMARY_PORT_FILE" && -f "$LEGACY_DEVICE_PORT_FILE" ]]; then
  mkdir -p "$(dirname "$PRIMARY_PORT_FILE")"
  cp "$LEGACY_DEVICE_PORT_FILE" "$PRIMARY_PORT_FILE"
  chmod 600 "$PRIMARY_PORT_FILE" || true
fi

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "already running pid=$(cat "$PID_FILE")"
  exit 0
fi

CHOSEN=""
if port_ok "${FNOS_DEVICE_PORT:-}"; then
  CHOSEN="$FNOS_DEVICE_PORT"
else
  for candidate in \
    "${wizard_port:-}" \
    "${WIZARD_PORT:-}" \
    "${Wizard_port:-}" \
    "${TRIM_WIZARD_PORT:-}"
  do
    if port_ok "$candidate"; then
      CHOSEN="$candidate"
      break
    fi
  done
fi

if ! port_ok "$CHOSEN"; then
  for file in \
    "${FNOS_DEVICE_PORT_FILE:-}" \
    "${TRIM_PKGETC:+$TRIM_PKGETC/device-port}" \
    "$PRIMARY_PORT_FILE" \
    "${TRIM_PKGVAR:+$TRIM_PKGVAR/device-port}" \
    "$LEGACY_DEVICE_PORT_FILE"
  do
    if CHOSEN="$(read_file_port "$file")"; then
      break
    fi
    CHOSEN=""
  done
fi

if ! port_ok "$CHOSEN"; then
  report_fail "未配置设备同步端口。请在飞牛安装向导或应用设置中填写 1 到 65535 的端口后再启动。"
fi

write_port() {
  local file="$1"
  [[ -n "$file" ]] || return 0
  mkdir -p "$(dirname "$file")"
  printf '%s\n' "$CHOSEN" >"$file"
  chmod 600 "$file" || true
}

if [[ -n "${TRIM_PKGETC:-}" ]]; then
  write_port "$TRIM_PKGETC/device-port"
fi
write_port "$PRIMARY_PORT_FILE"
if [[ -n "${TRIM_PKGVAR:-}" && "$TRIM_PKGVAR" != "$DATA_DIR" ]]; then
  write_port "$TRIM_PKGVAR/device-port"
fi

NODE_BIN_RESOLVED=""
if [[ -n "${NODE_BIN:-}" && -x "${NODE_BIN}" ]]; then
  NODE_BIN_RESOLVED="$NODE_BIN"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN_RESOLVED="$(command -v node)"
else
  for candidate in \
    /usr/local/bin/node \
    /usr/bin/node \
    /var/apps/nodejs_v22/target/bin/node \
    /var/apps/nodejs_v20/target/bin/node \
    /var/apps/nodejs_v18/target/bin/node \
    /var/packages/Node.js_v18/target/bin/node
  do
    if [[ -x "$candidate" ]]; then
      NODE_BIN_RESOLVED="$candidate"
      break
    fi
  done
fi

if [[ -z "$NODE_BIN_RESOLVED" ]]; then
  report_fail "找不到 Node.js，无法启动 Pome Panel。请确认系统里有 Node 18 或更新版本。"
fi

export FNOS_SOCKET_PATH="$SOCKET_PATH"
export FNOS_DATA_DIR="$DATA_DIR"
export FNOS_DEVICE_PORT="$CHOSEN"
export FNOS_DEVICE_PORT_FILE="$PRIMARY_PORT_FILE"
export FNOS_SERVER_ID_FILE="${FNOS_SERVER_ID_FILE:-$DATA_DIR/server-id}"

nohup "$NODE_BIN_RESOLVED" "$ROOT/app/server/index.js" \
  >"$RUNTIME_DIR/server.log" 2>&1 &
echo $! >"$PID_FILE"
echo "started pid=$(cat "$PID_FILE") socket=$SOCKET_PATH devicePort=$CHOSEN"
