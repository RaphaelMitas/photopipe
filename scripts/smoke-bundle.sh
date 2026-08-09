#!/usr/bin/env bash
# Prove a built .app is self-contained.
#
# The unit and e2e suites all run from a checkout, where the Swift core and
# exiftool are findable through dev paths. None of them can tell you whether
# the *bundle* works. This drives the core out of the built app with a
# deliberately bare PATH and no env overrides, so anything it cannot find
# inside itself is a failure.
set -euo pipefail

cd "$(dirname "$0")/.."

APP="${1:-apps/desktop/src-tauri/target/release/bundle/macos/Photopipe.app}"

if [ ! -d "$APP" ]; then
  echo "::error::No app bundle at $APP (run: pnpm --filter desktop tauri build --bundles app)" >&2
  exit 1
fi

echo "Smoke testing $APP"

for required in "Contents/MacOS/photopipe-core" "Contents/Resources/exiftool/exiftool"; do
  if [ ! -f "$APP/$required" ]; then
    echo "::error::Bundle is missing $required" >&2
    exit 1
  fi
done
echo "  contents: core and exiftool present"

APP="$APP" exec /usr/bin/python3 - <<'PY'
import json, os, shutil, subprocess, sys, tempfile

app = os.path.abspath(os.environ["APP"])
core = os.path.join(app, "Contents/MacOS/photopipe-core")
root = tempfile.mkdtemp(prefix="photopipe-smoke-")
shoot = "2026-01-01_smoke"
os.makedirs(os.path.join(root, shoot, "original"))
open(os.path.join(root, shoot, "original", "SMOKE1.ARW"), "w").write("not really a raw")

# No Homebrew, no PHOTOPIPE_* overrides: whatever the core reaches for now
# has to come from inside the bundle.
env = {"PATH": "/usr/bin:/bin", "HOME": os.environ.get("HOME", root)}
proc = subprocess.Popen(
    [core], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=env
)

def call(method, params=None, request_id="1"):
    proc.stdin.write(json.dumps({"v": 1, "id": request_id, "method": method, "params": params}) + "\n")
    proc.stdin.flush()
    line = proc.stdout.readline()
    if not line:
        sys.exit("::error::core exited while handling %s" % method)
    return json.loads(line)

def require(response, what):
    if not response.get("ok"):
        sys.exit("::error::%s failed: %s" % (what, response.get("error")))
    return response["result"]

try:
    version = require(call("version"), "version")
    print("  version:  core %s, protocol %s" % (version["version"], version["protocol"]))

    scanned = require(
        call("setRoot", {"path": root, "indexPath": os.path.join(root, "index.sqlite")}, "2"),
        "setRoot",
    )
    if scanned["shoots"] != 1:
        sys.exit("::error::expected 1 shoot, saw %s" % scanned["shoots"])
    print("  scan:     %s shoot, %s file" % (scanned["shoots"], scanned["files"]))

    # The real proof: writing a rating means the bundled exiftool ran.
    require(call("setRating", {"shoot": shoot, "stem": "SMOKE1", "rating": 4}, "3"), "setRating")
    sidecar = os.path.join(root, shoot, "original", "SMOKE1.xmp")
    if not os.path.exists(sidecar):
        sys.exit("::error::no XMP sidecar written; bundled exiftool did not run")
    if "4" not in open(sidecar).read():
        sys.exit("::error::sidecar written but the rating is missing")
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
