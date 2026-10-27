/**
 * Accelerators come from the action table in Rust, in Tauri's syntax ("CmdOrCtrl+Shift+R").
 * These helpers turn them into what the frontend needs.
 */

const MODIFIERS = new Set(["cmdorctrl", "commandorcontrol", "cmd", "command", "ctrl", "control"]);

/** The key combo format used by shortcuts.ts: "Mod+shift+r". Throws for anything unsupported. */
export function toCombo(accelerator: string): string {
  // A function key stands alone ("F11"); shortcuts.ts uses the same lowercase name.
  if (/^F\d{1,2}$/.test(accelerator)) return accelerator.toLowerCase();
  const parts = accelerator.split("+");
  const key = parts.pop();
  if (!key) throw new Error(`Bad accelerator: ${accelerator}`);
  let shift = false;
  let mod = false;
  for (const part of parts) {
    const p = part.toLowerCase();
    if (MODIFIERS.has(p)) mod = true;
    else if (p === "shift") shift = true;
    else throw new Error(`Unsupported modifier "${part}" in ${accelerator}`);
  }
  if (!mod) throw new Error(`Accelerator needs Ctrl/Cmd: ${accelerator}`);
  const name = key.toLowerCase() === "comma" ? "," : key.toLowerCase();
  return `Mod+${shift ? "shift+" : ""}${name}`;
}

/** Text for showing the shortcut to a person: "Ctrl+Shift+R" (or "Cmd+Shift+R" on a Mac). */
export function toDisplay(accelerator: string, mac: boolean): string {
  return accelerator
    .split("+")
    .map((part) => {
      if (MODIFIERS.has(part.toLowerCase())) return mac ? "Cmd" : "Ctrl";
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join("+");
}
