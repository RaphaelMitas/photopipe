#!/usr/bin/env bash
# Vendor the official Image-ExifTool distribution into the app bundle.
#
# exiftool is a Perl program, and macOS ships Perl at /usr/bin/perl, so the
# whole dependency is a directory of .pl/.pm files with no compilation and no
# Homebrew. Ratings are the one thing this app writes into your files; they
# must work on a Mac that has never seen a terminal.
#
# Licence: Perl Artistic / GPL, redistributable with the notices that live in
# the extracted tree (README, Changes).
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="13.59"
SHA256="668ea3acececb7235fbd0f4900e72d5f12c9b07e5c778fd36cb1e9b5828fd65a"
DEST="apps/desktop/src-tauri/resources/exiftool"
# SourceForge is exiftool's canonical release channel (exiftool.org links
# here); its per-version URLs stay available, unlike the site's own path which
# only serves the newest build.
URL="https://sourceforge.net/projects/exiftool/files/Image-ExifTool-${VERSION}.tar.gz/download"

if [ -x "$DEST/exiftool" ] && [ "${1:-}" != "--force" ]; then
  echo "exiftool already vendored at $DEST (use --force to refetch)"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Fetching $URL"
curl -fsSL "$URL" -o "$TMP/exiftool.tar.gz"

# Pin the payload: this lands inside a signed, notarized bundle.
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

# Ship only what runs: the script and its Perl modules. The distribution also
# carries an 8MB HTML manual and a 4MB test suite, which would go into every
# download and through notarization for nothing. README and Changes stay for
# the licence and attribution.
rm -rf "$DEST"
mkdir -p "$DEST"
cp "$SRC/exiftool" "$DEST/exiftool"
cp "$SRC/README" "$SRC/Changes" "$DEST/"
cp -R "$SRC/lib" "$DEST/lib"
chmod +x "$DEST/exiftool"

echo "Vendored exiftool $VERSION into $DEST ($(du -sh "$DEST" | cut -f1))"
