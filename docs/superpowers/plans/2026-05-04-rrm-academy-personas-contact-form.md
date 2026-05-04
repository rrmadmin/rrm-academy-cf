# RRM Academy Personas + Contact Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic `/contact/` form with a persona-routed UX (3 disclosure cards + 5 text links + visible "Sending as:" indicator), introduce a reusable bridge-page primitive for navigational SEO capture (`/schedule-with-dr-whittaker/`), publish a machine-readable persona artifact, and add CI gates that prevent persona/enum drift across surfaces.

**Architecture:** Astro 5.3 static page (`/contact/`) + native `<details name>` accordion + client-side JS for category state and `aria-live` announcement + CF Pages Function (`/api/contact/submit`) that validates an enum + sanitizes subject + writes to Analytics Engine. Persona inventory lives in `docs/personas/rrm-academy-personas.md` with a YAML frontmatter machine-readable section; the category enum is exported once from `src/lib/contact-categories.ts` and imported by both frontend and backend. Bridge page = small Astro page using `BridgePagePrimitive.astro` component with build-time prop validation.

**Tech Stack:** Astro 5.3, CF Pages Functions, AWS SES (via `aws4fetch`), Cloudflare Turnstile, EmailListVerify, Cloudflare Analytics Engine. Tests use Node's built-in `node --test` runner per project convention. Playwright for E2E. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-05-04-rrm-academy-personas-contact-form-design.md` (v2 post-/arise).

**Branching:** Work on `claude/personas-contact-form` per the project's claude/* auto-merge convention. Do NOT merge spec-only or unrelated pre-existing untracked files into this branch — keep scope hygienic.

**Tests live at:** `test/*.test.js`, run with `npm test`. Helpers in `test/_helpers.js` (mockEnv, mockRequest, mockDB, mockWaitUntil, parseResponse, randomIp).

---

## Phase 0: Pre-flight verification (no code yet)

These verifications resolve open assumptions in the spec. Each task confirms a fact OR surfaces a deviation that changes the plan.

### Task 0.1: Verify `/find-a-provider/` 301-redirects to homepage

**Files:** none (verification only)

- [ ] **Step 1: Probe the URL**

Run: `curl -sIL https://rrmacademy.org/find-a-provider/ | head -10`
Expected: see `HTTP/2 301` or `HTTP/2 308` to `https://rrmacademy.org/` (homepage). If a different status or destination is shown, update spec language in `§Personas Bucket C #11` and `§Non-Goals` accordingly before proceeding.

- [ ] **Step 2: Confirm `/dev/providers.astro` is the only provider-directory route in source**

Run: `find src/pages -iname '*provider*' 2>/dev/null`
Expected: only `src/pages/dev/providers.astro` is listed. If a `src/pages/find-a-provider*` file exists, the spec's premise (URL doesn't exist) is wrong; halt and revise.

### Task 0.2: Verify `GET /api/auth/session` returns `firstName`, `lastName`, `email`

**Files:** read-only `functions/api/auth/session.js`

- [ ] **Step 1: Read the endpoint**

Run: `cat functions/api/auth/session.js`
Expected: response shape includes `firstName`, `lastName`, `email`. If field names differ (e.g., `first_name`, `name`), record the actual shape — Phase 8's prefill code consumes whatever shape the endpoint returns.

- [ ] **Step 2: Live probe (anonymous)**

