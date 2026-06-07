# Honen Phase 0: step_rendition Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **MANDATORY:** Any task that creates or modifies a file under `functions/api/` MUST be executed by the `coder` agent (per rrm-academy-cf CLAUDE.md). Tasks 3, 4, 5, 7, 9 qualify.

**Goal:** Ship the multi-format lesson foundation: the `step_rendition` D1 table, gated runtime read endpoint, admin CRUD, CS3 schema gate, `renditions[]` in the build feed, and the quiz content migration to D1 with dual-read.

**Architecture:** One new D1 table keyed `(step_id, format)`. Content is served at runtime by a new gated endpoint whose trust anchor is a live three-way JOIN (rendition + step + course, all `published`). The static build only carries a per-step published-format list. Quiz content migrates from static `quizzes.json` into D1 rendition rows; `quiz.js` dual-reads (D1 first, static fallback) until a soak passes. Nothing learner-visible changes in Phase 0 (tabs are Phase 1).

**Tech Stack:** CF Pages Functions (JS), D1 (`rrm-auth`), wrangler, node:test (`npm test` globs `test/*.test.js`), eslint (`npm run lint` covers `functions/`), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-06-06-honen-style-courses-upgrade-design.md` (revised after /arise --deep, 28 findings folded in). Spec sections are cited per task.

**Out of scope for Phase 0** (do NOT build): player tab UI (Phase 1), generation skill (Phase 2), tutor (Phase 3), audio TTS + the `GET /api/courses/audio` streaming function (Phase 4; the admin endpoint accepts `audio` metadata rows but nothing streams them yet), engagement-events endpoint (Phase 1), quizzes.json retirement step 4e (deferred until after the dual-read soak; checklist at the end of this plan).

---

## Consolidated revert table (state BEFORE executing anything)

| Layer | Revert command | Notes |
|---|---|---|
| Branch + worktree | `git worktree remove ../rrm-academy-cf-phase0 --force && git branch -D claude/honen-phase0-renditions` | Full code revert before push. After push/auto-merge: revert the merge commit on main. |
| D1 table | `/opt/homebrew/bin/wrangler d1 execute rrm-auth --remote --command="DROP TABLE IF EXISTS step_rendition"` | OPTIONAL: an empty/unused `step_rendition` table is inert; leaving it is safe. |
| Quiz rendition rows | `/opt/homebrew/bin/wrangler d1 execute rrm-auth --remote --command="DELETE FROM step_rendition WHERE format='quiz' AND source='migrated:quizzes.json'"` | quiz.js dual-read falls back to static quizzes.json automatically; zero learner impact. |
| Published renditions kill switch | flip `status` to `archived` per row | Content blocked immediately by the live gate; tab visibility (Phase 1+) clears on next course dispatch. |

## Hard rules for the executor

0. **Non-interactive wrangler only.** Never `npx wrangler` in this pipeline (npx can hang on interactive prompts in lights-off execution). Use the GLOBAL binary `/opt/homebrew/bin/wrangler` (it is not a project dep). Auth: OAuth is NOT logged in on this machine; every wrangler-invoking shell command (including `npm run gates:courses` CS2 and the Task 8 scripts) must export this preamble first (shell env does not persist between tool calls):

```bash
export CLOUDFLARE_ACCOUNT_ID=ecf2c5bc8b5ebd634bcb587b3890910a
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/CF - D1 Operator - account/credential')
```

(`cfat_` account-scoped tokens require the explicit account ID. Verified working 2026-06-06.)
1. **No em dashes** in any file you write. Use commas, colons, parentheses.
2. **Deploy choreography (spec 8.2):** the D1 migration is applied to REMOTE D1 in Task 1, before any code referencing the table is pushed. All commits accumulate on ONE branch, `claude/honen-phase0-renditions`, with a SINGLE push at the very end (Task 11). Never push between tasks (memory: feedback-batch-arise-deploys).
3. **Worktree:** execute in an isolated worktree off `origin/main` (the shared clone is dirty on an unrelated branch). Use the superpowers:using-git-worktrees skill at execution start.
4. **Before the final push:** `npm run lint` && `npm test` && `npm run gates:courses:check` must all pass, and an `/arise --deep` pass over the new/modified `functions/api/` files must come back clean or have its findings fixed.
5. Existing test helpers live in `test/_helpers.js`: `mockRequest`, `mockDB(queryMap)` (substring-matched SQL routing with `first`/`all`/`run` specs and a `_calls` log), `mockEnv(overrides)`, `mockKV`, `mockWaitUntil`. Use them; do not reinvent.
6. `node --test` cannot import modules that statically import JSON (no import attributes in the codebase). Therefore: the new public endpoint (Task 3) is designed with NO import of `src/data/courses.json` (it reads live D1 instead, which is also the spec's trust-anchor posture), and the quiz dual-read logic (Task 9) lives in an importable helper that takes the static data as a parameter.

---

### Task 0: Worktree + branch setup

**Files:** none (git only)

- [ ] **Step 1: Create the worktree and branch**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
git fetch origin
git worktree add ../rrm-academy-cf-phase0 -b claude/honen-phase0-renditions origin/main
cd ../rrm-academy-cf-phase0
npm install
```

Expected: worktree created, branch `claude/honen-phase0-renditions` tracking `origin/main`, deps installed. All subsequent tasks run inside `../rrm-academy-cf-phase0`.

- [ ] **Step 1b: Verify wrangler authenticates non-interactively**

```bash
export CLOUDFLARE_ACCOUNT_ID=ecf2c5bc8b5ebd634bcb587b3890910a
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/CF - D1 Operator - account/credential')
/opt/homebrew/bin/wrangler d1 execute rrm-auth --remote --json --command="SELECT 1 AS ok"
```

Expected: JSON results, no prompt. (VERIFIED 2026-06-06 during plan review.) Do NOT continue until this is non-interactive.

- [ ] **Step 2: Commit the spec and this plan onto the branch**

The spec + plan currently sit untracked in the main clone. Copy them into the worktree if absent, then:

```bash
git add docs/superpowers/specs/2026-06-06-honen-style-courses-upgrade-design.md docs/superpowers/plans/2026-06-06-honen-phase0-step-renditions.md
git commit -m "docs: honen courses upgrade spec (arise-hardened) + phase 0 plan"
```

---

### Task 1: D1 migration + schema.sql mirror

**Files:**
- Create: `migrations/028-step-rendition.sql`
- Modify: `schema.sql` (append; doc mirror only, per memory rrm-academy-schema-sql-is-doc-mirror)

Spec: 3.1, 8.2 step 1.

- [ ] **Step 1: Write the migration file**

Create `migrations/028-step-rendition.sql` with exactly:

```sql
-- 028: step_rendition : multi-format lesson content (reading / flashcards / quiz / audio).
-- Spec: docs/superpowers/specs/2026-06-06-honen-style-courses-upgrade-design.md section 3.1.
--
-- FK is DECORATIVE in D1 (PRAGMA foreign_keys is not run). Cleanup is explicit
-- in the admin step/course DELETE handlers (see steps/[stepId].js + [id].js).
-- No secondary index: the (step_id, format) PK prefix covers both hot paths
-- (per-course published-format lookup uses step_id IN (...); runtime reads are
-- exact (step_id, format) point reads). status is never a leading filter alone.
-- Timestamps are set by endpoint code via datetime('now') in SQL, matching the
-- course_step admin endpoints.
CREATE TABLE IF NOT EXISTS step_rendition (
  step_id TEXT NOT NULL REFERENCES course_step(id),
  format TEXT NOT NULL CHECK (format IN ('reading','flashcards','quiz','audio')),
  content_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  source TEXT,
  word_count INTEGER,
  duration_seconds INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (step_id, format)
);
```

- [ ] **Step 2: Apply to remote D1 (BEFORE any code push, spec 8.2 step 1)**

```bash
export CLOUDFLARE_ACCOUNT_ID=ecf2c5bc8b5ebd634bcb587b3890910a
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/CF - D1 Operator - account/credential')
/opt/homebrew/bin/wrangler d1 execute rrm-auth --remote --file=migrations/028-step-rendition.sql
```

Expected: success output, no errors.

- [ ] **Step 3: Verify live schema**

```bash
/opt/homebrew/bin/wrangler d1 execute rrm-auth --remote --json --command="SELECT sql FROM sqlite_master WHERE name='step_rendition'"
```

Expected: the CREATE TABLE DDL with both CHECK constraints visible.

- [ ] **Step 4: Append the same block to `schema.sql`**

Open `schema.sql`, append the identical `CREATE TABLE IF NOT EXISTS step_rendition (...)` block (with a one-line comment `-- step_rendition: multi-format lesson content. Added by migrations/028-step-rendition.sql.`) after the `course_step` table block. schema.sql is a documentation mirror, not provisioning SSOT; keep it in sync.

- [ ] **Step 5: Commit**

```bash
git add migrations/028-step-rendition.sql schema.sql
git commit -m "feat(courses): step_rendition table (migration 025, applied to remote) + schema.sql mirror"
```

---

### Task 2: HTML sanitizer (`_sanitize.js`)

**Files:**
- Create: `functions/api/courses/_sanitize.js`
- Test: `test/sanitize-html.test.js`

Spec: 3.2 (XSS block). Pure JS, no deps, escape-by-default with fixpoint iteration so malformed-nesting smuggling (`<scr<script>ipt>`) cannot survive. Threat model: defense-in-depth under admin-role auth plus AI-generated HTML.

- [ ] **Step 1: Write the failing tests**

