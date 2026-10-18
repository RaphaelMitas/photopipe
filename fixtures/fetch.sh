#!/usr/bin/env bash
# Fetch CC0-licensed sample raw files from raw.pixls.us into fixtures/raw/.
# Real raws are 25-80 MB and stay out of git; CI caches this directory.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p raw

resolve_url() {
  # Prints the download URL for the first CC0 sample of the given camera model.
  python3 - "$1" <<'PY'
import json
import re
import sys
import urllib.parse
import urllib.request

model = sys.argv[1]
with urllib.request.urlopen("https://raw.pixls.us/json/getrepository.php?set=all") as response:
    rows = json.load(response)["data"]
for row in rows:
    make, cam_model, _variant = row[0], row[1], row[2]
    license_html, file_html = row[5], row[7]
    if cam_model == model and "zero" in license_html:
        match = re.search(r"href='([^']+)'", file_html)
        if match:
            print(urllib.parse.quote(match.group(1), safe=":/"))
            sys.exit(0)
sys.exit(f"no CC0 sample found for model {model}")
PY
}

fetch_model() {
  local model="$1" out="$2"
  if [ -f "raw/$out" ]; then
    echo "cached: raw/$out"
    return
  fi
  local url
  url=$(resolve_url "$model")
  echo "downloading $model sample…"
  curl -fSL --retry 3 -o "raw/$out.part" "$url"
  mv "raw/$out.part" "raw/$out"
  echo "fetched: raw/$out"
}

# Sony bodies: A7 IV to match the real shoots, A7 III as a second variant.
fetch_model "ILCE-7M4" "sony-a7iv.arw"
fetch_model "ILCE-7M3" "sony-a7iii.arw"

# One body per other raw family ImageIO decodes, for the per-brand round trips.
fetch_model "EOS 5D Mark IV" "canon-5d4.cr2"
fetch_model "EOS R6" "canon-r6.cr3"
fetch_model "Z 6_2" "nikon-z6ii.nef"
fetch_model "X-T3" "fujifilm-xt3.raf"
fetch_model "E-M1MarkIII" "olympus-em1iii.orf"
fetch_model "DC-S5" "panasonic-s5.rw2"
fetch_model "K-1" "pentax-k1.pef"
