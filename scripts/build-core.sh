#!/usr/bin/env bash
# Build the Swift core and stage it where Tauri expects a sidecar.
#
# Tauri's externalBin copies `binaries/<name>-<target-triple>` into the app
# bundle as `Contents/MacOS/<name>`, so the file has to carry the triple in
# its name even though we only ever build for the host.
set -euo pipefail

cd "$(dirname "$0")/.."

CONFIG="${1:-release}"
TRIPLE="$(rustc -vV | awk '/^host:/ {print $2}')"
DEST="apps/desktop/src-tauri/binaries"

echo "Building photopipe-core ($CONFIG) for $TRIPLE"
swift build --package-path core -c "$CONFIG"

mkdir -p "$DEST"
cp "core/.build/$CONFIG/photopipe-core" "$DEST/photopipe-core-$TRIPLE"
echo "Staged $DEST/photopipe-core-$TRIPLE"
