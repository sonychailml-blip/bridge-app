#!/usr/bin/env bash
# Regenerate PWA icons from the master SVGs into public/.
# Requires librsvg (rsvg-convert). On Windows/msys2: pacman -S mingw-w64-x86_64-librsvg
set -e
cd "$(dirname "$0")/.."

RSVG="${RSVG:-rsvg-convert}"

"$RSVG" -w 192 -h 192 scripts/pwa-icon.svg          -o public/pwa-192x192.png
"$RSVG" -w 512 -h 512 scripts/pwa-icon.svg          -o public/pwa-512x512.png
"$RSVG" -w 512 -h 512 scripts/pwa-icon-maskable.svg -o public/maskable-512x512.png
"$RSVG" -w 180 -h 180 scripts/pwa-icon.svg          -o public/apple-touch-icon-180.png

echo "PWA icons regenerated in public/"
