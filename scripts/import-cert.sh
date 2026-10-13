#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: import-cert.sh <keychain path> <tool>..." >&2
  exit 2
fi
: "${CERTIFICATE:?}" "${CERTIFICATE_PASSWORD:?}"

KEYCHAIN_PATH="$1"
shift
ALLOWED_TOOLS=()
for tool in "$@"; do
  ALLOWED_TOOLS+=(-T "$tool")
done

KEYCHAIN_PASSWORD="$(openssl rand -base64 32)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

echo "$CERTIFICATE" | base64 --decode > "$TMP/certificate.p12"
security import "$TMP/certificate.p12" -P "$CERTIFICATE_PASSWORD" \
  "${ALLOWED_TOOLS[@]}" -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
security set-key-partition-list -S apple-tool:,apple: -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security list-keychain -d user -s "$KEYCHAIN_PATH"
