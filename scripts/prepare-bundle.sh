#!/usr/bin/env bash
# Stage everything the Rust crate needs to compile.
#
# `externalBin` is resolved by tauri-build at compile time, not at packaging
# time, so a missing sidecar fails `cargo clippy` and `cargo test` just as
# hard as it fails the bundle.
set -euo pipefail

cd "$(dirname "$0")/.."

./scripts/build-core.sh "${1:-release}"
