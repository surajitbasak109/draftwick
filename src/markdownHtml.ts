import { Marked } from "marked";

/**
 * Turns Markdown into HTML to paste into email, chat or a document (Edit > Copy as HTML).
 *
 * Drafts often hold pasted web or chat text, so the result is made safe rather than trusted:
 * HTML written inside the draft is shown as text, not passed through, and only web, mail and
 * in-page links are kept (no `javascript:` and the like). Everything else is plain Markdown
 * (GitHub style: tables, task lists, strikethrough), with no styling, so it takes on the look of
 * wherever it is pasted.
 */
const SAFE_URL = /^(https?:|mailto:|#)/i;

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const converter = new Marked({ gfm: true, breaks: false });

converter.use({
  renderer: {
    // Raw HTML in the draft (a <script> tag, an <img onerror=...>) becomes visible text.
    html: ({ text }) => escapeHtml(text),
    link({ href, title, tokens }) {
      const inner = this.parser.parseInline(tokens);
      if (!SAFE_URL.test(href.trim())) return inner; // keep the words, drop the link
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href.trim())}"${t}>${inner}</a>`;
    },
    // Pictures would point at files or sites the reader can't reach; keep the description.
    image: ({ text }) => escapeHtml(text),
  },
});

export function markdownToHtml(markdown: string): string {
  return converter.parse(markdown, { async: false });
}
