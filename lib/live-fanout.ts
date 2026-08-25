// ============================================================================
// live-fanout — proxy-side multiplexer for pi-live bridge streams.
//
// The extension inside a terminal pi serves exactly ONE SSE subscriber
// (replace-on-reconnect). This module is pi-web's single upstream client:
// it holds one connection per live session and fans every frame out to any
// number of browser EventSource subscribers.
//
// Lifecycle per session id:
//   first subscriber  → lazy upstream connect to http://127.0.0.1:<port>/events
//   frame arrives     → enqueue to all subscribers (slow/closed ones dropped)
//   upstream dies     → retry ×3 (1s backoff), then emit bridge_lost and close
//                       all subscribers; their EventSources reconnect, the
//                       route's health check fails, and they land in tail mode.
//   last unsubscribe  → upstream closed
// ============================================================================

import type { LiveRegistryEntry } from "./live-bridge";

interface Subscriber {
	write: (chunk: Uint8Array) => void;
	close: () => void;
}

class FanoutSession {
	readonly subscribers = new Set<Subscriber>();
	private abort: AbortController | null = null;
	private retriesLeft = 3;
	private connecting = false;

	constructor(
		readonly sessionId: string,
		private readonly entry: LiveRegistryEntry,
	) {}

	get subscriberCount(): number {
		return this.subscribers.size;
	}

	add(sub: Subscriber): void {
		this.subscribers.add(sub);
		if (!this.abort && !this.connecting) this.connect();
	}

	remove(sub: Subscriber): void {
		this.subscribers.delete(sub);
		if (this.subscribers.size === 0) this.shutdown();
	}

	broadcast(text: string): void {
		const chunk = new TextEncoder().encode(text);
		for (const sub of [...this.subscribers]) {
			try {
				sub.write(chunk);
			} catch {
				this.subscribers.delete(sub); // slow/closed consumer — drop, don't buffer
				try {
					sub.close();
				} catch {
					/* already closed */
				}
			}
		}
	}

	shutdown(): void {
		this.abort?.abort();
		this.abort = null;
		for (const sub of [...this.subscribers]) {
			try {
				sub.close();
			} catch {
				/* already closed */
			}
		}
		this.subscribers.clear();
		fanoutSessions.delete(this.sessionId);
	}

	private async connect(): Promise<void> {
		this.connecting = true;
		try {
			this.abort = new AbortController();
			const res = await fetch(`http://127.0.0.1:${this.entry.port}/events`, {
				signal: this.abort.signal,
				headers: { Accept: "text/event-stream" },
			});
			if (!res.ok || !res.body) throw new Error(`bridge HTTP ${res.status}`);
			this.retriesLeft = 3; // healthy connection resets the retry budget

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let idx: number;
				while ((idx = buffer.indexOf("\n\n")) !== -1) {
					const block = buffer.slice(0, idx);
					buffer = buffer.slice(idx + 2);
					const line = block.split("\n").find((l) => l.startsWith("data:"));
					if (!line) continue; // heartbeat comment or malformed block
					this.broadcast(`${line}\n\n`);
				}
			}
			// Upstream ended (extension gone / replaced / terminal quit).
			throw new Error("bridge stream ended");
		} catch (err) {
			if ((err as Error)?.name === "AbortError") return; // we shut down ourselves
			if (this.retriesLeft > 0 && this.subscribers.size > 0) {
				this.retriesLeft -= 1;
				this.abort = null;
				setTimeout(() => {
					if (this.subscribers.size > 0 && !this.abort) void this.connect();
				}, 1_000);
				return;
			}
			// Permanent loss: tell subscribers why, then cut them loose. Their
			// reconnects fail the health check and degrade to tail mode.
			this.broadcast(
				`data: ${JSON.stringify({ type: "external_state", live: false, bridgeLost: true })}\n\n`,
			);
			this.shutdown();
		} finally {
			this.connecting = false;
		}
	}
}

const g = globalThis as typeof globalThis & {
	__piLiveFanoutSessions?: Map<string, FanoutSession>;
};
const fanoutSessions = (g.__piLiveFanoutSessions ??= new Map<string, FanoutSession>());

/** True when a health check against the bridge succeeds quickly. */
export async function checkBridge(entry: LiveRegistryEntry): Promise<boolean> {
	if (!entry.port) return false;
	try {
		const res = await fetch(`http://127.0.0.1:${entry.port}/state`, {
			signal: AbortSignal.timeout(500),
		});
		if (!res.ok) return false;
		const body = (await res.json()) as { ok?: boolean };
		return body.ok === true;
	} catch {
		return false;
	}
}

/**
 * Attach a browser subscriber to the bridge for `sessionId`.
 * Returns an unsubscribe function that also tears down idle upstreams.
 */
export function addBridgeSubscriber(
	sessionId: string,
	entry: LiveRegistryEntry,
	write: (chunk: Uint8Array) => void,
	close: () => void,
): () => void {
	let session = fanoutSessions.get(sessionId);
	if (!session) {
		session = new FanoutSession(sessionId, entry);
		fanoutSessions.set(sessionId, session);
	}
	const sub: Subscriber = { write, close };
	session.add(sub);
	return () => session!.remove(sub);
}
