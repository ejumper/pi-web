import { RangeSetBuilder, type EditorState, type Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * Markdown highlighting that mirrors the user's micro editor look
 * (~/.config/micro/syntax/markdown.yaml + modus-vivendi colorscheme).
 *
 * Deliberately simplified: all markdown *marks* (#, *, >, `, list bullets)
 * share one CM tag (processingInstruction), so they all get the same
 * receded gray. micro grays only the emphasis markers — this is as close as
 * a plain HighlightStyle gets without a custom tree-walking decoration.
 *
 * The one structural feature worth the small extra plugin: h1 gets a
 * full-width underline across the whole line (matching the patched
 * micro-indentwrap build), implemented as a line decoration keyed on the
 * `^# ` prefix rather than a syntax-tree walk.
 *
 * All colors are CSS custom properties (see app/globals.css) so the
 * light/dark app toggle works with no JS reconfiguration.
 */
export const microMarkdownHighlightStyle = HighlightStyle.define([
  // h1/h2: blue, bold italic underline (micro "headline")
  {
    tag: [t.heading1, t.heading2],
    color: "var(--md-h1)",
    fontWeight: "bold",
    fontStyle: "italic",
    textDecoration: "underline",
  },
  // h3-h6: bright blue (micro "headline-3-6")
  {
    tag: [t.heading3, t.heading4, t.heading5, t.heading6],
    color: "var(--md-h3)",
    fontWeight: "bold",
    fontStyle: "italic",
    textDecoration: "underline",
  },
  // emphasis text stays pure white in dark mode (micro bold-text/italic-text)
  { tag: t.strong, color: "var(--md-strong)", fontWeight: "bold" },
  { tag: t.emphasis, color: "var(--md-emphasis)", fontStyle: "italic" },
  // inline + fenced code: green (micro code-inline/code-block)
  { tag: t.monospace, color: "var(--md-code)" },
  // quotes: bold magenta-pink (micro statement)
  { tag: t.quote, color: "var(--md-quote)", fontWeight: "bold" },
  // links + labels: purple (micro constant)
  { tag: [t.link, t.labelName], color: "var(--md-link)" },
  // bare urls: underlined (micro underlined)
  { tag: t.url, color: "var(--md-link)", textDecoration: "underline" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  // horizontal rules (micro special)
  { tag: t.contentSeparator, color: "var(--md-hr)" },
  // all markup punctuation (#, *, >, `, bullets): receded gray
  { tag: [t.processingInstruction, t.escape], color: "var(--md-mark)" },
]);

// Full-width underline under `# ` heading lines — the patched-micro look.
function h1LineDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    if (/^#(?!#)\s/.test(line.text)) {
      builder.add(line.from, line.from, Decoration.line({ class: "md-h1-row" }));
    }
  }
  return builder.finish();
}

const h1FullWidthUnderline = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = h1LineDecorations(view.state);
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = h1LineDecorations(update.state);
    }
  },
  { decorations: (v) => v.decorations },
);

export function microMarkdown(): Extension {
  return [syntaxHighlighting(microMarkdownHighlightStyle), h1FullWidthUnderline];
}
