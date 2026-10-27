import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toCombo } from "./accelerators";
import { createAboutDialog } from "./about";
import * as api from "./api";
import { createAutosave } from "./autosave";
import { createChoicePrompt, type Choice, type ChoiceOptions } from "./choice";
import { createEditor } from "./editor";
import { detectEol, eolName } from "./lineEndings";
import { createRenamePrompt } from "./rename";
import { createShortcutsHelp } from "./shortcutsHelp";
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
  /**
   * True for notes inside the notes folder, which are autosaved. A file opened from anywhere
   * else is only saved when the user asks (Ctrl+S).
   */
  managed: boolean;
  /**
   * True when the file mixes line endings (say CRLF and LF). Saving has to convert them all to
   * one, which only happens when the user saves explicitly, so it is not autosaved either.
   */
  mixedEol: boolean;
  /** Whether the file on disk currently has any text. */
  hasText: boolean;
  /**
   * The file was deleted or moved while open and the user chose to keep editing. Autosave stays
   * off, so the file is not silently recreated; an explicit Ctrl+S recreates it.
   */
  missing: boolean;
}

const NEW_NOTE: Current = {
  path: null,
  name: "",
  ext: "md",
  managed: true,
  mixedEol: false,
  hasText: false,
  missing: false,
};

const EMPTY_REASON = "it is empty, which would erase the text in the saved file";

/**
 * Why the current document is not autosaved, phrased to follow "because"; null when it is.
 * Anything that would change a file the user did not edit that way must wait for Ctrl+S.
 */
function autosaveOffReason(c: Current): string | null {
  if (c.missing) return "its file was deleted or moved";
  if (c.path !== null && c.path === settingsPath) {
    return "it is the settings file, which is only saved when you choose to save it";
  }
  if (!c.managed) return "it is outside your draft directory";
  if (c.mixedEol) return "it mixes line endings";
  // Clearing a note must not wipe its file behind the user's back; only Ctrl+S may do that.
  if (c.hasText && editor.isEmpty()) return EMPTY_REASON;
  return null;
}

let current: Current = NEW_NOTE;
let notes: api.NoteMeta[] = [];
/** Path of settings.json, known once the user has opened it from the Settings menu. */
let settingsPath: string | null = null;

// ---------- small UI helpers ----------

const toastEl = document.querySelector<HTMLElement>("#toast")!;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function toast(message: string, stayMs = 4000) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), stayMs);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// The autosave state last shown in the title, so we notice when typing changes it.
let shownReason: string | null = null;
let shownTitle = "";

const statusName = document.querySelector<HTMLElement>("#status-name")!;
const statusSelection = document.querySelector<HTMLElement>("#status-selection")!;
const statusPosition = document.querySelector<HTMLElement>("#status-position")!;
const statusState = document.querySelector<HTMLElement>("#status-state")!;
const statusAutosave = document.querySelector<HTMLElement>("#status-autosave")!;

/** The bar under the editor: draft name, cursor position, saved or not, and whether autosave is off. */
function updateStatus(name: string) {
  statusName.textContent = name;
  // A blank new draft has no file yet, so it is neither saved nor unsaved.
  statusState.textContent = autosave.dirty ? "Unsaved" : current.path ? "Saved" : "";
  statusState.classList.toggle("unsaved", autosave.dirty);
  statusAutosave.hidden = shownReason === null;
  statusAutosave.title = shownReason ? `Autosave is off because ${shownReason}` : "";
}

function updateTitle() {
  shownReason = autosaveOffReason(current);
  const base = current.path ? current.name : "Untitled";
  updateStatus(base);
  const note = shownReason ? " (autosave off)" : "";
  const title = `${autosave.dirty ? "• " : ""}${base}${note} — ${APP_NAME}`;
  if (title === shownTitle) return;
  shownTitle = title;
  document.title = title;
  getCurrentWindow()
    .setTitle(title)
    .catch(() => {});
}

/** Called after every edit: autosave can switch on or off as the text changes (e.g. cleared). */
function onEdited() {
  // Read this first: touch() can itself refresh the title (when the note turns dirty).
  const before = shownReason;
  autosave.touch();
  updateTitle();
  if (shownReason === EMPTY_REASON && before !== EMPTY_REASON) {
    toast("Autosave is paused because the draft is empty. Press Ctrl+S to save it that way.");
  }
}

// ---------- editor, autosave, sidebar ----------

// Replaced at startup by the autosave_delay_ms setting (default 5 seconds, see settings.rs).
const DEFAULT_AUTOSAVE_DELAY_MS = 5000;