Run: `curl -s https://rrmacademy.org/api/auth/session | head -5`
Expected: `{"ok":false}` or similar 401-shaped response. (We're not logged in.) If the endpoint is unreachable or 500s, that's a separate bug to flag.

### Task 0.3: Verify `_log.js` blob signature can absorb extra fields

**Files:** read-only `functions/api/_log.js` and `~/iCode/projects/rrm-observatory/`

- [ ] **Step 1: Read the helper**

Run: `cat functions/api/_log.js`
Expected: 5 blobs in `blobs: ['rrm-academy', event, action, status, (detail||'').slice(0,200)]`. Confirmed in spec.

- [ ] **Step 2: Inspect observatory queries against `worker_events`**

Run: `grep -rn "worker_events\|writeDataPoint\|blobs\[" ~/iCode/projects/rrm-observatory/src/ 2>/dev/null | head -30`
Expected: queries reference blobs by name (e.g., `blob1`, `blob2`) or via SQL aliases. Note the highest-numbered blob position used. If queries depend on a fixed 5-blob layout, the Phase 3 extension must keep blobs 1-5 in the same positions and only add to slots 6+.

### Task 0.4: Verify `_validate.js` enum support state

**Files:** read-only `functions/api/_validate.js`

- [ ] **Step 1: Inspect**

Run: `grep -n 'enum\|values' functions/api/_validate.js`
Expected: NO `enum` rule type currently exists. (If one exists, Phase 3 Task 3.1 becomes a no-op except for tests.)

### Task 0.5: Verify `ssot/organization.json` UPMC declaration state

**Files:** read-only `ssot/organization.json`

- [ ] **Step 1: Inspect for UPMC node**

Run: `grep -n -i 'upmc\|divine.*mercy\|magee' ssot/organization.json 2>/dev/null || echo 'NOT PRESENT'`
Expected: either find a UPMC node with an `@id` (use it for the optional bridge JSON-LD) or `NOT PRESENT` (skip the optional UPMC `MedicalBusiness` JSON-LD on bridge page; do not add inline duplicates).

### Task 0.6: List Brian's existing Gmail filters keying on `[Contact]`

**Files:** none (operational check)

- [ ] **Step 1: Use the gmail CLI**

Run: `gmail filters -a administrator | grep -A1 -B1 'Contact'`
Expected: list of filters matching the literal string `[Contact]`. The new subject format `[Contact][CATEGORY] ...` preserves this prefix, so existing filters continue to match. If a filter uses an exact subject equality (rare), flag it for manual update.

### Task 0.7: Confirm node test runner + Playwright are working locally

**Files:** none

- [ ] **Step 1: Run existing tests**

Run: `npm test 2>&1 | tail -20`
Expected: all pass. If any fail before this work begins, that's a pre-existing issue — flag it but do not fix in this branch.

- [ ] **Step 2: Confirm dev server starts**

Run: `npm run dev` (background) then `curl -sI http://localhost:4321/contact/ | head -3` then kill dev
Expected: 200 on the current contact page.

---

## Phase 1: Persona doc + bridge-pages registry

### Task 1.1: Create the persona doc with machine-readable frontmatter

**Files:**
- Create: `docs/personas/rrm-academy-personas.md`

- [ ] **Step 1: Create directory and file**

```bash
mkdir -p docs/personas
```

- [ ] **Step 2: Write the persona doc**

Path: `docs/personas/rrm-academy-personas.md`

Content:

```markdown
---
# RRM Academy User Personas — machine-readable SSOT
# This frontmatter block is parsed by scripts/check-persona-enum-sync.mjs.
# Editing rules: keep `contact_form_category` values in sync with src/lib/contact-categories.ts.
personas:
  - id: course-taker
    name: Course taker
    bucket: A
    intent: Question about a purchased course (access, content, certificate)
    self_serve_path: /account
    surface: card
    contact_form_category: course
    auth_required_for_self_serve: true

  - id: stuc-member-stripe
    name: STUC member with Stripe subscription
    bucket: A
    intent: Cancel, change, or get receipt for Stripe-backed subscription
    self_serve_path: /account
    surface: card
    contact_form_category: stuc-billing
    auth_required_for_self_serve: true

  - id: paypal-recurring-donor
    name: PayPal-only recurring donor
    bucket: A
    intent: Cancel or change PayPal recurring profile
    self_serve_path: https://www.paypal.com/myaccount/autopay/
    surface: card
    contact_form_category: stuc-billing
    auth_required_for_self_serve: true

  - id: patient-curious
    name: Patient-curious or unsure
    bucket: A
    intent: Wondering whether RRM is right for them
    self_serve_path: /ask
    surface: card-fold
    contact_form_category: other
    auth_required_for_self_serve: true

  - id: clinician-or-researcher
    name: Clinician or researcher
    bucket: A
    intent: Library access, citation help, fulltext request
    self_serve_path: null
    surface: text-link
    contact_form_category: clinician-or-researcher
    auth_required_for_self_serve: false

  - id: speaking-or-media
    name: Speaking or media inquiry
    bucket: A
    intent: Interview, podcast, conference invite for Dr Whittaker
    self_serve_path: null
    surface: text-link
    contact_form_category: speaking
    auth_required_for_self_serve: false

  - id: partnership
    name: Partnership or affiliate
    bucket: A
    intent: B2B collab, content partnership, affiliate inquiry
    self_serve_path: null
    surface: text-link
    contact_form_category: partnership
    auth_required_for_self_serve: false

  - id: donor-or-grants
    name: Major donor or grants
    bucket: A
    intent: Large gift, foundation grant question
    self_serve_path: https://rrm.foundation/
    surface: text-link
    contact_form_category: donor-or-grants
    auth_required_for_self_serve: false

  - id: bug-report
    name: Bug or accessibility report
    bucket: A
    intent: Site issue, broken link, a11y problem
    self_serve_path: null
    surface: text-link
    contact_form_category: bug
    auth_required_for_self_serve: false

  - id: clinical-appointment
    name: Wants clinical appointment with Dr Whittaker
    bucket: B
    intent: Schedule with Dr Whittaker as a patient
    self_serve_path: /schedule-with-dr-whittaker/
    surface: bridge
    contact_form_category: null
    auth_required_for_self_serve: false

  - id: medical-advice
    name: Personal medical advice
    bucket: C
    intent: Should I take X, interpret my labs
    self_serve_path: https://www.factsaboutfertility.org/find-a-provider/
    surface: redirect-only
    contact_form_category: null
    auth_required_for_self_serve: false

  - id: find-a-doctor
    name: Find a doctor / referral
    bucket: C
    intent: Locate an RRM physician
    self_serve_path: https://www.factsaboutfertility.org/find-a-provider/
    surface: redirect-only
    contact_form_category: null
    auth_required_for_self_serve: false
---

# RRM Academy User Personas

This document is the SSOT for user personas referenced by the contact form, bridge pages, FAQs, and future surfaces. The frontmatter above is machine-readable; this prose is for humans.

## Bucket A. Personas RRM Academy can serve via the contact form

Eight personas (some sharing one card by design — see persona 2a/2b PayPal vs Stripe).

### Course taker

A user who has purchased an RRM Academy course (or has free access via membership) and needs help with access, content, or completion certificates. **Self-serve:** `/account` -> My courses (login required). **Form:** for content questions or login problems.

### STUC member or recurring donor (Stripe + PayPal)

Two sub-personas share one card label because the user often does not distinguish them mentally:

- **STUC member or Stripe-backed recurring donor:** subscription managed via Stripe. Self-serve: `/account` -> Manage subscription -> Stripe customer portal. Login required.
- **PayPal-only recurring donor:** legacy or non-STUC recurring giving to RRM Foundation. No `/account` path. Self-serve: log in to PayPal -> Settings -> Payments -> Manage automatic payments.

The card surfaces both paths; the user picks the one matching their payment source. Form fallback for refund disputes, portal failures, or payment-source confusion.

### Patient-curious or unsure

Folded into the "Something else" card. Primary self-serve is `/ask` (free RRM Academy account required), `/faqs`, the pillar guides (`/what-is-rrm/`, `/naprotechnology/`, `/femm/`, `/neofertility/`), and `/endo-survey`. Form fallback for genuinely-unique inquiries.

### Clinician or researcher, Speaking, Partnership, Major donor or grants, Bug report

Five secondary personas surfaced as text links below the cards. No self-serve path; direct-to-form. Each has a distinct wire category (see frontmatter) so triage analytics can distinguish volume.

## Bucket B. Pseudo-served via bridge page

### Wants clinical appointment with Dr Whittaker

RRM Academy is education only. Dr Whittaker's clinical practice is currently at UPMC. The bridge page at `/schedule-with-dr-whittaker/` captures branded navigational queries ("schedule with Dr Whittaker", "Dr Whittaker appointment", "Dr Whittaker endometriosis surgery"), states the academy/clinic distinction, and provides one outbound CTA to her UPMC profile. Designed for low-friction copy swap when Lunira PLLC launches.

## Bucket C. Hard redirects, not on contact form

### Personal medical advice

We are an education organization; we cannot give personal medical advice. Surface inline on FAQ pages and the medical-disclaimer page: "Talk to your clinician, or browse the FACTS About Fertility provider directory." Not on the contact form.

### Find a doctor / referral

The existing rrmacademy.org `/find-a-provider/` URL 301-redirects to homepage; only `/dev/providers.astro` exists internally. Until a first-party directory ships, this persona's destination is the FACTS About Fertility directory at `https://www.factsaboutfertility.org/find-a-provider/`. Documented in this doc, referenced inline where relevant. Not on the contact form.

## Future bridge candidates (not built)

- `/find-a-napro-doctor-near-me/` — long-tail SEO funnel, destination FACTS until first-party.
- `/find-an-endometriosis-surgeon/` — same.
- Additional candidates surface from SEO research over time.
```

- [ ] **Step 3: Verify file structure**

Run: `head -50 docs/personas/rrm-academy-personas.md && wc -l docs/personas/rrm-academy-personas.md`
Expected: frontmatter starts at line 1, has `personas:` array, ends with `---`.

- [ ] **Step 4: Commit**

```bash
git add docs/personas/rrm-academy-personas.md
git commit -m "docs: add machine-readable persona artifact

11 personas across 3 buckets. Frontmatter is the SSOT for
contact_form_category values; check-persona-enum-sync.mjs
(added in Phase 2) enforces consistency with src/lib/contact-categories.ts
and submit.js."
```

### Task 1.2: Create the bridge-pages registry

**Files:**
- Create: `docs/personas/bridge-pages.json`

- [ ] **Step 1: Write registry**

Path: `docs/personas/bridge-pages.json`

Content:

```json
{
  "$schema": "./bridge-pages.schema.json",
  "version": 1,
  "pages": [
    {
      "url": "/schedule-with-dr-whittaker/",
      "title": "Schedule with Dr Whittaker",
      "intent": "navigational query capture for Dr Naomi Whittaker clinical appointments",
      "outbound_destination_label": "UPMC profile",
      "registered": "2026-05-04",
      "min_inbound_links": 1
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add docs/personas/bridge-pages.json
git commit -m "docs: add bridge-pages registry

Used by scripts/check-bridge-links.mjs (added in Phase 9) to
enforce minimum inbound-link counts for SEO funnels."
```

---

## Phase 2: Enum SSOT + persona-enum-sync CI script

### Task 2.1: Create the contact-categories enum SSOT

**Files:**
- Create: `src/lib/contact-categories.ts`

- [ ] **Step 1: Write the SSOT**

Path: `src/lib/contact-categories.ts`

Content:

```typescript
/**
 * Single source of truth for the /contact/ form category enum.
 *
 * Imported by:
 *   - src/pages/contact.astro      (form select fallback options + click handlers)
 *   - functions/api/contact/submit.js (server-side enum validation + label map)
 *
 * Enforced in sync with docs/personas/rrm-academy-personas.md by
 * scripts/check-persona-enum-sync.mjs (CI gate).
 *
 * Adding a new category:
 *   1. Add the enum value to CONTACT_CATEGORIES below.
 *   2. Add the label to CONTACT_CATEGORY_LABELS.
 *   3. Add the persona to docs/personas/rrm-academy-personas.md frontmatter
 *      with matching contact_form_category.
 *   4. Add UI surface (card or text-link) in src/pages/contact.astro.
 *   5. Run: node scripts/check-persona-enum-sync.mjs (must pass).
 */

export const CONTACT_CATEGORIES = [
  'course',
  'stuc-billing',
  'clinician-or-researcher',
  'speaking',
  'partnership',
  'donor-or-grants',
  'bug',
  'other',
] as const;

export type ContactCategory = typeof CONTACT_CATEGORIES[number];

export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  'course': 'Course question',
  'stuc-billing': 'Member or recurring donor',
  'clinician-or-researcher': 'Clinician or researcher',
  'speaking': 'Speaking or media',
  'partnership': 'Partnership or affiliate',
  'donor-or-grants': 'Donor or grants',
  'bug': 'Bug or accessibility',
  'other': 'Something else',
};

export const CATEGORY_SOURCES = ['card', 'text-link', 'select', 'hash', 'default'] as const;
export type CategorySource = typeof CATEGORY_SOURCES[number];

/**
 * Uppercase label used in the email subject prefix, e.g. [STUC-BILLING].
 * Direct uppercase of the enum value so the prefix matches the wire token exactly.
 */
export function categorySubjectLabel(category: ContactCategory): string {
  return category.toUpperCase();
}

export function isContactCategory(value: unknown): value is ContactCategory {
  return typeof value === 'string' && (CONTACT_CATEGORIES as readonly string[]).includes(value);
}

export function isCategorySource(value: unknown): value is CategorySource {
  return typeof value === 'string' && (CATEGORY_SOURCES as readonly string[]).includes(value);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/contact-categories.ts
git commit -m "feat: add contact-categories enum SSOT

Single TypeScript SSOT exporting CONTACT_CATEGORIES, labels,
type guards. Imported by both contact.astro and submit.js
(in later phases). check-persona-enum-sync.mjs (Phase 2) will
verify this matches the persona doc frontmatter."
```

### Task 2.2: Write check-persona-enum-sync CI script (TDD)

**Files:**
- Create: `scripts/check-persona-enum-sync.mjs`
- Test: `test/check-persona-enum-sync.test.js`

- [ ] **Step 1: Write the failing test**

Path: `test/check-persona-enum-sync.test.js`

Content:

```javascript
/**
 * Tests for scripts/check-persona-enum-sync.mjs
 *
 * The script reads:
 *   - docs/personas/rrm-academy-personas.md frontmatter (extracts contact_form_category values)
 *   - src/lib/contact-categories.ts (extracts CONTACT_CATEGORIES array)
 *
 * Asserts: every non-null contact_form_category in the persona doc
 * appears in CONTACT_CATEGORIES, and every value in CONTACT_CATEGORIES
 * appears for at least one persona OR is justified (e.g., 'other' as catch-all).
 *
 * Run with: node --test test/check-persona-enum-sync.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function runScript(personaDocContent, categoriesTsContent) {
  const dir = mkdtempSync(join(tmpdir(), 'persona-sync-'));
  const personaPath = join(dir, 'personas.md');
  const tsPath = join(dir, 'contact-categories.ts');
  writeFileSync(personaPath, personaDocContent);
  writeFileSync(tsPath, categoriesTsContent);

  const result = spawnSync('node', [
    'scripts/check-persona-enum-sync.mjs',
    '--persona-doc', personaPath,
    '--categories-ts', tsPath,
  ], { encoding: 'utf-8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('check-persona-enum-sync', () => {
  it('passes when persona doc and categories file are in sync', () => {
    const persona = `---
personas:
  - id: a
    contact_form_category: course
  - id: b
    contact_form_category: bug
  - id: c
    contact_form_category: null
---
# Personas`;
    const ts = `export const CONTACT_CATEGORIES = ['course', 'bug', 'other'] as const;`;
    const r = runScript(persona, ts);
    assert.equal(r.code, 0, r.stderr);
  });

  it('fails when persona doc has a category not in TS', () => {
    const persona = `---
personas:
  - id: a
    contact_form_category: course
  - id: b
    contact_form_category: ghost
---`;
    const ts = `export const CONTACT_CATEGORIES = ['course', 'bug'] as const;`;
    const r = runScript(persona, ts);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr + r.stdout, /ghost/);
  });

  it('fails when TS has a non-other value not used by any persona', () => {
    const persona = `---
personas:
  - id: a
    contact_form_category: course
---`;
    const ts = `export const CONTACT_CATEGORIES = ['course', 'unused-one'] as const;`;
    const r = runScript(persona, ts);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr + r.stdout, /unused-one/);
  });

  it('allows "other" in TS even without explicit persona', () => {
    const persona = `---
personas:
  - id: a
    contact_form_category: course
  - id: b
    contact_form_category: other
---`;
    const ts = `export const CONTACT_CATEGORIES = ['course', 'other'] as const;`;
    const r = runScript(persona, ts);
    assert.equal(r.code, 0);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

Run: `node --test test/check-persona-enum-sync.test.js 2>&1 | tail -10`
Expected: all 4 tests fail because `scripts/check-persona-enum-sync.mjs` does not yet exist.

- [ ] **Step 3: Write the script**

Path: `scripts/check-persona-enum-sync.mjs`

Content:

```javascript
#!/usr/bin/env node
/**
 * Asserts persona doc frontmatter and src/lib/contact-categories.ts
 * stay in sync. Run as a CI gate before deploys.
 *
 * Usage:
 *   node scripts/check-persona-enum-sync.mjs
 *
 * For tests, pass overridable paths:
 *   node scripts/check-persona-enum-sync.mjs \
 *     --persona-doc /tmp/personas.md \
 *     --categories-ts /tmp/contact-categories.ts
 *
 * Exit codes: 0 success, 1 sync failure, 2 file/parse error.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const personaDocPath = resolve(arg('--persona-doc', 'docs/personas/rrm-academy-personas.md'));
const categoriesTsPath = resolve(arg('--categories-ts', 'src/lib/contact-categories.ts'));

function fail(msg) {
  console.error('check-persona-enum-sync: ' + msg);
  process.exit(1);
}
function bail(msg) {
  console.error('check-persona-enum-sync: ' + msg);
  process.exit(2);
}

if (!existsSync(personaDocPath)) bail(`persona doc not found at ${personaDocPath}`);
if (!existsSync(categoriesTsPath)) bail(`categories TS not found at ${categoriesTsPath}`);

const personaSrc = readFileSync(personaDocPath, 'utf-8');
const tsSrc = readFileSync(categoriesTsPath, 'utf-8');

// Extract YAML frontmatter (between leading `---` and next `---`)
const fmMatch = personaSrc.match(/^---\n([\s\S]*?)\n---/);
if (!fmMatch) bail('persona doc has no YAML frontmatter');
const fm = fmMatch[1];

// Extract contact_form_category values (skip null)
const personaCats = new Set();
const personaRegex = /^\s*contact_form_category:\s*([a-z0-9-]+)\s*$/gm;
let m;
while ((m = personaRegex.exec(fm)) !== null) {
  if (m[1] !== 'null') personaCats.add(m[1]);
}
if (personaCats.size === 0) bail('no contact_form_category values found in persona frontmatter');

// Extract CONTACT_CATEGORIES from TS source
const tsArrayMatch = tsSrc.match(/CONTACT_CATEGORIES\s*=\s*\[([^\]]+)\]/);
if (!tsArrayMatch) bail('CONTACT_CATEGORIES array not found in TS source');
const tsCats = new Set();
const tsRegex = /'([a-z0-9-]+)'/g;
while ((m = tsRegex.exec(tsArrayMatch[1])) !== null) tsCats.add(m[1]);
if (tsCats.size === 0) bail('CONTACT_CATEGORIES is empty');

// Compare
const personaOnly = [...personaCats].filter(c => !tsCats.has(c));
const tsOnly = [...tsCats].filter(c => !personaCats.has(c) && c !== 'other');

const issues = [];
if (personaOnly.length) issues.push(`Persona doc has categories not in TS: ${personaOnly.join(', ')}`);
if (tsOnly.length) issues.push(`TS has unused categories (no persona uses them, and not 'other'): ${tsOnly.join(', ')}`);

if (issues.length) {
  for (const i of issues) console.error('  ' + i);
  fail('persona doc and contact-categories.ts are out of sync');
}

console.log(`check-persona-enum-sync: ok (${tsCats.size} categories, ${personaCats.size} persona-mapped)`);
process.exit(0);
```

- [ ] **Step 4: Run the test (expect pass)**

Run: `node --test test/check-persona-enum-sync.test.js 2>&1 | tail -10`
Expected: all 4 tests pass.

- [ ] **Step 5: Run the script against the real files**

Run: `node scripts/check-persona-enum-sync.mjs`
Expected: `check-persona-enum-sync: ok (8 categories, 7 persona-mapped)` (8 in TS — 7 mapped + `other` catch-all).

- [ ] **Step 6: Commit**

```bash
git add scripts/check-persona-enum-sync.mjs test/check-persona-enum-sync.test.js
git commit -m "feat: add check-persona-enum-sync CI gate

Asserts docs/personas/rrm-academy-personas.md frontmatter and
src/lib/contact-categories.ts stay in sync. Will be wired to CI in
deploy.yml in Phase 9."
```

---

## Phase 3: Validator + logger extensions

### Task 3.1: Add `enum` rule type to `_validate.js` (TDD)

**Files:**
- Modify: `functions/api/_validate.js`
- Modify: `test/validate.test.js`

- [ ] **Step 1: Add failing tests**

Append to `test/validate.test.js`:

```javascript
describe('validateBody -- enum type', () => {
  it('accepts a value in the allowed set', () => {
    const r = validateBody({ tier: 'gold' }, {
      tier: { type: 'enum', values: ['gold', 'silver', 'bronze'], required: true },
    });
    assert.equal(r.valid, true);
    assert.equal(r.data.tier, 'gold');
  });

  it('rejects a value not in the allowed set', () => {
    const r = validateBody({ tier: 'platinum' }, {
      tier: { type: 'enum', values: ['gold', 'silver'], required: true },
    });
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
    assert.match(r.error, /tier/);
  });

  it('rejects non-string enum values', () => {
    const r = validateBody({ tier: 1 }, {
      tier: { type: 'enum', values: ['gold'], required: true },
    });
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
  });

  it('treats absent enum as missing -> uses required logic', () => {
    const requiredResult = validateBody({}, {
      tier: { type: 'enum', values: ['gold'], required: true },
    });
    assert.equal(requiredResult.valid, false);

    const optionalResult = validateBody({}, {
      tier: { type: 'enum', values: ['gold'], required: false },
    });
    assert.equal(optionalResult.valid, true);
    assert.equal(optionalResult.data.tier, undefined);
  });

  it('strips whitespace before enum check', () => {
    const r = validateBody({ tier: '  gold  ' }, {
      tier: { type: 'enum', values: ['gold'], required: true },
    });
    assert.equal(r.valid, true);
    assert.equal(r.data.tier, 'gold');
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `node --test test/validate.test.js 2>&1 | tail -15`
Expected: 5 new test failures with messages like `must be a string` or unhandled `enum` type.

- [ ] **Step 3: Add enum support to `_validate.js`**

Read the file first to find the right insertion point (right before the closing brace of the `for` loop or after the last `else if`):

Run: `grep -n "rules.type" functions/api/_validate.js`

Add a new branch after the `'number'` and `'boolean'` branches, before the trailing `else { return ... }`:

```javascript
    } else if (rules.type === 'enum') {
      if (typeof raw !== 'string') {
        return { valid: false, error: `${field} must be a string`, status: 400 };
      }
      const trimmed = raw.trim();
      if (!Array.isArray(rules.values) || rules.values.length === 0) {
        return { valid: false, error: `${field} schema misconfigured (no values)`, status: 500 };
      }
      if (!rules.values.includes(trimmed)) {
        return { valid: false, error: `${field} must be one of: ${rules.values.join(', ')}`, status: 400 };
      }
      data[field] = trimmed;
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `node --test test/validate.test.js 2>&1 | tail -15`
Expected: all tests pass (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add functions/api/_validate.js test/validate.test.js
git commit -m "feat(validate): add enum rule type

Supports 'enum' with values: [...] schema. Used by /api/contact/submit
to validate the new category field. Trimmed string match; 400 on
non-string or unknown value; 500 if schema misconfigured (no values)."
```

### Task 3.2: Extend `_log.js` to accept extra blob fields

**Files:**
- Modify: `functions/api/_log.js`

- [ ] **Step 1: Read current state**

Run: `cat functions/api/_log.js`
Expected: `log(env, waitUntil, event, action, status, detail, duration, httpStatus)` with 5 named blobs.

- [ ] **Step 2: Modify `_log.js` to accept extras**

Replace the function body so it preserves blob positions 1-5 and pushes optional `extras` after:

```javascript
// Structured event logging via Analytics Engine (non-blocking).
// Usage: import { log } from './_log.js';
//        log(env, waitUntil, 'auth', 'login_success', 'ok', email, duration);
//        // With extras (positions 6+):
//        log(env, waitUntil, 'contact', 'submit_ok', 'ok', email, duration, 200, ['stuc-billing', 'card']);

export function log(env, waitUntil, event, action, status, detail, duration, httpStatus, extras) {
  if (!env.EVENTS) return;
  const baseBlobs = ['rrm-academy', event, action, status, (detail || '').slice(0, 200)];
  const extraBlobs = Array.isArray(extras) ? extras.map(v => String(v == null ? '' : v).slice(0, 200)) : [];
  // writeDataPoint is fire-and-forget (returns void, not a Promise).
  // Call directly -- waitUntil(void) throws in Pages Functions.
  env.EVENTS.writeDataPoint({
    blobs: [...baseBlobs, ...extraBlobs],
    doubles: [duration || 0, 1, httpStatus || 0],
    indexes: [action],
  });
}
```

- [ ] **Step 3: Verify no existing callers broke**

Run: `grep -rn "import.*_log\|from.*_log" functions/ | head -20`
Expected: list of callers. Each call passes 7-8 positional args; the new `extras` is optional and last, so no caller needs to change.

Run: `npm test 2>&1 | grep -E '^(ok|not ok|fail)' | tail -20`
Expected: existing tests pass (regression check).

- [ ] **Step 4: Commit**

```bash
git add functions/api/_log.js
git commit -m "feat(log): accept optional extras for AE blob slots 6+

Backward-compatible: existing 8-arg callers unchanged. New optional
ninth arg pushes extra string blobs after detail. Used by
/api/contact/submit to record category and category_source."
```

---

## Phase 4: Contact submit API rewrite

### Task 4.1: Add subject sanitization helper (TDD)

**Files:**
- Create: `functions/api/contact/_subject.js`
- Create: `test/contact-subject.test.js`

- [ ] **Step 1: Write the failing test**

Path: `test/contact-subject.test.js`

```javascript
/**
 * Tests for buildContactSubject() in functions/api/contact/_subject.js
 * Run with: node --test test/contact-subject.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildContactSubject } from '../functions/api/contact/_subject.js';

describe('buildContactSubject', () => {
  it('builds prefix + sanitized message slice', () => {
    const s = buildContactSubject('course', 'Hello world, my course is broken');
    assert.equal(s, '[Contact][COURSE] Hello world, my course is broken');
  });

  it('uppercases the category for the prefix', () => {
    const s = buildContactSubject('stuc-billing', 'Cancel please');
    assert.equal(s, '[Contact][STUC-BILLING] Cancel please');
  });

  it('strips CR/LF from message', () => {
    const s = buildContactSubject('other', 'Hello\r\nBcc: attacker@evil.com');
    assert.equal(s, '[Contact][OTHER] Hello Bcc: attacker@evil.com');
  });

  it('strips control chars from message', () => {
    const s = buildContactSubject('other', 'Hello\x00\x01\x1f\x7fworld');
    assert.equal(s, '[Contact][OTHER] Hello    world'.replace(/\s+/g, ' ')); // expect collapsed
  });

  it('strips bidi controls from message', () => {
    const evil = '‮Hello‬';
    const s = buildContactSubject('other', evil);
    assert.equal(s.includes('‮'), false);
    assert.equal(s.includes('‬'), false);
  });

  it('collapses runs of whitespace to single space', () => {
    const s = buildContactSubject('bug', 'A    B\t\tC');
    assert.equal(s, '[Contact][BUG] A B C');
  });

  it('appends ellipsis when message exceeds 80 chars', () => {
    const long = 'x'.repeat(100);
    const s = buildContactSubject('other', long);
    assert.equal(s.endsWith('…'), true);
    // Body length: 80 chars + 1 ellipsis = 81
    const body = s.slice('[Contact][OTHER] '.length);
    assert.equal(body.length, 81);
  });

  it('does not append ellipsis when message is exactly 80 chars', () => {
    const exact = 'y'.repeat(80);
    const s = buildContactSubject('other', exact);
    assert.equal(s.endsWith('…'), false);
    assert.equal(s, `[Contact][OTHER] ${exact}`);
  });

  it('falls back to "(no preview)" when sanitized message is empty', () => {
    const s = buildContactSubject('bug', '\r\n\t   \x00');
    assert.equal(s, '[Contact][BUG] (no preview)');
  });

  it('handles unknown category by uppercasing whatever was passed', () => {
    const s = buildContactSubject('other', 'hi');
    assert.equal(s.startsWith('[Contact][OTHER]'), true);
  });
});
```

- [ ] **Step 2: Run (expect fail)**

Run: `node --test test/contact-subject.test.js 2>&1 | tail -10`
Expected: all tests fail (`buildContactSubject` not found).

- [ ] **Step 3: Implement the helper**

Path: `functions/api/contact/_subject.js`

```javascript
/**
 * Builds the SES email subject for /api/contact/submit.
 *
 * Format: [Contact][<UPPER_CATEGORY>] <sanitized first 80 chars[…]>
 *
 * Sanitization (mandatory before slicing):
 *   - strip control chars (\x00-\x1f, \x7f)
 *   - strip CR/LF (already covered by control chars above)
 *   - strip Unicode bidirectional controls (LRE/RLE/PDF/LRO/RLO/LRI/RLI/FSI/PDI)
 *   - collapse runs of whitespace to single space
 *   - trim
 *
 * The [Contact] outer prefix is preserved so existing Gmail filters
 * keying on subject:[Contact] continue to match.
 */

// eslint-disable-next-line no-control-regex -- intentional: strip control chars
const CONTROL_OR_BIDI_RE = /[\x00-\x1f\x7f‪-‮⁦-⁩]/g;

export function buildContactSubject(category, message) {
  const upper = String(category || 'other').toUpperCase();
  const sanitized = String(message || '')
    .replace(CONTROL_OR_BIDI_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized) {
    return `[Contact][${upper}] (no preview)`;
  }
  const body = sanitized.length > 80 ? sanitized.slice(0, 80) + '…' : sanitized;
  return `[Contact][${upper}] ${body}`;
}
```

- [ ] **Step 4: Run (expect pass)**

Run: `node --test test/contact-subject.test.js 2>&1 | tail -10`
Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/api/contact/_subject.js test/contact-subject.test.js
git commit -m "feat(contact): add buildContactSubject sanitizer

Strips control + CR/LF + bidi Unicode, collapses whitespace, trims,
slices to 80 chars with ellipsis. Preserves [Contact] outer prefix
for Gmail filter back-compat. Follows by [<UPPER_CATEGORY>] inner
tag for triage."
```

### Task 4.2: Update submit.js to validate category + category_source (TDD)

**Files:**
- Modify: `functions/api/contact/submit.js`
- Create: `test/contact-submit.test.js`

- [ ] **Step 1: Write the failing tests**

Path: `test/contact-submit.test.js`

```javascript
/**
 * Tests for POST /api/contact/submit (functions/api/contact/submit.js)
 * Run with: node --test test/contact-submit.test.js
 *
 * Stubs all external fetch (Turnstile, DNS MX, ELV, SES) for happy-path tests.
 * Asserts:
 *   - new category enum validation (valid + invalid + missing default)
 *   - new category_source enum validation
 *   - subject prefix construction (delegated to _subject.js — light coverage here)
 *   - honeypot returns 200 silently
 *   - missing category defaults to 'other' (deploy back-compat)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/contact/submit.js';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse, randomIp } from './_helpers.js';

function stubFetchSuccess() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('siteverify')) return { ok: true, json: async () => ({ success: true }) };
    if (u.includes('cloudflare-dns.com') && u.includes('type=MX')) return { ok: true, json: async () => ({ Answer: [{ data: 'mx.example.com' }] }) };
    if (u.includes('cloudflare-dns.com') && u.includes('type=A')) return { ok: true, json: async () => ({ Answer: [{ data: '1.2.3.4' }] }) };
    if (u.includes('emaillistverify.com')) return { ok: true, text: async () => 'ok' };
    if (u.includes('amazonaws.com')) return { ok: true, text: async () => '<SendEmailResponse/>' };
    return original(url);
  };
  return () => { globalThis.fetch = original; };
}

function makeBody(overrides = {}) {
  return {
    name: 'Alice Tester',
    email: 'alice@example.com',
    message: 'Hello, this is a test message that is long enough.',
    category: 'course',
    category_source: 'card',
    turnstileToken: 'tok-' + Math.random(),
    website: '',
    ...overrides,
  };
}

describe('contact-submit -- category enum', () => {
  it('accepts a valid category', async () => {
    const restore = stubFetchSuccess();
    try {
      const env = mockEnv();
      const req = mockRequest('POST', '/api/contact/submit', makeBody({ category: 'stuc-billing' }), { 'CF-Connecting-IP': randomIp() });
      const res = await onRequestPost({ request: req, env, waitUntil: mockWaitUntil() });
      const parsed = await parseResponse(res);
      assert.equal(parsed.body.ok, true, JSON.stringify(parsed.body));
    } finally { restore(); }
  });

  it('rejects an invalid category', async () => {
    const restore = stubFetchSuccess();
    try {
      const env = mockEnv();
      const req = mockRequest('POST', '/api/contact/submit', makeBody({ category: 'bogus' }), { 'CF-Connecting-IP': randomIp() });
      const res = await onRequestPost({ request: req, env, waitUntil: mockWaitUntil() });
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 400);
      assert.equal(parsed.body.ok, false);
      assert.match(parsed.body.error, /category/i);
    } finally { restore(); }
  });

  it('defaults missing category to "other" (back-compat for cached pages)', async () => {
    const restore = stubFetchSuccess();
    try {
      const env = mockEnv();
      const body = makeBody();
      delete body.category;
      delete body.category_source;
      const req = mockRequest('POST', '/api/contact/submit', body, { 'CF-Connecting-IP': randomIp() });
      const res = await onRequestPost({ request: req, env, waitUntil: mockWaitUntil() });
      const parsed = await parseResponse(res);
      assert.equal(parsed.body.ok, true, JSON.stringify(parsed.body));
    } finally { restore(); }
  });

  it('rejects an invalid category_source', async () => {
    const restore = stubFetchSuccess();
    try {
      const env = mockEnv();
      const req = mockRequest('POST', '/api/contact/submit', makeBody({ category_source: 'bogus-source' }), { 'CF-Connecting-IP': randomIp() });
      const res = await onRequestPost({ request: req, env, waitUntil: mockWaitUntil() });
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 400);
    } finally { restore(); }
  });

  it('honeypot returns 200 silently regardless of category', async () => {
    const restore = stubFetchSuccess();
    try {
      const env = mockEnv();
      const req = mockRequest('POST', '/api/contact/submit', makeBody({ website: 'spam', category: 'bogus' }), { 'CF-Connecting-IP': randomIp() });
      const res = await onRequestPost({ request: req, env, waitUntil: mockWaitUntil() });
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 200);
      assert.equal(parsed.body.ok, true);
    } finally { restore(); }
  });
});

describe('contact-submit -- subject prefix', () => {
  it('email subject includes [Contact][CATEGORY] prefix', async () => {
    const restore = stubFetchSuccess();
    try {
      let capturedSubject = null;
      const original = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        if (String(url).includes('amazonaws.com') && opts && opts.body) {
          // Subject is encoded in the SES request body. Look for "Subject="
          const m = String(opts.body).match(/Subject(?:\.Data)?=([^&]+)/);
          if (m) capturedSubject = decodeURIComponent(m[1].replace(/\+/g, ' '));
          return { ok: true, text: async () => '<SendEmailResponse/>' };
        }
        return original(url, opts);
      };
      try {
        const env = mockEnv();
        const req = mockRequest('POST', '/api/contact/submit', makeBody({ category: 'bug', message: 'Found a typo on /about/' }), { 'CF-Connecting-IP': randomIp() });
        await onRequestPost({ request: req, env, waitUntil: mockWaitUntil() });
        assert.match(capturedSubject || '', /^\[Contact\]\[BUG\]/);
      } finally {
        globalThis.fetch = original;
      }
    } finally { restore(); }
  });
});
```

- [ ] **Step 2: Run (expect fail)**

Run: `node --test test/contact-submit.test.js 2>&1 | tail -20`
Expected: most tests fail because `submit.js` does not yet validate category. The honeypot test may pass.

- [ ] **Step 3: Modify submit.js to validate category + use sanitized subject**

Read current state: `cat functions/api/contact/submit.js`

Apply these changes:

1. Add imports at the top (after existing imports):

```javascript
import { CONTACT_CATEGORIES, CATEGORY_SOURCES } from '../../../src/lib/contact-categories.ts';
import { buildContactSubject } from './_subject.js';
```

(Note on import path: CF Pages Functions can import from `src/` directly because Astro's build resolves both. If TS import fails at build, fall back to a `.js` mirror — see Step 3b.)

2. Update the `validateBody` schema in submit.js to add the two new fields:

```javascript
    const validated = validateBody(body, {
      name:    { type: 'string', required: true, maxLength: 200 },
      email:   { type: 'email',  required: true },
      message: { type: 'string', required: true, minLength: 10, maxLength: 5000 },
      category: { type: 'enum', values: [...CONTACT_CATEGORIES], required: false },
      category_source: { type: 'enum', values: [...CATEGORY_SOURCES], required: false },
    });
```

3. After `const message = validated.data.message;`, add:

```javascript
    const category = validated.data.category || 'other';
    const categorySource = validated.data.category_source || 'default';
```

4. Replace `const notifySubject = \`[Contact] ${name} (${email})\`;` with:

```javascript
    const notifySubject = buildContactSubject(category, message);
```

5. In the email body `text:` array, add identifying lines:

```javascript
        text: [
          `Name: ${name}`,
          `Email: ${email}`,
          `Category: ${category} (source: ${categorySource})`,
          '',
          message,
          '',
          '---',
          `Sent from rrmacademy.org/contact at ${new Date().toISOString()}`,
        ].join('\n'),
```

6. Find the existing `log(env, waitUntil, 'contact', ...)` calls and update the success-path call (or add one if missing) to pass extras as the 9th arg. Search for the one called on success:

Run: `grep -n "log(env, waitUntil, 'contact'" functions/api/contact/submit.js`

Update each so the signature includes the new extras for success paths:

```javascript
log(env, waitUntil, 'contact', 'submit_ok', 'ok', email, 0, 200, [category, categorySource]);
```

(Failure paths can keep the 8-arg form or include extras as appropriate; stay backward compatible.)

- [ ] **Step 3b: Handle TS import path if needed**

If the build complains about importing `.ts` from a CF Function, create a tiny shim:

Path: `src/lib/contact-categories.js` (sibling JS file generated by hand for the function-side import — keeps the TS file as the SSOT and re-exports via `export * from './contact-categories.ts'` after `tsc` or simply duplicates the const arrays). Simplest: re-export plain JS from the TS file by writing a `.js` that mirrors the arrays:

Actually, simpler: change the SSOT file to `.js` (with JSDoc types) so both Astro and CF Functions can import without a TS toolchain at the function side. Update the import in submit.js to `'../../../src/lib/contact-categories.js'`.

If you go this route, redo Task 2.1 with `.js` extension and JSDoc type annotations:

```javascript
/**
 * @typedef {'course' | 'stuc-billing' | 'clinician-or-researcher' | 'speaking' | 'partnership' | 'donor-or-grants' | 'bug' | 'other'} ContactCategory
 * @typedef {'card' | 'text-link' | 'select' | 'hash' | 'default'} CategorySource
 */
export const CONTACT_CATEGORIES = ['course', 'stuc-billing', 'clinician-or-researcher', 'speaking', 'partnership', 'donor-or-grants', 'bug', 'other'];
export const CATEGORY_SOURCES = ['card', 'text-link', 'select', 'hash', 'default'];
export const CONTACT_CATEGORY_LABELS = { /* ...as before... */ };
export function categorySubjectLabel(category) { return String(category).toUpperCase(); }
export function isContactCategory(value) { return typeof value === 'string' && CONTACT_CATEGORIES.includes(value); }
export function isCategorySource(value) { return typeof value === 'string' && CATEGORY_SOURCES.includes(value); }
```

Decide between `.ts` + a build step vs `.js` with JSDoc based on what works in `npm run check-types` and `npm run build`. Default to `.js` since CF Pages Functions consume it directly without a transpile.

If you switched to `.js`, update Task 2.2's script to read `contact-categories.js` (it greps for the `CONTACT_CATEGORIES = [...]` literal regardless of extension, but the default path arg should change).

- [ ] **Step 4: Run all contact-related tests**

Run: `node --test test/contact-subject.test.js test/contact-submit.test.js test/validate.test.js 2>&1 | tail -30`
Expected: all pass.

- [ ] **Step 5: Run guard manifest check**

Run: `npm run guard 2>&1 | tail -20`
Expected: failure on submit.js hash mismatch.

- [ ] **Step 6: Update guard manifest**

Run: `npm run guard:update`
Expected: regenerated `scripts/guard-manifest.json`. Confirm via `git diff scripts/guard-manifest.json`.

- [ ] **Step 7: Re-run guard**

Run: `npm run guard 2>&1 | tail -5`
Expected: pass.

- [ ] **Step 8: Run full test suite**

Run: `npm test 2>&1 | tail -10`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add functions/api/contact/submit.js \
        src/lib/contact-categories.js \
        scripts/guard-manifest.json \
        test/contact-submit.test.js
git rm src/lib/contact-categories.ts 2>/dev/null || true
git commit -m "feat(contact): validate category + sanitize subject

submit.js gains:
- category + category_source enum validation via validateBody
- subject construction via buildContactSubject (sanitized + prefixed)
- AE blob extras: [category, categorySource]
- email body identifies category and source

Wire is back-compat: missing category defaults to 'other'.
Honeypot path unchanged. Guard manifest regenerated."
```

---

## Phase 5: Bridge page primitive

### Task 5.1: Create BridgePagePrimitive component

**Files:**
- Create: `src/components/BridgePagePrimitive.astro`

- [ ] **Step 1: Read existing BaseLayout to understand the layout API**

Run: `head -80 src/layouts/BaseLayout.astro`
Note its prop names (`title`, `description`, `canonicalUrl`, `jsonLd`, etc.) for use below.

- [ ] **Step 2: Write the primitive**

Path: `src/components/BridgePagePrimitive.astro`

```astro
---
/**
 * BridgePagePrimitive -- reusable component for SEO bridge pages that capture
 * branded navigational queries and funnel users to an external destination
 * (e.g., UPMC profile, FACTS provider directory).
 *
 * Build-time prop validation prevents javascript:/data:/file: schemes.
 */
import BaseLayout from '../layouts/BaseLayout.astro';

interface Props {
  title: string;
  intent?: string;
  outboundLabel: string;
  outboundUrl: string;
  outboundRel?: string;
  subjectPersonId?: string;
  metaDescription?: string;
}

const { title, intent, outboundLabel, outboundUrl, outboundRel, subjectPersonId, metaDescription } = Astro.props as Props;

// Build-time validation
if (!title) throw new Error('BridgePagePrimitive: `title` is required');
if (!outboundLabel) throw new Error('BridgePagePrimitive: `outboundLabel` is required');
if (!outboundUrl) throw new Error('BridgePagePrimitive: `outboundUrl` is required');
if (!/^(https?:\/\/|\/)/i.test(outboundUrl)) {
  throw new Error(`BridgePagePrimitive: outboundUrl must start with https://, http://, or / -- got "${outboundUrl}"`);
}

const isExternal = /^https?:\/\//i.test(outboundUrl);
const computedRel = outboundRel ?? (isExternal ? 'noopener noreferrer external' : '');

const description = metaDescription ?? intent ?? title;

const breadcrumbList = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'RRM Academy', item: 'https://rrmacademy.org/' },
    { '@type': 'ListItem', position: 2, name: title, item: Astro.url.href },
  ],
};

const webPage: Record<string, unknown> = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: title,
  description,
  url: Astro.url.href,
};
if (subjectPersonId) {
  webPage.about = { '@id': subjectPersonId };
}
---
<BaseLayout
  title={title}
  description={description}
  canonicalUrl={Astro.url.href}
  jsonLd={[webPage, breadcrumbList]}
>
  <section class="bridge-hero">
    <div class="container container--narrow">
      <h1>{title}</h1>
      {intent && <p class="bridge-intent">{intent}</p>}
    </div>
  </section>

  <section class="bridge-body">
    <div class="container container--narrow">
      <slot />

      <p class="bridge-cta">
        <a class="btn btn--primary" href={outboundUrl} rel={computedRel || undefined} target={isExternal ? '_blank' : undefined}>
          {outboundLabel}
        </a>
      </p>
    </div>
  </section>
</BaseLayout>

<style>
  .bridge-hero {
    padding: var(--space-8) 0 var(--space-6);
    border-bottom: 1px solid var(--border-color);
    text-align: center;
  }
  .bridge-hero h1 {
    font-size: clamp(2rem, 1.25rem + 2.5vw, 3.25rem);
    margin-bottom: var(--space-3);
  }
  .bridge-intent {
    color: var(--text-secondary);
    margin: 0 auto;
    max-width: 36rem;
  }
  .bridge-body {
    padding: var(--space-10) 0;
  }
  @media (min-width: 769px) {
    .bridge-body {
      padding: var(--space-16) 0;
    }
  }
  .bridge-cta {
    margin-top: var(--space-8);
    text-align: center;
  }
</style>
```

- [ ] **Step 3: Test build-time prop validation manually**

Create a temp test page: `src/pages/test-bridge-bad.astro` with content:

```astro
---
import BridgePagePrimitive from '../components/BridgePagePrimitive.astro';
---
<BridgePagePrimitive title="X" outboundLabel="Y" outboundUrl="javascript:alert(1)" />
```

Run: `npm run build 2>&1 | tail -10`
Expected: build fails with the validation error from the primitive.

Delete the test page: `rm src/pages/test-bridge-bad.astro`

- [ ] **Step 4: Commit**

```bash
git add src/components/BridgePagePrimitive.astro
git commit -m "feat: BridgePagePrimitive for SEO funnel pages

Reusable component that renders BaseLayout + hero + body slot +
single outbound CTA, with build-time URL scheme validation.
Emits WebPage + BreadcrumbList JSON-LD via set:html JSON.stringify.
First instance lands in the next commit."
```

---

## Phase 6: First bridge page + about-page inbound link

### Task 6.1: Create /schedule-with-dr-whittaker/

**Files:**
- Create: `src/pages/schedule-with-dr-whittaker.astro`

- [ ] **Step 1: Look up Dr Whittaker's UPMC profile URL**

Run: `gmail search 'UPMC profile naomi' -a administrator | head -3` or check `~/iCode/CLAUDE.md` for the canonical URL. If not stored, search:

Run: `curl -s 'https://www.upmc.com/api/find-a-doctor/search?q=naomi+whittaker' | head -50` or visit `https://www.upmc.com/find-a-doctor` manually and copy her profile URL.

If the URL cannot be confirmed in this session, use placeholder `https://www.upmc.com/find-a-doctor` and document a TODO in commit body for Brian to swap before merge. (This is the only "TODO-style" placeholder in the plan and only because the URL is not encoded in canonical config.)

- [ ] **Step 2: Write the page**

Path: `src/pages/schedule-with-dr-whittaker.astro`

```astro
---
import BridgePagePrimitive from '../components/BridgePagePrimitive.astro';

const upmcProfileUrl = 'https://www.upmc.com/find-a-doctor'; // TODO before merge: replace with Naomi's specific profile URL once confirmed
---
<BridgePagePrimitive
  title="Schedule with Dr Whittaker"
  intent="Dr Naomi Whittaker is a board-certified OBGYN. RRM Academy is her education project; clinical scheduling is handled by her current practice."
  outboundLabel="Visit Dr Whittaker's clinical profile"
  outboundUrl={upmcProfileUrl}
  metaDescription="How to schedule a clinical appointment with Dr Naomi Whittaker, MD. RRM Academy is her education project; clinical care is provided through her current practice."
  subjectPersonId="https://rrmacademy.org/about/#naomi-whittaker"
>
  <p>
    Dr Naomi Whittaker, MD is a board-certified OBGYN and the lead instructor of RRM Academy.
    She sees patients clinically through her current practice, separate from the educational
    work she leads here.
  </p>
  <p>
    To request an appointment, please visit her clinical profile, which carries current
    scheduling instructions, contact information, and office locations. RRM Academy does
    not schedule patient appointments.
  </p>
</BridgePagePrimitive>
```

- [ ] **Step 3: Verify build + render**

Run: `npm run build 2>&1 | tail -5`
Expected: build succeeds.

Run: `npm run dev` (background), then `curl -s http://localhost:4321/schedule-with-dr-whittaker/ | grep -E '<title>|outbound|UPMC|Schedule with' | head -10`
Expected: title contains "Schedule with Dr Whittaker", body links to UPMC. Kill dev when done.

- [ ] **Step 4: Commit**

```bash
git add src/pages/schedule-with-dr-whittaker.astro
git commit -m "feat: bridge page /schedule-with-dr-whittaker/

First instance of BridgePagePrimitive. Captures branded
navigational queries; funnels to UPMC profile. Designed for
low-friction copy swap when Lunira launches.

TODO before merge: confirm UPMC profile URL is the correct
specific profile (placeholder uses upmc.com/find-a-doctor)."
```

### Task 6.2: Add inbound link from about page

**Files:**
- Modify: `src/components/TeamCard.astro` OR `src/pages/about.astro`
- Modify: `docs/personas/bridge-pages.json` (no change — already registered)

- [ ] **Step 1: Read TeamCard and about.astro to pick placement**

Run: `cat src/components/TeamCard.astro 2>/dev/null && echo '---' && grep -n 'naomi\|whittaker\|TeamCard' src/pages/about.astro | head -20`
Expected: see how Naomi's card is rendered. Two options:
- (a) Add a conditional slot inside `TeamCard.astro` keyed on `member.id === 'naomi-whittaker'`
- (b) Add a small standalone paragraph below the team grid in `about.astro`

Pick whichever is cleaner; (b) is usually safer (doesn't change the shared component).

- [ ] **Step 2: Add the contextual link (option b — about.astro)**

If option (b): insert after the existing team-grid section in `src/pages/about.astro`:

```astro
<aside class="about-clinical-note">
  <p>
    <strong>Looking to schedule with Dr Whittaker as a patient?</strong>
    <a href="/schedule-with-dr-whittaker/">See here for her clinical practice information</a>.
  </p>
</aside>

<style>
  .about-clinical-note {
    margin: var(--space-10) auto;
    max-width: 36rem;
    padding: var(--space-5);
    border-left: 3px solid var(--accent);
    background: var(--bg-surface);
    font-size: 0.9375rem;
  }
</style>
```

If option (a): inside `TeamCard.astro`, add a conditional block (keep existing card markup, add at bottom):

```astro
{member.id === 'naomi-whittaker' && (
  <p class="team-card__clinical-note">
    Looking to schedule with Dr Whittaker as a patient?
    <a href="/schedule-with-dr-whittaker/">See here</a>.
  </p>
)}
```

- [ ] **Step 3: Verify with dev server**

Run: `npm run dev` (background), then `curl -s http://localhost:4321/about/ | grep -E 'schedule-with-dr-whittaker' | head -3`
Expected: at least one `<a href="/schedule-with-dr-whittaker/">` link.

- [ ] **Step 4: Commit**

```bash
git add src/pages/about.astro src/components/TeamCard.astro 2>/dev/null
git commit -m "feat(about): inbound link to bridge page

Adds one contextual inbound link from the about page to
/schedule-with-dr-whittaker/ so the bridge inherits internal
PageRank. AuthorByline component intentionally NOT modified
per spec."
```

---

## Phase 7: Middleware case-canonicalizer for bridge pages

### Task 7.1: Extend case-canonicalizer + test

**Files:**
- Modify: `functions/_middleware.js`
- Create: `test/middleware-bridge-canonical.test.js`

- [ ] **Step 1: Read existing canonicalizer**

Run: `grep -n -A6 'library' functions/_middleware.js | head -30`
Note the pattern — it's a regex match on `/library*` paths that 301s to lowercase. Extend to include `/schedule-with-dr-whittaker*` (or generalize to a list).

- [ ] **Step 2: Write the failing test**

Path: `test/middleware-bridge-canonical.test.js`

```javascript
/**
 * Tests that mixed-case bridge URLs 301 to canonical lowercase.
 * Run with: node --test test/middleware-bridge-canonical.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';
import { mockRequest, mockEnv } from './_helpers.js';

describe('middleware bridge-page canonical redirect', () => {
  it('redirects /Schedule-With-Dr-Whittaker/ to /schedule-with-dr-whittaker/', async () => {
    const req = mockRequest('GET', '/Schedule-With-Dr-Whittaker/', null);
    const env = mockEnv();
    const ctx = { request: req, env, next: async () => new Response('next-called', { status: 200 }), data: {} };
    const res = await onRequest(ctx);
    assert.equal(res.status, 301);
    assert.match(res.headers.get('location') || '', /\/schedule-with-dr-whittaker\//);
  });

  it('passes lowercase /schedule-with-dr-whittaker/ through unchanged', async () => {
    const req = mockRequest('GET', '/schedule-with-dr-whittaker/', null);
    const env = mockEnv();
    let nextCalled = false;
    const ctx = { request: req, env, next: async () => { nextCalled = true; return new Response('ok', { status: 200 }); }, data: {} };
    await onRequest(ctx);
    assert.equal(nextCalled, true);
  });
});
```

- [ ] **Step 3: Run (expect fail)**

Run: `node --test test/middleware-bridge-canonical.test.js 2>&1 | tail -10`
Expected: redirect test fails (no canonicalizer exists yet for bridge pages).

- [ ] **Step 4: Extend the canonicalizer**

Find the existing case-redirect block in `functions/_middleware.js` (look for `/library`). Extend the path-prefix list:

```javascript
const CASE_CANONICAL_PREFIXES = [
  '/library',
  '/schedule-with-dr-whittaker',
];

function shouldCanonicalize(pathname) {
  const lower = pathname.toLowerCase();
  return CASE_CANONICAL_PREFIXES.some(p => lower.startsWith(p)) && lower !== pathname;
}
```

Wire `shouldCanonicalize(url.pathname)` into the existing redirect logic in `onRequest`, returning a 301 to `url.pathname.toLowerCase() + url.search` if it triggers.

(If the existing implementation is already a generalized matcher, this is a one-line list addition.)

- [ ] **Step 5: Run tests (expect pass)**

Run: `node --test test/middleware-bridge-canonical.test.js 2>&1 | tail -10`
Expected: both tests pass.

- [ ] **Step 6: Run middleware regression suite**

Run: `node --test test/middleware-token-preservation.test.js 2>&1 | tail -10`
Expected: pass.

- [ ] **Step 7: Update guard manifest if middleware was modified**

Run: `npm run guard 2>&1 | tail -5`
If failure: `npm run guard:update`, then re-run.

- [ ] **Step 8: Commit**

```bash
git add functions/_middleware.js scripts/guard-manifest.json test/middleware-bridge-canonical.test.js
git commit -m "feat(middleware): canonicalize bridge-page URLs

Mixed-case /Schedule-With-Dr-Whittaker/ now 301s to lowercase
/schedule-with-dr-whittaker/. Generalized the existing /library
canonicalizer to accept a list of prefixes; future bridge pages
add themselves by extending CASE_CANONICAL_PREFIXES."
```

---

## Phase 8: Contact form rewrite

This is the largest single task. Break into substeps because the form has multiple coordinated pieces.

### Task 8.1: Build static layout (cards + text-link line + sidebar)

**Files:**
- Modify: `src/pages/contact.astro` (full rewrite of form region; preserve hero/sidebar/nonprofit shells)

- [ ] **Step 1: Read current contact.astro to preserve unchanged shells**

Run: `cat src/pages/contact.astro`
Note: the hero, sidebar info block, and nonprofit footer are kept. Form region (the `<form id="contact-form">` and surrounding `<div class="contact-form-wrap">`) is fully replaced.

- [ ] **Step 2: Replace the form region**

Replace the section currently rendering `<h2>Send us a message</h2>` through the closing `</form>` with the new layout. Below is the complete new form region — read carefully and integrate (do not just paste over working bits like Turnstile container; merge thoughtfully):

```astro
<!-- Form wrap -->
<div class="contact-form-wrap">
  <h2>How can we help?</h2>
  <p class="contact-intro">
    Pick the topic that fits and we'll point you to the fastest path. If your situation does not match any topic below, "Something else" routes to a general inbox.
  </p>

  <!-- Three primary cards (single-open accordion) -->
  <div class="contact-cards" role="region" aria-label="Common topics">
    <details name="contact-cards" class="contact-card" data-category="course">
      <summary>I have a question about a course</summary>
      <div class="contact-card__body">
        <p>If you're a course taker, the fastest paths are:</p>
        <ul>
          <li><a href="/account">/account → My courses</a> for access, lesson progress, and certificates (login required).</li>
          <li><a href="/faqs/courses/">Course FAQs</a> for common questions.</li>
        </ul>
        <p><a href="#contact-form?category=course" class="contact-card__send" data-category="course" data-source="card">Still need help? Send a message →</a></p>
      </div>
    </details>

    <details name="contact-cards" class="contact-card" data-category="stuc-billing">
      <summary>I'm a member or recurring donor</summary>
      <div class="contact-card__body">
        <p>If your subscription is through RRM Academy (Stripe-managed):</p>
        <ul>
          <li><a href="/account">/account → Manage subscription</a> for cancellation, card update, or receipts (login required).</li>
        </ul>
        <p>If you give recurring through PayPal directly:</p>
        <ul>
          <li><a href="https://www.paypal.com/myaccount/autopay/" rel="noopener noreferrer external">PayPal → Settings → Payments → Manage automatic payments</a> to cancel or change.</li>
        </ul>
        <p><a href="#contact-form?category=stuc-billing" class="contact-card__send" data-category="stuc-billing" data-source="card">Still need help? Send a message →</a></p>
      </div>
    </details>

    <details name="contact-cards" class="contact-card" data-category="other">
      <summary>Something else / not sure where to start</summary>
      <div class="contact-card__body">
        <p>Try these first:</p>
        <ul>
          <li><a href="/ask">/ask</a> for "is RRM right for me?" type questions (free RRM Academy account required).</li>
          <li><a href="/faqs">/faqs</a> for common questions.</li>
          <li>Pillar guides: <a href="/what-is-rrm/">What is RRM</a>, <a href="/naprotechnology/">NaProTechnology</a>, <a href="/femm/">FEMM</a>, <a href="/neofertility/">NeoFertility</a>.</li>
          <li><a href="/endo-survey/">Endo survey</a> if you're investigating endometriosis.</li>
        </ul>
        <p><a href="#contact-form?category=other" class="contact-card__send" data-category="other" data-source="card">Still need help? Send a message →</a></p>
      </div>
    </details>
  </div>

  <!-- Other inquiries text-link line -->
  <p class="contact-other-inquiries">
    Other inquiries:
    <a href="#contact-form?category=clinician-or-researcher" data-category="clinician-or-researcher" data-source="text-link">clinician or researcher</a> ·
    <a href="#contact-form?category=speaking" data-category="speaking" data-source="text-link">speaking or media</a> ·
    <a href="#contact-form?category=partnership" data-category="partnership" data-source="text-link">partnership</a> ·
    <a href="#contact-form?category=donor-or-grants" data-category="donor-or-grants" data-source="text-link">donor or grants</a> ·
    <a href="#contact-form?category=bug" data-category="bug" data-source="text-link">bug or accessibility</a>
  </p>

  <!-- Single form region -->
  <form id="contact-form" class="contact-form" novalidate action="/api/contact/submit" method="POST">
    <!-- Sending-as indicator -->
    <p class="sending-as" id="sending-as" aria-live="polite">
      <span class="sending-as__label" id="sending-as-label">Sending as: <strong>Choose a topic above</strong></span>
      <a href="#contact-cards" class="sending-as__change" id="sending-as-change" hidden>[change]</a>
    </p>

    <!-- JS-disabled fallback select (visible by default; JS hides when category set via card click) -->
    <noscript>
      <p class="form-noscript-note">JavaScript is off. Pick a topic to enable submit:</p>
    </noscript>
    <div class="form-group" id="category-fallback-group">
      <label class="form-label" for="category-fallback">What is this about?</label>
      <select class="form-input" id="category-fallback" name="category-fallback">
        <option value="">— Choose —</option>
        <option value="course">Course question</option>
        <option value="stuc-billing">Member or recurring donor</option>
        <option value="clinician-or-researcher">Clinician or researcher</option>
        <option value="speaking">Speaking or media</option>
        <option value="partnership">Partnership or affiliate</option>
        <option value="donor-or-grants">Donor or grants</option>
        <option value="bug">Bug or accessibility</option>
        <option value="other">Something else</option>
      </select>
    </div>

    <input type="hidden" name="category" id="category-hidden" value="" />
    <input type="hidden" name="category_source" id="category-source-hidden" value="" />

    <div class="form-group">
      <label class="form-label" for="contact-message">Your message <span class="form-required">*</span></label>
      <textarea class="form-input form-textarea" id="contact-message" name="message" required minlength="10" maxlength="5000" rows="6" placeholder="Your message"></textarea>
      <span class="form-hint" id="char-count"></span>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="contact-first-name">First name <span class="form-required">*</span></label>
        <input class="form-input" type="text" id="contact-first-name" name="firstName" required autocomplete="given-name" maxlength="100" placeholder="First name" />
      </div>
      <div class="form-group">
        <label class="form-label" for="contact-last-name">Last name</label>
        <input class="form-input" type="text" id="contact-last-name" name="lastName" autocomplete="family-name" maxlength="100" placeholder="Last name" />
      </div>
    </div>

    <div class="form-group">
      <label class="form-label" for="contact-email">Email <span class="form-required">*</span></label>
      <input class="form-input" type="email" id="contact-email" name="email" required autocomplete="email" placeholder="Email" />
    </div>

    <!-- Honeypot — preserved -->
    <div class="form-group" style="position:absolute;left:-9999px;" aria-hidden="true">
      <label for="contact-website">Website</label>
      <input type="text" id="contact-website" name="website" tabindex="-1" autocomplete="off" />
    </div>

    {TURNSTILE_SITE_KEY && (
      <div id="turnstile-container" data-sitekey={TURNSTILE_SITE_KEY}></div>
    )}

    <button type="submit" class="btn btn--primary contact-submit" id="contact-submit" disabled>Send</button>
  </form>

  <!-- Success / error feedback (preserve existing) -->
  <div id="contact-success" class="contact-feedback contact-feedback--success" hidden>
    <div class="contact-feedback__icon">✓</div>
    <h3>Message sent</h3>
    <p>Thank you for reaching out. We will get back to you as soon as possible.</p>
  </div>
  <div id="contact-error" class="contact-feedback contact-feedback--error" hidden>
    <p id="contact-error-text"></p>
  </div>
</div>
```

- [ ] **Step 3: Verify markup renders without errors**

Run: `npm run build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 4: Visual check**

Run: `npm run dev` (background); open http://localhost:4321/contact/ in a browser; verify cards render, text-link line is present, form region exists with disabled submit. Kill dev.

- [ ] **Step 5: Stage but don't commit yet**

Defer commit to after Task 8.4 (full functional change).

### Task 8.2: Add CSS for new components

**Files:**
- Modify: `src/pages/contact.astro` `<style>` block

- [ ] **Step 1: Append new styles to the existing `<style>` block**

Add these styles at the end of the existing `<style>` block in `contact.astro`:

```css
/* Cards (lightweight, typography-led) */
.contact-cards {
  margin: var(--space-8) 0 var(--space-6);
}
.contact-card {
  border-bottom: 1px solid var(--border-light);
  padding: var(--space-5) 0;
}
.contact-card[open] {
  background: var(--bg-surface);
}
.contact-card > summary {
  font-family: var(--font-display, 'Cormorant Garamond', serif);
  font-size: 1.25rem;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
  padding: var(--space-2) 0;
  position: relative;
}
.contact-card > summary::-webkit-details-marker { display: none; }
.contact-card > summary::after {
  content: '+';
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  font-size: 1.5rem;
  color: var(--text-secondary);
  transition: transform 0.15s;
}
.contact-card[open] > summary::after {
  content: '−';
}
.contact-card__body {
  padding: var(--space-3) 0 var(--space-5);
  color: var(--text-secondary);
}
.contact-card__body ul {
  margin: var(--space-3) 0;
  padding-left: var(--space-5);
}
.contact-card__body li {
  margin-bottom: var(--space-2);
}
.contact-card__send {
  display: inline-block;
  margin-top: var(--space-3);
  font-weight: 500;
  color: var(--accent);
}

/* Other inquiries line */
.contact-other-inquiries {
  margin: var(--space-6) 0 var(--space-8);
  font-size: 0.9375rem;
  color: var(--text-secondary);
  text-align: center;
}
.contact-other-inquiries a {
  color: var(--accent);
}

/* Sending-as indicator */
.sending-as {
  margin: 0 0 var(--space-5);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  font-size: 0.9375rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
}
.sending-as__label strong {
  color: var(--text-primary);
}
.sending-as__change {
  font-size: 0.8125rem;
  color: var(--accent);
}

/* Submit disabled state */
.contact-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* JS-disabled fallback group: shown by default; JS hides when category is set via card */
#category-fallback-group {
  margin-bottom: var(--space-5);
}
.js-loaded #category-fallback-group.js-hidden {
  display: none;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -5`
Expected: build succeeds.

- [ ] **Step 3: Stage but don't commit yet**

Defer to Task 8.4.

### Task 8.3: Wire JS for category state, prefill, scroll, and indicator

**Files:**
- Modify: `src/pages/contact.astro` `<script is:inline>` block

- [ ] **Step 1: Replace/extend the existing inline script**

Read the existing `<script is:inline>` block in `contact.astro`. Keep the existing form-submission flow (Turnstile, fetch, success/error UI) — extend it with new behavior. The full new script:

```javascript
(function () {
  // Mark JS-loaded so CSS can hide the fallback select when a card sets category
  document.documentElement.classList.add('js-loaded');

  var form = document.getElementById('contact-form');
  var submitBtn = document.getElementById('contact-submit');
  var successEl = document.getElementById('contact-success');
  var errorEl = document.getElementById('contact-error');
  var errorText = document.getElementById('contact-error-text');
  var charCount = document.getElementById('char-count');
  var messageField = document.getElementById('contact-message');
  var firstNameField = document.getElementById('contact-first-name');
  var lastNameField = document.getElementById('contact-last-name');
  var emailField = document.getElementById('contact-email');
  var hiddenCategory = document.getElementById('category-hidden');
  var hiddenSource = document.getElementById('category-source-hidden');
  var fallbackSelect = document.getElementById('category-fallback');
  var fallbackGroup = document.getElementById('category-fallback-group');
  var sendingAsLabel = document.getElementById('sending-as-label');
  var sendingAsChange = document.getElementById('sending-as-change');
  var turnstileWidgetId = null;
  var pendingSubmit = null;

  var CATEGORY_LABELS = {
    'course': 'Course question',
    'stuc-billing': 'Member or recurring donor',
    'clinician-or-researcher': 'Clinician or researcher',
    'speaking': 'Speaking or media',
    'partnership': 'Partnership or affiliate',
    'donor-or-grants': 'Donor or grants',
    'bug': 'Bug or accessibility',
    'other': 'Something else',
  };

  function reduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function setCategory(category, source) {
    if (!CATEGORY_LABELS.hasOwnProperty(category)) return;
    hiddenCategory.value = category;
    hiddenSource.value = source || 'default';
    sendingAsLabel.innerHTML = 'Sending as: <strong>' + CATEGORY_LABELS[category] + '</strong>';
    sendingAsChange.hidden = false;
    if (fallbackGroup) fallbackGroup.classList.add('js-hidden');
    if (fallbackSelect) fallbackSelect.value = category;
    submitBtn.disabled = false;
  }

  function clearCategory() {
    hiddenCategory.value = '';
    hiddenSource.value = '';
    sendingAsLabel.innerHTML = 'Sending as: <strong>Choose a topic above</strong>';
    sendingAsChange.hidden = true;
    if (fallbackGroup) fallbackGroup.classList.remove('js-hidden');
    if (fallbackSelect) fallbackSelect.value = '';
    submitBtn.disabled = true;
  }

  function scrollToForm() {
    var behavior = reduceMotion() ? 'auto' : 'smooth';
    form.scrollIntoView({ behavior: behavior, block: 'start' });
    var target = messageField.value ? (firstNameField.value ? emailField : firstNameField) : messageField;
    setTimeout(function () { target.focus({ preventScroll: true }); }, behavior === 'auto' ? 0 : 300);
  }

  // Card / text-link clicks
  document.querySelectorAll('[data-category][data-source]').forEach(function (el) {
    el.addEventListener('click', function (ev) {
      var cat = el.getAttribute('data-category');
      var src = el.getAttribute('data-source');
      if (!CATEGORY_LABELS.hasOwnProperty(cat)) return;
      ev.preventDefault();
      setCategory(cat, src);
      scrollToForm();
    });
  });

  // Fallback select
  if (fallbackSelect) {
    fallbackSelect.addEventListener('change', function () {
      if (fallbackSelect.value && CATEGORY_LABELS.hasOwnProperty(fallbackSelect.value)) {
        setCategory(fallbackSelect.value, 'select');
      } else {
        clearCategory();
      }
    });
  }

  // [change] link
  if (sendingAsChange) {
    sendingAsChange.addEventListener('click', function (ev) {
      ev.preventDefault();
      clearCategory();
      // Close any open <details>
      document.querySelectorAll('details[name="contact-cards"]').forEach(function (d) { d.open = false; });
      var cards = document.querySelector('.contact-cards');
      if (cards) {
        var behavior = reduceMotion() ? 'auto' : 'smooth';
        cards.scrollIntoView({ behavior: behavior, block: 'start' });
      }
    });
  }

  // URL-hash category preset (e.g., #contact-form?category=course)
  function applyHashCategory() {
    var hash = window.location.hash;
    var m = hash.match(/category=([a-z0-9-]+)/);
    if (m && CATEGORY_LABELS.hasOwnProperty(m[1])) {
      setCategory(m[1], 'hash');
    }
  }
  applyHashCategory();
  window.addEventListener('hashchange', applyHashCategory);

  // Auth prefill (client-side fetch)
  fetch('/api/auth/session', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.user) return;
      var u = data.user;
      if (u.firstName && !firstNameField.value) firstNameField.value = u.firstName;
      if (u.lastName && !lastNameField.value) lastNameField.value = u.lastName;
      if (u.email && !emailField.value) emailField.value = u.email;
    })
    .catch(function () { /* leave empty on any failure */ });

  // Char counter
  if (messageField && charCount) {
    messageField.addEventListener('input', function () {
      var len = messageField.value.length;
      charCount.textContent = len > 0 ? len + ' / 5,000' : '';
    });
  }

  // Turnstile setup (preserve existing)
  function initTurnstile() {
    var container = document.getElementById('turnstile-container');
    if (!container || typeof turnstile === 'undefined') return;
    turnstileWidgetId = turnstile.render(container, {
      sitekey: container.dataset.sitekey,
      size: 'invisible',
      callback: function (token) {
        if (pendingSubmit) {
          doSubmit(pendingSubmit, token);
          pendingSubmit = null;
        }
      },
      'error-callback': function () {
        showError('Spam check failed. Please refresh the page and try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send';
        pendingSubmit = null;
      },
    });
  }
  var tsCheck = setInterval(function () {
    if (typeof turnstile !== 'undefined') { clearInterval(tsCheck); initTurnstile(); }
  }, 200);
  setTimeout(function () { clearInterval(tsCheck); }, 10000);

  function showError(msg) {
    errorText.textContent = msg;
    errorEl.hidden = false;
    successEl.hidden = true;
  }
  function showSuccess() {
    successEl.hidden = false;
    errorEl.hidden = true;
    form.hidden = true;
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    errorEl.hidden = true;

    var firstName = firstNameField.value.trim();
    var lastName = lastNameField.value.trim();
    var name = lastName ? firstName + ' ' + lastName : firstName;
    var email = emailField.value.trim();
    var message = messageField.value.trim();
    var website = form.elements['website'] ? form.elements['website'].value : '';
    var category = hiddenCategory.value;
    var categorySource = hiddenSource.value || 'default';

    if (!firstName) return showError('Please enter your first name.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Please enter a valid email address.');
    if (message.length < 10) return showError('Please enter a message (at least 10 characters).');
    if (!category) return showError('Please choose a topic above before sending.');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    var payload = { name: name, email: email, message: message, category: category, category_source: categorySource, website: website };

    if (typeof turnstile !== 'undefined' && turnstileWidgetId !== null) {
      pendingSubmit = payload;
      turnstile.reset(turnstileWidgetId);
      turnstile.execute(turnstileWidgetId);
      return;
    }
    doSubmit(payload, '');
  });

  function doSubmit(payload, token) {
    payload.turnstileToken = token;
    fetch('/api/contact/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          showSuccess();
        } else {
          showError(data.error || 'Something went wrong. Please try again.');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send';
        }
      })
      .catch(function () {
        showError('Network error. Please check your connection and try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send';
      });
  }
})();
```

- [ ] **Step 2: Verify build + dev render**

Run: `npm run build 2>&1 | tail -5`
Expected: success.

Run: `npm run dev` (background); open http://localhost:4321/contact/; verify:
- Submit button disabled on load
- Clicking a card's "Send a message" link sets the indicator + enables submit + scrolls
- Clicking "Other inquiries" text link does the same
- Picking from the fallback select sets the indicator
- "[change]" link clears + reopens the cards
- URL `http://localhost:4321/contact/#contact-form?category=bug` preselects "Bug or accessibility"

