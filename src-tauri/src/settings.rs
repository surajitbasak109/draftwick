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
use tauri::{AppHandle, Manager};

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
    /// Things in the file that were ignored or adjusted, worded for the user. Empty when the file
    /// is fine (or there is no file).
    pub problems: Vec<String>,
}

/// Reads settings from the text of a settings file. Never fails: anything wrong is reported in
/// `problems` and the affected setting falls back to a safe value.
pub fn parse(text: &str) -> LoadedSettings {
    let mut settings = Settings::default();
    let mut problems = Vec::new();

    // An empty file (or one holding only whitespace) is just "no overrides".
    if text.trim().is_empty() {
        return LoadedSettings { settings, problems };
    }

    let value: serde_json::Value = match json5::from_str(text) {
        Ok(value) => value,
        Err(e) => {
            problems.push(format!(
                "Couldn't read settings.json ({e}); using the defaults."
            ));
            return LoadedSettings { settings, problems };
        }
    };
    let Some(object) = value.as_object() else {
        problems.push("settings.json must be an object like { ... }; using the defaults.".into());
        return LoadedSettings { settings, problems };
    };

    for (key, value) in object {
        match key.as_str() {
            "autosave_delay_ms" => match value.as_f64() {
                Some(n) if n.is_finite() => {
                    let wanted = n.round().max(0.0) as u64;
                    let clamped = wanted.clamp(AUTOSAVE_DELAY_MIN_MS, AUTOSAVE_DELAY_MAX_MS);
                    if clamped != wanted {
                        problems.push(format!(
                            "autosave_delay_ms must be between {AUTOSAVE_DELAY_MIN_MS} and \
                             {AUTOSAVE_DELAY_MAX_MS} ({wanted} was given); using {clamped}."
                        ));
                    }
                    settings.autosave_delay_ms = clamped;
                }
                _ => problems.push(format!(
                    "autosave_delay_ms must be a number of milliseconds; using {AUTOSAVE_DELAY_DEFAULT_MS}."
                )),
            },
            other => problems.push(format!("Unknown setting \"{other}\" was ignored.")),
        }
    }
    LoadedSettings { settings, problems }
}

/// Loads `settings.json` from `dir`. A missing file means "all defaults" and is not a problem.
pub fn load(dir: &Path) -> LoadedSettings {
    let path = dir.join(SETTINGS_FILE);
    match fs::read_to_string(&path) {
        Ok(text) => parse(&text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => LoadedSettings {
            settings: Settings::default(),
            problems: Vec::new(),
        },
        Err(e) => LoadedSettings {
            settings: Settings::default(),
            problems: vec![format!("Couldn't read settings.json ({e}); using the defaults.")],
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

fn config_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("Can't find the config folder: {e}")))
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
        }
    }

    #[test]
    fn the_file_we_create_parses_to_the_defaults_with_no_problems() {
        let loaded = parse(DEFAULT_FILE);
        assert_eq!(loaded.settings, Settings::default());
        assert!(loaded.problems.is_empty(), "{:?}", loaded.problems);
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
        assert_eq!(delay(r#"{ "autosave_delay_ms": 1500 }"#), 1_500);
        assert_eq!(delay(r#"{ "autosave_delay_ms": 500 }"#), 500);
        assert_eq!(delay(r#"{ "autosave_delay_ms": 30000 }"#), 30_000);
        assert!(parse(r#"{ "autosave_delay_ms": 500 }"#).problems.is_empty());
        assert!(parse(r#"{ "autosave_delay_ms": 30000 }"#).problems.is_empty());
    }

    #[test]
    fn a_value_below_the_minimum_is_raised_and_reported() {
        let loaded = parse(r#"{ "autosave_delay_ms": 100 }"#);
        assert_eq!(loaded.settings.autosave_delay_ms, 500);
        assert_eq!(loaded.problems.len(), 1);
        assert!(loaded.problems[0].contains("autosave_delay_ms"));
        assert_eq!(delay(r#"{ "autosave_delay_ms": 0 }"#), 500);
        assert_eq!(delay(r#"{ "autosave_delay_ms": -5000 }"#), 500);
    }

    #[test]
    fn a_value_above_the_maximum_is_lowered_and_reported() {
        let loaded = parse(r#"{ "autosave_delay_ms": 120000 }"#);
        assert_eq!(loaded.settings.autosave_delay_ms, 30_000);
        assert_eq!(loaded.problems.len(), 1);
    }

    #[test]
    fn something_that_is_not_a_number_falls_back_to_the_default() {
        for text in [
            r#"{ "autosave_delay_ms": "fast" }"#,
            r#"{ "autosave_delay_ms": null }"#,
            r#"{ "autosave_delay_ms": true }"#,
        ] {
            let loaded = parse(text);
            assert_eq!(loaded.settings.autosave_delay_ms, 5_000, "{text}");
            assert_eq!(loaded.problems.len(), 1, "{text}");
        }
    }

    #[test]
    fn a_fractional_value_is_rounded() {
        assert_eq!(delay(r#"{ "autosave_delay_ms": 2500.6 }"#), 2_501);
    }

    #[test]
    fn comments_and_trailing_commas_are_allowed() {
        let text = r#"{
            // a line comment
            "autosave_delay_ms": 3000, /* a block comment */
        }"#;
        let loaded = parse(text);
        assert_eq!(loaded.settings.autosave_delay_ms, 3_000);
        assert!(loaded.problems.is_empty(), "{:?}", loaded.problems);
    }

    #[test]
    fn broken_syntax_uses_the_defaults_and_says_so() {
        let loaded = parse("{ \"autosave_delay_ms\": ");
        assert_eq!(loaded.settings, Settings::default());
        assert_eq!(loaded.problems.len(), 1);
        assert!(loaded.problems[0].contains("settings.json"));
    }

    #[test]
    fn a_file_that_is_not_an_object_is_reported() {
        let loaded = parse("[1, 2, 3]");
        assert_eq!(loaded.settings, Settings::default());
        assert_eq!(loaded.problems.len(), 1);
    }

    #[test]
    fn an_unknown_setting_is_ignored_but_reported_so_typos_are_noticed() {
        let loaded = parse(r#"{ "autosave_delay": 1000, "autosave_delay_ms": 1000 }"#);
        assert_eq!(loaded.settings.autosave_delay_ms, 1_000);
        assert_eq!(loaded.problems.len(), 1);
        assert!(loaded.problems[0].contains("autosave_delay"));
    }

    #[test]
    fn a_missing_file_is_not_a_problem() {
        let dir = tempfile::tempdir().unwrap();
        let loaded = load(dir.path());
        assert_eq!(loaded.settings, Settings::default());
        assert!(loaded.problems.is_empty());
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
        let dir = Path::new("/home/u/.config/dev.draftwick.app");
        assert!(is_settings_path(dir, &dir.join("settings.json")));
        assert!(!is_settings_path(dir, &dir.join("config.json")));
        assert!(!is_settings_path(dir, &dir.join("sub").join("settings.json")));
        assert!(!is_settings_path(dir, Path::new("/home/u/settings.json")));
        assert!(!is_settings_path(dir, Path::new("/etc/passwd")));
        // a path that merely resolves to the file does not count
        assert!(!is_settings_path(dir, &dir.join("..").join("dev.draftwick.app").join("settings.json")));
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
