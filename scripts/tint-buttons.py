# The top bar's coloured buttons: btn_white's five shades swapped for a ramp built from the HUD tokens
# (--leaf, --berry, --sky, --honey and their washes). Same pixels, same nine-slice, only the colours change.
# Usage: python3 scripts/tint-buttons.py
from pathlib import Path
from PIL import Image

ui = Path(__file__).resolve().parent.parent / 'public' / 'ui'
src = Image.open(ui / 'btn_white.png').convert('RGBA')
# btn_white's shades, light to dark: highlight, fill, shadow, outline, shadow outline.
WHITE = [(251, 251, 246), (220, 224, 210), (193, 200, 185), (129, 139, 131), (87, 94, 92)]
hexes = lambda *h: [tuple(int(x[i:i + 2], 16) for i in (1, 3, 5)) for x in h]
# The fill is a mid shade of the token, so a red button reads red, not pink; outlines are the token itself.
RAMPS = {
    'leaf': hexes('#e3efcf', '#b5d68f', '#8fbf6a', '#4f8f3f', '#3a6e2e'),  # --leaf-wash .. --leaf
    'berry': hexes('#f6dcd4', '#ec9f95', '#dc7d72', '#c4615a', '#9a463f'),  # --berry-wash .. --berry
    'sky': hexes('#e8eefa', '#a9c0ea', '#86a4dc', '#2d5da8', '#21467f'),  # --sky-wash .. --sky
    'gold': hexes('#f5e2b0', '#ecc96a', '#dcb04a', '#a87a2a', '#7f5b1c'),  # honey wash .. honey
}
for name, ramp in RAMPS.items():
    out = src.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a and (r, g, b) in WHITE:
                px[x, y] = (*ramp[WHITE.index((r, g, b))], a)
    out.save(ui / f'btn_{name}.png')
    print('wrote', f'btn_{name}.png')
