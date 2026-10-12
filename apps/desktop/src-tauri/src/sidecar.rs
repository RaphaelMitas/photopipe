//! Manager for the photopipe-core Swift sidecar.
//!
//! Protocol v1 envelope (line-delimited JSON with string ids), concurrent
//! transport: requests from any thread interleave on one stdin pipe, a reader
//! thread routes responses to waiters by id, so a slow render never blocks a
//! ping. Crash/wedge recovery respawns the core, replays the library root, and
//! re-sends a request only if it never reached the core.

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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

/// The core answers ping off its work queue, so a busy core still answers fast.
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

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
    probing: AtomicBool,
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
    /// The request never reached the core, so a fresh one can take it.
    Unsent(String),
    /// The core may have acted on the request before the connection failed.
    Lost(String),
    /// No answer in time; the core may still be working on it.
    TimedOut(Duration),
    /// The core answered with an error — respawning won't help.
    Remote(String),
}

pub struct Sidecar {
    bin: PathBuf,
    read_timeout: Duration,
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
        dev_build().unwrap_or_else(|| PathBuf::from("photopipe-core"))
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
            probing: AtomicBool::new(false),
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
        let fresh = {
            let mut guard = self.running.lock().map_err(|e| e.to_string())?;
            if let Some(running) = guard.as_ref() {
                return Ok(Arc::clone(running));
            }
            let running = self.spawn()?;
            *guard = Some(Arc::clone(&running));
            running
        };
        // Outside the lock, best-effort: replay session state on the fresh
        // connection. A concurrent request can slip in before the replay and
        // eat one `no_root` error — that request fails visibly and the next
        // succeeds, which is acceptable for a crash-recovery path.
        let replay = self.last_root.lock().unwrap().clone();
        if let Some(params) = replay {
            let _ = self.round_trip(&fresh, "setRoot", &Some(params), SET_ROOT_TIMEOUT);
        }
        Ok(fresh)
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

    /// Kill the core only if it ignores a ping too: a slow request alone must
    /// not take the exports running in the core down with it.
    fn probe(&self, running: &Arc<Running>) {
        if running.probing.swap(true, Ordering::AcqRel) {
            return;
        }
        let answered = matches!(
            self.round_trip(running, "ping", &None, PROBE_TIMEOUT),
            Ok(_) | Err(RoundTripError::Remote(_))
        );
        if !answered {
            self.discard(running);
        }
        running.probing.store(false, Ordering::Release);
    }

    fn round_trip(
        &self,
        running: &Arc<Running>,
        method: &str,
        params: &Option<Value>,
        timeout: Duration,
    ) -> Result<Value, RoundTripError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = sync_channel(1);
        {
            let mut pending = running.pending.lock().unwrap();
            match pending.as_mut() {
                Some(map) => map.insert(id, tx),
                None => return Err(RoundTripError::Unsent("connection already failed".into())),
            };
        }

        {
            let mut stdin = running.stdin.lock().unwrap();
            if let Err(e) = stdin.write_all(envelope(id, method, params).as_bytes()) {
                if let Some(map) = running.pending.lock().unwrap().as_mut() {
                    map.remove(&id);
                }
                return Err(RoundTripError::Unsent(format!("write: {e}")));
            }
        }

