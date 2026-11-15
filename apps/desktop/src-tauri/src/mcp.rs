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

#[cfg(agents)]
pub fn socket_path() -> std::path::PathBuf {
    let home = std::env::var_os("HOME").unwrap_or_default();
    std::path::PathBuf::from(home).join("Library/Application Support/Photopipe/mcp.sock")
}
