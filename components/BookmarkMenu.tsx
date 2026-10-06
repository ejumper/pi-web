"use client";

import { useEffect, useRef, useState } from "react";
import { addBookmark, moveBookmark, removeBookmark, useFileBookmarks, type Bookmark } from "@/lib/file-bookmarks";

interface Props {
  /** Reveal + select a directory in the file tree. */
  onFocusDir: (dir: string) => void;
}

const ROW_H = 30;

/**
 * Bookmarks dropdown for the file browser toolbar: bookmarked directories
 * in insertion order, drag to reorder (pointer-based, works with touch),
 * "x" removes after a confirmation dialog. Selecting an entry focuses the
 * directory in the tree. State persists in localStorage
 * (pi-web:file-bookmarks) and is shared across Browse tabs.
 */
export function BookmarkMenu({ onFocusDir }: Props) {
  const bookmarks = useFileBookmarks();
  const [open, setOpen] = useState(false);
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ index: number; startY: number; moved: boolean } | null>(null);

  // Close on outside press / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const confirmTarget = confirmPath ? bookmarks.find((b) => b.path === confirmPath) ?? null : null;

  return (
    <div ref={wrapRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Bookmarks"
        aria-label="Bookmarks"
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 24, height: 24, padding: 0,
          background: open ? "var(--bg-selected)" : "none",
          border: "none", borderRadius: 5,
          color: open ? "var(--text)" : "var(--text-dim)",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = open ? "var(--bg-selected)" : "none"; e.currentTarget.style.color = open ? "var(--text)" : "var(--text-dim)"; }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0,
          zIndex: 200, minWidth: 220, maxHeight: 280, overflowY: "auto",
          background: "var(--bg)", border: "1px solid var(--border)",
          borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.18)", padding: 4,
        }}>
          {bookmarks.length === 0 && (
            <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-dim)" }}>
              No bookmarks yet — right-click a folder to add one.
            </div>
          )}
          {bookmarks.map((b: Bookmark, i: number) => (
            <div
              key={b.path}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                height: ROW_H - 4, padding: "0 4px 0 8px",
                borderRadius: 5, cursor: "pointer", fontSize: 12.5,
                color: "var(--text)",
                touchAction: "none", // pointer-based drag, not scroll
              }}
              title={b.path}
              onPointerDown={(e) => {
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                dragRef.current = { index: i, startY: e.clientY, moved: false };
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                if (!d) return;
                const dy = e.clientY - d.startY;
                if (!d.moved && Math.abs(dy) < 5) return;
                d.moved = true;
                if (Math.abs(dy) >= ROW_H) {
                  const dir = dy > 0 ? 1 : -1;
                  const to = d.index + dir;
                  if (to >= 0 && to < bookmarks.length) {
                    moveBookmark(d.index, to);
                    d.index = to;
                    d.startY += dir * ROW_H;
                  }
                }
              }}
              onPointerUp={() => {
                const d = dragRef.current;
                dragRef.current = null;
                if (d && !d.moved) {
                  setOpen(false);
                  onFocusDir(b.path);
                }
              }}
              onPointerCancel={() => { dragRef.current = null; }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", pointerEvents: "none" }}>
                {b.name}
              </span>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setConfirmPath(b.path); }}
                title={`Remove "${b.name}" from bookmarks`}
                aria-label={`Remove ${b.name} from bookmarks`}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 20, height: 20, padding: 0,
                  background: "none", border: "none", borderRadius: 4,
                  color: "var(--text-dim)", cursor: "pointer", flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "#ef4444"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-dim)"; }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Remove confirmation (window.confirm is silently ignored in iOS
          standalone PWAs — dialogs must be custom) */}
      {confirmTarget && (
        <ConfirmDialog
          message={`Remove "${confirmTarget.name}" from bookmarks?`}
          confirmLabel="Remove"
          onCancel={() => setConfirmPath(null)}
          onConfirm={() => {
            removeBookmark(confirmTarget.path);
            setConfirmPath(null);
          }}
        />
      )}
    </div>
  );
}

/** Small centered confirm dialog — works everywhere (incl. iOS PWAs). */
export function ConfirmDialog({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.28)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onPointerDown={(e) => { e.stopPropagation(); onCancel(); }}
    >
      <div
        style={{
          background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10,
          padding: 16, maxWidth: 300, margin: 16,
          boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5, marginBottom: 14 }}>{message}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{ padding: "6px 12px", fontSize: 12, borderRadius: 6, border: "1px solid var(--border)", background: "none", color: "var(--text-muted)", cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{ padding: "6px 12px", fontSize: 12, borderRadius: 6, border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.1)", color: "#ef4444", cursor: "pointer", fontWeight: 600 }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export { addBookmark };
