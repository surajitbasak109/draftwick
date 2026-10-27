//! User settings, kept in a file the user edits themselves (`settings.json` in the app's config
//! folder), in JSON with comments allowed.
//!
//! Defaults live here in the code and the file only holds overrides. The file is not created at
//! launch; it is created, with every setting shown as a commented-out default, the first time the
//! user chooses Settings > Open settings file. That opens it in Draftwick's own editor (the system
//! would hand a .json file to whatever the OS associates with it, often a web browser). The app
//! never rewrites it on its own: it only writes what the user saves, so their comments and layout
//! survive.
//!
//! A bad value never stops the app or touches the file: it is clamped or ignored, and the
//! problem is reported back so the frontend can say so.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

use crate::config::config_dir;
use crate::error::{AppError, AppResult};
use crate::notes::atomic_write;

const SETTINGS_FILE: &str = "settings.json";

/// How long to wait after the last keystroke before a draft is autosaved.
pub const AUTOSAVE_DELAY_DEFAULT_MS: u64 = 5_000;
pub const AUTOSAVE_DELAY_MIN_MS: u64 = 500;
pub const AUTOSAVE_DELAY_MAX_MS: u64 = 30_000;

/// What a new settings file contains: every setting, commented out at its default.
const DEFAULT_FILE: &str = r#"{
  // Draftwick settings.
  //
  // Only the settings you want to change need to be listed here; anything missing uses its
  // default. To change one, remove the "//" in front of it, edit the value, save this file, then
  // choose Settings > Reload settings in Draftwick.

  // How long to wait after you stop typing before a draft is saved, in milliseconds.
  // Every keystroke restarts the wait. Allowed range: 500 (half a second) to 30000 (30 seconds).
  // A longer wait means fewer writes; a shorter one means less is lost if the app or the
  // computer stops suddenly. Drafts are always saved when you switch drafts or quit.
  // Default: 5000 (5 seconds).
  // "autosave_delay_ms": 5000
}
"#;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Settings {
    pub autosave_delay_ms: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            autosave_delay_ms: AUTOSAVE_DELAY_DEFAULT_MS,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct LoadedSettings {
    pub settings: Settings,
    /// Things in the file that were ignored or adjusted, worded for the user, each starting with
    /// its line number. Empty when the file is fine (or there is no file).
    pub problems: Vec<String>,
    /// False when the file could not be understood at all (a syntax mistake, or unreadable). Its
    /// `settings` are then the defaults, and the frontend keeps the user's previous settings when
    /// reloading instead of applying them.
    pub valid: bool,
}

/// One thing wrong in the settings file, positioned so the editor can underline it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Diagnostic {
    /// Offsets into the text in UTF-16 code units (what CodeMirror uses); `to` is exclusive.
    pub from: usize,
    pub to: usize,
    /// 1-based line that `from` is on.
    pub line: usize,
    /// "error" for a syntax mistake (the file can't be used), "warning" for a value that was
    /// ignored or adjusted.
    pub severity: &'static str,
    pub message: String,
}

/// What reading a settings file tells us.
struct Analysis {
    settings: Settings,
    diagnostics: Vec<Diagnostic>,
    /// False when there is a syntax mistake.
    syntax_ok: bool,
}

/// Turns byte offsets in `text` into the positions a `Diagnostic` carries.
struct Positions<'a>(&'a str);

impl Positions<'_> {
    fn diagnostic(&self, from: usize, to: usize, severity: &'static str, message: String) -> Diagnostic {
        let text = self.0;
        let mut from = from.min(text.len());
        let mut to = to.clamp(from, text.len());
        while !text.is_char_boundary(from) {
            from -= 1;
        }
        while !text.is_char_boundary(to) {
            to += 1;
        }
        Diagnostic {
            from: text[..from].encode_utf16().count(),
            to: text[..to].encode_utf16().count(),
            line: text[..from].matches('\n').count() + 1,
            severity,
            message,
        }
    }
}

/// Start of the 1-based `line` as a byte offset.
fn line_start(text: &str, line: usize) -> usize {
    if line <= 1 {
        return 0;
    }
    text.match_indices('\n')
        .nth(line - 2)
        .map_or(text.len(), |(i, _)| i + 1)
}

