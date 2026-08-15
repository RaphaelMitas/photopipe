//! Manager for the photopipe-core Swift sidecar.
//!
//! Protocol v1 envelope (line-delimited JSON with string ids), concurrent
//! transport: requests from any thread interleave on one stdin pipe, a reader
//! thread routes responses to waiters by id, so a slow render never blocks a
//! ping. Crash/wedge recovery respawns the core, replays the library root, and
//! re-sends only idempotent requests.

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const PROTOCOL_VERSION: u64 = 1;

/// Generous: v1 methods answer instantly, warm renders in ~35ms; the ceiling
/// exists for cold full-res renders.
const READ_TIMEOUT: Duration = Duration::from_secs(10);

/// `setRoot` is the one method whose cost scales with the library: it walks
/// the whole tree before answering. Reading metadata happens afterwards, but a
/// deep tree on a slow external disk can still take a while to enumerate.
const SET_ROOT_TIMEOUT: Duration = Duration::from_secs(120);

/// Requests that mutate state must never be silently re-sent after a respawn:
/// the first send may have taken effect before the connection died.
const MUTATING_METHODS: &[&str] = &["setRating"];

#[derive(Debug, Deserialize)]
struct WireError {
    code: String,
    message: String,
}

#[derive(Debug, Deserialize)]
struct WireResponse {
    v: u64,
    id: String,
    ok: bool,
    result: Option<Value>,
    error: Option<WireError>,
}

type PendingMap = HashMap<u64, SyncSender<Result<WireResponse, String>>>;

struct Running {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    /// `None` after the reader thread poisoned the connection (EOF, read
    /// error, or a desynced/unparseable line): every waiter got an error and
    /// no new request may register.
    pending: Mutex<Option<PendingMap>>,
}

impl Running {
    /// Fail all waiters and refuse new registrations. Idempotent.
    fn poison(&self, reason: &str) {
        if let Some(map) = self.pending.lock().unwrap().take() {
            for (_, tx) in map {
                let _ = tx.send(Err(reason.to_string()));
            }
        }
    }

    fn kill(&self) {
        let mut child = self.child.lock().unwrap();
        let _ = child.kill();
        let _ = child.wait();
    }
}

enum RoundTripError {
    /// Connection-level failure — worth a respawn.
    Io(String),
    /// The core answered with an error — respawning won't help.
    Remote(String),
}

pub struct Sidecar {
    bin: PathBuf,
    read_timeout: Duration,
    set_root_timeout: Duration,
    next_id: AtomicU64,
    running: Mutex<Option<Arc<Running>>>,
    /// Params of the last successful `setRoot`, replayed after a respawn so
    /// the fresh core regains its session state before other traffic.
    last_root: Mutex<Option<Value>>,
}

impl Sidecar {
    pub fn new(bin: PathBuf) -> Self {
        Self {
            bin,
            read_timeout: READ_TIMEOUT,
            set_root_timeout: SET_ROOT_TIMEOUT,
            next_id: AtomicU64::new(1),
            running: Mutex::new(None),
            last_root: Mutex::new(None),
        }
    }

