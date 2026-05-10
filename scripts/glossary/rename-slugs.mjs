#!/usr/bin/env node
// Rename insider-jargon glossary slugs to AEO/SEO-friendly spelled-out forms.
//
// Touches per rename:
//   1. UPDATE glossary_term       SET slug = <new> WHERE id = 'term_<old>'
//   2. UPDATE glossary_abbreviation SET term_slug = <new> WHERE term_slug = <old>
//   3. UPDATE glossary_term.body_html anywhere it cross-references the old slug
//      (`href="#<old>"`, `href="/glossary/<old>/"`, `href="/glossary/<old>"`)
//   4. UPDATE posts.content / faq.answer / course_step.content_md likewise
//   5. Emit router redirect lines to add to rrm-router/src/index.js REDIRECTS
//
// Modes:
//   default       dry run -- prints all planned writes + router lines, no changes
//   --apply       execute D1 updates AND patch rrm-router/src/index.js
//   --d1-only     execute D1 updates but skip router patch (useful for staged rollout)
//   --json        machine-readable plan output (stdout); never writes
//
// Run:
//   node scripts/glossary/rename-slugs.mjs              # dry run
//   node scripts/glossary/rename-slugs.mjs --apply      # execute everything
//
// Re-runnable: idempotent on D1 (UPDATE matches old slug, no-op if already new).
// Router patch checks for existing entries before appending.
//
// Post-execution hand-off:
//   - Trigger fetch-glossary-data + redeploy CF Pages
//   - Submit IndexNow ping for the new URLs
//   - Deploy rrm-router (npx wrangler deploy from rrm-router/)

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const RENAMES = [
  { old: 'oc',                          new: 'oral-contraceptive' },
  { old: 'cert',                        new: 'cooperative-estrogen-replacement' },
  { old: 'cprt',                        new: 'cooperative-progesterone-replacement' },
  { old: 'fcp',                         new: 'fertilitycare-practitioner' },
  // NFPMC = NFP (Natural Family Planning) Medical Consultant -- NOT NaPro Medical Consultant.
  // The current D1 name "NaProTechnology Medical Consultant (NFPMC)" is incorrect (Brian
  // 2026-05-10) and needs a separate content fix via /glossary-update Workflow B:
  //   UPDATE glossary_term SET name = 'NFP Medical Consultant (NFPMC)' WHERE id = 'term_nfpmc'
  //   + body_html find/replace: "NaProTechnology Medical Consultant" -> "NFP Medical Consultant"
  // Distinct credential from CFCMC (Certified FertilityCare Medical Consultant) -- consider
  // adding a separate cfcmc glossary entry in a future pass.
  { old: 'nfpmc',                       new: 'nfp-medical-consultant' },
  { old: 'vdrs',                        new: 'vaginal-discharge-recording-system' },
  { old: 'tcft',                        new: 'transcervical-catheterization' },
  { old: 'lowr',                        new: 'laparoscopic-ovarian-wedge-resection' },
  { old: 'narps',                       new: 'near-adhesion-free-pelvic-surgery' },
  { old: 'pears',                       new: 'pelvic-excision-and-repair-surgery' },
  { old: 'rhri',                        new: 'reproductive-health-research-institute' },
  { old: 'nk-cells',                    new: 'natural-killer-cells' },
  { old: 'restorative-as-a-principle',  new: 'restorative-principle' },
];

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const D1_ONLY = args.includes('--d1-only');
const JSON_OUT = args.includes('--json');

const REPO_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '../..');
const ROUTER_PATH = path.resolve(REPO_ROOT, '../rrm-router/src/index.js');

function getCloudflareToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  try {
    return execSync(`op read "op://Automation/CF - Worker Deploy - account/credential"`, {
      encoding: 'utf8',
    }).trim();
  } catch (e) {
    console.error('Failed to read CLOUDFLARE_API_TOKEN from env or 1Password.', e?.message ?? e);
    console.error('Run `op signin` if 1P CLI is locked, OR export CLOUDFLARE_API_TOKEN directly.');
    process.exit(2);
  }
}
const TOKEN = getCloudflareToken();
const ENV = { ...process.env, CLOUDFLARE_API_TOKEN: TOKEN };

