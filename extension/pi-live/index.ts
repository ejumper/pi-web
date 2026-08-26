/**
 * pi-live — exposes a live event stream + safe control surface for this
 * terminal pi session.
 *
 * Part of the pi-web-session-streaming project. On session start it opens a
 * loopback-only HTTP server and registers itself in /tmp/pi-live-registry/
 * so the local pi-web instance can discover it:
 *
 *   GET  /state     → { ok, sessionId, isIdle, cwd, name }          (health)
 *   GET  /events    → SSE stream of agent events, verbatim           (1 subscriber)
 *   GET  /commands  → palette feed for remote surfaces
 *   POST /send      → { text, deliverAs? } inject a user prompt
 *   POST /abort     → abort the active run
 *
 * /send tier routing for text starting with "/":
 *   1. bridgeable builtins (/compact, /name)   → executed via ctx/pi methods
 *   2. skills/templates/extension commands     → sendUserMessage with
 *      expandPromptTemplates:true; extension commands filtered through a
 *      denylist (~/.pi/agent/pi-live-config.json: {"commandDenylist":[...]})
 *      so UI-dialog-popping commands stay desktop-only (allow-all otherwise)
 *   3. known interactive-TUI builtins (/tree, /resume, /settings, ...) → refused
 *
 * Deliberately dumb elsewhere: one SSE subscriber at a time (a second
 * connection replaces the first), events forwarded verbatim with no
 * reshaping. Multiplexing lives in pi-web (lib/live-fanout.ts).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { writeFileSync, renameSync, unlinkSync, mkdirSync, readFileSync } from "node:fs";

const REGISTRY_DIR = join(tmpdir(), "pi-live-registry");
const MAX_SEND_LENGTH = 32 * 1024;

/** Interactive-TUI builtins that cannot work remotely. Refused explicitly. */
const TUI_ONLY_BUILTINS = new Set([
	"login", "logout", "llama", "model", "scoped-models", "settings", "resume",
	"new", "session", "tree", "trust", "fork", "clone", "copy", "export",
	"import", "share", "reload", "hotkeys", "quit",
]);

interface LiveRegistryEntry {
	pid: number;
	port: number;
	cwd: string;
	sessionFile?: string;
	name?: string;
	startAt?: string;
	startedAt?: string;
}

function readDenylist(): string[] {
	try {
		const cfg = JSON.parse(readFileSync(join(homedir(), ".pi/agent/pi-live-config.json"), "utf8")) as {
			commandDenylist?: string[];
		};
		return Array.isArray(cfg.commandDenylist) ? cfg.commandDenylist.map((s) => s.toLowerCase()) : [];
	} catch {
		return [];
	}
}

// Version-skew accessors: newer runtimes expose thinkingLevel/setThinkingLevel
// (and a model object) on ExtensionContext; the pinned SDK types predate them.
interface CtxThinkingExtras {
	thinkingLevel?: string;
	setThinkingLevel?(level: string): void;
	model?: { provider: string; id: string };
}
function ctxExtras(ctx: ExtensionContext | null): CtxThinkingExtras | null {
	return ctx ? (ctx as unknown as CtxThinkingExtras) : null;
}

// ── Remote guard / read-mode state (Wave 1) ────────────────────────────────
// Both extensions mirror every toggle into a custom session entry, so the
// latest entry of each type IS the current state — readable from any sibling.
// Writes go over the shared extension event bus (fire-and-forget; if the
// counterpart extension is missing the event goes nowhere and state stays).
const GUARD_ENTRY_TYPE = "safeguard:enabled";
const GUARD_SET_EVENT = "safeguard:set";
const READ_MODE_ENTRY_TYPE = "read-mode:state";
const READ_MODE_TOGGLE_EVENT = "read-mode:toggle";

function lastCustomEntryData(ctx: ExtensionContext | null, customType: string): unknown {
	if (!ctx) return undefined;
	try {
		// Cast-heavy: pinned SDK types predate the custom-entry shape.
		const branch = ctx.sessionManager.getBranch() as unknown as Array<Record<string, unknown>>;
		let data: unknown;
		for (const entry of branch) {
			if (entry.type === "custom" && entry.customType === customType) data = entry.data;
		}
		return data;
	} catch {
		return undefined;
	}
}

