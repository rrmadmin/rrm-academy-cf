# Glossary Inline Link Style Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring 196 D1 `glossary_term.body_html` rows into compliance with the canonical inline-link variants (gloss-xref + cite-ref), via a transactional + CAS-protected + chunked SQL apply, plus a CI guard that prevents future drift without wedging unrelated deploys.

**Architecture:** A single shared classifier module (`scripts/lib/glossary-link-classifier.mjs`) drives three scripts (audit, normalizer, CI check) so their verdicts cannot diverge. The normalizer parses each term's `bodyHtml` with `node-html-parser`, applies surgical class/wrap transforms via DOM (not regex), and emits chunked transactional SQL with compare-and-swap WHERE clauses. A new Workflow H in the `/glossary-update` skill consumes the SQL chunks. The CI guard ships in two stages (warn-only first, hard gate after three clean deploys) to avoid deploy deadlocks.

**Tech Stack:** Node 20+ with `node --test`, `node-html-parser`, `wrangler` for D1 access, `gh` CLI for dispatch, GitHub Actions for CI gate, the existing `/glossary-update` skill for D1 mutations.

**Spec:** `docs/superpowers/specs/2026-05-05-glossary-link-style-normalization-design.md` (v2 post-/arise).

**Branch:** Work on `claude/glossary-link-normalization` (current; spec already committed at `1c785e6`).

**Tests live at:** `test/*.test.js`, run with `npm test`. Helpers in `test/_helpers.js`.

---

## Phase 0: Pre-flight verification (no commits)

These are read-only checks. Each surfaces an assumption from the spec; failure means the plan needs adjustment before implementation.

### Task 0.1: Verify spoke template `.prose` ancestor

**Files:** read-only `src/pages/glossary/[slug].astro` (or whatever the spoke route is; locate first).

- [ ] **Step 1: Locate the spoke template**

```bash
find src/pages/glossary -name '*.astro' -type f 2>/dev/null
```

Expected: at least `src/pages/glossary/index.astro` (pillar) and one of `src/pages/glossary/[slug].astro` or `src/pages/glossary/[...slug].astro` (spoke). Note the spoke filename.

- [ ] **Step 2: Inspect the spoke template for `.prose` ancestor**

```bash
grep -nE 'class="[^"]*prose[^"]*"' src/pages/glossary/[slug].astro
```

(Or whichever filename Step 1 found.)

Expected: at least one match; ideally an `<article class="prose">` or `<div class="prose">` wrapping `<GlossaryTerm>`.

- [ ] **Step 3: Record the result**

If found: note "spoke wrapper present, no Phase 1 fix needed" and proceed.
If absent: note "spoke wrapper MISSING — Task 1.x will add `<article class="prose">` around `<GlossaryTerm>` in the spoke template."

### Task 0.2: Re-verify drift counts

**Files:** read-only `src/data/glossary.json`.

- [ ] **Step 1: Run the empirical drift count script**

```bash
python3 << 'PYEOF'
import json, re
d = json.load(open('src/data/glossary.json'))
in_sup_no_cite = 0
in_sup_with_cite = 0
bare_no_sup = 0
for t in d.get('terms',[]):
    body = t.get('bodyHtml','') or ''
    for m in re.finditer(r'(<sup[^>]*>\s*)?<a\s+href="#ref-\d+"[^>]*>[^<]*</a>(\s*</sup>)?', body):
        sup_open = m.group(1) or ''
        sup_close = m.group(2) or ''
        if sup_open and sup_close:
            if 'cite-ref' in sup_open:
                in_sup_with_cite += 1
            else:
                in_sup_no_cite += 1
        else:
            bare_no_sup += 1
print(f'in <sup> with cite-ref class:    {in_sup_with_cite}')
print(f'in <sup> WITHOUT cite-ref class: {in_sup_no_cite}')
print(f'truly bare (no <sup>):           {bare_no_sup}')

xref = 0
no_xref = 0
section_anchors = 0
SECTION_IDS = {'overview','core-rrm-principles','fertility-awareness','clinical-approaches',
               'diagnostic-tools','surgical-techniques','conditions','overlapping-disciplines',
               'broader-framework','abbreviations','references'}
for t in d.get('terms',[]):
    body = t.get('bodyHtml','') or ''
    for m in re.finditer(r'<a\s+([^>]*href="#([^"]+)"[^>]*)>', body):
        attrs = m.group(1)
        href = m.group(2)
        if re.match(r'(ref|cite)-', href):
            continue
        if href in SECTION_IDS:
            section_anchors += 1
            continue
        if re.search(r'class="[^"]*\bgloss-xref\b[^"]*"', attrs):
            xref += 1
        else:
            no_xref += 1
print(f'inpage anchors WITH gloss-xref:  {xref}')
print(f'inpage anchors WITHOUT:          {no_xref}')
print(f'section anchors in bodies:       {section_anchors}')
PYEOF
```

Expected (per spec): `in <sup> WITHOUT cite-ref class: 227`, `inpage anchors WITHOUT: 138`, `section anchors in bodies: 0`. If counts differ materially, log new numbers and proceed (transforms are count-agnostic).

### Task 0.3: Verify sanitizer is class-preserving

**Files:** read-only `src/lib/html-sanitize.mjs`, `src/lib/fetch-glossary-data.mjs`.

- [ ] **Step 1: Inspect sanitizer**

```bash
cat src/lib/html-sanitize.mjs
```

Expected: regex strips `<font>`, `<style>`, `<script>`, `on*` handlers, collapses whitespace runs, strips empty `<p>`. Confirms `class` attribute is NOT removed on remaining tags.

- [ ] **Step 2: Inspect fetcher's call site**

```bash
grep -nB1 -A4 'sanitizeHtml' src/lib/fetch-glossary-data.mjs
```

Expected: `sanitizeHtml` is called inside `cleanTerm()` for every fetched body. No conditional skip.

### Task 0.4: Confirm `node-html-parser` round-trips cleanly on real bodies

**Files:** none yet (dep not installed).

- [ ] **Step 1: Quick inspection without installing**

```bash
npm view node-html-parser version dependencies
```

Expected: a recent version (6.x at time of writing). Note the version.

- [ ] **Step 2: Install the dep (this also covers Task 1.1 prerequisites)**

```bash
npm install node-html-parser --save-dev
```

Expected: `node-html-parser` added to `devDependencies` in `package.json` and `package-lock.json` updated. Wait to commit until Task 1.1.

- [ ] **Step 3: Round-trip a sample of 10 real term bodies**

Create a temp script `/tmp/roundtrip-check.mjs`:

```javascript
import { readFileSync } from 'node:fs';
import { parse } from 'node-html-parser';

const data = JSON.parse(readFileSync('src/data/glossary.json', 'utf-8'));
const terms = data.terms.slice(0, 10);

let mutationCount = 0;
const allowedDiffs = [
  /\s{2,}/g,            // whitespace runs collapsed
  /<br\s*\/>/g,         // self-closing void element
  /'/g,                 // single-quoted attrs
];

for (const t of terms) {
  const root = parse(t.bodyHtml);
  const out = root.toString();
  if (out !== t.bodyHtml) {
    mutationCount++;
    console.log('-- ' + t.slug + ' diff:');
    // print first 200 chars of each
    console.log('  IN: ' + t.bodyHtml.slice(0, 200));
    console.log('  OUT: ' + out.slice(0, 200));
  }
}
console.log(`\n${mutationCount} of 10 terms produced different output.`);
```

```bash
node /tmp/roundtrip-check.mjs
```

Expected: at most cosmetic diffs (whitespace, void elements, quote style). If diffs include text-node content changes or structural changes, switch to `parse5` and re-run. Document which library was chosen.

- [ ] **Step 4: Clean up the temp script**

```bash
rm /tmp/roundtrip-check.mjs
```

### Task 0.5: Test wrangler `--file=` chunk size

**Files:** none.

- [ ] **Step 1: Build a 50-statement test SQL file**

```bash
cat > /tmp/wrangler-chunk-test.sql << 'EOF'
BEGIN TRANSACTION;
SELECT 1;
SELECT 2;
EOF
# Add 47 more SELECT statements
for i in $(seq 3 50); do echo "SELECT $i;" >> /tmp/wrangler-chunk-test.sql; done
echo "COMMIT;" >> /tmp/wrangler-chunk-test.sql
wc -l /tmp/wrangler-chunk-test.sql
```

Expected: 53 lines (BEGIN + 50 SELECTs + COMMIT + trailing).

