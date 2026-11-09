---
name: polish-art
description: "The visual polish loop for Homestead's pixel art: farm sprites, field glyphs (emotes, progress bars, signs), plates over the map, and pixel controls. Use when asked to polish, beautify, redraw, or make a sprite, glyph, plate or pixel control look better, read better or stand out, or when a pixel-art change 'doesn't show'. Covers the screenshot, crop-at-3x, self-critique loop, the resolution budget at the farm's integer scale, the palette rule, and the commit message."
---

# polish-art

Pixel art is judged by eye, at the size people see it, on the ground it sits on. This loop makes that judgement cheap and repeatable, and leaves a record of what was tried so the next person doesn't redo a dead end.

## The loop

```
1. Change the art            art/authored/<name>.png, or the frame in art/manifest.json, or the drawing code in src/map/render.ts
2. Rebuild what the app reads
                             npm run art:atlas      (manifest frames into public/sprites/atlas.png + src/map/atlas.json)
                             npm run art:check      (atlas drift and the palette; must pass)
3. Look at it in the library npm run design         (opens the library; crop-shot finds the server on 5173 or 5199)
4. Crop it at 3x             node scripts/crop-shot.mjs '#/glyphs' --el '<selector>' --name <name>
5. Read the crop             open shots/crops/<name>.png with the Read tool, then fill the checklist below
6. Not there yet?            back to 1. Each try must be visibly different from the last (crop-shot prints the changed pixels)
7. Checklist passes          send the crop to the person with the filled checklist, and wait for their word
8. They approve              commit with the iteration history (see "Commit message")
```

The person is the final judge of "does it read as a chicken / a check / a plate". Send a crop only once your own checklist has no ❌.

### Where each kind of art lives in the library

| Art | Library page | URL |
|---|---|---|
| Field glyphs: emotes, progress bars, signs, plot outlines | Field glyphs | `#/glyphs` |
| Every frame the app draws, by group | Art, Used by the app | `#/art/used` |
| A frame in the raw packs (before it is in the manifest) | Art, one page per pack | `#/art/sprites-premium`, `#/art/ui-premium`, ... |
| Plates, labels and pixel controls | Controls | `#/components` |
| The farm itself, in a real state | the app | `/?replay` on the same server |

Specimens sit on a `.ds-stage` with a ground picker (sheet, grass, soil, wet soil, water). Judge pixel art on the ground it will sit on in the farm, not on white.

### crop-shot

```
node scripts/crop-shot.mjs '#/glyphs' --el '.ds-stage >> nth=0' --name alert
node scripts/crop-shot.mjs '#/art/used' --clip 40,120,320,200 --name plots
node scripts/crop-shot.mjs '/?replay' --clip 0,0,640,400 --name farm          # the app, not the library
node scripts/crop-shot.mjs '#/glyphs' --el '.ds-stage >> nth=0' --name alert --at 1250   # a later idle frame
```

- Takes the picture at deviceScaleFactor 1 (what a person sees), then scales it 3x nearest-neighbour into `shots/crops/<name>.png` (git-ignored).
- Runs the page on a paused clock, so two runs of the same art give the same picture. `--at <ms>` picks the moment.
- Keeps the previous try as `<name>-prev.png` and prints how many screen pixels changed. Zero means the edit never reached the page: re-run `npm run art:atlas`, or check you edited the file the page reads.
- Prints the element's size in screen px and in art px at the farm's scale.
- Needs the dev server (step 3). `--base <url>` for another port.

## Resolution budget

The farm draws pixel art at whole multiples of `--px` (3px in `src/ds/tokens.css`), never in between. So one art pixel is a 3x3 block on screen.

- A farmhand is about 48 to 64 screen px tall (16 to 21 art px). Everything on the field is sized against that.
- Nothing under about 5 screen px carries meaning. At 3x that is 2 art px: a 1 px handle, stripe or dot is noise. If a detail matters, give it 2 art px or drop it.
- Iterate on silhouette and colour first. Pixel polish comes last and rarely changes what a stranger names.
- A glyph that has to work at a smaller zoom must be checked there too: crop the app at the zoom it will be seen at, not only the library at 3x.
- Drop items before shrinking them. Three zones that read beat six that blur.

## Palette and scale

- Art we draw goes in `art/authored/` as PNG, and it is committed (the packs are not).
- Only the Sprout Lands palette (`art/palette.json`). Translucent pixels must be the palette's shadow colour. `npm run art:check` runs `scripts/check-palette.py` and lists any off-palette pixel; it must pass before you send a crop.
- Keep the packs' grid: 16 px tiles, 48 px character cells. Scale up only by whole numbers.
- Frames from the packs reach the app only through `art/manifest.json` and `npm run art:atlas`. Never hand-edit `public/sprites/atlas.png` or `src/map/atlas.json`.

## Self-critique checklist

Fill this table in the message that carries the crop, one mark per row: ✅ passes, ⚠️ ships with a trade-off you name, ❌ fails. Fix every ❌ before sending.

| Check | What it means | Mark |
|---|---|---|
| A stranger would name it | With no context, would someone call each new element what it is meant to be? Name each one ("a red check on a white plate"). | |
| Visibly different from the last try | crop-shot's changed-pixel count is well above zero, and the change shows at 1x, not only at 3x. | |
| Big enough at the farm's scale | Every part that carries meaning is at least 2 art px (about 5 screen px). The whole reads at the size a farmhand is drawn. | |
| Distinct from its neighbours | Its colour and silhouette differ from what sits next to it on the field: grass, soil, fences, the other glyphs. | |
| Alive | It has idle frames, a state change, or a reaction to a click (under 600 ms, one frame under reduced motion). Say which. | |
| On the palette | `npm run art:check` passes. | |
| Text stays legible | Any text on a plate or chip still passes `npm run contrast`. Quieter means smaller or lighter weight, never opacity. | |

## Commit message

Pixel-art commits carry their history. Future editors need to know what was tried, or they will try it again.

```
Redraw the needs-you emote so it reads on soil

Iterations: 4
- 1: orange "!" on no plate. Lost on wet soil.
- 2: white plate, 1 px ink outline. Outline vanished at 3x.
- 3: 2 px outline, red "!". Red reads as failure; red means failure only.
- 4 (kept): white plate, 2 px ink outline, ink "!" with the sprout-green dot.
```

One line per rejected try: what it was and why it lost. The kept try is last.

## Sharp edges

- **Look changes and references.** A change that alters how a library page looks will fail `npm run shots:check`. That is expected. Do not refresh the references in the same commit as the art: land the art, then refresh with `npm run shots -- --update` in its own commit, so the review sees the before and after.
- **The packs are not in git.** If the library shows empty art pages, run `npm run assets -- <folder with the zips>` first.
- **Credit.** Sprout Lands is by Cup Nooble. Credit stays in the library and the README; the packs are never committed and never used for NFTs or AI training.
