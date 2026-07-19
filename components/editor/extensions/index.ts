import { Compartment, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { softWrapIndent } from "./softWrapIndent";
import { getSyntaxHighlightExtension, piEditorTheme } from "./theme";

export interface EditorCompartments {
  language: Compartment;
  wrap: Compartment;
  highlight: Compartment;
}

export function createEditorCompartments(): EditorCompartments {
  return {
    language: new Compartment(),
    wrap: new Compartment(),
    highlight: new Compartment(),
  };
}

export function wrapExtension(enabled: boolean): Extension {
  return enabled ? [EditorView.lineWrapping, softWrapIndent()] : [];
}

export interface BuildTextEditorExtensionsOptions {
  compartments: EditorCompartments;
  isDark: boolean;
  wrapEnabled: boolean;
  onSave: () => void;
}

/** A trimmed-down editor extension set — no folding, no fixed language mode, no search panel/autocomplete. */
export function buildTextEditorExtensions(opts: BuildTextEditorExtensionsOptions): Extension[] {
  return [
    lineNumbers(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    opts.compartments.language.of([]),
    opts.compartments.highlight.of(getSyntaxHighlightExtension(opts.isDark)),
    opts.compartments.wrap.of(wrapExtension(opts.wrapEnabled)),
    piEditorTheme(),
    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          opts.onSave();
          return true;
        },
      },
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
  ];
}