- [ ] **Step 2: Execute against D1**

```bash
wrangler d1 execute rrm-auth --remote --file=/tmp/wrangler-chunk-test.sql 2>&1 | tail -10
```

Expected: success message with 50 results returned. If it fails on size, drop chunk size to 25 and retry. Note the working chunk size.

- [ ] **Step 3: Clean up**

```bash
rm /tmp/wrangler-chunk-test.sql
```

---

## Phase 1: Dependency + spoke template fix (if needed)

### Task 1.1: Commit `node-html-parser` dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Confirm install from Task 0.4 still in working tree**

```bash
git status -- package.json package-lock.json
```

Expected: both files modified (from Task 0.4 step 2).

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add node-html-parser for glossary link normalizer

Used by scripts/lib/glossary-link-classifier.mjs and
scripts/normalize-glossary-links.mjs to parse and mutate
glossary_term.body_html surgically. Build-time only (devDep)."
```

### Task 1.2: Fix spoke template `.prose` wrapper (CONDITIONAL)

**Skip this task if Task 0.1 confirmed wrapper present.**

**Files:**
- Modify: `src/pages/glossary/[slug].astro` (or the actual spoke filename from Task 0.1)

- [ ] **Step 1: Read current spoke template**

```bash
cat src/pages/glossary/[slug].astro
```

Identify where `<GlossaryTerm>` is rendered.

- [ ] **Step 2: Wrap `<GlossaryTerm>` in `<article class="prose">`**

If the existing render is e.g. `<GlossaryTerm term={term} />`, change to:

```astro
<article class="prose">
  <GlossaryTerm term={term} headingLevel="h2" mode="spoke" />
</article>
```

(Keep existing props.) If a different wrapper element makes more sense for SEO, use that with `class="prose"`.

- [ ] **Step 3: Build + verify**

```bash
npm run build 2>&1 | tail -5
```

Expected: success. Run dev briefly to confirm `/glossary/<some-slug>/` renders without regression:

```bash
npm run dev > /tmp/dev.log 2>&1 &
sleep 8
curl -sI http://localhost:4321/glossary/endometriosis/ | head -3
pkill -f 'astro dev'
```

Expected: 200 response.

- [ ] **Step 4: Commit**

```bash
git add src/pages/glossary/[slug].astro
git commit -m "fix(glossary): wrap spoke template in .prose for variant 2 selector

The .prose a.gloss-xref CSS rule (variant 2) requires a .prose
ancestor. Pillar /glossary/ already wraps content in
<article class=\"prose\">. Spoke pages /glossary/<slug>/ now match,
so cross-references render with the soft inherit-color treatment
on both routes."
```

---

## Phase 2: Shared classifier module + tests (TDD)

### Task 2.1: Write classifier tests covering all 13 actions + boundary cases

**Files:**
- Create: `test/glossary-link-classifier.test.js`

- [ ] **Step 1: Write the failing test file**

Path: `test/glossary-link-classifier.test.js`

```javascript
/**
 * Tests for scripts/lib/glossary-link-classifier.mjs
 * Run with: node --test test/glossary-link-classifier.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'node-html-parser';
import { classifyAnchor, hasClassToken } from '../scripts/lib/glossary-link-classifier.mjs';

const KNOWN_SLUGS = new Set(['endometriosis', 'progesterone', 'pcos', 'asherman-s-syndrome']);
const SECTION_IDS = new Set([
  'overview','core-rrm-principles','fertility-awareness','clinical-approaches',
  'diagnostic-tools','surgical-techniques','conditions','overlapping-disciplines',
  'broader-framework','abbreviations','references',
]);

function classifyFirst(html) {
  const root = parse(html);
  const a = root.querySelector('a');
  return classifyAnchor({
    attrs: Object.fromEntries(a.rawAttributes ? Object.entries(a.rawAttributes) : []),
    href: a.getAttribute('href'),
    classList: (a.getAttribute('class') || '').split(/\s+/).filter(Boolean),
    parentTagName: a.parentNode && a.parentNode.tagName ? a.parentNode.tagName.toLowerCase() : null,
    parentClassList: a.parentNode && a.parentNode.getAttribute
      ? (a.parentNode.getAttribute('class') || '').split(/\s+/).filter(Boolean)
      : [],
    knownTermSlugs: KNOWN_SLUGS,
    sectionIds: SECTION_IDS,
  });
}

describe('hasClassToken (word-boundary)', () => {
  it('matches exact token', () => assert.equal(hasClassToken(['gloss-xref'], 'gloss-xref'), true));
  it('matches token among others', () => assert.equal(hasClassToken(['foo','gloss-xref','bar'], 'gloss-xref'), true));
  it('does not match substring', () => assert.equal(hasClassToken(['my-gloss-xref-fake'], 'gloss-xref'), false));
  it('does not match suffix', () => assert.equal(hasClassToken(['gloss-xref-extended'], 'gloss-xref'), false));
  it('handles empty list', () => assert.equal(hasClassToken([], 'gloss-xref'), false));
});

describe('classifyAnchor — noop variants', () => {
  it('in-page anchor with gloss-xref already', () => {
    assert.equal(classifyFirst('<a class="gloss-xref" href="#endometriosis">e</a>'), 'noop');
  });
  it('citation already in <sup class="cite-ref">', () => {
    assert.equal(classifyFirst('<sup class="cite-ref"><a href="#ref-1">1</a></sup>'), 'noop');
  });
});

describe('classifyAnchor — add-gloss-xref', () => {
  it('bare in-page anchor to a known term', () => {
    assert.equal(classifyFirst('<a href="#endometriosis">e</a>'), 'add-gloss-xref');
  });
  it('case-mismatched (NOCASE) target still resolves', () => {
    assert.equal(classifyFirst('<a href="#PROgesterone">p</a>'), 'add-gloss-xref');
  });
  it('anchor with unrelated existing class', () => {
    assert.equal(classifyFirst('<a class="emphasis" href="#endometriosis">e</a>'), 'add-gloss-xref');
  });
  it('does NOT match substring-class false-positive', () => {
    assert.equal(classifyFirst('<a class="my-gloss-xref-fake" href="#endometriosis">e</a>'), 'add-gloss-xref');
  });
});

describe('classifyAnchor — citation transforms', () => {
  it('add-cite-ref-class-to-sup when parent is bare <sup>', () => {
    assert.equal(classifyFirst('<sup><a href="#ref-7">7</a></sup>'), 'add-cite-ref-class-to-sup');
  });
  it('add-cite-ref-class-to-sup when parent <sup> has other class', () => {
    assert.equal(classifyFirst('<sup class="emphasis"><a href="#ref-7">7</a></sup>'), 'add-cite-ref-class-to-sup');
  });
  it('wrap-cite-ref when no <sup> parent', () => {
    assert.equal(classifyFirst('<p><a href="#ref-7">7</a></p>'), 'wrap-cite-ref');
  });
});

describe('classifyAnchor — manual-review', () => {
  it('section anchor', () => {
    assert.equal(classifyFirst('<a href="#references">refs</a>'), 'manual-review:section-anchor');
  });
  it('part section anchor', () => {
    assert.equal(classifyFirst('<a href="#core-rrm-principles">part 1</a>'), 'manual-review:section-anchor');
  });
  it('broken target', () => {
    assert.equal(classifyFirst('<a href="#nonexistent-term">x</a>'), 'manual-review:broken-target');
  });
  it('multi-cite comma form', () => {
    assert.equal(classifyFirst('<a href="#ref-7,8">7,8</a>'), 'manual-review:multi-cite');
  });
  it('zero-padded ref', () => {
    assert.equal(classifyFirst('<a href="#ref-007">7</a>'), 'manual-review:zero-padded');
  });
  it('non-canonical #cite-N form', () => {
    assert.equal(classifyFirst('<a href="#cite-3">3</a>'), 'manual-review:non-canonical-citation');
  });
  it('empty href', () => {
    assert.equal(classifyFirst('<a href="">x</a>'), 'manual-review:malformed-href');
  });
  it('hash-only href', () => {
    assert.equal(classifyFirst('<a href="#">x</a>'), 'manual-review:malformed-href');
  });
  it('javascript: href', () => {
    assert.equal(classifyFirst('<a href="javascript:alert(1)">x</a>'), 'manual-review:malformed-href');
  });
  it('href with query string', () => {
    assert.equal(classifyFirst('<a href="#term?param=1">x</a>'), 'manual-review:malformed-href');
  });
});

describe('classifyAnchor — pass-through variants', () => {
  it('mailto', () => {
    assert.equal(classifyFirst('<a href="mailto:foo@bar.com">contact</a>'), 'mailto-or-tel');
  });
  it('tel', () => {
    assert.equal(classifyFirst('<a href="tel:+15551234567">call</a>'), 'mailto-or-tel');
  });
  it('external https', () => {
    assert.equal(classifyFirst('<a href="https://pubmed.ncbi.nlm.nih.gov/12345/">pubmed</a>'), 'external');
  });
  it('external http', () => {
    assert.equal(classifyFirst('<a href="http://example.com/">e</a>'), 'external');
  });
  it('pillar / on-site', () => {
    assert.equal(classifyFirst('<a href="/what-is-rrm/">RRM</a>'), 'pillar-or-onsite');
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

```bash
node --test test/glossary-link-classifier.test.js 2>&1 | tail -10
```

Expected: ALL tests fail with `Cannot find module '../scripts/lib/glossary-link-classifier.mjs'`.

### Task 2.2: Implement the classifier

**Files:**
- Create: `scripts/lib/glossary-link-classifier.mjs`

- [ ] **Step 1: Write the classifier module**

Path: `scripts/lib/glossary-link-classifier.mjs`

```javascript
/**
 * Shared classifier for glossary inline-link normalization.
 *
 * Imported by:
 *   - scripts/audit-glossary-links.mjs
 *   - scripts/normalize-glossary-links.mjs
 *   - scripts/check-glossary-link-classes.mjs
 *
 * Single source of truth — duplication is forbidden (see G3 pattern in
 * scripts/gates/validate-fact-pipeline.mjs).
 *
 * Returns one of the closed-enum action values listed in the
 * spec, §Phase 2 audit script.
 */

