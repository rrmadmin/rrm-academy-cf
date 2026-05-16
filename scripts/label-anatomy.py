#!/usr/bin/env python3
"""label-anatomy.py -- programmatic label layer for RRM Academy anatomical plates.

The anatomy is generated UNLABELED by gen-image.mjs (--register anatomical).
This script adds the labels and leader lines deterministically, so every label
sits at an exact, editable coordinate with real, crisp text.

Coordinates are PERCENTAGES (0-100) of the image width/height, so a manifest
is resolution-independent.

  --grid IN.png OUT.png
      Overlay a 0-100 coordinate grid for picking anchor points by eye.

  --labels IN.png MANIFEST.json OUT.png
      Render labels. Manifest is a JSON array of:
        { "text": "Cervix", "anchor": [px, py], "chip": [px, py] }
      anchor = where the leader line touches the anatomy.
      chip   = where the centre of the label chip sits.

Usage:
  label-anatomy.py --grid in.png grid.png
  label-anatomy.py --labels in.png labels.json out.png
"""
import json
import sys
from PIL import Image, ImageDraw, ImageFont

BRAND_PURPLE = (114, 94, 126)      # #725e7e
LEADER = (138, 122, 148)           # muted purple
WHITE = (255, 255, 255)
GRID = (150, 150, 160)

FONT_CANDIDATES = [
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/Library/Fonts/Arial.ttf',
]


def load_font(size):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def pct(p, dim):
    return int(round(p / 100.0 * dim))


def run_grid(src, dst):
    img = Image.open(src).convert('RGB')
    w, h = img.size
    d = ImageDraw.Draw(img, 'RGBA')
    font = load_font(max(11, w // 70))
    for p in range(0, 101, 5):
        x, y = pct(p, w), pct(p, h)
        major = p % 10 == 0
        ink = GRID + (200 if major else 90,)
        d.line([(x, 0), (x, h)], fill=ink, width=2 if major else 1)
        d.line([(0, y), (w, y)], fill=ink, width=2 if major else 1)
        if major:
            d.text((x + 3, 3), str(p), fill=GRID, font=font)
            d.text((3, y + 3), str(p), fill=GRID, font=font)
    img.save(dst)
    print(f'grid -> {dst} ({w}x{h})')


def rounded_chip(d, cx, cy, text, font):
    """Draw a rounded brand-purple chip centred at (cx, cy). Returns its bbox."""
    pad_x, pad_y = 16, 9
    tb = d.textbbox((0, 0), text, font=font)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    x0, y0 = cx - tw // 2 - pad_x, cy - th // 2 - pad_y
    x1, y1 = cx + tw // 2 + pad_x, cy + th // 2 + pad_y
    # modest corner radius -- a rounded rectangle, not a full pill/capsule
    d.rounded_rectangle([x0, y0, x1, y1], radius=(y1 - y0) // 4, fill=BRAND_PURPLE)
    d.text((cx - tw // 2 - tb[0], cy - th // 2 - tb[1]), text, fill=WHITE, font=font)
    return (x0, y0, x1, y1)


def edge_point(bbox, target):
    """Point on the chip bbox edge closest to `target` -- the leader's chip end."""
    x0, y0, x1, y1 = bbox
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    tx, ty = target
    ex = min(max(tx, x0), x1)
    ey = min(max(ty, y0), y1)
    # snap to the nearest edge so the line starts on the border, not inside
    if abs(ex - x0) <= abs(ex - x1) and abs(ex - x0) < abs(ey - y0) and abs(ex - x0) < abs(ey - y1):
        ex = x0
    elif abs(ex - x1) < abs(ey - y0) and abs(ex - x1) < abs(ey - y1):
        ex = x1
    elif abs(ey - y0) <= abs(ey - y1):
        ey = y0
    else:
        ey = y1
    return (ex, ey)


def run_labels(src, manifest_path, dst):
    img = Image.open(src).convert('RGB')
    w, h = img.size
    d = ImageDraw.Draw(img, 'RGBA')
    font = load_font(max(13, w // 52))
    labels = json.load(open(manifest_path))
    for lab in labels:
        ax, ay = pct(lab['anchor'][0], w), pct(lab['anchor'][1], h)
        cx, cy = pct(lab['chip'][0], w), pct(lab['chip'][1], h)
        bbox = rounded_chip(d, cx, cy, lab['text'], font)
        sx, sy = edge_point(bbox, (ax, ay))
        d.line([(sx, sy), (ax, ay)], fill=LEADER, width=2)
        r = 4
        d.ellipse([ax - r, ay - r, ax + r, ay + r], fill=LEADER)
    img.save(dst)
    print(f'labels -> {dst} ({w}x{h}, {len(labels)} labels)')


def main():
    a = sys.argv[1:]
    if len(a) == 3 and a[0] == '--grid':
        run_grid(a[1], a[2])
    elif len(a) == 4 and a[0] == '--labels':
        run_labels(a[1], a[2], a[3])
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
