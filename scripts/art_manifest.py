"""Shared helpers for art/manifest.json: load it, find the packs, list its frames.

Used by scripts/build-atlas.py and scripts/check-palette.py. Run it directly to
reformat the manifest in its house style (one frame per line):

  python3 scripts/art_manifest.py --format
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, 'art', 'manifest.json')
DEFAULT_PACKS = os.path.join(ROOT, 'public', 'assets', 'sprout-lands')


def load(path=MANIFEST):
    with open(path) as f:
        return json.load(f)


def find_pack(base, folder):
    """The folder of one unzipped pack under base (case-insensitive, any depth).
    A folder starting with ./ is our own art, relative to the repo (art/authored)."""
    if folder.startswith('./'):
        path = os.path.join(ROOT, folder[2:])
        return path if os.path.isdir(path) else None
    if os.path.basename(os.path.normpath(base)).lower() == folder.lower():
        return base
    for dirpath, dirnames, _ in os.walk(base):
        if '__MACOSX' in dirpath:
            continue
        dirnames.sort()
        for d in dirnames:
            if d.lower() == folder.lower():
                return os.path.join(dirpath, d)
    return None


def packs_used(manifest):
    """Pack ids the manifest reads from, in first-use order."""
    seen = []
    for sheets in manifest['groups'].values():
        for sheet in sheets:
            if sheet['pack'] not in seen:
                seen.append(sheet['pack'])
    for c in manifest.get('copies', []):
        if c['pack'] not in seen:
            seen.append(c['pack'])
    return seen


def frames(manifest):
    """Every frame the manifest names, as dicts:
    group, pack, file, name, rect [x, y, w, h], trim (bool), anim (None or (key, n)).

    Animation sheets expand to one frame per cell. Their names are provisional
    (<prefix>_<anim>_<dir>_<column>): build-atlas.py renumbers them, skipping empty cells.
    """
    out = []
    for group, sheets in manifest['groups'].items():
        for sheet in sheets:
            base = {'group': group, 'pack': sheet['pack'], 'file': sheet['file']}
            anim = sheet.get('anim')
            if anim:
                cw, ch = anim['cell']
                for name, row0 in anim['rows'].items():
                    for di, d in enumerate(anim['dirs']):
                        for col in range(anim['columns']):
                            out.append(dict(base, name=f"{anim['prefix']}_{name}_{d}_{col}",
                                            rect=[col * cw, (row0 + di) * ch, cw, ch], trim=False,
                                            anim=(f'{name}_{d}', col)))
            size = sheet.get('tile', 16)
            for fr in sheet.get('frames', []):
                if 'tile' in fr:
                    cx, cy = fr['tile']
                    rect = [cx * size, cy * size, size, size]
                else:
                    rect = list(fr['rect'])
                out.append(dict(base, name=fr['name'], rect=rect, trim=bool(fr.get('trim')), anim=None))
    return out


def dump(value, indent=0, width=110):
    """JSON with short values kept on one line, so each frame reads as one row."""
    flat = json.dumps(value, separators=(', ', ': '))
    if not isinstance(value, (dict, list)) or len(flat) + indent <= width:
        return flat
    pad = ' ' * (indent + 2)
    if isinstance(value, list):
        items = [pad + dump(v, indent + 2, width) for v in value]
        return '[\n' + ',\n'.join(items) + '\n' + ' ' * indent + ']'
    items = [pad + json.dumps(k) + ': ' + dump(v, indent + 2, width) for k, v in value.items()]
    return '{\n' + ',\n'.join(items) + '\n' + ' ' * indent + '}'


def save(manifest, path=MANIFEST):
    with open(path, 'w') as f:
        f.write(dump(manifest) + '\n')


if __name__ == '__main__':
    if sys.argv[1:] == ['--format']:
        save(load())
        print(f'formatted {os.path.relpath(MANIFEST, ROOT)}')
    else:
        sys.exit(__doc__)
