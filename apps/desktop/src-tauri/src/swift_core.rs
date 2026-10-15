use serde::Deserialize;
use serde_json::{json, Value};
use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::time::Duration;

/// Generous: most methods answer instantly, warm renders in ~35ms; the ceiling
/// exists for cold full-res renders.
const TIMEOUT: Duration = Duration::from_secs(10);

/// `setRoot` walks the whole tree before answering, which on a slow external
/// disk can take a while.
const SET_ROOT_TIMEOUT: Duration = Duration::from_secs(120);

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

fn call(start: impl FnOnce(*mut c_void, Reply)) -> Receiver<Option<String>> {
    let (sender, receiver) = sync_channel(1);
    start(Box::into_raw(Box::new(sender)).cast(), deliver);
    receiver
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

/// A request that times out keeps running in the core; its late answer is dropped.
pub fn request(method: &str, params: Option<Value>) -> Result<Value, String> {
    let line = json!({ "method": method, "params": params });
    let line = CString::new(line.to_string()).expect("JSON escapes NUL");
    let timeout = if method == "setRoot" {
        SET_ROOT_TIMEOUT
    } else {
        TIMEOUT
    };
    let text =
        call(|context, reply| unsafe { photopipe_core_request(line.as_ptr(), context, reply) })
            .recv_timeout(timeout)
            .map_err(|_| format!("the core did not answer within {timeout:?}"))?
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

pub fn shutdown() {
    let (sender, receiver) = sync_channel(1);
    std::thread::spawn(move || {
        unsafe { photopipe_core_shutdown() };
        let _ = sender.send(());
    });
    // long enough for a running export to drop its queue and clean up; a library walk is not waited out
    let _ = receiver.recv_timeout(Duration::from_secs(3));
}

#[cfg(target_os = "ios")]
pub fn pick_folder() -> Option<String> {
    call(|context, reply| unsafe { photopipe_pick_folder(context, reply) })
        .recv()
        .ok()
        .flatten()
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
