mod config;
mod error;
mod notes;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            config::get_config,
            config::set_notes_dir,
            config::default_notes_dir,
            notes::list_notes,
            notes::read_note,
            notes::write_note,
            notes::create_note,
            notes::rename_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Draftwick");
}
