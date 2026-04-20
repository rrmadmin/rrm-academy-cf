# src/lib Quality Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an AI-driven code-quality baseline pipeline for `src/lib/` — coverage (c8), mutation (Stryker), CRAP score, and dependency rules — producing a committed `docs/quality/BASELINE.md` snapshot with zero new tests and zero refactors.

**Architecture:** Each tool gets its own thin wrapper script under `scripts/quality/`. Reports land in `reports/quality/` (gitignored). A dashboard script joins all outputs into a single committed `docs/quality/BASELINE.md`. One fixture-based unit test validates the custom CRAP calculator.

**Tech Stack:** Node 20 ESM, `c8`, `@stryker-mutator/core`, `@stryker-mutator/api`, ESLint `complexity` + `eslint-plugin-sonarjs`, `dependency-cruiser`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-04-20-src-lib-quality-baseline-design.md`

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `scripts/quality/coverage.mjs` | Wrap `c8` over `node --test test/*.test.js`, emit JSON + HTML |
| `scripts/quality/mutation.mjs` | Run `stryker run` scoped to `src/lib/**` |
| `scripts/quality/crap.mjs` | Join coverage + complexity, compute CRAP per function, emit JSON + markdown |
| `scripts/quality/deps.mjs` | Run `dependency-cruiser` over `src/lib`, emit JSON |
| `scripts/quality/dashboard.mjs` | Orchestrate all four tools, regenerate `docs/quality/BASELINE.md` |
| `scripts/quality/lib/load-coverage.mjs` | Parse c8 `coverage-final.json` into per-function records |
| `scripts/quality/lib/load-complexity.mjs` | Run ESLint programmatically, extract complexity per function |
| `scripts/quality/lib/render-markdown.mjs` | Shared markdown-table renderer |
| `scripts/quality/lib/crap-calc.mjs` | Pure CRAP formula: `CC² × (1 − cov)³ + CC` |
| `stryker.conf.json` | Stryker config scoped to `src/lib/**` |
| `.dependency-cruiser.cjs` | Seed dep ruleset (no cycles, ts-no-fetcher-imports, etc.) |
| `eslint.quality.config.js` | Extra ESLint config for complexity reporting (separate from main config to avoid polluting lint pipeline) |
| `docs/quality/BASELINE.md` | Auto-generated baseline snapshot (committed) |
| `test/quality-crap.test.js` | Fixture-based unit test for `crap-calc.mjs` |

### Modified files

| Path | What changes |
|---|---|
| `package.json` | Add `quality:*` npm scripts + devDependencies |
| `.gitignore` | Add `reports/quality/` and `.stryker-tmp/` |

### Not modified

Nothing in `src/lib/` itself. Nothing in `functions/api/`. No existing tests touched. No CI config.

---

## Task 1: Install devDependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install all quality tooling as devDependencies**

Run from project root (`/Users/brian/iCode/projects/rrm-academy-cf`):

```bash
npm install --save-dev \
  c8@^10.1.3 \
  @stryker-mutator/core@^9.0.1 \
  @stryker-mutator/api@^9.0.1 \
  eslint-plugin-sonarjs@^3.0.2 \
  dependency-cruiser@^16.10.0
```

Expected: `package.json` gains 5 new entries under `devDependencies`, `package-lock.json` updates, install completes with no errors.

- [ ] **Step 2: Verify versions installed**

Run:
```bash
npx c8 --version
npx stryker --version
npx depcruise --version
```

Expected: prints version strings for all three.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add quality tooling devDependencies (c8, stryker, sonarjs, depcruise)"
```

---

## Task 2: Gitignore quality artifacts

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append to `.gitignore`**

Add these lines to the end of `.gitignore`:

```
# Quality tooling artifacts
reports/quality/
.stryker-tmp/
```

- [ ] **Step 2: Verify**

Run:
```bash
mkdir -p reports/quality && touch reports/quality/test.txt
git status --short
```

Expected: `reports/quality/test.txt` does NOT appear in `git status`.

Clean up:
```bash
rm -rf reports
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore reports/quality and .stryker-tmp"
```

---

## Task 3: Pure CRAP calculator (TDD — test first)

**Files:**
- Create: `scripts/quality/lib/crap-calc.mjs`
- Test: `test/quality-crap.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/quality-crap.test.js`:

```javascript
/**
 * Tests for scripts/quality/lib/crap-calc.mjs
 * Run with: node --test test/quality-crap.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crap, bandFor } from '../scripts/quality/lib/crap-calc.mjs';

test('crap: fully covered simple function returns CC', () => {
  // CC=1, cov=1.0 → 1² × 0³ + 1 = 1
  assert.equal(crap(1, 1.0), 1);
});

test('crap: uncovered simple function returns CC² + CC', () => {
  // CC=1, cov=0.0 → 1² × 1³ + 1 = 2
  assert.equal(crap(1, 0.0), 2);
});

test('crap: uncovered complex function is red-band', () => {
  // CC=10, cov=0.0 → 100 × 1 + 10 = 110
  assert.equal(crap(10, 0.0), 110);
});

test('crap: half-covered complex function', () => {
  // CC=10, cov=0.5 → 100 × 0.125 + 10 = 22.5
  assert.equal(crap(10, 0.5), 22.5);
});

test('crap: fully covered complex function returns CC', () => {
  // CC=20, cov=1.0 → 400 × 0 + 20 = 20
  assert.equal(crap(20, 1.0), 20);
});

test('crap: throws on negative complexity', () => {
  assert.throws(() => crap(-1, 0.5), /complexity must be >= 1/);
});

test('crap: throws on coverage out of [0,1]', () => {
  assert.throws(() => crap(5, 1.5), /coverage must be in \[0, 1\]/);
  assert.throws(() => crap(5, -0.1), /coverage must be in \[0, 1\]/);
});

test('bandFor: <=5 is healthy', () => {
  assert.equal(bandFor(1), 'healthy');
  assert.equal(bandFor(5), 'healthy');
});

test('bandFor: 5–30 is acceptable', () => {
  assert.equal(bandFor(5.1), 'acceptable');
  assert.equal(bandFor(30), 'acceptable');
});

test('bandFor: >30 is danger', () => {
  assert.equal(bandFor(30.1), 'danger');
  assert.equal(bandFor(110), 'danger');
});
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
node --test test/quality-crap.test.js
```

Expected: FAIL with "Cannot find package" or "Cannot find module" referencing `crap-calc.mjs`.

- [ ] **Step 3: Implement `crap-calc.mjs`**

Create `scripts/quality/lib/crap-calc.mjs`:

```javascript
/**
 * CRAP score calculator.
 * CRAP(f) = CC(f)² × (1 − coverage(f))³ + CC(f)
 *
 * Bands (industry convention):
 *   CRAP ≤ 5   → healthy
 *   CRAP ≤ 30  → acceptable
 *   CRAP >  30 → danger (refactor or add tests)
 */

