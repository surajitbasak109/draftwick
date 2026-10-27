export interface MenuItem {
  label: string;
  run: () => void;
  /** Inline SVG markup drawn before the label. Fixed strings from the app, never user text. */
  icon?: string;
  /** Shown in the danger colour, for actions that remove something. */
  danger?: boolean;
  /** Draw a divider line above this item. */
  separatorBefore?: boolean;
}

let open: HTMLElement | null = null;

/** Closes the menu that is showing, if any. */
export function closeContextMenu(): void {
  open?.remove();
  open = null;
}

/**
 * Shows a small menu at the pointer. It closes on a click anywhere else, on Esc, on scroll, on
 * resize, and as soon as an item is chosen. Only one menu exists at a time.
 */
export function showContextMenu(x: number, y: number, items: MenuItem[], title?: string): void {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.setAttribute("role", "menu");
  if (title) {
    const heading = document.createElement("div");
    heading.className = "ctx-title";
    heading.textContent = title;
    menu.appendChild(heading);
  }
  for (const item of items) {
    if (item.separatorBefore) {
      const line = document.createElement("div");
      line.className = "ctx-sep";
      line.setAttribute("role", "separator");
      menu.appendChild(line);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    if (item.danger) button.className = "danger";
    if (item.icon) button.insertAdjacentHTML("afterbegin", item.icon);
    const label = document.createElement("span");
    label.textContent = item.label;
    button.appendChild(label);
    button.addEventListener("click", () => {
      closeContextMenu();
      item.run();
    });
    menu.appendChild(button);
  }
  document.body.appendChild(menu);
  open = menu;

  // Keep the menu inside the window.
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - width - 4))}px`;
  menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - height - 4))}px`;

  menu.addEventListener("keydown", (e) => {
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      closeContextMenu();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      buttons[(at + step + buttons.length) % buttons.length].focus();
    }
  });
  menu.querySelector<HTMLButtonElement>("button")?.focus();
}

// One set of listeners closes whichever menu is open.
window.addEventListener("mousedown", (e) => {
  if (open && !open.contains(e.target as Node)) closeContextMenu();
});
window.addEventListener("blur", closeContextMenu);
window.addEventListener("resize", closeContextMenu);
window.addEventListener("scroll", closeContextMenu, true);
