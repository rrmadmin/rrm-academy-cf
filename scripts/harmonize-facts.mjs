#!/usr/bin/env node
/**
 * harmonize-facts.mjs — Dry-run dedup + merge proposer for Hilgers textbook facts.
 *
 * Background: D1 `rrm-library.facts` has two overlapping fact populations from
 * two extraction runs over the same 92 Hilgers chapters:
 *
 *   Wave 1 (2026-04-06): 782 facts with ids like `fact-wave1-*`, source_ids
 *     mostly point to recXXX article records (chapter recs) or journal articles.
 *   Today  (2026-04-19): 1,741 facts with ids like `fact-chapter-<slug>-N`,
 *     source_ids are chapter-slug strings.
 *
 * ~20 chapters are double-covered. This script DETECTS duplicates across the
 * two populations, picks a winner per cluster, and writes a dry-run JSON report.
 * It does NOT write to D1. A companion script `apply-harmonization.mjs` takes
 * the (optionally edited) report and executes the merges.
 *
 * Usage:
 *   node scripts/harmonize-facts.mjs              # dry-run; writes /tmp/harmonize-report.json
 *   node scripts/harmonize-facts.mjs --min-jaccard 0.7  # tune text similarity threshold
 *   node scripts/harmonize-facts.mjs --out /path/to/report.json
 */

import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const LOCAL_DB = join(homedir(), '.rrm-cli', 'rrm.db');
const D1_NAME = 'rrm-library';
const DEFAULT_OUT = '/tmp/harmonize-report.json';

// ---------- CLI ----------
const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const out = outIdx >= 0 ? argv[outIdx + 1] : DEFAULT_OUT;
const jacIdx = argv.indexOf('--min-jaccard');
const MIN_JACCARD = jacIdx >= 0 ? parseFloat(argv[jacIdx + 1]) : 0.75;

// ---------- Query helpers ----------
function d1Query(sql) {
  const raw = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', D1_NAME, '--remote', '--json', `--command=${sql}`],
    { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 128 * 1024 * 1024 }
  ).toString();
  const m = raw.match(/(\[[\s\S]*\])\s*$/);
  if (!m) throw new Error('d1 parse failed');
  return JSON.parse(m[1])[0]?.results || [];
}

