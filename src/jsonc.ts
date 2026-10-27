import { StreamLanguage } from "@codemirror/language";

/**
 * JSON with comments, for highlighting the settings file.
 *
 * CodeMirror's own JSON grammar does not know comments (it flags every comment character as a
 * syntax error), and the settings file is mostly comments, so this small tokenizer is used instead.
 * It highlights; it does not validate. The Rust side decides what the file means and reports
 * problems.
 *
 * Token names are standard highlight tags (see editor.ts for how they are coloured).
 */
interface State {
  /** Inside a /* ... *​/ comment that started on an earlier line. */
  inBlockComment: boolean;
}

export const jsonc = StreamLanguage.define<State>({
  name: "jsonc",
  startState: () => ({ inBlockComment: false }),

  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.match(/^.*?\*\//)) state.inBlockComment = false;
      else stream.skipToEnd();
      return "comment";
    }

    if (stream.eatSpace()) return null;

    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      if (!stream.match(/^.*?\*\//)) {
        state.inBlockComment = true;
        stream.skipToEnd();
      }
      return "comment";
    }

    if (stream.peek() === '"') {
      stream.next();
      let escaped = false;
      let ch: string | void;
      while ((ch = stream.next()) !== undefined) {
        if (ch === '"' && !escaped) break;
        escaped = !escaped && ch === "\\";
      }
      // A string followed by a colon is a property name; anything else is a value.
      return stream.match(/^\s*:/, false) ? "propertyName" : "string";
    }

    if (stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) return "number";
    if (stream.match(/^(true|false|null)\b/)) return "atom";
    if (stream.match(/^[{}[\]]/)) return "bracket";
    if (stream.match(/^[,:]/)) return "punctuation";

    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
  },
});
