//! Manager for the photopipe-core Swift sidecar: spawn, request/response over
//! line-delimited JSON (protocol v1), read timeout, crash-restart, graceful shutdown.

use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const PROTOCOL_VERSION: u64 = 1;

/// Generous default: v1 methods answer instantly; raw renders in later phases
/// may take seconds cold. Per-method budgets can replace this when needed.
const READ_TIMEOUT: Duration = Duration::from_secs(10);

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

struct Running {
    child: Child,
    stdin: ChildStdin,
    /// Fed by a dedicated reader thread; lets reads carry a timeout. The thread
    /// exits on stdout EOF, so killed sidecars clean up after themselves.
    lines: Receiver<std::io::Result<String>>,
}

enum RoundTripError {
    /// Pipe broke, sidecar died, stream desynced, or read timed out — worth a respawn.
    Io(String),
    /// Sidecar answered with an error — respawning won't help.
    Remote(String),
}

pub struct Sidecar {
    bin: PathBuf,
    read_timeout: Duration,
    next_id: AtomicU64,
    running: Mutex<Option<Running>>,
}

impl Sidecar {
    pub fn new(bin: PathBuf) -> Self {
        Self {
            bin,
            read_timeout: READ_TIMEOUT,
            next_id: AtomicU64::new(1),
            running: Mutex::new(None),
        }
    }

    /// Resolution order: env override → dev build in the repo's core/ package →
    /// bare name on PATH (bundled sidecar comes in a later phase).
    pub fn default_bin() -> PathBuf {
        if let Ok(path) = std::env::var("PHOTOPIPE_CORE_BIN") {
            return path.into();
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

    fn spawn(&self) -> Result<Running, String> {
        let mut child = Command::new(&self.bin)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("failed to spawn sidecar {}: {e}", self.bin.display()))?;
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let (tx, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let failed = line.is_err();
                if tx.send(line).is_err() || failed {
                    break;
                }
            }
        });
        Ok(Running {
            child,
            stdin,
            lines,
        })
    }

    fn round_trip(
        running: &mut Running,
        id: u64,
        method: &str,
        params: &Option<Value>,
        read_timeout: Duration,
    ) -> Result<Value, RoundTripError> {
        let request = json!({
            "v": PROTOCOL_VERSION,
            "id": id.to_string(),
            "method": method,
            "params": params,
        });
        let mut line = request.to_string();
        line.push('\n');
        running
            .stdin
            .write_all(line.as_bytes())
            .map_err(|e| RoundTripError::Io(format!("write: {e}")))?;

        let reply = match running.lines.recv_timeout(read_timeout) {
            Ok(Ok(reply)) => reply,
            Ok(Err(e)) => return Err(RoundTripError::Io(format!("read: {e}"))),
            Err(RecvTimeoutError::Timeout) => {
                return Err(RoundTripError::Io(format!(
                    "sidecar did not answer within {read_timeout:?}"
                )))
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err(RoundTripError::Io("sidecar closed stdout".into()))
            }
        };

        // Unparseable output or a mismatched id means the stream is desynced —
        // classify as Io so the kill-and-respawn path recovers the session.
        let response: WireResponse = serde_json::from_str(&reply)
            .map_err(|e| RoundTripError::Io(format!("unparseable response: {e}")))?;
        if response.id != id.to_string() {
            return Err(RoundTripError::Io(format!(
                "response id {} does not match request id {id}",
                response.id
            )));
        }
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
        let mut guard = self.running.lock().map_err(|e| e.to_string())?;
        let mut last_io_error = String::new();
        // One respawn retry: a crashed or wedged sidecar is replaced transparently.
        // NOTE: this re-sends the request — fine for idempotent v1 methods, must be
        // revisited before mutating methods land (see IMPLEMENTATION.md, Phase 3).
        for _attempt in 0..2 {
            if guard.is_none() {
                *guard = Some(self.spawn()?);
            }
            let id = self.next_id.fetch_add(1, Ordering::Relaxed);
            match Self::round_trip(
                guard.as_mut().expect("just spawned"),
                id,
                method,
                &params,
                self.read_timeout,
            ) {
                Ok(result) => return Ok(result),
                Err(RoundTripError::Remote(message)) => return Err(message),
                Err(RoundTripError::Io(message)) => {
                    if let Some(mut dead) = guard.take() {
                        let _ = dead.child.kill();
                        let _ = dead.child.wait();
                    }
                    last_io_error = message;
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
        let Some(mut running) = guard.take() else {
            return;
        };
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let _ = Self::round_trip(&mut running, id, "shutdown", &None, Duration::from_millis(500));
        let deadline = Instant::now() + Duration::from_millis(500);
        while Instant::now() < deadline {
            match running.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                Err(_) => break,
            }
        }
        let _ = running.child.kill();
        let _ = running.child.wait();
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
        // Session still usable afterwards
        assert_eq!(sidecar.request("ping", None).expect("ping")["pong"], true);
        sidecar.shutdown();
    }

    #[test]
    fn restarts_after_sidecar_crash() {
        let Some(bin) = core_bin() else {
            eprintln!("SKIP: build the Swift core first (cd core && swift build)");
            return;
        };
        let sidecar = Sidecar::new(bin);
        assert_eq!(sidecar.request("ping", None).expect("ping")["pong"], true);
        // Kill the sidecar behind the manager's back
        {
            let mut guard = sidecar.running.lock().unwrap();
            let running = guard.as_mut().expect("running");
            running.child.kill().unwrap();
            running.child.wait().unwrap();
        }
        // Next request must transparently respawn
        assert_eq!(sidecar.request("ping", None).expect("respawned ping")["pong"], true);
        sidecar.shutdown();
    }

    #[test]
    fn wedged_sidecar_times_out_instead_of_hanging() {
        // A "sidecar" that reads forever and never answers.
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
}
