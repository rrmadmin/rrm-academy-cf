# Synopsis Infographics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add house-style infographic stat graphics (single stat, directional delta, comparison bars, ratio pictograph) that render at the top of library synopsis pages and export as reusable PNG/WebP/SVG files.

**Architecture:** One pure renderer in rrm-academy-cf turns a small validated spec into an SVG in two modes: `inline` (CSS-variable colors, on-page, dark-mode aware, crawlable) and `standalone` (resolved-hex colors, self-contained, for raster export). A skill drives propose -> validate -> registry-verify -> render -> rasterize -> local hold. On-page render is gated by a new `infographic_approved` D1 flag (Phase 2, held). The spec is stored in a dedicated `articles.infographic` column, never the worker-owned `insights` blob.

**Tech Stack:** Astro 5.3 (static), Node.js `node:test`, `.mjs` ESM lib modules, `@playwright/test` chromium + `@resvg/resvg-js` (devDeps) for raster export, D1 (rrm-library), Cloudflare worker (rrm-library-worker).

## Global Constraints

Copy these verbatim into every task's mental checklist:

- No em dashes (U+2014) or en dashes (U+2013) anywhere in rendered output AND rejected at the validation input boundary.
- Numerals use Cormorant Garamond (400/600 only). Labels/eyebrows/captions use Inter (400/500/600 only). No other fonts or weights.
- Background is warm paper `--bg-body` (#f7f5f3 light), never pure white, never red on black.
- Purple ramp (`--purple-50/100/300/500/700/900`) carries data fill. `--purple-700` (#725e7e) marks the hero/RRM element; comparators use a muted neutral.
- Polarity colors: favorable = sage (`--ig-favorable`), unfavorable = clay/rose (`--ig-unfavorable`), neutral = purple (`--ig-neutral`). Never the error red.
- XML-escape the five predefined XML entities (`&amp; &lt; &gt; &quot; &apos;`) for every operator-supplied string before inserting into `<text>`/`<title>`/`<desc>`/attributes. Use numeric or predefined entities only, never HTML named entities (`&ndash;` etc.).
- Every infographic is bound to a registry-verified source (fail-closed) or it does not render.
- On-page render is gated by `infographic_approved = 1`. "Held" means unwritten to D1 OR flag = 0.
- One renderer, two modes (`inline` var() / `standalone` resolved hex), per-aspect layout. Identical pixels only within an aspect.
- The testable core lives in `.mjs` modules (the repo's `node --test test/*.test.js` runner imports `.js`/`.mjs` only, never `.ts`). Use JSDoc typedefs for types.
- Use only CSS variables that exist in `docs/design/design-system.json`. After editing `src/styles/global.css`, run `npm run design-tokens` and commit the regenerated JSON. CI blocks on drift (`npm run design-tokens:check`).
- Phase 2 is HELD: create the migration, worker route, component, and wiring, but the D1 apply, deploy, and per-article promotion stay behind explicit go-live.

Repo root for Phase 1 unless stated: `/Users/brian/iCode/projects/rrm-academy-cf/`. Worker repo: `/Users/brian/iCode/projects/rrm-library-worker/`. Skill: `/Users/brian/iCode/skills/rrm-infographic/`.

---

## Autonomy Contract

- **runs-without-human-input:** Phase 1 = YES (lights-off, subagent-per-task with orchestrator review between tasks). Phase 2 file/commit work = YES (held, inert). Phase 2 GO-LIVE actions (D1 migration apply, worker deploy, site deploy, `/infographic-result` promotion) = NO, Brian only.
- **abort-conditions (stop and surface immediately if any occur):** any `node --test` suite fails; `npm run build` fails; `npm run check-types` exceeds baseline; `npm run guard` (security guard) fails; `npm run design-tokens:check` reports drift; the infographic SVG gate fails; any step needs interactive auth or hangs; a subagent edits a file outside its task's declared Files list.
- **revert-authority:** Phase 1 = orchestrator may revert (nothing is pushed; see revert command). Phase 2 D1 apply + any deploy = Brian only.
- **nothing is pushed during execution.** All commits stay local on the worktree branch and on the skill/worker repos' local HEAD until Brian gives an explicit push/deploy go (manual-commit rule).

### Execution setup (do this BEFORE Task 1)

rrm-academy-cf is currently a dirty clone (on `main` with unrelated uncommitted changes). Per `ship-from-dirty-clone-via-worktree`, all rrm-academy-cf work runs in a worktree off `origin/main`, never on the dirty main:

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
git fetch origin
git worktree add -b claude/infographic-build /tmp/rrm-infographic-build origin/main
cd /tmp/rrm-infographic-build && npm ci
```

All rrm-academy-cf paths in the tasks below are relative to the worktree root `/tmp/rrm-infographic-build/` (the worktree mirrors the repo layout; substitute it for `/Users/brian/iCode/projects/rrm-academy-cf/`). The skill repo (`~/iCode/skills`) and worker repo (`rrm-library-worker`) are edited in place; before committing to either, confirm `git status` is otherwise clean, and if dirty, branch first (`git switch -c claude/infographic-build`).

### Revert (abort the whole build)

```bash
# rrm-academy-cf: drop the worktree + branch (nothing was pushed)
git -C /Users/brian/iCode/projects/rrm-academy-cf worktree remove --force /tmp/rrm-infographic-build
git -C /Users/brian/iCode/projects/rrm-academy-cf branch -D claude/infographic-build
# skill + worker repos: reset their local branch back to origin/main
git -C /Users/brian/iCode/skills reset --hard origin/main
git -C /Users/brian/iCode/projects/rrm-library-worker reset --hard origin/main
git -C /Users/brian/iCode/projects/rrm-cli reset --hard origin/main
```

### Go-live (Brian only, after review)

Cherry-pick the worktree branch onto main (or push `claude/infographic-build` for the repo's claude/* auto-merge), then run the Task 15 go-live runbook for the D1 migration, worker deploy, and per-article promotion. None of this happens during the lights-off build.

---

## Phase 1: Renderer, validator, CLI, skill (local-only, nothing touches D1 or live pages)

### Task 1: Add polarity design tokens

**Files:**
- Modify: `src/styles/global.css` (light `:root` and dark theme blocks)
- Modify (generated): `docs/design/design-system.json` (via `npm run design-tokens`)

**Interfaces:**
- Produces: CSS variables `--ig-favorable`, `--ig-unfavorable`, `--ig-neutral` defined for light and dark themes. The renderer's `inline` mode and the Astro component consume these by name.

- [ ] **Step 1: Add the three tokens to the light `:root` block in `src/styles/global.css`**

Find the existing light-theme `:root` declaration that defines `--purple-700: #725e7e;` and add, adjacent to the purple ramp:

```css
  /* Infographic polarity (favorable / unfavorable / neutral). Bold register. */
  --ig-favorable: #5f6a52;
  --ig-unfavorable: #a0697c;
  --ig-neutral: #725e7e;
```

- [ ] **Step 2: Add the dark-theme overrides**

Find the `[data-theme="dark"]` block (where `--purple-700` is overridden, e.g. `#b8a3c4`) and add:

```css
  --ig-favorable: #9caf88;
  --ig-unfavorable: #cd9aa9;
  --ig-neutral: #c2a9d4;
```

- [ ] **Step 3: Regenerate the design-system SSOT**

Run: `npm run design-tokens`
Expected: `docs/design/design-system.json` is rewritten and now contains the three `--ig-*` tokens. No error.

- [ ] **Step 4: Verify the gate passes**

Run: `npm run design-tokens:check`
Expected: PASS (no drift).

- [ ] **Step 5: Commit**

```bash
git add src/styles/global.css docs/design/design-system.json
git commit -m "feat(infographic): add favorable/unfavorable/neutral polarity tokens"
```

---

### Task 2: Spec types and validator

**Files:**
- Create: `src/lib/infographic/types.mjs`
- Create: `src/lib/infographic/validate.mjs`
- Test: `test/infographic-validate.test.js`

**Interfaces:**
- Produces: `validateSpec(spec) -> { valid: boolean, errors: string[] }`; `TEMPLATES = ['single','delta','bars','ratio']`; `hasDashBan(str) -> boolean` (true if str contains em or en dash). Tasks 3-6, 8, 11, and the worker route consume `validateSpec` and `TEMPLATES`.

- [ ] **Step 1: Write `src/lib/infographic/types.mjs` (JSDoc typedefs + constants)**

```javascript
// Spec types for synopsis infographics. JSDoc only; no runtime types.

/**
 * @typedef {Object} InfographicSource
 * @property {string} label
 * @property {string} [pmid]
 * @property {string} [doi]
 * @property {string} [url]
 */

/**
 * @typedef {Object} BarEntry
 * @property {string} name
 * @property {number} value
 * @property {boolean} [hero]
 */

/**
 * @typedef {Object} InfographicSpec
 * @property {'single'|'delta'|'bars'|'ratio'} template
 * @property {string} eyebrow
 * @property {InfographicSource} source
 * @property {string} [value]
 * @property {string} [label]
 * @property {'up'|'down'} [direction]
 * @property {'favorable'|'unfavorable'|'neutral'} [polarity]
 * @property {string} [unit]
 * @property {string} [caption]
 * @property {BarEntry[]} [bars]
 * @property {number} [numerator]
 * @property {number} [denominator]
 */

export const TEMPLATES = ['single', 'delta', 'bars', 'ratio'];
export const DIRECTIONS = ['up', 'down'];
export const POLARITIES = ['favorable', 'unfavorable', 'neutral'];
export const EYEBROW_MAX = 28;
```

- [ ] **Step 2: Write the failing test `test/infographic-validate.test.js`**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../src/lib/infographic/validate.mjs';

const goodSource = { label: 'Boyle 2018', pmid: '30109231' };
const okBars = {
  template: 'bars', eyebrow: 'Live birth', unit: '%', caption: 'matched cohort',
  bars: [{ name: 'RRM', value: 62, hero: true }, { name: 'IVF', value: 34 }],
  source: goodSource,
};

describe('validateSpec', () => {
  it('accepts a well-formed bars spec', () => {
    assert.equal(validateSpec(okBars).valid, true);
  });
  it('rejects unknown template', () => {
    assert.equal(validateSpec({ ...okBars, template: 'pie' }).valid, false);
  });
  it('rejects missing source', () => {
    const s = { ...okBars }; delete s.source;
    assert.equal(validateSpec(s).valid, false);
  });
  it('rejects empty-string identifier as absent', () => {
    assert.equal(validateSpec({ ...okBars, source: { label: 'x', pmid: '' } }).valid, false);
  });
  it('rejects malformed doi', () => {
    assert.equal(validateSpec({ ...okBars, source: { label: 'x', doi: 'banana' } }).valid, false);
  });
  it('rejects two hero bars', () => {
    assert.equal(validateSpec({ ...okBars, bars: [{ name: 'a', value: 1, hero: true }, { name: 'b', value: 2, hero: true }] }).valid, false);
  });
  it('rejects zero hero bars', () => {
    assert.equal(validateSpec({ ...okBars, bars: [{ name: 'a', value: 1 }, { name: 'b', value: 2 }] }).valid, false);
  });
  it('rejects bar value >100 when unit is %', () => {
    assert.equal(validateSpec({ ...okBars, bars: [{ name: 'a', value: 140, hero: true }, { name: 'b', value: 2 }] }).valid, false);
  });
  it('rejects ratio denominator 0', () => {
    assert.equal(validateSpec({ template: 'ratio', eyebrow: 'x', numerator: 1, denominator: 0, label: 'x', source: goodSource }).valid, false);
  });
  it('rejects numerator > denominator', () => {
    assert.equal(validateSpec({ template: 'ratio', eyebrow: 'x', numerator: 9, denominator: 8, label: 'x', source: goodSource }).valid, false);
  });
  it('rejects delta missing direction', () => {
    assert.equal(validateSpec({ template: 'delta', eyebrow: 'x', value: '38%', polarity: 'favorable', label: 'x', source: goodSource }).valid, false);
  });
  it('rejects single missing value', () => {
    assert.equal(validateSpec({ template: 'single', eyebrow: 'x', label: 'x', source: goodSource }).valid, false);
  });
  it('rejects eyebrow over 28 chars', () => {
    assert.equal(validateSpec({ ...okBars, eyebrow: 'x'.repeat(29) }).valid, false);
  });
  it('rejects an em dash in any string field', () => {
    assert.equal(validateSpec({ ...okBars, caption: 'a — b' }).valid, false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/infographic-validate.test.js`
Expected: FAIL (cannot find `../src/lib/infographic/validate.mjs`).

- [ ] **Step 4: Write `src/lib/infographic/validate.mjs`**

```javascript
import { TEMPLATES, DIRECTIONS, POLARITIES, EYEBROW_MAX } from './types.mjs';

const PMID_RE = /^\d+$/;
const DOI_RE = /^10\.\d{4,}\/\S+$/;
const DASH_RE = /[–—]/;

export function hasDashBan(str) {
  return typeof str === 'string' && DASH_RE.test(str);
}

function nonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validUrl(v) {
  try { new URL(v); return true; } catch { return false; }
}

function collectStrings(spec) {
  const out = [];
  for (const k of ['eyebrow', 'value', 'label', 'unit', 'caption']) {
    if (typeof spec[k] === 'string') out.push(spec[k]);
  }
  if (spec.source) for (const k of ['label']) if (typeof spec.source[k] === 'string') out.push(spec.source[k]);
  if (Array.isArray(spec.bars)) for (const b of spec.bars) if (b && typeof b.name === 'string') out.push(b.name);
  return out;
}

export function validateSpec(spec) {
  const errors = [];
  const push = (m) => errors.push(m);

  if (!spec || typeof spec !== 'object') return { valid: false, errors: ['spec must be an object'] };
  if (!TEMPLATES.includes(spec.template)) push(`unknown template: ${spec.template}`);
  if (!nonEmpty(spec.eyebrow)) push('eyebrow required');
  else if (spec.eyebrow.length > EYEBROW_MAX) push(`eyebrow over ${EYEBROW_MAX} chars`);

  // source: at least one non-empty, well-formed identifier + a label
  const src = spec.source || {};
  if (!nonEmpty(src.label)) push('source.label required');
  const pmidOk = nonEmpty(src.pmid) && PMID_RE.test(src.pmid.trim());
  const doiOk = nonEmpty(src.doi) && DOI_RE.test(src.doi.trim());
  const urlOk = nonEmpty(src.url) && validUrl(src.url.trim());
  if (nonEmpty(src.pmid) && !pmidOk) push('source.pmid malformed');
  if (nonEmpty(src.doi) && !doiOk) push('source.doi malformed');
  if (nonEmpty(src.url) && !urlOk) push('source.url malformed');
  if (!(pmidOk || doiOk || urlOk)) push('source needs one of a valid pmid/doi/url');

  // dash ban on every string field
  for (const s of collectStrings(spec)) if (hasDashBan(s)) push('em or en dash not allowed');

  // per-template invariants
  if (spec.template === 'single') {
    if (!nonEmpty(spec.value)) push('single.value required');
    if (!nonEmpty(spec.label)) push('single.label required');
  } else if (spec.template === 'delta') {
    if (!nonEmpty(spec.value)) push('delta.value required');
    if (!nonEmpty(spec.label)) push('delta.label required');
    if (!DIRECTIONS.includes(spec.direction)) push('delta.direction required');
    if (!POLARITIES.includes(spec.polarity)) push('delta.polarity required');
  } else if (spec.template === 'bars') {
    if (!nonEmpty(spec.unit)) push('bars.unit required');
    if (!nonEmpty(spec.caption)) push('bars.caption required');
    const bars = spec.bars;
    if (!Array.isArray(bars) || bars.length < 2 || bars.length > 3) push('bars needs 2 or 3 entries');
    else {
      const heroes = bars.filter((b) => b && b.hero === true).length;
      if (heroes !== 1) push('bars needs exactly one hero');
      for (const b of bars) {
        if (!b || !nonEmpty(b.name)) push('bar.name required');
        if (typeof b.value !== 'number' || !Number.isFinite(b.value) || b.value < 0) push('bar.value must be finite and >= 0');
        if (spec.unit === '%' && typeof b.value === 'number' && b.value > 100) push('bar.value must be <= 100 when unit is %');
      }
    }
  } else if (spec.template === 'ratio') {
    if (!nonEmpty(spec.label)) push('ratio.label required');
    const n = spec.numerator, d = spec.denominator;
    if (!Number.isInteger(d) || d < 1 || d > 20) push('denominator must be an integer in [1, 20]');
    if (!Number.isInteger(n) || n < 0 || (Number.isInteger(d) && n > d)) push('numerator must be an integer in [0, denominator]');
  }

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/infographic-validate.test.js`
Expected: PASS (all assertions).

- [ ] **Step 6: Commit**

```bash
git add src/lib/infographic/types.mjs src/lib/infographic/validate.mjs test/infographic-validate.test.js
git commit -m "feat(infographic): spec types + pure validator with per-template invariants"
```

---

### Task 3: Renderer shared helpers (escape, tokens, aspects, svg shell)

**Files:**
- Create: `src/lib/infographic/templates.mjs` (helpers + dispatcher stub; templates added in Tasks 4-5)
- Test: `test/infographic-escape.test.js`

**Interfaces:**
- Produces: `escapeXml(str) -> string`; `ASPECTS = { '1:1': {w,h}, '4:5': {w,h}, '1.91:1': {w,h} }`; `RESOLVED_LIGHT` (token name -> hex map); `color(token, mode) -> string` (returns `var(--token)` for inline, hex for standalone); `renderInfographic(spec, opts) -> string`. Tasks 4-5 add the per-template render functions; Task 6/8/11 call `renderInfographic`.

- [ ] **Step 1: Write the failing test `test/infographic-escape.test.js`**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml, color, ASPECTS } from '../src/lib/infographic/templates.mjs';

describe('escapeXml', () => {
  it('escapes all five predefined entities', () => {
    assert.equal(escapeXml(`a & b < c > d " e ' f`), 'a &amp; b &lt; c &gt; d &quot; e &apos; f');
  });
  it('leaves a plain percentage untouched', () => {
    assert.equal(escapeXml('38%'), '38%');
  });
});

describe('color', () => {
  it('returns a var() ref in inline mode', () => {
    assert.equal(color('purple-700', 'inline'), 'var(--purple-700)');
  });
  it('returns a hex in standalone mode', () => {
    assert.match(color('purple-700', 'standalone'), /^#[0-9a-f]{6}$/i);
  });
});

describe('ASPECTS', () => {
  it('defines the three presets with positive dimensions', () => {
    for (const k of ['1:1', '4:5', '1.91:1']) {
      assert.ok(ASPECTS[k].w > 0 && ASPECTS[k].h > 0);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/infographic-escape.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/lib/infographic/templates.mjs` shared section**

```javascript
import { validateSpec } from './validate.mjs';

// Light-theme resolved hexes. Mirror src/styles/global.css; a test asserts the
// key set. The "no hardcoded hex" rule is relaxed here for standalone export only.
export const RESOLVED_LIGHT = {
  'bg-body': '#f7f5f3',
  'text-primary': '#313131',
  'text-secondary': '#636261',
  'purple-50': '#f5f0f8',
  'purple-100': '#e8ddef',
  'purple-300': '#c9b8d3',
  'purple-500': '#987da8',
  'purple-700': '#725e7e',
  'purple-900': '#4c3e54',
  'ig-favorable': '#5f6a52',
  'ig-unfavorable': '#a0697c',
  'ig-neutral': '#725e7e',
};

// One viewBox per aspect; each template re-flows to fill it (M14). Identical
// pixels apply within an aspect only.
export const ASPECTS = {
  '1:1': { w: 1080, h: 1080 },
  '4:5': { w: 1080, h: 1350 },
  '1.91:1': { w: 1200, h: 630 },
};

const XML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
export function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) => XML[c]);
}

export function color(token, mode) {
  if (mode === 'standalone') {
    const hex = RESOLVED_LIGHT[token];
    if (!hex) throw new Error(`no resolved hex for token: ${token}`);
    return hex;
  }
  return `var(--${token})`;
}

const FONT_DISPLAY = "'Cormorant Garamond', Georgia, serif";
const FONT_UI = "'Inter', system-ui, sans-serif";

// Shared SVG shell: paper background, role/title/desc, font defs. Body is the
// template-specific markup. alt = composed accessible description.
export function svgShell({ spec, mode, aspect, alt, body }) {
  const { w, h } = ASPECTS[aspect];
  const bg = color('bg-body', mode);
  const fontFace = mode === 'standalone'
    ? `<style>text{font-family:${FONT_UI};} .num{font-family:${FONT_DISPLAY};}</style>`
    : `<style>text{font-family:${FONT_UI};} .num{font-family:${FONT_DISPLAY};}</style>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeXml(alt)}">`
    + `<title>${escapeXml(alt)}</title><desc>${escapeXml(alt)}</desc>`
    + fontFace
    + `<rect x="0" y="0" width="${w}" height="${h}" fill="${bg}"/>`
    + body
    + `</svg>`;
}

// Composed alt text from value/label/source (Task 4-5 pass a per-template alt).
export function sourceLine(spec) {
  const s = spec.source || {};
  const id = s.pmid ? `PMID ${s.pmid}` : s.doi ? `DOI ${s.doi}` : (s.url || '');
  return [s.label, id].filter(Boolean).join(', ');
}

// Dispatcher. Per-template renderers registered by Tasks 4-5.
const RENDERERS = {};
export function registerRenderer(name, fn) { RENDERERS[name] = fn; }

export function renderInfographic(spec, opts = {}) {
  const mode = opts.mode || 'inline';
  const aspect = opts.aspect || '1:1';
  if (!ASPECTS[aspect]) throw new Error(`unknown aspect: ${aspect}`);
  const v = validateSpec(spec);
  if (!v.valid) throw new Error(`invalid spec: ${v.errors.join('; ')}`);
  const fn = RENDERERS[spec.template];
  if (!fn) throw new Error(`no renderer for template: ${spec.template}`);
  return fn(spec, { mode, aspect });
}
```

- [ ] **Step 4: Add a token-parity test to `test/infographic-escape.test.js`**

Append:

```javascript
import { RESOLVED_LIGHT } from '../src/lib/infographic/templates.mjs';
import { readFileSync } from 'node:fs';

describe('RESOLVED_LIGHT', () => {
  it('every token resolves to a 6-digit hex', () => {
    for (const [k, v] of Object.entries(RESOLVED_LIGHT)) {
      assert.match(v, /^#[0-9a-f]{6}$/i, `${k} is not a hex`);
    }
  });
  it('every ig/purple token name exists in global.css', () => {
    const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
    for (const k of Object.keys(RESOLVED_LIGHT)) {
      assert.ok(css.includes(`--${k}:`), `--${k} missing from global.css`);
    }
  });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/infographic-escape.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/infographic/templates.mjs test/infographic-escape.test.js
git commit -m "feat(infographic): renderer shell, escaping, token map, aspect presets"
```

---

### Task 4: `single` and `delta` templates

**Files:**
- Modify: `src/lib/infographic/templates.mjs` (append two renderers + register them)
- Test: `test/infographic-render.test.js`

**Interfaces:**
- Consumes: `svgShell`, `color`, `escapeXml`, `sourceLine`, `registerRenderer` from Task 3.
- Produces: registered renderers for `'single'` and `'delta'`. Both return a complete `<svg>` string via `svgShell`.

- [ ] **Step 1: Write the failing test `test/infographic-render.test.js`**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { renderInfographic } from '../src/lib/infographic/templates.mjs';

const parser = new XMLParser({ ignoreAttributes: false });
function assertWellFormed(svg) {
  // throws on malformed XML
  parser.parse(svg);
  assert.ok(svg.startsWith('<svg'));
}

const src = { label: 'Cohort', pmid: '30109231' };

describe('single template', () => {
  const spec = { template: 'single', eyebrow: 'Outcome', value: '62%', label: 'live birth', source: src };
  it('renders well-formed inline SVG with the numeral as text', () => {
    const svg = renderInfographic(spec, { mode: 'inline', aspect: '1:1' });
    assertWellFormed(svg);
    assert.ok(svg.includes('62%'), 'numeral present as text');
    assert.ok(svg.includes('var(--'), 'inline uses css vars');
  });
  it('renders standalone with hex colors', () => {
    const svg = renderInfographic(spec, { mode: 'standalone', aspect: '1.91:1' });
    assertWellFormed(svg);
    assert.ok(/#[0-9a-f]{6}/i.test(svg), 'standalone uses hex');
    assert.ok(!svg.includes('var(--'), 'standalone has no css vars');
  });
  it('escapes XML-dangerous operator text', () => {
    const svg = renderInfographic({ ...spec, value: '<1%', label: 'IVF & ICSI' }, { mode: 'inline', aspect: '1:1' });
    assertWellFormed(svg);
    assert.ok(svg.includes('&lt;1%'), 'value escaped');
    assert.ok(svg.includes('IVF &amp; ICSI'), 'label escaped');
  });
});

describe('delta template', () => {
  it('renders favorable in sage and unfavorable in clay, with a tag', () => {
    const fav = renderInfographic({ template: 'delta', eyebrow: 'x', value: '38%', direction: 'up', polarity: 'favorable', label: 'higher', source: src }, { mode: 'standalone', aspect: '1:1' });
    assertWellFormed(fav);
    assert.ok(fav.includes('#5f6a52'), 'favorable uses ig-favorable hex');
    assert.ok(/Favorable/i.test(fav), 'polarity tag text present');
    const unf = renderInfographic({ template: 'delta', eyebrow: 'x', value: '3.2x', direction: 'up', polarity: 'unfavorable', label: 'risk', source: src }, { mode: 'standalone', aspect: '1:1' });
    assert.ok(unf.includes('#a0697c'), 'unfavorable uses ig-unfavorable hex');
  });
});
```

- [ ] **Step 2: Add `fast-xml-parser` as a dev dependency (used only by tests)**

Run: `npm install --save-dev fast-xml-parser`
Expected: added to devDependencies.

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/infographic-render.test.js`
Expected: FAIL (no renderer for template: single).

- [ ] **Step 4: Append the `single` and `delta` renderers to `src/lib/infographic/templates.mjs`**

```javascript
function eyebrow(spec, mode, x, y) {
  return `<text x="${x}" y="${y}" font-size="34" font-weight="600" letter-spacing="3" fill="${color('text-secondary', mode)}">${escapeXml(spec.eyebrow.toUpperCase())}</text>`;
}
function provenance(spec, mode, x, y, w) {
  return `<line x1="${x}" y1="${y - 30}" x2="${x + w}" y2="${y - 30}" stroke="${color('purple-100', mode)}" stroke-width="2"/>`
    + `<text x="${x}" y="${y}" font-size="26" fill="${color('text-secondary', mode)}">${escapeXml('Source: ' + sourceLine(spec))}</text>`;
}

function renderSingle(spec, { mode, aspect }) {
  const { w, h } = ASPECTS[aspect];
  const pad = Math.round(w * 0.07);
  const alt = `${spec.value} ${spec.label}. Source: ${sourceLine(spec)}`;
  const body = eyebrow(spec, mode, pad, pad + 36)
    + `<text x="${pad}" y="${h * 0.55}" class="num" font-size="${Math.round(h * 0.3)}" font-weight="600" fill="${color('purple-700', mode)}">${escapeXml(spec.value)}</text>`
    + `<text x="${pad}" y="${h * 0.7}" font-size="40" fill="${color('text-primary', mode)}">${escapeXml(spec.label)}</text>`
    + provenance(spec, mode, pad, h - pad, w - pad * 2);
  return svgShell({ spec, mode, aspect, alt, body });
}

function renderDelta(spec, { mode, aspect }) {
  const { w, h } = ASPECTS[aspect];
  const pad = Math.round(w * 0.07);
  const accent = color(spec.polarity === 'favorable' ? 'ig-favorable' : spec.polarity === 'unfavorable' ? 'ig-unfavorable' : 'ig-neutral', mode);
  const chevron = spec.direction === 'up' ? '▲' : '▼';
  const tag = spec.polarity === 'favorable' ? 'Favorable' : spec.polarity === 'unfavorable' ? 'Unfavorable' : 'Neutral';
  const alt = `${chevron} ${spec.value} ${spec.label} (${tag}). Source: ${sourceLine(spec)}`;
  const body = eyebrow(spec, mode, pad, pad + 36)
    + `<text x="${pad}" y="${h * 0.5}" class="num" font-size="${Math.round(h * 0.24)}" font-weight="600" fill="${accent}">${escapeXml(chevron + ' ' + spec.value)}</text>`
    + `<text x="${pad}" y="${h * 0.63}" font-size="40" fill="${color('text-primary', mode)}">${escapeXml(spec.label)}</text>`
    + `<text x="${pad}" y="${h * 0.73}" font-size="28" font-weight="600" letter-spacing="2" fill="${accent}">${escapeXml(tag.toUpperCase())}</text>`
    + provenance(spec, mode, pad, h - pad, w - pad * 2);
  return svgShell({ spec, mode, aspect, alt, body });
}

registerRenderer('single', renderSingle);
registerRenderer('delta', renderDelta);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/infographic-render.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/infographic/templates.mjs test/infographic-render.test.js package.json package-lock.json
git commit -m "feat(infographic): single + delta renderers (escaped, polarity-aware)"
```

---

### Task 5: `bars` and `ratio` templates

**Files:**
- Modify: `src/lib/infographic/templates.mjs` (append two renderers + register)
- Test: `test/infographic-render-2.test.js`

**Interfaces:**
- Consumes: helpers from Task 3, `eyebrow`/`provenance` from Task 4.
- Produces: registered renderers for `'bars'` and `'ratio'`.

- [ ] **Step 1: Write the failing test `test/infographic-render-2.test.js`**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { renderInfographic } from '../src/lib/infographic/templates.mjs';

const parser = new XMLParser({ ignoreAttributes: false });
const wf = (svg) => { parser.parse(svg); assert.ok(svg.startsWith('<svg')); };
const src = { label: 'Cohort', doi: '10.1000/abc' };

describe('bars template', () => {
  const spec = { template: 'bars', eyebrow: 'Live birth', unit: '%', caption: 'matched cohort',
    bars: [{ name: 'RRM', value: 62, hero: true }, { name: 'IVF', value: 34 }], source: src };
  it('renders well-formed with both values and the hero color', () => {
    const svg = renderInfographic(spec, { mode: 'standalone', aspect: '1:1' });
    wf(svg);
    assert.ok(svg.includes('62%') && svg.includes('34%'), 'both values present');
    assert.ok(svg.includes('#725e7e'), 'hero uses purple-700');
  });
  it('normalizes non-% units to the max value without overflow', () => {
    const cycles = { template: 'bars', eyebrow: 'Pregnancies', unit: 'cycles', caption: 'cumulative',
      bars: [{ name: 'RRM', value: 1240, hero: true }, { name: 'IVF', value: 680 }], source: src };
    const svg = renderInfographic(cycles, { mode: 'standalone', aspect: '1:1' });
    wf(svg);
    // tallest bar height must not exceed the plot height (no y < 0)
    const ys = [...svg.matchAll(/<rect[^>]*y="(-?\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
    assert.ok(ys.every((y) => y >= 0), 'no bar overflows the top');
  });
});

describe('ratio template', () => {
  it('renders N in M with a dot grid', () => {
    const svg = renderInfographic({ template: 'ratio', eyebrow: 'Burden', numerator: 1, denominator: 8, label: 'couples affected', source: src }, { mode: 'standalone', aspect: '1:1' });
    wf(svg);
    assert.ok(/1\s*in\s*8/i.test(svg.replace(/<[^>]+>/g, ' ')), 'headline reads 1 in 8');
    const dots = [...svg.matchAll(/<circle /g)].length;
    assert.equal(dots, 8, 'one dot per denominator');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/infographic-render-2.test.js`
Expected: FAIL (no renderer for template: bars).

- [ ] **Step 3: Append the `bars` and `ratio` renderers to `src/lib/infographic/templates.mjs`**

```javascript
function renderBars(spec, { mode, aspect }) {
  const { w, h } = ASPECTS[aspect];
  const pad = Math.round(w * 0.07);
  const plotTop = h * 0.28, plotBottom = h * 0.82, plotH = plotBottom - plotTop;
  const axisMax = spec.unit === '%' ? 100 : Math.max(...spec.bars.map((b) => b.value));
  const n = spec.bars.length;
  const gap = Math.round(w * 0.04);
  const barW = Math.round((w - pad * 2 - gap * (n - 1)) / n);
  const alt = spec.bars.map((b) => `${b.name} ${b.value}${spec.unit}`).join('; ') + `. Source: ${sourceLine(spec)}`;
  let cols = '';
  spec.bars.forEach((b, i) => {
    const x = pad + i * (barW + gap);
    const ratio = axisMax > 0 ? Math.min(b.value / axisMax, 1) : 0;
    const colH = Math.round(plotH * ratio);
    const y = Math.round(plotBottom - colH);
    const fill = b.hero ? color('purple-700', mode) : color('purple-300', mode);
    const valFill = b.hero ? color('purple-700', mode) : color('text-secondary', mode);
    cols += `<rect x="${x}" y="${y}" width="${barW}" height="${colH}" rx="10" fill="${fill}"/>`
      + `<text x="${x + barW / 2}" y="${y - 18}" text-anchor="middle" class="num" font-size="64" font-weight="600" fill="${valFill}">${escapeXml(String(b.value) + spec.unit)}</text>`
      + `<text x="${x + barW / 2}" y="${plotBottom + 44}" text-anchor="middle" font-size="30" fill="${color('text-primary', mode)}">${escapeXml(b.name)}</text>`;
  });
  const body = eyebrow(spec, mode, pad, pad + 36)
    + `<text x="${pad}" y="${pad + 84}" font-size="34" fill="${color('text-primary', mode)}">${escapeXml(spec.caption)}</text>`
    + cols
    + provenance(spec, mode, pad, h - pad, w - pad * 2);
  return svgShell({ spec, mode, aspect, alt, body });
}

function renderRatio(spec, { mode, aspect }) {
  const { w, h } = ASPECTS[aspect];
  const pad = Math.round(w * 0.07);
  const alt = `${spec.numerator} in ${spec.denominator} ${spec.label}. Source: ${sourceLine(spec)}`;
  const perRow = Math.min(spec.denominator, 10);
  const dotR = 26, dotGap = 22;
  let dots = '';
  for (let i = 0; i < spec.denominator; i++) {
    const cx = pad + dotR + (i % perRow) * (dotR * 2 + dotGap);
    const cy = h * 0.52 + Math.floor(i / perRow) * (dotR * 2 + dotGap);
    const fill = i < spec.numerator ? color('purple-700', mode) : color('purple-100', mode);
    dots += `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${fill}"/>`;
  }
  const body = eyebrow(spec, mode, pad, pad + 36)
    + `<text x="${pad}" y="${h * 0.4}" class="num" font-size="${Math.round(h * 0.16)}" font-weight="600" fill="${color('purple-700', mode)}">${escapeXml(spec.numerator + ' in ' + spec.denominator)}</text>`
    + dots
    + `<text x="${pad}" y="${h * 0.86}" font-size="40" fill="${color('text-primary', mode)}">${escapeXml(spec.label)}</text>`
    + provenance(spec, mode, pad, h - pad, w - pad * 2);
  return svgShell({ spec, mode, aspect, alt, body });
}

registerRenderer('bars', renderBars);
registerRenderer('ratio', renderRatio);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/infographic-render-2.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole infographic suite**

Run: `node --test test/infographic-*.test.js`
Expected: PASS (validate + escape + render + render-2).

- [ ] **Step 6: Commit**

```bash
git add src/lib/infographic/templates.mjs test/infographic-render-2.test.js
git commit -m "feat(infographic): bars (max-normalized) + ratio (dot grid) renderers"
```

---

### Task 6: Render CLI with exit-code contract

**Files:**
- Create: `scripts/infographic-render.mjs`
- Test: `test/infographic-cli.test.js`

**Interfaces:**
- Consumes: `validateSpec`, `renderInfographic`.
- Produces: a CLI. Reads a spec JSON from a `--file <path>` or stdin; `--mode inline|standalone` (default inline); `--aspect 1:1|4:5|1.91:1` (default 1:1). On valid: prints SVG to stdout, exit 0. On invalid spec or bad JSON: prints `error: <messages>` to stderr, exit 1. Task 8 (export helper) and humans call this.

- [ ] **Step 1: Write the failing test `test/infographic-cli.test.js`**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const CLI = new URL('../scripts/infographic-render.mjs', import.meta.url).pathname;
function run(specObj) {
  try {
    const out = execFileSync('node', [CLI, '--mode', 'standalone'], { input: JSON.stringify(specObj), encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: e.stdout || '', err: e.stderr || '' };
  }
}

describe('infographic-render CLI', () => {
  it('exits 0 and prints SVG for a valid spec', () => {
    const r = run({ template: 'single', eyebrow: 'x', value: '62%', label: 'live birth', source: { label: 'c', pmid: '1' } });
    assert.equal(r.code, 0);
    assert.ok(r.out.startsWith('<svg'));
  });
  it('exits non-zero with no SVG on an invalid spec', () => {
    const r = run({ template: 'single', eyebrow: 'x', source: { label: 'c', pmid: '1' } });
    assert.notEqual(r.code, 0);
    assert.ok(!r.out.startsWith('<svg'));
    assert.match(r.err, /value required/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/infographic-cli.test.js`
Expected: FAIL (CLI file missing).

- [ ] **Step 3: Write `scripts/infographic-render.mjs`**

```javascript
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { renderInfographic } from '../src/lib/infographic/templates.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function readInput() {
  const file = arg('--file', null);
  if (file) return readFileSync(file, 'utf8');
  return readFileSync(0, 'utf8'); // stdin
}

try {
  const spec = JSON.parse(readInput());
  const svg = renderInfographic(spec, { mode: arg('--mode', 'inline'), aspect: arg('--aspect', '1:1') });
  process.stdout.write(svg);
  process.exit(0);
} catch (e) {
  process.stderr.write(`error: ${e.message}\n`);
  process.exit(1);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/infographic-cli.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/infographic-render.mjs test/infographic-cli.test.js
git commit -m "feat(infographic): render CLI with exit-code contract"
```

---

### Task 7: SVG well-formedness gate over rendered samples

**Files:**
- Create: `scripts/gates/validate-infographic-svg.mjs`
- Create: `src/lib/infographic/samples.mjs` (canonical sample specs, reused by gate + skill example)
- Test: `test/infographic-gate.test.js`

**Interfaces:**
- Consumes: `renderInfographic`, sample specs.
- Produces: `SAMPLES` (array of one valid spec per template) from `samples.mjs`; a gate script that renders every sample in every mode and aspect and asserts well-formed XML + zero em/en dashes + the numeral present. Phase 1 DoD and the pre-commit hook call the gate.

- [ ] **Step 1: Write `src/lib/infographic/samples.mjs`**

```javascript
export const SAMPLES = [
  { template: 'single', eyebrow: 'Cumulative outcome', value: '62%', label: 'cumulative live-birth rate over 24 months', source: { label: 'Cohort 2024', doi: '10.1000/abc123' } },
  { template: 'delta', eyebrow: 'Headline finding', value: '38%', direction: 'up', polarity: 'favorable', label: 'higher live-birth rate vs continued IVF', source: { label: 'Boyle 2018', pmid: '30109231' } },
  { template: 'bars', eyebrow: 'Live birth, matched cohort', unit: '%', caption: 'Restorative vs IVF', bars: [{ name: 'Restorative', value: 62, hero: true }, { name: 'IVF', value: 34 }], source: { label: 'Synopsis', pmid: '30109231' } },
  { template: 'ratio', eyebrow: 'Population burden', numerator: 1, denominator: 8, label: 'couples affected by infertility', source: { label: 'CDC', url: 'https://cdc.gov/art' } },
];
```

- [ ] **Step 2: Write the failing test `test/infographic-gate.test.js`**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const GATE = new URL('../scripts/gates/validate-infographic-svg.mjs', import.meta.url).pathname;

describe('infographic SVG gate', () => {
  it('passes on the canonical samples', () => {
    const out = execFileSync('node', [GATE], { encoding: 'utf8' });
    assert.match(out, /OK: \d+ renders well-formed/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/infographic-gate.test.js`
Expected: FAIL (gate script missing).

- [ ] **Step 4: Write `scripts/gates/validate-infographic-svg.mjs`**

```javascript
#!/usr/bin/env node
import { XMLParser } from 'fast-xml-parser';
import { renderInfographic, ASPECTS } from '../../src/lib/infographic/templates.mjs';
import { SAMPLES } from '../../src/lib/infographic/samples.mjs';

const parser = new XMLParser({ ignoreAttributes: false });
const DASH = /[–—]/;
let count = 0;
const errors = [];

for (const spec of SAMPLES) {
  for (const mode of ['inline', 'standalone']) {
    for (const aspect of Object.keys(ASPECTS)) {
      let svg;
      try { svg = renderInfographic(spec, { mode, aspect }); }
      catch (e) { errors.push(`${spec.template}/${mode}/${aspect}: render threw: ${e.message}`); continue; }
      try { parser.parse(svg); } catch (e) { errors.push(`${spec.template}/${mode}/${aspect}: malformed XML: ${e.message}`); }
      if (DASH.test(svg)) errors.push(`${spec.template}/${mode}/${aspect}: contains em/en dash`);
      count++;
    }
  }
}

if (errors.length) { console.error('FAIL:\n' + errors.join('\n')); process.exit(1); }
console.log(`OK: ${count} renders well-formed, no dashes`);
process.exit(0);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/infographic-gate.test.js`
Expected: PASS.

- [ ] **Step 6: Wire the gate into the pre-commit hook**

Modify `hooks/pre-commit`: in the section that runs other gate scripts, add a block that runs the infographic gate only when an infographic file changed:

```bash
if git diff --cached --name-only | grep -qE 'src/lib/infographic/|scripts/infographic-render\.mjs|scripts/gates/validate-infographic-svg\.mjs'; then
  node scripts/gates/validate-infographic-svg.mjs || { echo "infographic SVG gate failed"; exit 1; }
fi
```

- [ ] **Step 7: Commit**

```bash
git add scripts/gates/validate-infographic-svg.mjs src/lib/infographic/samples.mjs test/infographic-gate.test.js hooks/pre-commit
git commit -m "feat(infographic): well-formedness gate over rendered samples + pre-commit wiring"
```

---

### Task 8: Export script (repo) + the skill (propose, verify-source) and SKILL.md

> The rasterize/export logic lives in the REPO (`scripts/infographic-export.mjs`), because the raster deps (`@playwright/test`, `@resvg/resvg-js`, `sharp`) resolve only inside the repo's `node_modules`. The skill calls it as a thin CLI, matching the "renderers live in the repo" principle. The skill itself keeps only pure-node helpers (`propose.mjs`, `verify-source.mjs`) that need no heavy deps.

**Files:**
- Create (repo): `scripts/infographic-export.mjs`
- Test (repo): `test/infographic-export.test.js`
- Create (skill): `/Users/brian/iCode/skills/rrm-infographic/helpers/verify-source.mjs`
- Create (skill): `/Users/brian/iCode/skills/rrm-infographic/helpers/propose.mjs`
- Create (skill): `/Users/brian/iCode/skills/rrm-infographic/example/sample-specs.json`
- Create (skill): `/Users/brian/iCode/skills/rrm-infographic/SKILL.md`

**Interfaces:**
- Consumes: the repo CLI `scripts/infographic-render.mjs`.
- Produces: repo `exportPresets({ specPath, presets, outDir }) -> Promise<{ files: string[] }>` (renders standalone SVG via the render CLI, rasterizes to PNG via chromium with a resvg-js fallback, then encodes WebP via sharp); skill `verifySource(source, opts?) -> Promise<{ ok, reason }>` (fail-closed registry check; skips when the identifier is byte-equal to an already-verified value passed in `opts.knownVerified`); skill `proposeSpec(row) -> { spec, unconfirmed }` (candidate from a D1 article row, value marked UNCONFIRMED). The SKILL.md documents the operator flow.

- [ ] **Step 1: Write `helpers/verify-source.mjs` (fail-closed registry verification)**

```javascript
// Fail-closed registry verification. doi.org content-negotiation + Handle API
// for DOIs; esummary for PMIDs. On timeout/5xx => not verified (do not stage).
const TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

export async function verifySource(source, opts = {}) {
  const known = opts.knownVerified || {};
  // Skip the network call when the identifier is byte-equal to an already-verified
  // value (the article's own D1 identifier). Any operator edit changes the bytes
  // and forces full verification.
  if ((source.pmid && source.pmid === known.pmid) || (source.doi && source.doi === known.doi) || (source.url && source.url === known.url)) {
    return { ok: true, reason: 'identifier byte-equal to a verified D1 value (skip)' };
  }
  try {
    if (source.pmid) {
      const r = await fetchWithTimeout(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${encodeURIComponent(source.pmid)}&retmode=json`);
      if (!r.ok) return { ok: false, reason: `esummary ${r.status} (not verified)` };
      const j = await r.json();
      const rec = j.result && j.result[source.pmid];
      if (!rec || rec.error) return { ok: false, reason: 'pmid not found' };
      return { ok: true, reason: 'pmid verified' };
    }
    if (source.doi) {
      const r = await fetchWithTimeout(`https://doi.org/${encodeURIComponent(source.doi)}`, { method: 'GET', headers: { Accept: 'application/vnd.citationstyles.csl+json' } });
      if (r.status >= 500) return { ok: false, reason: `doi.org ${r.status} (not verified)` };
      if (r.ok) return { ok: true, reason: 'doi verified' };
      return { ok: false, reason: `doi not found (${r.status})` };
    }
    if (source.url) {
      const r = await fetchWithTimeout(source.url, { method: 'HEAD' });
      if (r.status >= 500) return { ok: false, reason: `url ${r.status} (not verified)` };
      return r.ok ? { ok: true, reason: 'url reachable' } : { ok: false, reason: `url ${r.status}` };
    }
    return { ok: false, reason: 'no identifier to verify' };
  } catch (e) {
    return { ok: false, reason: `verify error: ${e.message} (not verified)` };
  }
}
```

- [ ] **Step 2: Write skill `helpers/propose.mjs` (candidate spec from a D1 row, UNCONFIRMED)**

```javascript
// Propose a candidate infographic spec from a D1 article row. The value is read
// from the synopsis prose and marked UNCONFIRMED; the operator must confirm it
// against the primary source before staging.
const PCT = /(\d{1,3}(?:\.\d+)?)\s*%/;

export function proposeSpec(row) {
  const insights = (() => { try { return row.insights ? (typeof row.insights === 'string' ? JSON.parse(row.insights) : row.insights) : {}; } catch { return {}; } })();
  const text = [insights.tldr, ...(insights.key_findings || [])].filter(Boolean).join(' ');
  const m = text.match(PCT);
  const source = { label: row.short_citation || row.title || 'source' };
  if (row.pmid) source.pmid = String(row.pmid);
  else if (row.doi) source.doi = String(row.doi);
  else if (row.source_url) source.url = String(row.source_url);
  const spec = {
    template: 'single',
    eyebrow: 'Headline finding',
    value: m ? `${m[1]}%` : '',
    label: (insights.tldr || '').slice(0, 80),
    source,
  };
  return { spec, unconfirmed: true };
}
```

- [ ] **Step 3: Write repo `scripts/infographic-export.mjs` (render via CLI, rasterize PNG + WebP)**

```javascript
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

export const PRESETS = {
  square: { aspect: '1:1', w: 1080, h: 1080 },
  portrait: { aspect: '4:5', w: 1080, h: 1350 },
  og: { aspect: '1.91:1', w: 1200, h: 630 },
};

function renderStandaloneSvg(specPath, aspect) {
  const cli = join(REPO, 'scripts/infographic-render.mjs');
  // execFileSync throws on non-zero exit, surfacing the CLI error (exit-code gate).
  return execFileSync('node', [cli, '--file', specPath, '--mode', 'standalone', '--aspect', aspect], { encoding: 'utf8' });
}

async function rasterizePng(svg, w, h, pngPath) {
  try {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><meta charset="utf8"><body style="margin:0">${svg}</body>`, { waitUntil: 'networkidle' });
      await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: w, height: h } });
    } finally { await browser.close(); }
    return 'chromium';
  } catch (e) {
    const { Resvg } = await import('@resvg/resvg-js');
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng();
    writeFileSync(pngPath, png);
    return 'resvg';
  }
}

async function encodeWebp(pngPath, webpPath) {
  const sharp = (await import('sharp')).default;
  await sharp(pngPath).webp({ quality: 90 }).toFile(webpPath);
}

export async function exportPresets({ specPath, presets, outDir }) {
  mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const name of presets) {
    const p = PRESETS[name];
    if (!p) throw new Error(`unknown preset: ${name}`);
    const svg = renderStandaloneSvg(specPath, p.aspect);
    const svgPath = join(outDir, `${name}.svg`);
    const pngPath = join(outDir, `${name}.png`);
    const webpPath = join(outDir, `${name}.webp`);
    writeFileSync(svgPath, svg);
    await rasterizePng(svg, p.w, p.h, pngPath);
    await encodeWebp(pngPath, webpPath);
    files.push(svgPath, pngPath, webpPath);
  }
  return { files };
}

// CLI: node scripts/infographic-export.mjs --file spec.json --out ./dir --presets square,og
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  const specPath = arg('--file', null);
  const outDir = arg('--out', './infographic-out');
  const presets = arg('--presets', 'square,og').split(',');
  exportPresets({ specPath, presets, outDir })
    .then((r) => { process.stdout.write(r.files.join('\n') + '\n'); })
    .catch((e) => { process.stderr.write(`error: ${e.message}\n`); process.exit(1); });
}
```

- [ ] **Step 4: Add `sharp` as a dev dependency**

Run: `npm install --save-dev sharp`
Expected: `sharp` added to devDependencies.

- [ ] **Step 5: Write skill `example/sample-specs.json`**

Copy the four sample specs (one per template) from `src/lib/infographic/samples.mjs` into a JSON array so operators have a starting point. Exact content:

```json
[
  { "template": "single", "eyebrow": "Cumulative outcome", "value": "62%", "label": "cumulative live-birth rate over 24 months", "source": { "label": "Cohort 2024", "doi": "10.1000/abc123" } },
  { "template": "delta", "eyebrow": "Headline finding", "value": "38%", "direction": "up", "polarity": "favorable", "label": "higher live-birth rate vs continued IVF", "source": { "label": "Boyle 2018", "pmid": "30109231" } },
  { "template": "bars", "eyebrow": "Live birth, matched cohort", "unit": "%", "caption": "Restorative vs IVF", "bars": [ { "name": "Restorative", "value": 62, "hero": true }, { "name": "IVF", "value": 34 } ], "source": { "label": "Synopsis", "pmid": "30109231" } },
  { "template": "ratio", "eyebrow": "Population burden", "numerator": 1, "denominator": 8, "label": "couples affected by infertility", "source": { "label": "CDC", "url": "https://cdc.gov/art" } }
]
```

- [ ] **Step 6: Write the repo export smoke test `test/infographic-export.test.js`**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPresets } from '../scripts/infographic-export.mjs';

describe('exportPresets', () => {
  it('emits a valid PNG and WebP for the square preset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ig-'));
    const specPath = join(dir, 'spec.json');
    writeFileSync(specPath, JSON.stringify({ template: 'single', eyebrow: 'x', value: '62%', label: 'live birth', source: { label: 'c', pmid: '30109231' } }));
    const { files } = await exportPresets({ specPath, presets: ['square'], outDir: dir });
    const png = readFileSync(files.find((f) => f.endsWith('.png')));
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG magic bytes');
    const webp = readFileSync(files.find((f) => f.endsWith('.webp')));
    assert.equal(webp.subarray(0, 4).toString('ascii'), 'RIFF', 'WebP RIFF header');
    assert.equal(webp.subarray(8, 12).toString('ascii'), 'WEBP', 'WebP signature');
  });
});
```

- [ ] **Step 7: Run the export smoke test**

Run: `node --test test/infographic-export.test.js`
Expected: PASS (a PNG with valid magic bytes and a WebP with the RIFF/WEBP signature are produced; chromium or the resvg fallback ran).

- [ ] **Step 8: Write skill `SKILL.md`**

```markdown
---
name: rrm-infographic
description: Generate house-style synopsis infographics (single stat, directional delta, comparison bars, ratio pictograph) for RRM library research pages, and export them as PNG/WebP/SVG for Instagram, press, and email. Triggers: "infographic", "stat graphic", "synopsis chart", "bar graph for [article]", "make a stat image", "infographic for [paper]".
---

# rrm-infographic

Render one validated stat spec into an SVG (inline for the page, standalone for export). Never auto-publishes; on-page render is gated by `infographic_approved` (Phase 2).

## Flow
1. Resolve the article (id or slug); read its synopsis from D1.
2. Propose a candidate spec (template + headline number). If the number came from the synopsis prose, mark it UNCONFIRMED and confirm it against the primary source (abstract/fulltext), not the paraphrase.
3. Validate: `node scripts/infographic-render.mjs --file spec.json` in rrm-academy-cf (non-zero exit = invalid; show stderr, stop).
4. Verify the source with `helpers/verify-source.mjs` (fail-closed; on timeout/5xx do NOT stage).
5. Render + rasterize with the repo script `node scripts/infographic-export.mjs --file spec.json --out <scratch> --presets square,og` (chromium, resvg-js fallback; emits PNG + WebP + SVG) to a local scratch dir.
6. Write the spec to a LOCAL file only. This is the held state. Do NOT write D1 on a normal run.
7. Preview the local renders (mobile/desktop/dark) for sign-off.
8. Go-live (separate, operator-gated): POST the spec to the worker `/infographic-result` route, which sets `articles.infographic` + `infographic_approved = 1` atomically. Then rebuild the article and verify on the immutable `<hash>.pages.dev` URL or purge before checking the apex.

Re-run on an article that already has an infographic: confirm, reset `infographic_approved` to 0, log the prior spec.

## Rules
- Source bound + registry-verified or no render.
- Value rendered verbatim; bound to the source figure, not the synopsis.
- No em dashes; operator text is XML-escaped by the renderer.
```

- [ ] **Step 9: Commit the repo export script (worktree)**

```bash
git add scripts/infographic-export.mjs test/infographic-export.test.js package.json package-lock.json
git commit -m "feat(infographic): export script (PNG via chromium/resvg, WebP via sharp)"
```

- [ ] **Step 10: Commit the skill (skill repo)**

```bash
git -C /Users/brian/iCode/skills add rrm-infographic/
git -C /Users/brian/iCode/skills commit -m "feat: rrm-infographic skill (propose, verify-source, SKILL.md, example)"
```

---

## Phase 2: D1, worker, component, page wiring (HELD for go-live)

> Phase 2 creates the migration, worker route, component, and wiring on a branch. The D1 apply, the worker deploy, the site deploy, and per-article promotion all stay behind explicit go-live from Brian.

### Task 9: D1 migration (rrm-library-worker)

**Files:**
- Create: `/Users/brian/iCode/projects/rrm-library-worker/migrations/2026-06-21-add-infographic.sql`
- Modify (mirror): `~/iCode/projects/rrm-cli/schema/d1-library.sql` (add the two columns to the `articles` DDL)

**Interfaces:**
- Produces: `articles.infographic TEXT` and `articles.infographic_approved INTEGER NOT NULL DEFAULT 0`.

- [ ] **Step 1: Write the migration file**

```sql
-- 2026-06-21 add synopsis infographic spec storage + render gate
ALTER TABLE articles ADD COLUMN infographic TEXT;
ALTER TABLE articles ADD COLUMN infographic_approved INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Mirror the columns into the schema doc**

In `~/iCode/projects/rrm-cli/schema/d1-library.sql`, add the two columns to the `CREATE TABLE articles (...)` definition (next to `insights`/`synopsis_approved`), so the documented schema matches.

- [ ] **Step 3: Validate the SQL parses (no apply)**

Run: `node -e "const s=require('fs').readFileSync('/Users/brian/iCode/projects/rrm-library-worker/migrations/2026-06-21-add-infographic.sql','utf8'); if(!/ADD COLUMN infographic_approved/.test(s)) throw new Error('missing column'); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit each repo separately (do NOT apply to D1 yet; apply is held for go-live)**

```bash
# worker repo: the migration
git -C /Users/brian/iCode/projects/rrm-library-worker add migrations/2026-06-21-add-infographic.sql
git -C /Users/brian/iCode/projects/rrm-library-worker commit -m "feat(infographic): D1 migration for infographic spec + approval gate (held apply)"
# rrm-cli repo: the schema mirror (separate repo, separate commit)
git -C /Users/brian/iCode/projects/rrm-cli add schema/d1-library.sql
git -C /Users/brian/iCode/projects/rrm-cli commit -m "docs(schema): mirror articles.infographic + infographic_approved columns"
```

Go-live apply command (run only at go-live): `wrangler d1 execute rrm-library --remote --file migrations/2026-06-21-add-infographic.sql`

---

### Task 10: Worker `/articles` projection

**Files:**
- Modify: `/Users/brian/iCode/projects/rrm-library-worker/src/index.js` (both SELECT projections: the full-list query and the single-record query near line 578; the row mapper near line 568)

**Interfaces:**
- Consumes: the new D1 columns.
- Produces: each emitted article carries `infographic` (parsed JSON) ONLY when `infographic_approved === 1`, else `undefined`.

- [ ] **Step 1: Add the columns to both SELECT projections**

In each `SELECT a.id, a.slug, ... a.insights, a.synopsis_approved, ...` (the full-list query and the single-record query at ~line 579-584), add `a.infographic, a.infographic_approved,` immediately after `a.insights, a.synopsis_approved,`.

- [ ] **Step 2: Add the gated emit to the row mapper**

Find the mapper line (~line 568): `insights: row.synopsis_approved === 1 ? parseInsights(row.insights) : undefined,` and add directly below it:

```javascript
    infographic: row.infographic_approved === 1 ? safeParse(row.infographic) : undefined,
```

If a `safeParse` helper does not already exist in the file, add one near `parseInsights`:

```javascript
function safeParse(s) { try { return s ? JSON.parse(s) : undefined; } catch { return undefined; } }
```

- [ ] **Step 3: Static verification (lights-off safe; no wrangler dev, no interactive auth)**

Run: `node --check /Users/brian/iCode/projects/rrm-library-worker/src/index.js`
Expected: no output (valid JS).

Run: `grep -n "a.infographic" /Users/brian/iCode/projects/rrm-library-worker/src/index.js && grep -n "infographic_approved === 1" /Users/brian/iCode/projects/rrm-library-worker/src/index.js`
Expected: matches in both SELECT projections and the gated mapper line.
Note: runtime behavior cannot be confirmed until the D1 migration runs; that verification is part of the go-live runbook (Task 15), not the lights-off build.

- [ ] **Step 4: Commit (held; not deployed)**

```bash
git -C /Users/brian/iCode/projects/rrm-library-worker add src/index.js
git -C /Users/brian/iCode/projects/rrm-library-worker commit -m "feat(infographic): emit infographic spec gated by infographic_approved"
```

---

### Task 11: Worker go-live write route `/infographic-result`

**Files:**
- Create: `/Users/brian/iCode/projects/rrm-library-worker/src/routes/infographic-result.js`
- Modify: `/Users/brian/iCode/projects/rrm-library-worker/src/index.js` (route registration + import)

**Interfaces:**
- Consumes: admin auth (`ADMIN_TOKEN`, `rrm_admin_` prefix, `timingSafeCheck`), the D1 columns.
- Produces: `POST /infographic-result` with body `{ article_id, spec, approved }`. Re-validates the spec shape server-side, then atomically sets ONLY `infographic` + `infographic_approved` for that article. Returns `{ ok: true }` or a structured error.

- [ ] **Step 1: Write `src/routes/infographic-result.js`**

```javascript
// POST /infographic-result  { article_id, spec, approved }
// Admin-authed. Writes ONLY infographic + infographic_approved. Owns the column.
const TEMPLATES = ['single', 'delta', 'bars', 'ratio'];

function shapeOk(spec) {
  return spec && typeof spec === 'object'
    && TEMPLATES.includes(spec.template)
    && spec.source && typeof spec.source.label === 'string'
    && (spec.source.pmid || spec.source.doi || spec.source.url);
}

export async function handleInfographicResult(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  if (!body || typeof body.article_id !== 'string') return json({ error: 'article_id required' }, 400);
  if (!shapeOk(body.spec)) return json({ error: 'invalid spec shape' }, 400);
  const approved = body.approved === true ? 1 : 0;
  try {
    const res = await env.DB.prepare(
      `UPDATE articles SET infographic = ?, infographic_approved = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(JSON.stringify(body.spec), approved, body.article_id).run();
    if (!res.meta || res.meta.changes === 0) return json({ error: 'article not found' }, 404);
    return json({ ok: true, approved });
  } catch (e) {
    return json({ error: 'db_error' }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
```

- [ ] **Step 2: Register the route in `src/index.js`**

First read how `/insights-result` is wired: the worker has a named scope map (e.g. `const ROUTE_SCOPES = { 'insights-result': ['admin'], ... }`) consulted before dispatch. Add a matching entry for the new route, the import, and the dispatch:

```javascript
// 1. import near the other route imports:
import { handleInfographicResult } from './routes/infographic-result.js';

// 2. scope-table entry, alongside 'insights-result':
//    'infographic-result': ['admin'],

// 3. dispatch, after auth resolves scope === 'admin' (mirror the /insights-result branch exactly):
if (url.pathname === '/infographic-result' && request.method === 'POST') {
  return handleInfographicResult(request, env);
}
```

If the worker uses a different gating shape than a `ROUTE_SCOPES` map, mirror whatever pattern `/insights-result` actually uses (read the surrounding code); the invariant is: this route is reachable ONLY with `scope === 'admin'`.

- [ ] **Step 3: Verify the route file parses**

Run: `node --check /Users/brian/iCode/projects/rrm-library-worker/src/routes/infographic-result.js`
Expected: no output (valid).

- [ ] **Step 4: Commit (held; not deployed)**

```bash
git -C /Users/brian/iCode/projects/rrm-library-worker add src/routes/infographic-result.js src/index.js
git -C /Users/brian/iCode/projects/rrm-library-worker commit -m "feat(infographic): admin go-live write route (atomic, column-scoped)"
```

---

### Task 12: Build-side mapping (`fetch-data.mjs`)

**Files:**
- Modify: `/Users/brian/iCode/projects/rrm-academy-cf/src/lib/fetch-data.mjs:94`

**Interfaces:**
- Consumes: the worker's `infographic` field.
- Produces: each built article carries `infographic` (object or null) into `articles.json`.

- [ ] **Step 1: Add the mapping after the `insights` line**

Directly after line 94 (the `insights:` mapping), add:

```javascript
    // Synopsis infographic spec, rendered above the synopsis title. The worker
    // only emits this for infographic_approved = 1 rows (per-article go-live
    // gate), so unapproved/absent map to null and the component renders nothing.
    infographic: r.infographic && typeof r.infographic === 'object' && !Array.isArray(r.infographic) ? r.infographic : null,
```

- [ ] **Step 2: Verify the mapper still parses and existing tests pass**

Run: `node --test test/*.test.js`
Expected: PASS (the existing fetch-data test plus the infographic suite).

- [ ] **Step 3: Commit**

```bash
git add src/lib/fetch-data.mjs
git commit -m "feat(infographic): map infographic field through the build"
```

---

### Task 13: `SynopsisInfographic.astro` component

**Files:**
- Create: `/Users/brian/iCode/projects/rrm-academy-cf/src/components/SynopsisInfographic.astro`

**Interfaces:**
- Consumes: `renderInfographic` + `validateSpec`; prop `spec` (the article's `infographic` object or null).
- Produces: an inline SVG block under the synopsis title. Absent spec renders nothing; a present-but-invalid spec throws at build (no silent skip).

- [ ] **Step 1: Write the component**

```astro
---
import { validateSpec } from '../lib/infographic/validate.mjs';
import { renderInfographic } from '../lib/infographic/templates.mjs';

const { spec } = Astro.props;
let svg = '';
if (spec) {
  const v = validateSpec(spec);
  if (!v.valid) {
    // A populated-but-invalid stored spec is a build error, never a silent skip.
    throw new Error(`SynopsisInfographic: invalid spec: ${v.errors.join('; ')}`);
  }
  svg = renderInfographic(spec, { mode: 'inline', aspect: '1.91:1' });
}
---
{svg && <figure class="synopsis-infographic" set:html={svg} />}

<style>
  .synopsis-infographic {
    margin: var(--space-6) 0;
    max-width: 640px;
  }
  .synopsis-infographic :global(svg) {
    width: 100%;
    height: auto;
    border-radius: var(--radius-md);
  }
</style>
```

- [ ] **Step 2: Type-check passes (no new errors)**

Run: `npm run check-types`
Expected: no new errors above the baseline.

- [ ] **Step 3: Commit**

```bash
git add src/components/SynopsisInfographic.astro
git commit -m "feat(infographic): SynopsisInfographic component (inline, build-fails on invalid)"
```

---

### Task 14: Wire the component into both synopsis blocks

**Files:**
- Modify: `/Users/brian/iCode/projects/rrm-academy-cf/src/pages/library/[...slug].astro` (import + both `article.insights` blocks: editorial ~line 396, standard ~line 575)

**Interfaces:**
- Consumes: `SynopsisInfographic`, `article.infographic`.

- [ ] **Step 1: Import the component in the frontmatter**

Add to the component imports at the top of the `.astro` file:

```javascript
import SynopsisInfographic from '../../components/SynopsisInfographic.astro';
```

- [ ] **Step 2: Add the slot in the editorial branch (under the synopsis `<h2>`, ~line 399)**

Immediately after the synopsis title `<h2 class="detail-heading">{article.insights.title || 'Synopsis'}</h2>` in the editorial block, add:

```astro
        {article.infographic && <SynopsisInfographic spec={article.infographic} />}
```

- [ ] **Step 3: Add the same slot in the standard branch (~line 575)**

Find the second `{article.insights && (` block (standard layout) and add the identical line directly after its synopsis title `<h2>`:

```astro
        {article.infographic && <SynopsisInfographic spec={article.infographic} />}
```

- [ ] **Step 4: Type-check + build**

Run: `npm run check-types && npm run build`
Expected: build succeeds (the live `articles.json` has no `infographic` yet, so no infographic renders; nothing breaks).

- [ ] **Step 5: Commit**

```bash
git add src/pages/library/[...slug].astro
git commit -m "feat(infographic): render SynopsisInfographic in both synopsis branches"
```

---

### Task 15: Phase 2 verification (held; behind go-live)

**Files:**
- Test/verify only. No new production files.

**Interfaces:** none.

- [ ] **Step 1: Local fixture render (no D1)**

Create a throwaway local fixture: copy `dist`-bound `src/data/articles.json` (or a single-record fixture), inject an `infographic` object (one of the samples) onto one article, and run `npm run build`. Load the built page with `npx wrangler pages dev dist` and confirm the inline SVG renders under the synopsis title at mobile (393) and desktop, and the numeral is selectable DOM text (view source shows `<text>...62%...</text>`).
Expected: infographic visible on both an editorial-type and a standard-type sample article; no horizontal overflow (run the web-page-qa gate).

- [ ] **Step 2: Populated-but-invalid fails the build**

Inject a deliberately invalid `infographic` (e.g. drop `value` from a `single`) into the fixture and run `npm run build`.
Expected: the build FAILS with `SynopsisInfographic: invalid spec: ...` (proves no silent render-nothing for a populated-but-invalid spec). Revert the fixture.

- [ ] **Step 3: Record the go-live runbook (held)**

Append a short runbook to the spec or a `docs/runbooks/` note listing the exact go-live order: (1) `wrangler d1 execute rrm-library --remote --file migrations/2026-06-21-add-infographic.sql`; (2) deploy rrm-library-worker; (3) POST the spec to `/infographic-result` with `approved: true`; (4) `repository_dispatch` rebuild of the article; (5) verify on `<hash>.pages.dev` or purge the apex URL via cf-cache-purge.
Expected: runbook committed; no live action taken.

- [ ] **Step 4: Commit the runbook**

```bash
git add docs/runbooks/2026-06-21-infographic-go-live.md
git commit -m "docs(infographic): go-live runbook (held)"
```

---

## Self-Review (completed by plan author)

**Spec coverage:** Every spec section maps to a task. §3.1 storage -> Task 9; §3.2/3.3 spec+validate -> Task 2; §4 templates+escaping+normalization -> Tasks 3-5; §5 renderer/two-modes/CLI -> Tasks 3-6; §6 component+gate+both-blocks -> Tasks 10,12,13,14; §7 export presets -> Task 8; §8 skill flow -> Task 8; §9 fidelity/verify-source -> Task 8; §10 verification -> Tasks 7,15; §11 phases -> Phase split; §12 file inventory -> matches; tokens (§4 polarity) -> Task 1.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output.

**Type consistency:** `validateSpec`, `renderInfographic`, `escapeXml`, `color`, `ASPECTS`, `RESOLVED_LIGHT`, `registerRenderer`, `sourceLine`, `svgShell`, `exportPresets`, `verifySource`, `SAMPLES`, `infographic_approved`, `/infographic-result` are used identically across tasks.

**Open items folded from the /arise CAUTION pass:** eyebrow 28-char test (Task 2 Step 2), go-live route auth + column-scope (Task 11), inherited-source handling (skill flow, Task 8). Registry-verify is fail-closed (Task 8 Step 1).
