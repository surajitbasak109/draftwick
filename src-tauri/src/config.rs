use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::notes::atomic_write;

const CONFIG_FILE: &str = "config.json";

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub notes_dir: Option<String>,
    /// Whether the sidebar was visible when the user last toggled it. `None` until they do, which
    /// the frontend treats as visible.
    #[serde(default)]
    pub sidebar_visible: Option<bool>,
}

/// A missing or corrupt config file is treated as "not configured yet".
pub fn load(dir: &Path) -> Config {
    fs::read_to_string(dir.join(CONFIG_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(dir: &Path, config: &Config) -> AppResult<()> {
    fs::create_dir_all(dir)?;
    let json = serde_json::to_string_pretty(config)?;
    atomic_write(&dir.join(CONFIG_FILE), json.as_bytes())
}

/// Reports a notes folder that no longer exists as unset, so the first-launch flow re-runs.
fn effective(config: Config) -> Config {
    let stale = matches!(&config.notes_dir, Some(dir) if !Path::new(dir).is_dir());
    if stale {
        Config {
            notes_dir: None,
            ..config
        }
    } else {
        config
    }
}

/// Loads the saved config, applies `change`, saves it, and returns it. Fields `change` does not
/// touch are kept, so changing one choice can't wipe another.
fn update(dir: &Path, change: impl FnOnce(&mut Config)) -> AppResult<Config> {
    let mut config = load(dir);
    change(&mut config);
    save(dir, &config)?;
    Ok(config)
}

fn config_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("Can't find the config folder: {e}")))
}

pub fn notes_dir(app: &AppHandle) -> AppResult<PathBuf> {
    effective(load(&config_dir(app)?))
        .notes_dir
        .map(PathBuf::from)
        .ok_or_else(|| AppError::msg("No draft directory is set"))
}

pub fn home_notes_dir() -> AppResult<PathBuf> {
    dirs::home_dir()
        .map(|home| home.join("Drafts"))
        .ok_or_else(|| AppError::msg("Can't find your home folder"))
}

#[tauri::command]
pub fn get_config(app: AppHandle) -> AppResult<Config> {
    Ok(effective(load(&config_dir(&app)?)))
}

#[tauri::command]
pub fn set_notes_dir(app: AppHandle, path: String) -> AppResult<Config> {
    if path.trim().is_empty() {
        return Err(AppError::msg("Draft directory path is empty"));
    }
    fs::create_dir_all(&path)?;
    update(&config_dir(&app)?, |config| config.notes_dir = Some(path))
}

/// Remembers whether the sidebar is shown, so the next launch looks the same.
#[tauri::command]
pub fn set_sidebar_visible(app: AppHandle, visible: bool) -> AppResult<()> {
    update(&config_dir(&app)?, |config| config.sidebar_visible = Some(visible)).map(|_| ())
}

#[tauri::command]
pub fn default_notes_dir() -> AppResult<String> {
    let dir = home_notes_dir()?;
    fs::create_dir_all(&dir)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_config_is_default() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()), Config::default());
    }

    #[test]
    fn config_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let config = Config {
            notes_dir: Some("/tmp/notes".into()),
            sidebar_visible: Some(false),
        };
        save(dir.path(), &config).unwrap();
        assert_eq!(load(dir.path()), config);
    }

    #[test]
    fn corrupt_config_is_default() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(CONFIG_FILE), "{ not json").unwrap();
        assert_eq!(load(dir.path()), Config::default());
    }

    #[test]
    fn stale_notes_dir_counts_as_unset() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("deleted");
        let config = Config {
            notes_dir: Some(gone.to_string_lossy().into_owned()),
            sidebar_visible: None,
        };
        assert_eq!(effective(config), Config::default());
    }

    #[test]
    fn stale_notes_dir_keeps_the_other_choices() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("deleted");
        let config = Config {
            notes_dir: Some(gone.to_string_lossy().into_owned()),
            sidebar_visible: Some(false),
        };
        let shown = effective(config);
        assert_eq!(shown.notes_dir, None);
        assert_eq!(shown.sidebar_visible, Some(false));
    }

    #[test]
    fn a_config_saved_before_the_sidebar_choice_existed_still_loads() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(CONFIG_FILE), r#"{ "notes_dir": "/tmp/x" }"#).unwrap();
        let config = load(dir.path());
        assert_eq!(config.notes_dir.as_deref(), Some("/tmp/x"));
        assert_eq!(config.sidebar_visible, None);
    }

    #[test]
    fn changing_one_choice_keeps_the_other() {
        let dir = tempfile::tempdir().unwrap();
        update(dir.path(), |c| c.notes_dir = Some("/tmp/drafts".into())).unwrap();
        update(dir.path(), |c| c.sidebar_visible = Some(false)).unwrap();
        let config = load(dir.path());
        assert_eq!(config.notes_dir.as_deref(), Some("/tmp/drafts"));
        assert_eq!(config.sidebar_visible, Some(false));

        update(dir.path(), |c| c.notes_dir = Some("/tmp/other".into())).unwrap();
        assert_eq!(load(dir.path()).sidebar_visible, Some(false));
    }

    #[test]
    fn the_default_draft_directory_is_called_drafts() {
        let dir = home_notes_dir().unwrap();
        assert_eq!(dir.file_name().unwrap(), "Drafts");
    }

    #[test]
    fn existing_notes_dir_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let config = Config {
            notes_dir: Some(dir.path().to_string_lossy().into_owned()),
            sidebar_visible: None,
        };
        assert_eq!(effective(config.clone()), config);
    }
}
