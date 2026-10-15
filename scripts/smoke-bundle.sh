#!/usr/bin/env bash
# Prove a built .app is self-contained.
#
# The unit and e2e suites all run from a checkout, where exiftool is findable
# through dev paths. None of them can tell you whether the *bundle* works.
# This runs the bundled exiftool with a deliberately bare PATH and no env
# overrides, so anything it cannot find inside itself is a failure.
#
# --mas checks the signed App Store build: entitlements, no updater, and what the store's review rejects.
set -euo pipefail

cd "$(dirname "$0")/.."

fail() { echo "::error::$1" >&2; exit 1; }

MAS=false
APP=""
for arg in "$@"; do
  case "$arg" in
    --mas) MAS=true ;;
    *) APP="$arg" ;;
  esac
done
APP="${APP:-apps/desktop/src-tauri/target/release/bundle/macos/Photopipe.app}"

[ -d "$APP" ] || fail "No app bundle at $APP (run: pnpm --filter desktop tauri build --bundles app)"

echo "Smoke testing $APP"

EXIFTOOL="$APP/Contents/Resources/exiftool/exiftool"
[ -x "$EXIFTOOL" ] || fail "Bundle is missing an executable Contents/Resources/exiftool/exiftool"
echo "  contents: exiftool present"

if [ "$MAS" = true ]; then
  entitlement_keys() {
    codesign -d --entitlements - --xml "$1" 2>/dev/null | /usr/bin/python3 -c '
import plistlib, sys
raw = sys.stdin.buffer.read()
print("\n".join(sorted(plistlib.loads(raw))) if raw else "")'
  }

  APP_KEYS=$(entitlement_keys "$APP")
  for key in \
    com.apple.application-identifier \
    com.apple.developer.team-identifier \
    com.apple.security.app-sandbox \
    com.apple.security.network.client \
    com.apple.security.files.user-selected.read-write \
    com.apple.security.files.bookmarks.app-scope; do
    grep -qx "$key" <<<"$APP_KEYS" || fail "app is missing entitlement $key"
  done
  BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Contents/Info.plist")
  codesign -d --entitlements - --xml "$APP" 2>/dev/null | grep -q ">[A-Z0-9]*\.$BUNDLE_ID<" \
    || fail "application-identifier does not match the bundle id $BUNDLE_ID"
  echo "  entitlements: app sandboxed with bookmarks"

  /usr/libexec/PlistBuddy -c "Print :LSApplicationCategoryType" "$APP/Contents/Info.plist" >/dev/null 2>&1 \
    || fail "Info.plist has no LSApplicationCategoryType; App Store Connect refuses the upload without one"
  [ -f "$APP/Contents/embedded.provisionprofile" ] || fail "no embedded.provisionprofile; the identity entitlements need one"

  EXECUTABLE=$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$APP/Contents/Info.plist")
  if grep -qa -e tauri_plugin_updater -e releases/latest/download/latest.json "$APP/Contents/MacOS/$EXECUTABLE"; then
    fail "the updater or its feed URL is still compiled into $EXECUTABLE"
  fi
  echo "  updater:  absent from the binary"

  MACOS_DIR=$(ls "$APP/Contents/MacOS" | sort | tr '\n' ' ')
  if [ "$MACOS_DIR" != "$EXECUTABLE " ]; then
    fail "Contents/MacOS must hold only the app executable, has: $MACOS_DIR"
  fi
  UNREADABLE=$(find "$APP" ! -perm -o=r)
  [ -z "$UNREADABLE" ] || fail "not world-readable, the store rejects the pkg: $UNREADABLE"
  ENCRYPTION=$(/usr/libexec/PlistBuddy -c "Print :ITSAppUsesNonExemptEncryption" "$APP/Contents/Info.plist" 2>/dev/null || true)
  [ "$ENCRYPTION" = false ] || fail "Info.plist needs ITSAppUsesNonExemptEncryption=false, has '$ENCRYPTION'"
  echo "  layout:   world-readable, MacOS holds the one executable, encryption declared"
  echo "App Store flavour is in order."
  exit 0
fi

ROOT=$(mktemp -d -t photopipe-smoke)
trap 'rm -rf "$ROOT"' EXIT
SIDECAR="$ROOT/SMOKE1.xmp"
env -i PATH=/usr/bin:/bin HOME="$ROOT" "$EXIFTOOL" -q -XMP:Rating=4 -o "$SIDECAR" \
  || fail "the bundled exiftool did not run"
grep -q "<xmp:Rating>4</xmp:Rating>" "$SIDECAR" || fail "sidecar written but the rating is missing"
echo "  exiftool: XMP sidecar written with the rating"
echo "Bundle is self-contained."
