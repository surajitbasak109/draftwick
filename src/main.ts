import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as api from "./api";
import { createAutosave } from "./autosave";
import { createEditor } from "./editor";
import { createRenamePrompt } from "./rename";
import { createSidebar } from "./sidebar";
import { createSwitcher } from "./switcher";
import { installShortcuts } from "./shortcuts";
import "./styles.css";

const APP_NAME = "Draftwick";

interface Current {
  /** null until the first keystroke creates the file on disk. */
  path: string | null;
  name: string;
  ext: string;
}

let current: Current = { path: null, name: "", ext: "md" };
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
  const title = `${autosave.dirty ? "• " : ""}${base} — ${APP_NAME}`;
  document.title = title;
  getCurrentWindow()
    .setTitle(title)
    .catch(() => {});
}

// ---------- editor, autosave, sidebar ----------

const autosave = createAutosave({
  delayMs: 500,
  save: saveCurrent,
  onDirtyChange: updateTitle,
  onError: (e) => toast(`Couldn't save: ${errorMessage(e)}`),
});

const editor = createEditor(document.querySelector<HTMLElement>("#editor")!, {
  onChange: () => autosave.touch(),
  onBlur: () => void autosave.flush(),
});

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
    current = { path: meta.path, name: meta.name, ext: meta.ext };
  } else {
    await api.writeNote(current.path, content);
  }
  updateTitle();
  await refreshSidebar();
}

function describe(path: string): Current {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return { path, name, ext: dot >= 0 ? name.slice(dot + 1).toLowerCase() : "md" };
}

// ---------- actions ----------

async function newNote() {
  await autosave.flush();
  current = { path: null, name: "", ext: "md" };
  editor.setDoc("", "md");
  autosave.markClean();
  updateTitle();
  sidebar.render(notes, null);
  editor.focus();
}

async function openPath(path: string) {
  try {
    await autosave.flush();
    const text = await api.readNote(path);
    current = describe(path);
    editor.setDoc(text, current.ext);
    autosave.markClean();
    updateTitle();
    sidebar.render(notes, current.path);
    editor.focus();
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
    await autosave.flush();
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
  current = describe(meta.path);
  updateTitle();
  await refreshSidebar();
}

function startRename() {
  if (current.path === null) {
    toast("Type something first; the note is created on the first keystroke");
    return;
  }
  const dot = current.name.lastIndexOf(".");
  renamePrompt.open(dot > 0 ? current.name.slice(0, dot) : current.name);
}

/** First-launch flow: pick a folder, or fall back to ~/Notes if the dialog is cancelled. */
async function ensureNotesDir() {
  const config = await api.getConfig();
  if (config.notes_dir) return;
  const picked = await pickFolder();
  if (picked) {
    await api.setNotesDir(picked);
    return;
  }
  await api.setNotesDir(await api.defaultNotesDir());
  toast("Saving notes to ~/Notes. Change in Settings (Ctrl+,)");
}

// ---------- boot ----------

async function boot() {
  installShortcuts({
    "Mod+n": () => void newNote(),
    "Mod+o": () => void openWithDialog(),
    "Mod+s": () => void autosave.flush(),
    "Mod+p": () => switcher.open(notes),
    "Mod+b": () => sidebar.toggle(),
    "Mod+,": () => void changeNotesDir(),
    "Mod+shift+r": () => startRename(),
    "Mod+w": () => void newNote(),
  });

  // Flush before the window goes away. Never block closing on a failed save, and never
  // let a failure to register this hook stop the app from starting.
  try {
    await getCurrentWindow().onCloseRequested(async () => {
      try {
        await autosave.flush();
      } catch {
        /* the save error was already reported by autosave */
      }
    });
  } catch (e) {
    toast(`Autosave on close is unavailable: ${errorMessage(e)}`);
  }

  try {
    await ensureNotesDir();
  } catch (e) {
    toast(`Couldn't set up the notes folder: ${errorMessage(e)}`);
  }
  await refreshSidebar();
  await newNote();
}

boot().catch((e) => toast(`Startup failed: ${errorMessage(e)}`));
