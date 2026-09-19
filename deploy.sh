#!/usr/bin/env bash
# pi-web app deploy — the whole procedure, executable. Repo: ejumper/pi-web.
#
# Runs on the server, where this checkout (/opt/pi-web/src) sits next to the
# untracked /opt/pi-web/docker-compose.yml. That file and .env live OUTSIDE
# git — this script updates the app and never touches them.
#
# Usage:
#   deploy.sh              pull + build + up -d + readiness check
#   deploy.sh verify STR [FILE]
#                          grep -c STR inside the running container
#                          (default FILE: /app/.next/server/app/page.js)
#
# Why `verify` exists: a CACHED build line proves nothing (interrupting a
# build over ssh kills the local client while the remote build runs to
# completion, so the next attempt is legitimately all-CACHED), and `restart`
# after `build` keeps serving the OLD image — only `up -d` recreates. Grep the
# running bundle, never trust the build log.
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "refusing to run as root" >&2
  exit 1
fi

cd "$(dirname "$(readlink -f "$0")")"
COMPOSE_FILE="$(pwd)/../docker-compose.yml"
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "no $COMPOSE_FILE — deploys happen on the server checkout; on the desktop use the systemd service (see Guides pi-web/running.md)." >&2
  exit 1
fi

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

case "${1:-deploy}" in
  verify)
    STR="${2:?usage: deploy.sh verify STRING [file-in-container]}"
    FILE="${3:-/app/.next/server/app/page.js}"
    # grep -c exits 1 on zero matches — a meaningful failure, let it through.
    exec docker exec pi-web grep -c -- "$STR" "$FILE"
    ;;

  deploy)
    # The server tree is a live working tree: features get built here and can
    # sit uncommitted. A pull overlapping such files must be a human decision,
    # never a surprise — check before moving anything.
    git fetch origin main
    INCOMING=$(git diff --name-only HEAD origin/main | sort)
    LOCAL=$(git status --porcelain | cut -c4- | sort)
    OVERLAP=$(comm -12 <(printf '%s\n' "$INCOMING") <(printf '%s\n' "$LOCAL"))
    if [ -n "$OVERLAP" ]; then
      echo "ABORT: incoming changes overlap server-local uncommitted work:" >&2
      printf '%s\n' "$OVERLAP" | sed 's/^/  /' >&2
      echo "decide which copy wins (land it upstream or discard), then re-run." >&2
      exit 1
    fi
    if [ -n "$LOCAL" ]; then
      echo "note: server-local uncommitted work (untouched by this pull — land it upstream when you can):"
      printf '%s\n' "$LOCAL" | sed 's/^/  /'
    fi

    git pull --ff-only origin main

    # build + recreate in one step. Plain `restart` would reuse the old image
    # and keep serving the old bundle while everything looks fine.
    compose up -d --build

    # readiness: don't claim success until the app actually serves
    PORT=30141
    for _ in $(seq 1 30); do
      CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}" || true)
      if [ "$CODE" = "200" ]; then
        echo "deployed and serving (HTTP 200)."
        exit 0
      fi
      sleep 2
    done
    echo "WARN: no HTTP 200 from 127.0.0.1:${PORT} within 60s — check: docker compose -f $COMPOSE_FILE logs pi-web" >&2
    exit 1
    ;;

  *)
    echo "usage: $(basename "$0") [deploy] | verify STRING [file]" >&2
    exit 1
    ;;
esac
