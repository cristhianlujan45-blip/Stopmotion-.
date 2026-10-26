#!/usr/bin/env bash
# The macOS app is universal (Intel + Apple Silicon), but ffmpeg-static only
# downloads the binary of the machine that builds it. Join both into one.
set -euo pipefail
cd "$(dirname "$0")/.."
TAG=$(node -p "require('ffmpeg-static/package.json')['ffmpeg-static']['binary-release-tag']")
TMP=$(mktemp -d)
for ARCH in x64 arm64; do
  curl -sSfL -o "$TMP/ffmpeg-$ARCH.gz" "https://github.com/eugeneware/ffmpeg-static/releases/download/$TAG/ffmpeg-darwin-$ARCH.gz"
  gunzip -f "$TMP/ffmpeg-$ARCH.gz"
done
lipo -create "$TMP/ffmpeg-x64" "$TMP/ffmpeg-arm64" -output node_modules/ffmpeg-static/ffmpeg
chmod +x node_modules/ffmpeg-static/ffmpeg
lipo -info node_modules/ffmpeg-static/ffmpeg