/// Blanks out comments and trailing commas so what is left is plain JSON. Every blanked character
/// becomes spaces of the same UTF-8 length (newlines are kept), so a byte offset in the result is
/// the same offset in the original, and error positions can be mapped straight back. Also returns
/// where a `/* ... */` comment that is never closed starts.
fn sanitize(text: &str) -> (String, Option<usize>) {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut out = String::with_capacity(text.len());
    let mut unterminated = None;
    let blank = |out: &mut String, c: char| {
        if c == '\n' || c == '\r' {
            out.push(c);
        } else {
            out.extend(std::iter::repeat_n(' ', c.len_utf8()));
        }
    };

    let mut i = 0;
    while i < chars.len() {
        let (pos, c) = chars[i];
        let next = chars.get(i + 1).map(|&(_, n)| n);
        if c == '"' {
            // Copy a string through its closing quote (or the end of the line, if it has none:
            // the JSON parser reports that).
            out.push(c);
            i += 1;
            let mut escaped = false;
            while i < chars.len() {
                let d = chars[i].1;
                out.push(d);
                i += 1;
                if d == '\n' {
                    break;
                }
                if escaped {
                    escaped = false;
                } else if d == '\\' {
                    escaped = true;
                } else if d == '"' {
                    break;
                }
            }
        } else if c == '/' && next == Some('/') {
            while i < chars.len() && chars[i].1 != '\n' {
                blank(&mut out, chars[i].1);
                i += 1;
            }
        } else if c == '/' && next == Some('*') {
            let mut closed = false;
            blank(&mut out, '/');
            blank(&mut out, '*');
            i += 2;
            while i < chars.len() {
                if chars[i].1 == '*' && chars.get(i + 1).map(|&(_, n)| n) == Some('/') {
                    blank(&mut out, '*');
                    blank(&mut out, '/');
                    i += 2;
                    closed = true;
                    break;
                }
                blank(&mut out, chars[i].1);
                i += 1;
            }
            if !closed && unterminated.is_none() {
                unterminated = Some(pos);
            }
        } else {
            out.push(c);
            i += 1;
        }
    }

    // A comma directly before a closing brace or bracket is allowed (like in VS Code settings).
    let mut bytes = out.into_bytes();
    let mut in_string = false;
    let mut escaped = false;
    for i in 0..bytes.len() {
        let b = bytes[i];
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' || b == b'\n' {
                in_string = false;
            }
        } else if b == b'"' {
            in_string = true;
        } else if b == b',' {
            let next = bytes[i + 1..].iter().find(|c| !c.is_ascii_whitespace());
            if matches!(next, Some(b'}') | Some(b']')) {
                bytes[i] = b' ';
            }
        }
    }
    (String::from_utf8(bytes).expect("only ASCII bytes were changed"), unterminated)
}

/// A setting as it appears in the file: its name, and where the name and the value are (byte
/// offsets). Only called on text that already parsed as a JSON object.
struct Member {
    key: String,
    key_span: (usize, usize),
    value_span: (usize, usize),
}

fn members(json: &str) -> Vec<Member> {
    let bytes = json.as_bytes();
    let mut i = bytes.iter().position(|&b| b == b'{').map_or(bytes.len(), |p| p + 1);
    let mut found = Vec::new();
    let skip_space = |mut i: usize| {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        i
    };
    // Reads a string starting at the opening quote; returns the offset just past the closing one.
    let string_end = |start: usize| {
        let mut i = start + 1;
        while i < bytes.len() && bytes[i] != b'"' {
            i += if bytes[i] == b'\\' { 2 } else { 1 };
        }
        (i + 1).min(bytes.len())
    };

    loop {
        i = skip_space(i);
        while i < bytes.len() && bytes[i] == b',' {
            i = skip_space(i + 1);
        }
        if i >= bytes.len() || bytes[i] != b'"' {
            break;
        }
        let key_start = i;
        let key_end = string_end(i);
        let key = serde_json::from_str::<String>(&json[key_start..key_end]).unwrap_or_default();
        i = skip_space(key_end);
        if bytes.get(i) != Some(&b':') {
            break;
        }
        let value_start = skip_space(i + 1);
        let mut j = value_start;
        let mut depth = 0usize;
        while j < bytes.len() {
            match bytes[j] {
                b'"' => j = string_end(j) - 1,
                b'{' | b'[' => depth += 1,
                b'}' | b']' if depth == 0 => break,
                b'}' | b']' => depth -= 1,
                b',' if depth == 0 => break,
                _ => {}
            }
            j += 1;
        }
        let mut value_end = j.min(bytes.len());
        while value_end > value_start && bytes[value_end - 1].is_ascii_whitespace() {
            value_end -= 1;
        }
        found.push(Member {
            key,
            key_span: (key_start, key_end),
            value_span: (value_start, value_end),
        });
        i = j;
    }
    found
}

