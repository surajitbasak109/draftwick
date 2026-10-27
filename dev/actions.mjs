/**
 * Reads the action table out of `src-tauri/src/menu.rs`, so the browser stand-in (dev/standin.js)
 * offers exactly the actions the real app does and cannot drift from them. It understands the
 * `Action::new("id", "Label", accelerator, menu, needs_folder)` rows, and `.ticked()` after one.
 */
const ROW =
  /Action::new\(\s*"([^"]+)",\s*"([^"]+)",\s*(None|Some\("([^"]+)"\)),\s*(None|Some\("([^"]+)"\)),\s*(true|false),?\s*\)(\s*\.ticked\(\))?/g;

export function parseActions(rustSource) {
  const actions = [];
  for (const m of rustSource.matchAll(ROW)) {
    actions.push({
      id: m[1],
      label: m[2],
      accelerator: m[4] ?? null,
      menu: m[6] ?? null,
      needs_folder: m[7] === "true",
      check: m[8] ? true : null,
    });
  }
  return actions;
}