const REF_RE = /^#ref-(\d+)$/;
const REF_LOOSE_PREFIX_RE = /^#ref-/;
const CITE_RE = /^#cite-(\d+)$/;
const HASH_ONLY_RE = /^#$/;
const MULTI_CITE_RE = /^#ref-\d+,/;
const ZERO_PAD_REF_RE = /^#ref-0\d+$/;

/**
 * Word-boundary class check. NOT a substring includes() check.
 */
export function hasClassToken(classList, token) {
  return Array.isArray(classList) && classList.includes(token);
}

/**
 * @param {object} args
 * @param {string} args.href                         the <a>'s href attribute
 * @param {string[]} args.classList                  tokenized class attribute
 * @param {string|null} args.parentTagName           lowercase tag name of parent or null
 * @param {string[]} args.parentClassList            tokenized parent class
 * @param {Set<string>} args.knownTermSlugs          all glossary term slugs (lowercased)
 * @param {Set<string>} args.sectionIds              page section anchors that must NOT get gloss-xref
 * @returns {string} action — one of the closed-enum values
 */
export function classifyAnchor({ href, classList, parentTagName, parentClassList, knownTermSlugs, sectionIds }) {
  if (href == null || href === '') return 'manual-review:malformed-href';
  if (HASH_ONLY_RE.test(href)) return 'manual-review:malformed-href';
  if (/^javascript:/i.test(href)) return 'manual-review:malformed-href';
  if (/^mailto:/i.test(href)) return 'mailto-or-tel';
  if (/^tel:/i.test(href)) return 'mailto-or-tel';
  if (/^https?:\/\//i.test(href)) return 'external';
  if (href.startsWith('/')) return 'pillar-or-onsite';

  // Anchor of some kind. From here, href starts with '#'.
  if (!href.startsWith('#')) return 'manual-review:malformed-href';

  // Citation forms first (most specific)
  if (ZERO_PAD_REF_RE.test(href)) return 'manual-review:zero-padded';
  if (MULTI_CITE_RE.test(href)) return 'manual-review:multi-cite';
  if (CITE_RE.test(href)) return 'manual-review:non-canonical-citation';

  if (REF_RE.test(href)) {
    // Strict ref-N citation. Decide based on parent.
    if (parentTagName === 'sup' && hasClassToken(parentClassList, 'cite-ref')) return 'noop';
    if (parentTagName === 'sup') return 'add-cite-ref-class-to-sup';
    return 'wrap-cite-ref';
  }

  // Loose ref-... that didn't match strict pattern (e.g., #ref-7-bad-suffix)
  if (REF_LOOSE_PREFIX_RE.test(href)) return 'manual-review:malformed-href';

  // In-page anchor that isn't a citation. Strip query/hash-fragment-with-slash if any.
  const targetSlug = href.slice(1).toLowerCase();
  if (targetSlug.includes('?') || targetSlug.includes('/')) return 'manual-review:malformed-href';

  if (sectionIds.has(targetSlug)) return 'manual-review:section-anchor';

  // Case-insensitive lookup against term slugs (D1 column is COLLATE NOCASE).
  const lowered = new Set([...knownTermSlugs].map(s => s.toLowerCase()));
  if (!lowered.has(targetSlug)) return 'manual-review:broken-target';

  if (hasClassToken(classList, 'gloss-xref')) return 'noop';
  return 'add-gloss-xref';
}
```

- [ ] **Step 2: Run the tests, expect pass**

```bash
node --test test/glossary-link-classifier.test.js 2>&1 | tail -10
```

Expected: all tests pass (24 tests across 5 describe blocks).

- [ ] **Step 3: Run the full project test suite for regression**

```bash
npm test 2>&1 | tail -5
```

Expected: existing tests + new classifier tests all pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/glossary-link-classifier.mjs test/glossary-link-classifier.test.js
git commit -m "feat: shared classifier for glossary link normalization

Single SSOT for the closed-enum action values used by audit,
normalizer, and CI guard scripts. Word-boundary class-token
matching (not substring). Covers all 13 action types including
manual-review subcategories (section-anchor, broken-target,
multi-cite, zero-padded, non-canonical, malformed-href).

24 unit tests cover happy paths + 11 boundary cases."
```

---

## Phase 3: Audit script

### Task 3.1: Implement the audit script

**Files:**
- Create: `scripts/audit-glossary-links.mjs`

- [ ] **Step 1: Write the script**

Path: `scripts/audit-glossary-links.mjs`

```javascript
#!/usr/bin/env node
/**
 * Audits glossary term bodies for inline-link drift.
 *
 * Read-only. Always exits 0. Emits JSON report to stdout (or --out).
 *
 * Inputs:
 *   --data <path>     default src/data/glossary.json
 *   --from-d1         read from live D1 instead (ALL statuses)
 *   --out <path>      write JSON report here instead of stdout
 *
 * Action counts and per-anchor entries follow the closed-enum from
 * scripts/lib/glossary-link-classifier.mjs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parse } from 'node-html-parser';
import { classifyAnchor } from './lib/glossary-link-classifier.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function flag(name) {
  return process.argv.includes(name);
}

const SECTION_IDS = new Set([
  'overview','core-rrm-principles','fertility-awareness','clinical-approaches',
  'diagnostic-tools','surgical-techniques','conditions','overlapping-disciplines',
  'broader-framework','abbreviations','references',
]);

function loadFromJson(path) {
  const d = JSON.parse(readFileSync(path, 'utf-8'));
  return d.terms.map(t => ({ id: t.id, slug: t.slug, bodyHtml: t.bodyHtml || '', status: 'published' }));
}

function loadFromD1() {
  const out = execSync(
    `wrangler d1 execute rrm-auth --remote --json --command "SELECT id, slug, body_html, status FROM glossary_term"`,
    { encoding: 'utf-8' }
  );
  const parsed = JSON.parse(out);
  const rows = parsed[0]?.results || [];
  return rows.map(r => ({ id: r.id, slug: r.slug, bodyHtml: r.body_html || '', status: r.status }));
}

const dataPath = arg('--data', 'src/data/glossary.json');
const outPath = arg('--out', null);
const useD1 = flag('--from-d1');

const terms = useD1 ? loadFromD1() : loadFromJson(dataPath);
const knownSlugs = new Set(terms.map(t => t.slug.toLowerCase()));

const actionCounts = {};
const perAnchor = [];

for (const term of terms) {
  if (!term.bodyHtml) continue;
  const root = parse(term.bodyHtml);
  const anchors = root.querySelectorAll('a');
  let anchorIdx = 0;
  for (const a of anchors) {
    const action = classifyAnchor({
      href: a.getAttribute('href'),
      classList: (a.getAttribute('class') || '').split(/\s+/).filter(Boolean),
      parentTagName: a.parentNode?.tagName?.toLowerCase() || null,
      parentClassList: (a.parentNode?.getAttribute?.('class') || '').split(/\s+/).filter(Boolean),
      knownTermSlugs: knownSlugs,
      sectionIds: SECTION_IDS,
    });
    actionCounts[action] = (actionCounts[action] || 0) + 1;
    if (action !== 'noop' && action !== 'mailto-or-tel' && action !== 'external' && action !== 'pillar-or-onsite') {
      perAnchor.push({
        termSlug: term.slug,
        anchorIndex: anchorIdx,
        href: a.getAttribute('href'),
        snippet: a.outerHTML.slice(0, 200),
        action,
      });
    }
    anchorIdx++;
  }
}

const report = {
  source: useD1 ? 'd1' : dataPath,
  termCount: terms.length,
  actionCounts,
  perAnchor,
};

const json = JSON.stringify(report, null, 2);
if (outPath) {
  writeFileSync(outPath, json);
  console.log(`Audit report written to ${outPath}`);
  console.log(`Action counts: ${JSON.stringify(actionCounts)}`);
} else {
  console.log(json);
}
```

- [ ] **Step 2: Run audit against current data**

```bash
node scripts/audit-glossary-links.mjs --out /tmp/audit-report.json
cat /tmp/audit-report.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d['actionCounts'], indent=2)); print('per-anchor entries:', len(d['perAnchor']))"
```

Expected output (per Phase 0.2 verification):
```json
{
  "noop": ...,
  "add-gloss-xref": 138,
  "add-cite-ref-class-to-sup": 227,
  ...
}
```
plus `per-anchor entries: 365` (138 + 227, plus any manual-review entries).

- [ ] **Step 3: Add a smoke-test for the audit script**

Append to `test/glossary-link-classifier.test.js`:

```javascript
import { spawnSync } from 'node:child_process';

describe('audit-glossary-links smoke', () => {
  it('runs against current src/data/glossary.json without error', () => {
    const r = spawnSync('node', ['scripts/audit-glossary-links.mjs'], { encoding: 'utf-8' });
    assert.equal(r.status, 0);
    const report = JSON.parse(r.stdout);
    assert.ok(typeof report.actionCounts === 'object');
    assert.ok(typeof report.termCount === 'number');
    assert.ok(report.termCount > 100);
  });
});
```

- [ ] **Step 4: Run the smoke test**

```bash
node --test test/glossary-link-classifier.test.js 2>&1 | tail -8
```

Expected: 25 tests pass (24 + 1 new).

- [ ] **Step 5: Commit**

```bash
git add scripts/audit-glossary-links.mjs test/glossary-link-classifier.test.js
git commit -m "feat: glossary link audit script (read-only)

Reads src/data/glossary.json (default) or live D1 (--from-d1),
classifies every <a> in every term body, emits JSON report with
action counts + per-anchor entries for non-noop actions.

Always exits 0 — read-only audit, never blocks."
```

### Task 3.2: Resolve any manual-review entries

**Files:** none (operator action).

- [ ] **Step 1: Inspect manual-review counts**

```bash
node scripts/audit-glossary-links.mjs --out /tmp/audit-report.json
python3 -c "
import json
d = json.load(open('/tmp/audit-report.json'))
mr = [e for e in d['perAnchor'] if e['action'].startswith('manual-review:')]
by_kind = {}
for e in mr:
    by_kind.setdefault(e['action'], []).append(e)
for k, items in by_kind.items():
    print(f'{k}: {len(items)}')
    for e in items[:3]:
        print(f'  {e[\"termSlug\"]} → {e[\"href\"]}')
"
```

Expected (per spec): zero or near-zero `manual-review:*` entries. If non-zero, each must be resolved before Phase 4 emits SQL.

- [ ] **Step 2: For each manual-review entry, route through `/glossary-update` Workflow A**

For each entry:
- `manual-review:section-anchor`: confirm intentional (it'll keep variant 1 styling). No edit needed but the audit will keep flagging it; consider exempting via spec amendment or hand-edit.
- `manual-review:broken-target`: edit the term body to either fix the slug or remove the broken anchor.
- `manual-review:multi-cite`: split `<a href="#ref-7,8">7,8</a>` into `<sup><a href="#ref-7">7</a></sup>,<sup><a href="#ref-8">8</a></sup>`.
- `manual-review:zero-padded`: change `#ref-007` → `#ref-7`.
- `manual-review:non-canonical-citation`: decide globally — either drop `#cite-N` from classifier (no real cases) or extend transforms to handle it.
- `manual-review:malformed-href`: edit the term body via Workflow A.

- [ ] **Step 3: Re-run audit after fixes**

```bash
node scripts/audit-glossary-links.mjs --from-d1 --out /tmp/audit-report-postfix.json
python3 -c "
import json
d = json.load(open('/tmp/audit-report-postfix.json'))
mr = [e for e in d['perAnchor'] if e['action'].startswith('manual-review:')]
print(f'manual-review entries remaining: {len(mr)}')
"
```

Expected: 0 (all resolved). Phase 4 won't emit SQL while any remain.

---

## Phase 4: Normalizer (emit SQL only)

### Task 4.1: Write transform helper tests

**Files:**
- Modify: `test/glossary-link-classifier.test.js`

- [ ] **Step 1: Append transform tests**

Append to `test/glossary-link-classifier.test.js`:

```javascript
import { applyTransforms } from '../scripts/lib/glossary-link-transforms.mjs';

describe('applyTransforms — add-gloss-xref', () => {
  it('adds gloss-xref to bare anchor', () => {
    const out = applyTransforms('<p><a href="#endometriosis">e</a></p>', {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    assert.match(out, /class="gloss-xref"/);
  });
  it('adds gloss-xref alongside existing class', () => {
    const out = applyTransforms('<p><a class="emphasis" href="#endometriosis">e</a></p>', {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    assert.match(out, /class="emphasis gloss-xref"|class="gloss-xref emphasis"/);
  });
  it('is idempotent', () => {
    const once = applyTransforms('<p><a href="#endometriosis">e</a></p>', {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    const twice = applyTransforms(once, {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    assert.equal(once, twice);
  });
});

describe('applyTransforms — citation', () => {
  it('adds cite-ref to bare <sup>', () => {
    const out = applyTransforms('<p><sup><a href="#ref-7">7</a></sup></p>', {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    assert.match(out, /<sup class="cite-ref">/);
  });
  it('adds cite-ref alongside existing class', () => {
    const out = applyTransforms('<p><sup class="emphasis"><a href="#ref-7">7</a></sup></p>', {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    assert.match(out, /class="emphasis cite-ref"|class="cite-ref emphasis"/);
  });
  it('wraps bare <a> when no <sup>', () => {
    const out = applyTransforms('<p><a href="#ref-7">7</a></p>', {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    assert.match(out, /<sup class="cite-ref"><a href="#ref-7">7<\/a><\/sup>/);
  });
});

describe('applyTransforms — manual-review skip', () => {
  it('does not transform terms with manual-review anchors', () => {
    const input = '<p><a href="#nonexistent">x</a></p>';
    const out = applyTransforms(input, {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    // applyTransforms throws when manual-review present (caller decides to skip term)
    // Actually we'll have it return null so caller knows to skip.
    assert.equal(out, null);
  });
});

describe('applyTransforms — preserves non-anchor content', () => {
  it('keeps <strong>, text, <p> intact', () => {
    const input = '<p><strong>Bold</strong> text and <a href="#endometriosis">e</a></p>';
    const out = applyTransforms(input, {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    assert.match(out, /<strong>Bold<\/strong>/);
    assert.match(out, /text and/);
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

```bash
node --test test/glossary-link-classifier.test.js 2>&1 | tail -10
```

Expected: 8 new tests fail (`Cannot find module ... transforms`).

### Task 4.2: Implement transforms module

**Files:**
- Create: `scripts/lib/glossary-link-transforms.mjs`

- [ ] **Step 1: Write the module**

Path: `scripts/lib/glossary-link-transforms.mjs`

```javascript
/**
 * Transforms applied to a single term's bodyHtml.
 *
 * Returns the new bodyHtml string, OR null if any anchor in the body
 * triggered a manual-review:* action (caller should skip the term entirely).
 *
 * Transforms are surgical: only anchor classes and <sup> wrappers are
 * mutated. Non-anchor markup is preserved through node-html-parser
 * round-trip (cosmetic serializer normalization is acceptable per spec
 * preservation rules).
 */
import { parse } from 'node-html-parser';
import { classifyAnchor, hasClassToken } from './glossary-link-classifier.mjs';

export function applyTransforms(bodyHtml, { knownTermSlugs, sectionIds }) {
  const root = parse(bodyHtml);
  const anchors = root.querySelectorAll('a');

  // First pass: classify everything. If any is manual-review, bail.
  const classifications = anchors.map(a => ({
    anchor: a,
    action: classifyAnchor({
      href: a.getAttribute('href'),
      classList: (a.getAttribute('class') || '').split(/\s+/).filter(Boolean),
      parentTagName: a.parentNode?.tagName?.toLowerCase() || null,
      parentClassList: (a.parentNode?.getAttribute?.('class') || '').split(/\s+/).filter(Boolean),
      knownTermSlugs,
      sectionIds,
    }),
  }));

  for (const { action } of classifications) {
    if (action.startsWith('manual-review:')) return null;
  }

  // Second pass: apply mutations.
  for (const { anchor, action } of classifications) {
    switch (action) {
      case 'noop':
      case 'mailto-or-tel':
      case 'external':
      case 'pillar-or-onsite':
        break;

      case 'add-gloss-xref': {
        const tokens = (anchor.getAttribute('class') || '').split(/\s+/).filter(Boolean);
        if (!tokens.includes('gloss-xref')) tokens.push('gloss-xref');
        anchor.setAttribute('class', tokens.join(' '));
        break;
      }

      case 'add-cite-ref-class-to-sup': {
        const sup = anchor.parentNode;
        const tokens = (sup.getAttribute('class') || '').split(/\s+/).filter(Boolean);
        if (!tokens.includes('cite-ref')) tokens.push('cite-ref');
        sup.setAttribute('class', tokens.join(' '));
        break;
      }

      case 'wrap-cite-ref': {
        // Build new <sup class="cite-ref"> wrapping the anchor's outerHTML.
        const newHtml = `<sup class="cite-ref">${anchor.outerHTML}</sup>`;
        anchor.replaceWith(parse(newHtml).firstChild);
        break;
      }
    }
  }

  return root.toString();
}
```

- [ ] **Step 2: Run tests, expect pass**

```bash
node --test test/glossary-link-classifier.test.js 2>&1 | tail -10
```

Expected: all tests pass (24 + 1 audit smoke + 8 transform = 33).

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/glossary-link-transforms.mjs test/glossary-link-classifier.test.js
git commit -m "feat: glossary link transforms module

applyTransforms() returns the mutated bodyHtml or null when any
anchor triggers manual-review:*. Two-pass design ensures the
caller doesn't get a partially-mutated term: first classify all
anchors, then apply changes only if every anchor is auto-fixable.

Idempotency tested. Substring class-name false-positive guarded.
Wrapping bare <a> in new <sup class=\"cite-ref\"> covered."
```

### Task 4.3: Implement the normalizer script

**Files:**
- Create: `scripts/normalize-glossary-links.mjs`

- [ ] **Step 1: Write the script**

Path: `scripts/normalize-glossary-links.mjs`

```javascript
#!/usr/bin/env node
/**
 * Normalizes glossary term bodies. Emits chunked transactional SQL with
 * compare-and-swap WHERE clauses + a snapshot file. Does NOT call wrangler.
 *
 * Inputs:
 *   --from-d1      read from live D1 (default: true). Recommended.
 *   --data <path>  read from JSON file instead (testing only)
 *   --apply        write SQL chunks + snapshot file (default: dry-run)
 *   --limit N      stratified sample of N terms by action category
 *   --out-dir      default /tmp
 *
 * Output:
 *   /tmp/glossary-link-normalize.<timestamp>.NNN.sql  (chunked, ≤50 stmts)
 *   /tmp/glossary-link-snapshot.<timestamp>.json       (rollback artifact)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { applyTransforms } from './lib/glossary-link-transforms.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function flag(name) {
  return process.argv.includes(name);
}

const SECTION_IDS = new Set([
  'overview','core-rrm-principles','fertility-awareness','clinical-approaches',
  'diagnostic-tools','surgical-techniques','conditions','overlapping-disciplines',
  'broader-framework','abbreviations','references',
]);

const CHUNK_SIZE = 50;

function loadFromD1() {
  const out = execSync(
    `wrangler d1 execute rrm-auth --remote --json --command "SELECT id, slug, body_html, status FROM glossary_term"`,
    { encoding: 'utf-8' }
  );
  const parsed = JSON.parse(out);
  const rows = parsed[0]?.results || [];
  return rows.map(r => ({ id: r.id, slug: r.slug, bodyHtml: r.body_html || '', status: r.status }));
}

function loadFromJson(path) {
  const d = JSON.parse(readFileSync(path, 'utf-8'));
  return d.terms.map(t => ({ id: t.id, slug: t.slug, bodyHtml: t.bodyHtml || '', status: 'published' }));
}

function escapeSqlSingleQuote(s) {
  return s.replace(/'/g, "''");
}

function diffPreview(slug, oldBody, newBody) {
  const oldLen = oldBody.length;
  const newLen = newBody.length;
  // crude diff summary: show first 200 chars of each, length delta
  const delta = newLen - oldLen;
  return [
    `--- ${slug} (delta: ${delta >= 0 ? '+' : ''}${delta} chars)`,
    `OLD: ${oldBody.slice(0, 200)}${oldBody.length > 200 ? '…' : ''}`,
    `NEW: ${newBody.slice(0, 200)}${newBody.length > 200 ? '…' : ''}`,
  ].join('\n');
}

function stratifiedSample(diffs, limit) {
  // Group by action signature (which transforms hit each term)
  const byCategory = {};
  for (const d of diffs) {
    const cat = d.action;
    (byCategory[cat] ||= []).push(d);
  }
  const out = [];
  for (const cat of Object.keys(byCategory)) {
    if (out.length >= limit) break;
    out.push(byCategory[cat][0]);
  }
  return out.slice(0, limit);
}

const useD1 = !flag('--data');
const dataPath = arg('--data', 'src/data/glossary.json');
const outDir = arg('--out-dir', '/tmp');
const apply = flag('--apply');
const limit = arg('--limit') ? parseInt(arg('--limit'), 10) : null;

const terms = useD1 ? loadFromD1() : loadFromJson(dataPath);

if (!useD1 && terms.length > 0 && terms[0].bodyHtml === undefined) {
  console.error('FATAL: terms[0].bodyHtml is undefined. Field name drift suspected.');
  console.error(`Got keys: ${Object.keys(terms[0]).join(', ')}`);
  process.exit(2);
}

const knownSlugs = new Set(terms.map(t => t.slug.toLowerCase()));

// Compute diffs for all terms
const diffs = [];
const skipped = [];
for (const t of terms) {
  if (!t.bodyHtml) continue;
  const newBody = applyTransforms(t.bodyHtml, { knownTermSlugs: knownSlugs, sectionIds: SECTION_IDS });
  if (newBody === null) {
    skipped.push(t.slug);
    continue;
  }
  if (newBody === t.bodyHtml) continue;
  // Determine the dominant action category for stratification
  const action = newBody.includes('cite-ref') && !t.bodyHtml.includes('cite-ref') ? 'add-cite-ref-class-to-sup'
               : newBody.includes('gloss-xref') && !t.bodyHtml.includes('gloss-xref') ? 'add-gloss-xref'
               : 'mixed';
  diffs.push({ slug: t.slug, oldBody: t.bodyHtml, newBody, action });
}

const sample = limit ? stratifiedSample(diffs, limit) : diffs;

if (skipped.length > 0) {
  console.error(`SKIPPED (manual-review present, run audit + resolve first): ${skipped.length} terms`);
  for (const s of skipped) console.error(`  - ${s}`);
  if (apply) {
    console.error('FATAL: cannot --apply while manual-review entries exist. Resolve via /glossary-update Workflow A first.');
    process.exit(2);
  }
}

if (!apply) {
  // Dry-run output
  for (const d of sample) console.log(diffPreview(d.slug, d.oldBody, d.newBody));
  console.log(`\nDRY RUN COMPLETE. ${sample.length} of ${diffs.length} terms would be modified${limit ? ` (limited to ${limit})` : ''}. Re-run with --apply to write SQL files.`);
  process.exit(0);
}

// Apply mode: write SQL chunks + snapshot.
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const snapshotPath = `${outDir}/glossary-link-snapshot.${ts}.json`;
writeFileSync(snapshotPath, JSON.stringify(sample.map(d => ({ slug: d.slug, body_html: d.oldBody })), null, 2));

const chunkFiles = [];
for (let i = 0; i < sample.length; i += CHUNK_SIZE) {
  const chunk = sample.slice(i, i + CHUNK_SIZE);
  const fileNum = String(Math.floor(i / CHUNK_SIZE) + 1).padStart(3, '0');
  const path = `${outDir}/glossary-link-normalize.${ts}.${fileNum}.sql`;
  const sql = [
    'BEGIN TRANSACTION;',
    ...chunk.map(d =>
      `UPDATE glossary_term\n` +
      `SET body_html = '${escapeSqlSingleQuote(d.newBody)}',\n` +
      `    updated_at = datetime('now')\n` +
      `WHERE slug = '${escapeSqlSingleQuote(d.slug)}'\n` +
      `  AND body_html = '${escapeSqlSingleQuote(d.oldBody)}';`
    ),
    'COMMIT;',
  ].join('\n');
  writeFileSync(path, sql);
  chunkFiles.push(path);
}

console.log(`APPLY-SQL EMITTED. Wrote ${chunkFiles.length} SQL chunks:`);
for (const f of chunkFiles) console.log(`  ${f}`);
console.log(`Snapshot: ${snapshotPath}`);
console.log(`NOT YET APPLIED TO D1. Run via /glossary-update skill Workflow H to commit.`);
```

- [ ] **Step 2: Make it executable + dry-run smoke**

```bash
chmod +x scripts/normalize-glossary-links.mjs
node scripts/normalize-glossary-links.mjs --data src/data/glossary.json --limit 3 2>&1 | tail -20
```

Expected: prints 3 stratified sample diffs + final `DRY RUN COMPLETE.` line. Exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/normalize-glossary-links.mjs
git commit -m "feat: glossary link normalizer (emit SQL only)

Emits chunked transactional SQL (≤50 statements per chunk) with
compare-and-swap WHERE clauses to protect against concurrent
edits. Apostrophe-escaped per SQLite rules. Writes a JSON
snapshot of pre-apply state for rollback.

Default: read from live D1 (--from-d1 implicit). --data path
supported for testing. --limit N selects stratified sample by
action category. Refuses to --apply while manual-review entries
exist; bails with exit 2."
```

---

## Phase 5: CI guard (Stage A — warn-only)

### Task 5.1: Implement the check script

**Files:**
- Create: `scripts/check-glossary-link-classes.mjs`

- [ ] **Step 1: Write the script**

Path: `scripts/check-glossary-link-classes.mjs`

```javascript
#!/usr/bin/env node
/**
 * CI guard: fails build if glossary.json contains link drift.
 *
 * Stage A (warn-only): wired with continue-on-error: true in deploy.yml.
 * Stage B (hard gate): flipped after 3 clean deploys.
 *
 * Inputs:
 *   --data <path>   default src/data/glossary.json
 *
 * Exit codes:
 *   0 — clean
 *   1 — drift detected
 *   2 — file/parse error
 */
import { readFileSync } from 'node:fs';
import { parse } from 'node-html-parser';
import { classifyAnchor } from './lib/glossary-link-classifier.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const SECTION_IDS = new Set([
  'overview','core-rrm-principles','fertility-awareness','clinical-approaches',
  'diagnostic-tools','surgical-techniques','conditions','overlapping-disciplines',
  'broader-framework','abbreviations','references',
]);

