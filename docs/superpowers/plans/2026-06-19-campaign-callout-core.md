# Reusable Campaign Callout Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable, drift-proof campaign-callout core (data store + shared thermometer module + component + build snapshot) and prove it on the live `/providers/` page, so the foregrounding placements (separate plan) drop in with no new logic.

**Architecture:** A new `src/data/campaigns.json` store drives a new `src/components/CampaignCallout.astro` (two variants: `band` reads a committed build snapshot, `card` live-fetches). Both the component's `card` variant and the existing `/providers/` page share ONE fail-soft fetch implementation in a new `src/scripts/fund-thermo.ts`, replacing the inline IIFE so the logic cannot be hand-copied and drift. A committed `src/data/campaign-snapshot.json` (refreshed by a local/cron script, never per-visitor and never in CI) feeds the homepage band's number without hitting the rate-limited Stripe endpoint on the apex.

**Tech Stack:** Astro 5 (static) + TypeScript (astro/tsconfigs/strict) + CF Pages Functions + `node --test` (unit, `.mjs`) + Playwright (`@playwright/test`, browser/e2e).

**Spec:** `docs/superpowers/specs/2026-06-19-provider-directory-fundraiser-promotion-design.md` (§3.1 is the contract for this plan; §3.2/§3.3/§3.4/§3.6 are the *consumers*, built in the follow-on plans).

## Global Constraints

- No em dashes anywhere (copy or comments).
- Donation recipient is always the RRM Foundation 501(c)(3) (EIN 93-4594315); never "donate to RRM Academy".
- Honesty (spec §6): any campaign copy binds to funding the WORK ("funds the work toward a verified directory"); never "is coming" / "will launch" / "launches once X"; never imply members get the directory or restricted funds.
- CSS uses EXISTING design tokens only (no new CSS vars, so no `global.css` edit and no `design-tokens` regen). Read `docs/design/design-system.json` before any CSS. Tokens: `--accent` (fill/CTA/number), `--accent-hover`, `--white`, `--bg-surface`, `--border-color`, `--border-light`, `--text-primary|secondary|tertiary`, `--space-1..24`, `--radius-md` (card), `--radius-pill` (track/fill/button), `--font-display` (Cormorant, the dollar number), `--font-body` (Inter).
- `src/data/funding-projects.json` stays UNTOUCHED (5 rows, no goal/campaign fields). The new store is `src/data/campaigns.json`.
- `/api/fund-progress` is single-campaign and rate-limited (30 req / 60s per IP); the homepage `band` MUST NOT live-fetch it. The `card` variant (low-traffic `/providers/`, `/donate/`) MAY live-fetch.
- Fail-soft contract: on any response that is not `{ raised_cents: number }` (incl. 503/429/garbage/network error), render $0 / 0% and never throw.
- This plan is TECHNICAL (no live patient-facing copy is published): the component is exercised on a `noindex` dev preview and the existing `/providers/` page. Placing the band/card on the homepage and `/donate/` is the follow-on content plan, gated on explicit go-live.
- Commit after every task (frequent commits). Run on a `claude/*` branch off `origin/main`; the unrelated working-tree changes are not yours to commit.

## File Structure

| File | Responsibility | Status |
|------|----------------|--------|
| `src/data/campaigns.json` | Campaign records (id, copy, goal_cents, campaign_key, cta_href). Drives CampaignCallout. | Create |
| `src/scripts/fund-thermo.ts` | Shared, never-throws thermometer logic: pure `computeThermo`, `fmtDollars`, DOM `applyThermo`, live `initFundThermo`. | Create |
| `src/components/CampaignCallout.astro` | The reusable callout. `band` (snapshot) + `card` (live) variants, missing-goal + over-goal handling. | Create |
| `src/data/campaign-snapshot.json` | Committed, deterministic raised-total snapshot for the band. | Create |
| `scripts/update-campaign-snapshot.mjs` | Local/cron refresher: GETs the live `/api/fund-progress` and rewrites the snapshot. NOT in the CI build chain. | Create |
| `src/pages/dev/campaign-callout-preview.astro` | `noindex` preview rendering both variants, for e2e. | Create |
| `src/pages/providers/index.astro` | Refactor: replace the inline thermometer IIFE with `fund-thermo.ts`; add `data-goal-cents`. Give-widget JS stays inline. | Modify (`176-208`, `48`) |
| `tests/unit/campaigns-schema.test.mjs` | Validates campaigns.json shape. | Create |
| `tests/unit/campaign-snapshot.test.mjs` | Validates the snapshot shape + the update script's pure transform. | Create |
| `tests/e2e/fund-thermo.spec.ts` | Mocks `/api/fund-progress`; asserts happy/over-goal/zero-goal/fail-soft on `/providers/` and the preview. | Create |

