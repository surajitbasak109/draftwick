import type { Settings } from "./api";
import { SETTING_INFO } from "./settingsInfo";

export interface SettingsDialog {
  /** `settings` are the ones in use now (null if none have loaded yet). */
  open(settings: Settings | null): void;
}

/**
 * Settings > Show settings: a read-only view of every setting, with what it does, what is allowed
 * and its default. It never changes anything. Settings are edited in the settings file, which the
 * button opens.
 */
export function createSettingsDialog(onOpenFile: () => void, onClose: () => void): SettingsDialog {
  const root = document.querySelector<HTMLElement>("#settings-dialog")!;
  const body = document.querySelector<HTMLElement>("#settings-body")!;
  const close = document.querySelector<HTMLButtonElement>("#settings-close")!;
  const openFile = document.querySelector<HTMLButtonElement>("#settings-open-file")!;

  // Esc closes the dialog wherever the focus is.
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

  close.addEventListener("click", hide);
  openFile.addEventListener("click", () => {
    hide();
    onOpenFile();
  });
  root.addEventListener("mousedown", (e) => {
    if (e.target === root) hide();
  });

  return {
    open(settings) {
      body.replaceChildren(
        ...SETTING_INFO.map((info) => {
          const row = document.createElement("section");
          row.className = "setting-row";

          const head = document.createElement("div");
          head.className = "setting-head";
          const title = document.createElement("strong");
          title.textContent = info.title;
          const key = document.createElement("code");
          key.textContent = info.key;
          head.append(title, key);

          const value = document.createElement("div");
          value.className = "setting-value";
          const current = settings ? info.show(settings[info.key]) : info.defaultText;
          const isDefault = current === info.defaultText;
          value.textContent = current;
          const tag = document.createElement("span");
          tag.className = "setting-tag" + (isDefault ? "" : " changed");
          tag.textContent = isDefault ? "default" : "changed";
          value.append(tag);

          const text = document.createElement("p");
          text.textContent = info.description;
          const facts = document.createElement("p");
          facts.className = "setting-facts";
          facts.textContent = `Allowed: ${info.allowed}. Default: ${info.defaultText}.`;

          row.append(head, value, text, facts);
          return row;
        }),
      );
      root.hidden = false;
      document.addEventListener("keydown", onKey, true);
      // Keep typing out of the editor behind the dialog.
      root.tabIndex = -1;
      root.focus();
    },
  };
}
