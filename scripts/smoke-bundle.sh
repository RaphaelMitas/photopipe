#!/usr/bin/env bash
# Prove a built .app is self-contained: it links only what the OS ships, and
# its core opens a library and writes a rating through the bundled exiftool
# with a bare env, which a checkout's dev paths would mask.
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

EXECUTABLE=$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$APP/Contents/Info.plist")
BINARY="$APP/Contents/MacOS/$EXECUTABLE"
otool -l "$BINARY" | grep -A2 LC_RPATH | grep -q "path /usr/lib/swift " \
  || fail "$EXECUTABLE has no rpath to the Swift runtime in /usr/lib/swift"
FOREIGN=$(otool -L "$BINARY" | tail -n +2 | awk '{print $1}' \
  | grep -vE '^(/usr/lib/|/System/Library/|@rpath/libswift)' || true)
[ -z "$FOREIGN" ] || fail "$EXECUTABLE links outside the OS: $FOREIGN"
echo "  linkage:  OS libraries only, Swift runtime through /usr/lib/swift"

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
  echo "  skipped:  driving the core; a store-signed binary only launches from the store"
  exit 0
fi

BINARY="$BINARY" exec /usr/bin/python3 - <<'PY'
import json, os, shutil, subprocess, sys, tempfile

root = tempfile.mkdtemp(prefix="photopipe-smoke-")
shoot = "2026-01-01_smoke"
photo = os.path.join(root, shoot, "original", "SMOKE1.ARW")
os.makedirs(os.path.dirname(photo))
open(photo, "w").write("not really a raw")

# No Homebrew, no PHOTOPIPE_* overrides: whatever the core reaches for has to
# come from inside the bundle.
env = {"PATH": "/usr/bin:/bin", "HOME": root}
proc = subprocess.Popen(
    [os.environ["BINARY"], "--core"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=env
)

def call(method, params=None):
    proc.stdin.write(json.dumps({"method": method, "params": params}) + "\n")
    proc.stdin.flush()
    line = proc.stdout.readline()
    if not line:
        sys.exit("::error::the app exited while handling %s" % method)
    response = json.loads(line)
    if not response["ok"]:
        sys.exit("::error::%s failed: %s" % (method, response["error"]))
    return response["result"]

try:
    scanned = call("setRoot", {"path": root, "indexPath": os.path.join(root, "index.sqlite")})
    if scanned["shoots"] != 1:
        sys.exit("::error::expected 1 shoot, saw %s" % scanned["shoots"])
    print("  core:     the app binary scanned %s shoot, %s file" % (scanned["shoots"], scanned["files"]))

    # The real proof: writing a rating means the core found the bundled exiftool.
    call("setRating", {"shoot": shoot, "path": photo, "rating": 4})
    sidecar = os.path.join(root, shoot, "original", "SMOKE1.xmp")
    if not os.path.exists(sidecar) or "4" not in open(sidecar).read():
        sys.exit("::error::no XMP sidecar with the rating; the bundled exiftool did not run")
    print("  exiftool: XMP sidecar written with the rating")
finally:
    try:
        proc.stdin.close()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()
    shutil.rmtree(root, ignore_errors=True)

print("Bundle is self-contained.")
PY
