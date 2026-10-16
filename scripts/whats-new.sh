#!/usr/bin/env bash
# What's New for the App Store: the app's feat and fix commits between two tags.
set -euo pipefail

FROM="$1"
TO="$2"

NOTES=$(git log --no-merges --format=%s "$FROM..$TO" -- apps/desktop core \
  | sed -nE 's/^(feat|fix)(\([^)]*\))?: (.*)$/\3/p' \
  | sed -E 's/ \(#[0-9]+\)$//' \
  | awk '{ print "• " toupper(substr($0, 1, 1)) substr($0, 2) }' \
  | awk '{ length_so_far += length($0) + 1; if (length_so_far > 3900) exit; print }')
echo "${NOTES:-Fixes and improvements.}"