    /// Resolution order: env override → the sidecar Tauri bundled next to the
    /// app executable → dev build in the repo's core/ package → bare name on
    /// PATH.
    ///
    /// The bundled copy comes first because that is the only one a shipped
    /// app has; the dev paths exist so `cargo test` and `tauri dev` keep
    /// working from a checkout.
    pub fn default_bin() -> PathBuf {
        if let Ok(path) = std::env::var("PHOTOPIPE_CORE_BIN") {
            return path.into();
        }
        // externalBin lands the binary in Contents/MacOS, beside this one.
        if let Some(sibling) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.join("photopipe-core")))
            .filter(|path| path.exists())
        {
            return sibling;
        }
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        for profile in ["release", "debug"] {
            let candidate = manifest
                .join("../../../core/.build")
                .join(profile)
                .join("photopipe-core");
            if candidate.exists() {
                return candidate;
            }
        }
        PathBuf::from("photopipe-core")
    }

    fn spawn(&self) -> Result<Arc<Running>, String> {
        let mut child = Command::new(&self.bin)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("failed to spawn sidecar {}: {e}", self.bin.display()))?;
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let running = Arc::new(Running {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(Some(HashMap::new())),
        });

        let reader_handle = Arc::clone(&running);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let text = match line {
                    Ok(text) => text,
                    Err(e) => {
                        reader_handle.poison(&format!("read: {e}"));
                        return;
                    }
                };
                let response: WireResponse = match serde_json::from_str(&text) {
                    Ok(response) => response,
                    Err(e) => {
                        // Desynced stream — nothing after this line is trustworthy.
                        reader_handle.poison(&format!("unparseable response: {e}"));
                        return;
                    }
                };
                let Ok(id) = response.id.parse::<u64>() else {
                    reader_handle.poison(&format!("response with foreign id {:?}", response.id));
                    return;
                };
                if let Some(map) = reader_handle.pending.lock().unwrap().as_mut() {
                    if let Some(tx) = map.remove(&id) {
                        let _ = tx.send(Ok(response));
                    }
                    // No waiter: it timed out and deregistered — drop the late reply.
                }
            }
            reader_handle.poison("sidecar closed stdout");
        });

        Ok(running)
    }

    /// Current connection, spawning (and replaying the root) if needed.
    fn connection(&self) -> Result<Arc<Running>, String> {
        {
            let mut guard = self.running.lock().map_err(|e| e.to_string())?;
            if let Some(running) = guard.as_ref() {
                return Ok(Arc::clone(running));
            }
            let running = self.spawn()?;
            *guard = Some(Arc::clone(&running));
        }
        // Outside the lock, best-effort: replay session state on the fresh
        // connection. A concurrent request can slip in before the replay and
        // eat one `no_root` error — that request fails visibly and the next
        // succeeds, which is acceptable for a crash-recovery path.
        let replay = self.last_root.lock().unwrap().clone();
        if let Some(params) = replay {
            let running = self.running.lock().unwrap().as_ref().map(Arc::clone);
            if let Some(running) = running {
                let _ = self.round_trip(&running, "setRoot", &Some(params));
            }
        }
        self.running
            .lock()
            .unwrap()
            .as_ref()
            .map(Arc::clone)
            .ok_or_else(|| "sidecar connection lost during setup".into())
    }

    /// Drop `failed` as the current connection (only if it still is) and kill it.
    fn discard(&self, failed: &Arc<Running>) {
        failed.poison("connection discarded");
        if let Ok(mut guard) = self.running.lock() {
            if let Some(current) = guard.as_ref() {
                if Arc::ptr_eq(current, failed) {
                    *guard = None;
                }
            }
        }
        failed.kill();
    }

    fn round_trip(
        &self,
        running: &Arc<Running>,
        method: &str,
        params: &Option<Value>,
    ) -> Result<Value, RoundTripError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = sync_channel(1);
        {
            let mut pending = running.pending.lock().unwrap();
            match pending.as_mut() {
                Some(map) => map.insert(id, tx),
                None => return Err(RoundTripError::Io("connection already failed".into())),
            };
        }

        let request = json!({
            "v": PROTOCOL_VERSION,
            "id": id.to_string(),
            "method": method,
            "params": params,
        });
        let mut line = request.to_string();
        line.push('\n');
        {
            let mut stdin = running.stdin.lock().unwrap();
            if let Err(e) = stdin.write_all(line.as_bytes()) {
                if let Some(map) = running.pending.lock().unwrap().as_mut() {
                    map.remove(&id);
                }
                return Err(RoundTripError::Io(format!("write: {e}")));
            }
        }

        let timeout = if method == "setRoot" {
            self.set_root_timeout
        } else {
            self.read_timeout
        };
        let response = match rx.recv_timeout(timeout) {
            Ok(Ok(response)) => response,
            Ok(Err(reason)) => return Err(RoundTripError::Io(reason)),
            Err(RecvTimeoutError::Timeout) => {
                if let Some(map) = running.pending.lock().unwrap().as_mut() {
                    map.remove(&id);
                }
                return Err(RoundTripError::Io(format!(
                    "sidecar did not answer within {timeout:?}"
                )));
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err(RoundTripError::Io("connection failed".into()))
            }
        };

        if response.v != PROTOCOL_VERSION {
            return Err(RoundTripError::Remote(format!(
                "protocol mismatch: sidecar speaks v{}",
                response.v
            )));
        }
        if response.ok {
            Ok(response.result.unwrap_or(Value::Null))
        } else {
            let error = response.error.map_or_else(
                || "unknown error".to_string(),
                |e| format!("{}: {}", e.code, e.message),
            );
            Err(RoundTripError::Remote(error))
        }
    }

    pub fn request(&self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let retryable = !MUTATING_METHODS.contains(&method);
        let mut last_io_error = String::new();
        for _attempt in 0..2 {
            let running = self.connection()?;
            match self.round_trip(&running, method, &params) {
                Ok(result) => {
                    if method == "setRoot" {
                        *self.last_root.lock().unwrap() = params.clone();
                    }
                    return Ok(result);
                }
                Err(RoundTripError::Remote(message)) => return Err(message),
                Err(RoundTripError::Io(message)) => {
                    self.discard(&running);
                    last_io_error = message;
                    if !retryable {
                        // The core may have applied the mutation before dying —
                        // surface the failure instead of risking a double apply.
                        return Err(format!("sidecar connection failed: {last_io_error}"));
                    }
                }
            }
        }
        Err(format!("sidecar unreachable after restart: {last_io_error}"))
    }

    /// Best-effort graceful shutdown: ask politely, then reap or kill.
    pub fn shutdown(&self) {
        let Ok(mut guard) = self.running.lock() else {
            return;
        };
        let Some(running) = guard.take() else {
            return;
        };
        drop(guard);

        let goodbye = json!({
            "v": PROTOCOL_VERSION,
            "id": self.next_id.fetch_add(1, Ordering::Relaxed).to_string(),
            "method": "shutdown",
        });
        {
            let mut stdin = running.stdin.lock().unwrap();
            let _ = stdin.write_all(format!("{goodbye}\n").as_bytes());
        }
        let deadline = Instant::now() + Duration::from_millis(500);
        while Instant::now() < deadline {
            match running.child.lock().unwrap().try_wait() {
                Ok(Some(_)) => {
                    running.poison("shut down");
                    return;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                Err(_) => break,
            }
        }
        running.poison("shut down");
        running.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core_bin() -> Option<PathBuf> {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        for profile in ["debug", "release"] {
            let candidate = manifest
                .join("../../../core/.build")
                .join(profile)
                .join("photopipe-core");
            if candidate.exists() {
                return Some(candidate);
            }
        }
        // Locally a missing core is a soft skip; on CI it means the pipeline
        // forgot to build Swift first and must fail loudly, not go green.
        assert!(
            std::env::var_os("CI").is_none(),
            "photopipe-core binary not found on CI — build the Swift core before cargo test"
        );
        None
    }

    fn temp_tree(tag: &str, files: &[&str]) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "photopipe-cargo-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let shoot = root.join("2026-01-01_cargotest");
        std::fs::create_dir_all(&shoot).unwrap();
        for name in files {
            std::fs::write(shoot.join(name), b"fake").unwrap();
        }
        root
    }

    fn set_root(sidecar: &Sidecar, root: &std::path::Path) -> Value {
        sidecar
            .request(
                "setRoot",
                Some(json!({
                    "path": root.to_str().unwrap(),
                    "indexPath": root.join("index.sqlite").to_str().unwrap(),
                })),
            )
            .expect("setRoot")
    }

    #[test]
    fn ping_and_version_round_trip() {
        let Some(bin) = core_bin() else {
            eprintln!("SKIP: build the Swift core first (cd core && swift build)");
            return;
        };
        let sidecar = Sidecar::new(bin);
        let version = sidecar.request("version", None).expect("version");
        assert_eq!(version["protocol"], 1);
        assert!(version["version"].is_string());
        let pong = sidecar.request("ping", None).expect("ping");
        assert_eq!(pong["pong"], true);
        sidecar.shutdown();
    }

    #[test]
    fn remote_errors_do_not_kill_the_session() {
        let Some(bin) = core_bin() else {
            eprintln!("SKIP: build the Swift core first (cd core && swift build)");
            return;
        };
        let sidecar = Sidecar::new(bin);
        let error = sidecar.request("levitate", None).expect_err("unknown method");
        assert!(error.contains("unknown_method"), "got: {error}");
        assert_eq!(sidecar.request("ping", None).expect("ping")["pong"], true);
        sidecar.shutdown();
    }

    #[test]
    fn restarts_after_crash_and_replays_root() {
        let Some(bin) = core_bin() else {
            eprintln!("SKIP: build the Swift core first (cd core && swift build)");
            return;
        };
        let root = temp_tree("replay", &["DSC00001.ARW"]);
        let sidecar = Sidecar::new(bin);
        set_root(&sidecar, &root);
        assert_eq!(
            sidecar.request("listShoots", None).expect("listShoots")["shoots"]
                .as_array()
                .unwrap()
                .len(),
            1
        );

        // Kill the core behind the manager's back.
        {
            let guard = sidecar.running.lock().unwrap();
            let running = guard.as_ref().expect("running");
            running.kill();
        }

        // Next request must respawn AND replay the root — a bare respawn
        // would answer `no_root` here.
        let shoots = sidecar.request("listShoots", None).expect("respawned listShoots");
        assert_eq!(shoots["shoots"].as_array().unwrap().len(), 1);
        sidecar.shutdown();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn concurrent_requests_interleave_on_one_connection() {
        let Some(bin) = core_bin() else {
            eprintln!("SKIP: build the Swift core first (cd core && swift build)");
            return;
        };
        let sidecar = Arc::new(Sidecar::new(bin));
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let sidecar = Arc::clone(&sidecar);
                std::thread::spawn(move || {
                    for _ in 0..25 {
                        assert_eq!(sidecar.request("ping", None).expect("ping")["pong"], true);
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().expect("worker");
        }
        sidecar.shutdown();
    }

    #[test]
    fn set_root_and_list_shoots_against_real_tree() {
        let Some(bin) = core_bin() else {
            eprintln!("SKIP: build the Swift core first (cd core && swift build)");
            return;
        };
        let root = temp_tree("list", &["DSC00001.ARW", "DSC00002.ARW", "DSC00003.JPG"]);
        let sidecar = Sidecar::new(bin);
        let set = set_root(&sidecar, &root);
        assert_eq!(set["shoots"], 1);
        assert_eq!(set["files"], 3);

        let shoots = sidecar.request("listShoots", None).expect("listShoots");
        let list = shoots["shoots"].as_array().expect("shoots array");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["name"], "2026-01-01_cargotest");
        assert_eq!(list[0]["day"], "2026-01-01");
        assert_eq!(list[0]["project"], "cargotest");
        assert_eq!(list[0]["imageCount"], 3);

        sidecar.shutdown();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn wedged_sidecar_times_out_instead_of_hanging() {
        // A "sidecar" that accepts requests but never answers.
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/wedged-sidecar.sh");
        let mut sidecar = Sidecar::new(script);
        sidecar.read_timeout = Duration::from_millis(200);
        let start = Instant::now();
        let error = sidecar.request("ping", None).expect_err("must time out");
        assert!(error.contains("did not answer"), "got: {error}");
        // Two attempts (initial + respawn retry), each bounded by the timeout.
        assert!(start.elapsed() < Duration::from_secs(2), "took {:?}", start.elapsed());
        sidecar.shutdown();
    }

    #[test]
    fn mutating_methods_are_not_retried() {
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/wedged-sidecar.sh");
        let mut sidecar = Sidecar::new(script);
        sidecar.read_timeout = Duration::from_millis(200);
        let start = Instant::now();
        let error = sidecar
            .request("setRating", Some(json!({"path": "/r/DSC1.ARW", "rating": 3})))
            .expect_err("must fail");
        // One attempt only — no silent re-send of a possibly-applied mutation.
        assert!(error.contains("connection failed"), "got: {error}");
        assert!(
            start.elapsed() < Duration::from_millis(600),
            "took {:?} — looks like it retried",
            start.elapsed()
        );
        sidecar.shutdown();
    }
}
