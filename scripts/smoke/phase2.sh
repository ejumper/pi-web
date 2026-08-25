#!/usr/bin/env bash
# Phase 2 smoke test — pi-live extension + proxy-side fanout + degradation.
#
# Usage:
#   SMOKE_BASE_URL=http://127.0.0.1:30999 scripts/smoke/phase2.sh
#
# Requires: `pi` on PATH (any provider configured), this repo's extension source.
#
# Leg A (long pure-text generation): bridge mode engages, token-level updates
#   stream, a second mid-stream subscriber receives frames without cutting off
#   subscriber 1 (single-upstream proof).
# Leg B (tool-using run): tool lifecycle frames flow; kill -9 mid-turn delivers
#   external_state live:false bridgeLost:true to the subscriber.
#
# Cleans up all artifacts on exit.

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/lib.sh"

EXT="${REPO_ROOT}/extension/pi-live/index.ts"
[[ -f "$EXT" ]] || { echo "FAIL: extension not found at $EXT" >&2; exit 2; }
command -v pi >/dev/null || { echo "FAIL: pi not on PATH" >&2; exit 2; }
trap smoke_cleanup EXIT

echo "── phase2 smoke against ${SMOKE_BASE_URL} ──"
curl -sf -o /dev/null "${SMOKE_BASE_URL}/api/sessions" || { echo "FAIL: no pi-web instance" >&2; exit 2; }

SMOKE_SSE_LOG="${SMOKE_WORK_DIR}/sse.log"
: > "$SMOKE_SSE_LOG"

# spawn_pi <prompt> — spawns pi with the extension; sets PI_PID.
spawn_pi() {
  pi --no-session -e "$EXT" -p "$1" > /dev/null 2>&1 &
  PI_PID=$!
}

# wait_registry [timeout_s] — waits for a fresh registry entry; sets
# SMOKE_REGISTRY_FILE / SMOKE_SESSION_ID. Stale entries are cleared first.
wait_registry() {
  local timeout="${1:-15}" f=""
  rm -f "${SMOKE_REGISTRY_DIR}"/*.json 2>/dev/null
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    f=$(ls -t "${SMOKE_REGISTRY_DIR}"/*.json 2>/dev/null | head -1)
    [[ -n "$f" ]] && { SMOKE_REGISTRY_FILE="$f"; SMOKE_SESSION_ID=$(basename "$f" .json); return 0; }
    sleep 0.3
  done
  return 1
}

# ════════════════════════════ LEG A ───────────────────────────────────────────
echo "── leg A: streaming + fanout ──"
spawn_pi "Write a 300-word story about a lighthouse keeper. Output only the story."
wait_registry 15 && smoke_pass "A: registry entry appeared" \
  || { smoke_fail "A: no registry entry"; exit 1; }
echo "   session: ${SMOKE_SESSION_ID}"

timeout 40 curl -sN "${SMOKE_BASE_URL}/api/live/${SMOKE_SESSION_ID}/events" > "$SMOKE_SSE_LOG" 2>&1 &
SMOKE_CURL_PID=$!
wait_for '"mode":"bridge"' "$SMOKE_SSE_LOG" 10 \
  && smoke_pass "A: bridge mode engaged" || smoke_fail "A: bridge mode not engaged"

# Join subscriber 2 once streaming is underway, then require BOTH to advance.
wait_for 'message_update' "$SMOKE_SSE_LOG" 30 \
  && smoke_pass "A: token-level updates streamed" || smoke_fail "A: no message_update frames"
timeout 20 curl -sN "${SMOKE_BASE_URL}/api/live/${SMOKE_SESSION_ID}/events" > "${SMOKE_WORK_DIR}/sub2.log" 2>&1 &
SUB2_PID=$!

advanced=0
for i in $(seq 1 12); do
  c1=$(grep -c '^data:' "$SMOKE_SSE_LOG")
  sleep 2
  c2=$(grep -c '^data:' "$SMOKE_SSE_LOG")
  if (( c2 > c1 )); then advanced=1; break; fi
done
(( advanced )) && smoke_pass "A: subscriber 1 kept streaming after subscriber 2 joined" \
  || smoke_fail "A: subscriber 1 stopped receiving"
grep -q '^data:' "${SMOKE_WORK_DIR}/sub2.log" \
  && smoke_pass "A: subscriber 2 received frames" || smoke_fail "A: subscriber 2 empty"

# Let leg A finish naturally so its registry entry clears before leg B.
sleep 3
kill "$SMOKE_CURL_PID" 2>/dev/null; wait "$SMOKE_CURL_PID" 2>/dev/null
kill $PI_PID 2>/dev/null
wait $PI_PID 2>/dev/null

# ════════════════════════════ LEG B ───────────────────────────────────────────
echo "── leg B: tool lifecycle + crash degradation ──"
spawn_pi "Use the bash tool to run 'sleep 12 && uname -r', then explain it in one sentence."
wait_registry 15 && smoke_pass "B: registry entry appeared" \
  || { smoke_fail "B: no registry entry"; exit 1; }

timeout 40 curl -sN "${SMOKE_BASE_URL}/api/live/${SMOKE_SESSION_ID}/events" > "$SMOKE_SSE_LOG" 2>&1 &
SMOKE_CURL_PID=$!
wait_for '"mode":"bridge"' "$SMOKE_SSE_LOG" 10 \
  && smoke_pass "B: bridge mode engaged" || smoke_fail "B: bridge mode not engaged"

wait_for 'tool_execution_start' "$SMOKE_SSE_LOG" 25 \
  && smoke_pass "B: tool lifecycle streamed" || echo "warn: no tool frames observed pre-kill"

kill -9 "$PI_PID" 2>/dev/null
wait_for '"bridgeLost":true' "$SMOKE_SSE_LOG" 15 \
  && smoke_pass "B: bridgeLost broadcast delivered on kill -9" \
  || smoke_fail "B: no bridgeLost frame"

# ── summary ────────────────────────────────────────────────────────────────────
if (( SMOKE_FAILURES )); then
  echo "── ${SMOKE_FAILURES} failure(s) ──"
  exit 1
fi
echo "── all phase2 checks passed ──"
