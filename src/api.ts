import { invoke } from "@tauri-apps/api/core";

export interface Config {
  notes_dir: string | null;
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
/** Greys the menu items that need a notes folder in or out. */
export const setMenuEnabled = (enabled: boolean) => call<void>("set_menu_enabled", { enabled });
export const getConfig = () => call<Config>("get_config");
export const setNotesDir = (path: string) => call<Config>("set_notes_dir", { path });
export const defaultNotesDir = () => call<string>("default_notes_dir");
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
export const renameNote = (path: string, newStem: string) =>
  call<NoteMeta>("rename_note", { path, newStem });
