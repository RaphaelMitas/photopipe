fn main() {
    // tauri-build validates every capability file it globs, whether or not the
    // config enables it, so the updater capability has to be out of the glob —
    // not just out of the config — for a build without the plugin.
    #[cfg(feature = "updater")]
    let attributes = tauri_build::Attributes::new();
    #[cfg(not(feature = "updater"))]
    let attributes =
        tauri_build::Attributes::new().capabilities_path_pattern("./capabilities/default.json");
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
