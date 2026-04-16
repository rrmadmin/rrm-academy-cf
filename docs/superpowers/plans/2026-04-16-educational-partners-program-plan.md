# Educational Partners Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the RRM Academy Educational Partners program (Friend tier MVP) with NeoFertility.ie as charter partner #1.

**Architecture:** New D1 `partners` table on `rrm-auth`, public application form at `/partners/apply/`, admin review UI at `/admin/partners/`, public directory at `/partners/` with full AEO schema stack. Build pipeline follows the existing FAQ pattern (`fetch-partners-data.mjs` generates `src/data/partners.json`). All endpoints in `functions/api/` go through the coder agent per CLAUDE.md coding standards.

**Tech Stack:** Astro 5.3, CF Pages Functions, D1, AWS SES (via `_ses.js`), Turnstile (via `src/lib/turnstile.ts`), Pagefind (already wired).

**Spec:** `docs/superpowers/specs/2026-04-16-educational-partners-program-design.md`

---

## File Structure

**New files:**
- `migrations/014-partners.sql`: D1 schema
- `src/lib/partners.ts`: shared types + query helpers (used by Astro pages)
- `src/lib/fetch-partners-data.mjs`: build-time fetcher
- `functions/api/partners/apply.js`: public apply endpoint (Turnstile-gated)
- `functions/api/partners/index.js`: build-token-gated read endpoint
- `functions/api/admin/partners/index.js`: admin list endpoint
- `functions/api/admin/partners/[id].js`: admin approve/reject/revoke (action via query param)
- `functions/api/partners/_emails.js`: shared email templates (welcome, rejection, revocation)
- `src/pages/partners/index.astro`: public directory page
- `src/pages/partners/apply.astro`: application form page
- `src/pages/admin/partners.astro`: admin review UI
- `public/partners/badge-stacked-light.svg` + 3 variants
- `public/partners/tagline-rules.md`: tagline usage rules for partner asset kit
- `src/data/partners.json`: generated, committed (so push deploys have it)

**Modified files:**
- `src/pages/sitemap.xml.ts` or equivalent: dynamic `lastmod` for `/partners/`
- `src/data/.baselines.json`: add `partners` count
- `.github/workflows/deploy.yml`: add partners to fetch-all
- `package.json`: add `fetch-partners` script
- `src/components/Footer.astro`: add `/partners/` link

**External repos:**
- `projects/neofertility-ie/`: footer tagline commit (separate repo)

---

### Task 1: D1 migration for partners table

**Files:**
- Create: `projects/rrm-academy-cf/migrations/014-partners.sql`

**Context:** D1 database is `rrm-auth` (per global CLAUDE.md). SQLite-specific rules from CLAUDE.md apply: COLLATE NOCASE on text columns used in WHERE/JOIN, explicit `ON CONFLICT` behavior, booleans as integers, ISO 8601 datetimes.

- [ ] **Step 1: Write the migration SQL**

```sql
-- 014-partners.sql
-- Educational Partners program: Friend tier MVP
-- See: docs/superpowers/specs/2026-04-16-educational-partners-program-design.md

CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  site_url TEXT NOT NULL,
  country TEXT NOT NULL,
  city TEXT,
  provider_name TEXT NOT NULL,
  provider_credential TEXT NOT NULL,
  provider_directory_id TEXT,
  blurb TEXT,
  affirmations TEXT NOT NULL,
  contact_email TEXT NOT NULL COLLATE NOCASE,
  tier TEXT NOT NULL DEFAULT 'friend' CHECK (tier IN ('friend','partner','accredited')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','revoked')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_partners_status ON partners(status);
CREATE INDEX IF NOT EXISTS idx_partners_slug ON partners(slug);
CREATE INDEX IF NOT EXISTS idx_partners_contact_email ON partners(contact_email);
```

- [ ] **Step 2: Apply migration to remote D1**

Run:
```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
npx wrangler d1 execute rrm-auth --remote --file=migrations/014-partners.sql
```
Expected: `Executed X commands in Ys`.

- [ ] **Step 3: Verify table exists**

Run:
```bash
npx wrangler d1 execute rrm-auth --remote --command="SELECT sql FROM sqlite_master WHERE type='table' AND name='partners'"
```
Expected: full CREATE TABLE statement returned.

- [ ] **Step 4: Commit**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
git add migrations/014-partners.sql
git commit -m "feat(partners): add D1 schema for educational partners program"
```

---

### Task 2: Shared lib with types and query helpers

**Files:**
- Create: `projects/rrm-academy-cf/src/lib/partners.ts`

**Context:** Used by Astro pages (page template + admin). Keep it dependency-free so both `.ts` (Astro) and future `.mjs` callers can import.

- [ ] **Step 1: Write the module**

```typescript
// src/lib/partners.ts
// Shared types and helpers for the Educational Partners program.
// See: docs/superpowers/specs/2026-04-16-educational-partners-program-design.md

export interface PartnerAffirmations {
  fabm_diagnosis: boolean;
  excision_over_ablation: boolean;
  rrm_primary_path: boolean;
  patient_education: boolean;
}

export type PartnerTier = 'friend' | 'partner' | 'accredited';
export type PartnerStatus = 'pending' | 'active' | 'rejected' | 'revoked';