Kill dev.

- [ ] **Step 3: Run guard manifest check**

Run: `npm run guard 2>&1 | tail -5`
Note: `contact.astro` is NOT currently in the guard manifest (only `functions/` files are). Confirm by reading `scripts/guard-manifest.json`. If it isn't there, no update needed.

- [ ] **Step 4: Commit (covers Tasks 8.1 + 8.2 + 8.3)**

```bash
git add src/pages/contact.astro
git commit -m "feat(contact): persona-driven form UX

Replace generic single-textarea form with:
- 3 disclosure cards (single-open accordion via <details name>)
- 5 secondary text links for less-common personas
- Visible 'Sending as:' indicator above message field
- JS-disabled fallback <select> for category
- URL-hash category preset (#contact-form?category=...)
- Client-side auth prefill via /api/auth/session
- Submit disabled until a category is set
- prefers-reduced-motion respected for scroll-into-view

Hero, sidebar, nonprofit footer preserved unchanged."
```

### Task 8.4: Playwright smoke test

**Files:**
- Create: `tests/e2e/contact-form.spec.ts` (or wherever Playwright tests live)

- [ ] **Step 1: Locate Playwright config**

Run: `find . -name 'playwright.config*' -not -path './node_modules/*' 2>/dev/null && ls tests/ 2>/dev/null`
Note the test directory and config.