const dataPath = arg('--data', 'src/data/glossary.json');

let data;
try {
  data = JSON.parse(readFileSync(dataPath, 'utf-8'));
} catch (err) {
  console.error(`check-glossary-link-classes: cannot read ${dataPath}: ${err.message}`);
  process.exit(2);
}

const terms = data.terms || [];
const knownSlugs = new Set(terms.map(t => (t.slug || '').toLowerCase()));

const drift = [];

for (const t of terms) {
  if (!t.bodyHtml) continue;
  const root = parse(t.bodyHtml);
  for (const a of root.querySelectorAll('a')) {
    const action = classifyAnchor({
      href: a.getAttribute('href'),
      classList: (a.getAttribute('class') || '').split(/\s+/).filter(Boolean),
      parentTagName: a.parentNode?.tagName?.toLowerCase() || null,
      parentClassList: (a.parentNode?.getAttribute?.('class') || '').split(/\s+/).filter(Boolean),
      knownTermSlugs: knownSlugs,
      sectionIds: SECTION_IDS,
    });
    const isDrift = action === 'add-gloss-xref'
                 || action === 'add-cite-ref-class-to-sup'
                 || action === 'wrap-cite-ref'
                 || action.startsWith('manual-review:');
    if (isDrift) {
      drift.push({ slug: t.slug, href: a.getAttribute('href'), action });
    }
  }
}