const autosave = createAutosave({
  delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
  isEnabled: () => autosaveOffReason(current) === null,
  save: saveCurrent,
  onDirtyChange: updateTitle,
  onError: (e) => toast(`Couldn't save: ${errorMessage(e)}`),
});

const editor = createEditor(document.querySelector<HTMLElement>("#editor")!, {
  onChange: onEdited,
  onCursor: (line, column, selected) => {
    statusPosition.textContent = `Ln ${line}, Col ${column}`;
    statusSelection.hidden = selected === 0;
    statusSelection.textContent = `${selected.toLocaleString()} character${selected === 1 ? "" : "s"} selected`;
  },
  // Losing focus only saves what is allowed to autosave.
  onBlur: () => {
    if (autosaveOffReason(current) === null) void autosave.flush(false);
  },
  // Mistakes in the settings file are underlined as you type.
  lint: (text) => api.checkSettings(text),
});

const choicePrompt = createChoicePrompt();
let promptOpen = false;

/** Shows the choice prompt. Shortcuts are ignored while it waits for an answer. */
async function ask(options: ChoiceOptions): Promise<Choice> {
  promptOpen = true;
  try {
    return await choicePrompt.ask(options);
  } finally {
    promptOpen = false;
  }
}

const sidebar = createSidebar(
  document.querySelector<HTMLElement>("#sidebar")!,
  document.querySelector<HTMLElement>("#app")!,
  (note) => void openPath(note.path),
  (note) => void trashDraft(note),
  (note) => startRenameOf(note),
);

const switcher = createSwitcher(
  (note) => void openPath(note.path),
  () => editor.focus(),
);

const renamePrompt = createRenamePrompt(renameChosen, () => editor.focus());

const shortcutsHelp = createShortcutsHelp(() => editor.focus());
const aboutDialog = createAboutDialog(() => editor.focus());

async function refreshSidebar() {
  try {
    notes = await api.listNotes();
  } catch (e) {
    toast(`Couldn't list drafts: ${errorMessage(e)}`);
    notes = [];
  }
  sidebar.render(notes, current.path);
}

/**
 * Saves the current document. Resolves true when it is saved (or there was nothing to save),
 * and false when it was not, so it must stay marked as unsaved. `explicit` is true when the
 * user asked for the save; otherwise it only goes ahead if autosave is still allowed now.
 */
async function saveCurrent(explicit: boolean): Promise<boolean> {
  // Queued saves can run after the situation changed (the user chose Keep editing, cleared
  // the note...), so an implicit save checks again rather than trusting when it was scheduled.
  if (!explicit && autosaveOffReason(current) !== null) return false;
  const content = editor.getDoc();
  if (current.path === null) {
    // Don't create empty files: wait until there is something to write.
    if (content === "") return true;
    const meta = await api.createNote(content);
    current = {
      path: meta.path,
      name: meta.name,
      ext: meta.ext,
      managed: true,
      mixedEol: false,
      hasText: true,
      missing: false,
    };
  } else {
    const outcome = await writeExisting(current.path, content, explicit);
    if (outcome === "kept") return false;
    if (outcome === "closed") return true; // the note was closed; nothing is left to save
  }
  updateTitle();
  await refreshSidebar();
  // Saving the settings file is the user's go-ahead to apply it; no separate reload needed.
  if (current.path !== null && current.path === settingsPath) void applySettings(true);
  return true;
}

type WriteOutcome = "saved" | "closed" | "kept";

/**
 * Saves over an existing note's file. If that file was deleted or moved since it was opened,
 * nothing is recreated until the user says so.
 */
async function writeExisting(
  path: string,
  content: string,
  explicit: boolean,
): Promise<WriteOutcome> {
  try {
    // After the user chose Keep editing, their own Ctrl+S is the go-ahead to recreate it.
    await api.writeNote(path, content, explicit && current.missing);
  } catch (e) {
    if (!(e instanceof api.ApiError && e.kind === "missing")) throw e;
    // This can pop up while the user is typing, so a stray Enter or Space must be harmless.
    const picked = await ask({
      message: `“${current.name}” was deleted or moved outside Draftwick. Save it again?`,
      primary: "Save again",
      secondary: "Close without saving",
      cancel: "Keep editing",
      focus: "cancel",
    });
    if (picked === "cancel") {
      current = { ...current, missing: true };
      updateTitle();
      toast("Autosave is off because the file is gone. Press Ctrl+S to save it again.");
      return "kept";
    }
    if (picked === "secondary") {
      resetToBlank();
      return "closed";
    }
    await api.writeNote(path, content, true);
  }
  // The file exists again with a single line ending, so earlier cautions no longer apply.
  current = { ...current, mixedEol: false, hasText: content !== "", missing: false };
  return "saved";
}

