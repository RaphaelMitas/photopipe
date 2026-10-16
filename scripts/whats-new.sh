#!/usr/bin/env bash
# What's New for one platform's store listing: the app's feat and fix commits
# between two tags, minus those that name the other platform.
set -euo pipefail

FROM="$1"
TO="$2"
LIMIT=3900 # App Store Connect caps What's New at 4000 characters
case "$3" in
  mac) OTHER='\b(ipad|ipados|ios)\b' ;;
  ipad) OTHER='\b(mac|macos|dmg)\b' ;;
  *) echo "platform must be mac or ipad, got '$3'" >&2; exit 1 ;;
esac

NOTES=$(git log --no-merges --format=%s "$FROM..$TO" -- apps/desktop core \
  | sed -nE 's/^(feat|fix)(\([^)]*\))?: (.*)$/\3/p' \
  | { grep -viE "$OTHER" || true; } \
  | sed -E 's/ \(#[0-9]+\)$//' \
  | awk '{ print "• " toupper(substr($0, 1, 1)) substr($0, 2) }' \
  | awk -v limit="$LIMIT" '{ length_so_far += length($0) + 1; if (length_so_far > limit) exit; print }')
echo "${NOTES:-Fixes and improvements.}"