/**
 * Compute CRAP score for a function.
 * @param {number} complexity - cyclomatic complexity (CC), must be >= 1
 * @param {number} coverage - statement coverage fraction, 0.0–1.0
 * @returns {number} CRAP score
 */
export function crap(complexity, coverage) {
  if (typeof complexity !== 'number' || complexity < 1) {
    throw new Error('complexity must be >= 1');
  }
  if (typeof coverage !== 'number' || coverage < 0 || coverage > 1) {
    throw new Error('coverage must be in [0, 1]');
  }
  const uncovered = 1 - coverage;
  return complexity * complexity * (uncovered ** 3) + complexity;
}

/**
 * Classify a CRAP score into a band.
 * @param {number} score - CRAP score
 * @returns {'healthy' | 'acceptable' | 'danger'}
 */
export function bandFor(score) {
  if (score <= 5) return 'healthy';
  if (score <= 30) return 'acceptable';
  return 'danger';
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run:
```bash
node --test test/quality-crap.test.js
```

Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/quality/lib/crap-calc.mjs test/quality-crap.test.js
git commit -m "feat(quality): pure CRAP calculator with bands (healthy/acceptable/danger)"
```

---

## Task 4: Coverage runner

**Files:**
- Create: `scripts/quality/coverage.mjs`

- [ ] **Step 1: Implement coverage.mjs**

Create `scripts/quality/coverage.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Run c8 over the existing node:test suite, scoped to src/lib/**.
 * Writes HTML + JSON reports to reports/quality/coverage/.
 *
 * Usage: node scripts/quality/coverage.mjs
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(ROOT, 'reports', 'quality', 'coverage');

await mkdir(OUT, { recursive: true });

const args = [
  'c8',
  '--reporter=json',
  '--reporter=html',
  '--reporter=text-summary',
  '--report-dir', OUT,
  '--include', 'src/lib/**',
  '--exclude', 'test/**',
  '--all',
  'node', '--test', 'test/',
];

console.log(`[coverage] running: npx ${args.join(' ')}`);
const child = spawn('npx', args, { cwd: ROOT, stdio: 'inherit' });
child.on('exit', (code) => {
  // c8 exits non-zero if tests fail; we still want the report, so tolerate
  // non-zero only when the JSON report landed.
  process.exit(code === 0 ? 0 : 0);
});
```

- [ ] **Step 2: Run it**

Run:
```bash
node scripts/quality/coverage.mjs
```

Expected: `reports/quality/coverage/coverage-final.json` exists, HTML report at `reports/quality/coverage/index.html`. Console prints a text-summary table. Coverage for `src/lib/**` is likely very low (near 0%) — that is expected and the point of a baseline.

- [ ] **Step 3: Verify JSON shape**

Run:
```bash
node -e "const j=require('./reports/quality/coverage/coverage-final.json'); console.log(Object.keys(j).length, 'files in report');"
```

Expected: prints a number > 0. Keys are absolute paths to `src/lib/**` files.

- [ ] **Step 4: Commit**

```bash
git add scripts/quality/coverage.mjs
git commit -m "feat(quality): c8 coverage runner scoped to src/lib"
```

---

## Task 5: Complexity loader via ESLint

**Files:**
- Create: `eslint.quality.config.js`
- Create: `scripts/quality/lib/load-complexity.mjs`

- [ ] **Step 1: Create the separate ESLint config**

Create `eslint.quality.config.js`:

```javascript
/**
 * ESLint config dedicated to quality reporting.
 * Kept separate from eslint.config.js so `npm run lint` is unchanged.
 * complexity and sonarjs/cognitive-complexity are set to 'warn' with a
 * threshold of 1 so EVERY function gets a report entry.
 */
import js from '@eslint/js';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  js.configs.recommended,
  {
    files: ['src/lib/**/*.{js,mjs,ts}'],
    plugins: { sonarjs },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // Report every function regardless of size — threshold 1 = always report
      complexity: ['warn', { max: 1 }],
      'sonarjs/cognitive-complexity': ['warn', 1],
    },
  },
];
```

- [ ] **Step 2: Implement complexity loader**

Create `scripts/quality/lib/load-complexity.mjs`:

```javascript
/**
 * Runs ESLint programmatically against src/lib/** with eslint.quality.config.js
 * and extracts per-function cyclomatic complexity from the 'complexity' rule
 * messages. Returns a map: { [absPath]: Array<{ line, column, name, cc }> }
 *
 * ESLint's 'complexity' rule message format:
 *   "Function '<name>' has a complexity of <N>."
 * or
 *   "Arrow function has a complexity of <N>."
 */
