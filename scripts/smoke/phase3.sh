#!/usr/bin/env bash
# Phase 3 smoke test — send & abort over the bridge.
#
# Usage:
#   SMOKE_BASE_URL=http://127.0.0.1:30999 scripts/smoke/phase3.sh
#
# Requires: `pi` on PATH, this repo's extension source.
#
# Legs:
#   A. Inject during stream: start a long generation, steer an extra
#      instruction in via POST /send, assert acceptance + queue_pending frame,
#      then assert the final stdout honors it.
#   B. Slash tiers: /tree refused (interactive), unknown-builtin refusal,
#      /name executes via ctx methods.
#   C. Abort: kill a running turn via POST /abort (wasRunning:true, exit).
#   D. Guard/read-mode toggles via bus events + session_info_changed
#      forwarding (Wave 1).

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/lib.sh"

EXT="${REPO_ROOT}/extension/pi-live/index.ts"
[[ -f "$EXT" ]] || { echo "FAIL: extension not found" >&2; exit 2; }
command -v pi >/dev/null || { echo "FAIL: pi not on PATH" >&2; exit 2; }
trap smoke_cleanup EXIT

echo "── phase3 smoke against ${SMOKE_BASE_URL} ──"
curl -sf -o /dev/null "${SMOKE_BASE_URL}/api/sessions" || { echo "FAIL: no pi-web instance" >&2; exit 2; }

SMOKE_SSE_LOG="${SMOKE_WORK_DIR}/sse.log"
OUT_LOG="${SMOKE_WORK_DIR}/out.log"

