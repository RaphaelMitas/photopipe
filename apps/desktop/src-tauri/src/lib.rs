mod bookmark;
mod roots;
mod swift_core;

use bookmark::Failure;
use roots::{Listing, Roots};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

/// Core requests and bookmark resolution can stall, so neither runs on the main
/// thread or a tokio worker.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("task panicked: {e}"))
}

#[tauri::command]
async fn core_request(
    method: String,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    blocking(move || swift_core::request(&method, params)).await?
}

#[derive(Serialize)]
struct OpenedRoot {
    path: String,
    #[serde(flatten)]
    result: serde_json::Value,
}

#[tauri::command]
async fn list_roots(roots: State<'_, Arc<Roots>>) -> Result<Vec<Listing>, Failure> {
    let roots = Arc::clone(&roots);
    Ok(blocking(move || roots.list()).await?)
}

/// Minting for a bare path only works under the sandbox if the panel granted it
/// this session.
#[tauri::command]
async fn open_root(roots: State<'_, Arc<Roots>>, path: String) -> Result<OpenedRoot, Failure> {
    let roots = Arc::clone(&roots);
    blocking(move || -> Result<_, Failure> {
        let live = match roots.reopen(&path) {
            Some(Ok(live)) => live,
            // the drive is gone, not the grant; keep "connect the drive" over "no folder at"
            Some(Err(failure @ Failure::Unplugged(_))) => return Err(failure),
            Some(Err(failure)) => bookmark::activate(&bookmark::mint(&path).map_err(|_| failure)?)?,
            None => bookmark::activate(&bookmark::mint(&path)?)?,
        };
        let path = live.path.clone();
        let result = swift_core::request("setRoot", Some(serde_json::json!({ "path": path })))?;
        roots.adopt(live);
        Ok(OpenedRoot { path, result })
    })
    .await?
}

#[tauri::command]
async fn pick_folder(app: AppHandle, title: String) -> Result<Option<String>, Failure> {
    blocking(move || choose_folder(&app, &title)).await?
}

#[cfg(desktop)]
fn choose_folder(app: &AppHandle, title: &str) -> Result<Option<String>, Failure> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app.dialog().file().set_title(title).blocking_pick_folder() else {
        return Ok(None);
    };
    Ok(Some(
        picked
            .into_path()
            .map_err(|e| Failure::Failed(e.to_string()))?
            .to_string_lossy()
            .into_owned(),
    ))
}

/// The dialog plugin cannot pick a folder on iOS, and copies files it picks into the app's caches.
#[cfg(mobile)]
fn choose_folder(_app: &AppHandle, _title: &str) -> Result<Option<String>, Failure> {
    Ok(swift_core::pick_folder())
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum PhotoSource {
    Files,
    Library,
}

#[tauri::command]
async fn pick_photos(
    app: AppHandle,
    title: String,
    from: PhotoSource,
) -> Result<Vec<String>, Failure> {
    blocking(move || choose_photos(&app, &title, from)).await?
}

/// The Mac picks from Files only; `features` keeps the library from being offered.
#[cfg(desktop)]
fn choose_photos(app: &AppHandle, title: &str, _from: PhotoSource) -> Result<Vec<String>, Failure> {
    use tauri_plugin_dialog::DialogExt;
    let listed = swift_core::request("imageExtensions", None).map_err(Failure::Failed)?;
    let extensions: Vec<&str> = listed["extensions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .collect();
    let picked = app
        .dialog()
        .file()
        .set_title(title)
        .add_filter("Photos", &extensions)
        .blocking_pick_files()
        .unwrap_or_default();
    picked
        .into_iter()
        .map(|file| {
            file.into_path()
                .map(|path| path.to_string_lossy().into_owned())
                .map_err(|e| Failure::Failed(e.to_string()))
        })
        .collect()
}

/// On iOS the dialog plugin copies what it picks from Files, and asks Photos for a plain image, not the raw.
#[cfg(mobile)]
fn choose_photos(
    _app: &AppHandle,
    _title: &str,
    from: PhotoSource,
) -> Result<Vec<String>, Failure> {
    Ok(swift_core::pick_photos(matches!(
        from,
        PhotoSource::Library
    )))
}

#[tauri::command]
async fn forget_root(roots: State<'_, Arc<Roots>>, path: String) -> Result<(), Failure> {
    let roots = Arc::clone(&roots);
    Ok(blocking(move || roots.forget(&path)).await?)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Features {
    updater: bool,
    zip_export: bool,
    photo_library: bool,
    reveal: bool,
}

#[tauri::command]
fn features() -> Features {
    Features {
        updater: cfg!(all(desktop, feature = "updater")),
        // zipping shells out to /usr/bin/zip, and the iOS save dialog only exports a copy
        zip_export: cfg!(desktop),
        photo_library: cfg!(mobile),
        // the opener plugin's reveal-in-folder is desktop-only
        reveal: cfg!(desktop),
    }
}

#[cfg(desktop)]
fn install_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{
        AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder, HELP_SUBMENU_ID,
        WINDOW_SUBMENU_ID,
    };
    use tauri::Emitter;
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
    let app_menu = SubmenuBuilder::new(app, "Photopipe")
        .about(Some(about))
        .separator();
    #[cfg(feature = "updater")]
    let app_menu = app_menu.item(
        &MenuItemBuilder::new("Check for Updates…")
            .id("check-updates")
            .build(app)?,
    );
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
    app.on_menu_event(|app, event| match event.id().as_ref() {
        "settings" => {
            let _ = app.emit("menu:settings", ());
        }
        #[cfg(feature = "updater")]
        "check-updates" => {
            let _ = app.emit("menu:check-updates", ());
        }
        _ => {}
    });
    Ok(())
}

/// `--core`: one JSON request per stdin line, one reply per stdout line, so the
/// bundle smoke test can drive the shipped binary without starting the app.
pub fn serve_core_on_stdin() {
    use std::io::BufRead;
    for line in std::io::stdin().lock().lines().map_while(Result::ok) {
        let request: serde_json::Value = serde_json::from_str(&line).unwrap_or_default();
        let method = request["method"].as_str().unwrap_or_default();
        let params = Some(request["params"].clone()).filter(|params| !params.is_null());
        let reply = match swift_core::request(method, params) {
            Ok(result) => serde_json::json!({ "ok": true, "result": result }),
            Err(error) => serde_json::json!({ "ok": false, "error": error }),
        };
        println!("{reply}");
    }
    swift_core::shutdown();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(all(desktop, feature = "updater"))]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .setup(|app| {
            app.manage(Arc::new(Roots::load(None)));
            // not in capabilities/: tauri-build rejects permissions for plugins the store build compiles out
            #[cfg(all(desktop, feature = "updater"))]
            app.add_capability(
                tauri::ipc::CapabilityBuilder::new("updater")
                    .window("main")
                    .permission("updater:default")
                    .permission("process:allow-restart"),
            )?;
            #[cfg(desktop)]
            install_menu(app)?;
            #[cfg(target_os = "ios")]
            if let Some(window) = app.get_webview_window("main") {
                window.with_webview(|webview| swift_core::fit_to_safe_area(webview.inner()))?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            core_request,
            list_roots,
            open_root,
            forget_root,
            pick_folder,
            pick_photos,
            features
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                swift_core::shutdown();
            }
        });
}
