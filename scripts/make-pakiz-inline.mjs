import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const SRC = '/Users/brian/Desktop/pakiz.png';
const SLUG = 'rrm-physician-spotlight-kristina-pakiz-md-inline';
const OUT_WEBP = `public/images/commentary/${SLUG}.webp`;
const OUT_JPG  = `public/images/commentary/${SLUG}.jpg`;
const MAX_WIDTH = 1024;

await mkdir(dirname(OUT_WEBP), { recursive: true });

const base = sharp(SRC).resize(MAX_WIDTH, null, { fit: 'inside', withoutEnlargement: true });

await base.clone().webp({ quality: 88 }).toFile(OUT_WEBP);
await base.clone().jpeg({ quality: 88, mozjpeg: true }).toFile(OUT_JPG);

console.log(`wrote ${OUT_WEBP}`);
console.log(`wrote ${OUT_JPG}`);
