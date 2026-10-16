#!/usr/bin/env bash
# What's New for one platform's store listing: fastlane/whats-new/<tag>-<platform>.txt
# when a release has one, else the app's feat and fix commits between two tags,
# minus those that name only the other platform.
set -euo pipefail

FROM="$1"
TO="$2"
LIMIT=3900 # App Store Connect caps What's New at 4000 characters
MAC='mac|macos|dmg'
IPAD='ipad|ipados|ios'
case "$3" in
  mac) OWN="$MAC" OTHER="$IPAD" ;;
  ipad) OWN="$IPAD" OTHER="$MAC" ;;
  *) echo "platform must be mac or ipad, got '$3'" >&2; exit 1 ;;
esac

OVERRIDE="$(dirname "$0")/../fastlane/whats-new/$TO-$3.txt"
if [ -f "$OVERRIDE" ]; then
  cat "$OVERRIDE"
  exit 0
fi

NOTES=$(git log --no-merges --format=%s "$FROM..$TO" -- apps/desktop core \
  | awk -v own="(^|[^a-z])($OWN)([^a-z]|\$)" -v other="(^|[^a-z])($OTHER)([^a-z]|\$)" \
    '{ line = tolower($0) } line ~ own || line !~ other' \
  | sed -nE 's/^(feat|fix)(\([^)]*\))?: (.*)$/\3/p' \
  | sed -E 's/ \(#[0-9]+\)$//' \
  | awk '{ print "• " toupper(substr($0, 1, 1)) substr($0, 2) }' \
  | awk -v limit="$LIMIT" '{ length_so_far += length($0) + 1; if (length_so_far > limit) exit; print }')
echo "${NOTES:-Fixes and improvements.}"
