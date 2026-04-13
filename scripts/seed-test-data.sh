#!/bin/bash
# Creates a test folder structure for local development
set -e

BASE="./test-data/Camera"
rm -rf "$BASE"

echo "Creating test data at $BASE..."

# Shoot 1: Empty shoot (just created, no files yet)
mkdir -p "$BASE/2026-04-10_spring-concert/raw"
mkdir -p "$BASE/2026-04-10_spring-concert/denoised"
mkdir -p "$BASE/2026-04-10_spring-concert/exports"
mkdir -p "$BASE/2026-04-10_spring-concert/.thumbs"

# Shoot 2: Has raw ARWs + some denoised DNGs (denoising in progress)
mkdir -p "$BASE/2026-04-05_dance-recital/raw"
mkdir -p "$BASE/2026-04-05_dance-recital/denoised"
mkdir -p "$BASE/2026-04-05_dance-recital/exports"
mkdir -p "$BASE/2026-04-05_dance-recital/.thumbs"
for i in $(seq 1 10); do
  dd if=/dev/zero of="$BASE/2026-04-05_dance-recital/raw/DSC$(printf '%05d' $i).ARW" bs=1024 count=50 2>/dev/null
done
for i in $(seq 1 10); do
  dd if=/dev/zero of="$BASE/2026-04-05_dance-recital/denoised/DSC$(printf '%05d' $i).dng" bs=1024 count=100 2>/dev/null
done

# Shoot 3: Has exports (fully done)
mkdir -p "$BASE/2026-03-20_studio-session/raw"
mkdir -p "$BASE/2026-03-20_studio-session/denoised"
mkdir -p "$BASE/2026-03-20_studio-session/exports"
mkdir -p "$BASE/2026-03-20_studio-session/.thumbs"
for i in $(seq 1 8); do
  dd if=/dev/zero of="$BASE/2026-03-20_studio-session/denoised/DSC$(printf '%05d' $i).dng" bs=1024 count=100 2>/dev/null
done
# Create minimal valid JPEG placeholders for thumbnail testing
for i in $(seq 1 3); do
  printf '\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9' > "$BASE/2026-03-20_studio-session/exports/DSC$(printf '%05d' $i).jpg"
done

# Legacy folder (should be ignored — no YYYY-MM-DD_ prefix)
mkdir -p "$BASE/Bingen/Exports"

echo "Done! Test data created at $BASE"
echo ""
echo "Shoots:"
ls -1 "$BASE" | grep -v '^\.'
