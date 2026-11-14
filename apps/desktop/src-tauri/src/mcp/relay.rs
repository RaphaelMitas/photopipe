use std::io::{self, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};
use std::time::{Duration, Instant};

pub fn run() -> ExitCode {
    let path = super::socket_path();
    let Some(stream) = UnixStream::connect(&path)
        .ok()
        .or_else(|| launch().and_then(|()| wait_for(&path)))
    else {
        eprintln!(
            "Photopipe is not running and could not be started. Open it, then reconnect this server."
        );
        return ExitCode::FAILURE;
    };
    let Ok(mut upstream) = stream.try_clone() else {
        return ExitCode::FAILURE;
    };
    std::thread::spawn(move || {
        let _ = io::copy(&mut io::stdin().lock(), &mut upstream);
        // the client hung up; let the app see the end too
        let _ = upstream.shutdown(Shutdown::Write);
    });
    let mut downstream = stream;
    let mut stdout = io::stdout().lock();
    let _ = io::copy(&mut downstream, &mut stdout);
    let _ = stdout.flush();
    ExitCode::SUCCESS
}

/// In the background, so an agent asking does not pull the window to the front.
fn launch() -> Option<()> {
    let bundle = bundle(&std::env::current_exe().ok()?)?;
    let status = Command::new("/usr/bin/open")
        .arg("-g")
        .arg(bundle)
        .status()
        .ok()?;
    status.success().then_some(())
}

/// A dev build is not inside an app bundle and has nothing to open.
fn bundle(exe: &Path) -> Option<PathBuf> {
    exe.ancestors()
        .find(|dir| dir.extension().is_some_and(|ext| ext == "app"))
        .map(Path::to_path_buf)
}

fn wait_for(path: &Path) -> Option<UnixStream> {
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if let Ok(stream) = UnixStream::connect(path) {
            return Some(stream);
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundle_is_found_above_the_executable_and_a_bare_binary_has_none() {
        assert_eq!(
            bundle(Path::new(
                "/Applications/Photopipe.app/Contents/MacOS/Photopipe"
            )),
            Some(PathBuf::from("/Applications/Photopipe.app"))
        );
        assert_eq!(bundle(Path::new("/repo/target/debug/desktop")), None);
    }
}