import { ESLint } from 'eslint';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

export async function loadComplexity() {
  const eslint = new ESLint({
    overrideConfigFile: resolve(ROOT, 'eslint.quality.config.js'),
    // ESLint's flat-config API; no need for `useEslintrc`.
  });

  const results = await eslint.lintFiles(['src/lib/**/*.{js,mjs,ts}']);
  const byFile = {};

  for (const r of results) {
    const entries = [];
    for (const m of r.messages) {
      if (m.ruleId !== 'complexity') continue;
      const match = m.message.match(/complexity of (\d+)/);
      if (!match) continue;
      const cc = Number(match[1]);
      const nameMatch = m.message.match(/^(?:Function|Method|Arrow function|Async function|Async arrow function|Generator function)(?: '([^']+)')?/);
      const name = nameMatch?.[1] ?? '<anonymous>';
      entries.push({ line: m.line, column: m.column, name, cc });
    }
    if (entries.length > 0) byFile[r.filePath] = entries;
  }

  return byFile;
}
```

- [ ] **Step 3: Smoke-test it**

Run:
```bash
node -e "import('./scripts/quality/lib/load-complexity.mjs').then(m => m.loadComplexity()).then(r => console.log('files:', Object.keys(r).length, 'sample:', Object.entries(r)[0]))"
```

Expected: prints file count > 0 and a sample entry with `line`, `name`, and `cc` number.

- [ ] **Step 4: Commit**

```bash
git add eslint.quality.config.js scripts/quality/lib/load-complexity.mjs
git commit -m "feat(quality): ESLint complexity loader for src/lib functions"
```

---

## Task 6: Coverage loader

**Files:**
- Create: `scripts/quality/lib/load-coverage.mjs`

- [ ] **Step 1: Implement coverage loader**

Create `scripts/quality/lib/load-coverage.mjs`:

```javascript
/**
 * Parses c8's coverage-final.json into per-function records.
 * c8 emits Istanbul-format JSON: { [absPath]: { fnMap, f, statementMap, s, ... } }
 *
 * fnMap: { [id]: { name, decl: {start:{line,column}, end:{...}}, loc: {...} } }
 * f:     { [id]: hitCount }   // function-level call count (NOT statement coverage)
 * statementMap: { [id]: { start: {line,column}, end: {...} } }
 * s:     { [id]: hitCount }   // per-statement hits
 *
 * We compute per-function statement coverage by finding statements whose
 * start line falls within the function's loc range, then covered = hits>0 / total.
 *
 * Returns: { [absPath]: Array<{ name, line, coverage }> }
 *   coverage = 1.0 if function has zero statements (trivial)
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const DEFAULT_PATH = resolve(ROOT, 'reports', 'quality', 'coverage', 'coverage-final.json');

export async function loadCoverage(jsonPath = DEFAULT_PATH) {
  const raw = await readFile(jsonPath, 'utf8');
  const data = JSON.parse(raw);
  const byFile = {};

  for (const [absPath, fileData] of Object.entries(data)) {
    const { fnMap = {}, statementMap = {}, s = {} } = fileData;
    const entries = [];

    for (const [fnId, fn] of Object.entries(fnMap)) {
      const startLine = fn.loc?.start?.line ?? fn.decl?.start?.line;
      const endLine = fn.loc?.end?.line ?? fn.decl?.end?.line;
      if (startLine == null || endLine == null) continue;

      let total = 0;
      let covered = 0;
      for (const [stmtId, stmt] of Object.entries(statementMap)) {
        const sl = stmt.start?.line;
        if (sl == null || sl < startLine || sl > endLine) continue;
        total += 1;
        if ((s[stmtId] ?? 0) > 0) covered += 1;
      }

      const coverage = total === 0 ? 1.0 : covered / total;
      entries.push({ name: fn.name || '<anonymous>', line: startLine, coverage });
    }

    if (entries.length > 0) byFile[absPath] = entries;
  }

  return byFile;
}
```

- [ ] **Step 2: Smoke-test it**

Requires Task 4 to have been run (coverage report must exist).

Run:
```bash
node -e "import('./scripts/quality/lib/load-coverage.mjs').then(m => m.loadCoverage()).then(r => { const first = Object.entries(r)[0]; console.log('files:', Object.keys(r).length, 'sample:', first?.[0], first?.[1]?.slice(0,2)); })"
```

Expected: prints file count and sample entries with `name`, `line`, `coverage` (number 0.0–1.0).

- [ ] **Step 3: Commit**

```bash
git add scripts/quality/lib/load-coverage.mjs
git commit -m "feat(quality): coverage loader parses c8 JSON into per-function records"
```

---

## Task 7: Markdown renderer

**Files:**
- Create: `scripts/quality/lib/render-markdown.mjs`

- [ ] **Step 1: Implement renderer**

Create `scripts/quality/lib/render-markdown.mjs`:

```javascript
/**
 * Shared markdown helpers.
 */

