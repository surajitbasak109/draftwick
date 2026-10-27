mod config;
mod error;
mod menu;
mod notes;
mod settings;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .menu(menu::build)
        .on_menu_event(menu::on_event)
        .invoke_handler(tauri::generate_handler![
            menu::get_actions,
            menu::get_about,
            menu::set_menu_enabled,
            menu::set_menu_checked,
            settings::get_settings,
            settings::check_settings,
            settings::prepare_settings_file,
            config::get_config,
            config::set_notes_dir,
            config::default_notes_dir,
            config::set_sidebar_visible,
            notes::is_in_notes_dir,
            notes::list_notes,
            notes::read_note,
            notes::write_note,
            notes::create_note,
            notes::rename_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Draftwick");
}
