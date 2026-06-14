// scripts/gates/verify-library-curation.mjs
// Fail-hard build-output proof gate for the library category curation. Run AFTER `npm run build`:
//   node --experimental-strip-types scripts/gates/verify-library-curation.mjs
// Exits nonzero on any violation so CI / the executor cannot mistake a regression for success.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { CATEGORIES, DEMOTED_SLUGS, topicSlug } from '../../src/data/library-topics.ts';

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const DIST = 'dist/library/topics';

// 1) exactly the browsable slugs exist as pages; none demoted.
const expected = new Set(CATEGORIES.filter((c) => c.browsable).map((c) => topicSlug(c.label)));
const got = existsSync(DIST) ? readdirSync(DIST, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
for (const d of got) if (!expected.has(d)) fail(`unexpected category page present: ${d}`);
for (const e of expected) if (!got.includes(e)) fail(`missing category page: ${e}`);
for (const d of DEMOTED_SLUGS) if (got.includes(d)) fail(`demoted slug still has a page: ${d}`);
console.log(`category pages: ${got.length} (expected ${expected.size})`);

// 2) no anti-RRM record's FULL slug leaks onto any category page. Derive the flagged set
//    from the SAME built data the page filter used (sentiment hostile/critical) so this
//    can't drift and can't collide with same-prefix supportive rebuttals. Match the exact
//    article-card href `/library/<full-slug>/`.
const data = JSON.parse(readFileSync('src/data/articles.json', 'utf8'));
const rows = Array.isArray(data) ? data : (data.results || data.articles || []);
const flaggedSlugs = rows
  .filter((a) => ['hostile', 'critical'].includes(String(a.sentiment || '').toLowerCase()))
  .map((a) => a.slug).filter(Boolean);
let leaks = 0;
for (const d of got) {
  const html = readFileSync(`${DIST}/${d}/index.html`, 'utf8');
  for (const slug of flaggedSlugs) {
    if (html.includes(`/library/${slug}/`)) { fail(`anti-RRM slug "${slug}" leaked onto /library/topics/${d}/`); leaks++; }
  }
}
console.log(`anti-RRM slugs checked (${flaggedSlugs.length}) across ${got.length} pages: ${leaks} leaks`);

// 3) schemamap (if built) lists no demoted slug.
if (existsSync('dist/schemamap.xml')) {
  const sm = readFileSync('dist/schemamap.xml', 'utf8');
  for (const d of DEMOTED_SLUGS) if (sm.includes(`/library/topics/${d}`)) fail(`schemamap still lists demoted ${d}`);
}

// 4) corpus headline count NOT collapsed to the safe subset — the hero text must still render.
const idx = readFileSync('dist/library/index.html', 'utf8');
if (!/academic scholarly works/i.test(idx)) fail('index hero corpus-count text missing/changed unexpectedly');

if (process.exitCode) { console.error('library-curation gate: FAILED'); }
else { console.log('library-curation gate: PASS'); }
