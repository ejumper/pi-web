import { RangeSetBuilder, type EditorState, type Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * Markdown highlighting that mirrors the user's micro editor look
 * (~/.config/micro/syntax/markdown.yaml + modus-vivendi colorscheme).
 *
 * Header spec — ONE blue for all headings (no two-color split):
 *   h1   = blue background band across the whole line, white bold-italic text
 *   h2   = blue bold-italic text + underline spanning the whole line
 *   h3   = blue bold-italic + underline under the text only
 *   h4-6 = blue bold-italic, no underline
 *
 * Deliberately simplified: all markdown *marks* (#, *, >, `, list bullets)
 * share one CM tag (processingInstruction), so they all get the same
 * receded gray. micro grays only the emphasis markers — this is as close as
 * a plain HighlightStyle gets without a custom tree-walking decoration.
 *
 * The row treatments (h1 band, h2 full-width underline) are line decorations
 * keyed on the `^#` / `^##` prefix rather than a syntax-tree walk — cheap
 * and robust for the editing use case.
 *
 * All colors are CSS custom properties (see app/globals.css) so the
 * light/dark app toggle works with no JS reconfiguration.
 */
export const microMarkdownHighlightStyle = HighlightStyle.define([
  // h1 text sits on the blue row band (.md-h1-row) — white pops on it,
  // mirroring micro's "bright white on ANSI blue".
  { tag: t.heading1, color: "var(--md-h1-text)", fontWeight: "bold", fontStyle: "italic" },
  // h2: blue bold-italic, NO text-decoration — .md-h2-row::after draws the
  // underline across the whole line instead.
  { tag: t.heading2, color: "var(--md-heading)", fontWeight: "bold", fontStyle: "italic" },
  // h3: blue bold-italic, underlined under the text only. The decoration
  // color is pinned (here and on the marks below): the propagated underline
  // would otherwise be painted gray under the `###` marks.
  {
    tag: t.heading3,
    color: "var(--md-heading)",
    fontWeight: "bold",
    fontStyle: "italic",
    textDecoration: "underline",
    textDecorationColor: "var(--md-heading)",
  },
  // h4-h6: blue bold-italic, no underline
  {
    tag: [t.heading4, t.heading5, t.heading6],
    color: "var(--md-heading)",
    fontWeight: "bold",
    fontStyle: "italic",
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
  // all markup punctuation (#, *, >, `, bullets): receded gray — the
  // decoration-color pin keeps h3 underlines blue under the marks
  {
    tag: [t.processingInstruction, t.escape],
    color: "var(--md-mark)",
    textDecorationColor: "var(--md-heading)",
  },
]);

// Row treatments: h1 = full-width blue band, h2 = full-width underline.
// Keyed on the `^# ` / `^## ` prefix rather than a syntax-tree walk.
function headingLineDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    if (/^#(?!#)\s/.test(line.text)) {
      builder.add(line.from, line.from, Decoration.line({ class: "md-h1-row" }));
    } else if (/^##(?!#)\s/.test(line.text)) {
      builder.add(line.from, line.from, Decoration.line({ class: "md-h2-row" }));
    }
  }
  return builder.finish();
}

const headingRowDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = headingLineDecorations(view.state);
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = headingLineDecorations(update.state);
    }
  },
  { decorations: (v) => v.decorations },
);

export function microMarkdown(): Extension {
  return [syntaxHighlighting(microMarkdownHighlightStyle), headingRowDecorations];
}
