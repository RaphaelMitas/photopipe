#!/usr/bin/env bash
set -euo pipefail

WEIGHTS_URL=https://huggingface.co/smartywu/big-lama/resolve/05cb2be7f8dbe6ca7c6e78f4fc827a4b2baaa4a9/big-lama.zip
WEIGHTS_SHA256=f1b358ca24093b93a106183b98a3dea6e8ed09f3b43ea7251eb2c81e7b4575f6
CODE_COMMIT=786f5936b27fb3dacd2b1ad799e4de968ea697e7
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${1:?usage: build-lama.sh <empty output folder>}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/weights" "$WORK/code" "$OUT"
export UV_CACHE_DIR="$WORK/uv-cache" UV_PYTHON_INSTALL_DIR="$WORK/uv-python"

curl -fsSL -o "$WORK/weights/big-lama.zip" "$WEIGHTS_URL"
echo "$WEIGHTS_SHA256  $WORK/weights/big-lama.zip" | shasum -a 256 -c -
unzip -q "$WORK/weights/big-lama.zip" -d "$WORK/weights"
curl -fsSL "https://codeload.github.com/advimman/lama/tar.gz/$CODE_COMMIT" | tar xz -C "$WORK/code"

uv venv -q --python 3.11 "$WORK/venv"
uv pip install -q --python "$WORK/venv/bin/python" torch==2.5.1 coremltools==8.3.0 numpy==2.2.6 kornia==0.7.4
"$WORK/venv/bin/python" -I "$HERE/convert-lama.py" \
  --code "$WORK/code/lama-$CODE_COMMIT" \
  --checkpoint "$WORK/weights/big-lama/models/best.ckpt" \
  --out "$OUT/BigLaMa.mlpackage"

cd "$OUT/BigLaMa.mlpackage"
for file in Manifest.json Data/com.apple.CoreML/model.mlmodel Data/com.apple.CoreML/weights/weight.bin; do
  printf '%s %s %s\n' "$(shasum -a 256 "$file" | cut -d' ' -f1)" "$(stat -f %z "$file")" "$file"
done
