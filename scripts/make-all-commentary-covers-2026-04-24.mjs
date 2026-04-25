import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const SRC_DIR = '/Users/brian/Desktop/Square Blog Images';
const SIZE = 1024;

const JOBS = [
  { src: 'Endo Self Survey.png', slug: 'free-endometriosis-symptom-self-survey' },
  { src: 'Endometriosis and Medical Trauma.png', slug: 'endometriosis-and-medical-trauma-resources-for-recovery-for-the-whole-family' },
  { src: 'Glossary of Restorative Reproductive Medicine.png', slug: 'glossary-of-restorative-reproductive-medicine-rrm' },
  { src: 'Healing Postpartum Depression and Anxiety Naturally.png', slug: 'postpartum-depression-anxiety-natural-recovery' },
  { src: 'Living with PCOS.png', slug: 'living-with-pcos-a-personal-journey-of-healing-through-rrm-and-lifestyle-restoration' },
  { src: 'Luteal Phase Progesterone.png', slug: 'the-forgotten-hormone-progesterone' },
  { src: 'NaProTechnology Surgery.png', slug: 'naprotechnology-surgery-a-restorative-approach-to-fertility-and-gynecologic-health' },
  { src: 'NeoFertility Medical Training Spring Cohort.png', slug: 'neofertility-training-cohort-spring-2026' },
  { src: 'RRM Academy Research Library.png', slug: 'introducing-rrm-academy-research-library' },
  { src: 'RRM Explained.png', slug: 'rrm-explained-a-path-to-understanding-and-true-healing' },
  { src: 'RRM Glossary.png', slug: 'rrm-glossary-patient-guide' },
  { src: 'RRM Physician Spotlight Kristina Pakiz.png', slug: 'rrm-physician-spotlight-kristina-pakiz-md' },
  { src: 'RRM Physician Spotlight Naomi Whittaker.png', slug: 'rrm-spotlight-naomi-whittaker-md' },
  { src: 'RRM Physician Spotlight Patrick Yeung.png', slug: 'rrm-spotlight-patrick-p-yeung-jr-md' },
  { src: 'RRM Physician Spotlight Phil Boyle.png', slug: 'rrm-physician-spotlight-phil-boyle-md' },
  { src: 'Secondary Infertility After C-Section.png', slug: 'secondary-infertility-after-c-section-fertility-case-study-1' },
  { src: 'Take Action.png', slug: 'take-action-protect-womens-healthcare-choices' },
  { src: 'The RRM Research Library Just Got Better.png', slug: 'the-rrm-research-library-just-got-better' },
  { src: 'Understanding Endometriosis.png', slug: 'understanding-endometriosis-why-early-diagnosis-and-restorative-care-matter' },
  { src: 'Uterine Isthmocele.png', slug: 'uterine-isthmocele-c-section-scar-restorative-solutions' },
  { src: 'When Women Question the Pill.png', slug: 'when-women-question-the-pill' },
  { src: 'Why Does Endo Happen.png', slug: 'why-does-endometriosis-happen' },
];

for (const { src, slug } of JOBS) {
  const srcPath = `${SRC_DIR}/${src}`;
  const outWebp = `public/images/commentary/${slug}.webp`;
  const outJpg = `public/images/commentary/${slug}.jpg`;
  await mkdir(dirname(outWebp), { recursive: true });
  const base = sharp(srcPath).resize(SIZE, SIZE, { fit: 'cover' });
  await base.clone().webp({ quality: 88 }).toFile(outWebp);
  await base.clone().jpeg({ quality: 88, mozjpeg: true }).toFile(outJpg);
  console.log(`  ${slug}`);
}
console.log(`\ndone (${JOBS.length} slugs, ${JOBS.length * 2} files)`);
