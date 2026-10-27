// Run with: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { highlightTree, tagHighlighter, tags as t } from "@lezer/highlight";
import { jsonc } from "../src/jsonc.ts";

const highlighter = tagHighlighter([
  { tag: t.comment, class: "comment" },
  { tag: t.string, class: "string" },
  { tag: t.number, class: "number" },
  { tag: t.atom, class: "atom" },
  { tag: t.propertyName, class: "property" },
  { tag: t.bracket, class: "bracket" },
  { tag: t.punctuation, class: "punct" },
  { tag: t.invalid, class: "invalid" },
]);

/** The highlighted pieces of `text` as [piece, class] pairs, in order. */
function spans(text) {
  const out = [];
  highlightTree(jsonc.parser.parse(text), highlighter, (from, to, cls) => {
    out.push([text.slice(from, to), cls]);
  });
  return out;
}
const classOf = (text, piece) => spans(text).find(([s]) => s === piece)?.[1];

test("a property name and its number value", () => {
  assert.deepEqual(spans('{ "autosave_delay_ms": 2000 }'), [
    ["{", "bracket"],
    ['"autosave_delay_ms"', "property"],
    [":", "punct"],
    ["2000", "number"],
    ["}", "bracket"],
  ]);
});

test("strings, true, false, null and numbers are told apart", () => {
  const text = '{"a": "x", "b": true, "c": false, "d": null, "e": -1.5e3}';
  assert.equal(classOf(text, '"x"'), "string");
  assert.equal(classOf(text, "true"), "atom");
  assert.equal(classOf(text, "false"), "atom");
  assert.equal(classOf(text, "null"), "atom");
  assert.equal(classOf(text, "-1.5e3"), "number");
  assert.equal(classOf(text, '"a"'), "property");
});

test("a line comment runs to the end of the line, and what follows is highlighted again", () => {
  const s = spans('// note "not a string" 5\n"k": 1');
  assert.deepEqual(s[0], ['// note "not a string" 5', "comment"]);
  assert.equal(classOf('// c\n"k": 1', '"k"'), "property");
  assert.equal(classOf('// c\n"k": 1', "1"), "number");
});

test("a block comment can span lines and ends where it should", () => {
  const text = '/* first\n second\n third */ "k": 1';
  // CodeMirror reports a multi-line token one line at a time, so there is one piece per line.
  assert.deepEqual(spans(text), [
    ["/* first", "comment"],
    [" second", "comment"],
    [" third */", "comment"],
    ['"k"', "property"],
    [":", "punct"],
    ["1", "number"],
  ]);
});

test("a block comment on one line", () => {
  assert.equal(classOf('{ /* note */ "k": 1 }', "/* note */"), "comment");
  assert.equal(classOf('{ /* note */ "k": 1 }', '"k"'), "property");
});

test("// inside a string is not a comment", () => {
  assert.deepEqual(classOf('{"url": "http://example.com/x"}', '"http://example.com/x"'), "string");
});

test("an escaped quote does not end the string early", () => {
  assert.equal(classOf('{"a\\"b": 1}', '"a\\"b"'), "property");
  assert.equal(classOf('{"k": "say \\"hi\\""}', '"say \\"hi\\""'), "string");
});

test("a space before the colon still makes it a property name", () => {
  assert.equal(classOf('{"k" : 1}', '"k"'), "property");
});

test("trailing commas and comments after a value are fine", () => {
  const text = '{\n  "k": 1, // why\n}';
  assert.equal(classOf(text, "// why"), "comment");
  assert.equal(classOf(text, "1"), "number");
  assert.ok(!spans(text).some(([, cls]) => cls === "invalid"));
});

test("the example settings file is all comments and braces, nothing flagged as an error", () => {
  const example = readFileSync(new URL("../settings.example.jsonc", import.meta.url), "utf8");
  const s = spans(example);
  const kinds = new Set(s.map(([, cls]) => cls));
  assert.deepEqual([...kinds].sort(), ["bracket", "comment"]);
  // the commented-out setting line is one comment, so it is not mistaken for a real property
  assert.ok(s.some(([piece, cls]) => cls === "comment" && piece.includes('"autosave_delay_ms": 5000')));

  // and uncommenting that line, as the file tells the user to, makes it a real property + number
  const enabled = example.replace('// "autosave_delay_ms": 5000', '"autosave_delay_ms": 2000');
  assert.equal(classOf(enabled, '"autosave_delay_ms"'), "property");
  assert.equal(classOf(enabled, "2000"), "number");
});

test("the autosave default is the same in the app and in the settings code", () => {
  const rust = readFileSync(new URL("../src-tauri/src/settings.rs", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const inRust = rust.match(/AUTOSAVE_DELAY_DEFAULT_MS: u64 = ([\d_]+);/);
  const inMain = main.match(/DEFAULT_AUTOSAVE_DELAY_MS = ([\d_]+);/);
  assert.ok(inRust && inMain, "could not find both autosave defaults");
  assert.equal(Number(inMain[1].replaceAll("_", "")), Number(inRust[1].replaceAll("_", "")));
});
