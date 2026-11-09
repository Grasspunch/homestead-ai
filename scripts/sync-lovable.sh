#!/usr/bin/env bash
# Mirror the demo into the Lovable project (a TanStack Start app).
# The app lives in src/homestead/ there; Lovable's own files stay untouched.
# Usage: scripts/sync-lovable.sh <path to the Lovable repo clone>
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)"
dst="${1:?path to the Lovable repo}"
mkdir -p "$dst/src/homestead" "$dst/public/sprites" "$dst/public/fonts"
rm -rf "$dst/src/homestead" && mkdir -p "$dst/src/homestead"
( cd "$src/src" && tar cf - --exclude=main.tsx . ) | ( cd "$dst/src/homestead" && tar xf - )
cp "$src/public/sprites/atlas.png" "$dst/public/sprites/atlas.png"
cp "$src/public/fonts/sprout-lands.ttf" "$dst/public/fonts/sprout-lands.ttf"
cp "$src/public/cursor-paw.png" "$dst/public/cursor-paw.png"
cp "$src/public/favicon.ico" "$dst/public/favicon.ico"
cp "$src/public/favicon.svg" "$dst/public/favicon.svg"
cp "$src/public/apple-touch-icon.png" "$dst/public/apple-touch-icon.png"
echo "Synced $src -> $dst"
