import { invoke } from "@tauri-apps/api/core";

export interface Config {
  /** The draft directory (called notes_dir internally). */
  notes_dir: string | null;
  /** Whether the sidebar was left visible; null until the user first toggles it. */
  sidebar_visible: boolean | null;
}

export interface NoteMeta {
  path: string;
  name: string;
  modified_ms: number;
  ext: string;
}

/** An error from a Rust command. `kind` is "missing" when the file it needs no longer exists. */
export class ApiError extends Error {
  readonly kind: string;

  constructor(message: string, kind: string) {
    super(message);
    this.kind = kind;
  }
}

function fieldOf(e: unknown, field: "message" | "kind"): string | undefined {
  if (e && typeof e === "object" && field in e) return String((e as Record<string, unknown>)[field]);
  return undefined;
}

// Rust commands reject with a serialized `{ kind, message }`; surface that as an ApiError.
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    const message = typeof e === "string" ? e : (fieldOf(e, "message") ?? "Unknown error");
    throw new ApiError(message, fieldOf(e, "kind") ?? "error");
  }
}

/** One entry of the action table kept in Rust (menu.rs): what the menu and shortcuts are built from. */
export interface ActionInfo {
  id: string;
  label: string;
  /** Tauri accelerator syntax, e.g. "CmdOrCtrl+Shift+R"; null when there is no shortcut. */
  accelerator: string | null;
  /** The native menu that shows it. null means keyboard shortcut only, handled by the frontend. */
  menu: string | null;
  needs_folder: boolean;
}

export const getActions = () => call<ActionInfo[]>("get_actions");

/** User settings, from settings.json (see settings.rs). */
export interface Settings {
  /** How long to wait after the last keystroke before a draft is autosaved. */
  autosave_delay_ms: number;
  /** "system" follows the operating system; the others force dark or light. */
  theme: "system" | "dark" | "light";
  /** Editor text size in pixels. */
  font_size: number;
  /** One font name, or "" for the system monospace font. */
  font_family: string;
  /** Characters per line before wrapping; 0 wraps at the window edge. */
  wrap_column: number;
  show_line_numbers: boolean;
  tab_size: number;
  /** True: the Tab key types spaces; false: a tab character. */
  translate_tabs_to_spaces: boolean;
}

export interface LoadedSettings {
  settings: Settings;
  /** Things in the file that were ignored or adjusted, worded for the user, each with its line. */
  problems: string[];
  /** False when the file has a syntax mistake, so `settings` are only the defaults. */
  valid: boolean;
}

/** One mistake in the settings file, positioned for the editor to underline. */
export interface SettingsDiagnostic {
  /** Offsets in UTF-16 units (what CodeMirror uses); `to` is exclusive. */
  from: number;
  to: number;
  line: number;
  severity: "error" | "warning";
  message: string;
}

/** Checks the settings file's text as it is being edited, with the same rules the app applies. */
export const checkSettings = (text: string) => call<SettingsDiagnostic[]>("check_settings", { text });

export const getSettings = () => call<LoadedSettings>("get_settings");
/**
 * Creates settings.json if it does not exist yet (with every setting commented out) and returns
 * its path, so it can be opened in the editor like any other file.
 */
export const prepareSettingsFile = () => call<string>("prepare_settings_file");

export interface AboutInfo {
  name: string;
  version: string;
  description: string;
}

export const getAbout = () => call<AboutInfo>("get_about");
/** Greys the menu items that need a notes folder in or out. */
export const setMenuEnabled = (enabled: boolean) => call<void>("set_menu_enabled", { enabled });
/** Sets the tick on a check item in the menu, e.g. "toggle_sidebar". */
export const setMenuChecked = (id: string, checked: boolean) =>
  call<void>("set_menu_checked", { id, checked });
export const getConfig = () => call<Config>("get_config");
export const setNotesDir = (path: string) => call<Config>("set_notes_dir", { path });
export const defaultNotesDir = () => call<string>("default_notes_dir");
export const setSidebarVisible = (visible: boolean) =>
  call<void>("set_sidebar_visible", { visible });
export const isInNotesDir = (path: string) => call<boolean>("is_in_notes_dir", { path });
export const listNotes = () => call<NoteMeta[]>("list_notes");
export const readNote = (path: string) => call<string>("read_note", { path });
/**
 * Saves over an existing file. If the file has been deleted or moved, this rejects with an
 * ApiError of kind "missing" instead of recreating it, unless `createIfMissing` is set.
 */
export const writeNote = (path: string, content: string, createIfMissing = false) =>
  call<NoteMeta>("write_note", { path, content, createIfMissing });
export const createNote = (content: string) => call<NoteMeta>("create_note", { content });
/** Moves a draft to the system trash (never a permanent delete). */
export const trashNote = (path: string) => call<void>("trash_note", { path });
export const renameNote = (path: string, newStem: string) =>
  call<NoteMeta>("rename_note", { path, newStem });