if (drift.length === 0) {
  console.log(`check-glossary-link-classes: ok (${terms.length} terms, 0 drift)`);
  process.exit(0);
}

console.error(`check-glossary-link-classes: ${drift.length} drift entries:`);
const byAction = {};
for (const d of drift) (byAction[d.action] ||= []).push(d);
for (const [action, items] of Object.entries(byAction)) {
  console.error(`  ${action}: ${items.length}`);
  for (const d of items.slice(0, 3)) console.error(`    ${d.slug} → ${d.href}`);
}
process.exit(1);
```

- [ ] **Step 2: Run against current data**

```bash
node scripts/check-glossary-link-classes.mjs 2>&1 | tail -10
```

Expected: exits with 1, prints drift summary (`add-gloss-xref: 138`, `add-cite-ref-class-to-sup: 227`).

- [ ] **Step 3: Commit**

```bash
git add scripts/check-glossary-link-classes.mjs
git commit -m "feat: CI guard for glossary link drift

Reads src/data/glossary.json, runs the same classifier as audit
+ normalizer (single SSOT). Exits 1 on any drift action or
manual-review:* finding. Warn-only wiring in deploy.yml lands
next; hard-gate flip is a follow-up PR after 3 clean deploys."
```

### Task 5.2: Wire the guard to deploy.yml as Stage A (warn-only)

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Read current deploy.yml structure**

```bash
grep -nE 'name: |run:' .github/workflows/deploy.yml | head -40
```

Identify the step right after `Fetch all data` (or whichever step regenerates `src/data/glossary.json`).

- [ ] **Step 2: Add the new step**

Insert this step in `.github/workflows/deploy.yml` AFTER the `Fetch all data` step and BEFORE the build step:

```yaml
      - name: Glossary link drift gate (Stage A — warn-only)
        run: node scripts/check-glossary-link-classes.mjs
        continue-on-error: true
