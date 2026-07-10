#!/usr/bin/env bash
# Regenerate AppIcon.icns from ImageMagick primitives (SVG strokes are unreliable in IM).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

magick -size 1024x1024 xc:'#00000000' \
  -fill '#12241F' -draw 'roundrectangle 64,64 960,960 200,200' \
  -stroke '#3DDBB0' -strokewidth 56 -fill none \
  -draw 'line 512,292 512,732' \
  -draw 'line 512,472 722,292' \
  -fill '#9AF5DE' -stroke none \
  -draw 'circle 512,292 512,240' \
  -draw 'circle 512,512 512,460' \
  -draw 'circle 512,732 512,680' \
  -draw 'circle 722,292 722,240' \
  AppIcon-1024.png

ICONSET="AppIcon.iconset"
rm -rf "$ICONSET"
mkdir "$ICONSET"
magick AppIcon-1024.png -resize 16x16   "$ICONSET/icon_16x16.png"
magick AppIcon-1024.png -resize 32x32   "$ICONSET/icon_16x16@2x.png"
magick AppIcon-1024.png -resize 32x32   "$ICONSET/icon_32x32.png"
magick AppIcon-1024.png -resize 64x64   "$ICONSET/icon_32x32@2x.png"
magick AppIcon-1024.png -resize 128x128 "$ICONSET/icon_128x128.png"
magick AppIcon-1024.png -resize 256x256 "$ICONSET/icon_128x128@2x.png"
magick AppIcon-1024.png -resize 256x256 "$ICONSET/icon_256x256.png"
magick AppIcon-1024.png -resize 512x512 "$ICONSET/icon_256x256@2x.png"
magick AppIcon-1024.png -resize 512x512 "$ICONSET/icon_512x512.png"
magick AppIcon-1024.png -resize 1024x1024 "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o AppIcon.icns
rm -rf "$ICONSET" AppIcon-1024.png
echo "Wrote $ROOT/AppIcon.icns"
