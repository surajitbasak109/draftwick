import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownToHtml } from "../src/markdownHtml.ts";

test("headings, emphasis, lists and links come out as plain HTML", () => {
  const html = markdownToHtml("# Title\n\nSome **bold** and *italic* text.\n\n- one\n- two\n\n[site](https://example.com)");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);
  assert.match(html, /<a href="https:\/\/example.com">site<\/a>/);
});

test("GitHub-style tables and task lists work", () => {
  assert.match(markdownToHtml("| a | b |\n|---|---|\n| 1 | 2 |"), /<table>/);
  assert.match(markdownToHtml("- [x] done"), /type="checkbox"/);
});

test("HTML written in the draft is shown as text, never passed through", () => {
  const html = markdownToHtml('Hello <script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<div onclick="x()">hi</div>');
  assert.ok(!/<script/i.test(html), html);
  assert.ok(!/<img/i.test(html), html);
  assert.ok(!/<div/i.test(html), html);
  assert.match(html, /&lt;script&gt;/);
});

test("only web, mail and in-page links are kept; the words stay", () => {
  const bad = markdownToHtml("[x](javascript:alert(1)) and [y](data:text/html,hi) and [z](file:///etc/passwd)");
  assert.ok(!/href/i.test(bad), bad);
  assert.match(bad, /x/);
  assert.match(markdownToHtml("[m](mailto:a@b.c) [h](#top)"), /href="mailto:a@b.c"[\s\S]*href="#top"/);
});

test("quotes in a link title or address cannot break out of the attribute", () => {
  const html = markdownToHtml('[a](https://e.com/"onmouseover="x "t&quot;")');
  assert.ok(!/onmouseover="x/.test(html.replace(/&quot;/g, "")), html);
});

test("images keep only their description", () => {
  const html = markdownToHtml("![a cat](https://example.com/cat.png)");
  assert.ok(!/<img/i.test(html));
  assert.match(html, /a cat/);
});

test("an empty draft gives an empty result", () => {
  assert.equal(markdownToHtml("").trim(), "");
});