Create `test/sanitize-html.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml } from '../functions/api/courses/_sanitize.js';

test('passes through allowed tags and attributes', () => {
  const input = '<h2>Title</h2><p>Body with <strong>bold</strong> and <a href="https://rrmacademy.org/glossary/">a link</a>.</p>';
  assert.equal(sanitizeHtml(input), input);
});

test('keeps callout and term-card divs with class attribute', () => {
  const input = '<aside class="key-insight"><p>Insight</p></aside><div class="term-card"><p>Term</p></div>';
  assert.equal(sanitizeHtml(input), input);
});

test('strips class values not in the component allowlist', () => {
  const out = sanitizeHtml('<div class="evil-hook term-card"><p>x</p></div><span class="tracking-pixel">y</span>');
  assert.ok(out.includes('class="term-card"'));
  assert.ok(!out.includes('evil-hook'));
  assert.ok(out.includes('<span>y</span>'));
});

test('escapes script tags entirely', () => {
  const out = sanitizeHtml('<p>hi</p><script>alert(1)</script>');
  assert.ok(!out.includes('<script'));
  assert.ok(out.includes('<p>hi</p>'));
});

test('strips event handler attributes', () => {
  const out = sanitizeHtml('<img src="https://rrmacademy.org/x.png" onerror="alert(1)">');
  assert.ok(!out.includes('onerror'));
  assert.ok(out.includes('<img'));
});

test('strips javascript: URLs', () => {
  const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
  assert.ok(!out.toLowerCase().includes('javascript:'));
});

test('survives nested-tag smuggling (fixpoint)', () => {
  const out = sanitizeHtml('<scr<script>ipt>alert(1)</scr</script>ipt>');
  assert.ok(!out.includes('<script'));
  assert.ok(!/<scr<script>/i.test(out));
});

test('escapes unknown tags instead of dropping content', () => {
  const out = sanitizeHtml('<marquee>text</marquee>');
  assert.ok(out.includes('text'));
  assert.ok(!out.includes('<marquee>'));
});

test('strips style and iframe', () => {
  const out = sanitizeHtml('<style>p{}</style><iframe src="https://x.com"></iframe>');
  assert.ok(!out.includes('<style'));
  assert.ok(!out.includes('<iframe'));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/sanitize-html.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the sanitizer**

Create `functions/api/courses/_sanitize.js`:

```js
/**
 * Allowlist HTML sanitizer for reading renditions (spec 3.2).
 * Escape-by-default: any tag token that is not an allowed tag with clean
 * attributes is HTML-escaped, not dropped, so content survives but markup
 * cannot execute. Iterates to a fixpoint so nested-tag smuggling cannot
 * reassemble a tag after one pass. Defense-in-depth under admin-role auth;
 * also applied to AI-generated HTML before any write (spec section 6).
 * Prefixed with _ so CF Pages does not treat it as a route handler.
 */

const ALLOWED_TAGS = new Set([
  'p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'br',
  'a', 'blockquote', 'figure', 'figcaption', 'img', 'aside', 'div',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre', 'span',
]);

// Per-tag attribute allowlist. 'class' is allowed on aside/div/span ONLY for
// the spec 3.2 component classes (filtered to ALLOWED_CLASSES below, so an
// arbitrary class can never target site CSS/JS hooks); href/src are
// protocol-checked below.
const ALLOWED_CLASSES = new Set(['key-insight', 'misconception', 'fun-fact', 'term-card', 'callout']);

const ALLOWED_ATTRS = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  aside: new Set(['class']),
  div: new Set(['class']),
  span: new Set(['class']),
  th: new Set(['scope']),
  td: new Set(['colspan', 'rowspan']),
};

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(value) {
  const v = value.trim();
  if (v.startsWith('/') && !v.startsWith('//')) return true; // site-relative
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Sanitize one tag token. Returns the clean tag string, or null if the token
 *  is not an acceptable tag (caller escapes it). */
function sanitizeTag(token) {
  const m = token.match(/^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)(\/?)>$/);
  if (!m) return null;
  const [, closing, rawName, rawAttrs, selfClose] = m;
  const name = rawName.toLowerCase();
  if (!ALLOWED_TAGS.has(name)) return null;
  if (closing) return `</${name}>`;

  const allowed = ALLOWED_ATTRS[name] || new Set();
  const cleanAttrs = [];
  const attrRe = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let am;
  while ((am = attrRe.exec(rawAttrs)) !== null) {
    const attrName = am[1].toLowerCase();
    const attrValue = am[3] !== undefined ? am[3] : am[4];
    if (!allowed.has(attrName)) continue;
    if (attrName.startsWith('on')) continue;
    if ((attrName === 'href' || attrName === 'src') && !safeUrl(attrValue)) continue;
    if (attrValue.includes('<') || attrValue.includes('>')) continue;
    if (attrName === 'class') {
      const kept = attrValue.split(/\s+/).filter((cls) => ALLOWED_CLASSES.has(cls));
      if (kept.length === 0) continue;
      cleanAttrs.push(`class="${kept.join(' ')}"`);
      continue;
    }
    cleanAttrs.push(`${attrName}="${attrValue.replace(/"/g, '&quot;')}"`);
  }
  const attrStr = cleanAttrs.length ? ' ' + cleanAttrs.join(' ') : '';
  return `<${name}${attrStr}${selfClose ? ' /' : ''}>`;
}

function sanitizeOnce(html) {
  return html.replace(/<[^>]*>?/g, (token) => {
    if (!token.endsWith('>')) return escapeHtml(token); // unterminated '<'
    const clean = sanitizeTag(token);
    return clean !== null ? clean : escapeHtml(token);
  });
}

export function sanitizeHtml(html) {
  if (typeof html !== 'string') return '';
  let prev = html;
  for (let i = 0; i < 5; i++) {
    const next = sanitizeOnce(prev);
    if (next === prev) return next;
    prev = next;
  }
  return prev;
}

/** Word count for reading renditions: strip tags, normalize whitespace.
 *  Mirrors the computeWordCount convention (thin-page pattern). */
