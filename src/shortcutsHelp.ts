import type { ActionInfo } from "./api";
import { toDisplay } from "./accelerators";

/**
 * Shortcuts handled by the editor itself (CodeMirror), so they are not in the action table.
 * Keep in step with the keymaps in editor.ts.
 */
const EDITOR_SHORTCUTS: [label: string, keys: string][] = [
  ["Find", "Ctrl+F"],
  ["Replace", "Ctrl+H"],
  ["Select next occurrence", "Ctrl+D"],
  ["Undo", "Ctrl+Z"],
  ["Redo", "Ctrl+Shift+Z"],
];

export interface ShortcutsHelp {
  open(actions: ActionInfo[]): void;
}

export function createShortcutsHelp(onClose: () => void): ShortcutsHelp {
  const root = document.querySelector<HTMLElement>("#help")!;
  const body = document.querySelector<HTMLElement>("#help-body")!;
  const close = document.querySelector<HTMLButtonElement>("#help-close")!;
  const mac = /mac/i.test(navigator.platform);

  function hide() {
    root.hidden = true;
    onClose();
  }

  function section(title: string, rows: [string, string][]): HTMLElement {
    const el = document.createElement("section");
    const h = document.createElement("h3");
    h.textContent = title;
    const list = document.createElement("dl");
    for (const [label, keys] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = keys;
      list.append(dt, dd);
    }
    el.append(h, list);
    return el;
  }

  close.addEventListener("click", hide);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      hide();
    }
  });
  root.addEventListener("mousedown", (e) => {
    if (e.target === root) hide();
  });

  return {
    open(actions) {
      const app = actions
        .filter((a) => a.accelerator !== null)
        .map((a): [string, string] => [a.label, toDisplay(a.accelerator!, mac)]);
      const editor = EDITOR_SHORTCUTS.map(([label, keys]): [string, string] => [
        label,
        mac ? keys.replace("Ctrl", "Cmd") : keys,
      ]);
      body.replaceChildren(section("Draftwick", app), section("In the editor", editor));
      root.hidden = false;
      close.focus();
    },
  };
}
