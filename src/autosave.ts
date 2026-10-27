export interface Autosave {
  /**
   * Call on every user edit. Marks the document dirty and, if autosave is enabled for it,
   * schedules a save after the debounce delay.
   */
  touch(): void;
  /**
   * Save now if there are unsaved edits, and wait for any save already in flight.
   *
   * `explicit` is true when the user asked for this save (Ctrl+S, or answering a prompt). The
   * default is true. Pass false for saves the app starts itself (blur, leaving a note): they are
   * skipped if autosave is no longer allowed by the time they run.
   */
  flush(explicit?: boolean): Promise<void>;
  /** Forget pending edits, e.g. right after loading a different document. */
  markClean(): void;
  readonly dirty: boolean;
}

interface Options {
  delayMs: number;
  /** Whether edits to the current document may be saved without the user asking. */
  isEnabled: () => boolean;
  /**
   * Resolves true when the document is saved (or there was nothing to save), false if it was
   * not saved. `explicit` says whether the user asked for it; an implicit save must re-check
   * that autosave is still allowed, because things can change while a save waits in the queue.
   */
  save: (explicit: boolean) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
  onError: (error: unknown) => void;
}

export function createAutosave(opts: Options): Autosave {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let version = 0;
  // Saves run strictly one after another so the first save (which creates the file)
  // can never race with the next one.
  let queue: Promise<void> = Promise.resolve();

  function setDirty(value: boolean) {
    if (value !== dirty) {
      dirty = value;
      opts.onDirtyChange(value);
    }
  }

  function runSave(explicit: boolean): Promise<void> {
    const savedVersion = version;
    queue = queue.then(async () => {
      try {
        const saved = await opts.save(explicit);
        if (saved && savedVersion === version) setDirty(false);
      } catch (e) {
        opts.onError(e);
      }
    });
    return queue;
  }

  return {
    touch() {
      version++;
      setDirty(true);
      clearTimeout(timer);
      if (opts.isEnabled()) timer = setTimeout(() => void runSave(false), opts.delayMs);
    },
    flush(explicit = true) {
      clearTimeout(timer);
      return dirty ? runSave(explicit) : queue;
    },
    markClean() {
      clearTimeout(timer);
      version++;
      setDirty(false);
    },
    get dirty() {
      return dirty;
    },
  };
}