/// Wording for what `serde_json` reports, in terms of what the user probably did.
fn friendly(raw: &str, here: Option<char>, before: Option<char>) -> String {
    let word_char = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '+'));
    if raw.starts_with("control character") || raw.contains("while parsing a string") {
        "This text is missing its closing double quote (\").".into()
    } else if raw.starts_with("EOF while parsing an object") {
        "The closing brace } is missing at the end of the file.".into()
    } else if raw.starts_with("EOF while parsing a list") {
        "The closing bracket ] is missing at the end of the file.".into()
    } else if raw.starts_with("EOF while parsing") {
        "The file ends too early: a value is missing here.".into()
    } else if raw.starts_with("expected `:`") {
        "Expected a colon (:) between the setting name and its value.".into()
    } else if raw.starts_with("expected `,` or `}`") || raw.starts_with("expected `,` or `]`") {
        if word_char(here) && word_char(before) {
            "This isn't a valid value. Numbers can't have letters after them, and text must be in \
             double quotes."
                .into()
        } else {
            "Expected a comma here. Did you forget one after the previous setting?".into()
        }
    } else if raw.starts_with("key must be a string") {
        if here == Some(',') {
            "Unexpected comma: there are two commas in a row.".into()
        } else {
            "Setting names must be in double quotes, like \"autosave_delay_ms\".".into()
        }
    } else if raw.starts_with("expected value") {
        "Expected a value here. Text must be in double quotes (single quotes are not allowed).".into()
    } else if raw.starts_with("trailing characters") {
        "Unexpected text after the closing brace }.".into()
    } else {
        format!("This isn't valid here ({raw}).")
    }
}

/// The diagnostic for a syntax error from the JSON parser.
fn syntax_diagnostic(text: &str, json: &str, e: &serde_json::Error) -> Diagnostic {
    let positions = Positions(text);
    let raw = e.to_string();
    let raw = raw.split(" at line ").next().unwrap_or(&raw).to_string();

    // A string with no closing quote is reported at the start of the *next* line; point at the
    // string itself instead: from its opening quote to the end of its line.
    if raw.starts_with("control character") || raw.contains("while parsing a string") {
        let error_line = e.line().max(1);
        let line = if e.column() == 0 && error_line > 1 { error_line - 1 } else { error_line };
        let start = line_start(json, line);
        let end = json[start..].find('\n').map_or(json.len(), |n| start + n);
        let end = if json[start..end].ends_with('\r') { end - 1 } else { end };
        let mut open = None;
        let mut in_string = false;
        let mut escaped = false;
        for (i, c) in json[start..end].char_indices() {
            if in_string {
                if escaped {
                    escaped = false;
                } else if c == '\\' {
                    escaped = true;
                } else if c == '"' {
                    in_string = false;
                }
            } else if c == '"' {
                in_string = true;
                open = Some(start + i);
            }
        }
        if let (Some(open), true) = (open, in_string) {
            return positions.diagnostic(open, end, "error", friendly(&raw, None, None));
        }
    }

    let mut at = (line_start(json, e.line()) + e.column().saturating_sub(1)).min(json.len());
    if e.classify() == serde_json::error::Category::Eof || at >= json.len() {
        // Ran out of text: point at the last character.
        at = text.trim_end().char_indices().last().map_or(0, |(i, _)| i);
    }
    while !json.is_char_boundary(at) {
        at -= 1;
    }
    let here = json[at..].chars().next();
    let before = json[..at].chars().next_back();

    // Underline the whole token the error is on, not just one character of it.
    let stops = |c: char| c.is_whitespace() || ",:{}[]\"".contains(c);
    let (mut from, mut to) = (at, at);
    match here {
        Some('"') => {
            to = at + 1;
            let mut escaped = false;
            for (i, c) in json[at + 1..].char_indices() {
                to = at + 1 + i + c.len_utf8();
                if c == '\n' {
                    to -= 1;
                    break;
                }
                if escaped {
                    escaped = false;
                } else if c == '\\' {
                    escaped = true;
                } else if c == '"' {
                    break;
                }
            }
        }
        Some(c) => {
            to = at + c.len_utf8();
            if !stops(c) {
                for d in json[to..].chars().take_while(|&d| !stops(d)) {
                    to += d.len_utf8();
                }
            }
            // A value like 3000ms is one token even though the parser stopped partway through it.
            while let Some(p) = json[..from].chars().next_back().filter(|&p| !stops(p)) {
                from -= p.len_utf8();
            }
        }
        None => {}
    }
    positions.diagnostic(from, to, "error", friendly(&raw, here, before))
}

