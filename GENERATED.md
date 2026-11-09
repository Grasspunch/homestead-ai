# Generated files

Each file below is made from another one. Edit the source, then run the command. An edit to the output is lost the next time someone runs it. The library's Workflow page renders this table, so keep it here and only here.

| Output | Source of truth | Remake with | Drift check |
| --- | --- | --- | --- |
| `public/sprites/atlas.png`, `src/map/atlas.json` | `art/manifest.json`, cut from the packs in `public/assets/sprout-lands/` | `npm run art:atlas` | `npm run art:check` |
| `public/fonts/sprout-lands.ttf`, `public/cursor-paw.png` | The UI pack, listed under `copies` in `art/manifest.json` | `npm run art:atlas` | `npm run art:check` |
| `public/assets/sprout-lands/` (not committed) | The Sprout Lands zips from itch.io | `npm run assets -- <folder>` | None. Each person imports their own copy |
| `public/brand/*`, `public/favicon.*`, `public/apple-touch-icon.png` | The logo scripts in `/mnt/project-files/logo/source/`, outside the repo for now | `python3 export.py` there (it writes `logo/icon/` and `logo/options/`), then copy into `public/` | None |
| `shots/ref/*.png` | `scripts/shots/states.json`, rendered from the library and the app | `npm run shots -- --update`, in a change of its own | `npm run shots:check` |
| `src/homestead/` in the Lovable repo | This repo's `src/` and the files under `public/` the app loads | `scripts/sync-lovable.sh <lovable clone>` | None. Never edit there |
| The contrast table on the Color page | `src/ds/tokens.css`, graded against `scripts/contrast-pairs.json` | `npm run contrast -- --json` | `npm run contrast` |

## Notes no check carries

- The logo scripts live outside the repo, so nothing notices when `public/brand/` and the scripts disagree. Copy the whole set after every export.
- `public/cursor-paw-point.png`, `public/cursor-paw-hold.png` and `public/ui/emoji.png` were copied from the UI pack by hand. No script remakes them yet.
- `art/authored/` is source, not output: our own pixel art, committed, held to the palette by `npm run art:check`.
- Shot references change only on purpose. A change that alters the look fails `npm run shots:check`; land it first, then refresh the references in their own commit so the review sees the before and after.
- `shots/out/`, `shots/diff/` and `shots/crops/` are scratch and git-ignored.
- The Lovable mirror is overwritten whole on every sync. A fix made there is lost; make it here and sync again.
