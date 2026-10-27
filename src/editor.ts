import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";
import { linter, lintGutter } from "@codemirror/lint";
import type { SettingsDiagnostic } from "./api";
import { jsonc } from "./jsonc";
import type { Eol } from "./lineEndings";

export interface EditorHandle {
  /** `eol` is the line ending the text had on disk; getDoc() writes it back the same way. */
  setDoc(text: string, ext: string, eol: Eol): void;
  /** The document text, with lines joined by the ending given to setDoc. */
  getDoc(): string;
  /** True when the document has no text at all. */
  isEmpty(): boolean;
  focus(): void;
  /** Re-measures the text after the font or the wrap width changed. */
  refreshLayout(): void;
}

interface Handlers {
  onChange(): void;
  onBlur(): void;
  /**
   * The cursor moved or the text changed: 1-based line and column of the main cursor, and how many
   * characters are selected in total (0 when nothing is).
   */
  onCursor?(line: number, column: number, selected: number): void;
  /** Finds mistakes in the settings file's text. When given, they are underlined as you type. */
  lint?(text: string): Promise<SettingsDiagnostic[]>;
}

// Colors come from CSS variables (styles.css) so dark/light follows the OS.
const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--fg)", backgroundColor: "var(--bg)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--mono)", fontSize: "var(--editor-font-size)", lineHeight: "1.6" },
  ".cm-content": { padding: "16px 24px", caretColor: "var(--fg)" },
  ".cm-cursor": { borderLeftColor: "var(--fg)" },
  ".cm-selectionBackground": { backgroundColor: "var(--selection) !important" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "var(--selection) !important",
  },
  ".cm-searchMatch": { backgroundColor: "var(--match)" },
  // The gutter only appears when there is something to show in it (lint markers, settings file).
  ".cm-gutters": {
    backgroundColor: "var(--bg-side)",
    color: "var(--muted)",
    border: "none",
    borderRight: "1px solid var(--border)",
  },
  ".cm-searchMatch-selected": { backgroundColor: "var(--selection)" },
});

const highlight = HighlightStyle.define([
  { tag: t.heading, color: "var(--hl-heading)", fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--hl-link)" },
  { tag: t.monospace, color: "var(--hl-code)" },
  { tag: t.quote, color: "var(--hl-muted)", fontStyle: "italic" },
  { tag: [t.processingInstruction, t.contentSeparator], color: "var(--hl-muted)" },
]);

// Colours for the settings file (JSON with comments). Like the Markdown ones, they come from CSS
// variables so dark and light follow the operating system.
const jsonHighlight = HighlightStyle.define([
  { tag: t.propertyName, color: "var(--hl-property)" },
  { tag: t.string, color: "var(--hl-string)" },
  { tag: t.number, color: "var(--hl-number)" },
  { tag: t.atom, color: "var(--hl-keyword)" },
  { tag: t.comment, color: "var(--hl-comment)", fontStyle: "italic" },
  { tag: [t.bracket, t.punctuation], color: "var(--hl-muted)" },
]);

/** Colours, plus underlines for mistakes (checked by the app itself, so the editor and the file's
 * reader always agree on what is wrong). */
function settingsExtensions(handlers: Handlers): Extension[] {
  const colours = [jsonc, syntaxHighlighting(jsonHighlight)];
  const { lint } = handlers;
  if (!lint) return colours;
  return [
    ...colours,
    linter(
      async (view) => {
        try {
          const found = await lint(view.state.doc.toString());
          const length = view.state.doc.length;
          return found.map((d) => ({
            from: Math.min(d.from, length),
            to: Math.min(Math.max(d.to, d.from), length),
            severity: d.severity,
            message: d.message,
          }));
        } catch {
          return []; // if the check itself can't run, don't pretend there is a mistake
        }
      },
      { delay: 300 },
    ),
    lintGutter(),
  ];
}

function extensionsFor(ext: string, handlers: Handlers, isLoading: () => boolean): Extension[] {
  const isMarkdown = ext === "md";
  return [
    history(),
    drawSelection(),
    search({ top: true }),
    EditorState.allowMultipleSelections.of(true),
    EditorView.clickAddsSelectionRange.of((e) => e.ctrlKey || e.metaKey),
    EditorView.lineWrapping,
    keymap.of([
      { key: "Mod-h", run: openSearchPanel, preventDefault: true },
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    isMarkdown ? [markdown({ base: markdownLanguage }), syntaxHighlighting(highlight)] : [],
    // The settings file is the only .json the app opens (see settings.rs).
    ext === "json" ? settingsExtensions(handlers) : [],
    theme,
    // Lines wrap at the wrap_column setting. The settings file keeps the full window width, because
    // its comment lines are long.
    ext === "json" ? [] : EditorView.theme({ ".cm-content": { maxWidth: "var(--editor-max-width)" } }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !isLoading()) handlers.onChange();
      if (u.docChanged || u.selectionSet) {
        const head = u.state.selection.main.head;
        const line = u.state.doc.lineAt(head);
        let selected = 0;
        for (const range of u.state.selection.ranges) {
          // Count characters as people do (an emoji is one), not as UTF-16 units.
          if (!range.empty) selected += Array.from(u.state.sliceDoc(range.from, range.to)).length;
        }
        handlers.onCursor?.(line.number, head - line.from + 1, selected);
      }
    }),
    EditorView.domEventHandlers({
      blur: () => {
        handlers.onBlur();
      },
    }),
  ];
}

export function createEditor(parent: HTMLElement, handlers: Handlers): EditorHandle {
  let loading = false;
  // CodeMirror normalizes line endings to "\n" while editing; this restores them on save.
  let eol: Eol = "\n";
  const isLoading = () => loading;
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: "", extensions: extensionsFor("md", handlers, isLoading) }),
  });

  return {
    setDoc(text, ext, newEol) {
      loading = true;
      eol = newEol;
      try {
        // A fresh state also resets undo history, so Ctrl+Z can't cross into another note.
        view.setState(
          EditorState.create({ doc: text, extensions: extensionsFor(ext, handlers, isLoading) }),
        );
      } finally {
        loading = false;
      }
    },
    getDoc: () => view.state.doc.sliceString(0, view.state.doc.length, eol),
    isEmpty: () => view.state.doc.length === 0,
    focus: () => view.focus(),
    refreshLayout: () => view.requestMeasure(),
  };
}
