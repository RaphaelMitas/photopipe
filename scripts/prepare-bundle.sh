#!/usr/bin/env bash
# Stage everything the Rust crate needs to compile.
#
# `bundle.resources` is resolved by tauri-build at compile time, not at
# packaging time, so a missing exiftool fails `cargo clippy` and `cargo test`
# just as hard as it fails the bundle. The Swift core needs no staging: the
# crate's build script compiles and links it.
set -euo pipefail

cd "$(dirname "$0")/.."

./scripts/fetch-exiftool.sh
