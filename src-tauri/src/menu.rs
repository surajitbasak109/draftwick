//! The native menubar, and the single table of actions behind it.
//!
//! Every user-facing action lives in `ACTIONS`. Rust builds the menu from it, and the frontend
//! reads the same table (`get_actions`) to bind keys and to list them under Help > Keyboard
//! shortcuts, so a menu item and its shortcut can never describe different things.
//!
//! Each shortcut has exactly one owner, which is what keeps it from firing twice:
//! - an action with a `menu` gets a native accelerator, handled by the menu;
//! - an action without one is bound by the frontend, until it is given a menu item.

use serde::Serialize;
use tauri::menu::{
    AboutMetadata, IsMenuItem, Menu, MenuEvent, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu,
};
use tauri::{AppHandle, Emitter, Runtime};

use crate::error::{AppError, AppResult};

/// Name of the frontend event that carries the id of a clicked menu item.
const MENU_EVENT: &str = "menu-action";

pub struct Action {
    pub id: &'static str,
    pub label: &'static str,
    /// Accelerator in Tauri's syntax, e.g. "CmdOrCtrl+Shift+R". `None` means no shortcut.
    pub accelerator: Option<&'static str>,
    /// The native menu that shows this action. `None` means keyboard shortcut only, for now.
    pub menu: Option<&'static str>,
    /// Needs a notes folder to exist, so it is greyed out on the welcome screen.
    pub needs_folder: bool,
}

/// Top-level menus, in display order.
const MENUS: [&str; 2] = ["File", "Help"];

pub const ACTIONS: &[Action] = &[
    Action {
        id: "new",
        label: "New note",
        accelerator: Some("CmdOrCtrl+N"),
        menu: None,
        needs_folder: true,
    },
    Action {
        id: "open",
        label: "Open",
        accelerator: Some("CmdOrCtrl+O"),
        menu: Some("File"),
        needs_folder: true,
    },
    Action {
        id: "save",
        label: "Save",
        accelerator: Some("CmdOrCtrl+S"),
        menu: Some("File"),
        needs_folder: true,
    },
    // Closes the current note and shows a new blank one; it does not close the window.
    Action {
        id: "close",
        label: "Close",
        accelerator: Some("CmdOrCtrl+W"),
        menu: Some("File"),
        needs_folder: true,
    },
    Action {
        id: "quick_switcher",
        label: "Go to note",
        accelerator: Some("CmdOrCtrl+P"),
        menu: None,
        needs_folder: true,
    },
    Action {
        id: "toggle_sidebar",
        label: "Toggle sidebar",
        accelerator: Some("CmdOrCtrl+B"),
        menu: None,
        needs_folder: true,
    },
    Action {
        id: "change_folder",
        label: "Change notes folder",
        accelerator: Some("CmdOrCtrl+,"),
        menu: None,
        needs_folder: true,
    },
    Action {
        id: "rename",
        label: "Rename note",
        accelerator: Some("CmdOrCtrl+Shift+R"),
        menu: None,
        needs_folder: true,
    },
    // Help is harmless without a notes folder, so it stays available on the welcome screen.
    Action {
        id: "shortcuts",
        label: "Keyboard shortcuts",
        accelerator: None,
        menu: Some("Help"),
        needs_folder: false,
    },
];

fn tauri_error(e: tauri::Error) -> AppError {
    AppError::msg(e.to_string())
}

/// Builds the menubar from `ACTIONS`. Items that need a notes folder start greyed out; the
/// frontend enables them (`set_menu_enabled`) once it has one.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let mut menus: Vec<Submenu<R>> = Vec::new();
    for name in MENUS {
        let items = ACTIONS
            .iter()
            .filter(|a| a.menu == Some(name))
            .map(|a| MenuItem::with_id(app, a.id, a.label, !a.needs_folder, a.accelerator))
            .collect::<tauri::Result<Vec<_>>>()?;

        // About is a native dialog; it is not an action the frontend has to handle.
        let about = if name == "Help" {
            Some(PredefinedMenuItem::about(
                app,
                Some("About"),
                Some(AboutMetadata {
                    name: Some("Draftwick".into()),
                    version: Some(env!("CARGO_PKG_VERSION").into()),
                    comments: Some("A fast, minimal editor for Markdown and text drafts.".into()),
                    ..Default::default()
                }),
            )?)
        } else {
            None
        };

        let mut refs: Vec<&dyn IsMenuItem<R>> = Vec::new();
        if let Some(about) = &about {
            refs.push(about);
        }
        refs.extend(items.iter().map(|i| i as &dyn IsMenuItem<R>));
        menus.push(Submenu::with_items(app, name, true, &refs)?);
    }

    let refs: Vec<&dyn IsMenuItem<R>> = menus.iter().map(|m| m as &dyn IsMenuItem<R>).collect();
    Menu::with_items(app, &refs)
}

