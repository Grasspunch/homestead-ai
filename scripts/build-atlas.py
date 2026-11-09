#!/usr/bin/env python3
"""Build the Sprout Lands sprite atlas used by the map.

The Sprout Lands packs (by Cup Nooble) may be used in open-source projects
with credit, but the packs themselves may not be redistributed. So the raw
packs stay out of git, and this script copies only the frames the app draws,
as listed in art/manifest.json, into one atlas: public/sprites/atlas.png +
src/map/atlas.json. It also copies the pixel font and the paw cursor.

Usage:
  python3 scripts/build-atlas.py [packs folder]          write the atlas
  python3 scripts/build-atlas.py --check [packs folder]  rebuild in memory and compare, exit 1 on drift

The packs folder defaults to public/assets/sprout-lands (npm run assets puts them there).
It must hold the packs the manifest reads from, unzipped as they come from itch.io.
Needs Pillow (pip install pillow).
"""
import io
import json
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of scripts/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import art_manifest  # noqa: E402

from PIL import Image  # noqa: E402

ROOT = art_manifest.ROOT


def rel(path):
    return os.path.relpath(path, ROOT)


def locate_packs(manifest, base):
    """pack id -> folder, or exit naming what's missing."""
    found, missing = {}, []
    for pid in art_manifest.packs_used(manifest):
        folder = manifest['packs'][pid]
        path = art_manifest.find_pack(base, folder) if os.path.isdir(base) else None
        if path:
            found[pid] = path
        else:
            missing.append(folder)
    return found, missing


def cut_frames(manifest, packs):
    """Cut every manifest frame out of its sheet. Returns (frames, counts)."""
    cache = {}

    def sheet(pack, file):
        path = os.path.join(packs[pack], file)
        if path not in cache:
            if not os.path.isfile(path):
                sys.exit(f'Missing sheet: {manifest["packs"][pack]}/{file}')
            cache[path] = Image.open(path).convert('RGBA')
        return cache[path]

    frames = {}  # name -> Image
    counts = {}  # <anim>_<dir> -> frame count
    for fr in art_manifest.frames(manifest):
        x, y, w, h = fr['rect']
        im = sheet(fr['pack'], fr['file']).crop((x, y, x + w, y + h))
        if fr['trim']:
            bb = im.getbbox()
            if bb:
                im = im.crop(bb)
        empty = im.getbbox() is None
        name = fr['name']
        if fr['anim']:
            key, _ = fr['anim']
            n = counts.setdefault(key, 0)
            if empty:
                continue
            name = name.rsplit('_', 1)[0] + f'_{n}'
            counts[key] = n + 1
        elif empty:
            print(f'warning: {name} is empty ({fr["file"]} {fr["rect"]}), left out', file=sys.stderr)
            continue
        if name in frames:
            sys.exit(f'Duplicate frame name in art/manifest.json: {name}')
        frames[name] = im
    return frames, counts


def pack(frames, width, gap):
    """Simple shelf packer, tallest first. Returns (atlas image, rects)."""
    items = sorted(frames.items(), key=lambda kv: (-kv[1].height, kv[0]))
    x = y = shelf = 0
    rects = {}
    for name, im in items:
        if x + im.width > width:
            x, y, shelf = 0, y + shelf + gap, 0
        rects[name] = [x, y, im.width, im.height]
        x += im.width + gap
        shelf = max(shelf, im.height)
    height = y + shelf
    atlas = Image.new('RGBA', (width, height))
    for name, im in items:
        rx, ry, _, _ = rects[name]
        atlas.paste(im, (rx, ry))
    return atlas, rects


def build(manifest, packs):
    """Everything this script writes, in memory: {path: bytes or Image}."""
    frames, counts = cut_frames(manifest, packs)
    cfg = manifest['atlas']
    atlas, rects = pack(frames, cfg['width'], cfg['gap'])
    data = {'size': [cfg['width'], atlas.height], 'counts': counts, 'frames': rects}
    out = {
        os.path.join(ROOT, cfg['png']): atlas,
        os.path.join(ROOT, cfg['json']): json.dumps(data, separators=(',', ':')).encode(),
    }
    for c in manifest.get('copies', []):
        src = os.path.join(packs[c['pack']], c['file'])
        if not os.path.isfile(src):
            sys.exit(f'Missing file to copy: {manifest["packs"][c["pack"]]}/{c["file"]}')
        dst = os.path.join(ROOT, c['to'])
        scale = c.get('scale', 1)
        if scale != 1:
            im = Image.open(src).convert('RGBA')
            out[dst] = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
            out[dst].plain = True  # saved without optimize, as it always was
        else:
            with open(src, 'rb') as f:
                out[dst] = f.read()
    return out, len(rects)


def write(out):
    for path, value in out.items():
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if isinstance(value, Image.Image):
            value.save(path, optimize=not getattr(value, 'plain', False))
        else:
            with open(path, 'wb') as f:
                f.write(value)


def same_pixels(a, b):
    return a.size == b.size and a.convert('RGBA').tobytes() == b.convert('RGBA').tobytes()


