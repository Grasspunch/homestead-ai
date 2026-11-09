#!/usr/bin/env python3
"""Build the Sprout Lands sprite atlas used by the map.

The Sprout Lands packs (by Cup Nooble) may be used in open-source projects
with credit, but the packs themselves may not be redistributed. So the raw
zips stay out of git, and this script copies only the frames the app draws
into one atlas: public/sprites/atlas.png + src/map/atlas.json.

Usage:
  python3 scripts/build-atlas.py <folder holding the four unzipped packs>

The folder must contain these (as unzipped from itch.io):
  Sprout Lands - Sprites - premium pack/
  Sprout Lands - UI Pack - Premium pack/
Needs Pillow (pip install pillow).
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def find_dir(base, name):
    for dirpath, dirnames, _ in os.walk(base):
        if '__MACOSX' in dirpath:
            continue
        for d in dirnames:
            if d.lower() == name.lower():
                return os.path.join(dirpath, d)
    sys.exit(f'Could not find "{name}" under {base}')


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    base = sys.argv[1]
    sp = find_dir(base, 'Sprout Lands - Sprites - premium pack')
    ui = find_dir(base, 'Sprout Lands - UI Pack - Premium pack')

    cache = {}

    def img(rel, pack=sp):
        path = os.path.join(pack, rel)
        if path not in cache:
            cache[path] = Image.open(path).convert('RGBA')
        return cache[path]

    frames = {}  # name -> Image

    def add(name, rel, x, y, w, h, pack=sp, trim=False):
        im = img(rel, pack).crop((x, y, x + w, y + h))
        if trim:
            bb = im.getbbox()
            if bb:
                im = im.crop(bb)
        if im.getbbox() is None:
            return False
        frames[name] = im
        return True

    def tile(name, rel, cx, cy, size=16, pack=sp):
        return add(name, rel, cx * size, cy * size, size, size, pack)

    # Characters: 48x48 frames, 8 per row; rows are down, up, left, right.
    char = 'Characters/Premium Charakter Spritesheet.png'
    anims = {'idle': 0, 'walk': 4, 'till': 12, 'chop': 16, 'water': 20}
    dirs = ['down', 'up', 'left', 'right']
    counts = {}
    for anim, row0 in anims.items():
        for di, d in enumerate(dirs):
            n = 0
            for i in range(8):
                if add(f'char_{anim}_{d}_{n}', char, i * 48, (row0 + di) * 48, 48, 48):
                    n += 1
            counts[f'{anim}_{d}'] = n

    # Crops: 16x16, columns are growth stages (seed, sprout, growing, ripe).
    plants = 'Objects/Farming Plants.png'
    crop_rows = {'carrot': 2, 'tulip': 6, 'cabbage': 7, 'wheat': 8, 'pumpkin': 9}
    for kind, row in crop_rows.items():
        for stage in range(4):
            tile(f'crop_{kind}_{stage}', plants, stage, row)

    # Ground. Grass mid + decorations; soil beds (dark = watered, light = dry); dirt path.
    gt = 'Tilesets/ground tiles/New tiles/'
    tile('grass', gt + 'Grass_tiles_v2.png', 1, 1)
    deco = [(0, 5), (1, 5), (2, 5), (3, 5), (4, 5), (5, 5), (0, 6), (1, 6), (2, 6), (3, 6), (4, 6), (5, 6)]
    for i, (cx, cy) in enumerate(deco):
        tile(f'grass_deco_{i}', gt + 'Grass_tiles_v2.png', cx, cy)
    for r in range(3):
        for c in range(3):
            tile(f'bed_wet_{c}{r}', gt + 'Darker_Soil_Ground_Tiles.png', c, r)
            tile(f'bed_dry_{c}{r}', gt + 'Soil_Ground_Tiles.png', c, r)
            tile(f'path_{c}{r}', 'Tilesets/ground tiles/Old tiles/Tilled_Dirt_v2.png', c, r)
    for i in range(4):
        tile(f'water_{i}', 'Tilesets/ground tiles/Water.png', i, 0)

    # Fences: 4x4 autotile.
    for r in range(4):
        for c in range(4):
            tile(f'fence_{c}{r}', 'Tilesets/Building parts/Fences.png', c, r)

    # Houses (one roof colour per farm), chest (seed library), well, basket.
    for i in range(6):
        add(f'house_{i}', 'Tilesets/Building parts/Animal Structures/Chikcen_Houses.png', i * 64, 0, 64, 64, trim=True)
    add('chest', 'Tilesets/Building parts/Chest.png', 0, 0, 48, 48, trim=True)
    add('chest_open', 'Tilesets/Building parts/Chest.png', 96, 0, 48, 48, trim=True)
    add('well', 'Objects/Water well.png', 0, 0, 32, 32, trim=True)
    add('basket', 'Objects/Piknik basket.png', 0, 0, 16, 16, trim=True)
    add('workstation', 'Objects/work station.png', 0, 0, 32, 32, trim=True)

    # Signs: blank (signpost = attached context) and crop markers.
    signs = 'Objects/signs.png'
    tile('sign_blank', signs, 0, 0)
    for kind, (cx, cy) in {'carrot': (2, 0), 'wheat': (2, 1), 'cabbage': (5, 2), 'tulip': (0, 1), 'pumpkin': (3, 1)}.items():
        tile(f'sign_{kind}', signs, cx, cy)

    # Trees and bushes.
    trees = 'Objects/Trees, stumps and bushes.png'
    add('tree_small', trees, 0, 0, 16, 32)
    add('tree', trees, 16, 0, 32, 32)
    add('tree_apple', trees, 48, 0, 32, 32)
    add('tree_orange', trees, 80, 0, 32, 32)
    add('tree_pear', trees, 112, 0, 32, 32)
    add('tree_peach', trees, 144, 0, 32, 32)
    add('tree_big', trees, 144, 48, 48, 48, trim=True)
    tile('bush_0', trees, 0, 3)
    tile('bush_1', trees, 1, 3)

    # Flowers, mushrooms and stones for decoration.
    fl = 'Objects/Mushrooms, Flowers, Stones.png'
    for i, (cx, cy) in enumerate([(0, 3), (1, 3), (4, 3), (5, 3), (8, 3), (0, 4), (4, 4), (5, 4), (0, 0), (1, 0), (0, 1), (1, 1)]):
        tile(f'flower_{i}', fl, cx, cy)
    add('sunflower', fl, 48, 48, 16, 32)

    # Animals for ambience.
    add('chicken_0', 'Animals/Chicken/chicken default.png', 0, 0, 16, 16)
    add('chicken_1', 'Animals/Chicken/chicken default.png', 16, 0, 16, 16)

    # UI pack: status emotes (32x32), cursor paws.
    emo = 'emojis/Emoji spritesheet.png'
    for name, cx in {'check': 0, 'cross': 64, 'alert': 160, 'question': 192, 'sleep': 288}.items():
        add(f'emote_{name}', emo, cx, 256, 32, 32, pack=ui, trim=True)

    pack(frames, counts, ui)


def pack(frames, counts, ui):
    # Simple shelf packer, tallest first, 512px wide.
    width = 512
    items = sorted(frames.items(), key=lambda kv: (-kv[1].height, kv[0]))
    x = y = shelf = 0
    rects = {}
    for name, im in items:
        if x + im.width > width:
            x, y, shelf = 0, y + shelf + 1, 0
        rects[name] = [x, y, im.width, im.height]
        x += im.width + 1
        shelf = max(shelf, im.height)
    height = y + shelf
    atlas = Image.new('RGBA', (width, height))
    for name, im in items:
        rx, ry, _, _ = rects[name]
        atlas.paste(im, (rx, ry))

    out_png = os.path.join(ROOT, 'public', 'sprites', 'atlas.png')
    out_json = os.path.join(ROOT, 'src', 'map', 'atlas.json')
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    atlas.save(out_png, optimize=True)
    with open(out_json, 'w') as f:
        json.dump({'size': [width, height], 'counts': counts, 'frames': rects}, f, separators=(',', ':'))

    # Pixel font from the UI pack, for labels on the map.
    font = None
    for dirpath, _, files in os.walk(ui):
        for fn in files:
            if fn.lower().endswith('.ttf'):
                font = os.path.join(dirpath, fn)
    if font:
        dst = os.path.join(ROOT, 'public', 'fonts', 'sprout-lands.ttf')
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(font, 'rb') as a, open(dst, 'wb') as b:
            b.write(a.read())
    # Cat-paw cursor from the UI pack, doubled for legibility.
    for dirpath, _, files in os.walk(ui):
        for fn in files:
            if fn == 'Catpaw Mouse icon.png':
                cur = Image.open(os.path.join(dirpath, fn)).convert('RGBA')
                cur.resize((cur.width * 2, cur.height * 2), Image.NEAREST).save(os.path.join(ROOT, 'public', 'cursor-paw.png'))
    print(f'atlas {width}x{height}, {len(rects)} frames -> {out_png}')


if __name__ == '__main__':
    main()
