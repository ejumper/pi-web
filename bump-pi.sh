#!/usr/bin/env bash
# Bump pi-web's pinned @earendil-works/pi-* packages to the latest npm release
# (or a specific version). Run this on the DESKTOP dev checkout only — never
# on the server: server-local package.json/lockfile changes are exactly what
# deploy.sh's overlap guard aborts on, and bumps that never land in git are
# how the pi-web/CLI version skew happened in the first place.
#
# The server picks the bump up through the normal flow afterwards:
#   commit + push here  →  deploy.sh on the server (git pull + rebuild, where
#   the Dockerfile's npm ci installs the new lockfile).
#
# Usage:
#   bump-pi.sh              bump to npm latest, then production build
#   bump-pi.sh 1.4.0        bump to a specific version, then production build
#   bump-pi.sh --no-build   bump deps only (skip the canary build)
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

PKGS=("@earendil-works/pi-ai" "@earendil-works/pi-coding-agent" "@earendil-works/pi-tui")

TARGET="latest"
DO_BUILD=1
case "${1:-}" in
  --no-build) DO_BUILD=0 ;;
  "") ;;
  *) TARGET="$1" ;;
esac

CURRENT=$(node -p "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version")
if [ "$TARGET" = "latest" ]; then
  TARGET=$(npm view @earendil-works/pi-coding-agent version)
fi

echo "pi-coding-agent: $CURRENT -> $TARGET"
if [ "$CURRENT" = "$TARGET" ]; then
  echo "already on $TARGET — nothing to do."
  exit 0
fi

npm install "${PKGS[@]/%/@$TARGET}"

if [ "$DO_BUILD" = "1" ]; then
  npm run build
  echo
  echo "canary build done. Restart + exercise the desktop instance before pushing:"
  echo "  systemctl --user restart pi-web.service"
  echo "then verify in the browser (models auth, a sonar session, voice), and:"
  echo "  git add package.json package-lock.json && git commit && git push"
  echo "  ssh server /opt/pi-web/src/deploy.sh"
else
  echo "deps bumped without a build — run 'npm run build' before trusting this checkout."
fi
