"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export interface CodeMirrorHostProps {
  doc: string;
  extensions: Extension[];
  onReady?: (view: EditorView) => void;
  onDocChange?: (doc: string, view: EditorView) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * Thin React wrapper around a CM6 EditorView. Creates the view once per
 * mount and does not react to prop changes afterward — all post-mount
 * changes (theme, wrap, language) go through Compartments obtained via
 * `onReady`. Callers that need a fresh editor for a new document must
 * remount this component (e.g. `key={filePath}`), not rely on prop updates.
 */
export function CodeMirrorHost({
  doc,
  extensions,
  onReady,
  onDocChange,
  className,
  style,
}: CodeMirrorHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc,
      extensions: [
        ...extensions,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          onDocChange?.(update.state.doc.toString(), update.view);
        }),
      ],
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    onReady?.(view);

    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // Intentionally empty deps — create once per mount. Callers key this
    // component by document identity to force a remount instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className={className} style={{ height: "100%", ...style }} />;
}
