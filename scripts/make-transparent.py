#!/usr/bin/env python3
"""make-transparent.py -- background processing for the RRM Academy spot-illustration series.

Default: flood-fill the near-white background to transparent (line-edge halo
feathered), then trim to the content bounding box with a small padding.

--flat RRGGBB: after the transparent cut-out, composite the result over a solid
background of that hex colour and write an opaque RGB image. Use ffffff for
white cards or f7f5f3 for the RRM Academy paper background. A leading '#' is
accepted and ignored.

Usage:
  make-transparent.py IN.png OUT.png [--flat RRGGBB] [--no-trim] [--thresh N] [--pad F]
"""
import sys
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

DARK_CUT = 150       # mean RGB below this is treated as linework
LINE_RADIUS = 4
BG_RADIUS = 5


def dilate(mask, radius):
    m = Image.fromarray((mask * 255).astype("uint8"))
    m = m.filter(ImageFilter.MaxFilter(radius * 2 + 1))
    return np.array(m) > 127


def trim_box(img, content_mask_img, pad):
    bbox = content_mask_img.getbbox()
    if not bbox:
        return img
    w, h = img.size
    cw, ch = bbox[2] - bbox[0], bbox[3] - bbox[1]
    px, py = int(cw * pad), int(ch * pad)
    return img.crop((
        max(0, bbox[0] - px), max(0, bbox[1] - py),
        min(w, bbox[2] + px), min(h, bbox[3] + py),
    ))


def process(src, dst, thresh, trim, pad, flat):
    img = Image.open(src).convert("RGBA")
    w, h = img.size

    # Flood-fill inward from all four corners so only the connected background
    # becomes transparent -- white pixels enclosed by the subject are kept.
    work = img.copy()
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(work, seed, (255, 255, 255, 0), thresh=thresh)
    bg = np.array(work.getchannel("A")) == 0

    rgb = np.array(img.convert("RGB")).astype(np.float64)
    light = rgb.mean(axis=2)
    dark = light < DARK_CUT
    near_line = dilate(dark, LINE_RADIUS)
    near_bg = dilate(bg, BG_RADIUS)
    halo = near_line & near_bg & ~dark & ~bg

    # Feather the anti-alias ring between linework and cleared background.
    alpha = np.full((h, w), 255.0)
    alpha[bg] = 0.0
    ramp = np.clip((255.0 - light) * (255.0 / (255.0 - DARK_CUT)), 0, 255)
    alpha[halo] = ramp[halo]
    img.putalpha(Image.fromarray(alpha.astype("uint8")))

    if trim:
        img = trim_box(img, img.getchannel("A"), pad)

    if flat:
        hexv = flat.lstrip("#")
        bg_rgb = tuple(int(hexv[i:i + 2], 16) for i in (0, 2, 4))
        flat_img = Image.new("RGB", img.size, bg_rgb)
        flat_img.paste(img, mask=img.getchannel("A"))
        flat_img.save(dst)
        print(f"flat #{hexv} -> {dst} ({img.size[0]}x{img.size[1]})")
    else:
        img.save(dst)
        print(f"transparent -> {dst} ({img.size[0]}x{img.size[1]})")


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(1)
    src, dst = args[0], args[1]
    trim = "--no-trim" not in args
    pad = float(args[args.index("--pad") + 1]) if "--pad" in args else 0.05
    thresh = int(args[args.index("--thresh") + 1]) if "--thresh" in args else 12
    flat = args[args.index("--flat") + 1] if "--flat" in args else None
    process(src, dst, thresh, trim, pad, flat)


if __name__ == "__main__":
    main()
