#!/usr/bin/env python3
"""Crop the Sprout Lands premium pieces the v3 farm view draws into public/v3/.

Only the pieces the app draws are committed; the packs themselves are not redistributed.
Usage: scripts/build-v3-assets.py <path to design-system/sprout-lands>
"""
import sys, os, shutil
from PIL import Image

P = sys.argv[1].rstrip('/') + '/'
U = P + 'Sprout Lands - UI Pack - Premium pack/'
S = P + 'Sprout Lands - Sprites - premium pack/'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'v3') + '/'
os.makedirs(OUT, exist_ok=True)

def crop(src, box, name):
    x, y, w, h = box
    Image.open(src).convert('RGBA').crop((x, y, x + w, y + h)).save(OUT + name + '.png')

def strip(src, cells, size, name):
    im = Image.open(src).convert('RGBA')
    out = Image.new('RGBA', (size * len(cells), size))
    for i, (c, r) in enumerate(cells):
        out.paste(im.crop((c * size, r * size, (c + 1) * size, (r + 1) * size)), (i * size, 0))
    out.save(OUT + name + '.png')

UI = U + 'UI Sprites/'
crop(UI + 'Dialouge UI/dialog box.png', (10, 11, 27, 28), 'textbox')
crop(UI + 'Other UI sprites/Setting menu.png', (139, 12, 106, 122), 'panel')
B = UI + 'buttons/square/Square Buttons 26x19.png'
for name, y in (('white', 6), ('cream', 38), ('tan', 70), ('brown', 102)):
    crop(B, (11, y, 26, 19), 'btn_' + name)
    crop(B, (59, y + 1, 26, 18), 'btn_' + name + '_down')
crop(UI + 'Dialouge UI/Character Backdrop-frame/backdrops_b1.png', (9, 9, 30, 30), 'portrait')
crop(U + 'emojis/emoji style ui/Inventory_Blocks_Spritesheet.png', (9, 9, 30, 32), 'slot')
crop(UI + 'Icons/special icons/coins.png', (37, 21, 22, 22), 'coin')
crop(U + 'emojis/speech_bubble_grey.png', (209, 88, 31, 32), 'bubble')
for col in ('blue', 'green', 'pink', 'purple', 'yellow'):
    crop(U + f'emojis/speech_bubble_{col}.png', (209, 88, 31, 32), 'bubble_' + col)
SEL = UI + 'Other UI sprites/Selectors/'
crop(SEL + 'selectorst_a1.png', (4, 4, 8, 9), 'selector')
crop(SEL + 'dot_1.png', (5, 4, 6, 7), 'dot')
crop(UI + 'Other UI sprites/Xs and check marks/1s/check mark.png', (0, 0, 16, 16), 'checkmark')
crop(UI + 'Other UI sprites/Xs and check marks/1s/X.png', (0, 0, 16, 16), 'xmark')
shutil.copy(UI + 'Mouse sprites/Catpaw Mouse icon.png', OUT + 'paw.png')
shutil.copy(UI + 'Mouse sprites/Catpaw holding Mouse icon.png', OUT + 'paw_hold.png')
shutil.copy(UI + 'Mouse sprites/Catpaw pointing Mouse icon.png', OUT + 'paw_point.png')
shutil.copy(UI + 'Other UI sprites/Stamina circle with white outline sprite sheet .png', OUT + 'ring.png')
shutil.copy(U + 'fonts/Font files TTF/pixelFont-7-8x14-sproutLands.ttf', OUT + 'px7.ttf')
shutil.copy(U + 'fonts/Font files TTF/pixelFont-4-7x7-sproutLands.ttf', OUT + 'px4.ttf')

# Emotes, 32px cells from the emoji sheet. Order is the EMOTES list in src/v3/assets.ts.
strip(U + 'emojis/Emoji spritesheet.png',
      [(5, 8), (6, 8), (8, 8), (9, 8), (0, 8), (3, 8), (0, 9), (6, 10), (3, 11), (2, 11), (7, 5), (1, 4), (0, 5), (6, 4)], 32, 'emotes')
# Icons, 16px cells, brown tone (columns 12-15), then one green tick. Order is ICONS in src/v3/assets.ts.
strip(UI + 'Icons/All Icons.png',
      [(14, 7), (14, 3), (13, 3), (12, 2), (13, 2), (12, 0), (13, 5), (12, 7), (13, 7), (13, 8), (14, 8), (15, 8), (12, 6), (13, 6), (13, 4), (12, 4), (14, 9), (13, 0), (12, 3), (0, 12)], 16, 'icons')

A = S + 'Tilesets/Building parts/'
crop(A + 'Mailbox Animation Frames.png', (0, 64, 16, 32), 'mailbox')
crop(A + 'Mailbox Animation Frames.png', (0, 104, 16, 36), 'mailbox_letter')
crop(A + 'Animal Structures/Chikcen_Houses.png', (161, 81, 30, 42), 'henhouse')
crop(A + 'Animal Structures/Barn structures.png', (20, 3, 24, 26), 'crates')
crop(A + 'Animal Structures/Barn structures.png', (0, 0, 16, 16), 'crate')
crop(A + 'Animal Structures/Water tray.png', (0, 0, 32, 16), 'tray')
for col, f in (('brown', 'Brown cow animations.png'), ('light', 'Light cow animations.png'), ('pink', 'Pink cow animation sprites.png')):
    crop(S + 'Animals/Cow/' + f, (0, 0, 96, 32), 'cow_' + col)       # 3 idle frames
crop(S + 'Animals/Cow_Baby/baby brown cow animations sprites.png', (0, 0, 64, 32), 'calf')
crop(S + 'Objects/Items/Milk.png', (0, 0, 16, 16), 'milk')
crop(S + 'Objects/Items/Egg items.png', (0, 0, 16, 16), 'egg')
print('wrote', len(os.listdir(OUT)), 'files to public/v3')
