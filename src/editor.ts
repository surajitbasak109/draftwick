import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";
import type { Eol } from "./lineEndings";

export interface EditorHandle {
  /** `eol` is the line ending the text had on disk; getDoc() writes it back the same way. */
  setDoc(text: string, ext: string, eol: Eol): void;
  /** The document text, with lines joined by the ending given to setDoc. */
  getDoc(): string;
  focus(): void;
}

interface Handlers {
  onChange(): void;
  onBlur(): void;
}

// Colors come from CSS variables (styles.css) so dark/light follows the OS.
const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--fg)", backgroundColor: "var(--bg)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--mono)", fontSize: "15px", lineHeight: "1.6" },
  ".cm-content": { padding: "16px 24px", caretColor: "var(--fg)" },
  ".cm-cursor": { borderLeftColor: "var(--fg)" },
  ".cm-selectionBackground": { backgroundColor: "var(--selection) !important" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "var(--selection) !important",
  },
  ".cm-searchMatch": { backgroundColor: "var(--match)" },
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
    isMarkdown ? markdown({ base: markdownLanguage }) : [],
    isMarkdown ? syntaxHighlighting(highlight) : [],
    theme,
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !isLoading()) handlers.onChange();
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
    focus: () => view.focus(),
  };
}
