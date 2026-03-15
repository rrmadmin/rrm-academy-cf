# Affiliate Course Listing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add affiliate/partner course support to RRM Academy. First listing: NeoFertility Medical Training Cohort (Spring 2026). Course page hosted on our site, enrollment links to external partner site.

**Architecture:** New `isAffiliate` flag in courses.json controls all template branching. CourseCard and detail page conditionally render affiliate-specific UI. New `affiliate-click` API endpoint tracks clicks for logged-in users. Auth-gated coupon code display encourages account creation.

**Tech Stack:** Astro 5.3 (static), CF Pages Functions, D1, existing design system

**Spec:** `docs/superpowers/specs/2026-03-15-affiliate-course-listing-design.md`

---

## Chunk 1: Data Layer + Backend Guards

### Task 1: D1 Migration -- affiliate_clicks table

**Files:**
- Create: `migrations/010-affiliate-clicks.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- migrations/010-affiliate-clicks.sql
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  clicked_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, course_id, date(clicked_at))
);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_user ON affiliate_clicks(user_id, course_id);
```

- [ ] **Step 2: Run the migration against remote D1**

Run: `npx wrangler d1 execute rrm-auth --remote --file=migrations/010-affiliate-clicks.sql`
Expected: Success, no errors.

- [ ] **Step 3: Commit**

```bash
git add migrations/010-affiliate-clicks.sql
git commit -m "feat: add affiliate_clicks D1 table"
```

---

### Task 2: Backend guards -- _shared.js fixes

**Files:**
- Modify: `functions/api/courses/_shared.js:70-77` (autoEnrollAdmin)
- Modify: `functions/api/courses/_shared.js:92` (checkCourseCompletion)

**IMPORTANT:** This file is under `functions/api/` -- dispatch the `coder` agent.

- [ ] **Step 1: Add isAffiliate guard to autoEnrollAdmin**

In `autoEnrollAdmin()` (line 70), add after the superadmin check (line 72):

```js
const courseObj = getCourse(courseId);
if (courseObj?.isAffiliate) return;
```

- [ ] **Step 2: Fix checkCourseCompletion zero-step bug**

At line 92, change:
```js
if (count >= totalSteps) {
```
to:
```js
if (totalSteps > 0 && count >= totalSteps) {
```

- [ ] **Step 3: Update guard manifest**

```bash
npm run guard:update
```
Expected: `guard-manifest.json` updated with new hash for `_shared.js`.

- [ ] **Step 4: Commit**

```bash
git add functions/api/courses/_shared.js guard-manifest.json
git commit -m "fix: guard autoEnrollAdmin and checkCourseCompletion for affiliate/empty courses"
```

---

### Task 3: Enrollment guard -- enroll.js

**Files:**
- Modify: `functions/api/courses/enroll.js:55` (after comingSoon check)

**IMPORTANT:** This file is under `functions/api/` -- dispatch the `coder` agent.

- [ ] **Step 1: Add isAffiliate guard**

After line 55 (`if (course.comingSoon)...`), add:

```js
if (course.isAffiliate) return json({ ok: false, error: 'External enrollment only' }, 400);
```

- [ ] **Step 2: Commit**

```bash
git add functions/api/courses/enroll.js
git commit -m "fix: reject enrollment attempts for affiliate courses"
```

---

### Task 4: Click tracking endpoint -- affiliate-click.js

**Files:**
- Create: `functions/api/courses/affiliate-click.js`

**IMPORTANT:** This file is under `functions/api/` -- dispatch the `coder` agent. It must read all sibling files in `functions/api/courses/` before writing.

- [ ] **Step 1: Create the endpoint**

The endpoint must:
- Import `json`, `optionsResponse`, `getSessionIdFromCookie`, `validateSession` from `../auth/_shared.js`
- Import `log` from `../_log.js`
- Import `getCourse` from `./_shared.js`
- Export `onRequestOptions` returning `optionsResponse()`
- Export `onRequestPost` with outer try/catch + log
- Destructure `{ request, env, waitUntil }` from context
- Check `!env.DB` -> return 500 `Server misconfigured`
- Parse JSON body in try/catch -> 400 `Invalid JSON`
- Validate `courseId` is non-empty string, max 100 chars -> 400 `courseId required`
- Validate course exists via `getCourse(courseId)` -> 404 `Course not found`
- Auth check via `getSessionIdFromCookie` + `validateSession` -> if not authed, return `{ ok: true, tracked: false }` (200)
- If authed: `INSERT OR IGNORE INTO affiliate_clicks (user_id, course_id) VALUES (?, ?)` in try/catch
- Log success: `log(env, waitUntil, 'courses', 'affiliate_click', 'ok', courseId, 0, 200)`
- Return `{ ok: true, tracked: true }`

