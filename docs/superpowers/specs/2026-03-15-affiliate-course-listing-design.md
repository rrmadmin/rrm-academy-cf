# Affiliate Course Listing

**Date:** 2026-03-15
**Status:** Draft
**Scope:** Add affiliate/partner course support to the RRM Academy course system. First affiliate: NeoFertility Medical Training Cohort (Spring 2026).

---

## Problem

RRM Academy currently only supports internally hosted courses (Stripe checkout, video lessons, progress tracking). Brian has an affiliate partnership with NeoFertility to list their Medical Training Cohort on rrmacademy.org. The course page should look like a native listing but link out to NeoFertility's site for enrollment. This pattern needs to be reusable for future affiliate courses.

## Design

### Data Model (`courses.json`)

Add a new course entry with standard fields plus affiliate-specific fields:

**New fields:**

| Field | Type | Purpose |
|-------|------|---------|
| `isAffiliate` | `boolean` | Flags course as externally hosted |
| `affiliateUrl` | `string` | External enrollment URL (`https://chartneo.com/RRMA`) |
| `couponCode` | `string` | Member discount code (`RRMA-S26`) |
| `couponDiscount` | `string` | Human-readable discount (`5%`) |
| `affiliatePriceCents` | `number` | Discounted price in cents (`114000`) |
| `cohortDates` | `{ start: string, end: string }` | ISO date strings for cohort window |
| `whatsIncluded` | `string[]` | Bullet list for the "What's Included" section |

**Adapted standard fields:**

- `sections: []` -- MUST be an empty array, not omitted. `_shared.js` functions (`getAllStepIds`, `getTotalSteps`, `isValidStep`) call `.flatMap()` on this field and will throw on `undefined`.
- `selfPaced: false` -- cohort-based
- `priceCents: 120000` -- full price ($1,200)
- `stripePriceId`: omitted (no Stripe)
- `instructors`: Dr. Phil Boyle as Lead Instructor, with `bio` field (see Instructor section below)
- `participants: 0` -- set to 0, not omitted. CourseCard Props types `participants` as `number` (required). Implementation must also make this optional in the Props interface.
- `hasCertificate: false`
- `comingSoon: false`
- `description`: REQUIRED. The detail page calls `course.description.split('\n\n')` with no null guard. Omitting this field crashes the Astro build.

**Mutual exclusion invariant:** `isAffiliate: true` and `stripePriceId` MUST NOT coexist. Add a CI assertion in `verify-templates.mjs`:
```js
for (const c of courses) {
  if (c.isAffiliate && c.stripePriceId) {
    throw new Error(`Affiliate course "${c.slug}" must not have stripePriceId`);
  }
}
```
This prevents a copy-paste error from routing affiliate course payments through RRM Academy's Stripe instead of NeoFertility.

### CourseCard.astro

When `course.isAffiliate`:

- Show a **"Partner Course"** badge (new badge variant, blue tint -- `#e0f0ff` bg / `#1a6bb5` text to differentiate from existing green/purple badges)
- Card still links to internal `/courses/[slug]/` (our listing page, not the external URL)
- Meta row: replace the entire video/duration/enrolled row (lines 80-93) with affiliate-specific meta: CME credits, cohort duration, cohort date range. Gate on `{course.isAffiliate ? (...affiliateMeta...) : (...existingMeta...)}`
- Footer shows price + "View Course" as normal
- Skip "Free" and "Certificate" badges

**Props interface update:** Add `isAffiliate?: boolean`, `cohortDates?: { start: string, end: string }`, `whatsIncluded?: string[]`, and make `participants` optional (`participants?: number`). Other affiliate fields (`affiliateUrl`, `couponCode`, etc.) are only used on the detail page, not the card.

**Graceful fallback:** The card computes `totalSteps`, `totalVideos`, `totalDuration` from `course.sections.reduce(...)`. With `sections: []`, these all return 0 (safe). The `progressPct` calculation at line 38 does `progress.completedSteps / progress.totalSteps` -- with `totalSteps: 0` this produces `NaN`. Guard: `const progressPct = progress && progress.totalSteps > 0 ? Math.round(...) : 0`.

### Detail Page (`[slug].astro`)

When `course.isAffiliate`:

**Conditional gating:** All affiliate-specific rendering branches on `course.isAffiliate` (not on `sections.length`). This is a single flag that controls all behavior differences. The following existing code sections need `isAffiliate` conditionals:

