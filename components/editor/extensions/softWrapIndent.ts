import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

const MAX_WRAP_INDENT_PX = 480;

const MEASURE_STRINGS = [
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  ". ", ") ",
  "- ", "* ", "+ ",
  " ",
] as const;

class WrapMeasure {
  private container: HTMLDivElement;
  private spans = new Map<string, HTMLSpanElement>();
  private widths = new Map<string, number>();
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;

  constructor(view: EditorView, private readonly onChange: () => void) {
    this.container = document.createElement("div");
    this.container.className = "cm-pw-wrap-measure";
    for (const s of MEASURE_STRINGS) {
      const span = document.createElement("span");
      span.className = "cm-pw-wrap-measure-item";
      span.textContent = s;
      this.container.appendChild(span);
      this.spans.set(s, span);
    }
    view.scrollDOM.appendChild(this.container);
    this.measure();
    void this.measureAfterFontsLoad();
    this.observeResize();
  }

  private observeResize(): void {
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.destroyed) return;
      if (this.measure()) {
        this.onChange();
      }
    });
    this.resizeObserver.observe(this.container);
  }

  private async measureAfterFontsLoad(): Promise<void> {
    const fonts = document.fonts;
    if (!fonts) return;
    try {
      await fonts.ready;
    } catch {
      return;
    }
    if (this.destroyed) return;
    if (this.measure()) {
      this.onChange();
    }
  }

  measure(): boolean {
    let changed = false;
    for (const [s, span] of this.spans) {
      const w = span.getBoundingClientRect().width;
      if (w > 0 && this.widths.get(s) !== w) {
        this.widths.set(s, w);
        changed = true;
      }
    }
    return changed;
  }

  widthFor(s: string): number {
    return this.widths.get(s) ?? 0;
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.container.remove();
  }
}

/**
 * Makes soft-wrapped lines hang-indent to match the line's own leading
 * whitespace (and, for a markdown-style list marker like "- "/"1. ", the
 * marker width too) instead of wrapping back to column 0. Requires
 * `EditorView.lineWrapping` to also be active.
 */
export function softWrapIndent() {
  return [
    EditorView.lineWrapping,
    EditorView.theme({
      ".cm-line": {
        paddingLeft:
          "calc(var(--pw-line-padding-left, 1rem) + var(--pw-wrap-indent-px, 0px))",
        textIndent: "calc(var(--pw-wrap-indent-px, 0px) * -1)",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      },
      ".cm-pw-wrap-measure": {
        position: "absolute",
        visibility: "hidden",
        pointerEvents: "none",
        top: "0",
        left: "0",
        contain: "layout style paint",
      },
      ".cm-pw-wrap-measure-item": {
        whiteSpace: "pre",
        display: "inline-block",
      },
    }),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        view: EditorView;
        measure: WrapMeasure;

        constructor(view: EditorView) {
          this.view = view;
          this.measure = new WrapMeasure(view, () => this.handleMeasureChange());
          this.decorations = buildIndentDecorations(view, this.measure);
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = buildIndentDecorations(update.view, this.measure);
          }
        }

        handleMeasureChange() {
          this.decorations = buildIndentDecorations(this.view, this.measure);
          this.view.dispatch({});
        }

        destroy() {
          this.measure.destroy();
        }
      },
      {
        decorations: (plugin) => plugin.decorations,
      },
    ),
  ];
}

function buildIndentDecorations(view: EditorView, measure: WrapMeasure): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const indent = wrapIndentForLine(line.text, measure);
      if (indent > 0) {
        builder.add(
          line.from,
          line.from,
          Decoration.line({
            attributes: {
              style: `--pw-wrap-indent-px: ${indent.toFixed(2)}px;`,
            },
          }),
        );
      }
      if (line.to >= to) {
        break;
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

function wrapIndentForLine(line: string, measure: WrapMeasure): number {
  // Tab characters create their own indentation via CSS tab-size; mixing
  // pixel padding-left with space-unit tab stops misaligns the grid.
  if (line.startsWith("\t")) return 0;
  const match = /^(\s*)((?:[-+*]|\d+[.)])(\s+))?/.exec(line);
  if (!match) {
    return 0;
  }
  const leading = match[1] ?? "";
  const marker = match[2] ?? "";
  const trailingWS = match[3] ?? "";
  const spaceWidth = measure.widthFor(" ");

  let total = spaceWidth * leading.length;

  if (marker) {
    const markerCore = marker.slice(0, marker.length - trailingWS.length);
    if (/^[-+*]$/.test(markerCore)) {
      total += measure.widthFor(`${markerCore} `);
      total += spaceWidth * Math.max(0, trailingWS.length - 1);
    } else {
      const numMatch = /^(\d+)([.)])$/.exec(markerCore);
      if (numMatch) {
        for (const digit of numMatch[1]) {
          total += measure.widthFor(digit);
        }
        total += measure.widthFor(`${numMatch[2]} `);
        total += spaceWidth * Math.max(0, trailingWS.length - 1);
      }
    }
  }

  return Math.min(total, MAX_WRAP_INDENT_PX);
}