function describe(path: string, managed: boolean, mixedEol: boolean, hasText: boolean): Current {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "md";
  return { path, name, ext, managed, mixedEol, hasText, missing: false };
}

// ---------- actions ----------

/**
 * Makes the current document safe to leave (switch away from, or close). Documents that may
 * autosave are simply saved. Anything else is never saved without asking, so with unsaved edits
 * the user chooses Save / Don't Save / Cancel. Returns false when the caller must stay on this
 * document (the user cancelled, or an explicit save failed).
 */
async function settleCurrent(): Promise<boolean> {
  const reason = autosaveOffReason(current);
  if (!autosave.dirty || reason === null) {
    await autosave.flush(false);
    // The save may have found the file gone, and the user chose to keep editing: stay here.
    return !(autosave.dirty && current.missing);
  }
  const picked = await ask({
    message: `Save changes to “${current.name}”? It isn't autosaved because ${reason}.`,
    primary: "Save",
    secondary: "Don't Save",
    cancel: "Cancel",
  });
  if (picked === "cancel") return false;
  if (picked === "primary") {
    await autosave.flush(true);
    return !autosave.dirty;
  }
  autosave.markClean();
  return true;
}

/** Replaces whatever is open with a new, empty note. Callers settle the old document first. */
function resetToBlank() {
  current = NEW_NOTE;
  editor.setDoc("", "md", "\n");
  autosave.markClean();
  updateTitle();
  sidebar.render(notes, null);
  editor.focus();
}

async function newNote() {
  if (!(await settleCurrent())) return;
  resetToBlank();
}

async function openPath(path: string) {
  try {
    if (!(await settleCurrent())) return;
    const [text, managed] = await Promise.all([api.readNote(path), api.isInNotesDir(path)]);
    const { eol, mixed } = detectEol(text);
    current = describe(path, managed, mixed, text !== "");
    editor.setDoc(text, current.ext, eol);
    autosave.markClean();
    updateTitle();
    sidebar.render(notes, current.path);
    editor.focus();
    const reason = autosaveOffReason(current);
    if (path === settingsPath) {
      toast("Editing your settings. Press Ctrl+S to save; they apply as soon as you save.", 7000);
    } else if (reason !== null) {
      const convert = mixed ? ` Saving converts every line ending to ${eolName(eol)}.` : "";
      toast(`Autosave is off for this file because ${reason}. Press Ctrl+S to save.${convert}`);
    }
  } catch (e) {
    toast(`Couldn't open draft: ${errorMessage(e)}`);
  }
}

async function openWithDialog() {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Drafts", extensions: ["md", "txt"] }],
  });
  if (typeof picked === "string") await openPath(picked);
}

async function pickFolder(): Promise<string | null> {
  const picked = await open({
    directory: true,
    multiple: false,
    title: "Choose a directory for your drafts",
  });
  return typeof picked === "string" ? picked : null;
}

async function changeNotesDir() {
  try {
    const picked = await pickFolder();
    if (!picked) return;
    if (!(await settleCurrent())) return;
    await api.setNotesDir(picked);
    toast(`Draft directory: ${picked}`);
    await newNote();
    await refreshSidebar();
  } catch (e) {
    toast(`Couldn't change the draft directory: ${errorMessage(e)}`);
  }
}

/**
 * Moves a draft to the system trash after asking. If it is the open draft, pending edits are
 * saved first (so the trashed copy is the latest text) and the editor is replaced by a blank
 * draft; the file is never written again, so it can't come back.
 */
async function trashDraft(note: api.NoteMeta) {
  if (note.path === settingsPath) return;
  const picked = await ask({
    message: `Move “${note.name}” to the trash?`,
    primary: "Move to trash",
    cancel: "Cancel",
    focus: "cancel",
  });
  if (picked !== "primary") return;
  try {
    const isOpen = note.path === current.path;
    if (isOpen) await autosave.flush(false);
    await api.trashNote(note.path);
    if (isOpen) resetToBlank();
    await refreshSidebar();
    toast(`Moved “${note.name}” to the trash`);
  } catch (e) {
    toast(`Couldn't move it to the trash: ${errorMessage(e)}`);
  }
}

/** A draft chosen in the sidebar that is not the open one; null means "the open draft". */
let renameTarget: api.NoteMeta | null = null;

/** Renames the draft the prompt was opened for. */
async function renameChosen(stem: string) {
  if (renameTarget === null) return renameCurrent(stem);
  await api.renameNote(renameTarget.path, stem);
  await refreshSidebar();
}

