/** A line ending as it appears in a file. */
export type Eol = "\n" | "\r\n" | "\r";

export interface EolInfo {
  /** The ending to write back. For a mixed file, the most common one. */
  eol: Eol;
  /** True when the file mixes endings, so writing it back cannot reproduce it exactly. */
  mixed: boolean;
}

/**
 * CodeMirror normalizes every line ending to "\n" while editing. Remembering what the file
 * used lets us write it back unchanged, instead of silently rewriting CRLF files as LF.
 */
export function detectEol(text: string): EolInfo {
  const crlf = text.split("\r\n").length - 1;
  const lf = text.split("\n").length - 1 - crlf;
  const cr = text.split("\r").length - 1 - crlf;

  const counts: [Eol, number][] = [
    ["\n", lf],
    ["\r\n", crlf],
    ["\r", cr],
  ];
  const present = counts.filter(([, n]) => n > 0);
  if (present.length === 0) return { eol: "\n", mixed: false };

  // On a tie the earlier entry wins, so LF is preferred over CRLF over CR.
  const [eol] = present.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  return { eol, mixed: present.length > 1 };
}

export function eolName(eol: Eol): string {
  return eol === "\r\n" ? "CRLF" : eol === "\r" ? "CR" : "LF";
}
