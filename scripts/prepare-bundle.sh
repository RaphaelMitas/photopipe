#!/usr/bin/env bash
# Stage everything the Rust crate needs to compile.
#
# `externalBin` and `bundle.resources` are resolved by tauri-build at compile
# time, not at packaging time, so a missing sidecar or missing exiftool fails
# `cargo clippy` and `cargo test` just as hard as it fails the bundle. Both
# inputs are staged together here so it is impossible to prepare one and
# forget the other.
set -euo pipefail

cd "$(dirname "$0")/.."

./scripts/fetch-exiftool.sh
./scripts/build-core.sh "${1:-release}"
