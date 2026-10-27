import { test } from "node:test";
import assert from "node:assert/strict";
import { toCombo, toDisplay } from "../src/accelerators.ts";

test("a function key stands alone, and other shortcuts still need Ctrl", () => {
  assert.equal(toCombo("F11"), "f11");
  assert.equal(toCombo("CmdOrCtrl+Shift+R"), "Mod+shift+r");
  assert.equal(toCombo("CmdOrCtrl+,"), "Mod+,");
  assert.throws(() => toCombo("Shift+R"));
});

test("shortcuts are shown the way people write them", () => {
  assert.equal(toDisplay("F11", false), "F11");
  assert.equal(toDisplay("CmdOrCtrl+Shift+R", false), "Ctrl+Shift+R");
  assert.equal(toDisplay("CmdOrCtrl+Shift+R", true), "Cmd+Shift+R");
});
