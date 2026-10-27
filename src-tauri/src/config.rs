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
    if let Some(dir) = &config.notes_dir {
        if !Path::new(dir).is_dir() {
            return Config::default();
        }
    }
    config
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
        .ok_or_else(|| AppError::msg("No notes folder is set"))
}

pub fn home_notes_dir() -> AppResult<PathBuf> {
    dirs::home_dir()
        .map(|home| home.join("Notes"))
        .ok_or_else(|| AppError::msg("Can't find your home folder"))
}

#[tauri::command]
pub fn get_config(app: AppHandle) -> AppResult<Config> {
    Ok(effective(load(&config_dir(&app)?)))
}

#[tauri::command]
pub fn set_notes_dir(app: AppHandle, path: String) -> AppResult<Config> {
    if path.trim().is_empty() {
        return Err(AppError::msg("Folder path is empty"));
    }
    fs::create_dir_all(&path)?;
    let config = Config {
        notes_dir: Some(path),
    };
    save(&config_dir(&app)?, &config)?;
    Ok(config)
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
        };
        assert_eq!(effective(config), Config::default());
    }

    #[test]
    fn existing_notes_dir_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let config = Config {
            notes_dir: Some(dir.path().to_string_lossy().into_owned()),
        };
        assert_eq!(effective(config.clone()), config);
    }
}