/// Reads a settings file: the settings it holds, and everything that is wrong with it. Nothing
/// here fails; a problem is reported and the affected setting gets a safe value.
fn analyze(text: &str) -> Analysis {
    let mut analysis = Analysis {
        settings: Settings::default(),
        diagnostics: Vec::new(),
        syntax_ok: true,
    };
    // An empty file (or one holding only whitespace) is just "no overrides".
    if text.trim().is_empty() {
        return analysis;
    }
    let positions = Positions(text);
    let (json, unterminated) = sanitize(text);

    if let Some(start) = unterminated {
        analysis.syntax_ok = false;
        analysis.diagnostics.push(positions.diagnostic(
            start,
            start + 2,
            "error",
            "This comment is never closed. Add */ at the end of it.".into(),
        ));
        return analysis;
    }

    let value: serde_json::Value = match serde_json::from_str(&json) {
        Ok(value) => value,
        Err(e) => {
            analysis.syntax_ok = false;
            analysis.diagnostics.push(syntax_diagnostic(text, &json, &e));
            return analysis;
        }
    };
    let Some(object) = value.as_object() else {
        analysis.syntax_ok = false;
        let start = json.len() - json.trim_start().len();
        analysis.diagnostics.push(positions.diagnostic(
            start,
            json.trim_end().len(),
            "error",
            "The settings file must be an object, like { ... }.".into(),
        ));
        return analysis;
    };

    let mut seen: Vec<String> = Vec::new();
    for Member { key, key_span: (key_from, key_to), value_span: (value_from, value_to) } in
        members(&json)
    {
        if seen.contains(&key) {
            analysis.diagnostics.push(positions.diagnostic(
                key_from,
                key_to,
                "warning",
                format!("\"{key}\" appears more than once; the last one is used."),
            ));
        }
        match key.as_str() {
            "autosave_delay_ms" => {
                // `object` holds the last value for a repeated key, so use it, not this member's.
                match object.get("autosave_delay_ms").and_then(serde_json::Value::as_f64) {
                    Some(n) if n.is_finite() => {
                        let wanted = n.round().max(0.0) as u64;
                        let clamped = wanted.clamp(AUTOSAVE_DELAY_MIN_MS, AUTOSAVE_DELAY_MAX_MS);
                        if clamped != wanted {
                            analysis.diagnostics.push(positions.diagnostic(
                                value_from,
                                value_to,
                                "warning",
                                format!(
                                    "autosave_delay_ms must be between {AUTOSAVE_DELAY_MIN_MS} and \
                                     {AUTOSAVE_DELAY_MAX_MS} ({wanted} was given); using {clamped}."
                                ),
                            ));
                        }
                        analysis.settings.autosave_delay_ms = clamped;
                    }
                    _ => analysis.diagnostics.push(positions.diagnostic(
                        value_from,
                        value_to,
                        "warning",
                        format!(
                            "autosave_delay_ms must be a number of milliseconds; using \
                             {AUTOSAVE_DELAY_DEFAULT_MS}."
                        ),
                    )),
                }
            }
            other => analysis.diagnostics.push(positions.diagnostic(
                key_from,
                key_to,
                "warning",
                format!("Unknown setting \"{other}\" was ignored."),
            )),
        }
        seen.push(key);
    }
    analysis
}

/// Reads settings from the text of a settings file. Never fails: anything wrong is reported in
/// `problems`, and the affected setting falls back to a safe value.
pub fn parse(text: &str) -> LoadedSettings {
    let analysis = analyze(text);
    LoadedSettings {
        settings: analysis.settings,
        problems: analysis
            .diagnostics
            .iter()
            .map(|d| format!("Line {}: {}", d.line, d.message))
            .collect(),
        valid: analysis.syntax_ok,
    }
}

