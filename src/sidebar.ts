import type { NoteMeta } from "./api";

export interface Sidebar {
  render(notes: NoteMeta[], activePath: string | null): void;
  toggle(): void;
}

export function createSidebar(
  el: HTMLElement,
  app: HTMLElement,
  onSelect: (note: NoteMeta) => void,
): Sidebar {
  return {
    render(notes, activePath) {
      const frag = document.createDocumentFragment();
      for (const note of notes) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "note-item" + (note.path === activePath ? " active" : "");
        item.textContent = note.name;
        item.title = note.path;
        item.addEventListener("click", () => onSelect(note));
        frag.appendChild(item);
      }
      el.replaceChildren(frag);
    },
    toggle() {
      app.classList.toggle("sidebar-hidden");
    },
  };
}