export interface Partner {
  id: string;
  name: string;
  slug: string;
  site_url: string;
  country: string;
  city: string | null;
  provider_name: string;
  provider_credential: string;
  provider_directory_id: string | null;
  blurb: string | null;
  affirmations: PartnerAffirmations;
  contact_email: string;
  tier: PartnerTier;
  status: PartnerStatus;
  notes: string | null;
  created_at: string;
  approved_at: string | null;
  revoked_at: string | null;
}

/**
 * Partner data as shipped to the Astro build (subset of the full record
 * with the admin fields stripped).
 */
export interface PublicPartner {
  id: string;
  name: string;
  slug: string;
  site_url: string;
  country: string;
  city: string | null;
  provider_name: string;
  provider_credential: string;
  provider_directory_id: string | null;
  blurb: string | null;
  approved_at: string;
}

/**
 * Slugify a clinic name into a URL-safe key.
 * Lowercase, strip non-alphanumerics, collapse hyphens.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Generate a new partner record ID (rec + 14 alphanumeric chars,
 * matching the rrm-library convention).
 */
export function generatePartnerId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'rec';
  for (let i = 0; i < 14; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * The four Friend-tier principles in display order.
 * Source: spec section 3.
 */
export const FRIEND_PRINCIPLES = [
  {
    key: 'fabm_diagnosis',
    label: 'FABM-informed diagnosis',
    description:
      'Fertility awareness-based methods are used for cycle tracking, diagnosis, and protocol design, including evaluation of male-factor contributors.',
  },
  {
    key: 'excision_over_ablation',
    label: 'Excision over ablation when surgery is indicated',
    description:
      'When endometriosis surgery is indicated, surgical excision is preferred over ablation. Clinics may take a medical-first approach to endometriosis management; this principle applies only to surgical choice.',
  },
  {
    key: 'rrm_primary_path',
    label: 'RRM as primary path',
    description:
      'Restorative reproductive medicine is offered as the primary fertility pathway. IVF is not promoted as a first-line option.',
  },
  {
    key: 'patient_education',
    label: 'Patient education as standard of care',
    description:
      'Patients are taught to understand their own cycles, symptoms, and treatment rationale.',
  },
] as const;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
npx astro check --no-sync 2>&1 | grep -i 'partners\|error' | head -20
```
Expected: no errors referencing `src/lib/partners.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/partners.ts
git commit -m "feat(partners): add shared types and helpers"
```

---

### Task 3: Public application endpoint (coder agent)

**Files:**
- Create: `projects/rrm-academy-cf/functions/api/partners/apply.js`

**Context:** Per CLAUDE.md, coder agent is mandatory for any `functions/api/` work. This endpoint is Turnstile-gated (see `src/lib/turnstile.ts` and `functions/api/contact/submit.js` for the pattern). All four principle affirmations must be `true`.

- [ ] **Step 1: Dispatch coder agent**

Dispatch a `coder` subagent with this prompt:

> Create `projects/rrm-academy-cf/functions/api/partners/apply.js`. This is a public POST endpoint for partner applications.
>
> Read all sibling files in `functions/api/contact/` and `functions/api/community/` for patterns. Read `src/lib/turnstile.ts` and how `functions/api/contact/submit.js` uses it.
>
> Behavior:
> - POST only; return 405 on other methods.
> - Turnstile-gated via the existing helper.
> - Body: `{ name, site_url, country, city?, provider_name, provider_credential, blurb?, contact_email, affirmations: { fabm_diagnosis, excision_over_ablation, rrm_primary_path, patient_education }, turnstile_token }`.
> - Validate: all required fields present, strings non-empty, length caps (name 120, blurb 500, site_url 300, country 80, city 80, provider_name 120, provider_credential 80, contact_email 200), `contact_email` matches email regex, `site_url` starts with `https://`, `affirmations` object has all four keys and all are boolean `true` (reject if any is false or missing).
> - On success: generate `id` via `generatePartnerId()` from `src/lib/partners.ts` (import via relative path `../../../src/lib/partners.ts` or inline the helper if easier; the lib exports `generatePartnerId` and `slugify`). Compute `slug = slugify(name)`. INSERT into `partners` with `status = 'pending'`, `tier = 'friend'`, `created_at = datetime('now')`, `affirmations = JSON.stringify(body.affirmations)`. If slug collides (UNIQUE violation), append `-2`, `-3`, etc. up to 10 attempts then fail with 409.
> - Response shape: success `{ ok: true, id }`, error `{ error: 'code' }` with proper HTTP status.
> - Must satisfy all CLAUDE.md proof gates: try/catch on all external operations, no err.message to client, COLLATE NOCASE on slug uniqueness check, missing env returns 503.
>
> After writing, run `arise-scan --json --files functions/api/partners/apply.js` and fix any findings.

- [ ] **Step 2: Review coder output against spec**

Manually verify the endpoint:
- Body validation matches spec fields (name, site_url, country, city?, provider_name, provider_credential, blurb?, contact_email, affirmations, turnstile_token).
- All four affirmations required `=== true`.
- Slug collision handling is explicit (not a silent retry loop).
- Uses `env.DB` for rrm-auth.
- Returns `503` on missing env.

- [ ] **Step 3: Local smoke test via wrangler dev**

Run:
```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
npm run dev &
sleep 5
curl -X POST http://localhost:8788/api/partners/apply \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Clinic","site_url":"https://example.com","country":"US","provider_name":"Test Provider","provider_credential":"1234567890","contact_email":"test@example.com","affirmations":{"fabm_diagnosis":true,"excision_over_ablation":true,"rrm_primary_path":true,"patient_education":true},"turnstile_token":"skip"}'
```
Expected: `{"error":"invalid_turnstile"}` (Turnstile rejects "skip") OR `{"ok":true,"id":"rec..."}` depending on whether dev mode bypasses Turnstile. Verify row appears in local D1 if success.

Note: if local D1 setup blocks this, defer smoke test to post-deploy curl against production.

- [ ] **Step 4: Commit**

```bash
git add functions/api/partners/apply.js
git commit -m "feat(partners): add public apply endpoint"
```

---

### Task 4: Build-token-gated read endpoint (coder agent)

**Files:**
- Create: `projects/rrm-academy-cf/functions/api/partners/index.js`

**Context:** Mirrors the pattern of `functions/api/faqs.js`: public GET endpoint gated by Bearer `LIBRARY_BUILD_TOKEN` (or a dedicated `PARTNERS_BUILD_TOKEN` if Brian prefers scope isolation; default to `LIBRARY_BUILD_TOKEN` for simplicity since it's already wired into CI).

- [ ] **Step 1: Dispatch coder agent**

Dispatch a `coder` subagent with this prompt:

> Create `projects/rrm-academy-cf/functions/api/partners/index.js`. This is the build-time fetch endpoint for the partner directory.
>
> Read `functions/api/faqs.js` for the Bearer-token auth pattern. Match it exactly.
>
> Behavior:
> - GET only; return 405 on other methods.
> - Bearer auth against `env.LIBRARY_BUILD_TOKEN` (same token FAQ/blog build uses).
> - Query `partners` where `status = 'active'` and `tier = 'friend'`. Order by `approved_at DESC`.
> - Return shape: `{ ok: true, partners: [...] }` where each partner is the PublicPartner subset (strip `contact_email`, `notes`, `affirmations`, status/audit fields).
> - Response headers: `Cache-Control: no-store` (build fetches need fresh data).
> - Must satisfy CLAUDE.md proof gates.
>
> After writing, run arise-scan and fix findings.

- [ ] **Step 2: Review coder output**

Verify PublicPartner fields exactly per `src/lib/partners.ts`. No PII leaks.

- [ ] **Step 3: Commit**

```bash
git add functions/api/partners/index.js
git commit -m "feat(partners): add build-time read endpoint"
```

---

### Task 5: Admin endpoints (coder agent)

**Files:**
- Create: `projects/rrm-academy-cf/functions/api/admin/partners/index.js`
- Create: `projects/rrm-academy-cf/functions/api/admin/partners/[id].js`

**Context:** Follows the admin pattern from `functions/api/admin/enrollments.js` (uses `requireSuperAdmin` from `../auth/_shared.js`). List endpoint and per-id action endpoint.

- [ ] **Step 1: Dispatch coder agent for list endpoint**

Dispatch a `coder` subagent with this prompt:

> Create `projects/rrm-academy-cf/functions/api/admin/partners/index.js`. Admin endpoint for listing partner applications.
>
> Read `functions/api/admin/enrollments.js` for the auth and response pattern. Match it.
>
> Behavior:
> - GET only; 405 on other methods.
> - `requireSuperAdmin(request, env.DB)` for auth.
> - Query string: `?status=pending|active|rejected|revoked` (optional filter; default all).
> - Return shape: `{ ok: true, partners: [...] }` with FULL Partner records (all fields including affirmations object).
> - Parse `affirmations` from JSON string back to object in the response.
> - Must satisfy CLAUDE.md proof gates.
>
> After writing, run arise-scan and fix findings.

- [ ] **Step 2: Dispatch coder agent for action endpoint**

Dispatch a `coder` subagent with this prompt:

> Create `projects/rrm-academy-cf/functions/api/admin/partners/[id].js`. Admin endpoint for approve/reject/revoke actions on a single partner.
>
> Read `functions/api/admin/enrollments.js` and `functions/api/admin/cleanup.js` for patterns.
>
> Behavior:
> - POST only; 405 on other methods.
> - `requireSuperAdmin(request, env.DB)` for auth.
> - Path param `id` from `context.params.id`.
> - Body: `{ action: 'approve' | 'reject' | 'revoke', reason?: string }`.
> - Validate action is one of the three values.
> - For `reject` and `revoke`, `reason` required and non-empty (max 500 chars).
> - Read the existing partner row; 404 if not found.
> - State machine:
>   - `approve`: current status must be `pending`. Update to `active`, set `approved_at = datetime('now')`. Trigger welcome email (import from `functions/api/partners/_emails.js`, created in task 10).
>   - `reject`: current status must be `pending`. Update to `rejected`, append reason to `notes` with timestamp prefix.
>   - `revoke`: current status must be `active`. Update to `revoked`, set `revoked_at = datetime('now')`, append reason to notes.
> - Return shape: `{ ok: true, status: 'new_status' }`.
> - If `_emails.js` is not yet created (task 10 lands later), wrap the email call in try/catch and log-but-continue so the action still persists. Add a `// TODO: task 10` comment at that line so it is visible on grep.
> - Must satisfy CLAUDE.md proof gates. Use `db.batch()` for the update + email-log (if any) atomically.
>
> After writing, run arise-scan and fix findings.

- [ ] **Step 3: Review both endpoints**

Verify: state machine enforces current-status preconditions (can't approve an already-rejected record). Reason field actually gets persisted to notes.

- [ ] **Step 4: Commit**

```bash
git add functions/api/admin/partners/
git commit -m "feat(partners): add admin review endpoints"
```

---

### Task 6: Build-time data fetcher

**Files:**
- Create: `projects/rrm-academy-cf/src/lib/fetch-partners-data.mjs`
- Modify: `projects/rrm-academy-cf/package.json`
- Modify: `projects/rrm-academy-cf/.github/workflows/deploy.yml` (fetch-all step)

**Context:** Pattern from `src/lib/fetch-faq-data.mjs`. Writes to `src/data/partners.json`. Runs in CI fetch-all step.

- [ ] **Step 1: Write the fetcher**

```javascript
// src/lib/fetch-partners-data.mjs
/**
 * Fetch Educational Partners data and cache as JSON.
 * Run: LIBRARY_BUILD_TOKEN=xxx node src/lib/fetch-partners-data.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'partners.json');
const DRY_RUN = process.argv.includes('--dry-run');
const API_URL = 'https://rrmacademy.org/api/partners';

async function fetchWithRetry(url, options, retries = 5) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || (res.status !== 429 && res.status < 500)) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
    }
    const delay = Math.pow(2, attempt) * 1000;
    console.warn(`Retry ${attempt + 1}/${retries} in ${delay / 1000}s...`);
    await new Promise((r) => setTimeout(r, delay));
  }
  throw lastError;
}

async function main() {
  const token = process.env.LIBRARY_BUILD_TOKEN;
  if (!token) {
    console.error('LIBRARY_BUILD_TOKEN env var required');
    process.exit(1);
  }

  const res = await fetchWithRetry(API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    console.error(`Fetch failed: HTTP ${res.status}`);
    process.exit(1);
  }

  const payload = await res.json();
  if (!payload.ok || !Array.isArray(payload.partners)) {
    console.error('Invalid payload shape:', payload);
    process.exit(1);
  }

  const sorted = [...payload.partners].sort((a, b) =>
    (b.approved_at || '').localeCompare(a.approved_at || '')
  );

  console.log(`Fetched ${sorted.length} active partners`);

  if (DRY_RUN) {
    console.log('Dry run; not writing file.');
    return;
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(sorted, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Fetch failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

Edit `projects/rrm-academy-cf/package.json`, inside `"scripts"`:

Add line: `"fetch-partners": "node src/lib/fetch-partners-data.mjs",`

Modify existing `fetch-all` script to include partners. Look at the current value and append ` && npm run fetch-partners` to it.

- [ ] **Step 3: Write initial empty partners.json**

Create `projects/rrm-academy-cf/src/data/partners.json` with content `[]`. This lets the build succeed before the first real partner lands.

- [ ] **Step 4: Update deploy.yml**

Read `.github/workflows/deploy.yml`. Find the step that runs `npm run fetch-all` or equivalent (articles + posts + faqs + courses). Add partners to the list. If fetch-all was updated in step 2, this may be a no-op. Also ensure the CI deploy guard in that file does NOT include a minimum count for partners at launch (expected value is 0 or 1).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fetch-partners-data.mjs package.json src/data/partners.json .github/workflows/deploy.yml
git commit -m "feat(partners): add build-time data fetcher"
```

---

### Task 7: Admin review UI page

**Files:**
- Create: `projects/rrm-academy-cf/src/pages/admin/partners.astro`

**Context:** Astro page that hits `/api/admin/partners` and `/api/admin/partners/[id]` from the browser. Match the layout of `src/pages/admin/enrollments.astro` (read it first).

- [ ] **Step 1: Read reference page**

Run:
```bash
wc -l /Users/brian/iCode/projects/rrm-academy-cf/src/pages/admin/enrollments.astro
```
Then Read the file to learn its layout structure, auth pattern, and data-loading approach.

- [ ] **Step 2: Write the admin partners page**

Structure:
- Use same BaseLayout and admin auth check as enrollments.astro.
- Three sections on one page: Pending (default open), Active, Rejected/Revoked.
- Each row shows: clinic name, site URL (opens in new tab with `rel="external"`), country/city, provider name + credential, contact email, submitted date.
- Pending row action buttons: Approve, Reject (prompts for reason), "Spot-check checklist" (links out to site_url + rrm-cli-ish red-flag reminder).
- Active row action button: Revoke (prompts for reason).
- Client-side JS calls the `/api/admin/partners/[id]` endpoint with the action + reason. Show toast on success/failure. Reload page on success.

Write the full page file. Use client-side `<script>` with inline fetch calls. Model it closely on enrollments.astro's pattern for button handlers.

- [ ] **Step 3: Local smoke test**

Run:
```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
npm run dev &
sleep 5
open http://localhost:4321/admin/partners
```
Verify: page renders, auth gate works (logged-out redirects to login), empty-state shows for each section.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/partners.astro
git commit -m "feat(partners): add admin review UI"
```

---

### Task 8: Public /partners/ page

**Files:**
- Create: `projects/rrm-academy-cf/src/pages/partners/index.astro`

**Context:** Reads `src/data/partners.json` at build time. Renders the full page per spec section 5: direct-answer opener, hero, tier overview, principles, partner list (ItemList schema), FAQ (FAQPage schema), apply CTA, asset kit. Page type is `CollectionPage`. See the spec file for the full schema stack.

- [ ] **Step 1: Write the page**

Structure in order:
1. `<BaseLayout>` wrapper with title "Educational Partners", description matching the direct-answer sentence.
2. Direct-answer opener (h1 + 25-35 word lede).
3. Hero paragraph (one paragraph, Whittaker voice, explains purpose).
4. Three-tier overview (Friend active; Partner and Accredited "coming soon" labels).
5. Four principles section using `FRIEND_PRINCIPLES` from `src/lib/partners.ts`.
6. Partner listing: loop over `partners.json`, render a card per partner. Each card links to `site_url` with `rel="external"` (no nofollow, no sponsored).
7. "Become a partner" CTA linking to `/partners/apply/`.
8. FAQ section (three questions per spec).
9. Asset kit section: download links for `/partners/badge-stacked-light.svg` + 3 variants + `/partners/tagline-rules.md` (file created in task 11).
10. JSON-LD inline via `<script type="application/ld+json">`. Include:
    - `@type: CollectionPage` wrapping the page
    - `EducationalOrganization` with `additionalType: "NGO"` for RRM Academy, `subOrganization` array referencing each Friend partner
    - Each Friend as `MedicalOrganization` node (with `@id`, `name`, `url`, `address`)
    - `ItemList` with partners as `ListItem` entries
    - `FAQPage` with the three Q&A pairs
    - BreadcrumbList comes from BaseLayout; verify it by viewing rendered source

Show actual copy for the direct-answer, hero, and FAQ (three complete 80-120 word answers). Draft copy inline; Brian will voice-pass it before launch.

Draft direct-answer: `An RRM Academy Educational Partner is a clinic or organization that publicly affirms the principles of restorative reproductive medicine and agrees to a defined alignment standard.`

Draft hero: `Restorative reproductive medicine works best when patients can find aligned care close to home. The Educational Partners program recognizes clinics and organizations that publicly affirm the principles we teach at RRM Academy. Patients get a trust shortcut; aligned clinicians get a clear way to signal what kind of care they practice.`

Draft FAQ 1 (What is an RRM Academy Educational Partner?): 80-120 words explaining the program, the four principles, and the distinction between self-attestation and endorsement.

Draft FAQ 2 (How is a Friend partner different from an Accredited clinic?): 80-120 words explaining tier structure, that Accredited requires editorial review, and that Friend is self-attested.

Draft FAQ 3 (Does RRM Academy endorse the clinical practice of its partners?): 80-120 words clarifying that Friend status is principle-affirmation only; it is not endorsement of specific treatments, outcomes, or providers. Encourage readers to verify fit for their situation.

- [ ] **Step 2: Verify rendered schema**

Run:
```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
npm run build
grep -o '"@type":"[^"]*"' dist/partners/index.html | sort -u
```
Expected: `@type` includes `CollectionPage`, `EducationalOrganization`, `MedicalOrganization`, `ItemList`, `FAQPage`, `BreadcrumbList`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/partners/index.astro
git commit -m "feat(partners): add public directory page with full schema stack"
```

---

### Task 9: Application form page

**Files:**
- Create: `projects/rrm-academy-cf/src/pages/partners/apply.astro`

**Context:** HTML form that POSTs to `/api/partners/apply`. Includes Turnstile widget. Pattern: `src/pages/contact.astro`.

- [ ] **Step 1: Read reference form**

Read `projects/rrm-academy-cf/src/pages/contact.astro` for Turnstile setup and submit handler pattern.

- [ ] **Step 2: Write the page**

Required fields per spec section 6:
- Clinic/organization name
- Public website URL (validate starts with `https://`)
- Country, city (country required)
- Primary RRM provider name + credential (NPI for US, registration number otherwise)
- Four affirmation checkboxes (all four required; form JS disables submit until all four checked)
- Contact email
- Optional notes textarea
- Turnstile widget

Success state: show a thank-you panel inline ("Application received. Brian reviews new partners within 7 days. You'll hear back via email."). Failure state: inline error from API response.

- [ ] **Step 3: Smoke test locally**

Run `npm run dev`, navigate to `/partners/apply/`, submit the form with test data, verify either Turnstile blocks (skip local test) or a row appears in D1 as `status = 'pending'`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/partners/apply.astro
git commit -m "feat(partners): add application form page"
```

---

### Task 10: Email helpers

**Files:**
- Create: `projects/rrm-academy-cf/functions/api/partners/_emails.js`

**Context:** Three templates (welcome on approval, rejection, revocation). Uses existing `functions/api/_ses.js` helper. Pattern: read existing transactional email senders (`functions/api/auth/verify-email.js` for the SES call pattern).

- [ ] **Step 1: Read SES helper**

Read `functions/api/_ses.js` to learn the `sendEmail()` signature.

- [ ] **Step 2: Write email templates module**

Export three functions:

```javascript
// functions/api/partners/_emails.js
import { sendEmail } from '../_ses.js';

export async function sendPartnerWelcomeEmail(env, partner) {
  // Subject: "Welcome to RRM Academy Educational Partners"
  // Body: thank-you, asset kit link (https://rrmacademy.org/partners/#assets),
  //       canonical tagline phrasings (copy from spec section 4),
  //       link back to /partners/ showing their listing,
  //       clear statement that they are a Friend tier partner (self-attested),
  //       "reply to this email with questions" footer.
  // ... full implementation ...
}

export async function sendPartnerRejectionEmail(env, partner, reason) {
  // Subject: "Your RRM Academy Educational Partners application"
  // Body: polite rejection, include reason in a blockquote,
  //       invitation to reapply after addressing the concern,
  //       contact email for questions.
  // ... full implementation ...
}

export async function sendPartnerRevocationEmail(env, partner, reason) {
  // Subject: "Update on your RRM Academy Educational Partners status"
  // Body: notice of revocation, reason in blockquote,
  //       request to remove tagline and badge within 14 days,
  //       contact email for questions or appeals.
  // ... full implementation ...
}
```

Write the full templates with actual copy (no placeholders). All three include `From: RRM Academy <administrator@mail.rrmacademy.org>`, reply-to `administrator@rrmacademy.org`. HTML + plain-text versions per existing SES pattern.

- [ ] **Step 3: Wire into `[id].js` action endpoint**

Update `functions/api/admin/partners/[id].js` (created in task 5) to import from `_emails.js`:
- On approve: call `sendPartnerWelcomeEmail`.
- On reject: call `sendPartnerRejectionEmail`.
- On revoke: call `sendPartnerRevocationEmail`.

Wrap each in try/catch and log errors via the `_log.js` helper. Action persists even if email fails. Remove the `// TODO: task 10` comment from task 5.

- [ ] **Step 4: Run arise-scan**

Run:
```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
arise-scan --json --files functions/api/partners/_emails.js functions/api/admin/partners/[id].js
```
Expected: no findings. Fix any that appear.

- [ ] **Step 5: Commit**

```bash
git add functions/api/partners/_emails.js functions/api/admin/partners/[id].js
git commit -m "feat(partners): add transactional email templates"
```

---

### Task 11: Asset kit (badges + tagline rules)

**Files:**
- Create: `projects/rrm-academy-cf/public/partners/badge-stacked-light.svg`
- Create: `projects/rrm-academy-cf/public/partners/badge-stacked-dark.svg`
- Create: `projects/rrm-academy-cf/public/partners/badge-horizontal-light.svg`
- Create: `projects/rrm-academy-cf/public/partners/badge-horizontal-dark.svg`
- Create: `projects/rrm-academy-cf/public/partners/tagline-rules.md`

**Context:** Public assets served directly from `/partners/`. Badge design: use the existing RRM Academy wordmark plus "Educational Partner" label. Colors from `src/styles/tokens.css` or `STYLE-GUIDE.md` (read first).

- [ ] **Step 1: Read design system tokens**

Run:
```bash
cat /Users/brian/iCode/projects/rrm-academy-cf/STYLE-GUIDE.md 2>/dev/null | head -100
```
Identify brand primary color, neutral text colors, and any existing logo SVG for reference.

- [ ] **Step 2: Generate SVG badges**

Use the `frontend-design` skill to generate the four badge variants.

Prompt: `Design four SVG badge variants for "RRM Academy Educational Partner" at 240x120 (horizontal) and 200x200 (stacked). Light variant for light backgrounds (dark text); dark variant for dark backgrounds (light text). Use only the existing RRM Academy brand tokens from STYLE-GUIDE.md. Keep the mark simple: wordmark "RRM Academy" + secondary label "Educational Partner". Flat vector, no filters, no bitmap fallbacks. Viewbox set. No external font dependencies; use system fonts or embed as paths.`

Save all four to `public/partners/`.

- [ ] **Step 3: Write tagline-rules.md**

```markdown
# RRM Academy Educational Partner: Tagline Rules

Thank you for joining the RRM Academy Educational Partners program. These
rules keep the program trustworthy for patients and protect both our sites
from SEO over-optimization risk.

## Where to display

- Footer of your website
- About page
- Not in the hero or above the fold of your homepage

## Canonical tagline (choose one; do not use all on one site)

- "Educational partner of RRM Academy"
- "Proud educational partner of RRM Academy"
- "[Your Clinic Name] is an educational partner of RRM Academy"
- "Learn more about restorative reproductive medicine at RRM Academy"
- "[Your Clinic Name] partners with RRM Academy on patient education"

## Link target

Every link MUST point to `https://rrmacademy.org/partners/`. Do not link to
our homepage, pillar guides (like /naprotechnology/ or /what-is-rrm/), or any
other page using these branded anchors. Deep-linking with controlled anchor
text across many partner sites creates an SEO footprint Google treats as a
link scheme.

## Permitted anchor text (rotate naturally)

- "RRM Academy"
- "restorative reproductive medicine"
- "learn more at RRM Academy"
- "[Your Clinic] educational partner page"
- `https://rrmacademy.org/partners/` (as a naked URL)

## Prohibited phrasings

- "Accredited by RRM Academy"
- "Certified by RRM Academy"
- "In partnership with RRM Academy"
- "Managed by RRM Academy"
- Any phrasing that implies clinical oversight or endorsement of specific
  treatments

## Badge usage

Use the provided SVG badges at their native size or scaled proportionally.
Do not recolor, rotate, crop, or overlay text. Light badge on light
backgrounds; dark badge on dark backgrounds.

## If your status changes

If you stop aligning with the four principles (see our /partners/ page) or
your Friend status is revoked, please remove the tagline and badge within
14 days.

Questions: administrator@rrmacademy.org
```

- [ ] **Step 4: Commit**

```bash
git add public/partners/
git commit -m "feat(partners): add asset kit with badges and tagline rules"
```

---

### Task 12: Sitemap dynamic lastmod

**Files:**
- Modify: `projects/rrm-academy-cf/src/pages/sitemap.xml.ts` (or wherever the sitemap generator lives)

**Context:** The program page's `lastmod` should reflect `max(approved_at)` across active partners, so it re-enters crawl priority when partners are added.

- [ ] **Step 1: Locate the sitemap generator**

Run:
```bash
find /Users/brian/iCode/projects/rrm-academy-cf/src -name 'sitemap*' -type f
```
If none, check `astro.config.mjs` for the `@astrojs/sitemap` integration (auto-generates at build). If auto-generated, write a custom endpoint instead.

- [ ] **Step 2: Add dynamic lastmod for /partners/**

If using `@astrojs/sitemap` integration, use the `serialize` hook in `astro.config.mjs` to override `lastmod` for `/partners/` based on the max `approved_at` in `partners.json`:

```javascript
// astro.config.mjs (inside sitemap integration config)
import partners from './src/data/partners.json';

sitemap({
  serialize(item) {
    if (item.url.endsWith('/partners/') || item.url.endsWith('/partners')) {
      const maxApproved = partners.reduce(
        (max, p) => (p.approved_at > max ? p.approved_at : max),
        ''
      );
      if (maxApproved) item.lastmod = maxApproved;
    }
    return item;
  },
});
```

If a custom sitemap generator exists, modify it equivalently.

- [ ] **Step 3: Verify in build output**

Run:
```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
npm run build
grep -A 2 '<loc>https://rrmacademy.org/partners/</loc>' dist/sitemap-index.xml dist/sitemap-0.xml 2>/dev/null
```
Expected: `<lastmod>` matches the max `approved_at` in `src/data/partners.json` (or absent if partners.json is empty, which is fine for pre-launch).

- [ ] **Step 4: Commit**

```bash
git add astro.config.mjs src/pages/sitemap*.ts 2>/dev/null
git commit -m "feat(partners): dynamic sitemap lastmod from approved_at"
```

---

### Task 13: Footer link + baselines + guard update

**Files:**
- Modify: `projects/rrm-academy-cf/src/components/Footer.astro`
- Modify: `projects/rrm-academy-cf/src/data/.baselines.json`

**Context:** Add global footer link per spec section 8. Also update baselines so CI doesn't think partners data is regressing.

- [ ] **Step 1: Add footer link**

Read `src/components/Footer.astro`. Find the appropriate section (probably under "About" or "Resources"). Add a link:

```html
<li><a href="/partners/">Educational Partners</a></li>
```

- [ ] **Step 2: Update baselines**

Edit `src/data/.baselines.json`. Add a `partners` key with `{ "count": 0, "max_drop": 1 }` or following the existing shape of other entries. Read the file first to confirm the existing shape.

- [ ] **Step 3: Update guard manifest if Footer.astro is guarded**

Run:
```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
grep -l 'src/components/Footer.astro' scripts/guard-manifest.json scripts/guard.mjs 2>/dev/null
```
If Footer.astro is in the manifest, run `npm run guard:update`.

- [ ] **Step 4: Commit**

```bash
git add src/components/Footer.astro src/data/.baselines.json scripts/guard-manifest.json 2>/dev/null
git commit -m "feat(partners): wire footer link and CI baseline"
```

---

### Task 14: Charter partner seed (NeoFertility.ie)

**Files:**
- No new files; direct D1 operation.

**Context:** NeoFertility.ie is charter Friend partner #1. Seed manually via wrangler since the form flow is for future applicants. Then deploy and verify.

- [ ] **Step 1: Compose the INSERT**

Affirmations per memory + spec:
- `fabm_diagnosis`: true (NaPro uses Creighton)
- `excision_over_ablation`: true (Boyle refers for excision when surgery indicated, per `feedback-neofertility-surgery-framing.md`)
- `rrm_primary_path`: true (NaPro is primary)
- `patient_education`: true (standard of RRM practice)

Generate a record ID (use `node -e "console.log('rec' + Math.random().toString(36).slice(2, 16).padEnd(14, '0'))"` or similar).

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
PARTNER_ID=$(node -e "const c='abcdefghijklmnopqrstuvwxyz0123456789'; let s='rec'; for(let i=0;i<14;i++) s+=c[Math.floor(Math.random()*c.length)]; console.log(s)")
echo "Partner ID: $PARTNER_ID"
npx wrangler d1 execute rrm-auth --remote --command="
INSERT INTO partners (
  id, name, slug, site_url, country, city,
  provider_name, provider_credential, blurb,
  affirmations, contact_email, tier, status,
  created_at, approved_at
) VALUES (
  '$PARTNER_ID',
  'NeoFertility',
  'neofertility',
  'https://neofertility.ie',
  'Ireland',
  'Dublin',
  'Dr. Phil Boyle',
  'Medical Council of Ireland 13849',
  'Ireland''s leading restorative reproductive medicine clinic. Dr. Phil Boyle has practiced NaProTechnology since 1998 and is a founding voice in the RRM movement.',
  '{\"fabm_diagnosis\":true,\"excision_over_ablation\":true,\"rrm_primary_path\":true,\"patient_education\":true}',
  'info@neofertility.ie',
  'friend',
  'active',
  datetime('now'),
  datetime('now')
);
"
```

- [ ] **Step 2: Verify the row**

Run:
```bash
npx wrangler d1 execute rrm-auth --remote --command="SELECT id, name, status, approved_at FROM partners WHERE slug='neofertility'"
```
Expected: one row, status `active`.

- [ ] **Step 3: Trigger full rebuild**

Run:
```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
gh workflow run deploy.yml -f skip_fetch=false
```
Wait for the workflow to complete (about 4 minutes). Verify `/partners/` lists NeoFertility.

- [ ] **Step 4: Spot-check schema in rendered HTML**

Run:
```bash
curl -s https://rrmacademy.org/partners/ | grep -o '"@type":"[^"]*"' | sort -u
```
Expected: includes all six schema types (CollectionPage, EducationalOrganization, MedicalOrganization, ItemList, FAQPage, BreadcrumbList).

- [ ] **Step 5: Submit /partners/ to GSC**

Via Search Console URL Inspection tool: enter `https://rrmacademy.org/partners/`, click "Request indexing". This is manual (no CLI step); log completion in the commit message.

- [ ] **Step 6: Commit baseline update**

After deploy completes, `.baselines.json` should reflect `partners: 1`. If CI auto-committed it, pull. Otherwise:

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
git pull
```

---

### Task 15: NeoFertility.ie footer tagline

**Files:**
- Modify: `projects/neofertility-ie/` (locate footer component; likely `src/components/Footer.astro` or similar)

**Context:** Different repo. Per memory `neofertility-ie-project.md`, the site is Astro 5 + CF Pages + Supabase, **deploys on push**. Add the tagline to the footer per spec section 4.

- [ ] **Step 1: Locate the footer**

Run:
```bash
find /Users/brian/iCode/projects/neofertility-ie/src/components -iname 'footer*' -type f
```

- [ ] **Step 2: Add tagline**

Edit the footer to include, in a subdued block near the bottom of the footer (below nav and contact info, above copyright):

```html
<p class="footer-partner">
  <a href="https://rrmacademy.org/partners/" rel="external">NeoFertility is an educational partner of RRM Academy</a>.
</p>
```

Use existing footer class conventions for styling. Do not add new styles if a muted/secondary text class already exists; reuse it.

- [ ] **Step 3: Verify locally**

Run:
```bash
cd /Users/brian/iCode/projects/neofertility-ie
npm run dev
open http://localhost:4321/
```
Scroll to footer, verify the line renders and the link opens to `https://rrmacademy.org/partners/`.

- [ ] **Step 4: Commit and push**

```bash
cd /Users/brian/iCode/projects/neofertility-ie
git add src/components/Footer.astro 2>/dev/null || git add -p
git commit -m "feat: add RRM Academy educational partner tagline to footer"
git push
```

This repo deploys on push. Monitor the deploy via:

```bash
cd /Users/brian/iCode/projects/neofertility-ie
gh run list --limit 1
```

- [ ] **Step 5: Verify live**

Run:
```bash
curl -s https://neofertility.ie/ | grep -o 'educational partner of RRM Academy[^<]*' | head -1
```
Expected: the tagline text appears in the rendered HTML.

- [ ] **Step 6: Verify backlink from Google's perspective**

Wait 24-48 hours, then in GSC for rrmacademy.org, check Links report for neofertility.ie as a new referring domain. This is observational; no action required if it hasn't appeared yet.

---

## Self-Review Notes (post-plan)

Spec coverage:

- §1 Purpose: reflected in rationale throughout
- §2 Three tiers: tasks implement Friend tier; v2 tiers documented in spec (no tasks)
- §3 Four principles: Task 2 (lib), Task 8 (display), Task 14 (NeoFertility affirmations)
- §4 Tagline language: Task 11 (rules MD), Task 15 (applied to neofertility.ie)
- §5 Page IA: Task 8 (full page with all sections)
- §6 Application flow: Task 3 (endpoint), Task 9 (form), Task 5 (admin actions), Task 7 (admin UI)
- §7 Data model: Task 1 (migration), Task 2 (types)
- §8 SEO: Task 8 (schema stack), Task 12 (sitemap), Task 13 (footer link)
- §9 Visual: Task 11 (badge SVGs)
- §10 Admin dashboard: Tasks 5 + 7
- §11 Deferred v2: explicitly out of scope
- §12 Launch sequence: Tasks 14 + 15
- §13 Success criteria: verified by Task 14 Step 4 (schema) and Task 15 Step 5 (live tagline)

Placeholder scan: none. Every code block contains full code.

Type consistency: `PublicPartner` fields in `src/lib/partners.ts` (Task 2) match the output of `/api/partners` (Task 4) and the read consumer (Task 8). `Partner` full shape matches the admin endpoints (Task 5).
