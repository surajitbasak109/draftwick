import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseActions } from "../dev/actions.mjs";

const rust = readFileSync(new URL("../src-tauri/src/menu.rs", import.meta.url), "utf8");

test("the stand-in reads every row of the action table in menu.rs", () => {
  const rows = rust.match(/Action::new\(\s*"/g).length;
  assert.equal(parseActions(rust).length, rows);
});

test("the stand-in reads the fields of a row correctly", () => {
  const byId = Object.fromEntries(parseActions(rust).map((a) => [a.id, a]));
  assert.deepEqual(
    { ...byId.save_as },
    { id: "save_as", label: "Save as…", accelerator: "CmdOrCtrl+Shift+S", menu: "File", needs_folder: true, check: null },
  );
  assert.equal(byId.toggle_sidebar.check, true);
  assert.equal(byId.quick_switcher.menu, null);
  assert.equal(byId.about.needs_folder, false);
  assert.equal(byId.fullscreen.accelerator, "F11");
});
