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
echo "next: pack fnos/ with fnpack on the NAS"
