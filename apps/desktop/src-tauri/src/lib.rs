mod roots;
mod sidecar;

use roots::Roots;
use sidecar::Sidecar;
use std::sync::Arc;
use tauri::menu::{
    AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder, HELP_SUBMENU_ID,
    WINDOW_SUBMENU_ID,
};
use tauri::{Emitter, Manager};

// Blocking sidecar I/O runs on the dedicated blocking pool, never on the main
// thread or a tokio worker; the read timeout inside `request` bounds it.
#[tauri::command]
async fn core_request(
    state: tauri::State<'_, Arc<Sidecar>>,
    method: String,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let sidecar = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || sidecar.request(&method, params))
        .await
        .map_err(|e| format!("sidecar task panicked: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init());
    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .manage(Arc::new(Sidecar::new(Sidecar::default_bin())))
        .manage(Roots::default())
        .setup(|app| {
            let settings = MenuItemBuilder::new("Settings…")
                .id("settings")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;
            // Same sources the default menu reads, so the panel stays right
            // when the version moves and picks up copyright and publisher if
            // they are ever set in tauri.conf.json.
            let package = app.package_info();
            let bundle = &app.config().bundle;
            let about = AboutMetadataBuilder::new()
                .name(Some(package.name.clone()))
                .version(Some(package.version.to_string()))
                .copyright(bundle.copyright.clone())
                .authors(bundle.publisher.clone().map(|p| vec![p]))
                .build();
            #[allow(unused_mut)]
            let mut app_menu = SubmenuBuilder::new(app, "Photopipe")
                .about(Some(about))
                .separator();
            #[cfg(feature = "updater")]
            {
                let updates = MenuItemBuilder::new("Check for Updates…")
                    .id("check-updates")
                    .build(app)?;
                app_menu = app_menu.item(&updates);
            }
            let app_menu = app_menu
                .item(&settings)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            // Full screen lives here in every Mac app, and replacing the default
            // menu is what took it away.
            let view_menu = SubmenuBuilder::new(app, "View").fullscreen().build()?;
            // These two are handed to AppKit, which finds them by id and adds
            // the window list to one and the search field to the other. Build
            // them with `new` and the id is random, the lookup misses, and you
            // get inert menus that only look standard.
            let window_menu = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "Window")
                .minimize()
                .maximize()
                .separator()
                .close_window()
                .build()?;
            let help_menu = SubmenuBuilder::with_id(app, HELP_SUBMENU_ID, "Help").build()?;
            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
                .build()?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "settings" => {
                let _ = app.emit("menu:settings", ());
            }
            "check-updates" => {
                let _ = app.emit("menu:check-updates", ());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            core_request,
            roots::list_roots,
            roots::open_root,
            roots::remember_root
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<Arc<Sidecar>>().shutdown();
            }
        });
}
