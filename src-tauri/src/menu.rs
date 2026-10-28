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
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuEvent, MenuItem, MenuItemKind, Submenu};
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
    /// `Some(initially_checked)` makes this a check item (a menu entry with a tick).
    pub check: Option<bool>,
}

impl Action {
    const fn new(
        id: &'static str,
        label: &'static str,
        accelerator: Option<&'static str>,
        menu: Option<&'static str>,
        needs_folder: bool,
    ) -> Self {
        Action {
            id,
            label,
            accelerator,
            menu,
            needs_folder,
            check: None,
        }
    }

    /// Turns this into a check item that starts ticked.
    const fn ticked(mut self) -> Self {
        self.check = Some(true);
        self
    }
}

/// Top-level menus, in display order.
const MENUS: [&str; 5] = ["File", "Edit", "View", "Settings", "Help"];

pub const ACTIONS: &[Action] = &[
    // ---- File ----
    Action::new("new", "New file", Some("CmdOrCtrl+N"), Some("File"), true),
    Action::new("open", "Open", Some("CmdOrCtrl+O"), Some("File"), true),
    Action::new(
        "change_folder",
        "Open/Set draft directory",
        Some("CmdOrCtrl+,"),
        Some("File"),
        true,
    ),
    Action::new("save", "Save", Some("CmdOrCtrl+S"), Some("File"), true),
    // Asks where to save a copy; the open draft then continues as that file.
    Action::new("save_as", "Save as…", Some("CmdOrCtrl+Shift+S"), Some("File"), true),
    // Closes the current note and shows a new blank one; it does not close the window.
    Action::new("close", "Close", Some("CmdOrCtrl+W"), Some("File"), true),
    // Quits through the window's normal close path, so unsaved work is still asked about. It
    // works on the welcome screen too, where there is nothing to save.
    Action::new("quit", "Quit", Some("CmdOrCtrl+Q"), Some("File"), false),
    // ---- Edit ----
    // Click-only, with no accelerator: Ctrl+Z and Ctrl+Y still belong to whatever has focus (the
    // editor, or a small text box such as rename), and a native accelerator would take them from the
    // text box and apply them to the editor.
    Action::new("undo", "Undo", None, Some("Edit"), true),
    Action::new("redo", "Redo", None, Some("Edit"), true),
    // Copies the selection (or the whole draft) as HTML plus the Markdown as plain text.
    Action::new("copy_html", "Copy as HTML", None, Some("Edit"), true),
    // ---- View ----
    // Shows a tick while the sidebar is visible; the frontend keeps the tick in step.
    Action::new("toggle_sidebar", "Show sidebar", Some("CmdOrCtrl+B"), Some("View"), true).ticked(),
    // Turns wrapping of long lines off and on; ticked while wrapping is on. No shortcut yet.
    Action::new("toggle_wrap", "Toggle wrap", None, Some("View"), true).ticked(),
    // Its label flips between "Enter full screen" and "Exit full screen" (`set_menu_text`). F11 is
    // the only shortcut without Ctrl.
    Action::new("fullscreen", "Enter full screen", Some("F11"), Some("View"), true),
    // ---- Settings ----
    // The settings file opens in the editor, which is hidden on the welcome screen, so opening it
    // waits for a draft directory. Reloading needs no editor, so it works from the start.
    // A read-only list of every setting; the file itself is still edited by hand.
    Action::new("show_settings", "Show settings", None, Some("Settings"), true),
    Action::new("open_settings", "Open settings file", None, Some("Settings"), true),
    Action::new("reload_settings", "Reload settings", None, Some("Settings"), false),
    // ---- Keyboard shortcut only, for now ----
    Action::new("quick_switcher", "Go to draft", Some("CmdOrCtrl+P"), None, true),
    Action::new("rename", "Rename draft", Some("CmdOrCtrl+Shift+R"), None, true),
    // ---- Help ----
    // Help is harmless without a notes folder, so it stays available on the welcome screen.
    // About is an in-app dialog rather than the native one: the native GTK dialog has no parent
    // window, so the window manager places it wherever it likes instead of centring it.
    Action::new("about", "About", None, Some("Help"), false),
    Action::new("shortcuts", "Keyboard shortcuts", None, Some("Help"), false),
];

fn tauri_error(e: tauri::Error) -> AppError {
    AppError::msg(e.to_string())
}

