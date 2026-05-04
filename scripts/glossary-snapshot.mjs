/**
 * Glossary structural snapshot check.
 *
 * Two modes (orthogonal, can combine):
 *
 * Pillar mode (default, --spokes not set)
 *   Validates that the rendered /glossary/ pillar page is internally consistent:
 *     - Term count matches src/data/glossary.json
 *     - Reference count matches glossary.json
 *     - Every term anchor (id="<slug>") exists
 *     - Every reference anchor (id="ref-<N>") exists
 *     - Every <sup><a href="#ref-N"> resolves to an existing ref anchor
 *     - Every <a href="#slug"> cross-ref inside a term body resolves to an existing term anchor
 *     - No em dashes in glossary main content
 *     - Page is not the static 404
 *     - JSON-LD DefinedTermSet parses + has matching term count
 *
 * Spoke mode (--spokes)
 *   Walks every published term and validates each spoke page:
 *     S1. dist/glossary/<slug>/index.html exists (or live URL returns 200)
 *     S2. Exactly 1 <h1 in the rendered HTML
 *     S3. Zero <h2 whose text equals the term name (catches duplicate-heading regression)
 *     S4. Exactly 3 application/ld+json blocks (DefinedTerm, MedicalWebPage, BreadcrumbList)
 *     S5. Cross-reference @id integrity:
 *           DefinedTerm.subjectOf.@id === MedicalWebPage.@id
 *           MedicalWebPage.mainEntity.@id === DefinedTerm.@id
 *           DefinedTerm.@id === https://rrmacademy.org/glossary/<slug>/#term
 *           MedicalWebPage.@id === https://rrmacademy.org/glossary/<slug>/#webpage
 *     S6. Cross-ref rewriter coverage: every /glossary/<slug>/ link in the article body
 *         resolves to a published term, and every /glossary/#<anchor> link is a known
 *         pillar anchor (ref-N, abbreviations, references, or a published term slug).
 *   After per-spoke checks, runs PARITY checks:
 *     P1. Pillar HTML DefinedTermSet @id count equals number of spoke directories in dist/
 *     P2. Sitemap glossary URL count (excluding /glossary/ root) equals spoke directory count
 *
 * Usage:
 *   node scripts/glossary-snapshot.mjs                   # pillar checks against dist/
 *   node scripts/glossary-snapshot.mjs --live            # pillar checks against live URL
 *   node scripts/glossary-snapshot.mjs --spokes          # spoke + parity checks against dist/
 *   node scripts/glossary-snapshot.mjs --spokes --live   # spoke + parity checks against live
 *   GLOSSARY_URL=https://staging.example/glossary/ node scripts/glossary-snapshot.mjs --live
 *
 * Exits non-zero on any failure for CI integration.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const useLive = process.argv.includes('--live') || !!process.env.GLOSSARY_URL;
const checkSpokes = process.argv.includes('--spokes');
const liveUrl = process.env.GLOSSARY_URL || 'https://rrmacademy.org/glossary/';

const data = JSON.parse(readFileSync(join(ROOT, 'src/data/glossary.json'), 'utf-8'));
const expectedTerms = data.terms.length;
const expectedRefs = data.references.length;
const publishedTerms = data.terms.filter((t) => t.status === 'published');
const publishedSlugSet = new Set(publishedTerms.map((t) => t.slug));

const failures = [];
function fail(msg) { failures.push(msg); }
function pass(msg) { console.log(`  PASS: ${msg}`); }

// ---------- helpers shared by both modes ----------------------------------

async function fetchHtml(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          if (res.status >= 500 && attempt < 3) {
            await new Promise(r => setTimeout(r, attempt * 500));
            continue;
          }
          throw new Error(`GET ${url} returned ${res.status}`);
        }
        return await res.text();
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastErr = err;
      if (attempt < 3 && (err.name === 'AbortError' || err.message?.includes('fetch'))) {
        await new Promise(r => setTimeout(r, attempt * 500));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function readDistFile(relPath) {
  const distPath = join(ROOT, relPath);
  if (!existsSync(distPath)) {
    throw new Error(`${distPath} not found. Run \`npm run build\` first or use --live.`);
  }
  return readFileSync(distPath, 'utf-8');
}

// Strip HTML tags for text comparison (used by S3 duplicate-h2 check).
function textOf(htmlFragment) {
  return htmlFragment.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// Pull all <script type="application/ld+json"> blobs and JSON.parse each.
function extractJsonLdBlocks(html) {
  const matches = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  return matches.map((m, i) => {
    try {
      return { ok: true, value: JSON.parse(m[1]) };
    } catch (err) {
      return { ok: false, value: null, err: err.message, idx: i };
    }
  });
}

// ---------- PILLAR MODE ---------------------------------------------------

async function runPillarChecks() {
  let html;
  if (useLive) {
    console.log(`Fetching ${liveUrl}`);
    html = await fetchHtml(liveUrl);
  } else {
    html = readDistFile('dist/glossary/index.html');
  }

  // 1. Static 404 detection
  if (html.includes('Page Not Found')) {
    fail('Pillar page contains "Page Not Found" - likely served the static 404 at /glossary/');
  } else {
    pass('Pillar page is not the static 404');
  }

  // 2. Term anchor count (anchors are emitted with id="<slug>" by the GlossaryTerm component)
  const termAnchors = [...html.matchAll(/<h3 id="([^"]+)"/g)].map((m) => m[1]);
  // Glossary has no other <h3 id="..."> in <main>, so this count equals visible terms.
  // But the inline cta-box uses <h3> WITHOUT an id, so this regex is precise.
  if (termAnchors.length !== publishedTerms.length) {
    fail(`Pillar term anchor count mismatch: rendered ${termAnchors.length}, expected ${publishedTerms.length} (published terms only)`);
  } else {
    pass(`Pillar term anchors: ${termAnchors.length}`);
  }
  const termSet = new Set(termAnchors);

  // 3. Reference anchor count
  const refAnchors = [...html.matchAll(/<li id="ref-(\d+)"/g)].map((m) => parseInt(m[1]));
  if (refAnchors.length !== expectedRefs) {
    fail(`Pillar reference anchor count mismatch: rendered ${refAnchors.length}, expected ${expectedRefs}`);
  } else {
    pass(`Pillar reference anchors: ${refAnchors.length}`);
  }
  const refSet = new Set(refAnchors);

  // 4. <sup> citation resolution
  const citationRefs = [...html.matchAll(/<sup[^>]*>\s*<a[^>]*href="#ref-(\d+)"/g)].map((m) => parseInt(m[1]));
  const brokenCites = citationRefs.filter((n) => !refSet.has(n));
  if (brokenCites.length > 0) {
    fail(`Pillar broken citations: ${brokenCites.length} <sup> markers point to non-existent ref-N (${[...new Set(brokenCites)].slice(0, 5).join(', ')}${brokenCites.length > 5 ? '...' : ''})`);
  } else {
    pass(`Pillar citation links resolve (${citationRefs.length} total <sup> markers)`);
  }

  // 5. Cross-ref resolution
  const crossRefs = [...html.matchAll(/<a[^>]*href="#([a-z0-9\-]+)"/g)].map((m) => m[1]);
  const sectionAnchors = new Set([
    'overview', 'abbreviations', 'references', 'key-takeaways',
    'core-rrm-principles', 'fertility-awareness', 'clinical-approaches',
    'diagnostic-tools', 'surgical-techniques', 'conditions',
    'overlapping-disciplines', 'broader-framework',
  ]);
  const refLinks = new Set(refAnchors.map((n) => `ref-${n}`));
  const broken = crossRefs.filter((s) => !termSet.has(s) && !sectionAnchors.has(s) && !refLinks.has(s) && !s.startsWith('ref-'));
  if (broken.length > 0) {
    fail(`Pillar broken cross-refs: ${broken.length} <a href="#..."> point to non-existent anchors (${[...new Set(broken)].slice(0, 8).join(', ')}${broken.length > 8 ? '...' : ''})`);
  } else {
    pass(`Pillar cross-references resolve (${crossRefs.length} total internal anchors)`);
  }

  // 6. Em dash sweep in <main>
  const mainMatch = html.match(/<main[^>]*>([\s\S]+?)<\/main>/);
  const mainContent = mainMatch ? mainMatch[1] : html;
  const emDashCount = (mainContent.match(/—/g) || []).length + (mainContent.match(/&mdash;/g) || []).length;
  if (emDashCount > 0) {
    fail(`Pillar em dashes in main content: ${emDashCount}`);
  } else {
    pass('Pillar has no em dashes in main content');
  }

  // 7. JSON-LD DefinedTermSet validation
  const ldMatch = html.match(/<script type="application\/ld\+json"[^>]*>(\{"@context":"https:\/\/schema\.org","@type":"DefinedTermSet"[\s\S]+?\})<\/script>/);
  if (!ldMatch) {
    fail('Pillar DefinedTermSet JSON-LD block not found');
  } else {
    try {
      const ld = JSON.parse(ldMatch[1]);
      const ldTermCount = (ld.hasDefinedTerm || []).length;
      if (ldTermCount !== publishedTerms.length) {
        fail(`Pillar DefinedTermSet term count mismatch: ${ldTermCount} in schema vs ${publishedTerms.length} published terms`);
      } else {
        pass(`Pillar DefinedTermSet schema: ${ldTermCount} terms`);
      }
      const ldSlugs = (ld.hasDefinedTerm || []).map((t) => {
        // After spoke pages shipped, @id is /glossary/<slug>/#term (not /glossary/#<slug>).
        // Accept either format for backward compatibility.
        const id = t['@id'] || '';
        const m = id.match(/\/glossary\/([a-z0-9\-]+)\/#term$/) || id.match(/\/glossary\/#([a-z0-9\-]+)$/);
        return m ? m[1] : null;
      }).filter(Boolean);
      const orphanLdSlugs = ldSlugs.filter((s) => !termSet.has(s));
      if (orphanLdSlugs.length > 0) {
        fail(`Pillar schema @id orphans: ${orphanLdSlugs.length} DefinedTerm @ids do not match any rendered term anchor (${orphanLdSlugs.slice(0, 5).join(', ')})`);
      } else {
        pass('All pillar DefinedTerm @ids resolve to rendered anchors');
      }
    } catch (err) {
      fail(`Pillar DefinedTermSet JSON-LD parse error: ${err.message}`);
    }
  }
}

// ---------- SPOKE MODE ----------------------------------------------------

// Tiny concurrency limiter (no extra dependency).
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await mapper(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function checkOneSpoke(slug, name, html) {
  const slugFails = [];

  // S2: exactly 1 <h1
  const h1Count = (html.match(/<h1[\s>]/g) || []).length;
  if (h1Count !== 1) {
    slugFails.push(`${slug}: S2 expected exactly 1 <h1 (got ${h1Count})`);
  }

  // S3: zero <h2 whose text equals the term name (catches the duplicate-heading regression)
  const h2Blocks = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => textOf(m[1]));
  const termNameNorm = name.trim().toLowerCase();
  const offending = h2Blocks.filter((t) => t.toLowerCase() === termNameNorm);
  if (offending.length > 0) {
    slugFails.push(`${slug}: S3 found ${offending.length} <h2> whose text equals the term name "${name}" (duplicate-heading regression)`);
  }

  // S4: exactly 3 application/ld+json blocks with the right @types
  const ldBlocks = extractJsonLdBlocks(html);
  if (ldBlocks.length !== 3) {
    slugFails.push(`${slug}: S4 expected 3 JSON-LD blocks (got ${ldBlocks.length})`);
  }
  const parseFailures = ldBlocks.filter((b) => !b.ok);
  for (const pf of parseFailures) {
    slugFails.push(`${slug}: S4 JSON-LD block #${pf.idx} parse error: ${pf.err}`);
  }
  const expectedTypes = new Set(['DefinedTerm', 'MedicalWebPage', 'BreadcrumbList']);
  const seenTypes = new Set(ldBlocks.filter((b) => b.ok).map((b) => b.value['@type']));
  const missingTypes = [...expectedTypes].filter((t) => !seenTypes.has(t));
  if (missingTypes.length > 0) {
    slugFails.push(`${slug}: S4 missing JSON-LD @type(s): [${missingTypes.join(', ')}], saw [${[...seenTypes].join(', ')}]`);
  }

  // S5: cross-reference @id integrity
  const definedTermBlock = ldBlocks.find((b) => b.ok && b.value['@type'] === 'DefinedTerm');
  const webPageBlock     = ldBlocks.find((b) => b.ok && b.value['@type'] === 'MedicalWebPage');
  if (definedTermBlock && webPageBlock) {
    const dt = definedTermBlock.value;
    const wp = webPageBlock.value;
    const expectedTermId = `https://rrmacademy.org/glossary/${slug}/#term`;
    const expectedWebPageId = `https://rrmacademy.org/glossary/${slug}/#webpage`;
    if (dt['@id'] !== expectedTermId) {
      slugFails.push(`${slug}: S5 DefinedTerm.@id is "${dt['@id']}", expected "${expectedTermId}"`);
    }
    if (wp['@id'] !== expectedWebPageId) {
      slugFails.push(`${slug}: S5 MedicalWebPage.@id is "${wp['@id']}", expected "${expectedWebPageId}"`);
    }
    const dtSubjectOfId = dt.subjectOf && (typeof dt.subjectOf === 'string' ? dt.subjectOf : dt.subjectOf['@id']);
    if (dtSubjectOfId !== wp['@id']) {
      slugFails.push(`${slug}: S5 DefinedTerm.subjectOf.@id (${dtSubjectOfId}) does not match MedicalWebPage.@id (${wp['@id']})`);
    }
    const wpMainEntityId = wp.mainEntity && (typeof wp.mainEntity === 'string' ? wp.mainEntity : wp.mainEntity['@id']);
    if (wpMainEntityId !== dt['@id']) {
      slugFails.push(`${slug}: S5 MedicalWebPage.mainEntity.@id (${wpMainEntityId}) does not match DefinedTerm.@id (${dt['@id']})`);
    }
  }

  // S6: cross-ref rewriter coverage. Restrict scan to <article class="prose"> body content.
  const articleMatch = html.match(/<article[^>]*class="[^"]*\bprose\b[^"]*"[^>]*>([\s\S]*?)<\/article>/);
  const articleHtml = articleMatch ? articleMatch[1] : '';
  // Two link shapes the rewriter produces inside body content:
  //   /glossary/<slug>/   - direct sibling spoke link
  //   /glossary/#<anchor> - jump back to pillar (ref-N, abbreviations, references)
  const slugLinks = [...articleHtml.matchAll(/href="\/glossary\/([a-z0-9\-]+)\/"/g)].map((m) => m[1]);
  for (const target of slugLinks) {
    if (!publishedSlugSet.has(target)) {
      slugFails.push(`${slug}: S6 body links to /glossary/${target}/ but no such published term exists`);
    }
  }
  const anchorLinks = [...articleHtml.matchAll(/href="\/glossary\/#([a-z0-9\-]+)"/g)].map((m) => m[1]);
  for (const target of anchorLinks) {
    const okAnchor =
      /^ref-\d+$/.test(target) ||
      target === 'abbreviations' ||
      target === 'references' ||
      publishedSlugSet.has(target);
    if (!okAnchor) {
      slugFails.push(`${slug}: S6 body links to /glossary/#${target} but no such anchor (ref-N, abbreviations, references, or published term slug) is valid`);
    }
  }

  return slugFails;
}

async function runSpokeChecks() {
  // S1: existence + content acquisition
  const distGlossary = join(ROOT, 'dist/glossary');
  let distSpokeDirs = [];
  if (!useLive) {
    if (!existsSync(distGlossary)) {
      fail(`dist/glossary/ not found. Run \`npm run build\` first or use --live.`);
      return;
    }
    distSpokeDirs = readdirSync(distGlossary)
      .filter((name) => statSync(join(distGlossary, name)).isDirectory())
      .sort();
  }

  // For live mode, the spoke set comes from glossary.json published-status filter.
  const spokesToCheck = publishedTerms.map((t) => ({ slug: t.slug, name: t.name }));

  // S1: every published term has a corresponding HTML output.
  const missingDist = [];
  if (!useLive) {
    const distSet = new Set(distSpokeDirs);
    for (const { slug } of spokesToCheck) {
      if (!distSet.has(slug)) {
        missingDist.push(slug);
      } else {
        const htmlPath = join(distGlossary, slug, 'index.html');
        if (!existsSync(htmlPath)) missingDist.push(`${slug} (dir exists, index.html missing)`);
      }
    }
    if (missingDist.length > 0) {
      fail(`S1 missing dist spoke output for ${missingDist.length} published term(s): ${missingDist.slice(0, 5).join(', ')}${missingDist.length > 5 ? '...' : ''}`);
    } else {
      pass(`S1 every published term (${spokesToCheck.length}) has a dist spoke output`);
    }
  }

  // Walk each spoke. Live mode uses concurrency=5; dist mode is local I/O.
  const allSpokeFailures = [];
  if (useLive) {
    const liveOrigin = new URL(liveUrl).origin;
    await mapWithConcurrency(spokesToCheck, 5, async ({ slug, name }) => {
      const url = `${liveOrigin}/glossary/${slug}/`;
      try {
        const html = await fetchHtml(url);
        allSpokeFailures.push(...checkOneSpoke(slug, name, html));
      } catch (err) {
        allSpokeFailures.push(`${slug}: S1 live fetch failed: ${err.message}`);
      }
    });
  } else {
    for (const { slug, name } of spokesToCheck) {
      const htmlPath = join(distGlossary, slug, 'index.html');
      if (!existsSync(htmlPath)) continue; // already counted in missingDist above
      const html = readFileSync(htmlPath, 'utf-8');
      allSpokeFailures.push(...checkOneSpoke(slug, name, html));
    }
  }

  if (allSpokeFailures.length > 0) {
    for (const f of allSpokeFailures) fail(f);
  } else {
    pass(`S2-S6 every spoke (${spokesToCheck.length}) passes structural checks`);
  }

  // PARITY checks
  // P1: pillar HTML DefinedTermSet @id count equals number of spoke directories
  let pillarHtml;
  if (useLive) {
    try {
      pillarHtml = await fetchHtml(liveUrl);
    } catch (err) {
      fail(`P1 cannot fetch pillar for parity check: ${err.message}`);
    }
  } else {
    try {
      pillarHtml = readDistFile('dist/glossary/index.html');
    } catch (err) {
      fail(`P1 cannot read pillar for parity check: ${err.message}`);
    }
  }

  if (pillarHtml) {
    const pillarSpokeRefs = [...pillarHtml.matchAll(/"https:\/\/rrmacademy\.org\/glossary\/([a-z0-9\-]+)\/#term"/g)].map((m) => m[1]);
    const pillarSpokeRefSet = new Set(pillarSpokeRefs);

    const spokeCount = useLive ? spokesToCheck.length : distSpokeDirs.length;
    if (pillarSpokeRefSet.size !== spokeCount) {
      fail(`P1 pillar DefinedTermSet has ${pillarSpokeRefSet.size} unique spoke @ids but ${useLive ? 'published-terms' : 'dist/glossary directories'} count is ${spokeCount}`);
    } else {
      pass(`P1 pillar DefinedTermSet @id count (${pillarSpokeRefSet.size}) matches spoke count`);
    }
  }

  // P2: sitemap glossary URL count equals spoke count
  // Sitemaps are only meaningful in dist mode (live sitemap would also work but spoke pillar
  // suffices to surface drift; keep this scoped to dist mode for determinism).
  if (!useLive) {
    const sitemapUrls = collectSitemapGlossaryUrls();
    const expectedSpokeCount = distSpokeDirs.length;
    if (sitemapUrls.size !== expectedSpokeCount) {
      fail(`P2 sitemap glossary URL count (${sitemapUrls.size}, excluding /glossary/ root) does not match dist spoke count (${expectedSpokeCount})`);
    } else {
      pass(`P2 sitemap glossary URL count (${sitemapUrls.size}) matches dist spoke count`);
    }
  }
}

function collectSitemapGlossaryUrls() {
  const distDir = join(ROOT, 'dist');
  const out = new Set();
  if (!existsSync(distDir)) return out;
  const entries = readdirSync(distDir).filter((n) => n.startsWith('sitemap') && n.endsWith('.xml'));
  for (const name of entries) {
    const text = readFileSync(join(distDir, name), 'utf-8');
    const matches = [...text.matchAll(/https:\/\/rrmacademy\.org\/glossary\/([a-z0-9\-]+)\/?/g)];
    for (const m of matches) {
      const slug = m[1];
      // Exclude pillar root (no slug after /glossary/) - regex already requires a slug,
      // but defend against any /glossary/ root accidentally captured.
      if (slug && slug !== 'index') out.add(slug);
    }
  }
  return out;
}

// ---------- main ----------------------------------------------------------

(async () => {
  // Pillar checks always run (existing behavior). Spoke checks add on top.
  await runPillarChecks();

  if (checkSpokes) {
    console.log('');
    console.log('--- Spoke + parity checks ---');
    await runSpokeChecks();
  }

  console.log('');
  if (failures.length === 0) {
    const summary = checkSpokes
      ? `OK: glossary snapshot passes (${expectedTerms} terms, ${expectedRefs} refs, ${publishedTerms.length} spokes)`
      : `OK: glossary snapshot passes (${expectedTerms} terms, ${expectedRefs} refs)`;
    console.log(summary);
    process.exit(0);
  } else {
    console.error(`FAIL: ${failures.length} snapshot check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
})();
