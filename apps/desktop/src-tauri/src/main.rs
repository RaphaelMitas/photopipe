fn main() {
    if std::env::args().nth(1).as_deref() == Some("--core") {
        desktop_lib::serve_core_on_stdin();
        return;
    }
    desktop_lib::run()
}
