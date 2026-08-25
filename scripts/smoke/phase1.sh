#!/usr/bin/env bash
# Phase 1 smoke test — guard rails, LIVE discovery, read-only tail stream.
#
# Usage:
#   SMOKE_BASE_URL=http://127.0.0.1:30141 scripts/smoke/phase1.sh
#
# Creates a synthetic session file + live-registry entry, then verifies:
#   1. /api/live/[id]/events streams connected+external_state frames (tail mode)
#   2. appended session entries arrive as message_end frames with entryId
#   3. the agent_end heuristic fires after an assistant message goes quiet
#   4. POST/GET on /api/agent/[id] return 409 while the registry entry is live
#   5. /api/sessions reports the id in liveSessionIds
#   6. dead-pid registry entries are swept (live:false afterwards)
#
# Cleans up all synthetic artifacts on exit.

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"
trap smoke_cleanup EXIT

echo "── phase1 smoke against ${SMOKE_BASE_URL} ──"

# 0. Instance reachable at all?
if ! curl -sf "${SMOKE_BASE_URL}/api/sessions" -o /dev/null; then
  echo "FAIL: no pi-web instance at ${SMOKE_BASE_URL}" >&2
  exit 2
fi

make_synthetic_session
echo "session: ${SMOKE_SESSION_ID}"
echo "file:    ${SMOKE_FILE}"

# ── 1. SSE connects in tail mode ──────────────────────────────────────────────
# resolveSessionPath may need a fresh sessions-dir scan (30s list cache), so retry.
SSE_OK=0
for attempt in $(seq 1 20); do
  curl -sN --max-time 25 "${SMOKE_BASE_URL}/api/live/${SMOKE_SESSION_ID}/events" >> "$SMOKE_SSE_LOG" 2>/dev/null &
  SMOKE_CURL_PID=$!
  if wait_for '"mode":"tail"' "$SMOKE_SSE_LOG" 4; then SSE_OK=1; break; fi
  kill "$SMOKE_CURL_PID" 2>/dev/null; wait "$SMOKE_CURL_PID" 2>/dev/null
  sleep 2
done
(( SSE_OK )) || { smoke_fail "tail route never emitted connected/mode:tail"; }
wait_for '"external_state","live":true' "$SMOKE_SSE_LOG" \
  && smoke_pass "external_state live:true" || smoke_fail "no external_state frame"

# ── 2. Appended entries arrive as message_end frames ─────────────────────────
append_entry "$(msg_entry aaaaaaaa parent1 user "hello from smoke")"
wait_for 'hello from smoke' "$SMOKE_SSE_LOG" 8 \
  && smoke_pass "user message streamed" || smoke_fail "user message never arrived"

append_entry "$(msg_entry bbbbbbbb parent1 assistant "smoke assistant reply")"
wait_for 'smoke assistant reply' "$SMOKE_SSE_LOG" 8 \
  && smoke_pass "assistant message streamed" || smoke_fail "assistant message never arrived"

grep -q '"entryId":"aaaaaaaa"' "$SMOKE_SSE_LOG" \
  && smoke_pass "entryId present for dedupe" || smoke_fail "entryId missing"

# ── 3. agent_end heuristic ────────────────────────────────────────────────────
wait_for '"type":"agent_end"' "$SMOKE_SSE_LOG" 10 \
  && smoke_pass "agent_end heuristic fired" || smoke_fail "no agent_end after quiet period"

# ── 4. Guards: spawning routes must refuse while live ─────────────────────────
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${SMOKE_BASE_URL}/api/agent/${SMOKE_SESSION_ID}" \
  -H 'Content-Type: application/json' -d '{"type":"prompt","message":"should not fork"}')
[[ "$code" == "409" ]] && smoke_pass "POST /api/agent guarded (409)" || smoke_fail "POST /api/agent returned ${code}, expected 409"

code=$(curl -s -o /dev/null -w '%{http_code}' "${SMOKE_BASE_URL}/api/agent/${SMOKE_SESSION_ID}/events")
[[ "$code" == "409" ]] && smoke_pass "GET /api/agent/[id]/events guarded (409)" || smoke_fail "native events route returned ${code}, expected 409"

body=$(curl -s -X POST "${SMOKE_BASE_URL}/api/agent/${SMOKE_SESSION_ID}" \
  -H 'Content-Type: application/json' -d '{"type":"get_state"}')
echo "$body" | jq -e '.live == true' >/dev/null \
  && smoke_pass "409 body carries live:true" || smoke_fail "409 body missing live flag: ${body}"

# ── 5. Sessions list advertises liveSessionIds ────────────────────────────────
curl -s "${SMOKE_BASE_URL}/api/sessions" | jq -e --arg id "$SMOKE_SESSION_ID" \
  '.liveSessionIds | index($id) != null' >/dev/null \
  && smoke_pass "/api/sessions lists id in liveSessionIds" || smoke_fail "liveSessionIds missing from /api/sessions"

# ── 6. Dead-pid sweep → no longer live ────────────────────────────────────────
kill "$SMOKE_CURL_PID" 2>/dev/null; wait "$SMOKE_CURL_PID" 2>/dev/null; SMOKE_CURL_PID=""
printf '{"pid":2147483646,"port":0,"cwd":"/x"}\n' > "$SMOKE_REGISTRY_FILE"
sleep 3 # scan TTL 2s
curl -s "${SMOKE_BASE_URL}/api/sessions" | jq -e --arg id "$SMOKE_SESSION_ID" \
  '.liveSessionIds | index($id) == null' >/dev/null \
  && smoke_pass "dead-pid registry entry swept" || smoke_fail "dead pid still advertised as live"

# ── summary ───────────────────────────────────────────────────────────────────
if (( SMOKE_FAILURES )); then
  echo "── ${SMOKE_FAILURES} failure(s) ──"
  exit 1
fi
echo "── all phase1 checks passed ──"