- [ ] **Step 2: Commit**

```bash
git add functions/api/courses/affiliate-click.js
git commit -m "feat: add affiliate click tracking endpoint"
```

---

### Task 5: CI assertion -- verify-templates.mjs

**Files:**
- Modify: `scripts/verify-templates.mjs`

- [ ] **Step 1: Add affiliate mutual exclusion check**

Add a new test section (after the existing pillar page checks) that reads `courses.json` and asserts no course has both `isAffiliate: true` and a `stripePriceId`:

```js
// ─── Affiliate Course Invariants ───────────────────────────────────
const courses = JSON.parse(readFileSync(join(ROOT, 'src/data/courses.json'), 'utf-8'));
for (const c of courses) {
  if (c.isAffiliate && c.stripePriceId) {
    fail('courses.json', `Affiliate course "${c.slug}" must not have stripePriceId`);
  } else if (c.isAffiliate) {
    pass('courses.json', `Affiliate course "${c.slug}" has no stripePriceId`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/verify-templates.mjs
git commit -m "feat: CI assertion for affiliate/stripePriceId mutual exclusion"
```

---

## Chunk 2: Course Data + Image

### Task 6: Cover image pipeline

**Files:**
- Create: `public/images/course-covers/neofertility-med-training.webp`

- [ ] **Step 1: Download the cover image**

```bash
curl -sL "https://kajabi-storefronts-production.kajabi-cdn.com/kajabi-storefronts-production/file-uploads/themes/2164949492/settings_images/61ba216-2bf3-7f7-566b-ab0c0edb3e4_ee9c3b1f-3545-4733-91b0-7db0528f3c0a.png" -o /tmp/neo-cover.png
```

- [ ] **Step 2: Compress via Tinify and convert to WebP**

Use the standard image pipeline: `sips` for any needed crop, then Tinify REST API for compression + WebP conversion. Save output to `public/images/course-covers/neofertility-med-training.webp`.

```bash
# Tinify compress + WebP convert
TINIFY_KEY=$(op read 'op://Automation/Tinify API Key/credential' --reveal)
curl -s --user "api:$TINIFY_KEY" --data-binary @/tmp/neo-cover.png https://api.tinify.com/shrink | jq -r '.output.url' | xargs -I{} curl -s {} --user "api:$TINIFY_KEY" -H "Content-Type: application/json" -d '{"convert":{"type":"image/webp"}}' -o public/images/course-covers/neofertility-med-training.webp
```

- [ ] **Step 3: Verify image**

```bash
sips -g pixelWidth -g pixelHeight public/images/course-covers/neofertility-med-training.webp
```
Expected: 1280x720 (or close), WebP format.

- [ ] **Step 4: Commit**

```bash
git add public/images/course-covers/neofertility-med-training.webp
git commit -m "feat: add NeoFertility course cover image"
```

---

### Task 7: Add NeoFertility course to courses.json

**Files:**
- Modify: `src/data/courses.json` (append new entry)

- [ ] **Step 1: Add the affiliate course entry**

Append this entry to the courses array in `src/data/courses.json`. Also add `bio` fields to the existing courses' instructor objects (use Naomi's existing hardcoded bio from `[slug].astro:304`).

The NeoFertility entry:

