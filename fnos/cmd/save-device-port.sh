#!/bin/bash
# Persist the install/config/upgrade wizard port and optional LAN bind.
# The values are whatever the user typed. This script does not invent a port.
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

# wizard_lan: localhost (default) | lan. Also accepts 0/1, true/false, bind addresses.
resolve_bind() {
  local raw
  raw="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  case "$raw" in
    ''|localhost|loopback|127.0.0.1|::1|0|false|no)
      printf '%s\n' '127.0.0.1'
      ;;
    lan|all|0.0.0.0|::|1|true|yes)
      printf '%s\n' '0.0.0.0'
      ;;
    *)
      printf '%s\n' '127.0.0.1'
      ;;
  esac
}

BIND=""
for candidate in \
  "${wizard_lan:-}" \
  "${WIZARD_LAN:-}" \
  "${Wizard_lan:-}" \
  "${TRIM_WIZARD_LAN:-}" \
  "${FNOS_DEVICE_BIND:-}"
do
  if [[ -n "${candidate}" ]]; then
    BIND="$(resolve_bind "$candidate")"
    break
  fi
done
# Config form may omit the radio; keep an existing bind file, else loopback.
KEEP_EXISTING_BIND=0
if [[ -z "$BIND" ]]; then
  KEEP_EXISTING_BIND=1
  BIND="127.0.0.1"
fi

write_port() {
  local file="$1"
  mkdir -p "$(dirname "$file")"
  printf '%s\n' "$PORT" >"$file"
  chmod 600 "$file" || true
}

write_bind() {
  local file="$1"
  mkdir -p "$(dirname "$file")"
  printf '%s\n' "$BIND" >"$file"
  chmod 600 "$file" || true
}

maybe_write_bind() {
  local file="$1"
  if [[ "$KEEP_EXISTING_BIND" -eq 1 && -f "$file" ]]; then
    return 0
  fi
  write_bind "$file"
}

if [[ -n "${TRIM_PKGETC:-}" ]]; then
  DATA_ETC="$TRIM_PKGETC"
  write_port "$DATA_ETC/device-port"
  maybe_write_bind "$DATA_ETC/device-bind"
fi
if [[ -n "${FNOS_DATA_DIR:-}" ]]; then
  DATA_DIR="$FNOS_DATA_DIR"
elif [[ -n "${TRIM_PKGVAR:-}" ]]; then
  DATA_DIR="$TRIM_PKGVAR"
else
  DATA_DIR="$ROOT/data"
fi
write_port "$DATA_DIR/device-port"
maybe_write_bind "$DATA_DIR/device-bind"
if [[ -n "${TRIM_PKGVAR:-}" && "$TRIM_PKGVAR" != "$DATA_DIR" ]]; then
  write_port "$TRIM_PKGVAR/device-port"
  maybe_write_bind "$TRIM_PKGVAR/device-bind"
fi
echo "saved device port $PORT bind $BIND"
