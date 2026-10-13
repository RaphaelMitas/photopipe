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

# Tauri's externalBin copies `binaries/<name>-<target-triple>` into the app
# bundle as `Contents/MacOS/<name>`, so the file has to carry the triple in
# its name even though we only ever build for the host.
TRIPLE="$(rustc -vV | awk '/^host:/ {print $2}')"
DEST="apps/desktop/src-tauri/binaries"

echo "Building photopipe-core for $TRIPLE"
swift build --package-path core -c release

mkdir -p "$DEST"
cp core/.build/release/photopipe-core "$DEST/photopipe-core-$TRIPLE"
echo "Staged $DEST/photopipe-core-$TRIPLE"