async function renameCurrent(stem: string) {
  if (current.path === null) throw new Error("Nothing to rename yet");
  await autosave.flush(false);
  const meta = await api.renameNote(current.path, stem);
  current = describe(meta.path, current.managed, current.mixedEol, current.hasText);
  updateTitle();
  await refreshSidebar();
}

/** Rename from the sidebar menu: the open draft takes the normal path, any other is renamed as is. */
function startRenameOf(note: api.NoteMeta) {
  if (note.path === current.path) return startRename();
  renameTarget = note;
  const dot = note.name.lastIndexOf(".");
  renamePrompt.open(dot > 0 ? note.name.slice(0, dot) : note.name);
}

function startRename() {
  renameTarget = null;
  if (current.path !== null && current.path === settingsPath) {
    toast("The settings file can't be renamed");
    return;
  }
  if (current.path === null) {
    toast("Type something first; the draft is created on the first keystroke");
    return;
  }
  // Renaming flushes pending edits, which must not happen silently for an outside file.
  if (autosaveOffReason(current) !== null && autosave.dirty) {
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
        error.textContent = `Couldn't set the draft directory: ${errorMessage(e)}`;
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

let ready = false;
/** The action table kept in Rust (menu.rs): what the menu and the shortcuts are built from. */
let actionTable: api.ActionInfo[] = [];

/** What each action in the table does. Menu clicks and keyboard shortcuts both end up here. */
const handlers: Record<string, () => void> = {
  new: () => void newNote(),
  open: () => void openWithDialog(),
  save: () => void autosave.flush(),
  close: () => void newNote(), // closes the note and shows a blank one; the window stays open
  // Closing the window goes through the normal close path, which asks about unsaved work.
  quit: () => void getCurrentWindow().close(),
  quick_switcher: () => switcher.open(notes),
  toggle_sidebar: () => toggleSidebar(),
  change_folder: () => void changeNotesDir(),
  rename: () => startRename(),
  about: () =>
    void api
      .getAbout()
      .then((info) => aboutDialog.open(info))
      .catch((e) => toast(`Couldn't open About: ${errorMessage(e)}`)),
  shortcuts: () => shortcutsHelp.open(actionTable),
  open_settings: () => void openSettingsFile(),
  reload_settings: () => void applySettings(true),
  fullscreen: () => void toggleFullscreen(),
  undo: () => editor.undo(),
  redo: () => editor.redo(),
};

/** F11 and View > Enter full screen. The menu text follows what the window really did. */
async function toggleFullscreen() {
  try {
    const win = getCurrentWindow();
    await win.setFullscreen(!(await win.isFullscreen()));
    const now = await win.isFullscreen();
    await api.setMenuText("fullscreen", now ? "Exit full screen" : "Enter full screen");
  } catch (e) {
    toast(`Couldn't change full screen: ${errorMessage(e)}`);
  }
}

/** Keeps the tick on View > Show sidebar in step with the sidebar. */
function syncSidebarTick() {
  void api
    .setMenuChecked("toggle_sidebar", sidebar.isVisible())
    .catch((e) => toast(`Couldn't update the menu: ${errorMessage(e)}`));
}

/**
 * Opens settings.json in Draftwick's own editor, creating it first if this is the first time.
 * (Handing it to the system would open whatever the OS associates with .json, often a browser.)
 */
async function openSettingsFile() {
  try {
    settingsPath = await api.prepareSettingsFile();
    await openPath(settingsPath);
  } catch (e) {
    toast(`Couldn't open settings: ${errorMessage(e)}`);
  }
}

/** "5 seconds", "2.5 seconds", "500 milliseconds"... */
function describeDelay(ms: number): string {
  if (ms < 1000) return `${ms} milliseconds`;
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} second${seconds === 1 ? "" : "s"}`;
}

/**
 * Reads settings.json (a missing file just means the defaults) and applies it. Anything in the
 * file that had to be ignored or adjusted is shown, so a typo doesn't pass silently. `announce`
 * is true when the user asked for the reload, so they get confirmation.
 */
/**
 * "system" removes the override so the stylesheet follows the operating system (and keeps
 * following it); "dark" and "light" set it. See the theme blocks at the top of styles.css.
 */
function applyTheme(theme: api.Settings["theme"]) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/** Font and wrap width: the editor reads these CSS variables (see styles.css and editor.ts). */
function applyAppearance(settings: api.Settings) {
  const style = document.documentElement.style;
  style.setProperty("--editor-font-size", `${settings.font_size}px`);
  // The name was checked in Rust (letters, digits, spaces and . _ - only), so quoting it is safe.
  style.setProperty("--mono", settings.font_family ? `"${settings.font_family}", monospace` : "monospace");
  style.setProperty(
    "--editor-max-width",
    settings.wrap_column === 0 ? "none" : `calc(${settings.wrap_column}ch + 48px)`,
  );
  editor.setOptions({
    lineNumbers: settings.show_line_numbers,
    tabSize: settings.tab_size,
    tabsToSpaces: settings.translate_tabs_to_spaces,
  });
  editor.refreshLayout();
}

async function applySettings(announce: boolean) {
  try {
    const { settings, problems, valid } = await api.getSettings();
    if (!valid && announce) {
      // The user just saved a file with a mistake in it: say where, and keep what was working.
      toast(`Settings not applied. ${problems.join(" ")} Your previous settings are still in use.`, 12000);
      return;
    }
    autosave.setDelay(settings.autosave_delay_ms);
    applyTheme(settings.theme);
    applyAppearance(settings);
    if (problems.length > 0) {
      const lead = valid ? "" : "settings.json has a mistake, so the defaults are in use. ";
      toast(lead + problems.join(" "), 12000);
    } else if (announce) {
      toast(`Settings reloaded. Drafts save ${describeDelay(settings.autosave_delay_ms)} after you stop typing.`);
    }
  } catch (e) {
    toast(`Couldn't load settings: ${errorMessage(e)}`);
  }
}

