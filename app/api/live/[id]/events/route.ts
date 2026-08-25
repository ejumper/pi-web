import { statSync, openSync, readSync, closeSync } from "fs";
import { invalidateSessionListCache, resolveSessionPath } from "@/lib/session-reader";
import { getLiveEntry, getLiveEntryFresh, isLive } from "@/lib/live-bridge";
import { addBridgeSubscriber, checkBridge } from "@/lib/live-fanout";

export const dynamic = "force-dynamic";

// ============================================================================
// GET /api/live/[id]/events — live view of a terminal-owned session.
//
// Strategy selection per request:
//   1. bridge  — a pi-live extension is registered and its /state answers
//                within 500ms. Full fidelity: token deltas, tool lifecycle,
//                real agent_end. Frames are passed through verbatim.
//   2. tail    — fallback (Phase 1 implementation): poll the session JSONL
//                and emit synthetic message_end frames. Entry-granular.
//
// The first connected frame carries `"mode"` so clients/tests can tell which
// strategy engaged. If the bridge dies mid-stream, subscribers receive an
// external_state{live:false,bridgeLost} frame and are disconnected; their
// EventSource reconnect fails the health check and re-enters via tail mode.
// ============================================================================

const POLL_MS = 700;
/** After an assistant message lands, if nothing further appends within this
 *  window we assume the turn ended. Tail-mode-only heuristic — a file tail
 *  cannot know the terminal's true turn state. */
const AGENT_END_QUIET_MS = 4_000;

function sseHeaders(): HeadersInit {
	return {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	};
}

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;

	// Strategy 1: bridge mode when the extension answers its health check.
	// Checked BEFORE file resolution — a bridge session needs no JSONL on disk
	// (e.g. --no-session runs live entirely in the terminal process's memory).
	// Fresh registry scan: the TTL cache otherwise races brand-new sessions
	// into a false "not live" verdict.
	const entry = getLiveEntryFresh(id);
	if (entry?.port && (await checkBridge(entry))) {
		let unsubscribe: (() => void) | null = null;
		const stream = new ReadableStream({
			start(controller) {
				const closed = () => {
					try {
						controller.close();
						return true;
					} catch {
						return true; // already closed
					}
				};
				unsubscribe = addBridgeSubscriber(
					id,
					entry,
					(chunk) => controller.enqueue(chunk),
					() => closed(),
				);
				req.signal?.addEventListener("abort", () => unsubscribe?.());
			},
			cancel() {
				unsubscribe?.();
			},
		});
		return new Response(stream, { headers: sseHeaders() });
	}

	// Strategy 2: tail mode (Phase 1 behavior) — requires a session file.
	let filePath = await resolveSessionPath(id);
	if (!filePath && !isLive(id)) {
		// Brand-new terminal sessions are invisible to the 30s list cache.
		// One forced rescan before giving up keeps join-latency low.
		invalidateSessionListCache();
		filePath = await resolveSessionPath(id);
	}
	if (!filePath) {
		return new Response("Session not found", { status: 404 });
	}
	return tailMode(req, id, filePath);
}

function tailMode(req: Request, id: string, filePath: string): Response {
	let offset = 0;
	try {
		offset = statSync(filePath).size;
		// Offset captured before the client fetches history; entryId dedupe on
		// the client makes the append-between-read-and-subscribe race safe.
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
					// File vanished (session deleted mid-view) — keep polling quietly.
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

	return new Response(stream, { headers: sseHeaders() });
}
