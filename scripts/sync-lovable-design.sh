#!/usr/bin/env bash
# Mirror the design system into the Lovable project, where src/routes/design.tsx serves it at /design.
# It gets its own copy of src/ in src/design-system/ and its own atlas, so it never fights the demo's
# sync (scripts/sync-lovable.sh) when this branch and the demo's branch are at different points.
# By default the Sprout Lands packs are not copied, and the pack pages show the frames the app uses.
# With --with-packs, the packs you imported (public/assets/sprout-lands) are copied into the Lovable
# repo's public/design-system/sprout-lands/ so its pack pages show the art (images and fonts only, no
# .aseprite sources, and no download links on the page). That is the owner's call
# for internal use: the Lovable repo is private, but anyone with the site's link can load those files.
# Never use it for this public repo.
# Usage: scripts/sync-lovable-design.sh <path to the Lovable repo clone> [--with-packs]
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)"
dst="${1:?path to the Lovable repo}"
with_packs="${2:-}"
out="$dst/src/design-system"
rm -rf "$out" && mkdir -p "$out"
( cd "$src/src" && tar cf - --exclude=main.tsx --exclude='*.test.ts' --exclude='*.test.tsx' . ) | ( cd "$out" && tar xf - )

# Its own atlas, so the demo's (possibly older) atlas.png never meets this atlas.json
mkdir -p "$dst/public/design-system" "$dst/public/brand"
cp "$src/public/sprites/atlas.png" "$dst/public/design-system/atlas.png"
cp "$src/public/brand/"* "$dst/public/brand/"
grep -rlE "'/sprites/atlas.png'|url\(/sprites/atlas.png" "$out" | xargs sed -i -E "s#'/sprites/atlas.png'#'/design-system/atlas.png'#g; s#url\(/sprites/atlas.png#url(/design-system/atlas.png#g"

# Stand in for the virtual:sprout-lands module (a Vite plugin here) with a plain JSON list.
if [ "$with_packs" = "--with-packs" ]; then
  [ -d "$src/public/assets/sprout-lands" ] || { echo "No packs imported: run npm run assets first" >&2; exit 1; }
  rm -rf "$dst/public/design-system/sprout-lands" && mkdir -p "$dst/public/design-system/sprout-lands"
  # The art only: images and fonts, never the .aseprite sources or anything else in the packs
  ( cd "$src/public/assets/sprout-lands" && find . -mindepth 2 -type f \( -iname '*.png' -o -iname '*.gif' -o -iname '*.ttf' -o -iname '*.otf' \) -not -path '*/__MACOSX/*' -print0 \
    | tar cf - --null -T - ) | ( cd "$dst/public/design-system/sprout-lands" && tar xf - )
  ( cd "$src" && node --experimental-strip-types --no-warnings scripts/pack-index.ts /design-system/sprout-lands/ ) > "$out/design/sprout-lands.json"
elif [ -d "$dst/public/design-system/sprout-lands" ]; then
  # Packs were synced before: keep serving them, and keep their list in step with the manifest
  ( cd "$src" && node --experimental-strip-types --no-warnings scripts/pack-index.ts /design-system/sprout-lands/ ) > "$out/design/sprout-lands.json"
else
  echo '{"missing":true,"packs":[],"files":[]}' > "$out/design/sprout-lands.json"
fi
printf '%s\n' "import type data from 'virtual:sprout-lands'" "export type { PackId, FileKind, PackInfo, PackFile } from 'virtual:sprout-lands'" "import json from './sprout-lands.json'" "export default json as unknown as typeof data" > "$out/design/sprout-lands-stub.ts"
grep -rl "virtual:sprout-lands" "$out/design/pages" | xargs sed -i "s#'virtual:sprout-lands'#'../sprout-lands-stub'#"

# Two pages read files from the repo root: bring them inside the copy
mkdir -p "$out/art"
cp "$src/art/manifest.json" "$out/art/manifest.json"
cp "$src/GENERATED.md" "$out/GENERATED.md"
sed -i "s#'../../../art/manifest.json'#'../../art/manifest.json'#; s#'../../../GENERATED.md?raw'#'../../GENERATED.md?raw'#" "$out/design/pages/Art.tsx" "$out/design/pages/Workflow.tsx"
if grep -rn "'\.\./\.\./\.\./" "$out/design"; then echo "An import still reaches outside src/" >&2; exit 1; fi
echo "Synced the design system $src -> $out"
