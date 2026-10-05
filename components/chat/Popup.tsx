"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Shared popup template for the /chat bottom-bar menus (Models, Attachments,
 * Sessions) — one styling surface for all of them. Everything inside is marked
 * data-ui so the page's gesture layer ignores it.
 */
export function Popup({
  title,
  onClose,
  children,
  bodyRef,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  bodyRef?: React.RefObject<HTMLDivElement | null>;
}) {
  // Close on Escape (desktop convenience).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="popup-backdrop"
      data-ui
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="popup-panel" data-ui>
        <div className="popup-header">
          <span className="popup-title">{title}</span>
          <button className="popup-close" data-ui onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="popup-body" ref={bodyRef}>
          {children}
        </div>
      </div>
    </div>
  );
}
