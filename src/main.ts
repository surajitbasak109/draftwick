import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as api from "./api";
import { createAutosave } from "./autosave";
import { createEditor } from "./editor";
import { createRenamePrompt } from "./rename";
import { createSidebar } from "./sidebar";
import { createSwitcher } from "./switcher";
import { installShortcuts } from "./shortcuts";
import { createUnsavedPrompt } from "./unsaved";
import "./styles.css";

const APP_NAME = "Draftwick";

interface Current {
  /** null until the first keystroke creates the file on disk. */
  path: string | null;
  name: string;
  ext: string;
  /**
   * True for notes inside the notes folder, which are autosaved. A file opened from anywhere
   * else is only saved when the user asks (Ctrl+S).
   */
  managed: boolean;
}

const NEW_NOTE: Current = { path: null, name: "", ext: "md", managed: true };

let current: Current = NEW_NOTE;
let notes: api.NoteMeta[] = [];

// ---------- small UI helpers ----------

const toastEl = document.querySelector<HTMLElement>("#toast")!;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function toast(message: string) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 4000);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function updateTitle() {
  const base = current.path ? current.name : "Untitled";
  const note = current.managed ? "" : " (autosave off)";
  const title = `${autosave.dirty ? "• " : ""}${base}${note} — ${APP_NAME}`;
  document.title = title;
  getCurrentWindow()
    .setTitle(title)
    .catch(() => {});
}

// ---------- editor, autosave, sidebar ----------

const autosave = createAutosave({
  delayMs: 500,
  isEnabled: () => current.managed,
  save: saveCurrent,
  onDirtyChange: updateTitle,
  onError: (e) => toast(`Couldn't save: ${errorMessage(e)}`),
});

const editor = createEditor(document.querySelector<HTMLElement>("#editor")!, {
  onChange: () => autosave.touch(),
  // Losing focus only saves notes in the notes folder, never an outside file.
  onBlur: () => {
    if (current.managed) void autosave.flush();
  },
});

const unsaved = createUnsavedPrompt();
let promptOpen = false;

const sidebar = createSidebar(
  document.querySelector<HTMLElement>("#sidebar")!,
  document.querySelector<HTMLElement>("#app")!,
  (note) => void openPath(note.path),
);

const switcher = createSwitcher(
  (note) => void openPath(note.path),
  () => editor.focus(),
);

const renamePrompt = createRenamePrompt(renameCurrent, () => editor.focus());

async function refreshSidebar() {
  try {
    notes = await api.listNotes();
  } catch (e) {
    toast(`Couldn't list notes: ${errorMessage(e)}`);
    notes = [];
  }
  sidebar.render(notes, current.path);
}

async function saveCurrent() {
  const content = editor.getDoc();
  if (current.path === null) {
    // Don't create empty files: wait until there is something to write.
    if (content === "") return;
    const meta = await api.createNote(content);
    current = { path: meta.path, name: meta.name, ext: meta.ext, managed: true };
  } else {
    await api.writeNote(current.path, content);
  }
  updateTitle();
  await refreshSidebar();
}

function describe(path: string, managed: boolean): Current {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return { path, name, ext: dot >= 0 ? name.slice(dot + 1).toLowerCase() : "md", managed };
}

// ---------- actions ----------

/**
 * Makes the current document safe to leave (switch away from, or close). Notes in the notes
 * folder are simply autosaved. A file from outside it is never saved without asking, so with
 * unsaved edits the user chooses Save / Don't Save / Cancel. Returns false when the caller
 * must stay on this document (the user cancelled, or an explicit save failed).
 */
async function settleCurrent(): Promise<boolean> {
  if (!autosave.dirty || current.managed) {
    await autosave.flush();
    return true;
  }
  promptOpen = true;
  let choice;
  try {
    choice = await unsaved.ask(current.name);
  } finally {
    promptOpen = false;
  }
  if (choice === "cancel") return false;
  if (choice === "save") {
    await autosave.flush();
    return !autosave.dirty;
  }
  autosave.markClean();
  return true;
}

async function newNote() {
  if (!(await settleCurrent())) return;
  current = NEW_NOTE;
  editor.setDoc("", "md");
  autosave.markClean();
  updateTitle();
  sidebar.render(notes, null);
  editor.focus();
}

async function openPath(path: string) {
  try {
    if (!(await settleCurrent())) return;
    const [text, managed] = await Promise.all([api.readNote(path), api.isInNotesDir(path)]);
    current = describe(path, managed);
    editor.setDoc(text, current.ext);
    autosave.markClean();
    updateTitle();
    sidebar.render(notes, current.path);
    editor.focus();
    if (!managed) {
      toast("This file is outside your notes folder, so it isn't autosaved. Press Ctrl+S to save.");
    }
  } catch (e) {
    toast(`Couldn't open note: ${errorMessage(e)}`);
  }
}

