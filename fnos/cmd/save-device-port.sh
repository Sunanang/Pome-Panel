#!/bin/bash
# Persist the install/config/upgrade wizard port.
# The value is whatever the user typed. This script does not invent a port.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

fail() {
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

# fnOS documents wizard_port. Some builds also export an uppercase alias.
PORT=""
for candidate in \
  "${wizard_port:-}" \
  "${WIZARD_PORT:-}" \
  "${Wizard_port:-}" \
  "${TRIM_WIZARD_PORT:-}" \
  "${1:-}"
do
  if port_ok "$candidate"; then
    PORT="$candidate"
    break
  fi
done

if [[ -z "$PORT" ]]; then
  fail "请填写设备同步端口"
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
if [[ -n "${FNOS_DATA_DIR:-}" ]]; then
  DATA_DIR="$FNOS_DATA_DIR"
elif [[ -n "${TRIM_PKGVAR:-}" ]]; then
  DATA_DIR="$TRIM_PKGVAR"
else
  DATA_DIR="$ROOT/data"
fi
write_port "$DATA_DIR/device-port"
if [[ -n "${TRIM_PKGVAR:-}" && "$TRIM_PKGVAR" != "$DATA_DIR" ]]; then
  write_port "$TRIM_PKGVAR/device-port"
fi
echo "saved device port $PORT"