---

### Task 1: Campaign data store (`campaigns.json`)

**Files:**
- Create: `src/data/campaigns.json`
- Test: `tests/unit/campaigns-schema.test.mjs`

**Interfaces:**
- Produces: a JSON array of records `{ id: string, eyebrow: string, headline: string, one_liner: string, cta_label: string, cta_href: string, goal_cents: number, campaign_key: string, status: 'active'|'seeking'|'launching' }`. Consumed by `CampaignCallout.astro` (Task 3) and the homepage/donate placements (follow-on plan).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/campaigns-schema.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const campaigns = JSON.parse(
  readFileSync(join(__dirname, '../../src/data/campaigns.json'), 'utf8')
);

test('campaigns.json is a non-empty array', () => {
  assert.ok(Array.isArray(campaigns));
  assert.ok(campaigns.length > 0);
});

test('every campaign has required fields with valid types', () => {
  for (const c of campaigns) {
    assert.equal(typeof c.id, 'string');
    assert.match(c.campaign_key, /^[a-z0-9-]+$/);
    assert.ok(c.campaign_key.length <= 64);
    assert.equal(typeof c.goal_cents, 'number');
    assert.ok(c.goal_cents > 0, `goal_cents must be positive for ${c.id}`);
    assert.equal(typeof c.cta_href, 'string');
    assert.ok(c.cta_href.length > 0);
    assert.equal(typeof c.headline, 'string');
    assert.ok(c.headline.length > 0);
  }
});

test('provider-directory campaign exists with canonical goal + cta', () => {
  const pd = campaigns.find((c) => c.id === 'provider-directory');
  assert.ok(pd, 'provider-directory campaign must exist');
  assert.equal(pd.goal_cents, 1000000);
  assert.equal(pd.cta_href, '/providers/#give');
  assert.equal(pd.campaign_key, 'provider-directory');
});

