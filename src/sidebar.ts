import type { NoteMeta } from "./api";
import { showContextMenu } from "./contextMenu";

// Small icons, drawn inline so there is no icon file or library to load.
const svg = (paths: string, size = 14) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const TRASH_ICON = svg(
  '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' +
    '<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
);
const PENCIL_ICON = svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>');

export interface Sidebar {
  render(notes: NoteMeta[], activePath: string | null): void;
  toggle(): void;
  isVisible(): boolean;
}

export function createSidebar(
  el: HTMLElement,
  app: HTMLElement,
  onSelect: (note: NoteMeta) => void,
  onDelete: (note: NoteMeta) => void,
  onRename: (note: NoteMeta) => void,
): Sidebar {
  return {
    render(notes, activePath) {
      const frag = document.createDocumentFragment();
      for (const note of notes) {
        const row = document.createElement("div");
        row.className = "note-row" + (note.path === activePath ? " active" : "");
        const item = document.createElement("button");
        item.type = "button";
        item.className = "note-item";
        item.textContent = note.name;
        item.title = note.path;
        item.addEventListener("click", () => onSelect(note));
        item.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showContextMenu(
            e.clientX,
            e.clientY,
            [
              { label: "Rename", icon: PENCIL_ICON, run: () => onRename(note) },
              { label: "Delete", icon: TRASH_ICON, danger: true, separatorBefore: true, run: () => onDelete(note) },
            ],
            note.name,
          );
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "note-delete";
        remove.innerHTML = TRASH_ICON;
        remove.title = "Move to trash";
        remove.setAttribute("aria-label", `Move ${note.name} to the trash`);
        remove.addEventListener("click", () => onDelete(note));
        row.append(item, remove);
        frag.appendChild(row);
      }
      el.replaceChildren(frag);
    },
    toggle() {
      app.classList.toggle("sidebar-hidden");
    },
    isVisible: () => !app.classList.contains("sidebar-hidden"),
  };
}
