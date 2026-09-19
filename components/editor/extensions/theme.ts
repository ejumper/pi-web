import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";

/**
 * Editor chrome, built entirely from pi-web's existing CSS custom
 * properties (see app/globals.css) rather than hardcoded colors — this
 * tracks the app's light/dark (`html.dark`) toggle automatically, with no
 * JS reconfiguration needed. Matches the font-size/line-height/font-family
 * the old SyntaxHighlighter-based viewer used.
 */
export function piEditorTheme(): Extension {
  return EditorView.theme({
    "&": {
      height: "100%",
      background: "var(--bg)",
      color: "var(--text)",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      overflow: "auto",
    },
    ".cm-content": {
      fontSize: "13px",
      lineHeight: "1.6",
      padding: "12px 0",
      caretColor: "var(--text)",
    },
    ".cm-gutters": {
      background: "var(--bg)",
      color: "var(--text-dim)",
      border: "none",
      borderRight: "1px solid var(--border)",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "3em",
      paddingRight: "1em",
    },
    ".cm-activeLine": {
      // Translucent on purpose -- see the --active-line-bg note in globals.css.
      // The selection layer sits at z-index -1, under the content, so an opaque
      // background here hides the selection on the line the cursor is on.
      background: "var(--active-line-bg)",
    },
    ".cm-activeLineGutter": {
      background: "var(--bg-hover)",
      color: "var(--text-dim)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      background: "var(--selection-bg) !important",
    },
    // Find-in-editor matches: amber, so they stay distinguishable from the real
    // selection when both are on screen.
    ".cm-selectionMatch": {
      background: "var(--selection-match-bg)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--text)",
    },
  });
}

/** Light/dark token-color extension — swapped live via a Compartment when the app theme changes. */
export function getSyntaxHighlightExtension(isDark: boolean): Extension {
  return syntaxHighlighting(isDark ? oneDarkHighlightStyle : defaultHighlightStyle);
}