- [ ] **Step 2: Write smoke test**

Path: (use the existing Playwright tests directory; if `tests/e2e/`, put it there)

```typescript
import { test, expect } from '@playwright/test';

test.describe('/contact/ persona-driven form', () => {
  test('submit disabled until category chosen', async ({ page }) => {
    await page.goto('/contact/');
    const submit = page.locator('#contact-submit');
    await expect(submit).toBeDisabled();
  });

  test('clicking a card "Send a message" enables submit and sets indicator', async ({ page }) => {
    await page.goto('/contact/');
    await page.locator('summary', { hasText: 'I have a question about a course' }).click();
    await page.locator('a.contact-card__send', { hasText: 'Still need help' }).first().click();
    await expect(page.locator('#sending-as-label')).toContainText('Course question');
    await expect(page.locator('#contact-submit')).toBeEnabled();
  });

  test('text link sets category to clinician-or-researcher', async ({ page }) => {
    await page.goto('/contact/');
    await page.locator('a', { hasText: 'clinician or researcher' }).click();
    await expect(page.locator('#category-hidden')).toHaveValue('clinician-or-researcher');
    await expect(page.locator('#sending-as-label')).toContainText('Clinician or researcher');
  });

  test('URL hash preselects category', async ({ page }) => {
    await page.goto('/contact/#contact-form?category=bug');
    await expect(page.locator('#category-hidden')).toHaveValue('bug');
    await expect(page.locator('#category-source-hidden')).toHaveValue('hash');
  });

  test('fallback select sets category with source=select', async ({ page }) => {
    await page.goto('/contact/');
    await page.locator('#category-fallback').selectOption('partnership');
    await expect(page.locator('#category-hidden')).toHaveValue('partnership');
    await expect(page.locator('#category-source-hidden')).toHaveValue('select');
  });

  test('[change] link clears category and re-disables submit', async ({ page }) => {
    await page.goto('/contact/');
    await page.locator('a', { hasText: 'speaking or media' }).click();
    await expect(page.locator('#contact-submit')).toBeEnabled();
    await page.locator('#sending-as-change').click();
    await expect(page.locator('#contact-submit')).toBeDisabled();
    await expect(page.locator('#sending-as-label')).toContainText('Choose a topic above');
  });
});
```

