fn main() {
    // Xcode exports the iOS SDKROOT, and SwiftPM would compile its macOS manifest against it
    std::env::remove_var("SDKROOT");
    swift_rs::SwiftLinker::new("15.0")
        .with_ios("18.0")
        .with_package("PhotopipeCoreFFI", "../../../core")
        .link();
    println!("cargo:rerun-if-changed=../../../core/Sources");
    println!("cargo:rerun-if-changed=../../../core/Package.swift");
    println!("cargo:rerun-if-env-changed=DEVELOPER_DIR");
    // the Swift runtime ships with the OS but rustc adds no rpath to it
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    println!("cargo::rustc-check-cfg=cfg(agents)");
    if std::env::var_os("CARGO_FEATURE_AGENTS").is_some()
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos")
    {
        println!("cargo:rustc-cfg=agents");
    }
    tauri_build::build()
}
