pub mod access;
pub mod bridge;
#[cfg(agents)]
pub mod relay;
#[cfg(agents)]
pub mod server;
#[cfg(agents)]
mod tools;
#[cfg(agents)]
mod ui;

/// The relay and the app meet here, so an agent needs no port and no token.
#[cfg(agents)]
pub fn socket_path() -> std::path::PathBuf {
    let home = std::env::var_os("HOME").unwrap_or_default();
    std::path::PathBuf::from(home).join("Library/Application Support/Photopipe/mcp.sock")
}
