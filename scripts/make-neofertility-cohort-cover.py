#!/usr/bin/env python3
"""
make-neofertility-cohort-cover.py -- refresh the date line and the feature badge
on the NeoFertility Medical Training Cohort course cover, in place, on the real
vendor artwork.

The cover is an affiliate asset we did not author, so this does NOT redraw it.
It repaints exactly two windows -- the date line and the interior of the red
badge -- and leaves every other pixel byte-identical: the NEOFERTILITY /
MEDICAL TRAINING COHORT lockup, the neo mark, the blue diagonals and the
background gradient all survive untouched. Verify that after any run:

    python3 - <<'EOF'
    from PIL import Image; import numpy as np
    a=np.array(Image.open('old.png').convert('RGB')).astype(int)
    b=np.array(Image.open('new.png').convert('RGB')).astype(int)
    d=(np.abs(a-b).sum(axis=2)>0)
    ys=np.where(d.any(axis=1))[0]; xs=np.where(d.any(axis=0))[0]
    print(ys.min(), ys.max(), xs.min(), xs.max())
    EOF

Fonts were identified from the source artwork by shape-matching every candidate
family at matched cap height (Montserrat Bold for the date, Poppins Medium for
the badge), both set with slight negative tracking to match. See tools/fonts/.

Copy rules baked in here on purpose, because they are facts and not taste:
  * NO end date. The vendor enrollment page (Dec 16) and the affiliate packet
    (Dec 10) disagree and the question is open, so the art states the start only.
  * NO CME credit number. The fall packet says "CME eligible" and states no
    number; the retired spring art claimed "20+ CME" and that claim is gone.

Usage (from the project root):
  # grab the currently published cover, refresh it, publish it back
  curl -sS https://rrmacademy.org/api/assets/course-covers/neofertility-med-training.webp -o /tmp/cover.webp
  dwebp /tmp/cover.webp -o /tmp/cover.png
  python3 scripts/make-neofertility-cohort-cover.py --in /tmp/cover.png --out /tmp/fall-cover
  # then, MAIN RRM account only (never the Five Star Practices account):
  CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/CF - Worker Deploy - account/credential') \
  CLOUDFLARE_ACCOUNT_ID=ecf2c5bc8b5ebd634bcb587b3890910a \
  npx wrangler r2 object put rrm-assets/course-covers/neofertility-med-training.webp \
    --remote --file /tmp/fall-cover.webp --content-type image/webp

/api/assets/ serves `public, max-age=31536000, immutable`, so overwriting the key
is NOT enough: purge the edge AND bump the version token on the `image` URL in
src/data/courses-overrides.json, or returning visitors keep the old art.

Requires Pillow and cwebp (both already prerequisites of the rrm-image-gen
pipeline).
"""
import argparse
import subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont

AP = argparse.ArgumentParser()
AP.add_argument('--in', dest='src', required=True, help='PNG of the current cover (1280x720)')
AP.add_argument('--out', dest='out', required=True, help='output basename; writes .png + .webp')
AP.add_argument('--fonts', default='tools/fonts')
AP.add_argument('--quality', type=int, default=75, help='cwebp quality; 75 lands near the vendor original (~31 KB)')
A = AP.parse_args()

MONT_BOLD = f'{A.fonts}/Montserrat-700.ttf'
POPP_MED = f'{A.fonts}/Poppins-500.ttf'

DATE = 'STARTS OCTOBER 13, 2026'
BADGE = ['CME ELIGIBLE • 10 LESSONS • 6 LIVE Q&AS',
         'CASE STUDIES • MEDICAL FORUM • CHART NEO']

# --- geometry, measured off the vendor artwork -------------------------------
DATE_BOX = (50, 433, 610, 487)     # repaint window for the old date line
DATE_BASELINE = 471
DATE_INK_LEFT = 72                 # original left ink edge
DATE_SIZE, DATE_TRACK = 44, -1.2
DATE_MAX_RIGHT = 638               # never overhang the badge below it

BADGE_INNER = (64, 506, 637, 590)  # interior only; the box edge is preserved
BADGE_BASELINES = (537, 580)
BADGE_CENTER_X = 350
BADGE_MAX_W = 548
BADGE_SIZE, BADGE_TRACK = 32, -1.6

