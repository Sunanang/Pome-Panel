#!/usr/bin/env bash
# Persist wizard_port from install_callback / config_callback.
# The value is whatever the user typed. This script does not invent a port.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${wizard_port:-}"

fail() {
  local msg="$1"
  echo "$msg" >&2
  if [[ -n "${TRIM_TEMP_LOGFILE:-}" ]]; then
    printf '%s\n' "$msg" >>"$TRIM_TEMP_LOGFILE"
  fi
  exit 1
}

if [[ -z "$PORT" ]]; then
  fail "请填写设备同步端口"
fi
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  fail "设备同步端口必须是 1 到 65535 的整数"
fi

write_port() {
  local file="$1"
  mkdir -p "$(dirname "$file")"
  printf '%s\n' "$PORT" >"$file"
  chmod 600 "$file" || true
}

if [[ -n "${TRIM_PKGETC:-}" ]]; then
  write_port "$TRIM_PKGETC/device-port"
fi
DATA_DIR="${FNOS_DATA_DIR:-${TRIM_PKGVAR:-$ROOT/data}}"
write_port "$DATA_DIR/device-port"
echo "saved device port $PORT"
