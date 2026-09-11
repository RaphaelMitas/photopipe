mod bookmark;
mod roots;
mod sidecar;

use roots::RootEntry;
use serde::Serialize;
use sidecar::Sidecar;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::menu::{
    AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder, HELP_SUBMENU_ID,
    WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

// Blocking sidecar I/O runs on the dedicated blocking pool, never on the main
// thread or a tokio worker; the read timeout inside `request` bounds it.
#[tauri::command]
async fn core_request(
    state: State<'_, Arc<Sidecar>>,
    method: String,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let sidecar = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || sidecar.request(&method, params))
        .await
        .map_err(|e| format!("sidecar task panicked: {e}"))?
}

/// The shell owns consent: the roots file and the access it currently holds.
/// The core inherits whatever access is live here when it is asked for a root.
struct Roots {
    file: PathBuf,
    access: Mutex<Option<bookmark::Access>>,
}

#[derive(Serialize)]
struct RootError {
    kind: &'static str,
    message: String,
}

impl RootError {
    fn failed(message: impl Into<String>) -> Self {
        Self {
            kind: "failed",
            message: message.into(),
        }
    }
}

impl From<bookmark::Failure> for RootError {
    fn from(failure: bookmark::Failure) -> Self {
        let (kind, message) = match failure {
            bookmark::Failure::Unplugged(message) => ("unplugged", message),
            bookmark::Failure::Denied(message) => ("denied", message),
            bookmark::Failure::Broken(message) => ("broken", message),
        };
        Self { kind, message }
    }
}

impl From<String> for RootError {
    fn from(message: String) -> Self {
        Self::failed(message)
    }
}

#[derive(Serialize)]
struct RootListing {
    path: String,
    name: String,
    status: &'static str,
}

#[derive(Serialize)]
struct OpenedRoot {
    path: String,
    #[serde(flatten)]
    result: serde_json::Value,
}

#[tauri::command]
async fn list_roots(roots: State<'_, Arc<Roots>>) -> Result<Vec<RootListing>, RootError> {
    let roots = Arc::clone(&roots);
    tauri::async_runtime::spawn_blocking(move || {
        let entries = roots::load(&roots.file)?;
        Ok(entries
            .into_iter()
            .map(|entry| RootListing {
                status: match entry.bookmark.as_deref().map(bookmark::resolve) {
                    Some(Ok(_)) => "ok",
                    Some(Err(bookmark::Failure::Unplugged(_))) => "unplugged",
                    _ => "broken",
                },
                path: entry.path,
                name: entry.name,
            })
            .collect())
    })
    .await
    .map_err(|e| RootError::failed(format!("roots task panicked: {e}")))?
}

/// No path shows the folder panel. A bare path with no stored bookmark gets
/// one minted, which works unsandboxed and fails cleanly under the sandbox.
#[tauri::command]
async fn open_root(
    app: AppHandle,
    sidecar: State<'_, Arc<Sidecar>>,
    roots: State<'_, Arc<Roots>>,
    path: Option<String>,
) -> Result<Option<OpenedRoot>, RootError> {
    let sidecar = Arc::clone(&sidecar);
    let roots = Arc::clone(&roots);
    tauri::async_runtime::spawn_blocking(move || open_root_blocking(&app, &sidecar, &roots, path))
        .await
        .map_err(|e| RootError::failed(format!("roots task panicked: {e}")))?
}

fn open_root_blocking(
    app: &AppHandle,
    sidecar: &Sidecar,
    roots: &Roots,
    path: Option<String>,
) -> Result<Option<OpenedRoot>, RootError> {
    let path = match path {
        Some(path) => path,
        None => {
            let Some(picked) = app
                .dialog()
                .file()
                .set_title("Choose your photos folder")
                .blocking_pick_folder()
            else {
                return Ok(None);
            };
            picked
                .into_path()
                .map_err(|e| RootError::failed(e.to_string()))?
                .to_string_lossy()
                .into_owned()
        }
    };

    let mut entries = roots::load(&roots.file)?;
    let stored = entries
        .iter()
        .find(|entry| entry.path == path)
        .and_then(|entry| entry.bookmark.clone());
    let mut bookmark = match stored.clone() {
        Some(bookmark) => bookmark,
        None => bookmark::mint(&path)?,
    };
    let resolved = match bookmark::resolve(&bookmark) {
        Ok(resolved) => resolved,
        Err(failure) => {
            if stored.is_some() {
                roots::drop_bookmark(&mut entries, &path);
                roots::save(&roots.file, &entries)?;
            }
            return Err(failure.into());
        }
    };
    let stale = resolved.stale;
    let path = resolved.path.clone();
    let access = resolved.start_access()?;
    if stale {
        bookmark = access.mint().unwrap_or(bookmark);
    }

    let result = sidecar.request("setRoot", Some(serde_json::json!({ "path": path })))?;
    *roots.access.lock().unwrap() = Some(access);
    roots::remember(&mut entries, RootEntry::new(path.clone(), Some(bookmark)));
    roots::save(&roots.file, &entries)?;
    Ok(Some(OpenedRoot { path, result }))
}

#[tauri::command]
async fn forget_root(roots: State<'_, Arc<Roots>>, path: String) -> Result<(), RootError> {
    let roots = Arc::clone(&roots);
    tauri::async_runtime::spawn_blocking(move || {
        let mut entries = roots::load(&roots.file)?;
        roots::forget(&mut entries, &path);
        Ok(roots::save(&roots.file, &entries)?)
    })
    .await
    .map_err(|e| RootError::failed(format!("roots task panicked: {e}")))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(feature = "updater")]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .manage(Arc::new(Sidecar::new(Sidecar::default_bin())))
        .setup(|app| {
            app.manage(Arc::new(Roots {
                file: app.path().app_data_dir()?.join("roots.json"),
                access: Mutex::new(None),
            }));
            // Granted here rather than in capabilities/ because tauri-build
            // validates every file there against the plugins compiled in, and
            // the store build compiles without these two.
            #[cfg(feature = "updater")]
            app.add_capability(
                tauri::ipc::CapabilityBuilder::new("updater")
                    .window("main")
                    .permission("updater:default")
                    .permission("process:allow-restart"),
            )?;
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
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "settings" => {
                let _ = app.emit("menu:settings", ());
            }
            #[cfg(feature = "updater")]
            "check-updates" => {
                let _ = app.emit("menu:check-updates", ());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            core_request,
            list_roots,
            open_root,
            forget_root
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<Arc<Sidecar>>().shutdown();
            }
        });
}