im = Image.open(A.src).convert('RGB')
if im.size != (1280, 720):
    raise SystemExit(f'expected a 1280x720 source, got {im.size}')
a = np.array(im).astype(np.float64)

# --- 1. wipe the old date line ----------------------------------------------
# The backdrop there is a smooth light gradient, so rebuild it by interpolating
# vertically between the clean scan lines just above and just below the text.
x0, y0, x1, y1 = DATE_BOX
top = a[y0 - 1, x0:x1 + 1]
bot = a[y1 + 1, x0:x1 + 1]
t = np.linspace(0.0, 1.0, (y1 - y0 + 1) + 2)[1:-1][:, None, None]
a[y0:y1 + 1, x0:x1 + 1] = top[None] * (1 - t) + bot[None] * t

# --- 2. wipe the old badge text ---------------------------------------------
# Keep the red box itself: its soft 1px edge and its faint vertical gradient are
# part of the original. Rebuild only the interior, row by row, from the median of
# that row's surviving red pixels, so the gradient comes back exactly.
bx0, by0, bx1, by1 = BADGE_INNER
src = np.array(im).astype(int)
for y in range(by0, by1 + 1):
    row = src[y, bx0:bx1 + 1]
    red = row[(row[:, 0] > 150) & (row[:, 1] < 130)]
    a[y, bx0:bx1 + 1] = np.median(red, axis=0) if len(red) else np.array([213.0, 61.0, 87.0])
im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def draw_tracked(img, text, font, track, pen_x, baseline, fill):
    """Draw one line with per-character advance, so tracking matches the source."""
    d = ImageDraw.Draw(img)
    x = float(pen_x)
    for ch in text:
        d.text((x, baseline), ch, font=font, fill=fill, anchor='ls')
        x += d.textlength(ch, font=font) + track


def measure(text, font, track):
    """Return (left sidebearing, ink width) for a tracked line."""
    probe = Image.new('L', (2400, 200), 255)
    draw_tracked(probe, text, font, track, 100, 150, 0)
    xs = np.where((np.array(probe) < 200).any(axis=0))[0]
    return xs.min() - 100, xs.max() - xs.min() + 1


# --- 3. new date line --------------------------------------------------------
# The fall date sets wider than the spring one, so step down until it stops
# overhanging the badge underneath it.
d_size = DATE_SIZE
while True:
    f_date = ImageFont.truetype(MONT_BOLD, d_size)
    d_track = DATE_TRACK * d_size / DATE_SIZE
    if DATE_INK_LEFT + measure(DATE, f_date, d_track)[1] - 1 <= DATE_MAX_RIGHT or d_size <= 30:
        break
    d_size -= 1
# Put the pen where the ORIGINAL pen was, so the typographic left margin is
# preserved rather than the accidental sidebearing of whichever letter leads.
old_bearing, _ = measure('APRIL 20 - JULY 2, 2026', f_date, d_track)
draw_tracked(im, DATE, f_date, d_track, DATE_INK_LEFT - old_bearing, DATE_BASELINE, (0, 0, 0))

# --- 4. new badge text -------------------------------------------------------
# Fall content is longer than spring's, so step the size down until the wider
# line clears the box, keeping tracking proportional.
size = BADGE_SIZE
while True:
    f_badge = ImageFont.truetype(POPP_MED, size)
    b_track = BADGE_TRACK * size / BADGE_SIZE
    widths = [measure(l, f_badge, b_track)[1] for l in BADGE]
    if max(widths) <= BADGE_MAX_W or size <= 18:
        break
    size -= 1
for line, base in zip(BADGE, BADGE_BASELINES):
    bearing, w = measure(line, f_badge, b_track)
    draw_tracked(im, line, f_badge, b_track, BADGE_CENTER_X - w // 2 - bearing, base, (255, 255, 255))

im.save(f'{A.out}.png')
subprocess.run(['cwebp', '-q', str(A.quality), '-m', '6', '-sharp_yuv', '-quiet',
                f'{A.out}.png', '-o', f'{A.out}.webp'], check=True)
print(f'wrote {A.out}.png + {A.out}.webp  (date {d_size}px, badge {size}px, badge widths {widths})')
