#!/bin/bash
# Creates a v2 test tree for local development.
set -e

BASE="${1:-./test-data/Camera}"
rm -rf "$BASE"
echo "Seeding $BASE..."

new_shoot() {
	mkdir -p "$BASE/$1"/{raw,denoised,exports,.thumbs}
	cat > "$BASE/$1/.photopipe.json" <<EOF
{
	"version": 2,
	"name": "$2",
	"date": "${1:0:10}",
	"createdAt": "${1:0:10}T09:00:00.000Z",
	"algorithm": ${3:-null},
	"notes": "",
	"rawCount": ${4:-null}
}
EOF
}

# Empty shoot, freshly created.
new_shoot "2026-04-10_spring-concert" "Spring Concert"

# Mid-denoise: raws uploaded, only some DNGs back from PureRAW.
new_shoot "2026-04-05_dance-recital" "Dance Recital" '"DeepPRIME XD3"' 10
for i in $(seq 1 10); do
	dd if=/dev/zero of="$BASE/2026-04-05_dance-recital/raw/DSC$(printf '%05d' "$i").ARW" bs=1024 count=50 2>/dev/null
done
for i in $(seq 1 6); do
	dd if=/dev/zero of="$BASE/2026-04-05_dance-recital/denoised/DSC$(printf '%05d' "$i").dng" bs=1024 count=100 2>/dev/null
done

# A folder that does not match YYYY-MM-DD_slug is ignored entirely.
mkdir -p "$BASE/Bingen/Exports"

echo "Done."
echo
echo "NOTE: these placeholder files are not real images, so thumbnails and XMP"
echo "writes will fail on them. Point CAMERA_BASE at a folder of real ARW/DNG"
echo "files to exercise rating, previews and downloads."
ls -1 "$BASE"