| Lines | What | Gate |
|-------|------|------|
| 185-202 | Hero meta pills ("X videos", "Xh Xm", "Self-paced", "Certificate") | Replace with affiliate pills when `isAffiliate` |
| 196 | "Self-paced" pill (hardcoded, no `selfPaced` check) | Wrap in `{course.selfPaced !== false && (...)}` |
| 204 | "Taught by {instructor}" | Conditional: `isAffiliate ? "Offered by NeoFertility -- Led by " + name : "Taught by " + name` |
| 205-230 | Hero CTA (enroll buttons, login link, progress bar) | Replace entirely for affiliate courses |
| 245-273 | Curriculum section (entire `<section>` including h2 + summary) | `{!course.isAffiliate && (...)}` |
| 304 | Instructor bio fallback (hardcodes Whittaker bio) | See Instructor section below |
| 378-387 | Bottom CTA (`.enroll-btn` button) | Replace with affiliate external link for `isAffiliate` |
| 393-503 | `<script is:inline>` enrollment/progress JS | `{!course.isAffiliate && (...)}` -- MUST be wrapped |

**Hero section:**
- Title, short description, image -- same layout
- Meta pills: "20+ CME Credits", "11-Week Cohort", "Apr 20 -- Jul 2, 2026", "Partner Course" (blue variant)
- Instructor line: "Offered by NeoFertility -- Led by Dr. Phil Boyle"
- CTA area (two states):
  - **Not logged in:** "$1,200" price, "Enroll at NeoFertility" button (links to `affiliateUrl`, `target="_blank"`, `rel="noopener sponsored"`), and text: "Log in or create a free account to unlock your RRM Academy member discount"
  - **Logged in:** "$1,200" price, "Enroll at NeoFertility" button, and text: "Use code **RRMA-S26** at checkout to save 5% ($1,140)"
- No login link in the CTA area (the unauthenticated state message handles this with inline links to `/login/` and `/signup/`)

**Frontmatter guards:**
- `const firstStep = course.isAffiliate ? null : course.sections[0]?.steps[0]` -- prevents `undefined` flowing into `define:vars` and creating broken `/courses/slug/undefined/` links

**Body sections (in order):**
1. ~~Curriculum~~ -- skipped when `course.isAffiliate` (wrap entire `<section>` lines 245-273 in `{!course.isAffiliate && (...)}`)
2. **About This Course** -- `course.description`, same rendering as existing
3. **What's Included** -- new section, renders `course.whatsIncluded` as a styled checklist/list
4. **Your Instructor** -- Dr. Phil Boyle (see Instructor section below)
5. ~~Related Courses~~ -- skipped
6. ~~FAQ~~ -- skipped
7. **Bottom CTA** -- for affiliate courses, render an `<a>` tag linking to `affiliateUrl` (NOT a `.enroll-btn` button). Use a distinct class (e.g., `.affiliate-cta-btn`) to avoid collision with the existing enrollment script's `querySelectorAll('.enroll-btn')` handler.

**Skipped for affiliate courses:**
- Curriculum accordion
- Enrollment JS -- wrap the entire `<script is:inline>` block (lines 393-503) in `{!course.isAffiliate && (...)}` so it does not render at all on affiliate pages
- "Continue Learning" enrolled state
- Login link in hero

