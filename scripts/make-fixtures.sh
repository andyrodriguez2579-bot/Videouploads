#!/usr/bin/env bash
# Regenerates the binary test fixtures. Committed output is small, but this
# records exactly how it was made so nobody has to guess.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p tests/fixtures

# 12 seconds of quiet tone standing in for narration. Deliberately about 24 dB
# down so the render's loudnorm pass has something real to correct.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=220:duration=12" \
  -af "volume=-24dB" -c:a libmp3lame -b:a 128k \
  tests/fixtures/narration.mp3

echo "wrote tests/fixtures/narration.mp3"
