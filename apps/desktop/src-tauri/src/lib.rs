mod sidecar;

use sidecar::Sidecar;
use std::sync::Arc;
use tauri::Manager;

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
    tauri::Builder::default()
        .manage(Arc::new(Sidecar::new(Sidecar::default_bin())))
        .invoke_handler(tauri::generate_handler![core_request])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<Arc<Sidecar>>().shutdown();
            }
        });
}
