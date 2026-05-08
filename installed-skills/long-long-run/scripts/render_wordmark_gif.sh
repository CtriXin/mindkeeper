#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

HTML_URL="$(python3 - <<'PY'
from pathlib import Path

print(Path("assets/wordmark.html").resolve().as_uri())
PY
)"

OUT="$ROOT_DIR/assets/wordmark.gif"
FRAMES="${FRAMES:-48}"
FPS="${FPS:-15}"
WIDTH="${WIDTH:-520}"
HEIGHT="${HEIGHT:-120}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

for ((i = 0; i < FRAMES; i++)); do
  t="$(python3 - <<PY
frames = $FRAMES
i = $i
print(f"{i / frames:.6f}")
PY
)"
  npx --yes playwright screenshot \
    --browser chromium \
    --viewport-size "$WIDTH,$HEIGHT" \
    --wait-for-selector 'body[data-ready="true"]' \
    "${HTML_URL}?t=${t}" \
    "$TMP_DIR/frame_$(printf "%03d" "$i").png" >/dev/null
done

ffmpeg -y -hide_banner -loglevel error \
  -framerate "$FPS" \
  -i "$TMP_DIR/frame_%03d.png" \
  -vf "palettegen=stats_mode=full:reserve_transparent=0" \
  "$TMP_DIR/palette.png"

ffmpeg -y -hide_banner -loglevel error \
  -framerate "$FPS" \
  -i "$TMP_DIR/frame_%03d.png" \
  -i "$TMP_DIR/palette.png" \
  -lavfi "paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 \
  "$OUT"

printf 'Wrote %s\n' "$OUT"