export function computeWordCount(html) {
  if (typeof html !== 'string') return 0;
  const text = html.replace(/<[^>]*>/g, ' ');
  return text.trim().split(/\s+/).filter(Boolean).length;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/sanitize-html.test.js`
Expected: all 9 PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/courses/_sanitize.js test/sanitize-html.test.js
git commit -m "feat(courses): allowlist HTML sanitizer for reading renditions"
```

---

### Task 3: Public rendition endpoint (`GET /api/courses/rendition`)

**Files:**
- Create: `functions/api/courses/rendition.js`
- Test: `test/courses-rendition.test.js`

Spec: 3.3, 3.3.1 (trust-anchor JOIN), 3.3.2 (gate matrix), 3.3.3 (error taxonomy). **Coder agent mandatory.**

Design notes locked by the spec:
- Trust anchor: live D1 JOIN; never a caller-supplied courseId. Serve only when rendition AND step AND course are all `status='published'`.
- Gate matrix: members course -> `requireMember()`; paid (`is_free=0`) -> active enrollment in the RESOLVED course; free -> session only; affiliate/unknown stepIds have no D1 row so the JOIN yields the indistinguishable 404.
- Error taxonomy: draft/archived/missing -> identical `404 {ok:false,error:'rendition_not_available'}`; bad format -> `400 {ok:false,error:'invalid_format'}`; `JSON.parse` failure -> `500 {ok:false,error:'server_error'}` (log internally).
- Step-lock: computed from LIVE D1 ordering (sections by sort_order, steps by sort_order), not baked courses.json. This deliberately avoids importing JSON (testability) and matches the live-JOIN posture; it is equivalent to the player's order for published content.
- Superadmin auto-enroll: `session.role === 'superadmin'` (validateSession returns `role`) -> upsert enrollment, mirroring `autoEnrollAdmin`.
- Quiz format: strip `correctIndex` exactly like `quiz.js` GET.
- Audio format: return `{duration, voice}` only, never `r2_key`.

- [ ] **Step 1: Write the failing tests**

Create `test/courses-rendition.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockDB, mockEnv, mockWaitUntil } from './_helpers.js';
import { onRequestGet } from '../functions/api/courses/rendition.js';

const FUTURE = Math.floor(Date.now() / 1000) + 86400 * 20;

function sessionRow(role = 'user') {
  return { id: 'sess1', user_id: 'user1', expires_at: FUTURE, blocked: 0, role };
}

function renditionRow(over = {}) {
  return {
    content_json: JSON.stringify({ html: '<p>hello world</p>' }),
    rendition_status: 'published',
    word_count: 2,
    course_id: 'course-free',
    step_status: 'published',
    course_status: 'published',
    access_type: 'public',
    is_free: 1,
    settings_json: null,
    ...over,
  };
}

function ctx(queryMap, { cookie = 'session=sess1', url = 'https://rrmacademy.org/api/courses/rendition?stepId=step-1&format=reading' } = {}) {
  const db = mockDB(queryMap);
  const env = mockEnv({ DB: db });
  const request = {
    url,
    headers: { get: (n) => (n.toLowerCase() === 'cookie' ? cookie : null) },
  };
  return { request, env, waitUntil: mockWaitUntil(), db };
}

test('401 when not authenticated', async () => {
  const { request, env, waitUntil } = ctx({ 'FROM session': { first: null } });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 401);
});

test('400 on invalid format', async () => {
  const { request, env, waitUntil } = ctx(
    { 'FROM session': { first: sessionRow() } },
    { url: 'https://rrmacademy.org/api/courses/rendition?stepId=step-1&format=video' }
  );
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_format');
});

test('404 rendition_not_available when no row (missing)', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: null },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'rendition_not_available');
});

test('404 rendition_not_available when rendition is draft (indistinguishable from missing)', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ rendition_status: 'draft' }) },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'rendition_not_available');
});

test('404 when step is archived even if rendition published', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ step_status: 'archived' }) },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 404);
});

test('free course: session is enough, returns reading html + wordCount', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow() },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.format, 'reading');
  assert.equal(body.html, '<p>hello world</p>');
  assert.equal(body.wordCount, 2);
});

test('paid course: 403 without enrollment', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ is_free: 0, course_id: 'course-paid' }) },
    'FROM enrollment': { first: null },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 403);
});

test('paid course: 200 with active enrollment', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ is_free: 0, course_id: 'course-paid' }) },
    'FROM enrollment': { first: { id: 'enr1' } },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 200);
});

test('quiz format strips correctIndex', async () => {
  const quiz = {
    type: 'quiz', title: 'T', description: 'D', passingScore: 80,
    questions: [{ id: 'q1', text: 'Q?', options: ['a', 'b'], correctIndex: 1 }],
  };
  const { request, env, waitUntil } = ctx(
    {
      'FROM session': { first: sessionRow() },
      'FROM step_rendition': { first: renditionRow({ content_json: JSON.stringify(quiz) }) },
    },
    { url: 'https://rrmacademy.org/api/courses/rendition?stepId=step-1&format=quiz' }
  );
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.quiz.questions[0].correctIndex, undefined);
  assert.equal(body.quiz.passingScore, 80);
});

test('audio format returns metadata without r2_key', async () => {
  const audio = { r2_key: 'courses/audio/step-1.mp3', voice: 'neutral-1', duration_seconds: 540 };
  const { request, env, waitUntil } = ctx(
    {
      'FROM session': { first: sessionRow() },
      'FROM step_rendition': { first: renditionRow({ content_json: JSON.stringify(audio) }) },
    },
    { url: 'https://rrmacademy.org/api/courses/rendition?stepId=step-1&format=audio' }
  );
  const res = await onRequestGet({ request, env, waitUntil });
  const body = await res.json();
  assert.equal(body.duration, 540);
  assert.equal(body.voice, 'neutral-1');
  assert.equal(body.r2_key, undefined);
});

test('500 server_error on malformed content_json', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ content_json: '{not json' }) },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'server_error');
});

test('step-lock: 403 when fixed order and previous step incomplete', async () => {
  const { request, env, waitUntil } = ctx(
    {
      'FROM session': { first: sessionRow() },
      'FROM step_rendition': { first: renditionRow({ settings_json: JSON.stringify({ stepOrder: 'fixed' }), course_id: 'course-free' }) },
      'ORDER BY sec.sort_order': { all: { results: [{ id: 'step-0' }, { id: 'step-1' }] } },
      'FROM step_progress': { first: { completed: 0 } },
    },
    { url: 'https://rrmacademy.org/api/courses/rendition?stepId=step-1&format=reading' }
  );
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 403);
});
```

Note: the member-course path (`access_type='members'` -> `requireMember`) is intentionally NOT unit-tested (requireMember pulls KV + Stripe; covered by e2e in Task 10 and existing member-gate coverage).

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test test/courses-rendition.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the endpoint**

Create `functions/api/courses/rendition.js`:

```js
/**
 * GET /api/courses/rendition?stepId=&format=
 *
 * Runtime read path for step renditions (spec 3.3). Trust anchor (3.3.1):
 * the owning course is resolved from course_step.course_id via a live D1
 * JOIN; content is served ONLY when rendition + step + course are all
 * status='published'. Never trusts a caller-supplied courseId.
 *
 * Gate matrix (3.3.2): members -> requireMember(); paid -> active enrollment
 * in the resolved course; free -> session only. Affiliate/unknown stepIds
 * have no D1 row -> the indistinguishable 404.
 *
 * Error taxonomy (3.3.3): draft/archived/missing -> identical
 * 404 rendition_not_available; bad format -> 400 invalid_format;
 * content_json parse failure -> 500 server_error (logged internally).
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession, generateId,
} from '../auth/_shared.js';
import { log } from '../_log.js';
import { requireMember } from '../community/_shared.js';

const VALID_FORMATS = new Set(['reading', 'flashcards', 'quiz', 'audio']);

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    const url = new URL(request.url);
    const stepId = url.searchParams.get('stepId');
    const format = url.searchParams.get('format');
    if (!stepId || typeof stepId !== 'string' || stepId.length > 100) {
      return json({ ok: false, error: 'invalid_step' }, 400);
    }
    if (!format || !VALID_FORMATS.has(format)) {
      return json({ ok: false, error: 'invalid_format' }, 400);
    }

    // Trust-anchor JOIN (spec 3.3.1). Statuses checked in JS so draft /
    // archived / missing are indistinguishable in the response.
    const row = await db.prepare(`
      SELECT r.content_json, r.status AS rendition_status, r.word_count,
             s.course_id, s.status AS step_status,
             c.status AS course_status, c.access_type, c.is_free, c.settings_json
      FROM step_rendition r
      JOIN course_step s ON s.id = r.step_id
      JOIN course c ON c.id = s.course_id
      WHERE r.step_id = ?1 AND r.format = ?2
    `).bind(stepId, format).first();

    if (
      !row ||
      row.rendition_status !== 'published' ||
      row.step_status !== 'published' ||
      row.course_status !== 'published'
    ) {
      return json({ ok: false, error: 'rendition_not_available' }, 404);
    }

    const courseId = row.course_id;

    if (row.access_type === 'members') {
      // Live membership re-check; membership IS the grant (mirrors stream/token.js).
      const memberResult = await requireMember(request, env);
      if (memberResult instanceof Response) return memberResult;
    } else if (!Number(row.is_free)) {
      // Paid course: active enrollment in the RESOLVED course required.
      if (session.role === 'superadmin') {
        await db.prepare(
          'INSERT INTO enrollment (id, user_id, course_id) VALUES (?, ?, ?)' +
          ' ON CONFLICT(user_id, course_id) DO UPDATE SET revoked_at = NULL'
        ).bind(generateId(), session.userId, courseId).run();
      }
      const enrollment = await db.prepare(
        'SELECT id FROM enrollment WHERE user_id = ? AND course_id = ? AND revoked_at IS NULL'
      ).bind(session.userId, courseId).first();
      if (!enrollment) return json({ ok: false, error: 'Not enrolled' }, 403);
    }
    // Free course: session is enough (stream/token.js all-free precedent,
    // intentional divergence from quiz.js documented in spec 3.3.2).

    // Step-lock from LIVE D1 ordering (published steps only).
    let settings = null;
    if (row.settings_json) {
      try { settings = JSON.parse(row.settings_json); } catch { settings = null; }
    }
    if (settings?.stepOrder === 'fixed') {
      const { results: ordered } = await db.prepare(`
        SELECT s.id FROM course_step s
        JOIN course_section sec ON sec.id = s.section_id
        WHERE s.course_id = ? AND s.status = 'published'
        ORDER BY sec.sort_order ASC, s.sort_order ASC
      `).bind(courseId).all();
      const ids = (ordered || []).map((r) => r.id);
      const idx = ids.indexOf(stepId);
      if (idx > 0) {
        const prevStepId = ids[idx - 1];
        const prev = await db.prepare(
          'SELECT completed FROM step_progress WHERE user_id = ? AND course_id = ? AND step_id = ?'
        ).bind(session.userId, courseId, prevStepId).first();
        if (!prev?.completed) {
          return json({ ok: false, error: 'Previous step not completed' }, 403);
        }
      }
    }

    let content;
    try {
      content = JSON.parse(row.content_json);
    } catch (err) {
      log(env, waitUntil, 'courses', 'rendition_parse_error', 'error', `${stepId}/${format}: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'server_error' }, 500);
    }

    if (format === 'reading') {
      return json({ ok: true, format, html: content.html, wordCount: row.word_count ?? null });
    }
    if (format === 'flashcards') {
      return json({ ok: true, format, cards: content.cards });
    }
    if (format === 'quiz') {
      const safeQuestions = (content.questions || []).map((q) => {
        if (content.type === 'quiz') {
          const { correctIndex: _correctIndex, ...rest } = q;
          return rest;
        }
        return q;
      });
      return json({
        ok: true,
        format,
        quiz: {
          type: content.type,
          title: content.title,
          description: content.description,
          passingScore: content.passingScore,
          questions: safeQuestions,
        },
      });
    }
    // audio: metadata only, never r2_key (binary path is Phase 4).
    return json({ ok: true, format, duration: content.duration_seconds ?? null, voice: content.voice ?? null });
  } catch (err) {
    log(env, waitUntil, 'courses', 'rendition_error', 'error', `GET: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/courses-rendition.test.js`
Expected: all 12 PASS.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add functions/api/courses/rendition.js test/courses-rendition.test.js
git commit -m "feat(courses): gated runtime rendition endpoint (trust-anchor JOIN, gate matrix, error taxonomy)"
```

---

### Task 4: Admin renditions CRUD

**Files:**
- Create: `functions/api/admin/courses/[id]/steps/[stepId]/renditions.js`
- Test: `test/admin-renditions.test.js`

Spec: 3.4. **Coder agent mandatory.** Routing note: the existing file `[stepId].js` and a sibling directory `[stepId]/` coexist fine in CF Pages routing (precedent: `[id].js` + `[id]/steps.js`).

Endpoint contract:
- `GET /api/admin/courses/:id/steps/:stepId/renditions` -> list ALL formats for the step (any status), `{ok:true, data:[...]}` with parsed content.
- `PUT` same path, body `{format, content, status?, source?}` -> idempotent upsert `ON CONFLICT(step_id, format) DO UPDATE` (spec finding #20).
- `DELETE` same path + `?format=` -> delete one rendition; for `audio`, delete the backing R2 object too.

Guards (all from spec 3.4): admin/superadmin role; ownership chain (`course_step WHERE id=? AND course_id=?` -> 404); `VALID_FORMATS`/`VALID_STATUSES`; per-format shape validation; per-format size caps with `400 content_too_large` (reading 80000, flashcards 32000, quiz 32000, audio 1000 bytes of serialized content); empty content -> `400 content_empty`; reading HTML sanitized via `_sanitize.js` + `word_count` computed; cert-quiz protection: DELETE or status->draft/archived of a `quiz` rendition whose step is any course's `certificate_quiz_step_id` -> `409 step_referenced_as_certificate_quiz`.

- [ ] **Step 1: Write the failing tests**

Create `test/admin-renditions.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockDB, mockEnv, mockRequest, mockWaitUntil } from './_helpers.js';
import { onRequestGet, onRequestPut, onRequestDelete } from '../functions/api/admin/courses/[id]/steps/[stepId]/renditions.js';

function adminCtx(queryMap, { method = 'PUT', body, query = '', role = 'admin' } = {}) {
  const db = mockDB(queryMap);
  const env = mockEnv({ DB: db, R2_ASSETS: { deleted: [], async delete(k) { this.deleted.push(k); } } });
  const request = mockRequest(method, {
    body,
    url: `https://rrmacademy.org/api/admin/courses/course-1/steps/step-1/renditions${query}`,
  });
  return {
    request, env, waitUntil: mockWaitUntil(), db,
    params: { id: 'course-1', stepId: 'step-1' },
    data: { user: { id: 'admin1', role } },
  };
}

const STEP_EXISTS = { 'FROM course_step WHERE id = ? AND course_id = ?': { first: { id: 'step-1' } } };

test('401 without user, 403 for non-admin', async () => {
  const c1 = adminCtx({});
  c1.data = {};
  assert.equal((await onRequestGet(c1)).status, 401);
  const c2 = adminCtx({}, { role: 'user' });
  assert.equal((await onRequestGet(c2)).status, 403);
});

test('PUT 404 when step does not belong to course (ownership chain)', async () => {
  const c = adminCtx(
    { 'FROM course_step WHERE id = ? AND course_id = ?': { first: null } },
    { body: { format: 'reading', content: { html: '<p>x</p>' } } }
  );
  assert.equal((await onRequestPut(c)).status, 404);
});

test('PUT 400 invalid_format', async () => {
  const c = adminCtx(STEP_EXISTS, { body: { format: 'video', content: { html: '<p>x</p>' } } });
  const res = await onRequestPut(c);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_format');
});

test('PUT 400 content_empty on empty cards array', async () => {
  const c = adminCtx(STEP_EXISTS, { body: { format: 'flashcards', content: { cards: [] } } });
  const res = await onRequestPut(c);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'content_empty');
});