```json
{
  "id": "neofertility-med-training",
  "title": "NeoFertility Medical Training Cohort",
  "slug": "neofertility-medical-training",
  "description": "The NeoFertility Medical Training Cohort is an 11-week live program providing a structured diagnostic and treatment framework for infertility and recurrent miscarriage using Restorative Reproductive Medicine.\n\nDesigned for Family Medicine, OB/GYN, and women's health clinicians, this cohort combines on-demand coursework with live mentorship from Dr. Phil Boyle, founder of NeoFertility and a pioneer in RRM.\n\nThe program covers:\n\n• The foundations of Restorative Reproductive Medicine\n\n• Diagnostic and treatment protocols for hormonal and cycle-related conditions\n\n• The psychology of conception and patient relationships\n\n• Chart Neo app integration for data-driven patient care\n\n• Case studies and outcome-based implementation",
  "shortDescription": "11-week live training in Restorative Reproductive Medicine for clinicians treating infertility and recurrent miscarriage. Led by Dr. Phil Boyle. 20+ CME credits.",
  "image": "/images/course-covers/neofertility-med-training.webp",
  "imageAlt": "NeoFertility Medical Training Cohort promotional graphic with Neo logo",
  "priceCents": 120000,
  "isFree": false,
  "hasCertificate": false,
  "selfPaced": false,
  "accessType": "public",
  "comingSoon": false,
  "participants": 0,
  "isAffiliate": true,
  "affiliateUrl": "https://chartneo.com/RRMA",
  "couponCode": "RRMA-S26",
  "couponDiscount": "5%",
  "affiliatePriceCents": 114000,
  "cohortDates": { "start": "2026-04-20", "end": "2026-07-02" },
  "whatsIncluded": [
    "10-lesson course with Dr. Phil Boyle (15 CME credits)",
    "6 live Q&A sessions",
    "Monthly live case studies with Dr. Phil Boyle & Dr. Monica Minjeur (CME eligible)",
    "Clinical Resource Library (CME eligible)",
    "NeoFertility Medical Forum",
    "Chart Neo Professional Portal Account (HIPAA-compliant)",
    "One additional staff member access for your clinic",
    "Monthly Chart Neo support sessions"
  ],
  "instructors": [
    {
      "name": "Dr. Phil Boyle",
      "role": "Lead Instructor",
      "bio": "Dr. Phil Boyle is the founder of NeoFertility and a pioneer in Restorative Reproductive Medicine. His published clinical data demonstrates a 41% live birth rate, and his NeoFertility protocol has helped hundreds of clinicians worldwide achieve measurable patient outcomes for infertility and recurrent miscarriage."
    },
    {
      "name": "NeoFertility",
      "role": "Organization"
    }
  ],
  "settings": {
    "stepOrder": "fixed",
    "futureStepContent": "hidden",
    "videoWatchRequirement": 0.9,
    "autoplayNextVideo": true
  },
  "seo": {
    "title": "NeoFertility Medical Training Cohort | RRM Academy",
    "description": "11-week live clinical training in Restorative Reproductive Medicine with Dr. Phil Boyle. 20+ CME credits. April 20 - July 2, 2026."
  },
  "sections": [],
  "topics": ["Restorative Reproductive Medicine", "Infertility", "Recurrent Miscarriage"],
  "teaches": ["RRM diagnostic framework", "Hormonal cycle management", "Chart Neo integration"]
}
```

- [ ] **Step 2: Add bio to existing course instructors**

For every existing course that has `"name": "Naomi Whittaker, MD"` in its instructors array, add the `bio` field:

```json
"bio": "Dr. Whittaker is an OBGYN and fertility surgeon who specializes in Restorative Reproductive Medicine (RRM) and NaProTechnology. She is the founder of the RRM Academy and the RRM Foundation, dedicated to making evidence-based reproductive healthcare education accessible to patients and professionals."
```

- [ ] **Step 3: Build to verify no crashes**

```bash
npm run build 2>&1 | tail -20
```
Expected: Build succeeds. The new course generates pages at `/courses/neofertility-medical-training/`.

- [ ] **Step 4: Commit**

```bash
git add src/data/courses.json
git commit -m "feat: add NeoFertility affiliate course entry + instructor bios"
```

---

## Chunk 3: CourseCard Component

### Task 8: Update CourseCard.astro for affiliate support

**Files:**
- Modify: `src/components/CourseCard.astro`

- [ ] **Step 1: Update Props interface**

Add optional affiliate fields and make `participants` optional:

```typescript
interface Props {
  course: {
    id: string;
    slug: string;
    title: string;
    shortDescription: string;
    image: string;
    imageAlt?: string;
    priceCents: number;
    isFree: boolean;
    hasCertificate: boolean;
    selfPaced: boolean;
    participants?: number;
    instructors: { name: string; role: string }[];
    sections: { steps: any[] }[];
    comingSoon?: boolean;
    isAffiliate?: boolean;
    cohortDates?: { start: string; end: string };
  };
  enrolled?: boolean;
  progress?: { completedSteps: number; totalSteps: number };
}
```

- [ ] **Step 2: Fix NaN progress guard**

