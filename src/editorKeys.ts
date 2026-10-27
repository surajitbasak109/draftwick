/**
 * Shortcuts handled by the editor itself (CodeMirror), so they are not in the action table. They
 * are listed under Help > Keyboard shortcuts. `tests/editorKeys.test.mjs` fails if a key listed
 * here is no longer bound, so the list cannot quietly fall out of step with editor.ts.
 */
export interface EditorKey {
  label: string;
  /** How it is shown to people. */
  keys: string;
  /** The CodeMirror key name ("Mod" is Ctrl, or Cmd on a Mac). */
  binding: string;
  /** Where it is bound: one of CodeMirror's own keymaps, or our own entry in editor.ts. */
  from: "search" | "history" | "default" | "editor.ts";
}

export const EDITOR_KEYS: EditorKey[] = [
  { label: "Find", keys: "Ctrl+F", binding: "Mod-f", from: "search" },
  { label: "Replace", keys: "Ctrl+H", binding: "Mod-h", from: "editor.ts" },
  { label: "Select next occurrence", keys: "Ctrl+D", binding: "Mod-d", from: "search" },
  { label: "Undo", keys: "Ctrl+Z", binding: "Mod-z", from: "history" },
  { label: "Redo", keys: "Ctrl+Shift+Z", binding: "Mod-Shift-z", from: "history" },
  { label: "Indent (type a tab, or indent the selected lines)", keys: "Tab", binding: "Tab", from: "editor.ts" },
  { label: "Remove one indent", keys: "Shift+Tab", binding: "Tab", from: "editor.ts" },
];