function d1Query(database, sql) {
  const cmd = `npx wrangler d1 execute ${database} --remote --command ${JSON.stringify(sql)} --json`;
  const out = execSync(cmd, { encoding: 'utf8', env: ENV, maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out)[0]?.results || [];
}

// --- Phase 1: Identify cross-references in D1 -------------------------------

function findCrossRefs() {
  // For each rename, search glossary_term.body_html for old-slug references.
  // We look for: #<old>" / #<old>' / /glossary/<old>/ / /glossary/<old>"
  const found = {};
  for (const r of RENAMES) {
    found[r.old] = { glossary_term: [], posts: [], faqs: [], course_steps: [] };

    // glossary_term.body_html (single-line SQL -- wrangler --command rejects newlines)
    const gtSql = `SELECT id, slug FROM glossary_term WHERE body_html LIKE '%#${r.old}"%' OR body_html LIKE '%/glossary/${r.old}/%' OR body_html LIKE '%/glossary/${r.old}"%'`;
    found[r.old].glossary_term = d1Query('rrm-auth', gtSql);

    // posts.content
    try {
      const ps = d1Query('rrm-auth', `SELECT id, slug FROM posts WHERE content LIKE '%/glossary/${r.old}/%' OR content LIKE '%/glossary/${r.old}"%'`);
      found[r.old].posts = ps;
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (msg.includes('no such table')) {
        // Table genuinely missing in this D1 -- safe to skip
      } else {
        console.warn(`  WARN: posts cross-ref scan for ${r.old} failed: ${e?.message?.slice(0, 200)}`);
        console.warn(`        Cross-refs in posts may be missed. Re-run after diagnosing.`);
      }
    }

    // faq.answer
    try {
      const fq = d1Query('rrm-auth', `SELECT id, slug FROM faq WHERE answer LIKE '%/glossary/${r.old}/%' OR answer LIKE '%/glossary/${r.old}"%'`);
      found[r.old].faqs = fq;
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (msg.includes('no such table')) {
        // Table genuinely missing in this D1 -- safe to skip
      } else {
        console.warn(`  WARN: faq cross-ref scan for ${r.old} failed: ${e?.message?.slice(0, 200)}`);
        console.warn(`        Cross-refs in faqs may be missed. Re-run after diagnosing.`);
      }
    }

    // course_step.content_md
    try {
      const cs = d1Query('rrm-auth', `SELECT id FROM course_step WHERE content_md LIKE '%/glossary/${r.old}/%' OR content_md LIKE '%/glossary/${r.old}"%'`);
      found[r.old].course_steps = cs;
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (msg.includes('no such table')) {
        // Table genuinely missing in this D1 -- safe to skip
      } else {
        console.warn(`  WARN: course_step cross-ref scan for ${r.old} failed: ${e?.message?.slice(0, 200)}`);
        console.warn(`        Cross-refs in course_steps may be missed. Re-run after diagnosing.`);
      }
    }
  }
  return found;
}

// --- Phase 2: Generate SQL ---------------------------------------------------

function buildPlan(crossRefs) {
  const plan = {
    d1_updates: [],
    router_redirects: [],
    cross_ref_summary: {},
  };

  for (const r of RENAMES) {
    // 1. glossary_term slug
    plan.d1_updates.push({
      db: 'rrm-auth',
      label: `glossary_term.slug: ${r.old} -> ${r.new}`,
      sql: `UPDATE glossary_term SET slug = '${r.new}', updated_at = datetime('now') WHERE id = 'term_${r.old}' AND slug = '${r.old}'`,
    });

    // 2. abbreviations
    plan.d1_updates.push({
      db: 'rrm-auth',
      label: `glossary_abbreviation.term_slug references`,
      sql: `UPDATE glossary_abbreviation SET term_slug = '${r.new}', updated_at = datetime('now') WHERE term_slug = '${r.old}'`,
    });

    // 3. body_html cross-refs in OTHER glossary terms
    const refs = crossRefs[r.old].glossary_term;
    for (const t of refs) {
      if (t.id === `term_${r.old}`) continue;
      plan.d1_updates.push({
        db: 'rrm-auth',
        label: `glossary_term[${t.slug}].body_html: rewrite #${r.old} / /glossary/${r.old}/ -> ${r.new}`,
        sql: `UPDATE glossary_term SET body_html = REPLACE(REPLACE(REPLACE(REPLACE(body_html, '#${r.old}"', '#${r.new}"'), '#${r.old}''', '#${r.new}'''), '/glossary/${r.old}/', '/glossary/${r.new}/'), '/glossary/${r.old}"', '/glossary/${r.new}"'), updated_at = datetime('now') WHERE id = '${t.id}'`,
      });
    }

    // 4. posts cross-refs
    for (const p of crossRefs[r.old].posts) {
      plan.d1_updates.push({
        db: 'rrm-auth',
        label: `posts[${p.slug}].content: replace /glossary/${r.old}/ -> ${r.new}`,
        sql: `UPDATE posts SET content = REPLACE(REPLACE(content, '/glossary/${r.old}/', '/glossary/${r.new}/'), '/glossary/${r.old}"', '/glossary/${r.new}"'), updated_at = datetime('now') WHERE id = '${p.id}'`,
      });
    }

    // 5. faq cross-refs
    for (const f of crossRefs[r.old].faqs) {
      plan.d1_updates.push({
        db: 'rrm-auth',
        label: `faq[${f.slug}].answer: replace /glossary/${r.old}/ -> ${r.new}`,
        sql: `UPDATE faq SET answer = REPLACE(REPLACE(answer, '/glossary/${r.old}/', '/glossary/${r.new}/'), '/glossary/${r.old}"', '/glossary/${r.new}"'), updated_at = datetime('now') WHERE id = '${f.id}'`,
      });
    }

    // 6. course_step cross-refs
    for (const cs of crossRefs[r.old].course_steps) {
      plan.d1_updates.push({
        db: 'rrm-auth',
        label: `course_step[${cs.id}].content_md: replace /glossary/${r.old}/ -> ${r.new}`,
        sql: `UPDATE course_step SET content_md = REPLACE(REPLACE(content_md, '/glossary/${r.old}/', '/glossary/${r.new}/'), '/glossary/${r.old}"', '/glossary/${r.new}"'), updated_at = datetime('now') WHERE id = '${cs.id}'`,
      });
    }

    // 7. router redirect
    plan.router_redirects.push({
      from: `/glossary/${r.old}`,
      to: `/glossary/${r.new}`,
    });
    plan.router_redirects.push({
      from: `/glossary/${r.old}/`,
      to: `/glossary/${r.new}/`,
    });

    plan.cross_ref_summary[r.old] = {
      glossary_term: crossRefs[r.old].glossary_term.length,
      posts: crossRefs[r.old].posts.length,
      faqs: crossRefs[r.old].faqs.length,
      course_steps: crossRefs[r.old].course_steps.length,
    };
  }

  return plan;
}

// --- Phase 3: Apply ---------------------------------------------------------

function applyPlan(plan) {
  console.log(`\nProbing D1 reachability before mutations...`);
  try {
    d1Query('rrm-auth', 'SELECT COUNT(*) AS n FROM glossary_term LIMIT 1');
    console.log('  D1 probe OK.');
  } catch (e) {
    console.error('  D1 probe FAILED -- refusing to apply mutations.');
    console.error(`    ${e?.message?.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`\nApplying ${plan.d1_updates.length} D1 updates...`);
  let applied = 0;
  for (const u of plan.d1_updates) {
    try {
      if (u.params) {
        // Need parameterized exec; wrangler CLI doesn't support params for execute --command,
        // so write SQL literal with single-quote escape.
        const escaped = u.params[0].replace(/'/g, "''");
        const sql = u.sql.replace('?', `'${escaped}'`);
        execSync(`npx wrangler d1 execute ${u.db} --remote --command ${JSON.stringify(sql)}`, {
          stdio: 'pipe',
          env: ENV,
          maxBuffer: 64 * 1024 * 1024,
        });
      } else {
        execSync(`npx wrangler d1 execute ${u.db} --remote --command ${JSON.stringify(u.sql)}`, {
          stdio: 'pipe',
          env: ENV,
          maxBuffer: 64 * 1024 * 1024,
        });
      }
      applied++;
      console.log(`  [${applied}/${plan.d1_updates.length}] ${u.label}`);
    } catch (e) {
      console.error(`  FAILED: ${u.label}`);
      console.error(`    ${e?.message?.slice(0, 200)}`);
      throw e;
    }
  }
  console.log(`\nD1 updates: ${applied} applied successfully.`);
}

function printPlannedRedirects(plan) {
  console.log('\nPlanned router redirect lines (paste into rrm-router/src/index.js REDIRECTS):');
  for (const r of plan.router_redirects) {
    console.log(`  '${r.from}': '${r.to}',`);
  }
}

function patchRouter(plan) {
  if (D1_ONLY) {
    console.log('\n--d1-only: skipping router patch.');
    return;
  }
  if (!existsSync(ROUTER_PATH)) {
    console.warn(`\nWARN: rrm-router/src/index.js not found at ${ROUTER_PATH}; emit redirect lines below to add manually.`);
    printPlannedRedirects(plan);
    if (APPLY) {
      console.error('\nFATAL: router file missing in --apply mode; refusing to apply D1 changes without router redirects.');
      process.exit(1);
    }
    return;
  }
  const src = readFileSync(ROUTER_PATH, 'utf8');
  const insertMarker = '// Phantom rec IDs';
  if (!src.includes(insertMarker)) {
    console.warn(`\nWARN: insertion marker not found in router; emit redirect lines below.`);
    printPlannedRedirects(plan);
    if (APPLY) {
      console.error('\nFATAL: router file insertion marker not found; refusing to apply D1 changes without router redirects.');
      process.exit(1);
    }
    return;
  }

  const newLines = [];
  newLines.push('  // Glossary slug renames (AEO/SEO/GEO -- spelled-out forms canonical 2026-05-10)');
  for (const r of plan.router_redirects) {
    if (src.includes(`'${r.from}':`) || src.includes(`"${r.from}":`)) continue;
    newLines.push(`  '${r.from}': '${r.to}',`);
  }
  if (newLines.length === 1) {
    console.log('\nRouter already has all redirect entries; nothing to patch.');
    printPlannedRedirects(plan);
    return;
  }
  const block = newLines.join('\n') + '\n  ';
  const patched = src.replace(insertMarker, block + insertMarker);
  writeFileSync(ROUTER_PATH, patched, 'utf8');
  console.log(`\nrrm-router/src/index.js patched: +${newLines.length - 1} redirect lines.`);
  console.log('  -> remember to: cd ../rrm-router && npx wrangler deploy');
}

// --- Main -------------------------------------------------------------------

async function main() {
  console.log(`Glossary slug rename pipeline (${APPLY ? 'APPLY' : 'DRY RUN'})`);
  console.log(`  ${RENAMES.length} renames planned\n`);

  console.log('Scanning D1 for cross-references...');
  const crossRefs = findCrossRefs();

  // Pre-flight: ensure no destination slug already exists (excluding the source term itself)
  const newSlugs = RENAMES.map(r => `'${r.new.replace(/'/g, "''")}'`).join(',');
  const oldIds = RENAMES.map(r => `'term_${r.old.replace(/'/g, "''")}'`).join(',');
  const collisions = d1Query(
    'rrm-auth',
    `SELECT id, slug FROM glossary_term WHERE slug IN (${newSlugs}) AND id NOT IN (${oldIds})`
  );
  if (collisions.length > 0) {
    console.error('Pre-flight FAIL: destination slug(s) already exist:');
    for (const c of collisions) console.error(`  - ${c.slug} (id=${c.id})`);
    console.error('Aborting before any writes. Resolve the collision(s) and re-run.');
    process.exit(1);
  }

  const plan = buildPlan(crossRefs);

  if (JSON_OUT) {
    console.log(JSON.stringify({ renames: RENAMES, plan }, null, 2));
    return;
  }

  console.log('\nCross-reference inventory:');
  for (const [oldSlug, counts] of Object.entries(plan.cross_ref_summary)) {
    const total = counts.glossary_term + counts.posts + counts.faqs + counts.course_steps;
    if (total > 0) {
      console.log(`  ${oldSlug}: glossary=${counts.glossary_term}  posts=${counts.posts}  faqs=${counts.faqs}  course_steps=${counts.course_steps}`);
    } else {
      console.log(`  ${oldSlug}: (no cross-refs)`);
    }
  }

  console.log(`\nPlanned D1 updates: ${plan.d1_updates.length}`);
  for (const u of plan.d1_updates.slice(0, 50)) {
    console.log(`  - ${u.label}`);
  }
  if (plan.d1_updates.length > 50) {
    console.log(`  ... (+${plan.d1_updates.length - 50} more)`);
  }

  console.log(`\nPlanned router redirects (${plan.router_redirects.length}):`);
  for (const r of plan.router_redirects) {
    console.log(`  '${r.from}': '${r.to}',`);
  }

  if (!APPLY) {
    console.log('\nDRY RUN -- no changes made. Re-run with --apply to execute.');
    return;
  }

  patchRouter(plan);
  applyPlan(plan);

  if (!D1_ONLY) {
    rewriteSeederSlugs();
    regenerateGlossarySeed();
  } else {
    console.log('\n--d1-only: skipping seeder/seed regeneration.');
  }

  console.log('\n========================================================================');
  console.log('DONE. CRITICAL POST-DEPLOY STEPS -- DO NOT SKIP:');
  console.log('========================================================================');
  console.log('1. Deploy router:');
  console.log('     cd ../rrm-router && npx wrangler deploy');
  console.log('');
  console.log('2. CACHE-MISS REBUILD REQUIRED. The deploy.yml fetch-all cache key is');
  console.log('   per-day (site-data-YYYY-MM-DD ET). Any same-day prior deploy will');
  console.log('   replay STALE src/data/glossary.json (containing the OLD slugs) and');
  console.log('   silently keep the renamed terms 404ing on production static routes.');
  console.log('');
  console.log('   Force a cache miss + verify in CI logs:');
  console.log('     cd ../rrm-academy-cf');
  console.log('     gh workflow run deploy.yml -F skip_fetch=false');
  console.log('     # Then in the run logs, CONFIRM you see "Fetching fresh data" --');
  console.log('     # NOT "cache hit" -- before considering the rename complete.');
  console.log('');
  console.log('3. After redeploy completes, ping IndexNow for the new URLs.');
  console.log('========================================================================');
}

// --- Phase 4: Rewrite downstream seed sources ------------------------------

function rewriteSeederSlugs() {
  const seederPath = path.resolve(REPO_ROOT, 'scripts/seed-glossary-abbreviations.mjs');
  if (!existsSync(seederPath)) {
    console.warn(`\nWARN: ${seederPath} not found; skipping seeder slug rewrite.`);
    return;
  }
  const src = readFileSync(seederPath, 'utf8');
  const startMarker = 'const ABBREVIATIONS = [';
  const startIdx = src.indexOf(startMarker);
  if (startIdx < 0) {
    console.warn(`\nWARN: ABBREVIATIONS array not found in ${seederPath}; skipping rewrite.`);
    return;
  }
  // Find matching `];` after startIdx
  const endIdx = src.indexOf('\n];', startIdx);
  if (endIdx < 0) {
    console.warn(`\nWARN: ABBREVIATIONS array end not found in ${seederPath}; skipping rewrite.`);
    return;
  }
  const before = src.slice(0, startIdx);
  let arrSlice = src.slice(startIdx, endIdx + 3); // include `\n];`
  const after = src.slice(endIdx + 3);

  let mutations = 0;
  for (const r of RENAMES) {
    const needle = `'${r.old}']`;
    const replacement = `'${r.new}']`;
    if (arrSlice.includes(needle)) {
      arrSlice = arrSlice.split(needle).join(replacement);
      mutations++;
    }
  }
  if (mutations === 0) {
    console.log(`\nseed-glossary-abbreviations.mjs: no slug references to rewrite.`);
    return;
  }
  writeFileSync(seederPath, before + arrSlice + after, 'utf8');
  console.log(`\nseed-glossary-abbreviations.mjs: rewrote ${mutations} slug reference(s).`);
  try {
    execSync(`node ${JSON.stringify(seederPath)}`, { stdio: 'inherit', env: ENV });
  } catch (e) {
    console.error(`\nWARN: seeder regen failed: ${e?.message?.slice(0, 200)}`);
    console.error('  Run manually: node scripts/seed-glossary-abbreviations.mjs');
  }
}

function regenerateGlossarySeed() {
  const regenPath = path.resolve(REPO_ROOT, 'scripts/regenerate-glossary-seed.mjs');
  if (!existsSync(regenPath)) {
    console.warn(`\nWARN: ${regenPath} not found; skipping migrate-glossary-data.sql regen.`);
    console.warn('  Run manually after pulling the script.');
    return;
  }
  try {
    execSync(`node ${JSON.stringify(regenPath)}`, { stdio: 'inherit', env: ENV });
  } catch (e) {
    console.error(`\nWARN: regenerate-glossary-seed.mjs failed: ${e?.message?.slice(0, 200)}`);
    console.error('  Run manually: node scripts/regenerate-glossary-seed.mjs');
  }
}

main().catch((e) => {
  console.error('Pipeline failed:', e?.message ?? e);
  process.exit(1);
});
