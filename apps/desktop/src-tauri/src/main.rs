fn main() -> std::process::ExitCode {
    if std::env::args().nth(1).as_deref() == Some("--core") {
        desktop_lib::serve_core_on_stdin();
        return std::process::ExitCode::SUCCESS;
    }
    #[cfg(agents)]
    if std::env::args().nth(1).as_deref() == Some("--mcp") {
        return desktop_lib::relay_agent();
    }
    desktop_lib::run();
    std::process::ExitCode::SUCCESS
}