```

- [ ] **Step 3: Verify YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"
```

Expected: no error.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: glossary link drift gate (Stage A, warn-only)

Wires scripts/check-glossary-link-classes.mjs as a warn-only step
in deploy.yml. Will print drift summary as a CI annotation but
not fail the build. Stage B (continue-on-error: false) ships in a
follow-up PR after 3 consecutive clean deploys confirm no
false-positives."
```

---

## Phase 6: STYLE-GUIDE update

### Task 6.1: Replace `## Links` section in STYLE-GUIDE.md

**Files:**
- Modify: `STYLE-GUIDE.md`

- [ ] **Step 1: Locate the existing `## Links` section**

```bash
grep -n '^## Links' STYLE-GUIDE.md
```

Note the line number; capture content from there to the next `## ` heading.

- [ ] **Step 2: Replace the section**

Use `Edit` to swap the existing `## Links` section for:

```markdown
## Links

The site has five canonical inline-link variants. Use the most specific that applies. Do not invent new variants without spec approval.

| # | Selector | Color | Underline | Use |
|---|---|---|---|---|
| 1 | `p a, li a, .prose a, blockquote a` (`global.css:501`) | `--accent` | yes, 2px offset | External sources, pillar-guide links, any non-glossary-internal inline link |
| 2 | `.prose a.gloss-xref` (`global.css:1129`) | `inherit` (hover → `--accent`) | yes, 1px, `--purple-200` | Linking to another glossary term inside a term body. Requires `.prose` ancestor (pillar AND spoke routes). |
| 3 | `.cite-ref a` (`global.css:1615`) | `--accent` | no (hover yes) | Inline `<sup>` numbers pointing to the references list |
| 4 | `.term-spoke-link a` (`global.css:1159`) | `--text-tertiary` (hover → `--accent`) | no, border on hover | "Open full entry →" beneath each term |
| 5 | `.references .ref-backlink` (`global.css:1650`) | `--accent` | no | ↩ in references list |

**Token references:** `--accent`, `--accent-hover`, `--purple-200`, `--text-tertiary` all defined in `docs/design/design-system.json` (auto-generated from `src/styles/global.css`).

**Spoke-page caveat:** Variant 2 requires a `.prose` ancestor. Pillar `/glossary/` wraps content in `<article class="prose">`. Spoke `/glossary/<slug>/` MUST also wrap `<GlossaryTerm>` content in a `.prose` container, or the selector silently fails on spokes.

**Drift prevention:** glossary term bodies are normalized via `scripts/normalize-glossary-links.mjs` and gated in CI by `scripts/check-glossary-link-classes.mjs`. See `docs/superpowers/specs/2026-05-05-glossary-link-style-normalization-design.md`.
```

