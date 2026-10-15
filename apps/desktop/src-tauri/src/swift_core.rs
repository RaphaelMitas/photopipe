//! The Swift core, linked in and called over a C ABI.

use serde::Deserialize;
use serde_json::{json, Value};
use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::time::Duration;

const PROTOCOL_VERSION: u64 = 1;

type Reply = extern "C" fn(*mut c_void, *const c_char);

extern "C" {
    fn photopipe_core_request(line: *const c_char, context: *mut c_void, reply: Reply);
    fn photopipe_core_shutdown();
    #[cfg(target_os = "ios")]
    fn photopipe_pick_folder(context: *mut c_void, reply: Reply);
    #[cfg(target_os = "ios")]
    fn photopipe_fit_to_safe_area(webview: *mut c_void);
}

/// Swift calls this exactly once per `context`, which owns the sender.
extern "C" fn deliver(context: *mut c_void, text: *const c_char) {
    let sender = unsafe { Box::from_raw(context.cast::<SyncSender<Option<String>>>()) };
    let text = (!text.is_null()).then(|| {
        unsafe { CStr::from_ptr(text) }
            .to_string_lossy()
            .into_owned()
    });
    let _ = sender.send(text);
}

fn call(start: impl FnOnce(*mut c_void, Reply)) -> Option<String> {
    let (sender, receiver) = sync_channel(1);
    start(Box::into_raw(Box::new(sender)).cast(), deliver);
    receiver.recv().ok().flatten()
}

#[derive(Deserialize)]
struct WireError {
    code: String,
    message: String,
}

#[derive(Deserialize)]
struct WireResponse {
    ok: bool,
    result: Option<Value>,
    error: Option<WireError>,
}

/// Blocks until the core answers.
pub fn request(method: &str, params: Option<Value>) -> Result<Value, String> {
    let line = json!({ "v": PROTOCOL_VERSION, "id": "", "method": method, "params": params });
    let line = CString::new(line.to_string()).expect("JSON escapes NUL");
    let text =
        call(|context, reply| unsafe { photopipe_core_request(line.as_ptr(), context, reply) })
            .ok_or("the core sent no answer")?;
    let response: WireResponse =
        serde_json::from_str(&text).map_err(|e| format!("unparseable response: {e}"))?;
    if response.ok {
        Ok(response.result.unwrap_or(Value::Null))
    } else {
        Err(response.error.map_or_else(
            || "unknown error".to_string(),
            |e| format!("{}: {}", e.code, e.message),
        ))
    }
}

/// Long enough for a running export to drop its queue and clean up; quitting
/// does not wait for a library walk.
pub fn shutdown() {
    let (sender, receiver) = sync_channel(1);
    std::thread::spawn(move || {
        unsafe { photopipe_core_shutdown() };
        let _ = sender.send(());
    });
    let _ = receiver.recv_timeout(Duration::from_secs(3));
}

/// The picked folder's path, or `None` when cancelled.
#[cfg(target_os = "ios")]
pub fn pick_folder() -> Option<String> {
    call(|context, reply| unsafe { photopipe_pick_folder(context, reply) })
}

/// Must run on the main thread with the window's WKWebView.
#[cfg(target_os = "ios")]
pub fn fit_to_safe_area(webview: *mut c_void) {
    unsafe { photopipe_fit_to_safe_area(webview) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_round_trips_and_an_error_keeps_its_code() {
        assert!(request("ping", None).is_ok());
        let error = request("noSuchMethod", None).unwrap_err();
        assert!(error.starts_with("unknown_method"), "{error}");
    }
}