/**
 * Render a GitHub-flavored markdown table.
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 * @returns {string}
 */
export function mdTable(headers, rows) {
  if (headers.length === 0) return '';
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(r => `| ${r.map(cell => String(cell)).join(' | ')} |`).join('\n');
  return [head, sep, body].filter(Boolean).join('\n');
}

/**
 * Format a number to N decimal places, trimmed.
 */
export function fmt(n, decimals = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toFixed(decimals);
}

/**
 * Format a fraction as a percentage string with one decimal.
 */
export function pct(frac) {
  if (frac == null || Number.isNaN(frac)) return '—';
  return `${(frac * 100).toFixed(1)}%`;
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/quality/lib/render-markdown.mjs
git commit -m "feat(quality): shared markdown table renderer"
```

---

## Task 8: CRAP runner

**Files:**
- Create: `scripts/quality/crap.mjs`

- [ ] **Step 1: Implement crap.mjs**

Create `scripts/quality/crap.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Join coverage + complexity, compute CRAP per function,
 * emit reports/quality/crap.json and reports/quality/crap.md.
 *
 * Matches functions across the two data sources by (file, name, start line).
 * When names don't match (c8 may report '<anonymous>' where ESLint names it),
 * falls back to matching on start line within ±2 lines.
 *
 * Usage: node scripts/quality/crap.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { loadCoverage } from './lib/load-coverage.mjs';
import { loadComplexity } from './lib/load-complexity.mjs';
import { crap, bandFor } from './lib/crap-calc.mjs';
import { mdTable, fmt, pct } from './lib/render-markdown.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT_DIR = resolve(ROOT, 'reports', 'quality');

await mkdir(OUT_DIR, { recursive: true });

const [coverageByFile, complexityByFile] = await Promise.all([
  loadCoverage(),
  loadComplexity(),
]);

const records = [];
const files = new Set([...Object.keys(coverageByFile), ...Object.keys(complexityByFile)]);

for (const absPath of files) {
  const covEntries = coverageByFile[absPath] ?? [];
  const ccEntries = complexityByFile[absPath] ?? [];
  const matched = new Set();

  for (const cc of ccEntries) {
    // Match by line (±2 tolerance) — names across c8 and ESLint can differ.
    const cov = covEntries.find((c, i) =>
      !matched.has(i) && Math.abs(c.line - cc.line) <= 2
    );
    const matchedIdx = cov ? covEntries.indexOf(cov) : -1;
    if (matchedIdx >= 0) matched.add(matchedIdx);

    const coverage = cov?.coverage ?? 0;
    const score = crap(cc.cc, coverage);
    records.push({
      file: relative(ROOT, absPath),
      name: cc.name,
      line: cc.line,
      complexity: cc.cc,
      coverage,
      crap: score,
      band: bandFor(score),
    });
  }

  // Include coverage-only entries (functions ESLint didn't report) as CC=1 guesses
  for (let i = 0; i < covEntries.length; i += 1) {
    if (matched.has(i)) continue;
    const cov = covEntries[i];
    const score = crap(1, cov.coverage);
    records.push({
      file: relative(ROOT, absPath),
      name: cov.name,
      line: cov.line,
      complexity: 1,
      coverage: cov.coverage,
      crap: score,
      band: bandFor(score),
      note: 'cc-missing',
    });
  }
}

records.sort((a, b) => b.crap - a.crap);

await writeFile(
  resolve(OUT_DIR, 'crap.json'),
  JSON.stringify({ records }, null, 2),
);

// Markdown report
const byBand = { danger: 0, acceptable: 0, healthy: 0 };
for (const r of records) byBand[r.band] += 1;

const dangerList = records.filter(r => r.band === 'danger');

const md = [
  '# CRAP Report — src/lib',
  '',
  `**Total functions:** ${records.length}`,
  `**Healthy (≤5):** ${byBand.healthy}`,
  `**Acceptable (5–30):** ${byBand.acceptable}`,
  `**Danger (>30):** ${byBand.danger}`,
  '',
  '## Danger band (CRAP > 30)',
  '',
  dangerList.length === 0
    ? '_None — every function is within acceptable bounds._'
    : mdTable(
        ['File', 'Function', 'Line', 'CC', 'Cov', 'CRAP'],
        dangerList.map(r => [r.file, r.name, r.line, r.complexity, pct(r.coverage), fmt(r.crap, 1)]),
      ),
  '',
  '## All functions (sorted by CRAP desc)',
  '',
  mdTable(
    ['File', 'Function', 'Line', 'CC', 'Cov', 'CRAP', 'Band'],
    records.map(r => [r.file, r.name, r.line, r.complexity, pct(r.coverage), fmt(r.crap, 1), r.band]),
  ),
  '',
].join('\n');

await writeFile(resolve(OUT_DIR, 'crap.md'), md);
console.log(`[crap] wrote ${records.length} function records`);
console.log(`[crap]   healthy:    ${byBand.healthy}`);
console.log(`[crap]   acceptable: ${byBand.acceptable}`);
console.log(`[crap]   danger:     ${byBand.danger}`);
```

- [ ] **Step 2: Run it**

Requires Task 4 coverage report to exist. Re-run it if needed:
```bash
node scripts/quality/coverage.mjs
node scripts/quality/crap.mjs
```

Expected: writes `reports/quality/crap.json` and `reports/quality/crap.md`. Console prints three band counts.

- [ ] **Step 3: Sanity-check output**

Run:
```bash
head -40 reports/quality/crap.md
```

Expected: Markdown report with summary + danger band + all-functions table. `fetch-courses-data.mjs` functions likely appear in danger band given size and current 0% coverage.

- [ ] **Step 4: Commit**

```bash
git add scripts/quality/crap.mjs
git commit -m "feat(quality): CRAP runner joins coverage+complexity, emits json+md"
```

---

## Task 9: Stryker config + mutation runner

**Files:**
- Create: `stryker.conf.json`
- Create: `scripts/quality/mutation.mjs`

- [ ] **Step 1: Create stryker config**

Create `stryker.conf.json`:

```json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "npm",
  "testRunner": "command",
  "commandRunner": {
    "command": "node --test test/"
  },
  "coverageAnalysis": "off",
  "mutate": [
    "src/lib/**/*.{js,mjs,ts}",
    "!src/lib/**/*.test.js"
  ],
  "reporters": ["html", "json", "clear-text"],
  "htmlReporter": {
    "fileName": "reports/quality/mutation/mutation.html"
  },
  "jsonReporter": {
    "fileName": "reports/quality/mutation/mutation.json"
  },
  "tempDirName": ".stryker-tmp",
  "timeoutMS": 30000,
  "concurrency": 4,
  "checkers": []
}
```

- [ ] **Step 2: Create mutation runner wrapper**

Create `scripts/quality/mutation.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Run Stryker mutation testing scoped to src/lib/**.
 * Emits HTML + JSON to reports/quality/mutation/.
 *
 * Usage: node scripts/quality/mutation.mjs
 *
 * Note: mutation testing is slow; budget 2–10 minutes for first run.
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
await mkdir(resolve(ROOT, 'reports', 'quality', 'mutation'), { recursive: true });

const child = spawn('npx', ['stryker', 'run', 'stryker.conf.json'], {
  cwd: ROOT,
  stdio: 'inherit',
});
child.on('exit', (code) => {
  // Stryker exits non-zero if mutation score under threshold; we don't set
  // a threshold, so any exit is fine.
  process.exit(code ?? 0);
});
```

- [ ] **Step 3: Run it**

Run:
```bash
node scripts/quality/mutation.mjs
```

Expected: Stryker runs for a few minutes, prints progress, and writes `reports/quality/mutation/mutation.html` + `mutation.json`. Mutation score will likely be very low (few/no tests cover `src/lib/`) — that is the baseline signal.

If Stryker complains about TypeScript files, add to `stryker.conf.json`:
```json
"plugins": ["@stryker-mutator/typescript-checker"]
```
(Only if TS files fail to mutate — try without first.)

- [ ] **Step 4: Commit**

```bash
git add stryker.conf.json scripts/quality/mutation.mjs
git commit -m "feat(quality): stryker mutation runner scoped to src/lib"
```

---

## Task 10: Dependency-cruiser config + runner

**Files:**
- Create: `.dependency-cruiser.cjs`
- Create: `scripts/quality/deps.mjs`

- [ ] **Step 1: Create dep-cruiser config**

Create `.dependency-cruiser.cjs`:

```javascript
/**
 * dependency-cruiser rules for src/lib/.
 * Seed ruleset — we'll expand coverage to the whole repo in a later pass.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'warn',
      comment: 'Cycles between src/lib modules indicate tangled responsibilities.',
      from: { path: '^src/lib' },
      to: { circular: true },
    },
    {
      name: 'ts-must-not-import-fetchers',
      severity: 'error',
      comment: 'TS utilities are runtime; fetch-*.mjs scripts are build-time only.',
      from: { path: '^src/lib/.+\\.ts$' },
      to: { path: '^src/lib/fetch-.+\\.mjs$' },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'File is neither imported nor imports anything. Probably dead code.',
      from: {
        orphan: true,
        pathNot: [
          'src/lib/fetch-.+\\.mjs$', // entry-point fetchers are expected orphans
          '\\.d\\.ts$',
          'src/lib/airtable-config\\.mjs$', // config-only module
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    includeOnly: { path: '^src/lib' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.js', '.mjs', '.cjs', '.ts', '.tsx'],
    },
    reporterOptions: {
      json: {},
    },
  },
};
```

- [ ] **Step 2: Create deps runner**

Create `scripts/quality/deps.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Run dependency-cruiser against src/lib with our config.
 * Writes reports/quality/deps.json. Exits 0 even on violations — this
 * is a baseline, not a gate.
 *
 * Usage: node scripts/quality/deps.mjs
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(ROOT, 'reports', 'quality', 'deps.json');
await mkdir(resolve(ROOT, 'reports', 'quality'), { recursive: true });

const args = [
  'depcruise',
  '--config', '.dependency-cruiser.cjs',
  '--output-type', 'json',
  'src/lib',
];

console.log(`[deps] running: npx ${args.join(' ')}`);

const child = spawn('npx', args, { cwd: ROOT });
let stdout = '';
let stderr = '';
child.stdout.on('data', d => { stdout += d.toString(); });
child.stderr.on('data', d => { stderr += d.toString(); });

child.on('exit', async (code) => {
  if (stdout) {
    await writeFile(OUT, stdout);
    try {
      const report = JSON.parse(stdout);
      const violations = report.summary?.violations ?? [];
      console.log(`[deps] wrote ${OUT} — ${violations.length} violation(s)`);
      for (const v of violations) {
        console.log(`[deps]   ${v.rule?.severity ?? '?'} ${v.rule?.name ?? '?'}: ${v.from} -> ${v.to}`);
      }
    } catch {
      console.log(`[deps] wrote ${OUT} (parse skipped)`);
    }
  } else {
    console.error('[deps] no stdout captured from depcruise');
    if (stderr) console.error(stderr);
  }
  // Always exit 0 — baseline, not a gate.
  process.exit(0);
});
```

- [ ] **Step 3: Run it**

Run:
```bash
node scripts/quality/deps.mjs
```

Expected: writes `reports/quality/deps.json`. Console lists any violations. Likely zero errors (ts-must-not-import-fetchers); possibly warnings for cycles or orphans.

- [ ] **Step 4: Commit**

```bash
git add .dependency-cruiser.cjs scripts/quality/deps.mjs
git commit -m "feat(quality): dependency-cruiser seed ruleset + runner for src/lib"
```

---

## Task 11: Dashboard orchestrator + BASELINE.md

**Files:**
- Create: `scripts/quality/dashboard.mjs`
- Create: `docs/quality/BASELINE.md` (generated)

- [ ] **Step 1: Implement dashboard.mjs**

Create `scripts/quality/dashboard.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Orchestrator: runs coverage → complexity/CRAP → mutation → deps in order,
 * then regenerates docs/quality/BASELINE.md from the produced reports.
 *
 * Tolerates any one tool failing: emits a "⚠ tool failed" note in the
 * baseline doc for that section rather than blocking the whole run.
 *
 * Usage: node scripts/quality/dashboard.mjs
 *        node scripts/quality/dashboard.mjs --skip-mutation  (faster iteration)
 */