test('no campaign copy uses launch-commitment language (spec §6)', () => {
  const banned = /\b(is coming|will launch|launches once|coming soon)\b/i;
  for (const c of campaigns) {
    for (const field of ['eyebrow', 'headline', 'one_liner', 'cta_label']) {
      assert.ok(!banned.test(c[field] || ''), `${c.id}.${field} uses banned launch language`);
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/campaigns-schema.test.mjs`
Expected: FAIL with `ENOENT ... src/data/campaigns.json` (file does not exist yet).

- [ ] **Step 3: Create the data file**

Create `src/data/campaigns.json`:

```json
[
  {
    "id": "provider-directory",
    "eyebrow": "RRM Provider Directory",
    "headline": "Help build the verified provider directory",
    "one_liner": "Your one-time gift to the RRM Foundation funds the work toward a verified directory of RRM-trained clinicians, so the next woman finds real care on the first try.",
    "cta_label": "Give for the next generation",
    "cta_href": "/providers/#give",
    "goal_cents": 1000000,
    "campaign_key": "provider-directory",
    "status": "active"
  }
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/campaigns-schema.test.mjs`
Expected: PASS (4 tests, 0 fail).

- [ ] **Step 5: Commit**

```bash
git add src/data/campaigns.json tests/unit/campaigns-schema.test.mjs
git commit -m "feat(campaigns): add campaigns.json store + schema test for the reusable callout"
```

---

### Task 2: Shared thermometer module (`fund-thermo.ts`)

**Files:**
- Create: `src/scripts/fund-thermo.ts`

**Interfaces:**
- Produces:
  - `computeThermo(data: unknown, fallbackGoalCents: number): ThermoView | null` — pure, never throws; returns `null` when the payload is unusable (caller fails soft) or the goal is non-positive (caller renders goal-only).
  - `fmtDollars(cents: number): string`
  - `applyThermo(els: ThermoEls, view: ThermoView): void` — writes the DOM, sets `data-state="met"|"active"`.
  - `initFundThermo(root: HTMLElement, fallbackGoalCents: number): void` — live `/api/fund-progress` fetch + apply, fail-soft.
  - `ThermoView = { raisedText: string; pct: number; raisedCents: number; met: boolean; supportersText: string | null }`
- Consumed by: `src/pages/providers/index.astro` (Task 4) and `CampaignCallout.astro` `card` variant (Task 3).

- [ ] **Step 1: Write the module**

Create `src/scripts/fund-thermo.ts` (mirrors `src/scripts/track.ts` conventions: JSDoc header, typed exports, environment guards, never throws):

```ts
/**
 * Shared fundraiser thermometer logic.
 *
 * Spec: docs/superpowers/specs/2026-06-19-provider-directory-fundraiser-promotion-design.md (§3.1)
 *
 * Extracted from the inline IIFE that lived in src/pages/providers/index.astro so the
 * /providers/ page and src/components/CampaignCallout.astro share ONE fail-soft
 * implementation. Contract: on any response that is not { raised_cents: number },
 * leave the server-rendered $0 / 0% in place and never throw.
 */

export interface FundProgress {
  raised_cents: number;
  goal_cents?: number;
  count?: number;
  supporters?: number;
}

export interface ThermoView {
  raisedText: string;
  pct: number;
  raisedCents: number;
  met: boolean;
  supportersText: string | null;
}

export function fmtDollars(cents: number): string {
  return '$' + Math.round(cents / 100).toLocaleString();
}

/** Pure, DOM-free, never throws. Returns null when the payload is unusable or the goal is non-positive. */
export function computeThermo(data: unknown, fallbackGoalCents: number): ThermoView | null {
  const d = data as FundProgress | null;
  if (!d || typeof d.raised_cents !== 'number') return null;
  const goal = typeof d.goal_cents === 'number' && d.goal_cents > 0 ? d.goal_cents : fallbackGoalCents;
  if (!(goal > 0)) return null;
  const raisedCents = Math.max(0, d.raised_cents);
  const pct = Math.min(100, Math.round((raisedCents / goal) * 100));
  const met = raisedCents >= goal;
  const supporters = typeof d.supporters === 'number' ? d.supporters : null;
  const supportersText = supporters && supporters > 0
    ? (supporters === 1 ? '1 supporter so far' : `${supporters.toLocaleString()} supporters so far`)
    : null;
  return { raisedText: fmtDollars(raisedCents), pct, raisedCents, met, supportersText };
}

export interface ThermoEls {
  root: HTMLElement;
  fill: HTMLElement;
  raised: HTMLElement;
  supporters: HTMLElement;
}

/** Apply a computed view to the thermometer DOM. Sets data-state="met" when raised >= goal (spec §3.1 over-goal). */
export function applyThermo(els: ThermoEls, view: ThermoView): void {
  els.raised.textContent = view.raisedText;
  els.fill.style.width = view.pct + '%';
  els.root.setAttribute('aria-valuenow', String(view.raisedCents));
  els.root.setAttribute('data-state', view.met ? 'met' : 'active');
  if (view.supportersText) {
    els.supporters.textContent = view.supportersText;
    els.supporters.hidden = false;
  }
}

/** Live variant: fetch /api/fund-progress and apply. Never throws; leaves $0/0% on any error. */
export function initFundThermo(root: HTMLElement, fallbackGoalCents: number): void {
  if (typeof fetch === 'undefined') return;
  const fill = root.querySelector<HTMLElement>('.fund-thermo__fill');
  const raised = root.querySelector<HTMLElement>('.fund-thermo__raised');
  const supporters = root.querySelector<HTMLElement>('.fund-thermo__meta');
  if (!fill || !raised || !supporters) return;
  fetch('/api/fund-progress', { credentials: 'omit' })
    .then((r) => r.json())
    .then((data) => {
      const view = computeThermo(data, fallbackGoalCents);
      if (view) applyThermo({ root, fill, raised, supporters }, view);
    })
    .catch(() => { /* fail-soft: leave $0 / 0% rendered */ });
}
```

- [ ] **Step 2: Type-check the module**

Run: `npm run check-types`
Expected: PASS (no type errors introduced). The module is not imported anywhere yet, so this only proves it compiles under astro/tsconfigs/strict.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/fund-thermo.ts
git commit -m "feat(fund-thermo): shared never-throws thermometer module (computeThermo/applyThermo/initFundThermo)"
```

---

### Task 3: Refactor `/providers/` to use `fund-thermo.ts` (proves the module + adds over-goal/zero-goal handling)

**Files:**
- Modify: `src/pages/providers/index.astro` (markup `48`, inline thermometer block `176-208`)
- Test: `tests/e2e/fund-thermo.spec.ts`

**Interfaces:**
- Consumes: `initFundThermo` from `src/scripts/fund-thermo.ts`.
- Produces: the `/providers/` thermometer now sets `data-state="met"` at/over goal and tolerates a zero/missing goal without `NaN%`. The `#fund-thermo` element carries `data-goal-cents`.

- [ ] **Step 1: Write the failing Playwright spec**

Create `tests/e2e/fund-thermo.spec.ts` (mirrors `tests/e2e/track-smoke.spec.ts` route-mocking):

```ts
import { test, expect, type Page } from '@playwright/test';

async function mockProgress(page: Page, body: unknown, status = 200) {
  await page.route('**/api/fund-progress', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  );
}

test.describe('fund-thermo on /providers/', () => {
  test('happy path fills the bar and shows raised + supporters', async ({ page }) => {
    await mockProgress(page, { raised_cents: 250000, goal_cents: 1000000, count: 12, supporters: 12 });
    await page.goto('/providers/');
    const thermo = page.locator('#fund-thermo');
    await expect(page.locator('#fund-raised')).toHaveText('$2,500');
    await expect(page.locator('#fund-fill')).toHaveAttribute('style', /width:\s*25%/);
    await expect(thermo).toHaveAttribute('data-state', 'active');
    await expect(page.locator('#fund-supporters')).toContainText('12 supporters');
  });

  test('over-goal sets data-state="met" and caps the bar at 100%', async ({ page }) => {
    await mockProgress(page, { raised_cents: 1200000, goal_cents: 1000000, count: 80, supporters: 80 });
    await page.goto('/providers/');
    await expect(page.locator('#fund-thermo')).toHaveAttribute('data-state', 'met');
    await expect(page.locator('#fund-fill')).toHaveAttribute('style', /width:\s*100%/);
    await expect(page.locator('#fund-raised')).toHaveText('$12,000');
  });

  test('zero/missing goal does not produce NaN width', async ({ page }) => {
    await mockProgress(page, { raised_cents: 5000, goal_cents: 0, count: 1, supporters: 1 });
    await page.goto('/providers/');
    const width = await page.locator('#fund-fill').evaluate((el) => (el as HTMLElement).style.width);
    expect(width).not.toContain('NaN');
  });

  test('fail-soft: a 503 leaves $0 / 0% and throws nothing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockProgress(page, { error: 'service_unavailable' }, 503);
    await page.goto('/providers/');
    await expect(page.locator('#fund-raised')).toHaveText('$0');
    await expect(page.locator('#fund-fill')).toHaveAttribute('style', /width:\s*0/);
    expect(errors, errors.join('\n')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npx playwright test tests/e2e/fund-thermo.spec.ts`
Expected: FAIL on the `over-goal` test (current inline IIFE never sets `data-state`) and likely the `zero/missing goal` test (current code falls back to the page `GOAL_CENTS`, so this one may pass; the over-goal `data-state` assertion is the guaranteed failure that drives the change).

- [ ] **Step 3: Add `data-goal-cents` to the thermometer markup**

In `src/pages/providers/index.astro`, change the opening `#fund-thermo` element (line 48-55) to carry the goal as a data attribute (an imported module cannot read `define:vars`):

```astro
        <div
          class="fund-thermo"
          id="fund-thermo"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax={GOAL_CENTS}
          aria-valuenow="0"
          data-goal-cents={GOAL_CENTS}
          aria-label="Raised toward our $10,000 goal"
        >
```

- [ ] **Step 4: Replace the inline thermometer fetch with the shared module**

In `src/pages/providers/index.astro`, the give-widget logic stays in the existing `<script is:inline define:vars={{ GOAL_CENTS }}>` block. Remove the thermometer DOM-handle lookups + `fmtDollars` + fetch IIFE (lines 179-208) from that inline block, and ADD a separate module script after it:

```astro
  <script>
    import { initFundThermo } from '../../scripts/fund-thermo';
    const root = document.getElementById('fund-thermo');
    if (root) {
      const goal = Number(root.dataset.goalCents) || 0;
      initFundThermo(root, goal);
    }
  </script>
```

(Leave the give-widget block — amount buttons, custom input, checkout POST, bfcache `pageshow` — exactly as-is; it still needs `define:vars`.)

- [ ] **Step 5: Run the spec to verify it passes**

Run: `npx playwright test tests/e2e/fund-thermo.spec.ts`
Expected: PASS (4 tests). If the dev server is not auto-started by the Playwright config, run against a local preview: `npm run build && npx wrangler pages dev dist` in another shell, or use the project's configured `webServer`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/providers/index.astro tests/e2e/fund-thermo.spec.ts
git commit -m "refactor(providers): use shared fund-thermo module; add data-state=met over-goal + zero-goal guard"
```

---

### Task 4: `CampaignCallout.astro` + `noindex` preview

**Files:**
- Create: `src/components/CampaignCallout.astro`
- Create: `src/pages/dev/campaign-callout-preview.astro`
- Test: extend `tests/e2e/fund-thermo.spec.ts` with a `CampaignCallout` describe block

**Interfaces:**
- Consumes: a `campaign` record (Task 1 shape), `variant: 'band' | 'card'`, optional `snapshot: { raised_cents: number; supporters: number } | null` (band only). Imports `initFundThermo` (card variant).
- Produces: `<CampaignCallout campaign={record} variant="band|card" snapshot={...} />`.

- [ ] **Step 1: Write the component**

Create `src/components/CampaignCallout.astro` (model markup/CSS on `src/components/LibraryFundingCallout.astro`; thermometer markup/tokens on `providers/index.astro`):

```astro
---
interface Campaign {
  id: string;
  eyebrow: string;
  headline: string;
  one_liner: string;
  cta_label: string;
  cta_href: string;
  goal_cents: number;
  campaign_key: string;
  status: string;
}
interface Props {
  campaign: Campaign;
  variant: 'band' | 'card';
  snapshot?: { raised_cents: number; supporters: number } | null;
}
const { campaign, variant, snapshot = null } = Astro.props;

// goal_cents <= 0 => render goal-only (no thermometer), never NaN% (spec §3.1).
const hasGoal = typeof campaign.goal_cents === 'number' && campaign.goal_cents > 0;
// Band uses a build snapshot (NEVER a per-visitor fetch on the apex). Card live-fetches.
const snapRaised = variant === 'band' && snapshot && typeof snapshot.raised_cents === 'number'
  ? Math.max(0, snapshot.raised_cents) : 0;
const pct = hasGoal ? Math.min(100, Math.round((snapRaised / campaign.goal_cents) * 100)) : 0;
const met = hasGoal && snapRaised >= campaign.goal_cents;
const goalDollars = '$' + Math.round(campaign.goal_cents / 100).toLocaleString();
const raisedDollars = '$' + Math.round(snapRaised / 100).toLocaleString();
---
<aside class={`campaign-callout campaign-callout--${variant}`} data-pagefind-ignore>
  <div class="cc-inner">
    <p class="cc-eyebrow">{campaign.eyebrow}</p>
    <h2 class="cc-headline">{campaign.headline}</h2>
    <p class="cc-oneliner">{campaign.one_liner}</p>
    {hasGoal && (
      <div
        class="fund-thermo cc-thermo"
        id={`cc-thermo-${campaign.id}`}
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax={campaign.goal_cents}
        aria-valuenow={snapRaised}
        data-goal-cents={campaign.goal_cents}
        data-state={met ? 'met' : 'active'}
        data-live={variant === 'card' ? 'true' : 'false'}
        aria-label={`Raised toward our ${goalDollars} goal`}
      >
        <div class="fund-thermo__head">
          <span class="fund-thermo__raised">{raisedDollars}</span>
          <span class="fund-thermo__goal">raised of {goalDollars} goal</span>
        </div>
        <div class="fund-thermo__track">
          <div class="fund-thermo__fill" style={`width:${pct}%`}></div>
        </div>
        <p class="fund-thermo__meta" hidden></p>
      </div>
    )}
    <a href={campaign.cta_href} class="cc-btn btn btn--primary">{campaign.cta_label}</a>
  </div>
</aside>

<script>
  import { initFundThermo } from '../scripts/fund-thermo';
  for (const root of document.querySelectorAll<HTMLElement>('.cc-thermo[data-live="true"]')) {
    const goal = Number(root.dataset.goalCents) || 0;
    initFundThermo(root, goal);
  }
</script>

<style>
  .campaign-callout { display: block; }
  .cc-inner {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-5) var(--space-6);
  }
  .cc-eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--accent);
    margin: 0 0 var(--space-2);
  }
  .cc-headline { margin: 0 0 var(--space-3); }
  .cc-oneliner { color: var(--text-secondary); margin: 0 0 var(--space-5); }
  .cc-thermo { margin-bottom: var(--space-5); }
  .fund-thermo__head { display: flex; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-3); }
  .fund-thermo__raised {
    font-family: var(--font-display, 'Cormorant Garamond', 'Georgia', serif);
    font-size: 2rem; font-weight: 600; line-height: 1; color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .fund-thermo__goal { font-size: 0.9375rem; color: var(--text-tertiary); }
  .fund-thermo__track { height: 14px; background: var(--border-light); border-radius: var(--radius-pill); overflow: hidden; }
  .fund-thermo__fill { height: 100%; width: 0; background: var(--accent); border-radius: var(--radius-pill); transition: width 0.6s ease-out; }
  .cc-btn { display: inline-block; }
  .campaign-callout--band .cc-inner { display: flex; flex-direction: column; }
  @media (prefers-reduced-motion: reduce) { .fund-thermo__fill { transition: none; } }
  @media (max-width: 600px) { .cc-inner { padding: var(--space-4) var(--space-5); } }
</style>
```

- [ ] **Step 2: Write the preview route**

Create `src/pages/dev/campaign-callout-preview.astro`:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import CampaignCallout from '../../components/CampaignCallout.astro';
import campaigns from '../../data/campaigns.json';
const pd = campaigns.find((c) => c.id === 'provider-directory');
const overGoal = { id: 'preview-met', eyebrow: 'Preview', headline: 'Goal met preview', one_liner: 'over goal', cta_label: 'Give', cta_href: '/providers/#give', goal_cents: 1000000, campaign_key: 'provider-directory', status: 'active' };
const zeroGoal = { ...overGoal, id: 'preview-zerogoal', goal_cents: 0 };
---
<BaseLayout title="Campaign Callout Preview" description="dev preview" noindex={true}>
  <div class="container container--narrow">
    <h1>Band (snapshot)</h1>
    <CampaignCallout campaign={pd} variant="band" snapshot={{ raised_cents: 250000, supporters: 12 }} />
    <h1>Band (goal met snapshot)</h1>
    <CampaignCallout campaign={overGoal} variant="band" snapshot={{ raised_cents: 1200000, supporters: 80 }} />
    <h1>Band (zero goal: goal-only, no thermo)</h1>
    <CampaignCallout campaign={zeroGoal} variant="band" snapshot={{ raised_cents: 5000, supporters: 1 }} />
    <h1>Card (live)</h1>
    <CampaignCallout campaign={pd} variant="card" />
  </div>
</BaseLayout>
```

- [ ] **Step 3: Write the failing e2e for the preview**

Append to `tests/e2e/fund-thermo.spec.ts`:

```ts
test.describe('CampaignCallout preview', () => {
  test('band renders snapshot total with no live fetch', async ({ page }) => {
    let fetched = false;
    await page.route('**/api/fund-progress', (route) => { fetched = true; route.fulfill({ status: 200, body: '{}' }); });
    await page.goto('/dev/campaign-callout-preview/');
    await expect(page.locator('#cc-thermo-provider-directory .fund-thermo__raised').first()).toHaveText('$2,500');
    expect(fetched, 'band must NOT call /api/fund-progress').toBe(false);
  });

  test('goal-met band carries data-state="met"', async ({ page }) => {
    await page.goto('/dev/campaign-callout-preview/');
    await expect(page.locator('#cc-thermo-preview-met')).toHaveAttribute('data-state', 'met');
  });

  test('zero-goal band renders no thermometer (goal-only)', async ({ page }) => {
    await page.goto('/dev/campaign-callout-preview/');
    await expect(page.locator('#cc-thermo-preview-zerogoal')).toHaveCount(0);
  });
});
```

Note: the band test asserts `fetched === false`. Because the preview also renders a `card` (which DOES live-fetch), scope the no-fetch assertion to the band by gating the route fulfillment — refine if the card's fetch flips the flag: split the preview into two routes (`?variant=band`) or assert on a band-only page. Simplest: give the preview a `?only=band` query that conditionally renders only the band, and navigate there for the no-fetch test.

- [ ] **Step 4: Run e2e to verify it passes**

Run: `npx playwright test tests/e2e/fund-thermo.spec.ts`
Expected: PASS. Fix any selector/scope issue from the note above before moving on.

- [ ] **Step 5: Commit**

```bash
git add src/components/CampaignCallout.astro src/pages/dev/campaign-callout-preview.astro tests/e2e/fund-thermo.spec.ts
git commit -m "feat(campaign-callout): band+card variants, missing-goal + over-goal handling, noindex preview"
```

---

### Task 5: Build snapshot + refresher (`campaign-snapshot.json`, `update-campaign-snapshot.mjs`)

**Files:**
- Create: `src/data/campaign-snapshot.json`
- Create: `scripts/update-campaign-snapshot.mjs`
- Test: `tests/unit/campaign-snapshot.test.mjs`

**Interfaces:**
- Produces: `src/data/campaign-snapshot.json` shape `{ "<campaign_key>": { raised_cents: number, supporters: number } }`, imported by the homepage band (follow-on plan).
- `update-campaign-snapshot.mjs` exports `toSnapshot(progress: {raised_cents,supporters}): {raised_cents:number,supporters:number}` (pure, clamps) and, as a CLI, GETs `https://rrmacademy.org/api/fund-progress` and rewrites the file. NOT chained into `npm run build` (CI has no Stripe key; the live endpoint is the source).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/campaign-snapshot.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toSnapshot } from '../../scripts/update-campaign-snapshot.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const snap = JSON.parse(readFileSync(join(__dirname, '../../src/data/campaign-snapshot.json'), 'utf8'));

test('snapshot has a provider-directory entry with non-negative integer fields', () => {
  const pd = snap['provider-directory'];
  assert.ok(pd, 'provider-directory snapshot entry must exist');
  assert.ok(Number.isInteger(pd.raised_cents) && pd.raised_cents >= 0);
  assert.ok(Number.isInteger(pd.supporters) && pd.supporters >= 0);
});

test('toSnapshot clamps negatives and coerces non-numbers to 0', () => {
  assert.deepEqual(toSnapshot({ raised_cents: -5, supporters: 3 }), { raised_cents: 0, supporters: 3 });
  assert.deepEqual(toSnapshot({ raised_cents: 'x', supporters: null }), { raised_cents: 0, supporters: 0 });
  assert.deepEqual(toSnapshot({ raised_cents: 250000, supporters: 12 }), { raised_cents: 250000, supporters: 12 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/campaign-snapshot.test.mjs`
Expected: FAIL (`Cannot find module ... update-campaign-snapshot.mjs` and the snapshot file does not exist).

- [ ] **Step 3: Create the snapshot file**

Create `src/data/campaign-snapshot.json` (committed, deterministic, no timestamp; seed at zero until the first refresh):

```json
{
  "provider-directory": { "raised_cents": 0, "supporters": 0 }
}
```

- [ ] **Step 4: Create the refresher script**

Create `scripts/update-campaign-snapshot.mjs`:

```js
/**
 * Refreshes src/data/campaign-snapshot.json from the LIVE /api/fund-progress.
 * Run locally or on a cron, then commit + deploy. NOT in the CI build chain:
 * CI has no STRIPE_SECRET_KEY, and the homepage band must never per-visitor-fetch
 * the rate-limited endpoint (spec §3.1/§3.2). The live endpoint is the source of truth.
 *
 * Usage: node scripts/update-campaign-snapshot.mjs [campaign_key=provider-directory]
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, '..', 'src', 'data', 'campaign-snapshot.json');
const ORIGIN = process.env.SNAPSHOT_ORIGIN || 'https://rrmacademy.org';

export function toSnapshot(progress) {
  const raised = Number(progress && progress.raised_cents);
  const supporters = Number(progress && progress.supporters);
  return {
    raised_cents: Number.isFinite(raised) ? Math.max(0, Math.round(raised)) : 0,
    supporters: Number.isFinite(supporters) ? Math.max(0, Math.round(supporters)) : 0,
  };
}

async function main() {
  const key = process.argv[2] || 'provider-directory';
  const res = await fetch(`${ORIGIN}/api/fund-progress`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    console.error(`[update-campaign-snapshot] /api/fund-progress returned ${res.status}; snapshot left unchanged.`);
    process.exit(1);
  }
  const progress = await res.json();
  const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  snap[key] = toSnapshot(progress);
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + '\n', 'utf8');
  console.log(`[update-campaign-snapshot] ${key}: ${JSON.stringify(snap[key])}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/unit/campaign-snapshot.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/data/campaign-snapshot.json scripts/update-campaign-snapshot.mjs tests/unit/campaign-snapshot.test.mjs
git commit -m "feat(campaign-snapshot): committed band snapshot + live-endpoint refresher (out of CI build)"
```

---

## Follow-on plans (NOT in this plan)

- **Plan B (content-publication, behind go-live + mockup):** place the `band` on the homepage (after the hero trust strip, `index.astro:256`, reading `campaign-snapshot.json`), place the `card` on `/donate/` above the funding-projects loop (`donate/index.astro:161`), and execute the §3.4 "Find a Provider" reframe sweep (the enumerated surfaces + JSON-LD parity + the `src/lib/provider-cta.ts` shared constant). Footer link carved out.
- **Plan C (payments-guarded):** the §3.6 conversion hook — add `...(campaign && { campaign })` to the subscription branch of `create-checkout.js` (`:319` session metadata and `:330` subscription_data.metadata) via the `coder` agent, with `npm run guard:update` + `npm run gates:payment` in the SAME commit, plus threading `campaign` through the STUC join POST (`save-the-uterus-club/index.astro:437`) and the `/providers/`→STUC link.

## Self-Review

- **Spec coverage (this plan's slice, §3.1 + §10 core):** campaigns.json store (T1) ✓; shared fail-soft module (T2) ✓; missing-goal guard (T2 `computeThermo` returns null; component renders goal-only) ✓; over-goal state (T2 `met` + `data-state`, T3 e2e) ✓; band snapshot not live-fetch (T4 component + T5 snapshot, T4 e2e asserts no fetch) ✓; card live-fetch via shared module (T4) ✓; `/providers/` refactored off the inline IIFE (T3) ✓; funding-projects.json untouched (campaigns.json separate) ✓. §3.2/§3.3/§3.4/§3.6 are explicitly deferred to Plans B/C.
- **Placeholder scan:** none; every step ships real code/commands.
- **Type consistency:** `computeThermo` / `applyThermo` / `initFundThermo` / `ThermoView` / `ThermoEls` names match across T2-T4; `Campaign` record fields match campaigns.json (T1) and the component Props (T4); snapshot shape `{ raised_cents, supporters }` matches T5 file, `toSnapshot`, and the T4 `snapshot` prop.