- [ ] **Step 3: Run Playwright tests**

Run: `npm run test:e2e -- contact-form 2>&1 | tail -20`
Expected: all 6 tests pass against the dev server.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/contact-form.spec.ts
git commit -m "test(e2e): contact form persona routing smoke tests

Covers card click, text link, URL hash preset, fallback select,
[change] reset, and submit-disabled-until-category."
```

---

## Phase 9: bridge-links CI script

### Task 9.1: Write check-bridge-links script + test

**Files:**
- Create: `scripts/check-bridge-links.mjs`
- Create: `test/check-bridge-links.test.js`

- [ ] **Step 1: Write the failing test**

Path: `test/check-bridge-links.test.js`

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function runScript(registry, srcFiles) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-links-'));
  const registryPath = join(dir, 'bridge-pages.json');
  const srcDir = join(dir, 'src');
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  for (const [name, content] of Object.entries(srcFiles)) {
    writeFileSync(join(srcDir, name), content);
  }
  const result = spawnSync('node', [
    'scripts/check-bridge-links.mjs',
    '--registry', registryPath,
    '--src-dir', srcDir,
  ], { encoding: 'utf-8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('check-bridge-links', () => {
  it('passes when registered bridge has at least one inbound link', () => {
    const reg = { pages: [{ url: '/schedule-with-dr-whittaker/', min_inbound_links: 1 }] };
    const src = { 'about.astro': '<a href="/schedule-with-dr-whittaker/">link</a>' };
    const r = runScript(reg, src);
    assert.equal(r.code, 0, r.stderr);
  });

  it('warns when registered bridge has zero inbound links', () => {
    const reg = { pages: [{ url: '/schedule-with-dr-whittaker/', min_inbound_links: 1 }] };
    const src = { 'index.astro': '<h1>Home</h1>' };
    const r = runScript(reg, src);
    // Non-blocking warning: exit code 0 but stderr has the warning
    assert.equal(r.code, 0);
    assert.match(r.stderr + r.stdout, /schedule-with-dr-whittaker/);
    assert.match(r.stderr + r.stdout, /WARNING|warn/i);
  });
});
```

