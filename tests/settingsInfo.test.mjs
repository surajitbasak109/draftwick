import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SETTING_INFO } from "../src/settingsInfo.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const infoKeys = SETTING_INFO.map((i) => i.key).sort();

test("the Settings dialog describes exactly the settings settings.rs knows", () => {
  const rust = read("../src-tauri/src/settings.rs");
  const body = rust.match(/pub struct Settings \{([\s\S]*?)\n\}/)[1];
  const fields = [...body.matchAll(/pub (\w+):/g)].map((m) => m[1]).sort();
  assert.deepEqual(infoKeys, fields);
});

test("the Settings dialog and settings.example.jsonc list the same settings", () => {
  const example = read("../settings.example.jsonc");
  const keys = [...example.matchAll(/^\s*\/\/ "(\w+)":/gm)].map((m) => m[1]).sort();
  assert.deepEqual(infoKeys, keys);
});

test("each setting has a title, a description, what is allowed and a default", () => {
  for (const info of SETTING_INFO) {
    for (const field of ["title", "description", "allowed", "defaultText"]) {
      assert.ok(info[field] && info[field].length > 0, `${info.key}.${field}`);
    }
  }
});

test("values are shown as people read them", () => {
  const by = Object.fromEntries(SETTING_INFO.map((i) => [i.key, i]));
  assert.equal(by.font_family.show(""), "system monospace");
  assert.equal(by.font_family.show("Fira Code"), "Fira Code");
  assert.equal(by.wrap_column.show(0), "0 (the window edge)");
  assert.equal(by.wrap_column.show(80), "80");
  assert.equal(by.theme.show("dark"), "dark");
});