/// Builds the menubar from `ACTIONS`. Items that need a notes folder start greyed out; the
/// frontend enables them (`set_menu_enabled`) once it has one.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let mut menus: Vec<Submenu<R>> = Vec::new();
    for name in MENUS {
        let mut items: Vec<Box<dyn IsMenuItem<R>>> = Vec::new();
        for a in ACTIONS.iter().filter(|a| a.menu == Some(name)) {
            let enabled = !a.needs_folder;
            items.push(match a.check {
                Some(checked) => Box::new(CheckMenuItem::with_id(
                    app,
                    a.id,
                    a.label,
                    enabled,
                    checked,
                    a.accelerator,
                )?),
                None => Box::new(MenuItem::with_id(app, a.id, a.label, enabled, a.accelerator)?),
            });
        }

        let refs: Vec<&dyn IsMenuItem<R>> = items.iter().map(|i| i.as_ref()).collect();
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

#[derive(Serialize)]
pub struct AboutInfo {
    pub name: String,
    pub version: String,
    pub description: String,
}

/// What the About dialog shows. The version comes from the app's own package info, so it can't
/// drift from the build, and the description from Cargo.toml.
#[tauri::command]
pub fn get_about(app: AppHandle) -> AboutInfo {
    AboutInfo {
        name: app
            .config()
            .product_name
            .clone()
            .unwrap_or_else(|| "Draftwick".into()),
        version: app.package_info().version.to_string(),
        description: env!("CARGO_PKG_DESCRIPTION").into(),
    }
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
            match submenu.get(action.id) {
                Some(MenuItemKind::MenuItem(item)) => {
                    item.set_enabled(enabled).map_err(tauri_error)?;
                }
                Some(MenuItemKind::Check(item)) => {
                    item.set_enabled(enabled).map_err(tauri_error)?;
                }
                _ => {}
            }
        }
    }
    Ok(())
}

/// Changes the text of a plain menu item, e.g. "Enter full screen" to "Exit full screen".
#[tauri::command]
pub fn set_menu_text(app: AppHandle, id: String, text: String) -> AppResult<()> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    for top in menu.items().map_err(tauri_error)? {
        let MenuItemKind::Submenu(submenu) = top else {
            continue;
        };
        if let Some(MenuItemKind::MenuItem(item)) = submenu.get(id.as_str()) {
            item.set_text(text.as_str()).map_err(tauri_error)?;
        }
    }
    Ok(())
}

/// Sets the tick on a check item, e.g. "Show sidebar". The frontend calls this after anything that
/// changes the state, including the keyboard shortcut, so the tick always matches reality.
#[tauri::command]
pub fn set_menu_checked(app: AppHandle, id: String, checked: bool) -> AppResult<()> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    for top in menu.items().map_err(tauri_error)? {
        let MenuItemKind::Submenu(submenu) = top else {
            continue;
        };
        if let Some(MenuItemKind::Check(item)) = submenu.get(id.as_str()) {
            item.set_checked(checked).map_err(tauri_error)?;
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
        // As specified by the user: File > Open, Save, Close. Help > About, Keyboard shortcuts.
        assert_eq!(
            menu_labels("File"),
            ["New file", "Open", "Open/Set draft directory", "Save", "Save as…", "Close", "Quit"]
        );
        assert_eq!(menu_labels("Edit"), ["Undo", "Redo", "Copy as HTML"]);
        assert_eq!(menu_labels("View"), ["Show sidebar", "Toggle wrap", "Enter full screen"]);
        assert_eq!(menu_labels("Settings"), ["Show settings", "Open settings file", "Reload settings"]);
        assert_eq!(menu_labels("Help"), ["About", "Keyboard shortcuts"]);
    }

    #[test]
    fn accelerators_use_the_expected_syntax() {
        for action in ACTIONS {
            let Some(accel) = action.accelerator else {
                continue;
            };
            // A function key stands alone (F11); everything else is Ctrl/Cmd plus a key.
            let is_function_key = accel.len() >= 2
                && accel.starts_with('F')
                && accel[1..].chars().all(|c| c.is_ascii_digit());
            if is_function_key {
                continue;
            }
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
        // The Help and Settings items are menu-only, the Edit items are click-only on purpose (see
        // the Edit section of the table), and Toggle wrap has no shortcut yet; every other menu item
        // must also have a shortcut.
        for action in ACTIONS.iter().filter(|a| a.menu.is_some()) {
            let menu_only = matches!(action.menu, Some("Help") | Some("Settings") | Some("Edit"))
                || action.id == "toggle_wrap";
            if !menu_only {
                assert!(action.accelerator.is_some(), "{} has no shortcut", action.id);
            }
        }
    }

    #[test]
    fn only_help_reload_settings_and_quit_stay_enabled_without_a_draft_directory() {
        for action in ACTIONS {
            let stays_enabled =
                action.menu == Some("Help") || matches!(action.id, "reload_settings" | "quit");
            assert_eq!(!action.needs_folder, stays_enabled, "{}", action.id);
        }
    }

    #[test]
    fn only_the_sidebar_and_wrap_items_are_check_items() {
        for action in ACTIONS {
            let expected = matches!(action.id, "toggle_sidebar" | "toggle_wrap").then_some(true);
            assert_eq!(action.check, expected, "{}", action.id);
        }
    }
}
