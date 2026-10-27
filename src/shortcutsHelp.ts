import type { ActionInfo } from "./api";
import { toDisplay } from "./accelerators";
import { EDITOR_KEYS } from "./editorKeys";

export interface ShortcutsHelp {
  open(actions: ActionInfo[]): void;
}

export function createShortcutsHelp(onClose: () => void): ShortcutsHelp {
  const root = document.querySelector<HTMLElement>("#help")!;
  const body = document.querySelector<HTMLElement>("#help-body")!;
  const close = document.querySelector<HTMLButtonElement>("#help-close")!;
  const mac = /mac/i.test(navigator.platform);

  // Esc closes the dialog wherever the focus is (clicking the text moves it off the dialog).
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      hide();
    }
  }

  function hide() {
    document.removeEventListener("keydown", onKey, true);
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
  root.addEventListener("mousedown", (e) => {
    if (e.target === root) hide();
  });

  return {
    open(actions) {
      const app = actions
        .filter((a) => a.accelerator !== null)
        .map((a): [string, string] => [a.label, toDisplay(a.accelerator!, mac)]);
      const editor = EDITOR_KEYS.map(({ label, keys }): [string, string] => [
        label,
        mac ? keys.replace("Ctrl", "Cmd") : keys,
      ]);
      body.replaceChildren(section("Draftwick", app), section("In the editor", editor));
      root.hidden = false;
      document.addEventListener("keydown", onKey, true);
      // Keep typing out of the editor behind the dialog.
      root.tabIndex = -1;
      root.focus();
    },
  };
}
