#!/usr/bin/env python3
"""Pixel compare one screenshot against its reference.

  python3 scripts/compare-shots.py <ref.png> <out.png> <diff.png>
  python3 scripts/compare-shots.py --selftest

Exit 0 when the two are pixel-identical, 1 when any pixel differs (a diff
overlay is written: the new shot dimmed, changed pixels in red), 2 when the
sizes differ or the arguments are wrong.

Images are compared in RGB. Pillow's getbbox() looks only at the alpha band
of an RGBA image by default, and the difference of two opaque RGBA images has
an all-zero alpha band, so an RGBA compare would call any two shots equal.

scripts/shots.mjs --check runs this for every "ref" state in
scripts/shots/states.json. References are refreshed on purpose with
`npm run shots -- --update`, in a change of their own.
"""

import sys
from pathlib import Path

from PIL import Image, ImageChops

RED = (230, 0, 60)


def load_rgb(path):
    with Image.open(path) as im:
        return im.convert("RGB")


def compare(ref_path, out_path, diff_path):
    ref = load_rgb(ref_path)
    out = load_rgb(out_path)
    name = Path(out_path).name
    if ref.size != out.size:
        print(f"{name}: size changed from {ref.size[0]}x{ref.size[1]} to {out.size[0]}x{out.size[1]}")
        return 2

    delta = ImageChops.difference(ref, out)
    if delta.getbbox() is None:
        print(f"{name}: same")
        return 0

    # A pixel changed when any of its three bands did.
    r, g, b = delta.split()
    changed = ImageChops.lighter(ImageChops.lighter(r, g), b).point(lambda v: 255 if v else 0)
    count = changed.histogram()[255]
    box = changed.getbbox()

    overlay = Image.eval(out, lambda v: 128 + v // 2)  # wash the new shot out so the red reads
    overlay.paste(RED, mask=changed)
    diff_path = Path(diff_path)
    diff_path.parent.mkdir(parents=True, exist_ok=True)
    overlay.save(diff_path)

    w, h = out.size
    print(f"{name}: {count} of {w * h} pixels changed ({100 * count / (w * h):.3f}%), inside {box}; diff at {diff_path}")
    return 1


def selftest():
    import tempfile
    import unittest

    class Compare(unittest.TestCase):
        def setUp(self):
            self.tmp = tempfile.TemporaryDirectory()
            self.dir = Path(self.tmp.name)

        def tearDown(self):
            self.tmp.cleanup()

        def img(self, name, mode, color, size=(6, 4)):
            p = self.dir / name
            Image.new(mode, size, color).save(p)
            return p

        def test_opaque_rgba_that_differs_fails(self):
            # The trap: compared as RGBA these two would pass.
            a = self.img("a.png", "RGBA", (10, 20, 30, 255))
            b = self.img("b.png", "RGBA", (200, 20, 30, 255))
            self.assertEqual(compare(a, b, self.dir / "d.png"), 1)

        def test_same_passes(self):
            a = self.img("a.png", "RGB", (1, 2, 3))
            self.assertEqual(compare(a, a, self.dir / "d.png"), 0)

        def test_size_change_is_its_own_code(self):
            a = self.img("a.png", "RGB", (1, 2, 3))
            b = self.img("b.png", "RGB", (1, 2, 3), size=(7, 4))
            self.assertEqual(compare(a, b, self.dir / "d.png"), 2)

        def test_one_pixel_is_caught_and_painted(self):
            a = self.img("a.png", "RGB", (90, 90, 90))
            im = Image.new("RGB", (6, 4), (90, 90, 90))
            im.putpixel((5, 3), (91, 90, 90))
            b = self.dir / "b.png"
            im.save(b)
            self.assertEqual(compare(a, b, self.dir / "d.png"), 1)
            with Image.open(self.dir / "d.png") as d:
                self.assertEqual(d.getpixel((5, 3)), RED)
                self.assertNotEqual(d.getpixel((0, 0)), RED)

    result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(Compare))
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["--selftest"]:
        sys.exit(selftest())
    if len(args) != 3:
        print(__doc__.strip().split("\n\n")[1])
        sys.exit(2)
    sys.exit(compare(*args))
