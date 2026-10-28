import type { Settings } from "./api";

/**
 * What the Settings dialog says about each setting: a plain-language name, what it does, what is
 * allowed and the default. The values themselves come from the app; this is only the explanation.
 * `tests/settingsInfo.test.mjs` fails if a setting known to settings.rs, or listed in
 * settings.example.jsonc, is missing from here (or the other way round).
 */
export interface SettingInfo {
  key: keyof Settings;
  title: string;
  description: string;
  allowed: string;
  /** The default, as shown. */
  defaultText: string;
  /** Turns the current value into the text shown for it. */
  show(value: Settings[keyof Settings]): string;
}

const plain = (v: unknown) => String(v);

export const SETTING_INFO: SettingInfo[] = [
  {
    key: "autosave_delay_ms",
    title: "Autosave delay",
    description: "How long to wait after you stop typing before a draft is saved, in milliseconds.",
    allowed: "500 to 30000",
    defaultText: "5000",
    show: plain,
  },
  {
    key: "theme",
    title: "Theme",
    description: "The colours. \"system\" follows your operating system's light or dark setting.",
    allowed: "\"system\", \"dark\" or \"light\"",
    defaultText: "system",
    show: plain,
  },
  {
    key: "font_size",
    title: "Font size",
    description: "The size of the text in the editor, in pixels.",
    allowed: "8 to 48",
    defaultText: "14",
    show: plain,
  },
  {
    key: "font_family",
    title: "Font",
    description: "The editor font: one font name that is installed on your computer.",
    allowed: "one font name, for example \"Fira Code\"",
    defaultText: "system monospace",
    show: (v) => (v === "" ? "system monospace" : String(v)),
  },
  {
    key: "wrap_column",
    title: "Wrap width",
    description: "How many characters wide a line is before it wraps. Only changes how text is shown.",
    allowed: "0 (the window edge), or 20 to 300",
    defaultText: "0 (the window edge)",
    show: (v) => (v === 0 ? "0 (the window edge)" : String(v)),
  },
  {
    key: "show_line_numbers",
    title: "Line numbers",
    description: "Show a line number beside each line.",
    allowed: "true or false",
    defaultText: "false",
    show: plain,
  },
  {
    key: "tab_size",
    title: "Tab width",
    description: "How wide a tab is, in characters.",
    allowed: "2, 4 or 8",
    defaultText: "4",
    show: plain,
  },
  {
    key: "translate_tabs_to_spaces",
    title: "Tab key types spaces",
    description: "Whether the Tab key types spaces (true) or a tab character (false).",
    allowed: "true or false",
    defaultText: "true",
    show: plain,
  },
];