/** Shows or hides the sidebar, and remembers the choice for the next launch. */
function toggleSidebar() {
  sidebar.toggle();
  syncSidebarTick();
  void api
    .setSidebarVisible(sidebar.isVisible())
    .catch((e) => toast(`Couldn't remember the sidebar choice: ${errorMessage(e)}`));
  editor.focus();
}

/**
 * Runs an action by id. Ignored while a prompt waits for an answer, and, for actions that need
 * a notes folder, while the welcome screen is up.
 */
function runAction(id: string) {
  const action = handlers[id];
  const info = actionTable.find((a) => a.id === id);
  if (!action || !info || promptOpen) return;
  if (info.needs_folder && !ready) return;
  action();
}

/** When each action last arrived from the native menu (click or accelerator). */
const lastFromMenu = new Map<string, number>();
const MENU_WINDOW_MS = 150;

/**
 * A key press for an action that lives in the native menu. Normally the menu's accelerator takes
 * the key first and this is never reached. If the press does reach the page, either the menu
 * is about to report it too (so do nothing) or it never will (so run it ourselves). Waiting a
 * moment for the menu's event keeps the action from running twice, or not at all.
 */
function keyForMenuAction(id: string) {
  const fresh = (t: number | undefined, since: number) => t !== undefined && t >= since;
  if (fresh(lastFromMenu.get(id), performance.now() - MENU_WINDOW_MS)) return;
  const pressedAt = performance.now();
  setTimeout(() => {
    if (!fresh(lastFromMenu.get(id), pressedAt)) runAction(id);
  }, MENU_WINDOW_MS);
}

async function boot() {
  actionTable = await api.getActions();
  await applySettings(false);

  // Every shortcut is bound here. Those whose action has a native menu item are normally taken
  // by that item's accelerator before they reach the page; see keyForMenuAction.
  const keys: Record<string, () => void> = {};
  for (const action of actionTable) {
    if (action.accelerator === null) continue;
    keys[toCombo(action.accelerator)] =
      action.menu === null ? () => runAction(action.id) : () => keyForMenuAction(action.id);
  }
  installShortcuts(keys);

  try {
    await listen<string>("menu-action", (event) => {
      lastFromMenu.set(event.payload, performance.now());
      runAction(event.payload);
    });
  } catch (e) {
    toast(`The menu is unavailable: ${errorMessage(e)}`);
  }

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
  let savedSidebar: boolean | null = null;
  try {
    const config = await api.getConfig();
    configured = Boolean(config.notes_dir);
    savedSidebar = config.sidebar_visible;
  } catch (e) {
    toast(`Couldn't read settings: ${errorMessage(e)}`);
  }
  if (!configured) await runWelcome();

  document.querySelector<HTMLElement>("#app")!.hidden = false;
  ready = true;
  // The menu items that need a notes folder start greyed out; switch them on now there is one.
  await api.setMenuEnabled(true).catch((e) => toast(`Couldn't enable the menu: ${errorMessage(e)}`));
  // Restore the sidebar as the user left it. Nothing is written back: this is not a new choice.
  if (savedSidebar === false && sidebar.isVisible()) sidebar.toggle();
  syncSidebarTick();
  await refreshSidebar();
  await newNote();
}

boot().catch((e) => toast(`Startup failed: ${errorMessage(e)}`));
