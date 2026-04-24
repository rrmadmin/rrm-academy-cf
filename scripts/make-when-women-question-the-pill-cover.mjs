import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const SRC = '/Users/brian/Desktop/RRM_Foundation_colored_pencil_drawing_--ar_11_--profile_dolmh_bb3fe541-f28a-4f44-8555-c81f35886cd3_3.png';
const OUT_WEBP = 'public/images/commentary/when-women-question-the-pill.webp';
const OUT_JPG = 'public/images/commentary/when-women-question-the-pill.jpg';
const SIZE = 1024;

await mkdir(dirname(OUT_WEBP), { recursive: true });

const base = sharp(SRC).resize(SIZE, SIZE, { fit: 'cover' });

await base.clone().webp({ quality: 88 }).toFile(OUT_WEBP);
await base.clone().jpeg({ quality: 88, mozjpeg: true }).toFile(OUT_JPG);

console.log(`wrote ${OUT_WEBP}`);
console.log(`wrote ${OUT_JPG}`);
