#!/usr/bin/env bash
# Mirror the design system into the Lovable project, where src/routes/design.tsx serves it at /design.
# It gets its own copy of src/ in src/design-system/ and its own atlas, so it never fights the demo's
# sync (scripts/sync-lovable.sh) when this branch and the demo's branch are at different points.
# The Sprout Lands packs are not copied (they may not be redistributed): the pack browser pages
# show their "packs not imported" note there, and every other page works.
# Usage: scripts/sync-lovable-design.sh <path to the Lovable repo clone>
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)"
dst="${1:?path to the Lovable repo}"
out="$dst/src/design-system"
rm -rf "$out" && mkdir -p "$out"
( cd "$src/src" && tar cf - --exclude=main.tsx --exclude='*.test.ts' --exclude='*.test.tsx' . ) | ( cd "$out" && tar xf - )

# Its own atlas, so the demo's (possibly older) atlas.png never meets this atlas.json
mkdir -p "$dst/public/design-system" "$dst/public/brand"
cp "$src/public/sprites/atlas.png" "$dst/public/design-system/atlas.png"
cp "$src/public/brand/"* "$dst/public/brand/"
grep -rlE "'/sprites/atlas.png'|url\(/sprites/atlas.png" "$out" | xargs sed -i -E "s#'/sprites/atlas.png'#'/design-system/atlas.png'#g; s#url\(/sprites/atlas.png#url(/design-system/atlas.png#g"

# No packs here: stand in for the virtual:sprout-lands module with an empty list
sed -n "/declare module 'virtual:sprout-lands'/,/^}/p" "$src/src/design/sprout-lands.d.ts" \
  | sed "1d;\$d" | sed 's/^  //' | grep -v -E '^(const data|export default)' > "$out/design/sprout-lands-stub.ts"
printf '%s\n' "const data: { missing: boolean; packs: PackInfo[]; files: PackFile[] } = { missing: true, packs: [], files: [] }" 'export default data' >> "$out/design/sprout-lands-stub.ts"
rm -f "$out/design/sprout-lands.d.ts"
grep -rl "virtual:sprout-lands" "$out" | xargs sed -i "s#'virtual:sprout-lands'#'../sprout-lands-stub'#"
# Two pages read files from the repo root: bring them inside the copy
mkdir -p "$out/art"
cp "$src/art/manifest.json" "$out/art/manifest.json"
cp "$src/GENERATED.md" "$out/GENERATED.md"
sed -i "s#'../../../art/manifest.json'#'../../art/manifest.json'#; s#'../../../GENERATED.md?raw'#'../../GENERATED.md?raw'#" "$out/design/pages/Art.tsx" "$out/design/pages/Workflow.tsx"
if grep -rn "'\.\./\.\./\.\./" "$out/design"; then echo "An import still reaches outside src/" >&2; exit 1; fi
echo "Synced the design system $src -> $out"