function sqliteQuery(sql) {
  const out = execFileSync('sqlite3', ['-json', LOCAL_DB, sql], {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  return out.trim() ? JSON.parse(out) : [];
}

// ---------- Fingerprinting ----------
const STOPWORDS = new Set(
  'a an the of and or in on to for with by at from as is are was were be been being this that these those it its which who what how when where why'.split(' ')
);

function normalizeClaim(s) {
  if (!s) return '';
  return String(s).toLowerCase()
    .replace(/[^\p{L}\p{N}\s%]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s) {
  return normalizeClaim(s)
    .split(' ')
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const uni = new Set([...sa, ...sb]).size;
  return uni === 0 ? 0 : inter / uni;
}

function numericSignature(s) {
  if (!s) return '';
  const nums = String(s).match(/\b\d+(?:[.,]\d+)?\b/g) || [];
  return nums.map((n) => n.replace(',', '.')).sort().join('|');
}

function quotePrefix(verification) {
  if (!verification) return '';
  const m = verification.match(/Quote:\s*["\u201c\u201d\u2018\u2019\s]*([^"\u201c\u201d\u2018\u2019]{5,80})/);
  return m ? normalizeClaim(m[1]) : '';
}

function fingerprint(fact) {
  return {
    id: fact.id,
    source_id: fact.source_id,
    claim: fact.claim,
    norm_claim: normalizeClaim(fact.claim),
    tokens: tokenize(fact.claim),
    numsig: numericSignature(fact.claim),
    qprefix: quotePrefix(fact.verification_notes),
    verification_notes: fact.verification_notes,
    category: fact.category,
    domain: fact.domain,
    tradition: fact.tradition,
    claim_type: fact.claim_type,
    verified: fact.verified,
    updated_at: fact.updated_at,
    created_at: fact.created_at,
  };
}

// ---------- Winner scoring ----------
function quoteLength(verification) {
  if (!verification) return 0;
  const m = verification.match(/Quote:\s*["\u201c\u201d\u2018\u2019]?([^"\u201c\u201d\u2018\u2019]+)/);
  return m ? m[1].trim().length : 0;
}

function score(fact, articleBySlug, articleById) {
  let s = 0;
  // Longer quote = more source traceability
  s += Math.min(quoteLength(fact.verification_notes), 150) / 10;
  // Richer metadata
  if (fact.category) s += 2;
  if (fact.domain) s += 2;
  if (fact.tradition) s += 2;
  if (fact.claim_type) s += 1;
  // Article resolves to peer-reviewed source
  const art = articleById.get(fact.source_id) || articleBySlug.get(fact.source_id);
  if (art?.pmid || art?.doi) s += 10; // peer-reviewed
  if (art?.type === 'conference-presentation') s += 3;
  // Wave-1 facts often have richer claim text (extracted by different model run); tiebreaker
  if (fact.id && fact.id.startsWith('fact-wave1-')) s += 1;
  // Recency tiebreaker
  const ts = Date.parse(fact.updated_at || fact.created_at || '1970-01-01');
  s += Number.isFinite(ts) ? ts / 1e12 : 0;
  return s;
}

// ---------- Main ----------
console.log(`[harmonize] loading D1 facts...`);
const allFacts = d1Query(
  "SELECT id, claim, category, domain, tradition, claim_type, source_id, verified, verification_notes, created_at, updated_at FROM facts WHERE verified >= 1"
);
console.log(`  ${allFacts.length} facts loaded`);

console.log(`[harmonize] loading D1 articles for source resolution...`);
const allArticles = d1Query(
  "SELECT id, slug, title, type, pmid, doi FROM articles WHERE status = 'published' OR status = 'classified'"
);
const articleById = new Map();
const articleBySlug = new Map();
const articleByNormTitle = new Map();
for (const a of allArticles) {
  articleById.set(a.id, a);
  if (a.slug) articleBySlug.set(a.slug, a);
  const nt = normalizeClaim(a.title || '');
  if (nt) articleByNormTitle.set(nt, a);
}
console.log(`  ${allArticles.length} articles indexed`);

console.log(`[harmonize] loading local rrm-cli chapters for slug↔title map...`);
const localChapters = sqliteQuery(
  "SELECT slug, title FROM content WHERE type = 'chapter' AND authors LIKE '%Hilgers%'"
);
console.log(`  ${localChapters.length} local chapters indexed`);

// Build chapter-slug ↔ recXXX mapping via title match
const slugToRecId = new Map();
const recIdToSlug = new Map();
const chapterTitleMatches = [];
for (const c of localChapters) {
  const nt = normalizeClaim(c.title);
  const art = articleByNormTitle.get(nt);
  if (art && art.type === 'chapter') {
    slugToRecId.set(c.slug, art.id);
    recIdToSlug.set(art.id, c.slug);
    chapterTitleMatches.push({ slug: c.slug, rec_id: art.id, title: c.title });
  }
}
console.log(`  ${slugToRecId.size} chapters matched slug↔recId via title`);

// Partition facts
const waveFacts = allFacts.filter((f) => f.id && f.id.startsWith('fact-wave1-'));
const chapterFacts = allFacts.filter((f) => f.id && f.id.startsWith('fact-chapter-'));
const otherFacts = allFacts.filter(
  (f) => !f.id?.startsWith('fact-wave1-') && !f.id?.startsWith('fact-chapter-')
);
console.log(
  `  partitions: wave1=${waveFacts.length}, chapter=${chapterFacts.length}, other=${otherFacts.length}`
);

// Group facts by "canonical chapter slug"
function canonicalSlug(fact) {
  const src = fact.source_id;
  if (!src) return null;
  if (src.startsWith('chapter-')) return src;
  if (recIdToSlug.has(src)) return recIdToSlug.get(src);
  return null; // not a textbook chapter; skip
}

const byChapter = new Map();
for (const f of [...waveFacts, ...chapterFacts]) {
  const slug = canonicalSlug(f);
  if (!slug) continue;
  if (!byChapter.has(slug)) byChapter.set(slug, { wave: [], chapter: [] });
  const bucket = byChapter.get(slug);
  if (f.id.startsWith('fact-wave1-')) bucket.wave.push(fingerprint(f));
  else bucket.chapter.push(fingerprint(f));
}

console.log(
  `[harmonize] ${byChapter.size} chapters have facts from at least one source`
);

// Detect duplicates per chapter
const duplicates = []; // array of { slug, winner: id, losers: [ids], reason }
const unique = { wave: 0, chapter: 0 }; // facts with no cross-set match

for (const [slug, { wave, chapter }] of byChapter.entries()) {
  if (wave.length === 0 || chapter.length === 0) {
    // No cross-set overlap possible
    unique.wave += wave.length;
    unique.chapter += chapter.length;
    continue;
  }

  const matchedChapter = new Set();
  for (const w of wave) {
    let bestCh = null;
    let bestJac = 0;
    for (const ch of chapter) {
      if (matchedChapter.has(ch.id)) continue;
      // Strong signal: identical numeric signature (if any numbers present)
      let score = 0;
      if (w.numsig && w.numsig === ch.numsig) score += 0.4;
      // Token Jaccard
      const jac = jaccard(w.tokens, ch.tokens);
      score += jac * 0.6;
      if (score > bestJac) {
        bestJac = score;
        bestCh = ch;
      }
    }
    if (bestCh && bestJac >= MIN_JACCARD) {
      matchedChapter.add(bestCh.id);
      // Score winner
      const sw = score(w, articleBySlug, articleById);
      const sc = score(bestCh, articleBySlug, articleById);
      const winner = sw >= sc ? w : bestCh;
      const loser = winner === w ? bestCh : w;
      duplicates.push({
        slug,
        winner: {
          id: winner.id,
          source_id: winner.source_id,
          claim_preview: (winner.claim || '').slice(0, 120),
        },
        loser: {
          id: loser.id,
          source_id: loser.source_id,
          claim_preview: (loser.claim || '').slice(0, 120),
        },
        match_score: Number(bestJac.toFixed(3)),
        winner_score: Number(sw.toFixed(2)),
        loser_score: Number(sc.toFixed(2)),
        winner_from: winner.id.startsWith('fact-wave1-') ? 'wave1' : 'chapter',
        tiebreakers: {
          winner_quote_len: quoteLength(winner.verification_notes),
          loser_quote_len: quoteLength(loser.verification_notes),
          winner_has_all_meta: !!(winner.category && winner.domain && winner.tradition),
          loser_has_all_meta: !!(loser.category && loser.domain && loser.tradition),
        },
      });
    } else {
      unique.wave += 1;
    }
  }
  // Chapter facts not matched to any wave fact
  unique.chapter += chapter.filter((c) => !matchedChapter.has(c.id)).length;
}

// ---------- Source_id normalization recommendations ----------
// For wave1 facts whose source_id is a recXXX that maps to a chapter-slug,
// recommend re-pointing to the chapter-slug for canonical provenance.
const repointRecommendations = [];
for (const w of waveFacts) {
  if (w.source_id && recIdToSlug.has(w.source_id)) {
    repointRecommendations.push({
      fact_id: w.id,
      from_source: w.source_id,
      to_source: recIdToSlug.get(w.source_id),
    });
  }
}

// ---------- Report ----------
const report = {
  _meta: {
    generated_at: new Date().toISOString(),
    generator: 'scripts/harmonize-facts.mjs',
    min_jaccard: MIN_JACCARD,
    dry_run: true,
  },
  summary: {
    wave1_facts: waveFacts.length,
    chapter_facts: chapterFacts.length,
    other_facts: otherFacts.length,
    chapters_matched_via_title: slugToRecId.size,
    chapters_with_any_facts: byChapter.size,
    duplicate_clusters: duplicates.length,
    wave1_winners: duplicates.filter((d) => d.winner_from === 'wave1').length,
    chapter_winners: duplicates.filter((d) => d.winner_from === 'chapter').length,
    repoint_recommendations: repointRecommendations.length,
    unique_wave1_facts_no_match: unique.wave,
    unique_chapter_facts_no_match: unique.chapter,
  },
  slug_rec_id_map: chapterTitleMatches,
  duplicates,
  repoint_recommendations: repointRecommendations,
};

writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\n═══ Harmonization Report ═══`);
for (const [k, v] of Object.entries(report.summary)) {
  console.log(`  ${k.padEnd(32)} ${v}`);
}
console.log(`\nWrote ${out}`);
console.log(
  `\nNext: review report, then run scripts/apply-harmonization.mjs --report ${out} --dry-run`
);