        let response = match rx.recv_timeout(timeout) {
            Ok(Ok(response)) => response,
            Ok(Err(reason)) => return Err(RoundTripError::Lost(reason)),
            Err(RecvTimeoutError::Timeout) => {
                if let Some(map) = running.pending.lock().unwrap().as_mut() {
                    map.remove(&id);
                }
                return Err(RoundTripError::TimedOut(timeout));
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err(RoundTripError::Lost("connection failed".into()))
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
        let timeout = if method == "setRoot" {
            SET_ROOT_TIMEOUT
        } else {
            self.read_timeout
        };
        let mut retried = false;
        loop {
            let running = self.connection()?;
            match self.round_trip(&running, method, &params, timeout) {
                Ok(result) => {
                    if method == "setRoot" {
                        *self.last_root.lock().unwrap() = params.clone();
                    }
                    return Ok(result);
                }
                Err(RoundTripError::Remote(message)) => return Err(message),
                Err(RoundTripError::Unsent(_)) if !retried => {
                    self.discard(&running);
                    retried = true;
                }
                Err(RoundTripError::Unsent(message) | RoundTripError::Lost(message)) => {
                    self.discard(&running);
                    return Err(format!("sidecar connection failed: {message}"));
                }
                Err(RoundTripError::TimedOut(timeout)) => {
                    self.probe(&running);
                    return Err(format!("sidecar did not answer within {timeout:?}"));
                }
            }
        }
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

        let goodbye = envelope(
            self.next_id.fetch_add(1, Ordering::Relaxed),
            "shutdown",
            &None,
        );
        {
            let mut stdin = running.stdin.lock().unwrap();
            let _ = stdin.write_all(goodbye.as_bytes());
        }
        // long enough for a running export to drop its queue and clean up
        let deadline = Instant::now() + Duration::from_millis(3000);
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

fn envelope(id: u64, method: &str, params: &Option<Value>) -> String {
    let request = json!({
        "v": PROTOCOL_VERSION,
        "id": id.to_string(),
        "method": method,
        "params": params,
    });
    format!("{request}\n")
}

/// The core built from this checkout, for `cargo test` and `tauri dev`.
fn dev_build() -> Option<PathBuf> {
    let build = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../core/.build");
    ["release", "debug"]
        .into_iter()
        .map(|profile| build.join(profile).join("photopipe-core"))
        .find(|candidate| candidate.exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core_bin() -> Option<PathBuf> {
        if let Some(bin) = dev_build() {
            return Some(bin);
        }
        // Locally a missing core is a soft skip; on CI it means the pipeline
        // forgot to build Swift first and must fail loudly, not go green.
        assert!(
            std::env::var_os("CI").is_none(),
            "photopipe-core binary not found on CI — build the Swift core before cargo test"
        );
        None
    }

    fn temp_dir(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "photopipe-cargo-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ))
    }

    fn script_core(dir: &std::path::Path, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(dir).unwrap();
        let script = dir.join("core.sh");
        std::fs::write(&script, format!("#!/bin/sh\n{body}")).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    fn temp_tree(tag: &str, files: &[&str]) -> PathBuf {
        let root = temp_dir(tag);
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
        let error = sidecar
            .request("levitate", None)
            .expect_err("unknown method");
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
        let shoots = sidecar
            .request("listShoots", None)
            .expect("respawned listShoots");
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
        std::fs::write(
            root.join("2026-01-01_cargotest").join("photopipe.json"),
            br#"{"day":"2026-05-05","notes":""}"#,
        )
        .unwrap();
        let sidecar = Sidecar::new(bin);
        let set = set_root(&sidecar, &root);
        assert_eq!(set["shoots"], 1);
        assert_eq!(set["files"], 3);

        let shoots = sidecar.request("listShoots", None).expect("listShoots");
        let list = shoots["shoots"].as_array().expect("shoots array");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["name"], "2026-01-01_cargotest");
        assert_eq!(list[0]["day"], "2026-05-05");
        assert_eq!(list[0]["imageCount"], 3);

        sidecar.shutdown();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn wedged_sidecar_is_killed_and_respawned() {
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/wedged-sidecar.sh");
        let mut sidecar = Sidecar::new(script);
        sidecar.read_timeout = Duration::from_millis(200);
        let wedged = sidecar.connection().expect("spawn");
        let start = Instant::now();
        let error = sidecar.request("ping", None).expect_err("must time out");
        assert!(error.contains("did not answer"), "got: {error}");
        assert!(
            start.elapsed() < sidecar.read_timeout + PROBE_TIMEOUT + Duration::from_secs(1),
            "took {:?}",
            start.elapsed()
        );
        assert!(
            wedged.child.lock().unwrap().try_wait().unwrap().is_some(),
            "wedged core still running"
        );
        let fresh = sidecar.connection().expect("respawn");
        assert!(!Arc::ptr_eq(&wedged, &fresh));
        sidecar.shutdown();
    }

    #[test]
    fn a_slow_request_does_not_kill_a_core_that_answers_ping() {
        let dir = temp_dir("busy");
        let script = script_core(
            &dir,
            r#"while read -r line; do
  case "$line" in
    *'"method":"ping"'*)
      id=$(printf '%s\n' "$line" | sed 's/.*"id":"\([0-9]*\)".*/\1/')
      printf '{"v":1,"id":"%s","ok":true,"result":{"pong":true}}\n' "$id" ;;
  esac
done
"#,
        );
        let mut sidecar = Sidecar::new(script);
        sidecar.read_timeout = Duration::from_millis(200);
        let busy = sidecar.connection().expect("spawn");
        let error = sidecar.request("render", None).expect_err("must time out");
        assert!(error.contains("did not answer"), "got: {error}");
        assert!(busy.child.lock().unwrap().try_wait().unwrap().is_none());
        assert!(Arc::ptr_eq(&busy, &sidecar.connection().unwrap()));
        assert_eq!(sidecar.request("ping", None).expect("ping")["pong"], true);
        sidecar.shutdown();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn requests_timing_out_together_probe_once() {
        let dir = temp_dir("storm");
        let log = dir.join("received.log");
        let script = script_core(
            &dir,
            &format!(
                "while read -r line; do echo \"$line\" >> '{}'; done\n",
                log.display()
            ),
        );
        let mut sidecar = Sidecar::new(script);
        sidecar.read_timeout = Duration::from_millis(200);
        let sidecar = Arc::new(sidecar);
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let sidecar = Arc::clone(&sidecar);
                std::thread::spawn(move || sidecar.request("render", None).expect_err("wedged"))
            })
            .collect();
        for thread in threads {
            thread.join().expect("worker");
        }
        let received = std::fs::read_to_string(&log).unwrap();
        let pings = received
            .lines()
            .filter(|line| line.contains(r#""method":"ping""#));
        assert_eq!(pings.count(), 1, "{received}");
        sidecar.shutdown();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_request_the_core_received_is_never_resent() {
        let dir = temp_dir("received");
        let log = dir.join("received.log");
        let script = script_core(
            &dir,
            &format!("read -r line\necho \"$line\" >> '{}'\n", log.display()),
        );

        let sidecar = Sidecar::new(script);
        let error = sidecar
            .request("trash", Some(json!({"paths": ["/r/DSC1.ARW"]})))
            .expect_err("core died mid-request");
        assert!(error.contains("connection failed"), "got: {error}");
        let received = std::fs::read_to_string(&log).unwrap();
        assert_eq!(received.lines().count(), 1, "re-sent: {received}");
        sidecar.shutdown();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
