import type { NoteMeta } from "./api";

export interface Switcher {
  open(notes: NoteMeta[]): void;
}

/** True when every character of `query` appears in `text` in order (case-insensitive). */
export function isSubsequence(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) i++;
  }
  return i === q.length;
}

export function createSwitcher(
  onPick: (note: NoteMeta) => void,
  onClose: () => void,
): Switcher {
  const root = document.querySelector<HTMLElement>("#switcher")!;
  const input = document.querySelector<HTMLInputElement>("#switcher-input")!;
  const list = document.querySelector<HTMLUListElement>("#switcher-list")!;
  let all: NoteMeta[] = [];
  let shown: NoteMeta[] = [];
  let selected = 0;

  function close() {
    root.hidden = true;
    onClose();
  }

  function pick(note: NoteMeta | undefined) {
    if (!note) return;
    close();
    onPick(note);
  }

  function render() {
    const frag = document.createDocumentFragment();
    shown.forEach((note, i) => {
      const li = document.createElement("li");
      li.textContent = note.name;
      if (i === selected) li.className = "selected";
      li.addEventListener("click", () => pick(note));
      frag.appendChild(li);
    });
    list.replaceChildren(frag);
    list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  }

  function filter() {
    shown = all.filter((n) => isSubsequence(input.value, n.name));
    selected = 0;
    render();
  }

  input.addEventListener("input", filter);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(shown[selected]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      selected = Math.min(selected + 1, shown.length - 1);
      render();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
      render();
    }
  });
  // Clicking the dim backdrop (but not the panel) closes the overlay.
  root.addEventListener("mousedown", (e) => {
    if (e.target === root) close();
  });

  return {
    open(notes) {
      all = notes;
      input.value = "";
      root.hidden = false;
      filter();
      input.focus();
    },
  };
}