/** Current /guard setting. Defaults to on (same convention as lib/safeguard.ts). */
function guardEnabledNow(ctx: ExtensionContext | null): boolean {
	const data = lastCustomEntryData(ctx, GUARD_ENTRY_TYPE) as { enabled?: unknown } | undefined;
	return typeof data?.enabled === "boolean" ? data.enabled : true;
}

/** Current read-mode setting. Absent entry means write mode (read-mode's own default). */
function readModeNow(ctx: ExtensionContext | null): "read" | "work" {
	const data = lastCustomEntryData(ctx, READ_MODE_ENTRY_TYPE) as { mode?: unknown } | undefined;
	return data?.mode === "read" ? "read" : "work";
}

export default function (pi: ExtensionAPI) {
	let server: ReturnType<typeof createServer> | null = null;
	let port = 0;
	let sessionId = "";
	let registryFile = "";
	// The single attached SSE subscriber's write sink; null while nobody watches.
	let sink: ((frame: unknown) => void) | null = null;
	let heartbeat: ReturnType<typeof setInterval> | null = null;
	let queuePoller: ReturnType<typeof setInterval> | null = null;
	let lastPendingKnown: boolean | null = null;
	let currentCtx: ExtensionContext | null = null;

	/** Push a full external_state snapshot to the attached viewer (if any). */
	const pushExternalState = () => {
		sink?.({
			type: "external_state",
			live: true,
			isIdle: currentCtx ? currentCtx.isIdle() : true,
			name: pi.getSessionName() || undefined,
			guardEnabled: guardEnabledNow(currentCtx),
			readMode: readModeNow(currentCtx),
			thinkingLevel:
				(pi as unknown as { getThinkingLevel?: () => string }).getThinkingLevel?.() ??
				ctxExtras(currentCtx)?.thinkingLevel,
		});
	};

	const updateStatus = () => {
		try {
			currentCtx?.ui.setStatus("pi-live", sink ? "live · 1 viewer" : "live");
		} catch {
			/* status line unavailable in non-TUI modes */
		}
	};

	const teardown = () => {
		sink = null;
		if (heartbeat) {
			clearInterval(heartbeat);
			heartbeat = null;
		}
		if (queuePoller) {
			clearInterval(queuePoller);
			queuePoller = null;
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
		lastPendingKnown = null;
	};

	function readBody(req: IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			let size = 0;
			req.on("data", (c: Buffer) => {
				size += c.length;
				if (size > MAX_SEND_LENGTH * 2) {
					reject(new Error("body too large"));
					req.destroy();
					return;
				}
				chunks.push(c);
			});
			req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			req.on("error", reject);
		});
	}

	function jsonResponse(res: ServerResponse, status: number, body: unknown) {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(body));
	}

	async function handleSendImpl(req: IncomingMessage, res: ServerResponse) {
		if (!currentCtx) return jsonResponse(res, 503, { ok: false, error: "no session" });
		let body: { text?: unknown; deliverAs?: unknown };
		try {
			body = JSON.parse(await readBody(req));
		} catch (e) {
			return jsonResponse(res, 400, { ok: false, error: `bad JSON: ${e}` });
		}
		const text = typeof body.text === "string" ? body.text.trim() : "";
		if (!text) return jsonResponse(res, 400, { ok: false, error: "text required" });

		// Slash-command tier routing.
		if (text.startsWith("/")) {
			const name = text.slice(1).split(/\s+/)[0]?.toLowerCase() ?? "";
			const args = text.slice(1 + name.length).trim();

			// Tier 1: bridgeable builtins.
			if (name === "compact") {
				currentCtx.compact(args ? { customInstructions: args } : {});
				return jsonResponse(res, 200, { ok: true, action: "builtin", detail: "compaction started" });
			}
			if (name === "name") {
				if (!args) return jsonResponse(res, 400, { ok: false, error: "usage: /name <name>" });
				pi.setSessionName(args);
				return jsonResponse(res, 200, { ok: true, action: "builtin", detail: `renamed to ${args}` });
			}
			if (name === "thinking") {
				const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
				if (!args || !levels.includes(args)) {
					return jsonResponse(res, 400, { ok: false, error: `usage: /thinking <${levels.join("|")}>` });
				}
				// Setters live on ExtensionAPI (runtime >= ~0.83), not the session ctx.
				const api = pi as unknown as { setThinkingLevel?(l: string): void };
				if (!api.setThinkingLevel) {
					return jsonResponse(res, 500, { ok: false, error: "pi runtime too old for remote thinking switch" });
				}
				api.setThinkingLevel(args);
				return jsonResponse(res, 200, { ok: true, action: "builtin", detail: `thinking level: ${args}` });
			}
			if (name === "guard") {
				const arg = args.toLowerCase();
				if (arg !== "on" && arg !== "off") {
					return jsonResponse(res, 400, {
						ok: false,
						error: "usage: /guard <on|off>",
						guardEnabled: guardEnabledNow(currentCtx),
					});
				}
				// Equivalent to the user typing /guard on|off in the terminal — the
				// patched pi-safeguard listens on this bus event (lib/safeguard.ts).
				pi.events.emit(GUARD_SET_EVENT, { enabled: arg === "on" });
				pushExternalState();
				return jsonResponse(res, 200, {
					ok: true,
					action: "builtin",
					detail: `guard ${arg}`,
					guardEnabled: arg === "on",
				});
			}
			if (name === "read" || name === "work") {
				const target = name; // "read" | "work"
				const commands = new Set(
					((pi.getCommands() ?? []) as Array<{ name: string }>).map((c) => c.name.toLowerCase()),
				);
				if (!commands.has("read")) {
					return jsonResponse(res, 200, {
						ok: false,
						action: "refused",
						error: "/read is unavailable — read-mode extension not loaded in this session",
					});
				}
				if (readModeNow(currentCtx) === target) {
					return jsonResponse(res, 200, {
						ok: true,
						action: "builtin",
						detail: `already in ${target} mode`,
						readMode: target,
					});
				}
				pi.events.emit(READ_MODE_TOGGLE_EVENT, { toggle: true });
				// Entering read mode also flips the guard (enterRead disables it); let
				// that settle so the pushed snapshot reports both truthfully.
				setTimeout(pushExternalState, 50);
				return jsonResponse(res, 200, {
					ok: true,
					action: "builtin",
					detail: `${target} mode requested`,
					readMode: target,
				});
			}

			// Tier 3: known interactive-TUI builtins are never remotely runnable.
			if (TUI_ONLY_BUILTINS.has(name)) {
				return jsonResponse(res, 200, {
					ok: false,
					action: "refused",
					error: `/${name} is an interactive terminal command — not available remotely`,
				});
			}

			// Tier 2: skills / prompt templates / extension commands via
			// expandPromptTemplates. Extension commands honor the denylist.
			if (readDenylist().includes(name)) {
				return jsonResponse(res, 200, {
					ok: false,
					action: "refused",
					error: `/${name} is denylisted for remote use (pi-live-config.json)`,
				});
			}
		}

		// Plain prompt or approved slash passthrough.
		const idle = currentCtx.isIdle();
		const deliverAs = body.deliverAs === "steer" || body.deliverAs === "followUp" ? body.deliverAs : undefined;
		// expandPromptTemplates exists in runtimes >= 0.83 but not in this
		// repo's pinned SDK types (0.80.10) — cast is deliberate version skew.
		type SendOpts = { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean };
		const slashOpts = { expandPromptTemplates: true } as SendOpts;
		try {
			if (idle) {
				await pi.sendUserMessage(text, text.startsWith("/") ? slashOpts : {});
			} else {
				await pi.sendUserMessage(text, {
					deliverAs: deliverAs ?? "followUp",
					...(text.startsWith("/") ? slashOpts : {}),
				});
			}
		} catch (e) {
			return jsonResponse(res, 500, { ok: false, error: String(e instanceof Error ? e.message : e) });
		}
		return jsonResponse(res, 200, { ok: true, action: "sent", queued: !idle });
	}

	async function handleAbort(_req: IncomingMessage, res: ServerResponse) {
		if (!currentCtx) return jsonResponse(res, 503, { ok: false, error: "no session" });
		const wasRunning = !currentCtx.isIdle();
		if (wasRunning) await currentCtx.abort();
		return jsonResponse(res, 200, { ok: true, wasRunning });
	}

	function handleCommands(_req: IncomingMessage, res: ServerResponse) {
		const deny = new Set(readDenylist());
		// String() comparisons: the pinned SDK types (0.80.10) predate the
		// "builtin" SlashCommandSource that newer runtimes emit.
		const commands = ((pi.getCommands() ?? []) as Array<{ name: string; description?: string; source?: string }>)
			.filter((c) => {
				const src = String(c.source ?? "");
				if (src === "builtin") return c.name === "compact" || c.name === "name";
				if (src === "extension") return !deny.has(c.name.toLowerCase());
				return true; // skills and prompt templates pass through
			})
			.map((c) => ({ name: c.name, description: c.description, source: String(c.source ?? "") }));
		return jsonResponse(res, 200, { ok: true, commands });
	}

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
		// Detach this connection from event-loop liveness too — server.unref()
		// does not propagate to accepted sockets. Without this, an attached
		// viewer blocks pi's exit after abort/natural completion.
		res.socket?.unref?.();

		res.write(`data: ${JSON.stringify({ type: "connected", sessionId, mode: "bridge" })}\n\n`);
		sink = (frame: unknown) => {
			try {
				res.write(`data: ${JSON.stringify(frame)}\n\n`);
			} catch {
				sink = null; // client vanished mid-write
			}
		};
		pushExternalState(); // sink now attached — snapshot reaches the new viewer

		heartbeat = setInterval(() => {
			try {
				res.write(":\n\n");
			} catch {
				sink = null;
			}
		}, 30_000);
		heartbeat.unref?.();

		updateStatus();
		res.on("close", () => {
			sink = null;
			if (heartbeat) {
				clearInterval(heartbeat);
				heartbeat = null;
			}
			updateStatus();
		});
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
				thinkingLevel:
					(pi as unknown as { getThinkingLevel?: () => string }).getThinkingLevel?.() ??
					ctxExtras(currentCtx)?.thinkingLevel,
				model: ctxExtras(currentCtx)?.model,
				guardEnabled: guardEnabledNow(currentCtx),
				readMode: readModeNow(currentCtx),
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
			if (req.url === "/commands") return handleCommands(req, res);
			if (req.url === "/send" && req.method === "POST") return handleSendImpl(req, res);
			if (req.url === "/abort" && req.method === "POST") return handleAbort(req, res);
			res.writeHead(404).end();
		});

		await new Promise<void>((resolve, reject) => {
			server!.once("error", reject);
			server!.listen(0, "127.0.0.1", () => resolve());
		});
		// CRITICAL: never let our handles keep pi's process alive. A listening
		// server unrefs its accepted connections too, so an open SSE stream
		// cannot block shutdown — pi must always be free to exit (its abort
		// path drains the event loop instead of calling process.exit()).
		server!.unref();
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

		// Queue visibility: honest boolean granularity (hasPendingMessages is a
		// boolean), pushed only on change while someone watches.
		queuePoller = setInterval(() => {
			if (!sink || !currentCtx) return;
			const pending = currentCtx.hasPendingMessages();
			if (pending !== lastPendingKnown) {
				lastPendingKnown = pending;
				sink({ type: "queue_pending", pending });
			}
		}, 500);
		queuePoller.unref?.();

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
	pi.on("model_select", async (event) => forward(event));
	pi.on("thinking_level_select", async (event) => forward(event));
	// Renames from any source (/name, session-titler, terminal UI) reach the
	// browser as-is; the client patches its sidebar title without a refetch.
	pi.on("session_info_changed", async (event) => forward(event));

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
