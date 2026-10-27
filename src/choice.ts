export type Choice = "primary" | "secondary" | "cancel";

export interface ChoiceOptions {
  message: string;
  primary: string;
  /** A third button; leave it out for a plain two-button question. */
  secondary?: string;
  cancel: string;
  /**
   * Which button starts focused. Use "cancel" when the prompt can appear while the user is
   * typing, so a stray Enter or Space does the harmless thing.
   */
  focus?: "primary" | "cancel";
}

export interface ChoicePrompt {
  /** Resolves with the chosen button. Esc or clicking outside the panel means "cancel". */
  ask(options: ChoiceOptions): Promise<Choice>;
}

export function createChoicePrompt(): ChoicePrompt {
  const root = document.querySelector<HTMLElement>("#choice")!;
  const message = document.querySelector<HTMLElement>("#choice-message")!;
  const primary = document.querySelector<HTMLButtonElement>("#choice-primary")!;
  const secondary = document.querySelector<HTMLButtonElement>("#choice-secondary")!;
  const cancel = document.querySelector<HTMLButtonElement>("#choice-cancel")!;
  let finish: ((choice: Choice) => void) | null = null;

  function settle(choice: Choice) {
    if (!finish) return;
    const done = finish;
    finish = null;
    root.hidden = true;
    done(choice);
  }

  primary.addEventListener("click", () => settle("primary"));
  secondary.addEventListener("click", () => settle("secondary"));
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
    ask(options) {
      // A second request while one is open cancels the first rather than stacking dialogs.
      settle("cancel");
      message.textContent = options.message;
      primary.textContent = options.primary;
      secondary.textContent = options.secondary ?? "";
      secondary.hidden = options.secondary === undefined;
      cancel.textContent = options.cancel;
      root.hidden = false;
      (options.focus === "cancel" ? cancel : primary).focus();
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
}
