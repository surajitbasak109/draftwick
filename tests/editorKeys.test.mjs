import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { EDITOR_KEYS } from "../src/editorKeys.ts";

const names = (map) => new Set(map.flatMap((b) => [b.key, b.mac, b.linux, b.win].filter(Boolean)));
const keymaps = { search: names(searchKeymap), history: names(historyKeymap), default: names(defaultKeymap) };
const editorSource = readFileSync(new URL("../src/editor.ts", import.meta.url), "utf8");

test("every key listed in Help > Keyboard shortcuts is still bound", () => {
  for (const { label, binding, from } of EDITOR_KEYS) {
    if (from === "editor.ts") {
      assert.ok(editorSource.includes(`key: "${binding}"`), `${label}: editor.ts has no key "${binding}"`);
    } else {
      assert.ok(keymaps[from].has(binding), `${label}: ${binding} is not in CodeMirror's ${from} keymap`);
    }
  }
});

test("Shift+Tab really is bound to taking an indent back", () => {
  assert.ok(editorSource.includes("shift: indentLess"));
});
