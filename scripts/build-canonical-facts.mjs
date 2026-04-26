#!/usr/bin/env node
/**
 * build-canonical-facts.mjs — Generate canonical-facts JSON SSOTs from D1.
 *
 * Usage:
 *   node scripts/build-canonical-facts.mjs --entity napro
 *   node scripts/build-canonical-facts.mjs --entity rrm
 *   node scripts/build-canonical-facts.mjs --entity creighton
 *   node scripts/build-canonical-facts.mjs --entity neofertility
 *   node scripts/build-canonical-facts.mjs --all
 *   node scripts/build-canonical-facts.mjs --all --dry-run
 *
 * Reads:
 *   - D1 `rrm-library.facts` (tradition filter by entity)
 *   - D1 `rrm-library.articles` (for source metadata JOIN)
 *   - Existing JSON at output path (to preserve _manual block)
 *
 * Writes:
 *   - {entity}-canonical-facts.json at the entity's output_path
 *
 * Idempotent: regenerating does NOT overwrite the _manual block.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, renameSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  ENTITIES,
  ENTITY_SLUGS,
  SCHEMA_VERSION,
  emptyDocument,
  normalizeTradition,
} from './lib/canonical-facts-schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const DB_NAME = 'rrm-library';

// ---------- CLI ----------
const argv = process.argv.slice(2);
const flags = {
  entity: null,
  all: argv.includes('--all'),
  dryRun: argv.includes('--dry-run'),
  force: argv.includes('--force'),
};
const entityIdx = argv.indexOf('--entity');
if (entityIdx >= 0 && argv[entityIdx + 1]) flags.entity = argv[entityIdx + 1];

// CLI alias resolution — match scripts/fact-check-canonical.py CANONICAL_PATHS
// which accepts `napro` as an alias for `naprotechnology`.
const ENTITY_ALIASES = { napro: 'naprotechnology' };
if (flags.entity && ENTITY_ALIASES[flags.entity]) {
  flags.entity = ENTITY_ALIASES[flags.entity];
}

if (!flags.all && !flags.entity) {
  console.error('Usage: --entity <slug> | --all  [--dry-run] [--force]');
  console.error(`Valid entities: ${ENTITY_SLUGS.join(', ')}`);
  console.error(`Aliases: ${Object.entries(ENTITY_ALIASES).map(([a, s]) => `${a}→${s}`).join(', ')}`);
  process.exit(1);
}
if (flags.entity && !ENTITIES[flags.entity]) {
  console.error(`Unknown entity: ${flags.entity}`);
  console.error(`Valid: ${ENTITY_SLUGS.join(', ')}`);
  console.error(`Aliases: ${Object.entries(ENTITY_ALIASES).map(([a, s]) => `${a}→${s}`).join(', ')}`);
  process.exit(1);
}

// ---------- D1 query helper ----------
const D1_MAX_BUFFER = 64 * 1024 * 1024;
function d1Query(sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB_NAME, '--remote', '--json', `--command=${sql}`],
    { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: D1_MAX_BUFFER }
  ).toString();
  // Warn early if the output is approaching the 64MB child-stdout cliff. At
  // ~100K facts this will break; shard with --entity <slug> to stay safe.
  if (out.length > D1_MAX_BUFFER * 0.75) {
    const mb = (out.length / (1024 * 1024)).toFixed(1);
    console.warn(
      `  ⚠ D1 output size ${mb} MB is approaching the 64 MB maxBuffer cap. ` +
        `Consider running with --entity <slug> to shard.`
    );
  }
  // wrangler outputs some non-JSON lead bytes occasionally; extract the JSON array.
  // Find the last line that starts with '[' (the JSON array wrangler emits at end).
  // Greedy match-from-anywhere would break if wrangler ever logs a line containing '['
  // before the JSON payload (banners, warnings).
  const lines = out.split('\n');
  let jsonStart = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('[')) { jsonStart = i; break; }
  }
  if (jsonStart === -1) {
    console.error('D1 output could not be parsed as JSON:');
    console.error(out.slice(0, 500));
    throw new Error('d1_query_parse_error');
  }
  const jsonStr = lines.slice(jsonStart).join('\n');
  const parsed = JSON.parse(jsonStr);
  return parsed[0]?.results || [];
}

// ---------- Pull all facts + article metadata once ----------
console.log('Loading facts from D1...');
const allFacts = d1Query(
  'SELECT id, claim, category, domain, tradition, claim_type, body, source_id, verified, verification_notes, created_at, updated_at FROM facts WHERE verified >= 1'
);
console.log(`  ${allFacts.length} verified facts loaded.`);

console.log('Loading article metadata for source resolution...');
const allArticles = d1Query(
  "SELECT id, slug, title, authors, year, journal, pmid, doi, source_url, short_citation, type FROM articles WHERE is_published = 1 OR status = 'classified' OR status = 'published'"
);
console.log(`  ${allArticles.length} articles indexed.`);

// Build dual lookup: by id AND by slug.
const articleById = new Map();
const articleBySlug = new Map();
for (const a of allArticles) {
  articleById.set(a.id, a);
  if (a.slug) articleBySlug.set(a.slug, a);
}

// ---------- Transform a raw D1 fact into a canonical-facts record ----------
function toCanonicalFact(raw) {
  const traditions = normalizeTradition(raw.tradition);
  const sourceId = raw.source_id || null;
  let article = null;
  if (sourceId) {
    article = articleById.get(sourceId) || articleBySlug.get(sourceId) || null;
  }
  const source = article
    ? {
        article_id: article.id,
        slug: article.slug,
        title: article.title,
        short_citation: article.short_citation || null,
        pmid: article.pmid || null,
        doi: article.doi || null,
        source_url: article.source_url || null,
        journal: article.journal || null,
        year: article.year || null,
        authors: article.authors || null,
        type: article.type || null,
      }
    : {
        article_id: null,
        slug: null,
        title: null,
        short_citation: null,
        pmid: null,
        doi: null,
        source_url: null,
        journal: null,
        year: null,
        authors: null,
        type: null,
        raw_source_id: sourceId, // preserve citation-string or slug-only references
      };
  return {
    id: raw.id,
    claim: raw.claim,
    category: raw.category || null,
    domain: raw.domain || null,
    tradition: traditions,
    claim_type: raw.claim_type || null,
    body: raw.body || null,
    source,
    verification_notes: raw.verification_notes || null,
    verified: Number(raw.verified) || 1,
    evidence_tier: inferEvidenceTier(article),
    editorial_caveats: [], // populated by curator via _manual.curator_overrides
    last_verified_at: raw.updated_at || raw.created_at || null,
  };
}

function inferEvidenceTier(article) {
  if (!article) return 'clinical_experience';
  if (article.pmid || article.doi) return 'peer_reviewed';
  if (article.type === 'conference-presentation' || article.type === 'preprint')
    return 'clinic_presentation';
  return 'clinical_experience';
}

// ---------- Merge: apply curator_overrides from existing file onto fresh records ----------
function applyCuratorOverrides(facts, manualBlock) {
  const overrideById = new Map();
  for (const ov of manualBlock?.curator_overrides || []) {
    if (ov?.fact_id) overrideById.set(ov.fact_id, ov);
  }
  const appliedIds = new Set();
  const merged = facts.map((f) => {
    const ov = overrideById.get(f.id);
    if (!ov) return f;
    appliedIds.add(f.id);
    const out = {
      ...f,
      editorial_caveats: ov.editorial_caveats ?? f.editorial_caveats,
      evidence_tier: ov.evidence_tier ?? f.evidence_tier,
    };
    if (ov.last_verified_by != null) {
      out.last_verified_by = ov.last_verified_by;
    }
    return out;
  });
  for (const factId of overrideById.keys()) {
    if (!appliedIds.has(factId)) {
      console.warn(`  ⚠ curator override for ${factId} has no matching fact (stale/deleted?)`);
    }
  }
  return merged;
}

// ---------- Build + write one entity ----------
function buildEntity(entitySlug) {
  const entity = ENTITIES[entitySlug];
  const outPath = resolve(PROJECT_ROOT, entity.output_path);

  // Load existing file to preserve _manual block.
  let existing = null;
  if (existsSync(outPath)) {
    try {
      existing = JSON.parse(readFileSync(outPath, 'utf-8'));
    } catch (err) {
      if (!flags.force) {
        console.error(
          `  ✗ existing ${outPath} not parseable: ${err.message}\n` +
            `    Re-run with --force to overwrite and wipe _manual overrides.`
        );
        process.exit(1);
      }
      // --force set: try to recover _manual block from .bak before falling back to empty.
      const bakPath = `${outPath}.bak`;
      if (existsSync(bakPath)) {
        try {
          const bak = JSON.parse(readFileSync(bakPath, 'utf-8'));
          existing = bak;
          console.warn(`  ⚠ existing ${outPath} not parseable; recovered _manual block from ${bakPath}: ${err.message}`);
        } catch (bakErr) {
          console.warn(`  ⚠ existing ${outPath} not parseable and ${bakPath} also unparseable; starting fresh: ${err.message}; bak: ${bakErr.message}`);
        }
      } else {
        console.warn(`  ⚠ existing ${outPath} not parseable; --force set, starting fresh: ${err.message}`);
      }
    }
  }
  const doc = existing || emptyDocument(entitySlug);

  // Always refresh _meta (except generated_at set below).
  doc._meta = {
    ...emptyDocument(entitySlug)._meta,
    ...doc._meta,
    entity: entity.slug,
    entity_name: entity.name,
    editorial_owner: entity.editorial_owner,
    editorial_owner_refs: entity.editorial_owner_refs || [],
    schema_version: SCHEMA_VERSION,
    ssot: true,
    regenerable: true,
  };

  // Filter + transform.
  const canonicalFacts = allFacts
    .filter((f) => entity.matches(normalizeTradition(f.tradition)))
    .map(toCanonicalFact)
    .sort((a, b) => a.id.localeCompare(b.id));

  doc.facts = applyCuratorOverrides(canonicalFacts, doc._manual);

  // Guard against silent data loss: if a regen drops record_count by >5% vs the
  // prior on-disk value, abort unless --force. Prevents a tradition-tag bug or
  // accidental D1 wipe from quietly shrinking a published SSOT.
  const priorCount = existing?._meta?.record_count;
  if (typeof priorCount === 'number' && priorCount > 0 && doc.facts.length < priorCount * 0.95) {
    const dropPct = ((1 - doc.facts.length / priorCount) * 100).toFixed(1);
    console.warn(`  ⚠ ${entitySlug} record_count dropped ${priorCount} → ${doc.facts.length} (-${dropPct}%, >5% loss). Re-run with --force to override.`);
    if (!flags.force) {
      console.error(`  ✗ Aborting SSOT write to prevent data loss. Add --force to bypass.`);
      process.exit(1);
    }
  }

  doc._meta.record_count = doc.facts.length;
  doc._meta.generated_at = new Date().toISOString();

  // Tradition tally for transparency.
  const traditionTally = {};
  for (const f of doc.facts) {
    for (const t of f.tradition) traditionTally[t] = (traditionTally[t] || 0) + 1;
  }
  doc._meta.tradition_tally = traditionTally;

  // Evidence-tier tally.
  const tierTally = {};
  for (const f of doc.facts) tierTally[f.evidence_tier] = (tierTally[f.evidence_tier] || 0) + 1;
  doc._meta.evidence_tier_tally = tierTally;

  // Source-resolution tally.
  let resolved = 0,
    unresolved = 0;
  for (const f of doc.facts) {
    if (f.source.article_id) resolved++;
    else unresolved++;
  }
  doc._meta.source_resolved_count = resolved;
  doc._meta.source_unresolved_count = unresolved;

  if (flags.dryRun) {
    console.log(`  [dry-run] ${entitySlug}: ${doc.facts.length} facts → ${outPath}`);
    console.log(`             tradition tally: ${JSON.stringify(traditionTally)}`);
    console.log(`             evidence tiers:  ${JSON.stringify(tierTally)}`);
    console.log(`             source resolved: ${resolved} / unresolved: ${unresolved}`);
    return doc;
  }

  // Back up the prior file before overwriting so a bad regen is recoverable.
  if (existsSync(outPath)) {
    try {
      copyFileSync(outPath, `${outPath}.bak`);
    } catch (err) {
      console.warn(`  ⚠ could not write ${outPath}.bak: ${err.message}`);
    }
  }
  const tmpPath = `${outPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
  renameSync(tmpPath, outPath);
  console.log(`  ✓ wrote ${doc.facts.length} facts → ${outPath}`);
  console.log(`    tradition: ${JSON.stringify(traditionTally)}`);
  console.log(`    tiers:     ${JSON.stringify(tierTally)}`);
  console.log(`    sources:   ${resolved} resolved / ${unresolved} unresolved`);
  return doc;
}

// ---------- Main ----------
const targets = flags.all ? ENTITY_SLUGS : [flags.entity];
console.log(`\nBuilding ${targets.length} entity JSON${targets.length > 1 ? 's' : ''}${flags.dryRun ? ' (dry-run)' : ''}:`);
const summary = { success: [], failed: [] };
for (const entity of targets) {
  console.log(`\n→ ${entity}`);
  try {
    buildEntity(entity);
    summary.success.push(entity);
  } catch (err) {
    console.error(`  ✗ ${entity} FAILED: ${err.message}`);
    summary.failed.push({ entity, error: String(err.message || err).slice(0, 300) });
  }
}
console.log(`\n═══ Build Summary ═══`);
console.log(`Succeeded: ${summary.success.length} (${summary.success.join(', ') || 'none'})`);
if (summary.failed.length) {
  console.log(`Failed:    ${summary.failed.length}`);
  summary.failed.forEach((f) => console.log(`  ${f.entity}: ${f.error}`));
}
console.log('\nDone.');
if (summary.failed.length) process.exit(1);
