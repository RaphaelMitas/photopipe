#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="13.59"
SHA256="668ea3acececb7235fbd0f4900e72d5f12c9b07e5c778fd36cb1e9b5828fd65a"
DEST="apps/desktop/src-tauri/resources/exiftool"
URL="https://sourceforge.net/projects/exiftool/files/Image-ExifTool-${VERSION}.tar.gz/download"

if [ -x "$DEST/exiftool" ] && [ "${1:-}" != "--force" ]; then
  echo "exiftool already vendored at $DEST (use --force to refetch)"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Fetching $URL"
curl -fsSL "$URL" -o "$TMP/exiftool.tar.gz"

ACTUAL="$(shasum -a 256 "$TMP/exiftool.tar.gz" | awk '{print $1}')"
if [ "$ACTUAL" != "$SHA256" ]; then
  echo "::error::exiftool checksum mismatch" >&2
  echo "  expected $SHA256" >&2
  echo "  actual   $ACTUAL" >&2
  echo "If you are deliberately bumping VERSION, update SHA256 to the above." >&2
  exit 1
fi

tar -xzf "$TMP/exiftool.tar.gz" -C "$TMP"
SRC="$TMP/Image-ExifTool-${VERSION}"

rm -rf "$DEST"
mkdir -p "$DEST"
cp "$SRC/exiftool" "$DEST/exiftool"
cp "$SRC/README" "$SRC/Changes" "$DEST/"
cp -R "$SRC/lib" "$DEST/lib"
chmod +x "$DEST/exiftool"

echo "Vendored exiftool $VERSION into $DEST ($(du -sh "$DEST" | cut -f1))"
