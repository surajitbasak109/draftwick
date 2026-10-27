export type ShortcutMap = Record<string, () => void>;

/** "Mod" is Ctrl (or Cmd on macOS). Keys are lowercase, e.g. "Mod+shift+r". */
function combo(e: KeyboardEvent): string {
  if (e.altKey || !(e.ctrlKey || e.metaKey)) return "";
  return "Mod+" + (e.shiftKey ? "shift+" : "") + e.key.toLowerCase();
}

// Capture phase, so these work while the editor has focus and win over CodeMirror.
export function installShortcuts(map: ShortcutMap): void {
  window.addEventListener(
    "keydown",
    (e) => {
      const action = map[combo(e)];
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      action();
    },
    true,
  );
}
