#!/usr/bin/env node
/**
 * Hermetic fixture build: run the FULL production build chain (`npm run build`,
 * including the postbuild lifecycle hook) without secrets or network access.
 *
 * Purpose: verify framework/dependency upgrades (e.g. Astro major bumps) in any
 * environment before merge. The 5 D1-fetched data files (articles, posts, faqs,
 * courses, glossary) are gitignored and normally fetched with
 * LIBRARY_BUILD_TOKEN; this script stages synthetic fixtures from
 * scripts/fixtures/ for whichever of them are ABSENT, runs the real build, then
 * runs scripts/verify-build-output.mjs, and finally removes ONLY the files it
 * staged (real data is never clobbered, cleanup runs even on failure).
 *
 * Padding (why the staged files are bigger than the fixture sources):
 * several build-chain guards enforce production-scale record floors —
 *   - scripts/sync-library-count.mjs: FATAL if articles < 3000
 *   - src/lib/enrich-glossary.mjs:    FATAL if glossary terms < 100 or refs < 30
 *   - scripts/build-og-index.mjs:     floors library 2500 / commentary 5 / faqs 10 /
 *                                     courses 1 / glossary 100 (FLOOR_OVERRIDE_* env
 *                                     exists but is not used here — padding keeps the
 *                                     guards fully armed)
 * So the 2-3 rich fixture records per collection are padded with generated,
 * obviously-synthetic "Fixture Padding …" records up to those floors. Articles
 * are padded to EXACTLY the count in src/data/library-stats.json so that
 * sync-library-count.mjs recomputes the same display count and leaves its ~20
 * tracked target files (static-overrides/*, public/*, ssot/*) byte-identical.
 *
 * Tracked-file safety: the chain legitimately rewrites some TRACKED files from
 * data (src/data/page-dates.json gets fixture slugs; sync-library-count targets
 * could drift). Those are snapshotted before the build and restored afterwards
 * (try/finally), so the working tree ends exactly as it started.
 *
 * Hermetic-build notes (no bypasses of astro build / pagefind themselves):
 *   - scripts/ssot-prebuild.mjs + ssot-postbuild.mjs already have first-class
 *     CI fallbacks when the ../../tools/site-ssot satellite is absent.
 *   - No LIBRARY_BUILD_TOKEN / AWS / Stripe env is needed: the build chain
 *     never fetches — fetch-all is a separate npm script.
 *
 * Usage: npm run build:fixture
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, readdirSync, rmdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FIXTURE_DIR = join(__dirname, 'fixtures');
const DATA_DIR = join(ROOT, 'src', 'data');

// ---------------------------------------------------------------------------
// Padding generators — every generated record is unmistakably synthetic.
// ---------------------------------------------------------------------------

function paddingArticle(n) {
  const num = String(n).padStart(5, '0');
  return {
    id: `recFIXTUREPAD${num}`,
    slug: `fixture-padding-article-${num}`,
    type: 'journal_article',
    sourceType: 'journal',
    title: `Fixture Padding Article ${num}`,
    authors: '',
    shortCitation: '',
    year: 2019,
    abstract: `Placeholder padding record ${num} for build verification. Synthetic fixture, no real content.`,
    body: '',
    bodyFormat: '',
    mdR2Key: '',
    journal: '',
    journalAbbv: '',
    doi: `FIXTURE-DOI-PAD-${num}`,
    pmid: '',
    wikidataQid: '',
    sourceUrl: '',
    datePublished: '2019-01-01',
    volume: '',
    issue: '',
    pages: '',
    keywords: '',
    apaCitation: '',
    vancouverCitation: '',
    mlaCitation: '',
    topics: [],
    searchTerms: [],
    enrichmentStatus: 'enriched',
    identifiers: [],
    isOpenAccess: false,
    isCopyrighted: false,
    oaType: '',
    license: '',
    oaUrl: '',
    accessLevel: 'restricted',
    sentiment: '',
    rrmRelevance: '',
    domain: '',
    lastModified: '',
    dateAddedToLibrary: '',
    authorRecords: [],
    respondsTo: null,
    word_count: 13,
    insights: null,
    infographic: null,
  };
}

function paddingPost(n) {
  const num = String(n).padStart(2, '0');
  return {
    id: `recFIXTUREPADPOST${num}`,
    slug: `fixture-padding-post-${num}`,
    title: `Fixture Padding Post ${num}`,
    content: `Placeholder padding post ${num} for build verification. Synthetic fixture, no real content.`,
    excerpt: 'Placeholder padding excerpt for build verification.',
    author: '',
    contentPillar: '',
    coverImageUrl: '',
    publishDate: '2024-12-01',
    wordCount: 13,
    seoKeywords: '',
    audioUrl: '',
    lastModified: '2024-12-01T00:00:00.000Z',
  };
}

function paddingFaq(n) {
  const num = String(n).padStart(2, '0');
  return {
    id: `faq_fixture_pad_${num}`,
    faqId: `FIX-PAD-${num}`,
    slug: `fixture-padding-faq-${num}`,
    question: `Fixture Padding FAQ ${num}: synthetic placeholder question?`,
    basicAnswer: `Placeholder padding answer ${num} for build verification. Synthetic fixture, no real content.`,
    schemaAnswer: '',
    publishedAnswer: '',
    category: '',
    seoTitle: '',
    seoDescription: '',
    sortOrder: 100 + n,
    status: 'published',
    updatedAt: '2025-01-15T00:00:00.000Z',
    createdAt: '2025-01-15T00:00:00.000Z',
    evidence: [],
    libraryRefs: [],
  };
}

function paddingTerm(n) {
  const num = String(n).padStart(3, '0');
  return {
    id: `term_fixture_pad_${num}`,
    slug: `fixture-padding-term-${num}`,
    name: `Fixture Padding Term ${num}`,
    part: 'VIII',
    sortOrder: 100 + n,
    bodyHtml: `<p>Placeholder padding glossary term ${num} for build verification. Synthetic fixture entry with no real meaning, present only to satisfy the enrichment floor of one hundred published terms.</p>`,
    abbreviation: null,
    pillarLink: null,
    status: 'published',
    updatedAt: '2025-01-15T00:00:00.000Z',
    createdAt: '2025-01-15T00:00:00.000Z',
    definitionSources: [],
  };
}

function paddingReference(refNum) {
  return {
    refNum,
    anchorText: `Fixture Padding Reference ${refNum}`,
    url: `https://example.com/fixture-padding-reference-${refNum}`,
    publisher: 'Fixture Publisher',
    journal: '',
  };
}

// Article padding target: match library-stats.json exactly so
// sync-library-count.mjs recomputes identical output for its tracked targets.
function articleTargetCount() {
  const FLOOR = 3000; // sync-library-count FATALs below this
  try {
    const stats = JSON.parse(readFileSync(join(DATA_DIR, 'library-stats.json'), 'utf8'));
    if (Number.isInteger(stats.count) && stats.count >= FLOOR && stats.count < 10000) {
      return stats.count;
    }
  } catch {
    // fall through to floor
  }
  return FLOOR;
}

function padArray(records, target, gen) {
  const out = records.slice();
  for (let n = out.length + 1; out.length < target; n++) out.push(gen(n));
  return out;
}

// ---------------------------------------------------------------------------
// Fixture staging plan
// ---------------------------------------------------------------------------

const TARGETS = [
  {
    file: 'articles.json',
    stage() {
      const rich = JSON.parse(readFileSync(join(FIXTURE_DIR, 'articles.json'), 'utf8'));
      return padArray(rich, articleTargetCount(), paddingArticle);
    },
  },
  {
    file: 'posts.json',
    stage() {
      const rich = JSON.parse(readFileSync(join(FIXTURE_DIR, 'posts.json'), 'utf8'));
      return padArray(rich, 5, paddingPost); // og-index commentary floor: 5
    },
  },
  {
    file: 'faqs.json',
    stage() {
      const rich = JSON.parse(readFileSync(join(FIXTURE_DIR, 'faqs.json'), 'utf8'));
      return padArray(rich, 10, paddingFaq); // og-index faqs floor: 10
    },
  },
  {
    file: 'courses.json',
    stage() {
      return JSON.parse(readFileSync(join(FIXTURE_DIR, 'courses.json'), 'utf8'));
    },
  },
  {
    file: 'glossary.json',
    stage() {
      const g = JSON.parse(readFileSync(join(FIXTURE_DIR, 'glossary.json'), 'utf8'));
      g.terms = padArray(g.terms, 100, paddingTerm); // enrich-glossary floor: 100
      // enrich-glossary refs floor: 30 (rich fixtures use refNum 1..2)
      while (g.references.length < 30) {
        g.references.push(paddingReference(g.references.length + 1));
      }
      return g;
    },
  },
];

// Tracked files the build chain may legitimately rewrite from data. Snapshot +
// restore so a fixture build leaves the working tree untouched. This is the
// union of scripts/sync-library-count.mjs targets, page-dates output, and the
// library-stats fingerprint.
const TRACKED_MUTABLE = [
  'src/data/page-dates.json',
  'src/data/library-stats.json',
  'static-overrides/llms.txt',
  'static-overrides/llms-full.txt',
  'static-overrides/library-llms.txt',
  'static-overrides/courses-llms.txt',
  'static-overrides/faqs-llms.txt',
  'public/llms.txt',
  'public/llms-full.txt',
  'public/agents.md',
  'public/index.md',
  'public/openapi.json',
  'public/pricing.md',
  'public/.well-known/agent-card.json',
  'public/.well-known/mcp.json',
  'public/.well-known/mcp/server-card.json',
  'public/.well-known/ai-plugin.json',
  'public/.well-known/agent-skills/index.json',
  'public/.well-known/agent-skills/rrm-research-lookup/SKILL.md',
  'ssot/agent-surfaces.json',
  'ssot/site.json',
  // ssot-prebuild.mjs re-snapshots this TRACKED file from src/data/courses.json
  // (fixture data during a fixture build) — must be restored.
  'ssot/courses.json',
];

// Non-gitignored paths the chain CREATES (ssot-prebuild static llms.txt
// restore step). If absent before the run, remove them afterwards so the
// working tree ends exactly as it started. Parent dirs created along the way
// are pruned when left empty.
const CREATED_IF_ABSENT = [
  'public/library/llms.txt',
  'public/courses/llms.txt',
  'public/faqs/llms.txt',
  'public/schemamap.xml',
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
  if (res.error) throw res.error;
  return res.status ?? 1;
}

const staged = [];
const alreadyPresent = [];
const snapshots = new Map(); // absolute path -> Buffer

console.log('[build-fixture] Hermetic fixture build starting');

// 1. Stage fixtures for absent data files only.
for (const target of TARGETS) {
  const dest = join(DATA_DIR, target.file);
  if (existsSync(dest)) {
    alreadyPresent.push(target.file);
    continue;
  }
  const data = target.stage();
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(dest, JSON.stringify(data, null, 2));
  staged.push(dest);
  const count = Array.isArray(data) ? data.length : (data.terms?.length ?? 0);
  console.log(`[build-fixture] STAGED  src/data/${target.file} (${count} records, synthetic fixture)`);
}
for (const file of alreadyPresent) {
  console.log(`[build-fixture] PRESENT src/data/${file} (real data — left untouched)`);
}
if (staged.length === 0) {
  console.log('[build-fixture] All data files already present; running the build against real data.');
}

// 2. Snapshot tracked files the chain may rewrite, and record which
//    chain-created paths don't exist yet (so cleanup can remove them).
for (const rel of TRACKED_MUTABLE) {
  const abs = join(ROOT, rel);
  if (existsSync(abs)) snapshots.set(abs, readFileSync(abs));
}
const absentBeforeBuild = CREATED_IF_ABSENT
  .map((rel) => join(ROOT, rel))
  .filter((abs) => !existsSync(abs));

let exitCode = 1;
try {
  // 3. Full real build chain, including npm's postbuild lifecycle hook.
  //    SITE_SSOT_ENABLED defaults to 1 inside the build script itself;
  //    ssot-prebuild/postbuild fall back gracefully without the satellite tool.
  const buildStatus = run('npm', ['run', 'build']);
  if (buildStatus !== 0) {
    console.error(`[build-fixture] FAIL: npm run build exited ${buildStatus}`);
    exitCode = buildStatus;
  } else {
    // 4. Structural invariants against dist/.
    const verifyArgs = [join(__dirname, 'verify-build-output.mjs')];
    if (staged.length > 0) verifyArgs.push('--fixture');
    const verifyStatus = run('node', verifyArgs);
    if (verifyStatus !== 0) {
      console.error(`[build-fixture] FAIL: verify-build-output exited ${verifyStatus}`);
      exitCode = verifyStatus;
    } else {
      exitCode = 0;
    }
  }
} finally {
  // 5. Cleanup: remove ONLY files this run staged; restore tracked snapshots.
  for (const abs of staged) {
    try {
      unlinkSync(abs);
      console.log(`[build-fixture] CLEANED ${relative(ROOT, abs)}`);
    } catch (err) {
      console.error(`[build-fixture] WARN: failed to remove staged ${abs}: ${err.message}`);
    }
  }
  for (const [abs, before] of snapshots) {
    try {
      const after = existsSync(abs) ? readFileSync(abs) : null;
      if (!after || !after.equals(before)) {
        writeFileSync(abs, before);
        console.log(`[build-fixture] RESTORED ${relative(ROOT, abs)} (build had modified it)`);
      }
    } catch (err) {
      console.error(`[build-fixture] WARN: failed to restore ${abs}: ${err.message}`);
    }
  }
  for (const abs of absentBeforeBuild) {
    if (!existsSync(abs)) continue;
    try {
      unlinkSync(abs);
      console.log(`[build-fixture] CLEANED ${relative(ROOT, abs)} (created by the build)`);
      // Prune the parent dir if the build created it and it's now empty.
      const parent = dirname(abs);
      if (parent !== ROOT && existsSync(parent) && readdirSync(parent).length === 0) {
        rmdirSync(parent);
      }
    } catch (err) {
      console.error(`[build-fixture] WARN: failed to remove created ${abs}: ${err.message}`);
    }
  }
}

console.log(exitCode === 0
  ? '[build-fixture] GREEN: full build chain + output verification passed.'
  : `[build-fixture] RED: exiting ${exitCode}.`);
process.exit(exitCode);
