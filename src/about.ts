import type { AboutInfo } from "./api";

export interface AboutDialog {
  open(info: AboutInfo): void;
}

export function createAboutDialog(onClose: () => void): AboutDialog {
  const root = document.querySelector<HTMLElement>("#about")!;
  const name = document.querySelector<HTMLElement>("#about-name")!;
  const version = document.querySelector<HTMLElement>("#about-version")!;
  const description = document.querySelector<HTMLElement>("#about-description")!;
  const close = document.querySelector<HTMLButtonElement>("#about-close")!;

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

  close.addEventListener("click", hide);
  root.addEventListener("mousedown", (e) => {
    if (e.target === root) hide();
  });

  return {
    open(info) {
      name.textContent = info.name;
      version.textContent = `Version ${info.version}`;
      description.textContent = info.description;
      root.hidden = false;
      document.addEventListener("keydown", onKey, true);
      // Keep typing out of the editor behind the dialog.
      root.tabIndex = -1;
      root.focus();
    },
  };
}