test('PUT 400 content_too_large over per-format cap', async () => {
  const big = 'x'.repeat(81000);
  const c = adminCtx(STEP_EXISTS, { body: { format: 'reading', content: { html: `<p>${big}</p>` } } });
  const res = await onRequestPut(c);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'content_too_large');
});

test('PUT sanitizes reading html and computes word_count', async () => {
  const qm = {
    ...STEP_EXISTS,
    'INSERT INTO step_rendition': { run: { success: true, meta: { changes: 1 } } },
    'FROM step_rendition WHERE step_id = ? AND format = ?': {
      first: {
        step_id: 'step-1', format: 'reading', status: 'draft', source: null,
        content_json: JSON.stringify({ html: '<p>clean</p>' }), word_count: 1,
        created_at: 'x', updated_at: 'x', duration_seconds: null,
      },
    },
  };
  const c = adminCtx(qm, { body: { format: 'reading', content: { html: '<p>clean</p><script>alert(1)</script>' } } });
  const res = await onRequestPut(c);
  assert.equal(res.status, 200);
  const insert = c.db._calls.find((x) => x.sql.includes('INSERT INTO step_rendition'));
  assert.ok(insert, 'expected upsert');
  const storedJson = insert.bound.find((b) => typeof b === 'string' && b.startsWith('{'));
  assert.ok(!storedJson.includes('<script'));
});

test('PUT quiz validates question shape', async () => {
  const c = adminCtx(STEP_EXISTS, {
    body: { format: 'quiz', content: { type: 'quiz', questions: [{ id: 'q1', text: 'Q', options: ['a'], correctIndex: 5 }] } },
  });
  const res = await onRequestPut(c);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_content');
});

test('DELETE 409 for cert-quiz quiz rendition', async () => {
  const qm = {
    ...STEP_EXISTS,
    'certificate_quiz_step_id': { first: { id: 'course-1' } },
  };
  const c = adminCtx(qm, { method: 'DELETE', query: '?format=quiz' });
  const res = await onRequestDelete(c);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'step_referenced_as_certificate_quiz');
});

test('DELETE audio removes R2 object', async () => {
  const qm = {
    ...STEP_EXISTS,
    'FROM step_rendition WHERE step_id = ? AND format = ?': {
      first: { content_json: JSON.stringify({ r2_key: 'courses/audio/step-1.mp3' }) },
    },
    'DELETE FROM step_rendition': { run: { success: true, meta: { changes: 1 } } },
  };
  const c = adminCtx(qm, { method: 'DELETE', query: '?format=audio' });
  const res = await onRequestDelete(c);
  assert.equal(res.status, 200);
  assert.deepEqual(c.env.R2_ASSETS.deleted, ['courses/audio/step-1.mp3']);
});

