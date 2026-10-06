/**
 * Unsaved-draft snapshots + editor cursor memory for the file editor.
 *
 * iOS kills standalone PWAs aggressively (no warning, no beforeunload), so
 * losing unsaved edits to an app switch is a real hazard. The editor
 * snapshots dirty buffers here ~2s after typing stops (and on pagehide /
 * tab-hide), and offers to restore anything that differs from what's on
 * disk when the file is next opened.
 *
 * Storage notes: localStorage writes are synchronous and survive even a
 * swipe-kill. iOS's ITP 7-day eviction applies to PWAs NOT opened for 7
 * days — irrelevant for a daily tool (and drafts are a safety net on top
 * of saving, not a backup). Entries are capped (count + per-entry size) so
 * a big paste can't blow the ~5MB quota.
 */

export interface EditorDraft {
  content: string;
  cursor: number | null;
  /** epoch ms of the last snapshot */
  ts: number;
}

const DRAFTS_KEY = "pi-web:editor-drafts";
const CURSOR_KEY = "pi-web:editor-cursors";
const MAX_ENTRIES = 12;
const MAX_CONTENT_CHARS = 400_000;

type DraftMap = Record<string, EditorDraft>;
type CursorMap = Record<string, number>;

function loadMap<T>(key: string): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

function saveMap(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota/unavailable — drafts are best-effort */ }
}

export function saveEditorDraft(filePath: string, draft: EditorDraft) {
  // Too big to snapshot safely within the quota — better no draft than a
  // quota blowout that evicts everything else.
  if (draft.content.length > MAX_CONTENT_CHARS) return;
  const map = loadMap<DraftMap>(DRAFTS_KEY);
  map[filePath] = draft;
  const trimmed = Object.fromEntries(
    Object.entries(map)
      .sort((a, b) => b[1].ts - a[1].ts)
      .slice(0, MAX_ENTRIES),
  );
  saveMap(DRAFTS_KEY, trimmed);
}

export function getEditorDraft(filePath: string): EditorDraft | null {
  return loadMap<DraftMap>(DRAFTS_KEY)[filePath] ?? null;
}

export function clearEditorDraft(filePath: string) {
  const map = loadMap<DraftMap>(DRAFTS_KEY);
  if (!(filePath in map)) return;
  delete map[filePath];
  saveMap(DRAFTS_KEY, map);
}

export function saveEditorCursor(filePath: string, cursor: number) {
  const map = loadMap<CursorMap>(CURSOR_KEY);
  map[filePath] = cursor;
  // bounded: cursor memory is per-file and small, but keep it trimmed too
  const keys = Object.keys(map);
  if (keys.length > 200) {
    for (const k of keys.slice(0, keys.length - 200)) delete map[k];
  }
  saveMap(CURSOR_KEY, map);
}

export function getEditorCursor(filePath: string): number | null {
  const v = loadMap<CursorMap>(CURSOR_KEY)[filePath];
  return typeof v === "number" ? v : null;
}