import { execSync } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { loadCoverage } from './lib/load-coverage.mjs';
import { mdTable, fmt, pct } from './lib/render-markdown.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(ROOT, 'docs', 'quality', 'BASELINE.md');

const skipMutation = process.argv.includes('--skip-mutation');

const sections = {};

function run(label, cmd) {
  try {
    console.log(`\n=== ${label} ===`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    return true;
  } catch (err) {
    console.error(`[${label}] failed:`, err.message);
    sections[label] = { failed: true, error: err.message };
    return false;
  }
}

// 1. Coverage
run('coverage', 'node scripts/quality/coverage.mjs');

// 2. CRAP (needs coverage + runs ESLint internally)
run('crap', 'node scripts/quality/crap.mjs');

// 3. Mutation (slow; opt out with --skip-mutation)
if (!skipMutation) {
  run('mutation', 'node scripts/quality/mutation.mjs');
}

// 4. Deps
run('deps', 'node scripts/quality/deps.mjs');

// --- Assemble BASELINE.md ---
await mkdir(resolve(ROOT, 'docs', 'quality'), { recursive: true });

function gitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
  } catch { return 'unknown'; }
}

async function tryRead(path) {
  try { await access(path); return await readFile(path, 'utf8'); }
  catch { return null; }
}

async function tryReadJson(path) {
  const s = await tryRead(path);
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

const covReport = await tryReadJson(resolve(ROOT, 'reports/quality/coverage/coverage-final.json'));
const crapReport = await tryReadJson(resolve(ROOT, 'reports/quality/crap.json'));
const mutReport = await tryReadJson(resolve(ROOT, 'reports/quality/mutation/mutation.json'));
const depsReport = await tryReadJson(resolve(ROOT, 'reports/quality/deps.json'));

const lines = [];
lines.push('<!-- generated by scripts/quality/dashboard.mjs — do not hand-edit -->');
lines.push('# Quality Baseline — `src/lib/`');
lines.push('');
lines.push('_Snapshot of coverage, mutation score, CRAP, and dependency rules for `src/lib/` as of this commit._');
lines.push('');

// --- Summary per file ---
lines.push('## Summary per file');
lines.push('');
if (!covReport || !crapReport) {
  lines.push('⚠ Coverage or CRAP report missing — summary skipped.');
} else {
  const byFile = {};
  const coverageByFile = await loadCoverage();
  for (const [absPath, entries] of Object.entries(coverageByFile)) {
    const rel = relative(ROOT, absPath);
    const total = entries.length;
    const avgCov = total === 0 ? 1 : entries.reduce((s, e) => s + e.coverage, 0) / total;
    byFile[rel] = { coverage: avgCov, fns: total };
  }
  const maxCrapByFile = {};
  for (const r of crapReport.records) {
    maxCrapByFile[r.file] = Math.max(maxCrapByFile[r.file] ?? 0, r.crap);
  }
  const mutByFile = {};
  if (mutReport?.files) {
    for (const [p, data] of Object.entries(mutReport.files)) {
      const total = (data.mutants ?? []).length;
      const killed = (data.mutants ?? []).filter(m => m.status === 'Killed').length;
      mutByFile[relative(ROOT, p)] = total === 0 ? null : killed / total;
    }
  }

  const allFiles = new Set([...Object.keys(byFile), ...Object.keys(maxCrapByFile), ...Object.keys(mutByFile)]);
  const rows = [...allFiles].sort().map(f => [
    f,
    byFile[f] ? pct(byFile[f].coverage) : '—',
    mutByFile[f] == null ? '—' : pct(mutByFile[f]),
    maxCrapByFile[f] == null ? '—' : fmt(maxCrapByFile[f], 1),
  ]);
  lines.push(mdTable(['File', 'Line cov', 'Mutation', 'Max CRAP'], rows));
}
lines.push('');

// --- CRAP red band ---
lines.push('## CRAP danger band (>30)');
lines.push('');
if (!crapReport) {
  lines.push('⚠ CRAP report missing.');
} else {
  const danger = crapReport.records.filter(r => r.band === 'danger');
  if (danger.length === 0) {
    lines.push('_None — every function is within acceptable bounds._');
  } else {
    lines.push(mdTable(
      ['File', 'Function', 'Line', 'CC', 'Cov', 'CRAP'],
      danger.map(r => [r.file, r.name, r.line, r.complexity, pct(r.coverage), fmt(r.crap, 1)]),
    ));
  }
}
lines.push('');

// --- Coverage gaps ---
lines.push('## Coverage gaps (<50%)');
lines.push('');
if (!covReport) {
  lines.push('⚠ Coverage report missing.');
} else {
  const coverageByFile = await loadCoverage();
  const gaps = Object.entries(coverageByFile)
    .map(([p, entries]) => {
      const total = entries.length;
      const avg = total === 0 ? 1 : entries.reduce((s, e) => s + e.coverage, 0) / total;
      return { file: relative(ROOT, p), coverage: avg };
    })
    .filter(x => x.coverage < 0.5)
    .sort((a, b) => a.coverage - b.coverage);
  lines.push(gaps.length === 0
    ? '_All files above 50% coverage._'
    : mdTable(['File', 'Coverage'], gaps.map(g => [g.file, pct(g.coverage)])));
}
lines.push('');

// --- Mutation survivors (top 20) ---
lines.push('## Top 20 surviving mutants');
lines.push('');
if (!mutReport) {
  lines.push(skipMutation ? '_Skipped (--skip-mutation)._' : '⚠ Mutation report missing.');
} else {
  const survivors = [];
  for (const [p, data] of Object.entries(mutReport.files ?? {})) {
    for (const m of data.mutants ?? []) {
      if (m.status === 'Survived') {
        survivors.push({
          file: relative(ROOT, p),
          line: m.location?.start?.line ?? '—',
          mutator: m.mutatorName,
          replacement: (m.replacement ?? '').slice(0, 60),
        });
      }
    }
  }
  const top20 = survivors.slice(0, 20);
  lines.push(top20.length === 0
    ? '_No survivors._'
    : mdTable(['File', 'Line', 'Mutator', 'Replacement'], top20.map(s => [s.file, s.line, s.mutator, '`' + s.replacement + '`'])));
}
lines.push('');

// --- Dependency violations ---
lines.push('## Dependency violations');
lines.push('');
if (!depsReport) {
  lines.push('⚠ Deps report missing.');
} else {
  const vs = depsReport.summary?.violations ?? [];
  lines.push(vs.length === 0
    ? '_None._'
    : mdTable(['Rule', 'Severity', 'From', 'To'],
        vs.map(v => [v.rule?.name ?? '?', v.rule?.severity ?? '?', v.from, v.to])));
}
lines.push('');

// --- Footer ---
lines.push('---');
lines.push('');
lines.push(`**Generated:** ${new Date().toISOString()}  `);
lines.push(`**Commit:** \`${gitSha()}\``);
lines.push('');

await writeFile(OUT, lines.join('\n'));
console.log(`\n[dashboard] wrote ${OUT}`);
```

- [ ] **Step 2: Run dashboard (fast path)**

Run with mutation skipped for speed on this iteration:
```bash
node scripts/quality/dashboard.mjs --skip-mutation
```

Expected: four sections (coverage, crap, deps — mutation skipped) run; `docs/quality/BASELINE.md` is written with a "Skipped (--skip-mutation)" note in the mutation section.

- [ ] **Step 3: Run full dashboard**

Run:
```bash
node scripts/quality/dashboard.mjs
```

Expected: all four tools run. `BASELINE.md` contains all sections including top-20 surviving mutants.

- [ ] **Step 4: Verify determinism**

Run twice in a row and diff:
```bash
node scripts/quality/dashboard.mjs --skip-mutation
cp docs/quality/BASELINE.md /tmp/baseline1.md
node scripts/quality/dashboard.mjs --skip-mutation
diff /tmp/baseline1.md docs/quality/BASELINE.md
```

Expected: the only lines that differ are the "Generated:" timestamp at the footer. Data sections are byte-identical.

If data sections differ: check for nondeterministic sorts in `dashboard.mjs` or report generators and fix before proceeding.

- [ ] **Step 5: Commit**

```bash
git add scripts/quality/dashboard.mjs docs/quality/BASELINE.md
git commit -m "feat(quality): dashboard orchestrator + initial BASELINE.md snapshot"
```

---

## Task 12: Wire npm scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add quality scripts to package.json**

Edit `package.json`, adding these under `scripts` (alongside existing entries):

```json
"quality:coverage": "node scripts/quality/coverage.mjs",
"quality:mutation": "node scripts/quality/mutation.mjs",
"quality:crap": "node scripts/quality/crap.mjs",
"quality:deps": "node scripts/quality/deps.mjs",
"quality:all": "node scripts/quality/dashboard.mjs",
"quality:fast": "node scripts/quality/dashboard.mjs --skip-mutation"
```

- [ ] **Step 2: Verify each command runs via npm**

Run:
```bash
npm run quality:deps
npm run quality:coverage
npm run quality:crap
npm run quality:fast
```

Expected: all four complete successfully, producing their respective artifacts.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(quality): wire npm run quality:* scripts"
```

---

## Task 13: Final baseline regeneration + commit

**Files:**
- Modify: `docs/quality/BASELINE.md` (regenerated)

- [ ] **Step 1: Run full pipeline one more time**

Run:
```bash
npm run quality:all
```

Expected: completes end-to-end, writes fresh `docs/quality/BASELINE.md`.

- [ ] **Step 2: Read the report**

```bash
cat docs/quality/BASELINE.md
```

Verify the report contains:
- Summary-per-file table with at least 10 `src/lib/` entries
- CRAP danger band section (likely populated given current 0% coverage)
- Coverage gaps section (likely shows most files)
- Top-20 surviving mutants (populated from Stryker)
- Dependency violations section (may be empty)
- Timestamp + git SHA footer

- [ ] **Step 3: Commit only if BASELINE.md changed**

```bash
git add docs/quality/BASELINE.md
git diff --staged --quiet || git commit -m "chore(quality): refresh src/lib baseline snapshot"
```

Expected: either commits (if content changed since Task 11) or reports "nothing to commit".

---

## Self-Review

**Spec coverage (§14 Acceptance Criteria mapped to tasks):**

1. ✅ `quality:coverage` HTML report → Task 4 Step 2 + Task 12
2. ✅ `quality:mutation` Stryker HTML → Task 9 Step 3 + Task 12
3. ✅ `quality:crap` markdown with banding → Task 8 Step 2 + Task 12
4. ✅ `quality:deps` exits cleanly even on violations → Task 10 Step 2 (exit 0 baked in)
5. ✅ `quality:all` regenerates `BASELINE.md` → Task 11 Step 3 + Task 12
6. ✅ `BASELINE.md` committed → Task 11 Step 5
7. ✅ `reports/quality/` gitignored → Task 2
8. ✅ `test/quality-crap.test.js` passes → Task 3
9. ✅ Determinism check → Task 11 Step 4

**Placeholder scan:** No TBDs, no "add appropriate error handling", every code block is complete.

**Type/name consistency:**
- `crap(cc, coverage)` signature: Task 3 defines, Tasks 8 & 11 use. ✓
- `bandFor(score)` returns `'healthy' | 'acceptable' | 'danger'`: Task 3 defines, Task 8 uses. ✓
- `loadCoverage()` return shape `{ [absPath]: [{ name, line, coverage }] }`: Task 6 defines, Tasks 8 & 11 consume. ✓
- `loadComplexity()` return shape `{ [absPath]: [{ line, column, name, cc }] }`: Task 5 defines, Task 8 consumes. ✓
- `mdTable(headers, rows)`, `fmt(n, decimals)`, `pct(frac)`: Task 7 defines, Tasks 8 & 11 consume. ✓

Plan is internally consistent.