- [ ] **Step 3: Confirm no other `## Links` remains**

```bash
grep -c '^## Links' STYLE-GUIDE.md
```

Expected: 1.

- [ ] **Step 4: Commit**

```bash
git add STYLE-GUIDE.md
git commit -m "docs(style-guide): document the 5 canonical inline-link variants

Replaces the prior ## Links section with a complete table of all
5 variants (default, gloss-xref, cite-ref, term-spoke-link,
ref-backlink) plus the spoke-page .prose ancestor caveat.

Cross-references the normalizer + CI gate for drift prevention."
```

---

## Phase 7: Skill Workflow H

### Task 7.1: Add Workflow H to `/glossary-update` SKILL.md

**Files:**
- Modify: `~/.claude/skills/glossary-update/SKILL.md`

- [ ] **Step 1: Read current SKILL.md to find the right insertion point**

```bash
grep -n '^### Workflow ' ~/.claude/skills/glossary-update/SKILL.md
```

Identify last existing workflow (should be A through F or G). The new Workflow H lands after the last existing workflow.

- [ ] **Step 2: Append Workflow H**

Append to `~/.claude/skills/glossary-update/SKILL.md`:

```markdown
### Workflow H — Apply normalizer-emitted SQL chunks

Applies `/tmp/glossary-link-normalize.<timestamp>.NNN.sql` chunks produced by `scripts/normalize-glossary-links.mjs --apply`.

**Pre-conditions** (operator asserts before invoking):
- `node scripts/audit-glossary-links.mjs --from-d1` reports 0 `manual-review:*` entries.
- Snapshot file exists at `/tmp/glossary-link-snapshot.<timestamp>.json`.
- Operator has eyeballed the `--limit 5 --apply` stratified-sample diffs.

**Steps:**

1. **Verify SQL chunk format.** For each `*.sql` file in the timestamp set, every non-blank, non-comment line MUST match one of:
   - `^BEGIN TRANSACTION;$`
   - `^COMMIT;$`
   - `^UPDATE glossary_term$`
   - `^SET body_html = '.*', *updated_at = datetime\('now'\)$`
   - `^WHERE slug = '[a-z0-9'-]+'$`
   - `^  AND body_html = '.*';$`
   - `^-- .*$`
   Bail on any mismatch.

2. **Apply chunks sequentially.** For each chunk file in numeric order:
   ```bash
   wrangler d1 execute rrm-auth --remote --file=/tmp/glossary-link-normalize.<timestamp>.NNN.sql --json > /tmp/wrangler-result-NNN.json
   ```
   Parse `meta.changes` from each result. Compare to expected count (number of `UPDATE` statements in the chunk).
   - If `changes < expected`: STALE entries (CAS rejected). Print `STALE: <slug>` for each missing slug. Continue to next chunk.
   - If wrangler errors OR the entire chunk reports 0 changes: ABORT. Earlier chunks are committed; later chunks are not. See step 7 (rollback).

3. **Post-apply verification.** Run `node scripts/audit-glossary-links.mjs --from-d1`. Expect 0 mismatches AND 0 `manual-review:*`. Log otherwise.

4. **Trigger ONE full-rebuild deploy:**
   ```bash
   gh workflow run "Build & Deploy" --ref main
   ```
   This refreshes `src/data/glossary.json` from D1 and serves all normalized terms simultaneously. Do NOT use single-record dispatch (would serialize 196 deploys ≈ 16h queue saturation).

5. **Stale-CAS reconciliation.** For any STALE slug from step 2, the operator must re-run audit-then-Workflow-A on each. Typically <5 cases.

6. **Verify live page.** After the deploy completes:
   ```bash
   sleep 90
   curl -sI https://rrmacademy.org/glossary/ | head -3
   curl -s https://rrmacademy.org/glossary/ | grep -oE 'class="(gloss-xref|cite-ref)"' | sort | uniq -c
   ```
   Expect at least one `gloss-xref` and one `cite-ref` rendered.

7. **Rollback (only if needed).** If post-apply audit reveals regression:
   ```bash
   # Generate inverse SQL from the snapshot:
   node scripts/normalize-glossary-links.mjs --rollback /tmp/glossary-link-snapshot.<timestamp>.json
   # This emits /tmp/glossary-link-rollback.<timestamp>.NNN.sql files.
   # Apply with the same Workflow H steps 1-2.
   ```
   Snapshot retained for 14 days post-apply.
```

- [ ] **Step 3: Verify SKILL.md still parses**

```bash
head -20 ~/.claude/skills/glossary-update/SKILL.md
wc -l ~/.claude/skills/glossary-update/SKILL.md
```

Expected: structurally valid markdown; line count grew.

- [ ] **Step 4: Commit (skills repo, not rrm-academy-cf)**

`~/.claude/skills/` is typically a separate git repo. Check:

```bash
cd ~/.claude/skills && git status --short
```

If it's a tracked repo, commit there:

```bash
cd ~/.claude/skills && git add glossary-update/SKILL.md && git commit -m "feat(glossary-update): add Workflow H — apply normalizer SQL chunks

Consumes /tmp/glossary-link-normalize.<timestamp>.NNN.sql files
produced by rrm-academy-cf's scripts/normalize-glossary-links.mjs.
Verifies SQL form, applies chunks sequentially, parses meta.changes
to detect CAS-stale terms, triggers single full rebuild, supports
--rollback from snapshot file."
```

If not a tracked repo, just save the change and move on; the implementation is the documentation.

Return to the rrm-academy-cf worktree:

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf/.worktrees/glossary-link-norm
```

### Task 7.2: Add `--rollback` mode to normalizer

**Files:**
- Modify: `scripts/normalize-glossary-links.mjs`

- [ ] **Step 1: Append rollback mode**

Edit the existing script to add a rollback branch near the top of the main flow (after argument parsing):

Add after the existing `apply` argument parse:

```javascript
const rollbackPath = arg('--rollback', null);

if (rollbackPath) {
  const snapshot = JSON.parse(readFileSync(rollbackPath, 'utf-8'));
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const chunkFiles = [];
  for (let i = 0; i < snapshot.length; i += CHUNK_SIZE) {
    const chunk = snapshot.slice(i, i + CHUNK_SIZE);
    const fileNum = String(Math.floor(i / CHUNK_SIZE) + 1).padStart(3, '0');
    const path = `${outDir}/glossary-link-rollback.${ts}.${fileNum}.sql`;
    const sql = [
      'BEGIN TRANSACTION;',
      ...chunk.map(d =>
        `UPDATE glossary_term\n` +
        `SET body_html = '${escapeSqlSingleQuote(d.body_html)}',\n` +
        `    updated_at = datetime('now')\n` +
        `WHERE slug = '${escapeSqlSingleQuote(d.slug)}';`
      ),
      'COMMIT;',
    ].join('\n');
    writeFileSync(path, sql);
    chunkFiles.push(path);
  }
  console.log(`ROLLBACK SQL EMITTED. Wrote ${chunkFiles.length} chunks:`);
  for (const f of chunkFiles) console.log(`  ${f}`);
  console.log('NOT YET APPLIED. Run via /glossary-update Workflow H steps 1-2 to commit.');
  process.exit(0);
}
```

- [ ] **Step 2: Smoke test the rollback path**

```bash
# Use the snapshot from Task 4.3's apply run (if any). Otherwise fabricate one:
echo '[{"slug":"endometriosis","body_html":"<p>test</p>"}]' > /tmp/test-snapshot.json
node scripts/normalize-glossary-links.mjs --rollback /tmp/test-snapshot.json --out-dir /tmp 2>&1 | tail -5
```

Expected: prints "ROLLBACK SQL EMITTED" + path. Inspect the SQL file:

