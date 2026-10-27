export type UnsavedChoice = "save" | "discard" | "cancel";

export interface UnsavedPrompt {
  /**
   * Asks what to do with unsaved edits to `name`, which `reason` explains are not autosaved
   * (phrased to follow "because"). Esc or clicking outside means cancel.
   */
  ask(name: string, reason: string): Promise<UnsavedChoice>;
}

export function createUnsavedPrompt(): UnsavedPrompt {
  const root = document.querySelector<HTMLElement>("#unsaved")!;
  const message = document.querySelector<HTMLElement>("#unsaved-message")!;
  const save = document.querySelector<HTMLButtonElement>("#unsaved-save")!;
  const discard = document.querySelector<HTMLButtonElement>("#unsaved-discard")!;
  const cancel = document.querySelector<HTMLButtonElement>("#unsaved-cancel")!;
  let finish: ((choice: UnsavedChoice) => void) | null = null;

  function settle(choice: UnsavedChoice) {
    if (!finish) return;
    const done = finish;
    finish = null;
    root.hidden = true;
    done(choice);
  }

  save.addEventListener("click", () => settle("save"));
  discard.addEventListener("click", () => settle("discard"));
  cancel.addEventListener("click", () => settle("cancel"));
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      settle("cancel");
    }
  });
  root.addEventListener("mousedown", (e) => {
    if (e.target === root) settle("cancel");
  });

  return {
    ask(name, reason) {
      // A second request while one is open cancels the first rather than stacking dialogs.
      settle("cancel");
      message.textContent = `Save changes to “${name}”? It isn't autosaved because ${reason}.`;
      root.hidden = false;
      save.focus();
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
}
