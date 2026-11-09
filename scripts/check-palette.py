#!/usr/bin/env python3
"""Check that our own pixel art stays on the Sprout Lands palette.

Every opaque pixel in art/authored/**/*.png must be one of the colours in
art/palette.json. Translucent pixels must be the palette's shadow colour (any alpha).
Fully transparent pixels are ignored. Passes when there is nothing to check.

Usage:
  python3 scripts/check-palette.py             check art/authored, exit 1 on any off-palette pixel
  python3 scripts/check-palette.py --report    also report how many manifest frames from the packs are on-palette
  python3 scripts/check-palette.py --report <packs folder>
Needs Pillow (pip install pillow).
"""
import json
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of scripts/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import art_manifest  # noqa: E402

from PIL import Image  # noqa: E402

ROOT = art_manifest.ROOT
AUTHORED = os.path.join(ROOT, 'art', 'authored')
SHOW = 5  # offending pixels listed per file


def load_palette():
    with open(os.path.join(ROOT, 'art', 'palette.json')) as f:
        pal = json.load(f)
    rgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))  # noqa: E731
    colors = {rgb(c) for ramp in pal['ramps'] for c in ramp} | {rgb(c) for c in pal.get('extra', [])}
    return colors, rgb(pal['shadow']['color'])


def off_palette(im, colors, shadow):
    """[(x, y, rgba)] for each pixel off the palette."""
    im = im.convert('RGBA')
    bad = []
    w = im.width
    pixels = getattr(im, 'get_flattened_data', None) or im.getdata  # getdata is deprecated in Pillow 12
    for i, (r, g, b, a) in enumerate(pixels()):
        if a == 0:
            continue
        ok = (r, g, b) in colors if a == 255 else (r, g, b) == shadow or (r, g, b) in colors
        if not ok:
            bad.append((i % w, i // w, (r, g, b, a)))
    return bad


def authored_files():
    out = []
    for dirpath, _, files in os.walk(AUTHORED):
        for fn in files:
            if fn.lower().endswith('.png'):
                out.append(os.path.join(dirpath, fn))
    return sorted(out)


def check_authored(colors, shadow):
    files = authored_files()
    failed = 0
    for path in files:
        bad = off_palette(Image.open(path), colors, shadow)
        if bad:
            failed += 1
            print(f'{os.path.relpath(path, ROOT)}: {len(bad)} pixels off the palette')
            for x, y, (r, g, b, a) in bad[:SHOW]:
                print(f'  ({x}, {y}) #{r:02x}{g:02x}{b:02x}' + (f' alpha {a}' if a != 255 else ''))
            if len(bad) > SHOW:
                print(f'  and {len(bad) - SHOW} more')
    if not files:
        print('No authored art to check (art/authored is empty).')
    elif failed:
        print(f'{failed} of {len(files)} files use colours outside art/palette.json.')
    else:
        print(f'{len(files)} authored file{"s" if len(files) != 1 else ""}, all on the palette.')
    return failed == 0


def report(colors, shadow, base):
    manifest = art_manifest.load()
    packs = {}
    for pid in art_manifest.packs_used(manifest):
        path = art_manifest.find_pack(base, manifest['packs'][pid]) if os.path.isdir(base) else None
        if not path:
            print(f'Report skipped: {manifest["packs"][pid]} not found under {base}.')
            return
        packs[pid] = path
    sheets = {}
    groups = {}  # group -> [on, total, off names]
    for fr in art_manifest.frames(manifest):
        key = (fr['pack'], fr['file'])
        if key not in sheets:
            sheets[key] = Image.open(os.path.join(packs[fr['pack']], fr['file'])).convert('RGBA')
        x, y, w, h = fr['rect']
        im = sheets[key].crop((x, y, x + w, y + h))
        if im.getbbox() is None:
            continue
        g = groups.setdefault(fr['group'], [0, 0, []])
        g[1] += 1
        if off_palette(im, colors, shadow):
            g[2].append(fr['name'])
        else:
            g[0] += 1
    on = sum(g[0] for g in groups.values())
    total = sum(g[1] for g in groups.values())
    print(f'Pack frames in the manifest on the palette: {on} of {total}. (Informational: the packs are not held to it.)')
    for name, (n_on, n, off) in groups.items():
        line = f'  {name}: {n_on} of {n}'
        if off:
            line += '; off: ' + ', '.join(off[:6]) + (f' and {len(off) - 6} more' if len(off) > 6 else '')
        print(line)


def main():
    args = sys.argv[1:]
    want_report = '--report' in args
    args = [a for a in args if a != '--report']
    if len(args) > 1 or any(a.startswith('-') for a in args) or (args and not want_report):
        sys.exit(__doc__)
    colors, shadow = load_palette()
    ok = check_authored(colors, shadow)
    if want_report:
        report(colors, shadow, os.path.abspath(args[0]) if args else art_manifest.DEFAULT_PACKS)
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
