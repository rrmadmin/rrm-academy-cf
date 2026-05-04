#!/usr/bin/env node
/**
 * validate-glossary-pipeline.mjs - Deterministic proof-gate runner for the
 * glossary spoke pages pipeline.
 *
 * Prevents the bug classes Brian had to flag manually after the v1 launch
 * (2026-05-03):
 *   - Pillar inadvertently rendering draft/classified terms (status filter drift).
 *   - Spoke route emitting both an explicit <h1> and the GlossaryTerm component
 *     producing a second heading (duplicate-heading regression).
 *   - Anyone routing around <GlossaryTerm /> with `set:html={...bodyHtml}`,
 *     reintroducing the pillar-vs-spoke drift the component was built to prevent.
 *   - rewriteAnchors() losing the special-case list for ref-N / abbreviations /
 *     references anchors (would 404 every body containing those links on spokes).
 *   - Spoke schema @id constants drifting away from the slug-parameterized shape
 *     the pillar's DefinedTermSet repoints at.
 *
 * Usage:
 *   node scripts/gates/validate-glossary-pipeline.mjs            # all 5 gates
 *   node scripts/gates/validate-glossary-pipeline.mjs --quick    # static-only (no network)
 *   node scripts/gates/validate-glossary-pipeline.mjs --gate G1  # specific gate
 *   node scripts/gates/validate-glossary-pipeline.mjs --json     # machine-readable
 *
 * All five gates are static source-level checks. There is no network or D1 query
 * in this gate set, so --quick is currently a no-op (kept for symmetry with
 * validate-fact-pipeline.mjs and forward compatibility if a future gate adds one).
 *
 * Exit codes:
 *   0  all gates pass
 *   1  at least one gate failed
 *   2  gate runner itself errored (config / file missing)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ANSI colors (match validate-fact-pipeline.mjs)
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';
const DIM    = '\x1b[2m';

// ---------- CLI -----------------------------------------------------------
const argv = process.argv.slice(2);
const QUICK_MODE = argv.includes('--quick');
const JSON_MODE  = argv.includes('--json');
const gateIdx    = argv.indexOf('--gate');
const ONLY_GATE  = gateIdx >= 0 ? argv[gateIdx + 1] : null;

// ---------- Paths ---------------------------------------------------------
const COMPONENT_PATH = join(PROJECT_ROOT, 'src/components/GlossaryTerm.astro');
const PILLAR_PATH    = join(PROJECT_ROOT, 'src/pages/glossary/index.astro');
const SPOKE_PATH     = join(PROJECT_ROOT, 'src/pages/glossary/[slug].astro');
const SRC_DIR        = join(PROJECT_ROOT, 'src');
const PAGES_DIR      = join(PROJECT_ROOT, 'src/pages');

// ---------- Helpers -------------------------------------------------------
function pass(msg) { return { ok: true,  msg }; }
function fail(msg) { return { ok: false, msg }; }
function warn(msg) { return { ok: null,  msg }; }

function readFile(path) {
  if (!existsSync(path)) {
    throw new Error(`required file not found: ${path}`);
  }
  return readFileSync(path, 'utf-8');
}

// Recursively walk a directory yielding .astro file paths.
function walkAstroFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkAstroFiles(full));
    } else if (name.endsWith('.astro')) {
      out.push(full);
    }
  }
  return out;
}

// ---------- Gate G1: Status filter agreement ------------------------------
// Both pillar and spoke routes must collect terms via a published-status filter.
// A pillar that emits draft terms while the spoke route refuses to build them
// produces a DefinedTermSet with @ids that 404. Conversely a spoke route that
// builds drafts surfaces unpublished content as canonical entity URLs.
function gateG1() {
  const results = [];
  const filterRe = /\.filter\(\s*\([^)]*\)\s*=>\s*\w+\.status\s*===\s*['"]published['"]/;

  for (const [label, path] of [['pillar', PILLAR_PATH], ['spoke', SPOKE_PATH]]) {
    let src;
    try {
      src = readFile(path);
    } catch (err) {
      results.push(fail(`${label}: ${err.message}`));
      continue;
    }
    if (filterRe.test(src)) {
      results.push(pass(`${label} (${path.replace(PROJECT_ROOT + '/', '')}): published-status filter present`));
    } else {
      results.push(fail(`${label} (${path.replace(PROJECT_ROOT + '/', '')}): status='published' filter not found at term collection`));
    }
  }

  return results;
}

// ---------- Gate G2: Shared render path enforcement -----------------------
// The single source of body_html rendering must be GlossaryTerm.astro. Any
// other file emitting `set:html={...something.bodyHtml}` reintroduces the
// pillar-vs-spoke drift class the component was built to prevent.
function gateG2() {
  const results = [];

  // The component itself: assert it has the canonical render line.
  let componentSrc;
  try {
    componentSrc = readFile(COMPONENT_PATH);
  } catch (err) {
    return [fail(err.message)];
  }
  if (!/set:html\s*=\s*\{\s*renderedBody\s*\}/.test(componentSrc)) {
    results.push(fail(`GlossaryTerm.astro: missing canonical 'set:html={renderedBody}' render line`));
  } else {
    results.push(pass(`GlossaryTerm.astro: canonical render path present (set:html={renderedBody})`));
  }

  // Any other .astro file with set:html against a body field is forbidden.
  // Allowed shapes detected here use these variable names: bodyHtml, body_html,
  // term.bodyHtml, t.bodyHtml. Pattern is intentionally broad to catch lazy aliases.
  const forbiddenShapes = [
    /set:html\s*=\s*\{\s*[a-zA-Z_$][\w.$]*\.bodyHtml\s*\}/,
    /set:html\s*=\s*\{\s*[a-zA-Z_$][\w.$]*\.body_html\s*\}/,
    /set:html\s*=\s*\{\s*bodyHtml\s*\}/,
    /set:html\s*=\s*\{\s*body_html\s*\}/,
  ];

  const offenders = [];
  for (const file of walkAstroFiles(SRC_DIR)) {
    if (file === COMPONENT_PATH) continue;
    const src = readFileSync(file, 'utf-8');
    for (const re of forbiddenShapes) {
      if (re.test(src)) {
        // Skip if the file is one of the legitimate consumers AND only references the prop
        // through the component (i.e. the line lives inside a comment or is the
        // component-prop call shape `<GlossaryTerm term=...>` which never carries set:html).
        // A direct match against the regex above means raw set:html on a body field, which
        // is what we reject regardless of which file uses it.
        offenders.push(`${file.replace(PROJECT_ROOT + '/', '')}: ${re.source}`);
        break;
      }
    }
  }

  if (offenders.length > 0) {
    for (const o of offenders) {
      results.push(fail(`forbidden body_html render path: ${o} (route through <GlossaryTerm /> instead)`));
    }
  } else {
    results.push(pass(`no other .astro file renders glossary body_html via set:html (only GlossaryTerm.astro)`));
  }

  return results;
}

// ---------- Gate G3: Rewriter anchor coverage -----------------------------
// The cross-ref rewriter inside GlossaryTerm.astro special-cases three anchor
// shapes (ref-N, abbreviations, references) so that body content like
// <sup><a href="#ref-12">12</a></sup> stays pointed at the pillar's references
// list (jump back) rather than getting rewritten to /glossary/ref-12/ (404).
// If any of those three special cases drops out of the rewriter, every spoke
// rendering content with the missing anchor type ships broken links.
function gateG3() {
  const results = [];

  let src;
  try {
    src = readFile(COMPONENT_PATH);
  } catch (err) {
    return [fail(err.message)];
  }

  // Locate the rewriteAnchors function body.
  const bodyMatch = src.match(/function\s+rewriteAnchors\s*\([^)]*\)\s*(?::\s*string\s*)?\{([\s\S]*?)\n\s*\}/);
  if (!bodyMatch) {
    return [fail(`GlossaryTerm.astro: rewriteAnchors() function not found - rewriter contract is unenforceable`)];
  }
  const body = bodyMatch[1];

  // Each of these three patterns must appear inside the function body's
  // pre-fallback conditional (the special-case branch returning /glossary/#...).
  // Validate by raw substring presence (string-literal forms only).
  const requirements = [
    { name: 'ref- prefix anchor', re: /['"]ref-['"]/, hint: `target.startsWith('ref-')` },
    { name: 'exact "abbreviations" anchor', re: /['"]abbreviations['"]/, hint: `target === 'abbreviations'` },
    { name: 'exact "references" anchor', re: /['"]references['"]/, hint: `target === 'references'` },
  ];

  const missing = [];
  for (const req of requirements) {
    if (!req.re.test(body)) {
      missing.push(req);
    }
  }

  if (missing.length > 0) {
    for (const m of missing) {
      results.push(fail(`rewriteAnchors() missing special case for ${m.name} (expected something like: ${m.hint})`));
    }
  } else {
    results.push(pass(`rewriteAnchors() covers all three required anchor types (ref-, abbreviations, references)`));
  }

  return results;
}

// ---------- Gate G4: Heading level contract -------------------------------
// The component's headingLevel prop is a literal union. Every consumer must
// pass a value inside that union, AND the pillar/spoke routes must use the
// agreed levels: pillar='h3' (under per-Part <h2>), spoke='h1' (the page heading).
function gateG4() {
  const results = [];

  let componentSrc;
  try {
    componentSrc = readFile(COMPONENT_PATH);
  } catch (err) {
    return [fail(err.message)];
  }

  // Parse the headingLevel union from the Props interface.
  const propsMatch = componentSrc.match(/interface\s+Props\s*\{[\s\S]*?headingLevel\s*:\s*([^;\n]+);/);
  if (!propsMatch) {
    return [fail(`GlossaryTerm.astro: headingLevel prop type not found in Props interface`)];
  }
  const unionStr = propsMatch[1].trim();
  const allowed = new Set(
    [...unionStr.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
  );
  const requiredLevels = ['h1', 'h2', 'h3'];
  const missingLevels = requiredLevels.filter((l) => !allowed.has(l));
  if (missingLevels.length > 0) {
    results.push(fail(`GlossaryTerm.astro: headingLevel union missing [${missingLevels.join(', ')}] - declared union: ${unionStr}`));
  } else {
    results.push(pass(`GlossaryTerm.astro: headingLevel union accepts h1, h2, h3 (${unionStr})`));
  }

  // Walk pages, find every <GlossaryTerm ... headingLevel="..." />.
  // Verify each value is in the allowed union.
  const usageRe = /<GlossaryTerm\b[^>]*?\bheadingLevel\s*=\s*["']([^"']+)["']/g;
  const consumers = [];
  for (const file of walkAstroFiles(PAGES_DIR)) {
    const src = readFileSync(file, 'utf-8');
    for (const m of src.matchAll(usageRe)) {
      consumers.push({ file: file.replace(PROJECT_ROOT + '/', ''), value: m[1] });
    }
  }

  if (consumers.length === 0) {
    results.push(warn(`no <GlossaryTerm headingLevel="..."> usages found under src/pages/ - if this is a deliberate refactor, update G4`));
  }

  for (const c of consumers) {
    if (!allowed.has(c.value)) {
      results.push(fail(`${c.file}: <GlossaryTerm headingLevel="${c.value}"> is not in the allowed union [${[...allowed].join(', ')}]`));
    }
  }

  // Specific contract: pillar must use h3, spoke must use h1.
  const pillarConsumer = consumers.find((c) => c.file.endsWith('src/pages/glossary/index.astro'));
  const spokeConsumer  = consumers.find((c) => c.file.endsWith('src/pages/glossary/[slug].astro'));
  if (!pillarConsumer) {
    results.push(fail(`pillar (src/pages/glossary/index.astro): no <GlossaryTerm headingLevel="..."> usage found - pillar must render terms via the component`));
  } else if (pillarConsumer.value !== 'h3') {
    results.push(fail(`pillar uses headingLevel="${pillarConsumer.value}" but contract requires "h3" (under per-Part <h2> sections)`));
  } else {
    results.push(pass(`pillar uses headingLevel="h3" as required`));
  }

  if (!spokeConsumer) {
    results.push(fail(`spoke (src/pages/glossary/[slug].astro): no <GlossaryTerm headingLevel="..."> usage found - spoke must render the term body via the component`));
  } else if (spokeConsumer.value !== 'h1') {
    results.push(fail(`spoke uses headingLevel="${spokeConsumer.value}" but contract requires "h1" (the spoke page heading)`));
  } else {
    results.push(pass(`spoke uses headingLevel="h1" as required (the page heading)`));
  }

  return results;
}

// ---------- Gate G5: Schema @id consistency (static source check) --------
// The spoke route declares three @id constants that wire the JSON-LD blocks
// together. They must be slug-parameterized AND cross-referenced consistently
// (DefinedTerm.subjectOf -> WEBPAGE_ID, MedicalWebPage.mainEntity -> TERM_ID).
// The DefinedTermSet ID constant must match what the pillar emits, otherwise
// the spoke's inDefinedTermSet pointer dangles.
function gateG5() {
  const results = [];

  let src;
  try {
    src = readFile(SPOKE_PATH);
  } catch (err) {
    return [fail(err.message)];
  }

  // Required slug-parameterized constants.
  const constants = [
    { name: 'TERM_ID',     re: /const\s+TERM_ID\s*=\s*`([^`]+)`/ },
    { name: 'WEBPAGE_ID',  re: /const\s+WEBPAGE_ID\s*=\s*`([^`]+)`/ },
    { name: 'SPOKE_URL',   re: /const\s+SPOKE_URL\s*=\s*`([^`]+)`/ },
  ];

  const found = {};
  for (const c of constants) {
    const m = src.match(c.re);
    if (!m) {
      results.push(fail(`spoke: const ${c.name} not found - schema cross-refs cannot be validated`));
    } else {
      found[c.name] = m[1];
      if (!/\$\{term\.slug\}/.test(m[1])) {
        results.push(fail(`spoke: ${c.name} = \`${m[1]}\` is not parameterized on \${term.slug} - schema would emit identical @ids across all spokes`));
      } else {
        results.push(pass(`spoke: ${c.name} parameterized on \${term.slug}`));
      }
    }
  }

  // DefinedTerm.subjectOf must reference WEBPAGE_ID.
  if (!/subjectOf\s*:\s*\{\s*['"]@id['"]\s*:\s*WEBPAGE_ID\s*\}/.test(src)) {
    results.push(fail(`spoke: DefinedTerm.subjectOf must be { '@id': WEBPAGE_ID }`));
  } else {
    results.push(pass(`spoke: DefinedTerm.subjectOf references WEBPAGE_ID`));
  }

  // MedicalWebPage.mainEntity must reference TERM_ID.
  if (!/mainEntity\s*:\s*\{\s*['"]@id['"]\s*:\s*TERM_ID\s*\}/.test(src)) {
    results.push(fail(`spoke: MedicalWebPage.mainEntity must be { '@id': TERM_ID }`));
  } else {
    results.push(pass(`spoke: MedicalWebPage.mainEntity references TERM_ID`));
  }

  // DefinedTermSet ID constant on spoke must match what pillar emits.
  // Both files declare TERM_SET_ID; values must equal the canonical pillar URL.
  const expectedTermSetId = 'https://rrmacademy.org/glossary/#defined-term-set';
  const spokeTermSetMatch = src.match(/const\s+TERM_SET_ID\s*=\s*['"]([^'"]+)['"]/);
  if (!spokeTermSetMatch) {
    results.push(fail(`spoke: const TERM_SET_ID not found - pillar/spoke DefinedTermSet linkage cannot be validated`));
  } else if (spokeTermSetMatch[1] !== expectedTermSetId) {
    results.push(fail(`spoke: TERM_SET_ID = '${spokeTermSetMatch[1]}', expected '${expectedTermSetId}'`));
  } else {
    results.push(pass(`spoke: TERM_SET_ID matches pillar canonical (${expectedTermSetId})`));
  }

  // Cross-check the pillar emits the same TERM_SET_ID constant value.
  let pillarSrc;
  try {
    pillarSrc = readFile(PILLAR_PATH);
  } catch (err) {
    results.push(fail(`pillar: ${err.message}`));
    return results;
  }
  const pillarTermSetMatch = pillarSrc.match(/const\s+TERM_SET_ID\s*=\s*['"]([^'"]+)['"]/);
  if (!pillarTermSetMatch) {
    results.push(fail(`pillar: const TERM_SET_ID not found - cannot verify spoke/pillar @id agreement`));
  } else if (pillarTermSetMatch[1] !== expectedTermSetId) {
    results.push(fail(`pillar: TERM_SET_ID = '${pillarTermSetMatch[1]}', expected '${expectedTermSetId}' (must match spoke)`));
  } else {
    results.push(pass(`pillar: TERM_SET_ID matches the canonical value`));
  }

  return results;
}

// ---------- Main ----------------------------------------------------------

if (!JSON_MODE) {
  console.log(`${BOLD}RRM Academy - Glossary Spoke Pipeline Gates${RESET}`);
  if (QUICK_MODE) console.log(`${YELLOW}Mode: --quick (no network gates currently exist; flag is a no-op)${RESET}`);
  if (ONLY_GATE)  console.log(`${YELLOW}Mode: --gate ${ONLY_GATE} only${RESET}`);
}

const gateSpecs = [
  { id: 'G1', name: 'Status Filter Agreement',          fn: gateG1 },
  { id: 'G2', name: 'Shared Render Path Enforcement',   fn: gateG2 },
  { id: 'G3', name: 'Rewriter Anchor Coverage',         fn: gateG3 },
  { id: 'G4', name: 'Heading Level Contract',           fn: gateG4 },
  { id: 'G5', name: 'Schema @id Consistency',           fn: gateG5 },
];

let totalFailures = 0;
const finalResults = [];

for (const { id, name, fn } of gateSpecs) {
  if (ONLY_GATE && ONLY_GATE !== id) continue;

  if (!JSON_MODE) console.log(`\n${BOLD}Gate ${id}: ${name}${RESET}`);

  let items;
  try {
    items = fn();
    if (!Array.isArray(items)) items = [items];
  } catch (err) {
    items = [{ ok: false, msg: `Gate runner error: ${err.message}` }];
  }

  const gatePassed = items.every((r) => r.ok !== false);
  if (!gatePassed) totalFailures++;

  if (!JSON_MODE) {
    for (const r of items) {
      const icon = r.ok === true  ? `${GREEN}✓${RESET}` :
                   r.ok === false ? `${RED}✗${RESET}` :
                                    `${YELLOW}~${RESET}`;
      const lines = r.msg.split('\n');
      console.log(`  ${icon} ${lines[0]}`);
      for (const l of lines.slice(1)) console.log(`    ${l}`);
    }
  }

  finalResults.push({ id, name, pass: gatePassed, items });
}

const totalRun    = finalResults.length;
const passedGates = finalResults.filter((g) => g.pass).length;

if (JSON_MODE) {
  console.log(JSON.stringify({
    summary: { total: totalRun, passed: passedGates, failed: totalFailures },
    gates: finalResults.map((g) => ({
      id:     g.id,
      name:   g.name,
      pass:   g.pass,
      checks: g.items.map((i) => ({ ok: i.ok, msg: i.msg })),
    })),
  }, null, 2));
} else {
  console.log('');
  if (totalFailures === 0) {
    console.log(`${GREEN}${BOLD}ALL GATES PASS (${passedGates}/${totalRun})${RESET}`);
  } else {
    console.log(`${RED}${BOLD}${totalFailures} GATE(S) FAILED (${passedGates}/${totalRun} passed)${RESET}`);
    console.log(`Fix failures and re-run: ${DIM}npm run gates:glossary:check${RESET}`);
  }
}

process.exit(totalFailures > 0 ? 1 : 0);
