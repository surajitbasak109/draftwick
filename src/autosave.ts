export interface Autosave {
  /**
   * Call on every user edit. Marks the document dirty and, if autosave is enabled for it,
   * schedules a save after the debounce delay.
   */
  touch(): void;
  /**
   * Save now if there are unsaved edits, and wait for any save already in flight. This is an
   * explicit save, so it works even when autosave is disabled for the document.
   */
  flush(): Promise<void>;
  /** Forget pending edits, e.g. right after loading a different document. */
  markClean(): void;
  readonly dirty: boolean;
}

interface Options {
  delayMs: number;
  /** Whether edits to the current document may be saved without the user asking. */
  isEnabled: () => boolean;
  save: () => Promise<void>;
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

  function runSave(): Promise<void> {
    const savedVersion = version;
    queue = queue.then(async () => {
      try {
        await opts.save();
        if (savedVersion === version) setDirty(false);
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
      if (opts.isEnabled()) timer = setTimeout(runSave, opts.delayMs);
    },
    flush() {
      clearTimeout(timer);
      return dirty ? runSave() : queue;
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