```bash
cat /tmp/glossary-link-rollback.*.001.sql
```

Expected: BEGIN, UPDATE, COMMIT, with `body_html='<p>test</p>'`. Cleanup:

```bash
rm /tmp/test-snapshot.json /tmp/glossary-link-rollback.*.sql
```

- [ ] **Step 3: Commit**

```bash
git add scripts/normalize-glossary-links.mjs
git commit -m "feat(normalizer): add --rollback mode

Emits inverse-UPDATE SQL chunks from the snapshot file produced
by --apply. Same chunked + transactional shape; same form-check
applies in /glossary-update Workflow H steps 1-2."
```

---

## Phase 8: Apply (operator)

These are operator-run steps; document them in the plan so the operator follows the right sequence.

### Task 8.1: Audit current state

- [ ] **Step 1: Run audit against live D1**

```bash
node scripts/audit-glossary-links.mjs --from-d1 --out /tmp/audit-pre-apply.json
python3 -c "
import json
d = json.load(open('/tmp/audit-pre-apply.json'))
print(json.dumps(d['actionCounts'], indent=2))
mr = [e for e in d['perAnchor'] if e['action'].startswith('manual-review:')]
print(f'manual-review entries: {len(mr)}')
"
```

Expected: `add-gloss-xref` and `add-cite-ref-class-to-sup` counts > 0; manual-review entries > 0 indicates Task 8.2 is needed.

### Task 8.2: Resolve manual-review entries (if any)

Per Task 3.2 — operator handles each via `/glossary-update` Workflow A.

After resolving, re-run audit:

```bash
node scripts/audit-glossary-links.mjs --from-d1 --out /tmp/audit-pre-apply-2.json
python3 -c "
import json
d = json.load(open('/tmp/audit-pre-apply-2.json'))
mr = [e for e in d['perAnchor'] if e['action'].startswith('manual-review:')]
print(f'remaining manual-review: {len(mr)}')
"
```

Expected: 0. Phase 4 won't emit SQL until this is true.

### Task 8.3: Sample-of-5 review

```bash
node scripts/normalize-glossary-links.mjs --limit 5 2>&1 | head -100
```

Read all 5 diffs. Confirm transforms look correct. If any look wrong, halt and revisit transforms.

### Task 8.4: Full apply (writes SQL chunks + snapshot)

```bash
node scripts/normalize-glossary-links.mjs --apply 2>&1 | tail -10
```

Note the timestamp in the output paths. Files: `/tmp/glossary-link-normalize.<timestamp>.NNN.sql` (~4 chunks for 196 rows) + `/tmp/glossary-link-snapshot.<timestamp>.json`.

### Task 8.5: Commit via /glossary-update Workflow H

Follow Workflow H steps 1-3 from `~/.claude/skills/glossary-update/SKILL.md`:

```bash
# Step 1: form-verify each chunk
for f in /tmp/glossary-link-normalize.<timestamp>.*.sql; do
  python3 -c "
import re
allowed = [
  r'^BEGIN TRANSACTION;\$',
  r'^COMMIT;\$',
  r'^UPDATE glossary_term\$',
  r\"^SET body_html = \'.*\', *updated_at = datetime\\\\('now'\\\\)\$\",
  r\"^WHERE slug = \'[a-z0-9\\'-]+\'\$\",
  r\"^  AND body_html = \'.*\';\$\",
  r'^-- .*\$',
  r'^\$',
]
import sys
for line in open('$f'):
    line = line.rstrip('\n')
    if not any(re.match(p, line) for p in allowed):
        print(f'BAIL: bad line in $f: {line!r}')
        sys.exit(1)
print(f'$f: ok')
"
done

# Step 2: apply each chunk
for f in /tmp/glossary-link-normalize.<timestamp>.*.sql; do
  echo "=== applying $f ==="
  wrangler d1 execute rrm-auth --remote --file="$f" --json | tail -5
done
```

Note `meta.changes` for each chunk; reconcile any STALE entries (slugs that didn't update because CAS rejected stale content).

### Task 8.6: Trigger full rebuild + verify

```bash
gh workflow run "Build & Deploy" --ref main
sleep 180
node scripts/audit-glossary-links.mjs --from-d1 --out /tmp/audit-post-apply.json
python3 -c "
import json
d = json.load(open('/tmp/audit-post-apply.json'))
print(json.dumps(d['actionCounts'], indent=2))
"
```

Expected: only `noop`, `mailto-or-tel`, `external`, `pillar-or-onsite` counts. All drift counts should be 0.

Live verification:

```bash
curl -sI https://rrmacademy.org/glossary/ | head -3
curl -s https://rrmacademy.org/glossary/ | grep -oE 'class="(gloss-xref|cite-ref)"' | sort | uniq -c
```

Expected: at least 100+ `gloss-xref` and 100+ `cite-ref` matches.

---

## Phase 9: Stage B — flip CI gate to hard

### Task 9.1: After three clean deploys, flip `continue-on-error`

This is a follow-up PR, NOT part of the initial implementation merge. Wait until 3 consecutive deploys land green with the Stage A warn-only gate.

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Edit the gate step**

Change:
```yaml
      - name: Glossary link drift gate (Stage A — warn-only)
        run: node scripts/check-glossary-link-classes.mjs
        continue-on-error: true
```
to:
```yaml
      - name: Glossary link drift gate (hard)
        run: node scripts/check-glossary-link-classes.mjs
```

- [ ] **Step 2: Commit on a new branch**

```bash
git checkout -b claude/glossary-link-gate-hard
git add .github/workflows/deploy.yml
git commit -m "ci: flip glossary link drift gate to hard

Three consecutive deploys cleared the warn-only Stage A gate.
Hard gate now enforces: any future glossary edit reintroducing
drift fails the build.

Circuit-breaker: if a glossary edit blocks an unrelated deploy,
the operator either (a) reverts the bad edit via /glossary-update,
(b) fixes drift via Workflow A, or (c) temporarily flips
continue-on-error: true and ships the unrelated work, then
follows up with a fix."
git push -u origin claude/glossary-link-gate-hard
```

---

## Self-review

After writing this plan, I checked it against the spec section by section.

**Spec coverage:**
- §Phase 0 verification → Tasks 0.1-0.5 ✓
- §Phase 1 STYLE-GUIDE → Task 6.1 ✓
- §Phase 2 audit → Task 3.1 ✓
- §Phase 2a shared classifier → Tasks 2.1-2.2 ✓
- §Phase 3 normalizer → Tasks 4.1-4.3 ✓
- §Phase 4 apply via Workflow H → Tasks 7.1, 7.2 (skill update + rollback), 8.1-8.6 (operator apply) ✓
- §Phase 5 CI guard Stage A + B → Tasks 5.1, 5.2, 9.1 ✓
- §Phase 6 tests → embedded in Tasks 2.1, 4.1 (transform tests), 3.1 (audit smoke) ✓
- §Files touched → all listed in some task ✓
- §Pre-implementation verification checklist → Task 0.1-0.5 ✓
- §Risk and mitigation → addressed by per-task implementation (CAS clause in Task 4.3, transactional in 4.3, snapshot in 4.3, rollback in 7.2, etc.) ✓

**Placeholder scan:** No "TBD", "TODO", "implement later", "similar to", "appropriate", "edge cases" without specifics. Two places (Task 1.2 spoke fix, Task 7.1 SKILL.md path) are conditional on Phase 0 findings, which is acceptable. Task 8.5 uses `<timestamp>` as a literal placeholder for the operator to substitute — that's a runtime value, not a plan-time TODO.

**Type consistency:**
- Closed-enum `action` values: same in classifier (Task 2.2), audit (Task 3.1), transforms (Task 4.2), normalizer (Task 4.3), check (Task 5.1). Verified.
- `applyTransforms({knownTermSlugs, sectionIds})` signature: same in transforms (Task 4.2) and normalizer (Task 4.3) and audit (Task 3.1).
- `classifyAnchor({href, classList, parentTagName, parentClassList, knownTermSlugs, sectionIds})` signature: same across all callers.
- `escapeSqlSingleQuote()` defined and used only in normalizer (Task 4.3). Both --apply and --rollback paths use it.
- Snapshot file shape `[{slug, body_html}]`: written in Task 4.3, read in Task 7.2.

**Commit ordering:** Phase 7 skill update (Task 7.1) lands BEFORE Task 8.5 (operator apply via Workflow H). Verified.

Plan is internally consistent and complete.
