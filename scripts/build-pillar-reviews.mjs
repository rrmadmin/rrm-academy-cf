import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SSOT_PATH = path.join(__dirname, '..', 'ssot', 'pillars.json');
const PAGES_DIR = path.join(__dirname, '..', 'src', 'pages');
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'data', 'pillar-reviews.json');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function extractLastReviewed(astroSource) {
  const match = astroSource.match(/const\s+lastReviewed\s*=\s*['"]([^'"]+)['"]/);
  if (!match) return null;
  return ISO_DATE_RE.test(match[1]) ? match[1] : null;
}

function main() {
  const ssot = JSON.parse(fs.readFileSync(SSOT_PATH, 'utf8'));
  const reviews = {};

  for (const pillar of ssot.pillars) {
    const filePath = path.join(PAGES_DIR, pillar.file);
    if (!fs.existsSync(filePath)) {
      console.warn(`[pillar-reviews] missing: ${filePath}`);
      reviews[pillar.slug] = null;
      continue;
    }
    const src = fs.readFileSync(filePath, 'utf8');
    const lastReviewed = extractLastReviewed(src);
    reviews[pillar.slug] = lastReviewed;
    if (!lastReviewed) {
      console.warn(`[pillar-reviews] ${pillar.slug}: no lastReviewed frontmatter`);
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(reviews, null, 2) + '\n');
  console.log(`[pillar-reviews] wrote ${Object.keys(reviews).length} entries to ${OUTPUT_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
