import { statSync, openSync, readSync, closeSync } from "fs";
import { resolveSessionPath } from "@/lib/session-reader";
import { isLive } from "@/lib/live-bridge";

export const dynamic = "force-dynamic";

// ============================================================================
// GET /api/live/[id]/events — read-only live view of a terminal-owned session.
//
// Tails the session JSONL and emits synthetic events in the same dialect the
// frontend already consumes (message_end-shaped frames). Entry-granular by
// nature: complete messages/tool results land as they are appended to the
// file, no token deltas (Phase 2's extension bridge adds those).
//
// Frames:
//   {"type":"connected","sessionId":...,"mode":"tail"}
//   {"type":"external_state","live":true}
//   {"type":"message_end","message":{...},"entryId":"..."}   per appended entry
//   {"type":"agent_end"}                                      heuristic, see below
// plus 30s heartbeat comments.
// ============================================================================

const POLL_MS = 700;
/** After an assistant message lands, if nothing further appends within this
 *  window we assume the turn ended. Imprecise by design — a file tail cannot
 *  know the terminal's true turn state; Phase 2 replaces this with real
 *  agent_start/agent_end events. */
const AGENT_END_QUIET_MS = 4_000;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const filePath = await resolveSessionPath(id);
  if (!filePath) {
    return new Response("Session not found", { status: 404 });
  }
  // Live in a terminal? This route is exactly for that case. Not live?
  // Harmless too — a static session simply never appends — but say so in
  // external_state so the client can tell the difference.

  let offset = 0;
  try {
    offset = statSync(filePath).size;
    // Offset captured BEFORE the client fetches history via /api/sessions/[id]:
    // anything appended after this byte shows up in the stream, and the client
    // dedupes by entryId against its seeded history. Anything appended between
    // history-read and subscribe was already inside `offset`... unless the
    // client read history BEFORE calling us. Either way entryId-dedupe makes
    // ordering safe; a missed entry can only happen if it landed before our
    // offset AND after the history snapshot — the client re-loads history on
    // reconnect, so the window self-heals.
  } catch {
    return new Response("Session file unreadable", { status: 500 });
  }

  const encoder = new TextEncoder();
  const live = isLive(id);

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const encode = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      encode({ type: "connected", sessionId: id, mode: "tail" });
      encode({ type: "external_state", live });

      let carry = ""; // partial line spanning poll boundaries
      let pendingAgentEnd = false;
      let lastAppendAt = 0;

      const maybeEmitAgentEnd = () => {
        if (pendingAgentEnd && Date.now() - lastAppendAt >= AGENT_END_QUIET_MS) {
          pendingAgentEnd = false;
          encode({ type: "agent_end" });
        }
      };

      const poll = () => {
        if (closed) return;
        try {
          const size = statSync(filePath).size;
          if (size > offset) {
            lastAppendAt = Date.now();
            const fd = openSync(filePath, "r");
            try {
              const buf = Buffer.alloc(size - offset);
              readSync(fd, buf, 0, buf.length, offset);
              carry += buf.toString("utf8");
            } finally {
              closeSync(fd);
            }
            offset = size;

            const lines = carry.split("\n");
            carry = lines.pop() ?? ""; // last element is "" or a partial line

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              let entry: { type?: string; id?: string; message?: unknown };
              try {
                entry = JSON.parse(trimmed);
              } catch {
                continue; // tolerate malformed tail bytes
              }
              if (entry.type !== "message" || !entry.message) continue;
              const role = (entry.message as { role?: string }).role;
              encode({
                type: "message_end",
                message: entry.message,
                entryId: entry.id,
              });
              if (role === "assistant") {
                pendingAgentEnd = true;
                lastAppendAt = Date.now();
              }
            }
          }
          maybeEmitAgentEnd();
        } catch {
          // File vanished (session deleted mid-view) — keep polling quietly;
          // the client reconciles on next load.
        }
      };

      const timer = setInterval(poll, POLL_MS);
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          closed = true;
        }
      }, 30_000);

      const cleanup = () => {
        clearInterval(timer);
        clearInterval(heartbeat);
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };
      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
