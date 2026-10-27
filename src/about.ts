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

  function hide() {
    root.hidden = true;
    onClose();
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
    open(info) {
      name.textContent = info.name;
      version.textContent = `Version ${info.version}`;
      description.textContent = info.description;
      root.hidden = false;
      close.focus();
    },
  };
}