spawn_pi() { # spawn_pi <prompt> <outfile>
  pi --no-session -e "$EXT" -p "$1" > "$2" 2>&1 &
  PI_PID=$!
}
wait_registry() {
  rm -f "${SMOKE_REGISTRY_DIR}"/*.json 2>/dev/null
  local deadline=$((SECONDS + ${1:-15}))
  local f=""
  while (( SECONDS < deadline )); do
    f=$(ls -t "${SMOKE_REGISTRY_DIR}"/*.json 2>/dev/null | head -1)
    [[ -n "$f" ]] && { SMOKE_REGISTRY_FILE="$f"; SMOKE_SESSION_ID=$(basename "$f" .json); return 0; }
    sleep 0.3
  done
  return 1
}
post_send() { # post_send <json> → echoes body
  curl -s -X POST "${SMOKE_BASE_URL}/api/live/${SMOKE_SESSION_ID}/send" \
    -H 'Content-Type: application/json' -d "$1"
}

# ════════════════════ LEG A: inject during stream ════════════════════
echo "── leg A: steer during live generation ──"
spawn_pi "Write a 300-word story about a lighthouse keeper. Output only the story." "$OUT_LOG"
wait_registry 15 && smoke_pass "A: registry appeared" || { smoke_fail "A: no registry"; exit 1; }
echo "   session: ${SMOKE_SESSION_ID}"

timeout 60 curl -sN "${SMOKE_BASE_URL}/api/live/${SMOKE_SESSION_ID}/events" > "$SMOKE_SSE_LOG" 2>&1 &
SMOKE_CURL_PID=$!
wait_for 'message_update' "$SMOKE_SSE_LOG" 30 \
  && smoke_pass "A: generation streaming" || smoke_fail "A: no stream activity"

resp=$(post_send '{"text":"Now append one final sentence mentioning seagulls.","deliverAs":"steer"}')
echo "$resp" | jq -e '.ok == true and .queued == true' >/dev/null \
  && smoke_pass "A: steer accepted+queued" || smoke_fail "A: steer rejected: $resp"

grep -q '"type":"queue_pending","pending":true' "$SMOKE_SSE_LOG" \
  && smoke_pass "A: queue_pending true broadcast" || echo "warn: A: no queue_pending frame seen (timing)"

# wait for process to finish (steered continuation included), then check output
wait $PI_PID 2>/dev/null
grep -qi "seagull" "$OUT_LOG" \
  && smoke_pass "A: final output honors injected instruction" \
  || smoke_fail "A: injected instruction never reached output"
kill "$SMOKE_CURL_PID" 2>/dev/null; wait "$SMOKE_CURL_PID" 2>/dev/null

# ════════════════════ LEG B: slash tiers ════════════════════
echo "── leg B: slash command tiers ──"
spawn_pi "Reply with exactly: READY." "$OUT_LOG"
wait_registry 15 || { smoke_fail "B: no registry"; exit 1; }

resp=$(post_send '{"text":"/tree"}')
echo "$resp" | jq -e '.ok == false and .action == "refused"' >/dev/null \
  && smoke_pass "B: interactive builtin (/tree) refused" || smoke_fail "B: /tree not refused: $resp"

resp=$(post_send '{"text":"/name Smoke-Renamed-Session"}')
echo "$resp" | jq -e '.ok == true and .action == "builtin"' >/dev/null \
  && smoke_pass "B: /name executed via ctx methods" || smoke_fail "B: /name failed: $resp"

port=$(jq -r .port "$SMOKE_REGISTRY_FILE")
sleep 0.5
state_name=$(curl -s --max-time 3 "http://127.0.0.1:$port/state" | jq -r '.name // ""')
[[ "$state_name" == "Smoke-Renamed-Session" ]] \
  && smoke_pass "B: rename visible in session state" || smoke_fail "B: name not applied (got '$state_name')"

cmds=$(curl -s --max-time 3 "http://127.0.0.1:$port/commands")
echo "$cmds" | jq -e '.ok == true and (.commands | length >= 0)' >/dev/null \
  && smoke_pass "B: /commands endpoint responds" || smoke_fail "B: /commands broken: $cmds"
echo "$cmds" | jq -e '[.commands[].name] | index("tree") == null' >/dev/null \
  && smoke_pass "B: interactive builtins excluded from palette" || smoke_fail "B: /tree leaked into palette"

wait $PI_PID 2>/dev/null

# ════════════════════ LEG C: abort ════════════════════
echo "── leg C: remote abort ──"
spawn_pi "Write a 600-word essay about deep sea creatures." "$OUT_LOG"
wait_registry 15 || { smoke_fail "C: no registry"; exit 1; }
timeout 30 curl -sN "${SMOKE_BASE_URL}/api/live/${SMOKE_SESSION_ID}/events" > "$SMOKE_SSE_LOG" 2>&1 &
SMOKE_CURL_PID=$!
wait_for 'message_update' "$SMOKE_SSE_LOG" 30 || echo "warn: C: slow start (aborting anyway)"

resp=$(curl -s -X POST "${SMOKE_BASE_URL}/api/live/${SMOKE_SESSION_ID}/abort")
echo "$resp" | jq -e '.ok == true and .wasRunning == true' >/dev/null \
  && smoke_pass "C: abort accepted (wasRunning:true)" || smoke_fail "C: abort response: $resp"

dead=0
for i in $(seq 1 20); do
  sleep 0.5
  kill -0 "$PI_PID" 2>/dev/null || { dead=1; break; }
done
(( dead )) && smoke_pass "C: terminal pi exited after abort" || { smoke_fail "C: pi still running after abort"; kill -9 "$PI_PID" 2>/dev/null; }

# ════════════════════ LEG D: guard/read-mode + rename broadcast ════════════════════
echo "── leg D: remote guard/read-mode toggles + live rename events ──"
spawn_pi "Reply with exactly: OK." "$OUT_LOG"
wait_registry 15 || { smoke_fail "D: no registry"; exit 1; }
timeout 30 curl -sN "${SMOKE_BASE_URL}/api/live/${SMOKE_SESSION_ID}/events" > "$SMOKE_SSE_LOG" 2>&1 &
SMOKE_CURL_PID=$!
wait_for '"external_state"' "$SMOKE_SSE_LOG" 10 \
  && smoke_pass "D: external_state on connect" || smoke_fail "D: no external_state frame"
grep -q '"guardEnabled"' "$SMOKE_SSE_LOG" \
  && smoke_pass "D: state frame carries guardEnabled" || smoke_fail "D: guardEnabled missing from state"

resp=$(post_send '{"text":"/read"}')
echo "$resp" | jq -e '.ok == true and .action == "builtin"' >/dev/null \
  && smoke_pass "D: /read accepted" || smoke_fail "D: /read rejected: $resp"
sleep 1
grep -q '"readMode":"read"' "$SMOKE_SSE_LOG" \
  && smoke_pass "D: readMode=read pushed to viewers" || echo "warn: D: no readMode push seen (timing)"
resp=$(post_send '{"text":"/work"}')
echo "$resp" | jq -e '.ok == true and .action == "builtin"' >/dev/null \
  && smoke_pass "D: /work accepted" || smoke_fail "D: /work rejected: $resp"
sleep 1
grep -q '"readMode":"work"' "$SMOKE_SSE_LOG" \
  && smoke_pass "D: readMode=work pushed to viewers" || echo "warn: D: no work push seen (timing)"

resp=$(post_send '{"text":"/guard off"}')
echo "$resp" | jq -e '.ok == true and .guardEnabled == false' >/dev/null \
  && smoke_pass "D: /guard off accepted" || smoke_fail "D: /guard off failed: $resp"
port=$(jq -r .port "$SMOKE_REGISTRY_FILE")
sleep 0.6
g=$(curl -s --max-time 3 "http://127.0.0.1:$port/state" | jq -r '.guardEnabled')
[[ "$g" == "false" ]] \
  && smoke_pass "D: guard actually flipped (patched safeguard loaded)" \
  || echo "warn: D: guard unchanged in state (got '$g') — safeguard patch missing? event went nowhere"
resp=$(post_send '{"text":"/guard on"}')
echo "$resp" | jq -e '.ok == true and .guardEnabled == true' >/dev/null \
  && smoke_pass "D: /guard on accepted" || smoke_fail "D: /guard on failed: $resp"
resp=$(post_send '{"text":"/guard banana"}')
echo "$resp" | jq -e '.ok == false' >/dev/null \
  && smoke_pass "D: invalid /guard arg refused" || smoke_fail "D: bad arg accepted: $resp"

resp=$(post_send '{"text":"/name Wave1-Rename-Check"}')
echo "$resp" | jq -e '.ok == true' >/dev/null \
  && smoke_pass "D: rename sent" || smoke_fail "D: rename failed: $resp"
wait_for '"session_info_changed"' "$SMOKE_SSE_LOG" 8 \
  && smoke_pass "D: session_info_changed forwarded" || smoke_fail "D: no session_info_changed frame"
grep -q 'Wave1-Rename-Check' "$SMOKE_SSE_LOG" \
  && smoke_pass "D: rename frame carries new name" || echo "warn: D: name value absent in frame"

kill "$SMOKE_CURL_PID" 2>/dev/null; wait "$SMOKE_CURL_PID" 2>/dev/null
wait $PI_PID 2>/dev/null

# ── summary ────────────────────────────────────────────────────────────────────
if (( SMOKE_FAILURES )); then
  echo "── ${SMOKE_FAILURES} failure(s) ──"
  exit 1
fi
echo "── all phase3 checks passed ──"
