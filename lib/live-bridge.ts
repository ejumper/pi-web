// ============================================================================
// live-bridge — discovery for pi sessions that are live in a terminal.
//
// A companion extension ("pi-live", see the pi-web-session-streaming project)
// runs inside each interactive terminal pi. On session start it writes
//
//   /tmp/pi-live-registry/<sessionId>.json
//     { pid, port, cwd, sessionFile, name, startedAt }
//
// and removes the file on session shutdown / process exit. This module reads
// that registry and validates liveness so the rest of pi-web can treat
// terminal-owned sessions as read-only-live instead of spawning a second
// in-process agent on the same JSONL (the two-writer hazard).
//
// Registry state is intentionally ephemeral (/tmp): it matches process
// lifetime exactly and keeps runtime files out of the git-synced ~/.pi repo.
// Phase 2 adds an HTTP bridge on the registered port; Phase 1 only needs
// existence + liveness.
// ============================================================================

import { readdirSync, readFileSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export interface LiveRegistryEntry {
  pid: number;
  /** HTTP bridge port; present from Phase 2 onward. Absent/0 in Phase 1. */
  port?: number;
  cwd?: string;
  sessionFile?: string;
  name?: string;
  startedAt?: string;
}

const REGISTRY_DIR = join(tmpdir(), "pi-live-registry");
/** Files younger than this with unparsable content are treated as mid-write races, not stale junk. */
const STALE_GRACE_MS = 10_000;
/** Cache TTL for registry scans (cheap readdir + a few stat calls). */
const SCAN_TTL_MS = 2_000;

interface ScanCache {
  ts: number;
  entries: Map<string, LiveRegistryEntry>;
}

// globalThis storage survives Next.js hot reloads (same pattern as session-reader).
const g = globalThis as typeof globalThis & { __piLiveBridgeScan?: ScanCache };

function sweepStale(name: string): void {
  try {
    const full = join(REGISTRY_DIR, name);
    const age = Date.now() - statSync(full).mtimeMs;
    if (age > STALE_GRACE_MS) {
      try { unlinkSync(full); } catch { /* lost the race; fine */ }
    }
  } catch { /* already gone */ }
}

/** Scan the registry dir. Dead-pid entries are swept on sight. */
export function readRegistry(): Map<string, LiveRegistryEntry> {
  const cached = g.__piLiveBridgeScan;
  if (cached && Date.now() - cached.ts < SCAN_TTL_MS) return cached.entries;

  const entries = new Map<string, LiveRegistryEntry>();
  let names: string[] = [];
  try {
    names = readdirSync(REGISTRY_DIR).filter((n) => n.endsWith(".json"));
  } catch {
    // ENOENT: no extension has ever run — perfectly normal.
  }

  for (const name of names) {
    let raw: string;
    try {
      raw = readFileSync(join(REGISTRY_DIR, name), "utf8");
    } catch {
      continue; // vanished between readdir and read
    }
    let entry: LiveRegistryEntry | null = null;
    try {
      const parsed = JSON.parse(raw) as LiveRegistryEntry;
      if (typeof parsed?.pid === "number") entry = parsed;
    } catch {
      // Possibly mid-write. Only treat as stale junk after the grace window.
      sweepStale(name);
      continue;
    }
    if (!entry) continue;

    // Liveness: signal 0 throws ESRCH if the pid is gone.
    try {
      process.kill(entry.pid, 0);
    } catch {
      sweepStale(name);
      continue;
    }
    // Strip ".json" → sessionId. Ids are uuid-ish and safe as filenames,
    // but decode defensively anyway.
    const id = safeDecodeName(name);
    if (id) entries.set(id, entry);
  }

  g.__piLiveBridgeScan = { entries, ts: Date.now() };
  return entries;
}

function safeDecodeName(name: string): string | null {
  const base = name.replace(/\.json$/, "");
  try {
    return decodeURIComponent(base);
  } catch {
    return base || null;
  }
}

export function getLiveEntry(sessionId: string): LiveRegistryEntry | null {
  return readRegistry().get(sessionId) ?? null;
}

/**
 * Cache-bypassing lookup. The live events route uses this per browser
 * subscription: a 2s-stale scan otherwise races freshly started terminal
 * sessions into a false "not live" verdict.
 */
export function getLiveEntryFresh(sessionId: string): LiveRegistryEntry | null {
  g.__piLiveBridgeScan = undefined;
  return readRegistry().get(sessionId) ?? null;
}

export function isLive(sessionId: string): boolean {
  return getLiveEntry(sessionId) !== null;
}

export function getLiveSessionIds(): string[] {
  return [...readRegistry().keys()];
}
