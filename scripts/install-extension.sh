#!/usr/bin/env bash
# Install the pi-live extension into the user's live pi extensions dir.
# Idempotent: re-running overwrites the previous copy.
#
# Usage: scripts/install-extension.sh
#
# NOTE: ~/.pi/agent/extensions is typically a git-synced config directory
# (see Guides/Desktop/Pi/pi-config-sync.md) — committing/syncing afterwards
# propagates the extension to other machines.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/extension/pi-live"
DEST="${HOME}/.pi/agent/extensions/pi-live"

if [[ ! -f "${SRC}/index.ts" ]]; then
  echo "error: ${SRC}/index.ts not found — run from the pi-web repo" >&2
  exit 1
fi

mkdir -p "$(dirname "${DEST}")"
rm -rf "${DEST}"
cp -r "${SRC}" "${DEST}"
echo "installed: ${DEST}"
echo "note: running pi instances need a restart (or /reload) to pick it up."