- [ ] **Step 2: Run (expect fail)**

Run: `node --test test/check-bridge-links.test.js 2>&1 | tail -10`
Expected: tests fail (script doesn't exist).

- [ ] **Step 3: Write the script**

Path: `scripts/check-bridge-links.mjs`

```javascript
#!/usr/bin/env node
/**
 * Reports bridge pages with fewer than min_inbound_links inbound links from src/.
 * Non-blocking: exit 0 even if warnings fire. The warnings show up loudly in CI logs.
 *
 * Usage:
 *   node scripts/check-bridge-links.mjs
 *
 * Options for tests:
 *   --registry <path>  default: docs/personas/bridge-pages.json
 *   --src-dir  <path>  default: src/
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const registryPath = resolve(arg('--registry', 'docs/personas/bridge-pages.json'));
const srcDir = resolve(arg('--src-dir', 'src'));

const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function countInboundLinks(targetUrl) {
  let count = 0;
  const escaped = targetUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`href=["']${escaped}["']`, 'g');
  for (const file of walk(srcDir)) {
    if (!/\.(astro|tsx?|jsx?|html|md|mdx)$/.test(file)) continue;
    const content = readFileSync(file, 'utf-8');
    const matches = content.match(re);
    if (matches) count += matches.length;
  }
  return count;
}

let warned = 0;
for (const page of registry.pages || []) {
  const min = page.min_inbound_links ?? 1;
  const found = countInboundLinks(page.url);
  if (found < min) {
    console.warn(`WARNING: bridge page ${page.url} has ${found} inbound link(s) (minimum: ${min})`);
    warned++;
  } else {
    console.log(`ok: ${page.url} has ${found} inbound link(s)`);
  }
}

if (warned > 0) {
  console.warn(`check-bridge-links: ${warned} bridge page(s) below minimum (warnings only, non-blocking)`);
}
process.exit(0);
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `node --test test/check-bridge-links.test.js 2>&1 | tail -10`
Expected: pass.

- [ ] **Step 5: Run against real registry**

Run: `node scripts/check-bridge-links.mjs`
Expected: `ok: /schedule-with-dr-whittaker/ has N inbound link(s)` (N >= 1 from about.astro).

- [ ] **Step 6: Commit**

```bash
git add scripts/check-bridge-links.mjs test/check-bridge-links.test.js
git commit -m "feat: check-bridge-links CI script (non-blocking)

Warns if any registered bridge page has fewer inbound links
than its min_inbound_links threshold. Catches refactors that
silently drop the inbound-link signal SEO funnels need."
```

### Task 9.2: Wire CI scripts to deploy.yml

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Read existing deploy workflow**

Run: `head -100 .github/workflows/deploy.yml`
Note the structure — there's likely a step list with `run: npm run guard` etc.

- [ ] **Step 2: Add two new steps**

Find the step list (likely after `npm run guard` or `npm run check-types`). Insert two new steps:

```yaml
      - name: Persona/enum sync check
        run: node scripts/check-persona-enum-sync.mjs

      - name: Bridge inbound-link warning (non-blocking)
        run: node scripts/check-bridge-links.mjs
        continue-on-error: true
```

The first is a hard gate; the second is non-blocking via `continue-on-error: true`.

- [ ] **Step 3: Verify YAML syntax**

Run: `npx yaml-lint .github/workflows/deploy.yml 2>&1 | tail -3` (or use the project's preferred linter; if none, `npx js-yaml .github/workflows/deploy.yml`)
Expected: valid YAML.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: wire persona/bridge-link gates

- check-persona-enum-sync (hard gate)
- check-bridge-links (non-blocking warning)

Both run after the existing guard + type-check steps."
```

---

## Phase 10: Final verification + deploy

### Task 10.1: Run all local gates

**Files:** none

- [ ] **Step 1: Full test suite**

Run: `npm test 2>&1 | tail -15`
Expected: all tests pass.

- [ ] **Step 2: Type check**

Run: `npm run check-types 2>&1 | tail -10`
Expected: pass against baseline.

- [ ] **Step 3: Guard**

Run: `npm run guard 2>&1 | tail -5`
Expected: pass.

- [ ] **Step 4: Persona sync**

Run: `node scripts/check-persona-enum-sync.mjs`
Expected: pass.

- [ ] **Step 5: Bridge links**

Run: `node scripts/check-bridge-links.mjs`
Expected: at least 1 inbound link to /schedule-with-dr-whittaker/.

- [ ] **Step 6: Build**

Run: `npm run build 2>&1 | tail -10`
Expected: success.

- [ ] **Step 7: Playwright e2e**

Run: `npm run test:e2e 2>&1 | tail -15`
Expected: all pass (existing + new).

### Task 10.2: Manual smoke + push

- [ ] **Step 1: Manual smoke against dev server**

Run: `npm run dev` (background); browse to:
- http://localhost:4321/contact/ — verify all 4 trigger paths work, indicator updates, submit toggles
- http://localhost:4321/schedule-with-dr-whittaker/ — verify hero + intent + outbound CTA
- http://localhost:4321/Schedule-With-Dr-Whittaker/ — verify 301 to lowercase
- http://localhost:4321/about/ — verify inbound link to bridge page

Kill dev.

- [ ] **Step 2: Push branch**

```bash
git push -u origin claude/personas-contact-form
```

The repo's claude/* auto-merge convention will fast-forward main once CI passes (per `feedback-rrm-academy-cf-auto-merge.md` memory).

- [ ] **Step 3: Watch CI**

Run: `gh run watch` (or `gh pr view --web` if a PR was opened by the auto-merge bot)
Expected: all gates green.

- [ ] **Step 4: Live verification post-deploy**

After CI/deploy lands (typically a few minutes after merge to main):

```bash
sleep 120
curl -sI https://rrmacademy.org/schedule-with-dr-whittaker/ | head -3
curl -sIL https://rrmacademy.org/Schedule-With-Dr-Whittaker/ | head -5
curl -s https://rrmacademy.org/contact/ | grep -E 'sending-as|contact-card|category-fallback' | head -5
```

Expected:
- Bridge page returns 200
- Mixed-case bridge URL 301s to lowercase
- Contact page contains the new card markup

### Task 10.3: Post-deploy operational checklist

- [ ] **Step 1: Audit Brian's Gmail filters under the new subject format**

Run: `gmail filters -a administrator | grep -B1 -A2 '\[Contact\]'`
Confirm existing `[Contact]` filters still match the new `[Contact][CATEGORY] ...` format.

- [ ] **Step 2: Spot-check rrm-observatory queries against `worker_events`**

Run: `grep -rn "blob5\|blob6\|blob7" ~/iCode/projects/rrm-observatory/src/ 2>/dev/null | head -10`
Confirm queries that use blob5+ positions still produce sensible output. The new positions 6/7 carry category/source.

- [ ] **Step 3: Probe AE blob extension via a real submission**

Submit a test contact form (use a non-test email or pre-coordinate). Then:
Run: `wrangler d1 execute rrm-academy --command "SELECT * FROM worker_events WHERE blob2='contact' ORDER BY timestamp DESC LIMIT 3"` (or via observatory)
Expected: latest row has new `category` and `category_source` blobs at the trailing positions.

---

## Self-review

After writing this plan I checked it against the spec section-by-section.

**Spec coverage:**
- §Personas: Task 1.1 (machine-readable doc) + spec mappings in Task 2.1 (enum SSOT)
- §Contact form UX: Tasks 8.1-8.4 (layout, CSS, JS, e2e tests)
- §Bridge page primitive: Tasks 5.1, 6.1
- §API contract: Tasks 4.1, 4.2 (sanitizer + enum + AE blob + auth state)
- §Email routing (Gmail filter audit): Task 0.6 + Task 10.3
- §Security and infrastructure: Tasks 4.2 step 5-7 (guard:update), 7.1 (middleware guard)
- §Pre-implementation verification: Phase 0
- §Deploy ordering: handled by Task 4.2 making category optional with default `other`
- §Files touched (all 7 new + 7 modified): each appears in at least one task
- §Out of scope: not implemented (correct)
- §Success criteria 1-17: each maps to at least one task (criteria 13-14 = Tasks 2.2 + 9.1; criterion 16 = persona doc Task 1.1; criterion 17 = subject sanitizer Task 4.1)

**Placeholder scan:** one explicit TODO in Task 6.1 step 2 (UPMC profile URL — flagged in commit message). Acceptable because the URL is not encoded in canonical config and Brian needs to confirm before merge. All other steps have concrete content.

**Type consistency:**
- `CONTACT_CATEGORIES` enum values: same in Task 2.1 (TS/JS), Task 4.2 (validateBody), Task 8.3 (CATEGORY_LABELS map). Verified.
- `CATEGORY_SOURCES` enum values: same in Task 2.1, Task 4.2, Task 8.3. Verified.
- `category_source` enum values match between client (Task 8.3 sets `'card'|'text-link'|'select'|'hash'`) and server validation (Task 4.2 includes `'default'` for the no-source-supplied case).
- `buildContactSubject(category, message)` signature: Task 4.1 defines, Task 4.2 imports + uses correctly.
- `setCategory(category, source)` JS function: Task 8.3 defines, all callers in same task pass correct args.
- `BridgePagePrimitive` props: Task 5.1 declares interface, Task 6.1 instantiates with all required props.

**Cross-phase ordering check:**
- Phase 2 enum SSOT must land before Phase 4 imports it. Order: 1 → 2 → 3 → 4. ✓
- Phase 5 primitive must land before Phase 6 uses it. ✓
- Phase 8 form references endpoints from Phase 4. Server changes ship before client (deploy ordering note). The plan commits server first, then client; if pushing in batches, server commit hits prod first via auto-merge. ✓
- Phase 9 CI gates land last; they enforce what was built in earlier phases. ✓

Plan is self-consistent and complete.