test('PUT status archived on cert-quiz quiz rendition is refused 409', async () => {
  const qm = { ...STEP_EXISTS, 'certificate_quiz_step_id': { first: { id: 'course-1' } } };
  const c = adminCtx(qm, {
    body: { format: 'quiz', status: 'archived', content: { type: 'quiz', questions: [{ id: 'q1', text: 'Q', options: ['a', 'b'], correctIndex: 0 }] } },
  });
  const res = await onRequestPut(c);
  assert.equal(res.status, 409);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test test/admin-renditions.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the endpoint**

Create `functions/api/admin/courses/[id]/steps/[stepId]/renditions.js`:

```js
/**
 * Admin CRUD for step renditions (spec 3.4).
 *   GET    /api/admin/courses/:id/steps/:stepId/renditions          list all formats (any status)
 *   PUT    /api/admin/courses/:id/steps/:stepId/renditions          upsert one format
 *   DELETE /api/admin/courses/:id/steps/:stepId/renditions?format=  delete one format
 *
 * PUT body: { format, content, status?, source? }. Upsert is idempotent
 * (ON CONFLICT(step_id, format) DO UPDATE) so generation re-runs are safe.
 * Guards: ownership chain, VALID_FORMATS/VALID_STATUSES, per-format shape +
 * size caps, content_empty, reading sanitization + word_count, and the
 * cert-quiz 409 refusal on DELETE / archive of a quiz rendition.
 */
import { json, optionsResponse } from '../../../../../auth/_shared.js';
import { log } from '../../../../../_log.js';
import { sanitizeHtml, computeWordCount } from '../../../../../courses/_sanitize.js';

const VALID_FORMATS = new Set(['reading', 'flashcards', 'quiz', 'audio']);
const VALID_STATUSES = new Set(['draft', 'published', 'archived']);

// Per-format byte caps on serialized content (spec 3.2). Reading sits under
// D1's ~100KB single-statement limit with headroom.
const SIZE_CAPS = { reading: 80000, flashcards: 32000, quiz: 32000, audio: 1000 };

export function onRequestOptions() {
  return optionsResponse();
}

function requireAdmin(context) {
  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (!['superadmin', 'admin'].includes(user.role)) {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }
  return null;
}

function validateParams(context) {
  const courseId = context.params?.id;
  const stepId = context.params?.stepId;
  if (!courseId || typeof courseId !== 'string' || courseId.length > 100) return null;
  if (!stepId || typeof stepId !== 'string' || stepId.length > 100) return null;
  return { courseId, stepId };
}

async function stepInCourse(db, stepId, courseId) {
  return db.prepare(
    'SELECT id FROM course_step WHERE id = ? AND course_id = ?'
  ).bind(stepId, courseId).first();
}

async function certQuizRef(db, stepId) {
  return db.prepare(
    'SELECT id FROM course WHERE certificate_quiz_step_id = ?'
  ).bind(stepId).first();
}

function mapRendition(r) {
  let content = null;
  try { content = JSON.parse(r.content_json); } catch { content = null; }
  const out = {
    stepId: r.step_id,
    format: r.format,
    status: r.status,
    content,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.source != null) out.source = r.source;
  if (r.word_count != null) out.wordCount = r.word_count;
  if (r.duration_seconds != null) out.duration = r.duration_seconds;
  return out;
}

/**
 * Validate + normalize content for a format.
 * Returns { error } on rejection, or { content, wordCount, durationSeconds }.
 */
function validateContent(format, content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { error: 'invalid_content' };
  }
  if (format === 'reading') {
    if (typeof content.html !== 'string' || !content.html.trim()) return { error: 'content_empty' };
    const html = sanitizeHtml(content.html);
    if (!html.trim()) return { error: 'content_empty' };
    return { content: { html }, wordCount: computeWordCount(html), durationSeconds: null };
  }
  if (format === 'flashcards') {
    if (!Array.isArray(content.cards)) return { error: 'invalid_content' };
    if (content.cards.length === 0) return { error: 'content_empty' };
    for (const card of content.cards) {
      if (!card || typeof card !== 'object') return { error: 'invalid_content' };
      if (typeof card.front !== 'string' || !card.front.trim() || card.front.length > 2000) return { error: 'invalid_content' };
      if (typeof card.back !== 'string' || !card.back.trim() || card.back.length > 4000) return { error: 'invalid_content' };
      if (card.source_claim_id !== undefined && (typeof card.source_claim_id !== 'string' || card.source_claim_id.length > 100)) return { error: 'invalid_content' };
    }
    return { content: { cards: content.cards }, wordCount: null, durationSeconds: null };
  }
  if (format === 'quiz') {
    if (!['quiz', 'questionnaire'].includes(content.type)) return { error: 'invalid_content' };
    if (!Array.isArray(content.questions)) return { error: 'invalid_content' };
    if (content.questions.length === 0) return { error: 'content_empty' };
    if (content.passingScore != null && (!Number.isInteger(content.passingScore) || content.passingScore < 0 || content.passingScore > 100)) {
      return { error: 'invalid_content' };
    }
    for (const q of content.questions) {
      if (!q || typeof q !== 'object') return { error: 'invalid_content' };
      if (typeof q.id !== 'string' || !q.id || typeof q.text !== 'string' || !q.text) return { error: 'invalid_content' };
      if (content.type === 'quiz') {
        if (!Array.isArray(q.options) || q.options.length < 2 || !q.options.every((o) => typeof o === 'string')) return { error: 'invalid_content' };
        if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length) return { error: 'invalid_content' };
      } else {
        if (!['likert', 'freetext', 'multiselect'].includes(q.type)) return { error: 'invalid_content' };
        if (q.type === 'multiselect' && (!Array.isArray(q.options) || q.options.length === 0)) return { error: 'invalid_content' };
      }
    }
    return { content, wordCount: null, durationSeconds: null };
  }
  // audio: metadata only.
  if (typeof content.r2_key !== 'string' || !/^courses\/audio\/[a-z0-9][a-z0-9-]*\.mp3$/.test(content.r2_key)) return { error: 'invalid_content' };
  if (content.voice !== undefined && (typeof content.voice !== 'string' || content.voice.length > 100)) return { error: 'invalid_content' };
  if (content.duration_seconds !== undefined && (!Number.isInteger(content.duration_seconds) || content.duration_seconds < 0 || content.duration_seconds > 86400)) return { error: 'invalid_content' };
  return { content, wordCount: null, durationSeconds: content.duration_seconds ?? null };
}

export async function onRequestGet(context) {
  const denied = requireAdmin(context);
  if (denied) return denied;
  const { env, waitUntil } = context;
  if (!env.DB) return json({ ok: false, error: 'Server misconfigured' }, 503);
  const params = validateParams(context);
  if (!params) return json({ ok: false, error: 'invalid_id' }, 400);
  try {
    const step = await stepInCourse(env.DB, params.stepId, params.courseId);
    if (!step) return json({ ok: false, error: 'step_not_found' }, 404);
    const { results } = await env.DB.prepare(
      'SELECT * FROM step_rendition WHERE step_id = ? ORDER BY format ASC'
    ).bind(params.stepId).all();
    return json({ ok: true, data: (results || []).map(mapRendition) });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'rendition_list_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestPut(context) {
  const denied = requireAdmin(context);
  if (denied) return denied;
  const { request, env, waitUntil } = context;
  if (!env.DB) return json({ ok: false, error: 'Server misconfigured' }, 503);
  const params = validateParams(context);
  if (!params) return json({ ok: false, error: 'invalid_id' }, 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

  const { format, content, status, source } = body;
  if (!VALID_FORMATS.has(format)) return json({ ok: false, error: 'invalid_format' }, 400);
  if (status !== undefined && !VALID_STATUSES.has(status)) return json({ ok: false, error: 'invalid_status' }, 400);
  if (source !== undefined && source !== null && (typeof source !== 'string' || source.length > 200)) {
    return json({ ok: false, error: 'invalid_source' }, 400);
  }

  const validated = validateContent(format, content);
  if (validated.error) return json({ ok: false, error: validated.error }, 400);

  const serialized = JSON.stringify(validated.content);
  if (serialized.length > SIZE_CAPS[format]) {
    return json({ ok: false, error: 'content_too_large' }, 400);
  }

  try {
    const step = await stepInCourse(env.DB, params.stepId, params.courseId);
    if (!step) return json({ ok: false, error: 'step_not_found' }, 404);

    // Cert-quiz protection: archiving / drafting the quiz rendition of a
    // cert-quiz step removes the content certificates depend on (spec 3.4).
    if (format === 'quiz' && (status === 'draft' || status === 'archived')) {
      const certRef = await certQuizRef(env.DB, params.stepId);
      if (certRef) {
        return json({ ok: false, error: 'step_referenced_as_certificate_quiz', courseId: certRef.id }, 409);
      }
    }

    await env.DB.prepare(`
      INSERT INTO step_rendition (step_id, format, content_json, status, source, word_count, duration_seconds, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'), datetime('now'))
      ON CONFLICT(step_id, format) DO UPDATE SET
        content_json = ?3,
        status = COALESCE(?8, step_rendition.status),
        source = COALESCE(?5, step_rendition.source),
        word_count = ?6,
        duration_seconds = ?7,
        updated_at = datetime('now')
    `).bind(
      params.stepId, format, serialized, status ?? 'draft', source ?? null,
      validated.wordCount, validated.durationSeconds, status ?? null,
    ).run();

    const row = await env.DB.prepare(
      'SELECT * FROM step_rendition WHERE step_id = ? AND format = ?'
    ).bind(params.stepId, format).first();
    return json({ ok: true, data: row ? mapRendition(row) : null });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'rendition_put_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestDelete(context) {
  const denied = requireAdmin(context);
  if (denied) return denied;
  const { request, env, waitUntil } = context;
  if (!env.DB) return json({ ok: false, error: 'Server misconfigured' }, 503);
  const params = validateParams(context);
  if (!params) return json({ ok: false, error: 'invalid_id' }, 400);

  const url = new URL(request.url);
  const format = url.searchParams.get('format');
  if (!VALID_FORMATS.has(format)) return json({ ok: false, error: 'invalid_format' }, 400);

  try {
    const step = await stepInCourse(env.DB, params.stepId, params.courseId);
    if (!step) return json({ ok: false, error: 'step_not_found' }, 404);

    if (format === 'quiz') {
      const certRef = await certQuizRef(env.DB, params.stepId);
      if (certRef) {
        return json({ ok: false, error: 'step_referenced_as_certificate_quiz', courseId: certRef.id }, 409);
      }
    }

    // For audio, capture the R2 key before the row goes (spec 3.4 / R4).
    let r2Key = null;
    if (format === 'audio') {
      const row = await env.DB.prepare(
        'SELECT * FROM step_rendition WHERE step_id = ? AND format = ?'
      ).bind(params.stepId, format).first();
      if (row?.content_json) {
        try { r2Key = JSON.parse(row.content_json).r2_key ?? null; } catch { r2Key = null; }
      }
    }

    const result = await env.DB.prepare(
      'DELETE FROM step_rendition WHERE step_id = ? AND format = ?'
    ).bind(params.stepId, format).run();
    if (result.meta?.changes === 0) return json({ ok: false, error: 'rendition_not_found' }, 404);

    if (r2Key && env.R2_ASSETS) {
      try {
        await env.R2_ASSETS.delete(r2Key);
      } catch (err) {
        log(env, waitUntil, 'admin-courses', 'rendition_r2_delete_error', 'error', `${r2Key}: ${err.message}`, 0, 500);
      }
    }

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'rendition_delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/admin-renditions.test.js`
Expected: all 10 PASS.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add "functions/api/admin/courses/[id]/steps/[stepId]/renditions.js" test/admin-renditions.test.js
git commit -m "feat(admin): step rendition CRUD with cert-quiz guard, size caps, sanitization"
```

---

### Task 5: Deletion cleanup (step DELETE + course DELETE)

**Files:**
- Modify: `functions/api/admin/courses/[id]/steps/[stepId].js` (DELETE handler, lines ~296-344)
- Modify: `functions/api/admin/courses/[id].js` (DELETE handler batch, lines ~419-422)
- Test: `test/admin-renditions.test.js` (append two tests)

Spec: 3.1 (FK decorative, explicit cleanup, step-ID-reuse hazard). **Coder agent mandatory.**

- [ ] **Step 1: Write the failing tests**

Add this import to the TOP of `test/admin-renditions.test.js`, in the static imports block (imports must be top-level; appending it mid-file is a parse error):

```js
import { onRequestDelete as stepDelete } from '../functions/api/admin/courses/[id]/steps/[stepId].js';
```

Then append the two tests at the end of the file:

```js
test('step DELETE batch-cleans step_rendition rows (condition-safe)', async () => {
  const qm = {
    'SELECT id FROM course_step WHERE id = ? AND course_id = ?': { first: { id: 'step-1' } },
    'certificate_quiz_step_id': { first: null },
    "format = 'audio'": { first: null },
    'DELETE FROM course_step': { run: { success: true, meta: { changes: 1 } } },
    'DELETE FROM step_rendition': { run: { success: true, meta: { changes: 2 } } },
  };
  const c = adminCtx(qm, { method: 'DELETE' });
  const res = await stepDelete(c);
  assert.equal(res.status, 200);
  const renditionDelete = c.db._calls.find((x) => x.sql.includes('DELETE FROM step_rendition'));
  assert.ok(renditionDelete, 'step DELETE must clean step_rendition');
  assert.ok(renditionDelete.sql.includes('NOT EXISTS'), 'rendition cleanup must be conditional on the step row being gone');
});

test('step DELETE removes audio R2 object when audio rendition exists', async () => {
  const qm = {
    'SELECT id FROM course_step WHERE id = ? AND course_id = ?': { first: { id: 'step-1' } },
    'certificate_quiz_step_id': { first: null },
    "format = 'audio'": { first: { content_json: JSON.stringify({ r2_key: 'courses/audio/step-1.mp3' }) } },
    'DELETE FROM course_step': { run: { success: true, meta: { changes: 1 } } },
    'DELETE FROM step_rendition': { run: { success: true, meta: { changes: 1 } } },
  };
  const c = adminCtx(qm, { method: 'DELETE' });
  const res = await stepDelete(c);
  assert.equal(res.status, 200);
  assert.deepEqual(c.env.R2_ASSETS.deleted, ['courses/audio/step-1.mp3']);
});
```

Run: `node --test test/admin-renditions.test.js` -> the two new tests FAIL.

- [ ] **Step 2: Modify the step DELETE handler in `[stepId].js`**

In `functions/api/admin/courses/[id]/steps/[stepId].js` `onRequestDelete`, replace the block from `const deleteResult = await env.DB.prepare(` through `.bind(stepId, stepId, stepId, stepId).run();` (currently lines ~315-320) with:

```js
    // Capture the audio R2 key before the rows go (spec 3.1 / R4).
    let audioR2Key = null;
    const audioRendition = await env.DB.prepare(
      "SELECT content_json FROM step_rendition WHERE step_id = ? AND format = 'audio'"
    ).bind(stepId).first();
    if (audioRendition?.content_json) {
      try { audioR2Key = JSON.parse(audioRendition.content_json).r2_key ?? null; } catch { audioR2Key = null; }
    }

    // One atomic batch: the conditional step delete, then a rendition cleanup
    // that only fires if the step row is actually gone (condition-safe: if the
    // step delete was refused by the NOT EXISTS guards, renditions survive).
    // D1 FKs are decorative; without this, deleted steps orphan rendition rows
    // and a reused step ID would inherit stale content (spec 3.1).
    const [deleteResult] = await env.DB.batch([
      env.DB.prepare(
        'DELETE FROM course_step WHERE id = ?' +
        ' AND NOT EXISTS (SELECT 1 FROM step_progress WHERE step_id = ?)' +
        ' AND NOT EXISTS (SELECT 1 FROM quiz_response WHERE step_id = ?)' +
        ' AND NOT EXISTS (SELECT 1 FROM lesson_comment WHERE step_id = ?)'
      ).bind(stepId, stepId, stepId, stepId),
      env.DB.prepare(
        'DELETE FROM step_rendition WHERE step_id = ?1' +
        ' AND NOT EXISTS (SELECT 1 FROM course_step WHERE id = ?1)'
      ).bind(stepId),
    ]);
```

Then, just before the final `return json({ ok: true });` (after the `deleteResult.meta.changes === 0` refusal block, which stays unchanged), add:

```js
    if (audioR2Key && env.R2_ASSETS) {
      try {
        await env.R2_ASSETS.delete(audioR2Key);
      } catch (r2Err) {
        log(env, waitUntil, 'admin-courses', 'step_delete_r2_error', 'error', `${audioR2Key}: ${r2Err.message}`, 0, 500);
      }
    }
```

Note: `env.DB.batch` returns an array; destructure `[deleteResult]` so the existing `deleteResult.meta.changes === 0` refusal logic keeps working unchanged.

- [ ] **Step 3: Modify the course DELETE batch in `[id].js`**

In `functions/api/admin/courses/[id].js` `onRequestDelete`, immediately BEFORE the existing `await env.DB.batch([` (line ~419), insert the audio-key collection:

```js
    // Collect audio R2 keys for the course's steps before rows are deleted.
    const { results: audioRows } = await env.DB.prepare(
      "SELECT content_json FROM step_rendition WHERE format = 'audio' AND step_id IN (SELECT id FROM course_step WHERE course_id = ?)"
    ).bind(id).all();
    const audioKeys = [];
    for (const r of audioRows || []) {
      try {
        const k = JSON.parse(r.content_json)?.r2_key;
        if (k) audioKeys.push(k);
      } catch { /* malformed row; nothing to delete */ }
    }
```

Then change the batch so rendition cleanup runs FIRST (it subqueries course_step, which must still exist):

```js
    await env.DB.batch([
      env.DB.prepare('DELETE FROM step_rendition WHERE step_id IN (SELECT id FROM course_step WHERE course_id = ?)').bind(id),
      env.DB.prepare('DELETE FROM course_step WHERE course_id = ?').bind(id),
      env.DB.prepare('DELETE FROM course_section WHERE course_id = ?').bind(id),
      env.DB.prepare('DELETE FROM course WHERE id = ?').bind(id),
    ]);

    for (const key of audioKeys) {
      if (!env.R2_ASSETS) break;
      try {
        await env.R2_ASSETS.delete(key);
      } catch (r2Err) {
        log(env, waitUntil, 'admin-courses', 'course_delete_r2_error', 'error', `${key}: ${r2Err.message}`, 0, 500);
      }
    }
```

(Keep whatever statements/lines follow the original batch unchanged.)

- [ ] **Step 4: Run tests + lint**

Run: `node --test test/admin-renditions.test.js && npm run lint`
Expected: all tests PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add "functions/api/admin/courses/[id]/steps/[stepId].js" "functions/api/admin/courses/[id].js" test/admin-renditions.test.js
git commit -m "feat(admin): step/course DELETE clean step_rendition rows + audio R2 objects (D1 FKs decorative)"
```

---

### Task 6: CS3 gate extension

**Files:**
- Modify: `scripts/gates/validate-courses-schema.mjs`

Spec: 8.1 CS3 items (a)-(e). The gate currently parses ONE migration file and three tables. CS3 adds `step_rendition` (defined in `migrations/028-step-rendition.sql`), the two new endpoint files, `VALID_FORMATS`, the three-table `VALID_STATUSES` check, and a no-op meta-assertion.

- [ ] **Step 1: Apply the edits**

In `scripts/gates/validate-courses-schema.mjs`:

(a) After `const MIGRATION_FILE = ...` (line 62), add:

```js
const RENDITION_MIGRATION_FILE = resolve(PROJECT_ROOT, 'migrations/028-step-rendition.sql');
```

(b) After `const COURSE_TABLES = ...` (line 64), add:

```js
const RENDITION_TABLES = ['step_rendition'];
const ALL_TABLES = [...COURSE_TABLES, ...RENDITION_TABLES];
```

(c) Extend `APP_ENUM_FILES` (lines 68-73) with two entries:

```js
  'functions/api/admin/courses/[id]/steps/[stepId]/renditions.js',
  'functions/api/courses/rendition.js',
```

(d) In the "Load committed migration" section (after line 185), merge the rendition migration's blocks and parse all tables:

```js
if (!existsSync(RENDITION_MIGRATION_FILE)) {
  console.error(`FATAL: rendition migration file not found: ${RENDITION_MIGRATION_FILE}`);
  process.exit(2);
}
Object.assign(MIGRATION_BLOCKS, parseCreateTableBlocks(readFileSync(RENDITION_MIGRATION_FILE, 'utf-8')));
```

And change the parse loop `for (const t of COURSE_TABLES)` (line 190) to `for (const t of ALL_TABLES)`.

(e) In `gateCS2`, change both uses of `COURSE_TABLES` (the `inList` build at line ~284 and the iteration at line ~294) to `ALL_TABLES` so the live D1 check covers `step_rendition`.

(f) Add a new gate function after `gateCS2`:

```js
// ---------- Gate CS3: Static : step_rendition CHECK == app VALID_* ---------
function gateCS3() {
  const results = [];

  if (MIGRATION_BLOCKS['step_rendition'] === undefined) {
    results.push(fail(`rendition migration has no CREATE TABLE for 'step_rendition'`));
    return results;
  }
  for (const col of ['format', 'status']) {
    if (!migChecks['step_rendition']?.[col]) {
      results.push(fail(`migration 'step_rendition.${col}' has no CHECK(... IN (...)) constraint`));
    }
  }
  if (results.some((r) => r.ok === false)) return results;

  const RENDITION_FILES = [
    'functions/api/admin/courses/[id]/steps/[stepId]/renditions.js',
    'functions/api/courses/rendition.js',
  ];
  const collected = {}; // setName -> [{ file, set }]
  for (const rel of RENDITION_FILES) {
    const abs = resolve(PROJECT_ROOT, rel);
    if (!existsSync(abs)) { results.push(fail(`rendition enum file missing: ${rel}`)); continue; }
    const src = readFileSync(abs, 'utf-8');
    for (const name of ['VALID_FORMATS', 'VALID_STATUSES']) {
      const s = parseValidSet(src, name);
      if (s) (collected[name] ||= []).push({ file: rel, set: s });
    }
  }

  // VALID_FORMATS: must exist, agree across files, and equal the CHECK.
  const formatCopies = collected['VALID_FORMATS'];
  if (!formatCopies || !formatCopies.length) {
    results.push(fail(`no VALID_FORMATS Set found in rendition endpoint files`));
  } else {
    const ref = formatCopies[0].set;
    const diverged = formatCopies.filter((c) => !setEq(c.set, ref));
    if (diverged.length) {
      results.push(fail(`VALID_FORMATS diverges across files: ${formatCopies.map((c) => `${c.file}=${setStr(c.set)}`).join('  |  ')}`));
    }
    const migSet = migChecks['step_rendition']['format'];
    if (setEq(ref, migSet)) {
      results.push(pass(`step_rendition.format: migration CHECK == VALID_FORMATS ${setStr(migSet)}`));
    } else {
      results.push(fail(`step_rendition.format: migration CHECK ${setStr(migSet)} != VALID_FORMATS ${setStr(ref)} : schema/app drift`));
    }
  }

  // VALID_STATUSES (admin renditions endpoint) must equal step_rendition.status CHECK.
  const statusCopies = collected['VALID_STATUSES'];
  if (!statusCopies || !statusCopies.length) {
    results.push(fail(`no VALID_STATUSES Set found in rendition endpoint files (canonical plural name; never VALID_STATUS)`));
  } else {
    const migSet = migChecks['step_rendition']['status'];
    if (setEq(statusCopies[0].set, migSet)) {
      results.push(pass(`step_rendition.status: migration CHECK == VALID_STATUSES ${setStr(migSet)}`));
    } else {
      results.push(fail(`step_rendition.status: migration CHECK ${setStr(migSet)} != VALID_STATUSES ${setStr(statusCopies[0].set)}`));
    }
  }

  // Meta-assertion: CS3 must have actually compared value-sets (no-op guard, spec 8.1e).
  const comparisons = results.filter((r) => r.ok !== null).length;
  if (comparisons < 2) {
    results.push(fail(`CS3 ran ${comparisons} comparisons (expected >= 2) : gate is a no-op, wiring is broken`));
  } else {
    results.push(pass(`CS3 meta-assertion: ${comparisons} value-set comparisons ran`));
  }

  return results;
}
```

(g) Register it in `gateSpecs` (line ~342):

```js
const gateSpecs = [
  { id: 'CS1', name: 'Static: migration CHECK == app VALID_* Sets', fn: gateCS1 },
  { id: 'CS2', name: 'Live: migration columns + CHECK == live D1',   fn: gateCS2 },
  { id: 'CS3', name: 'Static: step_rendition CHECK == rendition VALID_* Sets', fn: gateCS3 },
];
```

- [ ] **Step 2: Run the gate (static modes first, then live)**

```bash
node scripts/gates/validate-courses-schema.mjs --quick
node scripts/gates/validate-courses-schema.mjs --gate CS3
node scripts/gates/validate-courses-schema.mjs
```

Expected: CS1 PASS (unchanged), CS3 PASS (formats + status + meta-assertion), CS2 PASS including `step_rendition` live columns/CHECKs (Task 1 applied the migration to remote already; if D1 is unreachable, CS2 WARN-skips, which is acceptable).

- [ ] **Step 3: Commit**

```bash
git add scripts/gates/validate-courses-schema.mjs
git commit -m "feat(gates): CS3 step_rendition schema lockstep + live coverage + no-op meta-assertion"
```

---### Task 7: `renditions[]` in the public build feed

**Files:**
- Modify: `functions/api/courses.js`

Spec: 3.3 (format list is a render hint; added ONLY in `functions/api/courses.js` `mapStep`; `fetch-courses-data.mjs` passes course objects through verbatim, confirmed no mapper there; admin mappers intentionally excluded). **Coder agent mandatory.**

- [ ] **Step 1: Apply the edits to `functions/api/courses.js`**

(a) Add after the imports (line ~16):

```js
const FORMAT_ORDER = ['reading', 'flashcards', 'quiz', 'audio'];

function buildRenditionMap(rows) {
  const byStep = new Map();
  for (const r of rows || []) {
    if (!byStep.has(r.step_id)) byStep.set(r.step_id, new Set());
    byStep.get(r.step_id).add(r.format);
  }
  const map = new Map();
  for (const [stepId, formats] of byStep) {
    map.set(stepId, FORMAT_ORDER.filter((f) => formats.has(f)));
  }
  return map;
}
```

(b) Single-course path: extend the `Promise.all` (lines ~48-55) with a fifth query and capture it:

```js
      const [course, { results: sections }, { results: steps }, enrollRow, { results: renditionRows }] = await Promise.all([
        env.DB.prepare('SELECT * FROM course WHERE id = ?').bind(id).first(),
        env.DB.prepare('SELECT * FROM course_section WHERE course_id = ? ORDER BY sort_order ASC').bind(id).all(),
        preview
          ? env.DB.prepare('SELECT * FROM course_step WHERE course_id = ? ORDER BY section_id, sort_order ASC').bind(id).all()
          : env.DB.prepare("SELECT * FROM course_step WHERE course_id = ? AND status = 'published' ORDER BY section_id, sort_order ASC").bind(id).all(),
        env.DB.prepare('SELECT COUNT(*) AS live FROM enrollment WHERE revoked_at IS NULL AND course_id = ?').bind(id).first(),
        env.DB.prepare("SELECT step_id, format FROM step_rendition WHERE status = 'published' AND step_id IN (SELECT id FROM course_step WHERE course_id = ?)").bind(id).all(),
      ]);
```

And pass the map into `mapCourse`:

```js
      return json({ ok: true, data: mapCourse(course, sections || [], steps || [], preview, liveCount, buildRenditionMap(renditionRows)) });
```

(c) Full-list path: extend the second `Promise.all` (lines ~73-83) with:

```js
      env.DB.prepare("SELECT step_id, format FROM step_rendition WHERE status = 'published'").all(),
```

capture as `{ results: allRenditionRows }`, build `const renditionMap = buildRenditionMap(allRenditionRows);` once, and pass it as the sixth argument in the `courses.map(...)` call:

```js
      return mapCourse(course, sections, stepsForCourse, false, countMap.get(course.id) ?? 0, renditionMap);
```

(d) Thread the parameter through the mappers:

```js
function mapCourse(c, sections, steps, preview, participants = 0, renditionMap = null) {
  const stepsBySectionId = groupBy(steps, 'section_id');

  let mappedSections = sections.map(sec => ({
    id: sec.id,
    title: sec.title,
    steps: (stepsBySectionId[sec.id] || []).map((s) => mapStep(s, renditionMap)),
  }));
```

and in `mapStep`:

```js
function mapStep(s, renditionMap = null) {
  const step = {
    id: s.id,
    title: s.title,
    type: s.type,
  };

  if (s.stream_uid != null) step.streamUid = s.stream_uid;
  if (s.duration_seconds != null) step.duration = s.duration_seconds;

  const formats = renditionMap?.get(s.id);
  if (formats && formats.length > 0) step.renditions = formats;

  const attachments = parseArray(s.attachments_json);
  if (attachments.length > 0) step.attachments = attachments;

  return step;
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean. (No unit test: this endpoint imports nothing JSON-static, but its only consumers are the build fetch + gates; correctness is proven by the live verification in Task 11 and the floors in `fetch-courses-data.mjs`, which pass courses through verbatim so `renditions` flows into `courses.json` with zero fetch-script changes.)

- [ ] **Step 3: Commit**

```bash
git add functions/api/courses.js
git commit -m "feat(courses): per-step published renditions[] format list in build feed"
```

---

### Task 8: Quiz content migration + parity gate

**Files:**
- Create: `scripts/migrate-quizzes-to-renditions.mjs`
- Create: `scripts/gates/validate-quiz-parity.mjs`

Spec: 8.2.4 sub-steps 4a + 4c. The 4 entries in `src/data/quizzes.json` are `mc-intro-3` (quiz), `mc-intro-4` (questionnaire), `mc-feedback-2` (questionnaire), `mc-feedback-3` (quiz, passingScore 80, THE cert quiz). Rows are written as `draft`, parity-verified, then flipped to `published`.

- [ ] **Step 1: Write the migration script**

Create `scripts/migrate-quizzes-to-renditions.mjs`:

```js
#!/usr/bin/env node
/**
 * 8.2.4a: migrate src/data/quizzes.json entries into step_rendition rows.
 * Idempotent: ON CONFLICT(step_id,'quiz') DO UPDATE. Writes status='draft'
 * by default; pass --publish to set status='published' (run only AFTER
 * validate-quiz-parity.mjs passes, per spec 8.2.4c).
 *
 * Usage:
 *   node scripts/migrate-quizzes-to-renditions.mjs            # draft rows
 *   node scripts/migrate-quizzes-to-renditions.mjs --publish  # flip to published
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = process.env.WRANGLER_BIN || 'wrangler'; // global binary; auth via CLOUDFLARE_API_TOKEN env (never npx)
const PUBLISH = process.argv.includes('--publish');
const quizzes = JSON.parse(readFileSync(resolve(ROOT, 'src/data/quizzes.json'), 'utf-8'));

function sqlString(s) {
  return `'${s.replace(/'/g, "''")}'`;
}

for (const [stepId, entry] of Object.entries(quizzes)) {
  const contentJson = JSON.stringify(entry);
  if (contentJson.length > 32000) {
    console.error(`FATAL: ${stepId} content_json is ${contentJson.length} bytes (cap 32000)`);
    process.exit(1);
  }
  const status = PUBLISH ? 'published' : 'draft';
  const sql =
    `INSERT INTO step_rendition (step_id, format, content_json, status, source, created_at, updated_at) ` +
    `VALUES (${sqlString(stepId)}, 'quiz', ${sqlString(contentJson)}, '${status}', 'migrated:quizzes.json', datetime('now'), datetime('now')) ` +
    `ON CONFLICT(step_id, format) DO UPDATE SET content_json = excluded.content_json, status = '${status}', ` +
    `source = 'migrated:quizzes.json', updated_at = datetime('now');`;
  execFileSync(WRANGLER, ['d1', 'execute', 'rrm-auth', '--remote', `--command=${sql}`], {
    stdio: 'inherit', cwd: ROOT, timeout: 60000,
  });
  console.log(`${stepId}: upserted quiz rendition (status=${status})`);
}
console.log(`Done: ${Object.keys(quizzes).length} quiz renditions ${PUBLISH ? 'PUBLISHED' : 'in draft'}.`);
```

- [ ] **Step 2: Write the parity gate**

Create `scripts/gates/validate-quiz-parity.mjs`:

```js
#!/usr/bin/env node
/**
 * 8.2.4c: quiz migration parity gate (spec 8.1).
 * NOT byte-identity: (a) deep-equal of the STORED content_json (parsed,
 * key-order-insensitive, INCLUDING correctIndex) against quizzes.json for
 * all 4 steps; (b) a scoring round-trip per quiz-type entry: an all-correct
 * answer vector must score 100 and an all-zeros vector must score identically
 * from both sources. Exit 0 = parity; 1 = drift; 2 = runner error.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WRANGLER = process.env.WRANGLER_BIN || 'wrangler'; // global binary; auth via CLOUDFLARE_API_TOKEN env (never npx)
const quizzes = JSON.parse(readFileSync(resolve(ROOT, 'src/data/quizzes.json'), 'utf-8'));

function d1Query(sql) {
  const raw = execFileSync(
    WRANGLER,
    ['d1', 'execute', 'rrm-auth', '--remote', '--json', `--command=${sql}`],
    { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 8 * 1024 * 1024, cwd: ROOT }
  ).toString();
  const lines = raw.split('\n');
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('[')) { start = i; break; }
  }
  if (start === -1) throw new Error(`no JSON in wrangler output: ${raw.slice(0, 200)}`);
  return JSON.parse(lines.slice(start).join('\n'))[0]?.results || [];
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (!deepEqual(ka, kb)) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

// Mirrors quiz.js multiple-choice scoring exactly.
function scoreQuiz(entry, answers) {
  let correct = 0;
  for (let i = 0; i < entry.questions.length; i++) {
    if (answers[i] === entry.questions[i].correctIndex) correct++;
  }
  return Math.round((correct / entry.questions.length) * 100);
}

let failures = 0;
const stepIds = Object.keys(quizzes);
const inList = stepIds.map((s) => `'${s}'`).join(',');
const rows = d1Query(`SELECT step_id, content_json FROM step_rendition WHERE format='quiz' AND step_id IN (${inList})`);
const byStep = new Map(rows.map((r) => [r.step_id, r.content_json]));

for (const stepId of stepIds) {
  const staticEntry = quizzes[stepId];
  const storedJson = byStep.get(stepId);
  if (!storedJson) {
    console.error(`FAIL ${stepId}: no step_rendition quiz row in D1`);
    failures++;
    continue;
  }
  let stored;
  try {
    stored = JSON.parse(storedJson);
  } catch (err) {
    console.error(`FAIL ${stepId}: stored content_json does not parse: ${err.message}`);
    failures++;
    continue;
  }
  if (!deepEqual(stored, staticEntry)) {
    console.error(`FAIL ${stepId}: stored content deep-equal mismatch vs quizzes.json (correctIndex included)`);
    failures++;
    continue;
  }
  if (staticEntry.type === 'quiz') {
    const allCorrect = staticEntry.questions.map((q) => q.correctIndex);
    const allZeros = staticEntry.questions.map(() => 0);
    const checks = [
      [scoreQuiz(staticEntry, allCorrect), scoreQuiz(stored, allCorrect), 'all-correct'],
      [scoreQuiz(staticEntry, allZeros), scoreQuiz(stored, allZeros), 'all-zeros'],
    ];
    for (const [a, b, label] of checks) {
      if (a !== b) {
        console.error(`FAIL ${stepId}: scoring round-trip diverges (${label}: static=${a} stored=${b})`);
        failures++;
      }
    }
    if (scoreQuiz(staticEntry, allCorrect) !== 100) {
      console.error(`FAIL ${stepId}: all-correct vector does not score 100 : quizzes.json itself is inconsistent`);
      failures++;
    }
  } else {
    if (stored.questions.length !== staticEntry.questions.length) {
      console.error(`FAIL ${stepId}: questionnaire question count mismatch`);
      failures++;
    }
  }
  console.log(`OK ${stepId}: deep-equal + scoring parity`);
}

if (failures > 0) {
  console.error(`\n${failures} parity failure(s). Do NOT publish or switch quiz.js source.`);
  process.exit(1);
}
console.log(`\nAll ${stepIds.length} quiz renditions parity-verified (incl. cert quiz mc-feedback-3).`);
```

- [ ] **Step 3: Run the migration (draft), then the parity gate, then publish**

```bash
node scripts/migrate-quizzes-to-renditions.mjs
node scripts/gates/validate-quiz-parity.mjs
```

Expected: 4 `OK` lines + the final all-verified line, exit 0. ONLY then:

```bash
node scripts/migrate-quizzes-to-renditions.mjs --publish
node scripts/gates/validate-quiz-parity.mjs
```

Expected: parity still green against published rows.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-quizzes-to-renditions.mjs scripts/gates/validate-quiz-parity.mjs
git commit -m "feat(courses): quiz content migration to step_rendition + deep-equal/scoring parity gate"
```

---

### Task 9: quiz.js dual-read (D1 first, static fallback)

**Files:**
- Create: `functions/api/courses/_quiz-content.js`
- Modify: `functions/api/courses/quiz.js` (two read sites: GET line ~70, POST line ~157)
- Test: `test/quiz-content.test.js`

Spec: 8.2.4b. **Coder agent mandatory.** The helper takes the static data as a PARAMETER so it is unit-testable under node:test (no JSON import in the helper).

- [ ] **Step 1: Write the failing tests**

Create `test/quiz-content.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockDB } from './_helpers.js';
import { getQuizContent } from '../functions/api/courses/_quiz-content.js';

const STATIC_DATA = { 'step-a': { type: 'quiz', questions: [{ id: 'q1', text: 'S?', options: ['a', 'b'], correctIndex: 0 }] } };
const D1_ENTRY = { type: 'quiz', questions: [{ id: 'q1', text: 'D1?', options: ['a', 'b'], correctIndex: 1 }] };

test('returns D1 rendition when published row exists', async () => {
  const db = mockDB({ 'FROM step_rendition': { first: { content_json: JSON.stringify(D1_ENTRY) } } });
  const quiz = await getQuizContent(db, 'step-a', STATIC_DATA);
  assert.equal(quiz.questions[0].text, 'D1?');
});

test('falls back to static data when no D1 row', async () => {
  const db = mockDB({ 'FROM step_rendition': { first: null } });
  const quiz = await getQuizContent(db, 'step-a', STATIC_DATA);
  assert.equal(quiz.questions[0].text, 'S?');
});

test('falls back to static when D1 content_json is malformed', async () => {
  const db = mockDB({ 'FROM step_rendition': { first: { content_json: '{broken' } } });
  const quiz = await getQuizContent(db, 'step-a', STATIC_DATA);
  assert.equal(quiz.questions[0].text, 'S?');
});

test('falls back to static when D1 query throws', async () => {
  const db = mockDB({ 'FROM step_rendition': { throws: 'd1 down' } });
  const quiz = await getQuizContent(db, 'step-a', STATIC_DATA);
  assert.equal(quiz.questions[0].text, 'S?');
});

test('returns null when neither source has the step', async () => {
  const db = mockDB({ 'FROM step_rendition': { first: null } });
  const quiz = await getQuizContent(db, 'step-unknown', STATIC_DATA);
  assert.equal(quiz, null);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test test/quiz-content.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the helper**

Create `functions/api/courses/_quiz-content.js`:

```js
/**
 * Dual-read quiz content (spec 8.2.4b): D1 step_rendition (format='quiz',
 * status='published') first, static quizzes.json fallback. The fallback and
 * its static import are retired in 8.2.4e AFTER the soak; until then a D1
 * read failure degrades to exactly today's behavior instead of 404ing all
 * quizzes (including the cert quiz). Static data is a parameter so this
 * module stays importable under node:test.
 */
export async function getQuizContent(db, stepId, staticQuizData) {
  try {
    const row = await db.prepare(
      "SELECT content_json FROM step_rendition WHERE step_id = ? AND format = 'quiz' AND status = 'published'"
    ).bind(stepId).first();
    if (row?.content_json) {
      const parsed = JSON.parse(row.content_json);
      if (parsed && Array.isArray(parsed.questions)) return parsed;
    }
  } catch {
    // D1 unavailable or malformed row: fall through to the static source.
  }
  return staticQuizData[stepId] || null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/quiz-content.test.js`
Expected: all 5 PASS.

- [ ] **Step 5: Wire into `quiz.js`**

In `functions/api/courses/quiz.js`:

(a) Add to the imports (after line 22's `import quizData from ...`, which STAYS until 8.2.4e):

```js
import { getQuizContent } from './_quiz-content.js';
```

(b) GET handler: replace line ~70 `const quiz = quizData[stepId];` with:

```js
    const quiz = await getQuizContent(db, stepId, quizData);
```

(c) POST handler (`handleQuizSubmit`): replace line ~157 `const quiz = quizData[stepId];` with:

```js
  const quiz = await getQuizContent(db, stepId, quizData);
```

Everything else (validation, scoring, step_progress/quiz_response writes, completion) is untouched.

- [ ] **Step 6: Run full unit suite + lint**

Run: `npm test && npm run lint`
Expected: all PASS, lint clean.

- [ ] **Step 7: Commit**

```bash
git add functions/api/courses/_quiz-content.js functions/api/courses/quiz.js test/quiz-content.test.js
git commit -m "feat(courses): quiz.js dual-read (D1 rendition first, static fallback until soak)"
```

---

### Task 10: E2E additions

**Files:**
- Create: `tests/e2e/renditions.spec.ts`

Spec: 8.1 E2E list (the subset testable without a session fixture; authenticated-path E2E rides with Phase 1's player work).

- [ ] **Step 1: Write the spec**

Create `tests/e2e/renditions.spec.ts` (follow the conventions of `tests/e2e/track-smoke.spec.ts` for request usage; baseURL comes from the Playwright config):

```ts
import { test, expect } from '@playwright/test';

// Phase 0 surface: logged-out behavior of the new rendition endpoints and
// the unchanged quiz endpoint (rollback posture: nothing learner-visible
// changed). Authenticated-path E2E lands with Phase 1.

test('rendition endpoint 401s logged out', async ({ request }) => {
  const res = await request.get('/api/courses/rendition?stepId=mc-intro-3&format=reading');
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.ok).toBe(false);
});

test('rendition endpoint 401s before leaking format validation', async ({ request }) => {
  const res = await request.get('/api/courses/rendition?stepId=mc-intro-3&format=bogus');
  expect(res.status()).toBe(401);
});

test('admin renditions endpoint 401s logged out', async ({ request }) => {
  const res = await request.get('/api/admin/courses/masterclass-endo-surgery/steps/mc-intro-3/renditions');
  expect(res.status()).toBe(401);
});

test('quiz endpoint still 401s logged out (dual-read no regression)', async ({ request }) => {
  const res = await request.get('/api/courses/quiz?courseId=masterclass-endo-surgery&stepId=mc-intro-3');
  expect(res.status()).toBe(401);
});
```

- [ ] **Step 2: Commit (spec runs against the deployed site in Task 11's post-deploy gate, not now)**

```bash
git add tests/e2e/renditions.spec.ts
git commit -m "test(e2e): rendition endpoint logged-out gates + quiz no-regression"
```

---

### Task 11: Final verification + single batched push

**Files:** none new.

- [ ] **Step 1: Full local gate run**

```bash
npm run lint
npm test
node scripts/gates/validate-courses-schema.mjs
node scripts/gates/validate-quiz-parity.mjs
npm run guard
```

Expected: everything green. `npm run guard` still passes because `quizzes.json` is untouched (retirement is deferred to 8.2.4e).

- [ ] **Step 2: /arise --deep on the Phase 0 surface**

Run `/arise --deep` scoped to: `functions/api/courses/rendition.js`, `functions/api/courses/_sanitize.js`, `functions/api/courses/_quiz-content.js`, `functions/api/courses/quiz.js`, `functions/api/admin/courses/[id]/steps/[stepId]/renditions.js`, `functions/api/admin/courses/[id]/steps/[stepId].js`, `functions/api/admin/courses/[id].js`, `functions/api/courses.js`, `scripts/gates/validate-courses-schema.mjs`, `scripts/migrate-quizzes-to-renditions.mjs`, `scripts/gates/validate-quiz-parity.mjs`. Fix findings before push (spec 8.1 makes this mandatory for the rendition + admin endpoints).

- [ ] **Step 3: Single push (auto-merge claude/* -> main triggers Build & Deploy)**

```bash
git -c credential.helper='!gh auth git-credential' push origin claude/honen-phase0-renditions
```

ONE push for the whole session. Watch the Merge Claude Branches -> Build & Deploy chain to success (read the exact failing step if red; merge-to-main is not deployed, per memory).

- [ ] **Step 4: Post-deploy verification (outcome, not exit code)**

```bash
# Logged-out gates live:
curl -s -o /dev/null -w "%{http_code}" "https://rrmacademy.org/api/courses/rendition?stepId=mc-intro-3&format=reading"   # expect 401
# renditions[] visible in the build feed (requires LIBRARY_BUILD_TOKEN):
source ~/.zshrc
TOKEN=$(op read 'op://Automation/RRM Library Worker Build Token/credential')
# If the curl below returns 401, this item is not the Pages LIBRARY_BUILD_TOKEN:
# do NOT probe other vault items; surface to Brian and verify renditions[] via
# `/opt/homebrew/bin/wrangler d1 execute rrm-auth --remote --json --command="SELECT step_id, format, status FROM step_rendition"` instead.
curl -s "https://rrmacademy.org/api/courses?id=masterclass-endo-surgery" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const b=JSON.parse(d);const steps=b.data.sections.flatMap(s=>s.steps);const q=steps.find(s=>s.id==='mc-intro-3');console.log('mc-intro-3 renditions:',q.renditions);if(!q.renditions||!q.renditions.includes('quiz'))process.exit(1)})"
# parity against live one more time:
node scripts/gates/validate-quiz-parity.mjs
# e2e:
npx playwright test tests/e2e/renditions.spec.ts
```

Expected: 401, `mc-intro-3 renditions: [ 'quiz' ]`, parity green, e2e green.

Authenticated quiz round-trip is a NAMED DEFERRAL, not a manual step: **PH1-E2E-QUIZ** lands in the Phase 1 plan (pass = authenticated GET `/api/courses/quiz?courseId=masterclass-endo-surgery&stepId=mc-intro-3` returns 200 with 8 questions and no `correctIndex`; POST with the all-correct vector scores 100). Until then the gate for the quiz path is: live parity gate (deep-equal + scoring) + dual-read static fallback + the logged-out e2e above.

- [ ] **Step 5: Soak note**

The dual-read soak (8.2.4d) starts now: at least one full deploy cycle with D1-published quiz rows serving traffic. Do NOT execute retirement (8.2.4e) in this session.

---

## Deferred: 8.2.4e retirement checklist (separate session, AFTER soak)

Not part of this plan's execution. All six touchpoints, in one future session:
1. `git rm src/data/quizzes.json`
2. Remove the `import quizData` + static fallback from `quiz.js` and `_quiz-content.js` callers
3. Remove `src/data/quizzes.json` from deploy.yml's `git checkout HEAD --` restore line (~line 105)
4. Remove the guard.mjs REQUIRED-files entry (`src/data/quizzes.json`, ~line 328)
5. Remove the guard.mjs quizzes content-validity block (~lines 369-386)
6. `npm run guard:update` (guard.mjs is self-guarded), then full gates + deploy + live quiz verification

Revert before 4e = code rollback. Revert after 4e = restore all six.

## Spec coverage map

| Spec section | Task |
|---|---|
| 3.1 table + cleanup | 1, 5 |
| 3.2 payload shapes, caps, sanitizer | 2, 4 |
| 3.3/3.3.1/3.3.2/3.3.3 runtime read path | 3 |
| 3.3 renditions[] render hint | 7 |
| 3.4 admin CRUD + guards | 4, 5 |
| 3.5 quiz migration + article fix capability | 8, 9 (article content lands Phase 2) |
| 8.1 CS3 + parity gate + E2E subset | 6, 8, 10 |
| 8.2 deploy order | Task ordering + 11 |
| 3.6 rollback posture | inert by construction; verified in 11 |