**Client-side JS for affiliate courses:**
- Add a SEPARATE `<script is:inline>` block that only renders when `course.isAffiliate`
- Pass `affiliateUrl` via `define:vars={{ affiliateUrl: course.affiliateUrl, courseId: course.id }}` (Astro's `define:vars` JSON-serializes values, preventing XSS)
- Check auth status via `fetch('/api/auth/session')` to determine which CTA state to show
- On CTA button click: call `window.open(affiliateUrl, '_blank', 'noopener')` SYNCHRONOUSLY in the click handler (not in a `.then()` or after `await` -- browsers block popups from async callbacks). Fire `fetch('/api/courses/affiliate-click', ...)` as a separate fire-and-forget call (no `await`)
- The API call is fire-and-forget -- the window.open happens regardless of API success/failure

### Instructor

The existing instructor bio section (`[slug].astro:304`) has a hardcoded fallback: `instructor?.bio ?? 'Dr. Whittaker is an OBGYN...'`. The `bio` field does not exist in the current courses.json data model.

**Fix:** Add a `bio` field to the instructor objects in courses.json. For existing courses, add Naomi's bio. For the NeoFertility affiliate course:

```json
{
  "name": "Dr. Phil Boyle",
  "role": "Lead Instructor",
  "bio": "Dr. Phil Boyle is the founder of NeoFertility and a pioneer in Restorative Reproductive Medicine. His published clinical data demonstrates a 41% live birth rate, and his NeoFertility protocol has helped hundreds of clinicians worldwide achieve measurable patient outcomes for infertility and recurrent miscarriage."
}
```

This eliminates the hardcoded Whittaker fallback risk and makes the instructor section data-driven for all courses.

### Click Tracking API

**Endpoint:** `POST /api/courses/affiliate-click`

**Request:** `{ courseId: string }`

**Behavior:**
1. Parse request body via `request.json()` in try/catch. If invalid JSON, return `{ ok: false, error: 'Invalid JSON' }` with 400
2. Validate `courseId` is a non-empty string, max 100 chars. If invalid, return `{ ok: false, error: 'courseId required' }` with 400
3. Validate course exists via `getCourse(courseId)`. If null, return `{ ok: false, error: 'Course not found' }` with 404. Optionally verify `course.isAffiliate` is true
4. Check session via `getSessionIdFromCookie(request)` + `validateSession(db, sessionId)` (matching sibling pattern -- middleware does NOT inject user into `/api/courses/` routes)
5. If not authenticated, return `{ ok: true, tracked: false }` (no-op, don't block)
6. If authenticated, insert row into `affiliate_clicks` table (deduplicated per user/course/day)
7. Return `{ ok: true, tracked: true }`

**D1 migration:**

```sql
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  clicked_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, course_id, date(clicked_at))
);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_user ON affiliate_clicks(user_id, course_id);
```

The UNIQUE constraint on `(user_id, course_id, date(clicked_at))` deduplicates clicks per user per course per day. Use `INSERT OR IGNORE` so duplicate clicks silently no-op. This prevents table bloat from rapid clicks and produces cleaner analytics.

**Error responses (all include `ok: false` to match sibling pattern):**
- Missing DB binding: `{ ok: false, error: 'Server misconfigured' }` with 500 (matches enroll.js, progress.js, quiz.js)
- D1 insert failure: `{ ok: false, error: 'Internal error' }` with 500
- Invalid/missing `courseId`: `{ ok: false, error: 'courseId required' }` with 400
- Course not found: `{ ok: false, error: 'Course not found' }` with 404
- Invalid JSON body: `{ ok: false, error: 'Invalid JSON' }` with 400

**Coding standards:**
- Import `json`, `optionsResponse`, `getSessionIdFromCookie`, `validateSession` from `../auth/_shared.js` (matching sibling import pattern -- CORS is handled automatically by the `json()` helper)
- Import `log` from `../_log.js` -- log errors: `log(env, waitUntil, 'courses', 'affiliate_click_error', 'error', err.message, 0, 500)`. Log successful tracked clicks: `log(env, waitUntil, 'courses', 'affiliate_click', 'ok', courseId, 0, 200)`
- Export `onRequestOptions` for CORS preflight (matches sibling pattern)
- Destructure `{ request, env, waitUntil }` from context (matching sibling pattern)
- Wrap D1 insert in try/catch
- Return 500 if DB binding missing (not 503 -- matches all 5 siblings)
- Validate `courseId` is a non-empty string, max 100 chars
- Validate `courseId` exists via `getCourse(courseId)`
- This endpoint goes through the `coder` agent per project rules

### Schema.org (Detail Page)

**Course schema (affiliate-specific):**
- `provider`: NeoFertility (`{ '@type': 'Organization', name: 'NeoFertility', url: 'https://www.neofertilitytraining.com/' }`) -- NOT RRM Academy
- `instructor`: Dr. Phil Boyle (new Person node -- NOT the Whittaker `@id`)
- Omit `numberOfLessons` and `timeRequired` for affiliate courses (existing code at lines 57-58 computes these from sections, producing `0` and `PT0M` which is factually wrong)
- Omit `hasCourseInstance` with `courseWorkload`
- Add `courseSchedule` or descriptive fields for the cohort dates

**Implementation:** The existing `courseSchema` object (lines 41-72) hardcodes `provider` as RRM Academy (lines 48-52), `instructor` as Whittaker `@id` (line 53), `numberOfLessons` (line 57), and `timeRequired` (line 58). All four need `isAffiliate` conditional branches.

Line 133 unconditionally pushes `whittakerPersonNode` into `graphNodes`. For affiliate courses, push a Phil Boyle Person node instead.

**Breadcrumb:** Same as existing (Home > Courses > [Title]).

**No FAQPage schema** (no FAQs).

### Enrollment Guard

Add an `isAffiliate` check to `functions/api/courses/enroll.js`. Place it immediately after `getCourse()` (after the `comingSoon` check at line 55), BEFORE the idempotent enrollment check (line 59). This ordering matters: if a phantom enrollment already exists for an affiliate course, it should still be rejected (not return `{ ok: true, enrolled: true }`).

```js
if (course.isAffiliate) {
  return json({ ok: false, error: 'External enrollment only' }, 400);
}
```

### Auto-Enroll Admin Guard

`_shared.js:70` (`autoEnrollAdmin`) bypasses the enroll endpoint entirely -- it creates enrollment rows directly in D1 when a superadmin visits any course's progress endpoint. Add an `isAffiliate` check:

```js
// In autoEnrollAdmin(), before the INSERT:
if (course.isAffiliate) return;
```

Without this, a superadmin visiting the affiliate detail page gets a phantom enrollment row. Combined with `checkCourseCompletion` (line 92), where `0 >= 0 = true`, this instantly marks the course as "completed" in D1.

### Completion Check Guard

`_shared.js:92` (`checkCourseCompletion`) has a logic bug exposed by affiliate courses: `if (count >= totalSteps)` evaluates `0 >= 0` as true, marking any zero-step course as "completed". Fix:

```js
if (totalSteps > 0 && count >= totalSteps) {
```

This is a pre-existing bug that affects any course with an empty sections array, not just affiliate courses.

### Course Index Page

Minor updates:

- The `ItemList` schema `Offer` for affiliate courses should include `url: course.affiliateUrl` to indicate the purchase happens externally.
- The `provider` in the ItemList should conditionally use NeoFertility for affiliate courses (matching the detail page schema -- avoids claiming RRM Academy provides a course it doesn't).
- The hardcoded FAQ section answers ("self-paced", "lifetime access", "refund policy") don't apply to partner courses. Add a qualifier: "for RRM Academy courses" to the format/access/refund FAQs, or add a new FAQ: "What are partner courses?" explaining that some listings are from training partners with their own enrollment.

### Account Page

Add the affiliate course to the hardcoded `courseMeta` map at `account/index.astro:372-383`. While the enrollment guard + autoEnrollAdmin guard should prevent enrollment rows, the map should still have the entry defensively.

### Date Formatting

`cohortDates` stores ISO date strings (`"2026-04-20"`). Format for display in Astro frontmatter using `Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })` for start date and `Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })` for end date. Result: "Apr 20 -- Jul 2, 2026".

### Image Pipeline

- Download the NeoFertility cover image from Kajabi CDN
- Compress via Tinify + convert to WebP (standard pipeline)
- Save to `public/images/course-covers/` or serve via existing course cover path
- Reference in `courses.json` as local path (no hotlinking)

### Auth-Gated Coupon Code Display

The coupon code (`RRMA-S26`) is only visible to logged-in users. Implementation:

**Static HTML:** Render both states in the page HTML. The logged-in state (with coupon code) is hidden by default.

**Client JS:**
1. `fetch('/api/auth/session')` on page load
2. If authenticated: show coupon code callout, hide the "log in to unlock" message
3. If not authenticated: show the "log in to unlock" message, hide coupon code

This mirrors the existing pattern in `[slug].astro` where enrollment status toggles between static CTA and enrolled CTA via JS.

**Note:** The coupon code will be visible in the page's HTML source even when hidden. This is an acceptable tradeoff for a 5% discount code -- the auth gate is a UX nudge to grow the user base, not a hard security boundary. If higher-value codes are used in future, consider fetching the code from an API endpoint after auth check instead.

## Files Changed

| File | Change |
|------|--------|
| `src/data/courses.json` | Add NeoFertility course entry (with `bio` on instructors) |
| `src/components/CourseCard.astro` | Handle `isAffiliate` (badge, meta, Props interface, NaN guard) |
| `src/pages/courses/[slug].astro` | Affiliate-specific hero, body sections, JS, schema, conditional gates on 8 code sections |
| `src/pages/courses/index.astro` | FAQ qualifiers, schema Offer URL + provider for affiliates |
| `src/pages/account/index.astro` | Add affiliate course to `courseMeta` map |
| `functions/api/courses/affiliate-click.js` | New endpoint for click tracking |
| `functions/api/courses/enroll.js` | Add `isAffiliate` guard (after getCourse, before idempotent check) |
| `functions/api/courses/_shared.js` | Guard `autoEnrollAdmin` + fix `checkCourseCompletion` for zero-step courses |
| `scripts/verify-templates.mjs` | CI assertion: `isAffiliate && stripePriceId` is invalid |
| D1 migration | `affiliate_clicks` table with daily dedup constraint |
| `public/images/course-covers/` | NeoFertility cover image (WebP) |

## Out of Scope

- Email notifications when someone clicks through
- Admin dashboard for affiliate click analytics
- Affiliate commission tracking
- Multiple coupon codes per course
- Course expiration/archival (cohort end date handling)
- Anonymous click tracking (unauthenticated clicks are not recorded)
