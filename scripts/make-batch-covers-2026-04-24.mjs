import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const SRC_DIR = '/Users/brian/Desktop/Square Blog Images';
const SIZE = 1024;

const JOBS = [
  { src: `${SRC_DIR}/Luteal Phase Progesterone.png`, slug: 'the-forgotten-hormone-progesterone' },
  { src: `${SRC_DIR}/RRM Physician Spotlight Kristina Pakiz.png`, slug: 'rrm-physician-spotlight-kristina-pakiz-md' },
  { src: `${SRC_DIR}/When Women Question the Pill Women Question the Pill.png`, slug: 'when-women-question-the-pill' },
  { src: `${SRC_DIR}/Why Does  Endo Happen.png`, slug: 'why-does-endometriosis-happen' },
  { src: `${SRC_DIR}/Endo Self Survey.png`, slug: 'free-endometriosis-symptom-self-survey' },
  { src: `${SRC_DIR}/RRM Glossary.png`, slug: 'rrm-glossary-patient-guide' },
];

for (const { src, slug } of JOBS) {
  const outWebp = `public/images/commentary/${slug}.webp`;
  const outJpg = `public/images/commentary/${slug}.jpg`;
  await mkdir(dirname(outWebp), { recursive: true });
  const base = sharp(src).resize(SIZE, SIZE, { fit: 'cover' });
  await base.clone().webp({ quality: 88 }).toFile(outWebp);
  await base.clone().jpeg({ quality: 88, mozjpeg: true }).toFile(outJpg);
  console.log(`wrote ${outWebp}`);
  console.log(`wrote ${outJpg}`);
}