/// Forwards a clicked menu item to the frontend, which runs the same function as the shortcut.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().as_ref();
    if ACTIONS.iter().any(|a| a.id == id) {
        #[cfg(debug_assertions)]
        eprintln!("[menu] {id}");
        let _ = app.emit(MENU_EVENT, id);
    }
}

#[derive(Serialize)]
pub struct ActionInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub accelerator: Option<&'static str>,
    pub menu: Option<&'static str>,
    pub needs_folder: bool,
}

#[tauri::command]
pub fn get_actions() -> Vec<ActionInfo> {
    ACTIONS
        .iter()
        .map(|a| ActionInfo {
            id: a.id,
            label: a.label,
            accelerator: a.accelerator,
            menu: a.menu,
            needs_folder: a.needs_folder,
        })
        .collect()
}

/// Greys menu items that need a notes folder in or out. Called with `false` while the welcome
/// screen is showing, and `true` once the app is usable.
#[tauri::command]
pub fn set_menu_enabled(app: AppHandle, enabled: bool) -> AppResult<()> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    for top in menu.items().map_err(tauri_error)? {
        let MenuItemKind::Submenu(submenu) = top else {
            continue;
        };
        for action in ACTIONS.iter().filter(|a| a.menu.is_some() && a.needs_folder) {
            if let Some(MenuItemKind::MenuItem(item)) = submenu.get(action.id) {
                item.set_enabled(enabled).map_err(tauri_error)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn menu_labels(menu: &str) -> Vec<&'static str> {
        ACTIONS
            .iter()
            .filter(|a| a.menu == Some(menu))
            .map(|a| a.label)
            .collect()
    }

    #[test]
    fn ids_are_unique() {
        let ids: HashSet<_> = ACTIONS.iter().map(|a| a.id).collect();
        assert_eq!(ids.len(), ACTIONS.len());
    }

    #[test]
    fn no_two_actions_share_a_shortcut() {
        let keys: Vec<_> = ACTIONS.iter().filter_map(|a| a.accelerator).collect();
        let unique: HashSet<_> = keys.iter().collect();
        assert_eq!(unique.len(), keys.len(), "duplicate accelerator in {keys:?}");
    }

    #[test]
    fn every_action_is_in_a_known_menu_or_has_none() {
        for action in ACTIONS {
            if let Some(menu) = action.menu {
                assert!(MENUS.contains(&menu), "{} is in unknown menu {menu}", action.id);
            }
        }
    }

    #[test]
    fn menu_contents_match_the_spec() {
        // As specified by the user: File > Open, Save, Close. Help > About (native), Keyboard
        // shortcuts.
        assert_eq!(menu_labels("File"), ["Open", "Save", "Close"]);
        assert_eq!(menu_labels("Help"), ["Keyboard shortcuts"]);
    }

    #[test]
    fn accelerators_use_the_expected_syntax() {
        for action in ACTIONS {
            let Some(accel) = action.accelerator else {
                continue;
            };
            let parts: Vec<&str> = accel.split('+').collect();
            assert_eq!(parts[0], "CmdOrCtrl", "{}: {accel}", action.id);
            let (key, modifiers) = parts.split_last().unwrap();
            assert!(!key.is_empty(), "{}: {accel}", action.id);
            for m in &modifiers[1..] {
                assert_eq!(*m, "Shift", "{}: unsupported modifier in {accel}", action.id);
            }
        }
    }

    #[test]
    fn items_in_a_menu_that_have_no_shortcut_are_still_reachable() {
        // Keyboard shortcuts is menu-only; every other menu item must also have a shortcut.
        for action in ACTIONS.iter().filter(|a| a.menu.is_some()) {
            if action.id != "shortcuts" {
                assert!(action.accelerator.is_some(), "{} has no shortcut", action.id);
            }
        }
    }

    #[test]
    fn only_help_stays_enabled_without_a_notes_folder() {
        for action in ACTIONS {
            assert_eq!(!action.needs_folder, action.id == "shortcuts", "{}", action.id);
        }
    }
}
