# Sprout Lands packs

This folder holds the four Sprout Lands asset packs by Cup Nooble, unzipped:

- Sprout Lands - Sprites - premium pack
- Sprout Lands - Sprites - Basic pack
- Sprout Lands - UI Pack - Premium pack
- Sprout Lands - UI Pack - Basic pack

Everything here except this README is git-ignored. The license lets us use the art in an
open-source project with credit, but not redistribute the packs themselves, so each person
downloads them from https://cupnooble.itch.io/sprout-lands-asset-pack and imports their own copy:

    npm run assets -- ~/Downloads/sprout-lands

That folder can hold the zips (any names) or the unzipped packs.

What uses them:

- The design library (npm run design, then Art) browses every file in the packs.
- `npm run art:atlas` cuts the frames listed in `art/manifest.json` into the committed atlas
  (`public/sprites/atlas.png`, `src/map/atlas.json`). The app only ever loads that atlas,
  so it runs without this folder.
- `npm run art:check` confirms the committed atlas still matches the manifest.

Credit: Sprout Lands by Cup Nooble.
