#!/bin/bash
# Refresh the Feiniu payload copy of the sync protocol before packing.
#
# Source of truth: packages/sync-protocol
# Payload:         fnos/app/packages/sync-protocol
#
# fnpack puts the contents of fnos/app/ into TRIM_APPDEST (target/).
# The server then loads ../packages/sync-protocol from target/server.
# This entry point only refreshes the checked-out payload. To build an FPK
# without changing source files, use node scripts/build-fpk.js with fnpack.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/build-fpk.js" --prepare-only
