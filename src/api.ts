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

function messageOf(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return "Unknown error";
}

// Rust commands reject with a serialized `{ message }`; surface that as a normal Error.
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(messageOf(e));
  }
}

export const getConfig = () => call<Config>("get_config");
export const setNotesDir = (path: string) => call<Config>("set_notes_dir", { path });
export const defaultNotesDir = () => call<string>("default_notes_dir");
export const isInNotesDir = (path: string) => call<boolean>("is_in_notes_dir", { path });
export const listNotes = () => call<NoteMeta[]>("list_notes");
export const readNote = (path: string) => call<string>("read_note", { path });
export const writeNote = (path: string, content: string) =>
  call<NoteMeta>("write_note", { path, content });
export const createNote = (content: string) => call<NoteMeta>("create_note", { content });
export const renameNote = (path: string, newStem: string) =>
  call<NoteMeta>("rename_note", { path, newStem });