def first_diff(a, b):
    if a.size != b.size:
        return f'size {a.width}x{a.height} on disk, {b.width}x{b.height} from the manifest'
    a, b = a.convert('RGBA'), b.convert('RGBA')
    for yy in range(a.height):
        for xx in range(a.width):
            if a.getpixel((xx, yy)) != b.getpixel((xx, yy)):
                return f'first difference at ({xx}, {yy}): {a.getpixel((xx, yy))} on disk, {b.getpixel((xx, yy))} from the manifest'
    return 'pixels differ'


def json_diff(disk, fresh):
    try:
        a, b = json.loads(disk), json.loads(fresh)
    except ValueError:
        return 'not valid JSON'
    lines = []
    if a.get('size') != b.get('size'):
        lines.append(f'size {a.get("size")} on disk, {b.get("size")} from the manifest')
    if a.get('counts') != b.get('counts'):
        lines.append('animation counts differ')
    fa, fb = a.get('frames', {}), b.get('frames', {})
    gone, new = sorted(set(fa) - set(fb)), sorted(set(fb) - set(fa))
    moved = sorted(k for k in set(fa) & set(fb) if fa[k] != fb[k])
    if gone:
        lines.append(f'{len(gone)} frames not in the manifest: {", ".join(gone[:8])}')
    if new:
        lines.append(f'{len(new)} manifest frames not in the atlas: {", ".join(new[:8])}')
    if moved:
        lines.append(f'{len(moved)} frames moved or resized: {", ".join(moved[:8])}')
    return '; '.join(lines) or 'formatting differs'


def check(out):
    problems = []
    for path, fresh in out.items():
        name = rel(path)
        if not os.path.isfile(path):
            problems.append(f'{name}: missing')
            continue
        if isinstance(fresh, Image.Image):
            disk = Image.open(path)
            if not same_pixels(disk, fresh):
                problems.append(f'{name}: {first_diff(disk, fresh)}')
        else:
            with open(path, 'rb') as f:
                disk = f.read()
            if disk != fresh:
                problems.append(f'{name}: ' + (json_diff(disk, fresh) if path.endswith('.json') else 'bytes differ'))
    return problems


def check_without_packs(manifest):
    """With no packs, still check that the manifest and atlas.json name the same frames."""
    with open(os.path.join(ROOT, manifest['atlas']['json'])) as f:
        atlas = json.load(f)
    want = {}
    for fr in art_manifest.frames(manifest):
        name = fr['name']
        if fr['anim']:
            key, col = fr['anim']
            if col >= atlas['counts'].get(key, 0):
                continue
        want[name] = fr
    have = atlas['frames']
    problems = []
    gone, new = sorted(set(have) - set(want)), sorted(set(want) - set(have))
    if gone:
        problems.append(f'atlas.json has {len(gone)} frames the manifest does not list: {", ".join(gone[:8])}')
    if new:
        problems.append(f'the manifest lists {len(new)} frames atlas.json lacks: {", ".join(new[:8])}')
    for name, fr in want.items():
        if name in have and not fr['trim'] and have[name][2:] != fr['rect'][2:]:
            problems.append(f'{name}: {have[name][2]}x{have[name][3]} in atlas.json, {fr["rect"][2]}x{fr["rect"][3]} in the manifest')
    return problems


def main():
    args = sys.argv[1:]
    checking = '--check' in args
    args = [a for a in args if a != '--check']
    if len(args) > 1 or any(a.startswith('-') for a in args):
        sys.exit(__doc__)
    base = os.path.abspath(args[0]) if args else art_manifest.DEFAULT_PACKS
    manifest = art_manifest.load()
    packs, missing = locate_packs(manifest, base)

    if missing:
        where = rel(base) if base.startswith(ROOT) else base
        msg = f'Packs not found under {where}: ' + ', '.join(missing)
        if not checking:
            sys.exit(msg + '\nPut them there with: npm run assets -- ~/Downloads/sprout-lands')
        problems = check_without_packs(manifest)
        if problems:
            print('Atlas drift: art/manifest.json and ' + manifest['atlas']['json'] + ' disagree.')
            for p in problems:
                print('  ' + p)
            sys.exit(1)
        print(msg)
        print('Checked frame names and sizes only. Pixel check skipped: it needs the packs.')
        return

    out, n = build(manifest, packs)
    if checking:
        problems = check(out)
        if problems:
            print('Atlas drift: the committed files do not match art/manifest.json and the packs.')
            for p in problems:
                print('  ' + p)
            print('Run npm run art:atlas to rebuild them, then commit the result.')
            sys.exit(1)
        print(f'Atlas up to date: {n} frames, {len(out)} files match art/manifest.json.')
        return
    write(out)
    atlas = out[os.path.join(ROOT, manifest['atlas']['png'])]
    print(f'atlas {atlas.width}x{atlas.height}, {n} frames -> {rel(os.path.join(ROOT, manifest["atlas"]["png"]))}')


if __name__ == '__main__':
    main()