Change line 38 from:
```js
const progressPct = progress ? Math.round((progress.completedSteps / progress.totalSteps) * 100) : 0;
```
to:
```js
const progressPct = progress && progress.totalSteps > 0 ? Math.round((progress.completedSteps / progress.totalSteps) * 100) : 0;
```

- [ ] **Step 3: Add cohort date formatting helper**

In the frontmatter, add:
```js
const isAffiliate = !!course.isAffiliate;
let cohortLabel = '';
if (isAffiliate && course.cohortDates) {
  const fmt = (d, opts) => new Intl.DateTimeFormat('en-US', opts).format(new Date(d + 'T00:00:00'));
  cohortLabel = `${fmt(course.cohortDates.start, { month: 'short', day: 'numeric' })} – ${fmt(course.cohortDates.end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
```

- [ ] **Step 4: Add Partner Course badge**

In the badge area (after line 74), add:
```astro
{isAffiliate && <span class="course-card__badge course-card__badge--partner">Partner Course</span>}
```

- [ ] **Step 5: Conditional meta row**

Replace the existing meta row (lines 80-93) with a conditional:
```astro
{isAffiliate ? (
  <div class="course-card__meta">
    <span class="course-card__meta-item">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1.1 2.7 3 6 3s6-1.9 6-3v-5"/></svg>
      20+ CME
    </span>
    <span class="course-card__meta-item">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      11 weeks
    </span>
    <span class="course-card__meta-item">
      {cohortLabel}
    </span>
  </div>
) : (
  /* existing meta row unchanged */
)}
```

- [ ] **Step 6: Skip Free/Certificate badges for affiliate**

Wrap existing badge rendering in `{!isAffiliate && ...}`:
```astro
{!isAffiliate && course.isFree && <span class="course-card__badge course-card__badge--free">Free</span>}
{!isAffiliate && course.hasCertificate && <span class="course-card__badge course-card__badge--cert">Certificate</span>}
```

- [ ] **Step 7: Add partner badge CSS**

```css
.course-card__badge--partner {
  left: var(--space-3);
  background: #e0f0ff;
  color: #1a6bb5;
}
```

- [ ] **Step 8: Build + verify**

```bash
npm run build 2>&1 | tail -5
```
Expected: Build succeeds. Course card renders with "Partner Course" badge.

- [ ] **Step 9: Commit**

```bash
git add src/components/CourseCard.astro
git commit -m "feat: CourseCard affiliate support (partner badge, cohort meta, NaN guard)"
```

---

## Chunk 4: Detail Page

### Task 9: Update [slug].astro for affiliate courses

**Files:**
- Modify: `src/pages/courses/[slug].astro`

This is the largest task. All changes are conditional branches on `course.isAffiliate`.

- [ ] **Step 1: Frontmatter guards**

Change line 38:
```js
const firstStep = course.sections[0]?.steps[0];
```
to:
```js
const firstStep = course.isAffiliate ? null : course.sections[0]?.steps[0];
```

Add cohort date formatting + affiliate price:
```js
const isAffiliate = !!course.isAffiliate;
let cohortLabel = '';
if (isAffiliate && course.cohortDates) {
  const fmt = (d, opts) => new Intl.DateTimeFormat('en-US', opts).format(new Date(d + 'T00:00:00'));
  cohortLabel = `${fmt(course.cohortDates.start, { month: 'short', day: 'numeric' })} – ${fmt(course.cohortDates.end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
const affiliatePrice = isAffiliate && course.affiliatePriceCents ? `$${(course.affiliatePriceCents / 100).toFixed(0)}` : '';
```

- [ ] **Step 2: Schema.org conditionals**

In the `courseSchema` object (lines 41-72):
- Conditionally set `provider` (NeoFertility for affiliate, RRM Academy for internal)
- Conditionally set `instructor` (Phil Boyle Person for affiliate, Whittaker `@id` for internal)
- Conditionally omit `numberOfLessons` and `timeRequired` for affiliate courses
- Conditionally omit `hasCourseInstance` for affiliate courses

At line 133 where `graphNodes` is built:
- Push Phil Boyle Person node instead of `whittakerPersonNode` for affiliate courses

- [ ] **Step 3: Hero meta pills conditional**

Replace the meta pills section (lines 185-202) with a conditional:
- If `isAffiliate`: show "20+ CME Credits", "11-Week Cohort", cohort date range, "Partner Course" (blue variant) pills
- If not affiliate: existing pills (wrap "Self-paced" pill in `{course.selfPaced !== false && (...)}`)

- [ ] **Step 4: Instructor line conditional**

At line 204, replace:
```astro
<p class="course-hero__instructor">Taught by {instructor?.name}</p>
```
with:
```astro
<p class="course-hero__instructor">{isAffiliate ? `Offered by NeoFertility — Led by ${instructor?.name}` : `Taught by ${instructor?.name}`}</p>
```

- [ ] **Step 5: Hero CTA -- affiliate version**

Replace the hero CTA area (lines 205-230) with a conditional. For affiliate courses, render:
- `$1,200` price
- "Enroll at NeoFertility" button as `<a>` tag (NOT `.enroll-btn` class) with `target="_blank"` and `rel="noopener sponsored"`. Use class `.affiliate-cta-btn`. Add external link icon SVG.
- Two hidden/shown divs: one with "Log in or create a free account..." message (shown by default), one with coupon code callout (hidden by default, shown by JS after auth check)

For non-affiliate courses: keep existing CTA markup unchanged.

- [ ] **Step 6: Skip curriculum for affiliate**

Wrap the entire curriculum section (lines 245-273) in `{!isAffiliate && (...)}`.

- [ ] **Step 7: Add "What's Included" section**

After the About section, add a new section that renders when `isAffiliate && course.whatsIncluded?.length`:

```astro
{isAffiliate && course.whatsIncluded?.length > 0 && (
  <section class="course-section">
    <div class="container container--narrow">
      <h2>What's Included</h2>
      <ul class="whats-included">
        {course.whatsIncluded.map((item) => (
          <li>{item}</li>
        ))}
      </ul>
    </div>
  </section>
)}
```

- [ ] **Step 8: Instructor bio -- remove hardcoded fallback**

At line 304, the bio now comes from `instructor.bio` (added in Task 7). No hardcoded Whittaker fallback needed since all courses now have `bio` on their instructors.

- [ ] **Step 9: Skip Related/Included + FAQ sections for affiliate**

Wrap the "Related / Included" section (lines 310-335) in `{!isAffiliate && (...)}`.
Wrap the "You Might Also Like" section (lines 337-352) in `{!isAffiliate && (...)}`.
Wrap the FAQ section (lines 355-376) in `{!isAffiliate && (...)}`.

These are implicitly safe today (affiliate course has no `includes`, `includedIn`, `relatedCourses`, or `faqs` data), but explicit guards prevent future breakage if those fields are ever added.

- [ ] **Step 10: Bottom CTA -- affiliate version**

Wrap lines 378-387 in a conditional. For affiliate: render an `<a>` with class `.affiliate-cta-btn` linking to `affiliateUrl`. For non-affiliate: keep existing `.enroll-btn` button.

- [ ] **Step 10: Wrap existing enrollment script**

Wrap the `<script is:inline>` block (lines 393-503) in `{!isAffiliate && (...)}`.

- [ ] **Step 11: Add affiliate client JS**

Add a new `<script is:inline>` block that only renders when `isAffiliate`:

```astro
{isAffiliate && (
  <script is:inline define:vars={{ affiliateUrl: course.affiliateUrl, courseId: course.id }}>
    (function () {
      // Auth-gated coupon display
      var couponShow = document.getElementById('affiliate-coupon');
      var couponHide = document.getElementById('affiliate-login-prompt');

      fetch('/api/auth/session', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.userId) {
            if (couponShow) couponShow.hidden = false;
            if (couponHide) couponHide.hidden = true;
          }
        })
        .catch(function () {});

      // Click tracking + redirect
      var btns = document.querySelectorAll('.affiliate-cta-btn');
      for (var i = 0; i < btns.length; i++) {
        btns[i].addEventListener('click', function (e) {
          e.preventDefault();
          window.open(affiliateUrl, '_blank', 'noopener');
          fetch('/api/courses/affiliate-click', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ courseId: courseId }),
          }).catch(function () {});
        });
      }
    })();
  </script>
)}
```

- [ ] **Step 12: Fix Self-paced pill for all courses**

In the NON-affiliate meta pills block, wrap the "Self-paced" pill (currently hardcoded at line 196) in a conditional so it respects the `selfPaced` field:
```astro
{course.selfPaced !== false && (
  <span class="meta-pill">...Self-paced...</span>
)}
```
This applies to all courses, not just affiliate.

- [ ] **Step 13: Add affiliate-specific CSS**

Add styles for the partner pill, "What's Included" list, and affiliate CTA:

```css
/* Partner Course pill (blue) */
.meta-pill--partner {
  color: #1a6bb5;
  background: #e0f0ff;
  border-color: #b3d9f7;
}

/* What's Included */
.whats-included {
  padding-left: var(--space-6);
  font-size: 0.9375rem;
  color: var(--text-secondary);
  line-height: 1.8;
}
.whats-included li {
  margin-bottom: var(--space-2);
}

/* Affiliate coupon callout */
.affiliate-coupon-code {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin-top: var(--space-2);
  line-height: 1.5;
}
.affiliate-coupon-code strong {
  color: var(--text-primary);
}
```

- [ ] **Step 14: Build + verify**

```bash
npm run build 2>&1 | tail -10
```
Expected: Build succeeds. Visit `/courses/neofertility-medical-training/` in dev to verify layout.

- [ ] **Step 15: Commit**

```bash
git add src/pages/courses/[slug].astro
git commit -m "feat: detail page affiliate support (hero, CTA, schema, auth-gated coupon)"
```

---

## Chunk 5: Index Page + Account Page + Final Verification

### Task 10: Course index page updates

**Files:**
- Modify: `src/pages/courses/index.astro`

- [ ] **Step 1: Schema Offer URL + provider conditional**

In the `itemListElement` mapping (lines 13-36), add conditional `url` on the Offer and conditional `provider`:

```js
provider: course.isAffiliate
  ? { '@type': 'Organization', name: 'NeoFertility', url: 'https://www.neofertilitytraining.com/' }
  : { '@type': 'Organization', '@id': 'https://rrmacademy.org/#organization', name: 'RRM Academy', url: 'https://rrmacademy.org/' },
```

And on the Offer:
```js
...(course.isAffiliate && course.affiliateUrl ? { url: course.affiliateUrl } : {}),
```

- [ ] **Step 2: FAQ qualifier text**

Update the FAQ answers that say "Our courses are self-paced..." and "Access is lifetime..." to add "for RRM Academy courses" qualifier. Add a new FAQ about partner courses:

```html
<details class="faq-item">
  <summary class="faq-q">What are partner courses?</summary>
  <p class="faq-a">Some courses listed on RRM Academy are offered by trusted training partners in Restorative Reproductive Medicine. These courses are hosted and managed by the partner organization. Enrollment, payment, and course delivery happen on the partner's platform. Partner courses are clearly labeled with a "Partner Course" badge.</p>
</details>
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/courses/index.astro
git commit -m "feat: course index affiliate schema + partner course FAQ"
```

---

### Task 11: Account page courseMeta

**Files:**
- Modify: `src/pages/account/index.astro:372-383`

- [ ] **Step 1: Add affiliate course to courseMeta map**

Add to the `courseMeta` object:

```js
'neofertility-med-training': { title: 'NeoFertility Medical Training Cohort', slug: 'neofertility-medical-training' },
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/account/index.astro
git commit -m "feat: add NeoFertility to account page courseMeta"
```

---

### Task 12: Final build + verification

- [ ] **Step 1: Full build**

```bash
npm run build 2>&1 | tail -20
```
Expected: Build succeeds with no errors.

- [ ] **Step 2: Run verify-templates**

```bash
node scripts/verify-templates.mjs
```
Expected: All tests pass including the new affiliate mutual exclusion check.

- [ ] **Step 3: Run guard**

```bash
npm run guard
```
Expected: Pass (affiliate-click.js is not a guarded file).

- [ ] **Step 4: Visual verification with Playwright**

Use Playwright to verify:
1. `/courses/` -- NeoFertility card appears with "Partner Course" badge, correct meta (CME, 11 weeks, dates)
2. `/courses/neofertility-medical-training/` -- Hero shows correct pills, price, "Enroll at NeoFertility" button, instructor bio is Phil Boyle (not Whittaker)
3. "Enroll at NeoFertility" button opens `chartneo.com/RRMA` in new tab
4. Coupon code section shows "Log in or create a free account..." when not authenticated
5. No curriculum section visible
6. "What's Included" list renders all 8 items
7. Bottom CTA repeats the external enrollment button

- [ ] **Step 5: Push**

```bash
git push origin main
```
