mod files;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(files::Grants::load(dir.join("recent-files.json")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            files::pick_pdf,
            files::read_pdf,
            files::save_pdf,
            files::reveal_file,
            files::forget_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FormFlow");
}