/// Loads `settings.json` from `dir`. A missing file means "all defaults" and is not a problem.
pub fn load(dir: &Path) -> LoadedSettings {
    let path = dir.join(SETTINGS_FILE);
    match fs::read_to_string(&path) {
        Ok(text) => parse(&text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => LoadedSettings {
            settings: Settings::default(),
            problems: Vec::new(),
            valid: true,
        },
        Err(e) => LoadedSettings {
            settings: Settings::default(),
            problems: vec![format!("Couldn't read settings.json ({e}); using the defaults.")],
            valid: false,
        },
    }
}

/// Creates the settings file with the commented defaults if it does not exist yet. An existing
/// file is never touched.
fn ensure_file(dir: &Path) -> AppResult<PathBuf> {
    let path = dir.join(SETTINGS_FILE);
    if !path.exists() {
        fs::create_dir_all(dir)?;
        fs::write(&path, DEFAULT_FILE)?;
    }
    Ok(path)
}

/// Checks the text of the settings file as it is being edited, so the editor can underline
/// mistakes while the user types. It uses exactly the rules the app applies when it reads the file.
#[tauri::command]
pub fn check_settings(text: String) -> Vec<Diagnostic> {
    analyze(&text).diagnostics
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> AppResult<LoadedSettings> {
    Ok(load(&config_dir(&app)?))
}

/// True when `path` is exactly the settings file in `dir`. This is the only non-draft file the app
/// will read or write, so the match is on the exact path and nothing else.
fn is_settings_path(dir: &Path, path: &Path) -> bool {
    path == dir.join(SETTINGS_FILE)
}

pub fn is_settings_file(app: &AppHandle, path: &Path) -> bool {
    config_dir(app).is_ok_and(|dir| is_settings_path(&dir, path))
}

pub fn read_file(path: &Path) -> AppResult<String> {
    fs::read_to_string(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::InvalidData => AppError::msg("The settings file isn't valid UTF-8 text"),
        _ => e.into(),
    })
}

/// Saves the user's edits to the settings file. Like drafts, a file that was deleted while it was
/// open is reported as missing rather than silently recreated.
pub fn write_file(path: &Path, content: &str, create_if_missing: bool) -> AppResult<()> {
    if !create_if_missing && !path.exists() {
        return Err(AppError::Missing(format!(
            "\"{SETTINGS_FILE}\" no longer exists"
        )));
    }
    atomic_write(path, content.as_bytes())
}

/// Creates the settings file with the commented defaults if it does not exist yet, and returns its
/// path so the frontend can open it in the editor. This only ever runs because the user chose
/// the menu item.
#[tauri::command]
pub fn prepare_settings_file(app: AppHandle) -> AppResult<String> {
    let path = ensure_file(&config_dir(&app)?)?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn delay(text: &str) -> u64 {
        parse(text).settings.autosave_delay_ms
    }

    /// The part of `text` a diagnostic underlines (its offsets are in UTF-16 units).
    fn covered(text: &str, d: &Diagnostic) -> String {
        let units: Vec<u16> = text.encode_utf16().collect();
        String::from_utf16(&units[d.from..d.to]).unwrap()
    }

    /// The single diagnostic `text` produces; the test fails if there is not exactly one.
    fn only(text: &str) -> Diagnostic {
        let found = analyze(text).diagnostics;
        assert_eq!(found.len(), 1, "{text:?} gave {found:?}");
        found.into_iter().next().unwrap()
    }

    // ---- the settings themselves ----

    #[test]
    fn the_default_is_five_seconds() {
        assert_eq!(Settings::default().autosave_delay_ms, 5_000);
        assert_eq!(AUTOSAVE_DELAY_MIN_MS, 500);
        assert_eq!(AUTOSAVE_DELAY_MAX_MS, 30_000);
    }

    #[test]
    fn an_empty_or_blank_file_means_all_defaults() {
        for text in ["", "   \n  ", "{}"] {
            let loaded = parse(text);
            assert_eq!(loaded.settings, Settings::default(), "{text:?}");
            assert!(loaded.problems.is_empty(), "{text:?}");
            assert!(loaded.valid, "{text:?}");
        }
    }

    #[test]
    fn the_file_we_create_parses_to_the_defaults_with_no_problems() {
        let loaded = parse(DEFAULT_FILE);
        assert_eq!(loaded.settings, Settings::default());
        assert!(loaded.problems.is_empty(), "{:?}", loaded.problems);
        assert!(loaded.valid);
    }

    #[test]
    fn uncommenting_the_line_in_the_created_file_works() {
        let edited = DEFAULT_FILE.replace("// \"autosave_delay_ms\": 5000", "\"autosave_delay_ms\": 2000");
        let loaded = parse(&edited);
        assert_eq!(loaded.settings.autosave_delay_ms, 2_000);
        assert!(loaded.problems.is_empty(), "{:?}", loaded.problems);
    }

    #[test]
    fn a_value_in_range_is_used_including_both_limits() {
        for (text, ms) in [
            (r#"{ "autosave_delay_ms": 1500 }"#, 1_500),
            (r#"{ "autosave_delay_ms": 500 }"#, 500),
            (r#"{ "autosave_delay_ms": 30000 }"#, 30_000),
        ] {
            assert_eq!(delay(text), ms);
            assert!(analyze(text).diagnostics.is_empty(), "{text}");
        }
    }

    #[test]
    fn a_value_below_the_minimum_is_raised_and_the_value_is_underlined() {
        let text = "{\n  \"autosave_delay_ms\": 100\n}";
        let d = only(text);
        assert_eq!(parse(text).settings.autosave_delay_ms, 500);
        assert_eq!((d.severity, d.line, covered(text, &d).as_str()), ("warning", 2, "100"));
        assert!(d.message.contains("500") && d.message.contains("30000"), "{}", d.message);
        for low in ["0", "-5000"] {
            assert_eq!(delay(&format!(r#"{{ "autosave_delay_ms": {low} }}"#)), 500);
        }
    }

    #[test]
    fn a_value_above_the_maximum_is_lowered() {
        let text = r#"{ "autosave_delay_ms": 120000 }"#;
        assert_eq!(delay(text), 30_000);
        assert_eq!(covered(text, &only(text)), "120000");
    }

    #[test]
    fn something_that_is_not_a_number_falls_back_to_the_default() {
        for value in [r#""fast""#, "null", "true", "[1]"] {
            let text = format!(r#"{{ "autosave_delay_ms": {value} }}"#);
            assert_eq!(delay(&text), 5_000, "{text}");
            let d = only(&text);
            assert_eq!(covered(&text, &d), value, "{text}");
            assert_eq!(d.severity, "warning");
        }
    }

    #[test]
    fn a_fractional_value_is_rounded() {
        assert_eq!(delay(r#"{ "autosave_delay_ms": 2500.6 }"#), 2_501);
    }

    #[test]
    fn an_unknown_setting_is_reported_so_typos_are_noticed() {
        let text = r#"{ "autosave_delay": 1000, "autosave_delay_ms": 1000 }"#;
        let d = only(text);
        assert_eq!(covered(text, &d), r#""autosave_delay""#);
        assert!(d.message.contains("Unknown setting"));
        assert_eq!(delay(text), 1_000);
    }

    #[test]
    fn a_repeated_setting_is_reported_and_the_last_one_wins() {
        let text = r#"{ "autosave_delay_ms": 1000, "autosave_delay_ms": 2000 }"#;
        let d = only(text);
        assert_eq!(covered(text, &d), r#""autosave_delay_ms""#);
        assert!(d.from > 20, "it should point at the second one");
        assert_eq!(delay(text), 2_000);
    }

    // ---- what is allowed ----

    #[test]
    fn comments_and_trailing_commas_are_allowed() {
        let text = "{\n  // a line comment\n  \"autosave_delay_ms\": 3000, /* a block comment */\n}";
        let loaded = parse(text);
        assert_eq!(loaded.settings.autosave_delay_ms, 3_000);
        assert!(loaded.problems.is_empty(), "{:?}", loaded.problems);
        assert!(loaded.valid);
    }

    #[test]
    fn comment_text_that_looks_like_json_is_ignored() {
        let text = "{\n  // \"x\": {, [ \" unbalanced\n  /* \"y\": 1, } */\n  \"autosave_delay_ms\": 4000\n}";
        let loaded = parse(text);
        assert_eq!(loaded.settings.autosave_delay_ms, 4_000);
        assert!(loaded.problems.is_empty(), "{:?}", loaded.problems);
    }

    #[test]
    fn slashes_inside_a_string_are_not_a_comment() {
        let text = r#"{ "note": "http://example.com/*x*/", "autosave_delay_ms": 3000 }"#;
        let found = analyze(text);
        assert!(found.syntax_ok);
        assert_eq!(found.settings.autosave_delay_ms, 3_000);
        assert_eq!(found.diagnostics.len(), 1, "only the unknown setting: {:?}", found.diagnostics);
    }

    // ---- syntax mistakes: each is an error that underlines the right thing ----

    #[test]
    fn a_missing_comma_underlines_the_next_setting() {
        let text = "{\n  \"autosave_delay_ms\": 3000\n  \"other\": 1\n}";
        let d = only(text);
        assert_eq!((d.severity, d.line, covered(text, &d).as_str()), ("error", 3, "\"other\""));
        assert!(d.message.contains("comma"), "{}", d.message);
        let loaded = parse(text);
        assert!(!loaded.valid);
        assert_eq!(loaded.settings, Settings::default());
        assert!(loaded.problems[0].starts_with("Line 3:"), "{:?}", loaded.problems);
    }

    #[test]
    fn a_setting_name_without_quotes_is_reported() {
        let text = "{\n  autosave_delay_ms: 3000\n}";
        let d = only(text);
        assert_eq!((d.line, covered(text, &d).as_str()), (2, "autosave_delay_ms"));
        assert!(d.message.contains("double quotes"), "{}", d.message);
    }

    #[test]
    fn a_missing_opening_quote_is_reported_like_an_unquoted_name() {
        let text = "{\n  autosave_delay_ms\": 3000\n}";
        let d = only(text);
        assert_eq!(d.line, 2);
        assert!(d.message.contains("double quotes"), "{}", d.message);
    }

    #[test]
    fn a_missing_closing_quote_underlines_the_unfinished_text() {
        let text = "{\n  \"autosave_delay_ms: 3000\n}";
        let d = only(text);
        assert_eq!((d.severity, d.line), ("error", 2));
        assert_eq!(covered(text, &d), "\"autosave_delay_ms: 3000");
        assert!(d.message.contains("closing double quote"), "{}", d.message);

        let text = "{\n  \"k\": 1,\n  \"autosave_delay_ms\": \"abc\n}";
        let d = only(text);
        assert_eq!((d.line, covered(text, &d).as_str()), (3, "\"abc"));
    }

    #[test]
    fn single_quotes_are_not_allowed() {
        let text = "{ 'autosave_delay_ms': 1000 }";
        let d = only(text);
        assert_eq!(covered(text, &d), "'autosave_delay_ms'");
        assert!(d.message.contains("double quotes"), "{}", d.message);
    }

    #[test]
    fn a_missing_colon_is_reported() {
        let text = "{ \"autosave_delay_ms\" 1000 }";
        let d = only(text);
        assert_eq!(covered(text, &d), "1000");
        assert!(d.message.contains("colon"), "{}", d.message);
    }

    #[test]
    fn a_value_with_letters_after_a_number_is_reported_as_one_token() {
        let text = "{ \"autosave_delay_ms\": 3000ms }";
        let d = only(text);
        assert_eq!(covered(text, &d), "3000ms");
        assert!(d.message.contains("valid value"), "{}", d.message);
    }

    #[test]
    fn an_empty_value_is_reported() {
        let text = "{ \"autosave_delay_ms\": }";
        let d = only(text);
        assert!(d.message.contains("Expected a value"), "{}", d.message);
    }

    #[test]
    fn two_commas_in_a_row_are_reported() {
        let text = "{ \"autosave_delay_ms\": 1000,, \"x\": 1 }";
        let d = only(text);
        assert_eq!(covered(text, &d), ",");
        assert!(d.message.contains("two commas"), "{}", d.message);
    }

    #[test]
    fn a_missing_closing_brace_points_at_the_end() {
        let text = "{\n  \"autosave_delay_ms\": 3000\n";
        let d = only(text);
        assert!(d.message.contains("closing brace"), "{}", d.message);
        assert!(d.to <= text.encode_utf16().count());
        assert_eq!(d.line, 2);
    }

    #[test]
    fn text_after_the_closing_brace_is_reported() {
        let text = "{ \"autosave_delay_ms\": 3000 } oops";
        let d = only(text);
        assert_eq!(covered(text, &d), "oops");
    }

    #[test]
    fn a_comment_that_is_never_closed_is_reported() {
        let text = "{\n  /* oops\n  \"autosave_delay_ms\": 3000\n}";
        let d = only(text);
        assert_eq!((d.line, covered(text, &d).as_str()), (2, "/*"));
        assert!(d.message.contains("*/"), "{}", d.message);
    }

    #[test]
    fn a_file_that_is_not_an_object_is_reported() {
        let loaded = parse("[1, 2, 3]");
        assert!(!loaded.valid);
        assert_eq!(loaded.settings, Settings::default());
        assert_eq!(loaded.problems.len(), 1);
    }

    #[test]
    fn only_syntax_errors_make_the_file_invalid_warnings_do_not() {
        assert!(parse(r#"{ "autosave_delay_ms": 100 }"#).valid);
        assert!(parse(r#"{ "nope": 1 }"#).valid);
        assert!(!parse(r#"{ "autosave_delay_ms": }"#).valid);
    }

    // ---- positions stay right whatever the text contains ----

    #[test]
    fn positions_are_in_utf16_units_even_after_accents_and_emoji() {
        for before in ["é", "日本", "😀", "a😀é"] {
            let text = format!("{{ \"{before}\": 1 \"b\": 2 }}");
            let d = only(&text);
            assert_eq!(covered(&text, &d), "\"b\"", "before = {before}");
        }
        // an emoji counts as two UTF-16 units, so the offset is one more than the char count
        let text = "{ \"😀\": 1 \"b\": 2 }";
        let d = only(text);
        let chars_before = text.chars().take_while(|&c| c != 'b').count() - 1;
        assert_eq!(d.from, chars_before + 1);
    }

    #[test]
    fn comments_with_non_ascii_text_do_not_shift_positions() {
        let text = "// é ü 日本 😀\n{ \"autosave_delay_ms\": 1000 \"b\": 2 }";
        let d = only(text);
        assert_eq!((d.line, covered(text, &d).as_str()), (2, "\"b\""));
    }

    #[test]
    fn windows_line_endings_are_handled() {
        let text = "{\r\n  \"autosave_delay_ms\": 3000\r\n  \"other\": 1\r\n}";
        let d = only(text);
        assert_eq!((d.line, covered(text, &d).as_str()), (3, "\"other\""));
        let text = "{\r\n  \"autosave_delay_ms: 3000\r\n}";
        let d = only(text);
        assert_eq!(covered(text, &d), "\"autosave_delay_ms: 3000");
    }

    #[test]
    fn blanking_comments_never_changes_the_length_in_bytes() {
        for text in [
            "// é\n{}",
            "/* 日本\n😀 */ { \"a\": 1, }",
            "{ \"é\": \"//\", /* x */ }",
            DEFAULT_FILE,
        ] {
            assert_eq!(sanitize(text).0.len(), text.len(), "{text:?}");
        }
    }

    #[test]
    fn every_diagnostic_stays_inside_the_text() {
        for text in [
            "{", "}", "{\"", "{\"a", "{\"a\"", "{\"a\":", "{\"a\": \"", "{ \"a\": 1,, }", "/*", "//", "[",
            "\"", "{ 'é': 1", "{ \"é\": 1 \"😀\"", "{\n\n\n", "😀", "{ /* 😀",
        ] {
            let len = text.encode_utf16().count();
            for d in analyze(text).diagnostics {
                assert!(d.from <= d.to && d.to <= len, "{text:?}: {d:?}");
                assert!(d.line >= 1, "{text:?}: {d:?}");
            }
        }
    }

    // ---- reading and writing the file ----

    #[test]
    fn a_missing_file_is_not_a_problem() {
        let dir = tempfile::tempdir().unwrap();
        let loaded = load(dir.path());
        assert_eq!(loaded.settings, Settings::default());
        assert!(loaded.problems.is_empty());
        assert!(loaded.valid);
        assert!(!dir.path().join(SETTINGS_FILE).exists(), "loading must not create the file");
    }

    #[test]
    fn load_reads_the_file_from_the_config_folder() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(SETTINGS_FILE), r#"{ "autosave_delay_ms": 7000 }"#).unwrap();
        assert_eq!(load(dir.path()).settings.autosave_delay_ms, 7_000);
    }

    #[test]
    fn only_the_exact_settings_path_counts_as_the_settings_file() {
        let dir = Path::new("/home/u/.config/draftwick");
        assert!(is_settings_path(dir, &dir.join("settings.json")));
        assert!(!is_settings_path(dir, &dir.join("config.json")));
        assert!(!is_settings_path(dir, &dir.join("sub").join("settings.json")));
        assert!(!is_settings_path(dir, Path::new("/home/u/settings.json")));
        assert!(!is_settings_path(dir, Path::new("/etc/passwd")));
        // a path that merely resolves to the file does not count
        assert!(!is_settings_path(dir, &dir.join("..").join("draftwick-old").join("settings.json")));
    }

    #[test]
    fn saving_the_settings_file_works_and_never_resurrects_a_deleted_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = ensure_file(dir.path()).unwrap();

        write_file(&path, "{ \"autosave_delay_ms\": 4000 }", false).unwrap();
        assert_eq!(read_file(&path).unwrap(), "{ \"autosave_delay_ms\": 4000 }");
        assert!(!dir.path().join("settings.json.tmp").exists());

        fs::remove_file(&path).unwrap();
        let err = write_file(&path, "{}", false).unwrap_err();
        assert!(matches!(err, AppError::Missing(_)), "got {err:?}");
        assert!(!path.exists());

        write_file(&path, "{}", true).unwrap();
        assert_eq!(read_file(&path).unwrap(), "{}");
    }

    #[test]
    fn creating_the_file_never_overwrites_the_users_edits() {
        let dir = tempfile::tempdir().unwrap();
        let path = ensure_file(dir.path()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), DEFAULT_FILE);

        fs::write(&path, r#"{ "autosave_delay_ms": 9000 }"#).unwrap();
        ensure_file(dir.path()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), r#"{ "autosave_delay_ms": 9000 }"#);
    }
}
