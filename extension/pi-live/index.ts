/**
 * pi-live — exposes a live event stream for this terminal pi session.
 *
 * Part of the pi-web-session-streaming project. On session start it opens a
 * loopback-only HTTP server and registers itself in /tmp/pi-live-registry/
 * so the local pi-web instance can discover it:
 *
 *   GET /state   → { ok, sessionId, isIdle, cwd, name }        (health check)
 *   GET /events  → SSE stream of agent events, verbatim         (single subscriber)
 *
 * SSE frames, in order, per subscriber:
 *   {"type":"connected","sessionId":...,"mode":"bridge"}
 *   {"type":"external_state","live":true,"isIdle":...,"name":...}
 *   ...raw pi events (message_start/update/end, tool_execution_*, turn_*, agent_end)...
 *
 * Deliberately dumb: one subscriber at a time (a second connection replaces
 * the first), events forwarded verbatim with no reshaping, no buffering while
 * nobody is attached. Multiplexing lives in pi-web (lib/live-fanout.ts).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";

const REGISTRY_DIR = join(tmpdir(), "pi-live-registry");

interface LiveRegistryEntry {
	pid: number;
	port: number;
	cwd: string;
	sessionFile?: string;
	name?: string;
	startedAt: string;
}

export default function (pi: ExtensionAPI) {
	let server: ReturnType<typeof createServer> | null = null;
	let port = 0;
	let sessionId = "";
	let registryFile = "";
	// The single attached SSE subscriber's write sink; null while nobody watches.
	let sink: ((frame: unknown) => void) | null = null;
	let heartbeat: ReturnType<typeof setInterval> | null = null;
	let currentCtx: ExtensionContext | null = null;

	const updateStatus = () => {
		try {
			currentCtx?.ui.setStatus("pi-live", sink ? "live · 1 viewer" : "live");
		} catch {
			/* status line unavailable in non-TUI modes */
		}
	};

	const teardown = () => {
		if (sink) {
			sink = null;
		}
		if (heartbeat) {
			clearInterval(heartbeat);
			heartbeat = null;
		}
		if (server) {
			try {
				server.close();
			} catch {
				/* already closed */
			}
			server = null;
			port = 0;
		}
		if (registryFile) {
			try {
				unlinkSync(registryFile);
			} catch {
				/* already gone */
			}
			registryFile = "";
		}
	};

	const handleEvents = (_req: IncomingMessage, res: ServerResponse) => {
		// Replace-on-second-subscriber: a proxy restart must not wedge us.
		if (sink) {
			sink({ type: "replaced" });
			sink = null;
			if (heartbeat) {
				clearInterval(heartbeat);
				heartbeat = null;
			}
		}

		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});

		const encoder = new TextEncoder();
		res.write(`data: ${JSON.stringify({ type: "connected", sessionId, mode: "bridge" })}\n\n`);
		res.write(
			`data: ${JSON.stringify({
				type: "external_state",
				live: true,
				isIdle: currentCtx ? currentCtx.isIdle() : true,
				name: pi.getSessionName() || undefined,
			})}\n\n`,
		);

		sink = (frame: unknown) => {
			try {
				res.write(`data: ${JSON.stringify(frame)}\n\n`);
			} catch {
				sink = null; // client vanished mid-write
			}
		};

		heartbeat = setInterval(() => {
			try {
				res.write(":\n\n");
			} catch {
				sink = null;
			}
		}, 30_000);

		updateStatus();
		res.on("close", () => {
			sink = null;
			if (heartbeat) {
				clearInterval(heartbeat);
				heartbeat = null;
			}
			updateStatus();
		});
		void encoder;
	};

	const handleState = (_req: IncomingMessage, res: ServerResponse) => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({
				ok: true,
				sessionId,
				isIdle: currentCtx ? currentCtx.isIdle() : true,
				cwd: currentCtx?.cwd,
				name: pi.getSessionName() || undefined,
			}),
		);
	};

	const setup = async (ctx: ExtensionContext) => {
		// Rebind-safe: switching/resuming sessions tears the old registration down first.
		teardown();
		currentCtx = ctx;
		sessionId = ctx.sessionManager.getSessionId();

		server = createServer((req, res) => {
			if (req.url === "/events") return handleEvents(req, res);
			if (req.url === "/state") return handleState(req, res);
			res.writeHead(404).end();
		});

		await new Promise<void>((resolve, reject) => {
			server!.once("error", reject);
			server!.listen(0, "127.0.0.1", () => resolve());
		});
		const addr = server.address();
		port = typeof addr === "object" && addr ? addr.port : 0;

		const entry: LiveRegistryEntry = {
			pid: process.pid,
			port,
			cwd: ctx.cwd,
			sessionFile: ctx.sessionManager.getSessionFile(),
			name: pi.getSessionName() || undefined,
			startedAt: new Date().toISOString(),
		};
		mkdirSync(REGISTRY_DIR, { recursive: true });
		registryFile = join(REGISTRY_DIR, `${sessionId}.json`);
		const tmp = `${registryFile}.tmp-${process.pid}`;
		writeFileSync(tmp, JSON.stringify(entry));
		renameSync(tmp, registryFile); // atomic publish

		updateStatus();
	};

	// Forward every relevant event verbatim to the attached subscriber.
	const forward = (frame: unknown) => {
		sink?.(frame);
	};
	// Explicit registrations: pi.on's overloads are keyed per event name, so a
	// dynamic union would not typecheck. Each handler still just forwards.
	pi.on("message_start", async (event) => forward(event));
	pi.on("message_update", async (event) => forward(event));
	pi.on("message_end", async (event) => forward(event));
	pi.on("tool_execution_start", async (event) => forward(event));
	pi.on("tool_execution_update", async (event) => forward(event));
	pi.on("tool_execution_end", async (event) => forward(event));
	pi.on("turn_start", async (event) => forward(event));
	pi.on("turn_end", async (event) => forward(event));
	pi.on("agent_start", async (event) => forward(event));
	pi.on("agent_end", async (event) => forward(event));
	pi.on("agent_settled", async (event) => forward(event));

	pi.on("session_start", async (_event, ctx) => {
		await setup(ctx);
	});

	pi.on("session_shutdown", () => {
		teardown();
		currentCtx = null;
	});

	// Belt & braces for quit paths that skip session_shutdown.
	process.on("exit", () => {
		if (registryFile) {
			try {
				unlinkSync(registryFile);
			} catch {
				/* gone */
			}
		}
	});
}