async function openWithDialog() {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Notes", extensions: ["md", "txt"] }],
  });
  if (typeof picked === "string") await openPath(picked);
}

async function pickFolder(): Promise<string | null> {
  const picked = await open({
    directory: true,
    multiple: false,
    title: "Choose a folder for your notes",
  });
  return typeof picked === "string" ? picked : null;
}

async function changeNotesDir() {
  try {
    const picked = await pickFolder();
    if (!picked) return;
    if (!(await settleCurrent())) return;
    await api.setNotesDir(picked);
    toast(`Notes folder: ${picked}`);
    await newNote();
    await refreshSidebar();
  } catch (e) {
    toast(`Couldn't change folder: ${errorMessage(e)}`);
  }
}

async function renameCurrent(stem: string) {
  if (current.path === null) throw new Error("Nothing to rename yet");
  await autosave.flush();
  const meta = await api.renameNote(current.path, stem);
  current = describe(meta.path, current.managed);
  updateTitle();
  await refreshSidebar();
}

function startRename() {
  if (current.path === null) {
    toast("Type something first; the note is created on the first keystroke");
    return;
  }
  // Renaming flushes pending edits, which must not happen silently for an outside file.
  if (!current.managed && autosave.dirty) {
    toast("Save the file first (Ctrl+S), then rename it");
    return;
  }
  const dot = current.name.lastIndexOf(".");
  renamePrompt.open(dot > 0 ? current.name.slice(0, dot) : current.name);
}

/**
 * First launch: show a welcome screen and do nothing until the user clicks a button.
 * No system dialog opens by itself, and no folder is created unless the user asks for it.
 * Resolves once a notes folder has been saved; cancelling the folder dialog just leaves
 * the welcome screen up.
 */
function runWelcome(): Promise<void> {
  const welcome = document.querySelector<HTMLElement>("#welcome")!;
  const choose = document.querySelector<HTMLButtonElement>("#welcome-choose")!;
  const useDefault = document.querySelector<HTMLButtonElement>("#welcome-default")!;
  const error = document.querySelector<HTMLElement>("#welcome-error")!;
  welcome.hidden = false;
  choose.focus();

  return new Promise((resolve) => {
    async function complete(pick: () => Promise<string | null>) {
      choose.disabled = useDefault.disabled = true;
      error.hidden = true;
      try {
        const dir = await pick();
        if (!dir) return;
        await api.setNotesDir(dir);
        welcome.hidden = true;
        resolve();
      } catch (e) {
        error.textContent = `Couldn't set the notes folder: ${errorMessage(e)}`;
        error.hidden = false;
      } finally {
        choose.disabled = useDefault.disabled = false;
      }
    }
    choose.addEventListener("click", () => void complete(pickFolder));
    useDefault.addEventListener("click", () => void complete(api.defaultNotesDir));
  });
}

// ---------- boot ----------

// Shortcuts do nothing while the welcome screen is up (there is no notes folder yet), or
// while the unsaved-changes prompt is waiting for an answer.
let ready = false;
const whenReady = (action: () => void) => () => {
  if (ready && !promptOpen) action();
};

async function boot() {
  installShortcuts({
    "Mod+n": whenReady(() => void newNote()),
    "Mod+o": whenReady(() => void openWithDialog()),
    "Mod+s": whenReady(() => void autosave.flush()),
    "Mod+p": whenReady(() => switcher.open(notes)),
    "Mod+b": whenReady(() => sidebar.toggle()),
    "Mod+,": whenReady(() => void changeNotesDir()),
    "Mod+shift+r": whenReady(() => startRename()),
    "Mod+w": whenReady(() => void newNote()),
  });

  // Save notes (or ask about outside files) before the window goes away. Cancelling the prompt
  // keeps the window open. A failure to register this hook must not stop the app starting.
  try {
    await getCurrentWindow().onCloseRequested(async (event) => {
      try {
        if (!(await settleCurrent())) event.preventDefault();
      } catch {
        /* the save error was already reported by autosave */
      }
    });
  } catch (e) {
    toast(`Autosave on close is unavailable: ${errorMessage(e)}`);
  }

  let configured = false;
  try {
    configured = Boolean((await api.getConfig()).notes_dir);
  } catch (e) {
    toast(`Couldn't read settings: ${errorMessage(e)}`);
  }
  if (!configured) await runWelcome();

  document.querySelector<HTMLElement>("#app")!.hidden = false;
  ready = true;
  await refreshSidebar();
  await newNote();
}

boot().catch((e) => toast(`Startup failed: ${errorMessage(e)}`));
