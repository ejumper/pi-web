"use client";

/**
 * Small centered confirm dialog — used for destructive file/browser
 * actions. A custom dialog (not window.confirm) so it behaves identically
 * everywhere and matches the app's look.
 */
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
