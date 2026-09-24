#!/bin/bash
# Refresh the Feiniu payload copy of the sync protocol before packing.
#
# Source of truth: packages/sync-protocol
# Payload:         fnos/app/packages/sync-protocol
#
# fnpack puts the contents of fnos/app/ into TRIM_APPDEST (target/).
# The server then loads ../packages/sync-protocol from target/server.
# Run this script after changing packages/sync-protocol, then pack the fpk
# on the NAS with fnpack. This script does not build the fpk.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/packages/sync-protocol"
DEST="$ROOT/fnos/app/packages/sync-protocol"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -a "$SRC"/. "$DEST"/
echo "vendored $SRC -> $DEST"

# Package-root icons stay the pomegranate brand. ICON.PNG is the square
# desktop asset. ICON_256.PNG follows the desktop tile icon, which is that
# same artwork resized. Do not point either file at a generated placeholder.
BRAND="$ROOT/build/pome-panel-icon.png"
cp "$BRAND" "$ROOT/fnos/ICON.PNG"
cp "$ROOT/fnos/app/ui/images/icon_256.png" "$ROOT/fnos/ICON_256.PNG"
echo "icons: $BRAND -> fnos/ICON.PNG, desktop icon_256 -> fnos/ICON_256.PNG"
echo "next: pack fnos/ with fnpack on the NAS"
