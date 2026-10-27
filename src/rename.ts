const FORBIDDEN = /[/\\:*?"<>|]/;

/** Client-side check; the Rust side validates again. Returns an error message or null. */
export function validateStem(stem: string): string | null {
  if (stem.trim() === "") return "Name can't be empty";
  if (FORBIDDEN.test(stem)) return 'Name can\'t contain / \\ : * ? " < > |';
  return null;
}

export interface RenamePrompt {
  open(currentStem: string): void;
}

export function createRenamePrompt(
  onSubmit: (stem: string) => Promise<void>,
  onClose: () => void,
): RenamePrompt {
  const root = document.querySelector<HTMLElement>("#rename")!;
  const input = document.querySelector<HTMLInputElement>("#rename-input")!;
  const error = document.querySelector<HTMLElement>("#rename-error")!;

  function showError(message: string | null) {
    error.hidden = message === null;
    error.textContent = message ?? "";
  }

  function close() {
    root.hidden = true;
    onClose();
  }

  input.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const stem = input.value.trim();
      const invalid = validateStem(stem);
      if (invalid) return showError(invalid);
      try {
        await onSubmit(stem);
        close();
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      }
    }
  });
  root.addEventListener("mousedown", (e) => {
    if (e.target === root) close();
  });

  return {
    open(currentStem) {
      showError(null);
      input.value = currentStem;
      root.hidden = false;
      input.focus();
      input.select();
    },
  };
}
