import { readdirSync, statSync } from "fs";
import { dirname, join } from "path";

/**
 * Find the newest session file for `sessionId` near a known-stale path,
 * WITHOUT the global list scan.
 *
 * Relocations (pi-session-move) keep the session id in the filename inside
 * the same encoded-cwd directory, so a scoped readdir + newest-mtime-wins
 * resolves in milliseconds — same tiebreak rule as loadAllSessions. The full
 * listAllSessions rescan is avoided deliberately on hot paths: it re-runs
 * git project resolution across every session directory and can take tens
 * of seconds.
 */
export function resolveRelocatedSession(stalePath: string, sessionId: string): string | null {
	try {
		const dir = dirname(stalePath);
		let best: string | null = null;
		let bestMtime = -1;
		for (const f of readdirSync(dir)) {
			if (!f.includes(sessionId) || !f.endsWith(".jsonl")) continue;
			const candidate = join(dir, f);
			try {
				const mtime = statSync(candidate).mtimeMs;
				if (mtime > bestMtime) {
					bestMtime = mtime;
					best = candidate;
				}
			} catch {
				/* raced deletion — skip */
			}
		}
		return best;
	} catch {
		return null; // directory gone entirely
	}
}
