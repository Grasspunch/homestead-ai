# Authored pixel art

Pixel art we draw ourselves goes here, as PNG. Unlike the Sprout Lands packs, it is ours, so it is committed.

- Draw on the Sprout Lands palette only. The colours are in `art/palette.json`; the Aseprite palette ships in the Sprites packs under "Sprout Lands color pallet".
- Keep the packs' scale: 16 px tiles, 48 px character cells.
- Fully transparent pixels are fine. Translucent pixels must be the palette's shadow colour.

`npm run art:check` runs `scripts/check-palette.py`, which fails on any opaque pixel off the palette and lists where it is.
