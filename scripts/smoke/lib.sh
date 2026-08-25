#!/usr/bin/env bash
# Shared helpers for pi-web live-session-streaming smoke tests.
# Source this, don't execute it. Requires: curl, jq, python3.

set -u

SMOKE_BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:30141}"
SMOKE_SESSIONS_DIR="${HOME}/.pi/agent/sessions"
SMOKE_REGISTRY_DIR="/tmp/pi-live-registry"
SMOKE_WORK_DIR="$(mktemp -d /tmp/pi-live-smoke.XXXXXX)"
SMOKE_FAILURES=0

smoke_cleanup() {
  # Kill anything we backgrounded (SSE curls).
  [[ -n "${SMOKE_CURL_PID:-}" ]] && kill "${SMOKE_CURL_PID}" 2>/dev/null
  # Remove synthetic artifacts best-effort.
  [[ -n "${SMOKE_FILE:-}" ]] && rm -f "${SMOKE_FILE}"
  [[ -n "${SMOKE_REGISTRY_FILE:-}" ]] && rm -f "${SMOKE_REGISTRY_FILE}"
  [[ -n "${SMOKE_SSE_LOG:-}" ]] && rm -f "${SMOKE_SSE_LOG}"
  rm -rf "${SMOKE_WORK_DIR}"
}

smoke_fail() {
  echo "FAIL: $*" >&2
  SMOKE_FAILURES=$((SMOKE_FAILURES + 1))
}

smoke_pass() {
  echo "ok: $*"
}

# wait_for <pattern> <file> <timeout_seconds> — succeeds when grep matches.
wait_for() {
  local pattern="$1" file="$2" timeout="${3:-10}"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    grep -q "$pattern" "$file" 2>/dev/null && return 0
    sleep 0.3
  done
  return 1
}

# encode_session_dir <abs-cwd> — mirrors pi's getDefaultSessionDirPath().
encode_session_dir() {
  local cwd="$1"
  # shellcheck disable=SC2001
  local stripped="$(echo "$cwd" | sed 's|^[/\\]||')"
  echo "--$(echo "$stripped" | sed 's|[/\\:]|-|g')--"
}

# make_synthetic_session — creates a valid empty session JSONL in the real
# sessions tree and registers it as live (registry file with a LIVE pid).
# Sets: SMOKE_SESSION_ID SMOKE_FILE SMOKE_REGISTRY_FILE SMOKE_SSE_LOG
make_synthetic_session() {
  local cwd_tag="/tmp/pi-live-smoke-target"
  local dir_name encoded
  encoded="$(encode_session_dir "$cwd_tag")"
  local dir_path="${SMOKE_SESSIONS_DIR}/${encoded}"
  mkdir -p "$dir_path"

  SMOKE_SESSION_ID="$(cat /proc/sys/kernel/random/uuid)"
  local ts
  ts="$(date -u +%Y-%m-%dT%H-%M-%S-)%03dZ"
  ts="$(date -u +%Y-%m-%dT%H:%M:%S).$(date -u +%N | cut -c1-3)Z"
  SMOKE_FILE="${dir_path}/${ts//:/-}_${SMOKE_SESSION_ID}.jsonl"

  printf '{"type":"session","version":3,"id":"%s","timestamp":"%s","cwd":"%s"}\n' \
    "$SMOKE_SESSION_ID" "$ts" "$cwd_tag" > "$SMOKE_FILE"

  # Register as live with THIS shell's pid (alive for the duration of the test).
  mkdir -p "$SMOKE_REGISTRY_DIR"
  SMOKE_REGISTRY_FILE="${SMOKE_REGISTRY_DIR}/${SMOKE_SESSION_ID}.json"
  printf '{"pid":%d,"port":0,"cwd":"%s","sessionFile":"%s","name":"smoke-test","startedAt":"%s"}\n' \
    "$$" "$cwd_tag" "$SMOKE_FILE" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SMOKE_REGISTRY_FILE"

  SMOKE_SSE_LOG="${SMOKE_WORK_DIR}/sse.log"
  : > "$SMOKE_SSE_LOG"
}

# append_entry <json> — appends one session entry to the synthetic file.
append_entry() {
  printf '%s\n' "$1" >> "$SMOKE_FILE"
}

msg_entry() { # msg_entry <id> <parent> <role> <text>
  printf '{"type":"message","id":"%s","parentId":"%s","timestamp":"%s","message":{"role":"%s","content":"%s","timestamp":%s}}' \
    "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" "$3" "$4" "$(date +%s)000"
}
