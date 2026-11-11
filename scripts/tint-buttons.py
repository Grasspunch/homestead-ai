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
RAMPS = {
    'leaf': hexes('#f2f8e8', '#e3efcf', '#c3daa6', '#7aa35a', '#4f8f3f'),  # --leaf-wash, tag green, --leaf
    'berry': hexes('#fcefea', '#f6dcd4', '#e9b9ae', '#d1857c', '#c4615a'),  # --berry-wash, --berry
    'sky': hexes('#f6f8fd', '#e8eefa', '#c4d2ee', '#7e98c8', '#2d5da8'),  # --sky-wash, --sky
    'gold': hexes('#fbf2da', '#f5e2b0', '#e8c97c', '#d0a03c', '#a87a2a'),  # --honey
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
