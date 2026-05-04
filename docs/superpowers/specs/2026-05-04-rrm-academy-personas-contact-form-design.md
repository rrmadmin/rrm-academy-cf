# RRM Academy Personas + Contact Form Redesign

**Date:** 2026-05-04 (revised after /arise --deep on the spec; v2)
**Author:** Brian (with Claude)
**Status:** Spec, revised post-/arise, awaiting review

## Problem

The current `/contact/` page is a generic single-textarea form titled "Send us a message." It collects every inbound inquiry into one bucket regardless of intent. In practice, much of that traffic is misrouted:

1. People asking to schedule a clinical appointment with Dr Whittaker. RRM Academy is an education organization; it does not provide clinical care. Whittaker's clinical practice is currently at UPMC, with a future PLLC (Lunira) that is not yet operational and cannot be referenced publicly.
2. STUC members and recurring donors asking to cancel or change their subscription. The Stripe customer portal at `/account` already handles Stripe-managed subscriptions, but the contact form does not surface the self-serve path. PayPal-only recurring donors do not have an `/account` path; their cancel flow goes through PayPal directly.
3. Course takers asking access or content questions. `/account` and `/ask` together cover most of these but are not surfaced from `/contact/`. Note `/ask` requires a free RRM Academy account.
4. Genuine inquiries that RRM Academy can serve (clinician/researcher, partnership, donor/grants, bug reports, speaking/media). Today these blend into the same bucket.

The form does not triage, does not surface self-serve paths before the form, and does not capture even a category to help with manual triage on receipt.

## Goals

1. Triage inbound contact traffic into distinct personas with appropriate handling per persona, including users who arrive without JavaScript.
2. Surface self-serve paths first for personas that have one. Reduce volume of preventable form submissions.
3. Capture branded SEO intent for "schedule appointment with Dr Naomi Whittaker" and similar navigational queries via a bridge page that funnels traffic to UPMC, designed for low-friction copy swap when Lunira launches.
4. Establish a reusable bridge-page primitive so future SEO funnels (find-a-doctor variants) reuse the same component.
5. Document RRM Academy's user personas as a reusable, machine-readable artifact that can inform homepage CTAs, /ask phrasing, and onboarding work later.
6. Produce a triage analytics signal (`category` + `category_source`) that distinguishes user-chosen categories from defaults, so the per-category mix Brian uses to evaluate this work is not corrupted by JS failure or direct-form-access traffic.

## Non-Goals

- Per-category email aliases. All submissions still go to `contact@rrmacademy.org`. Subject-line prefix enables manual or rule-based filtering.
- Building future bridge pages (find-a-NaPro-doctor-near-me, find-an-endometriosis-surgeon, etc). Named in the persona doc as future candidates; not in this spec.
- Building or rebuilding a public provider directory. The existing `/find-a-provider/` URL on rrmacademy.org currently 301-redirects to homepage; only `/dev/providers.astro` exists as an internal route. The find-a-doctor persona therefore points to the FACTS About Fertility provider directory (`https://www.factsaboutfertility.org/find-a-provider/`) as a third-party destination until a first-party directory ships. Building a first-party directory is a separate spec.
- Account self-service UI improvements (e.g., richer "Manage subscription" panel inside `/account`).
- Homepage CTA changes that route by persona.
- Persona-aware /ask routing.
- UTM/attribution capture on bridge-page outbound clicks. The bridge page is the last first-party touchpoint; attribution at the bridge-page entry (via existing GA4 page_view) is sufficient. No JS-instrumented outbound click event in this spec.
- UPMC link-rot monitoring. The bridge page outbound URL is verified manually at deploy time; ongoing monitoring is deferred (noted as future work).
- Splitting "researcher" and "clinician" into separate enum values. The form text-link reads "clinician or researcher" for clarity to the user; the wire enum and subject-line prefix are intentionally lossy via the `clinician-or-researcher` enum value (see API contract).

## Personas

The persona artifact lives at `docs/personas/rrm-academy-personas.md`. It documents 11 personas across three buckets. The doc must contain a machine-readable section (YAML frontmatter or fenced JSON block) plus optional narrative prose, with these per-persona fields:

```
id: <kebab-case-slug>
name: <human label>
bucket: A | B | C
intent: <one sentence>
self_serve_path: <URL or "none">
surface: card | text-link | bridge | redirect-only
contact_form_category: <enum value or null>
auth_required_for_self_serve: <bool>
```

The category enum SSOT is the persona doc's `contact_form_category` field. The form UI and the server enum allowlist are both derived from (and CI-checked against) the persona doc -- see `scripts/check-persona-enum-sync.mjs` in §"Files touched".

### Bucket A. Personas RRM Academy can serve via the contact form (8)

| # | Persona | Primary intent | Self-serve path | Surfaces on | Wire category |
|---|---|---|---|---|---|
| 1 | Course taker | Question about a purchased course (access, content, certificate) | `/account` -> My courses (auth required) | Card | `course` |
| 2a | STUC member with Stripe subscription | Cancel, change, or get receipt for Stripe-backed subscription | `/account` -> Manage subscription (Stripe portal, auth required) | Card | `stuc-billing` |
| 2b | PayPal-only recurring donor | Cancel or change PayPal recurring profile | PayPal direct: paypal.com -> Settings -> Payments -> Manage automatic payments | Card | `stuc-billing` |
| 3 | Patient-curious or unsure | Wondering whether RRM is right for them | `/ask` (free account required), `/faqs`, pillar guides, `/endo-survey` | Folded into "Something else" card | `other` |
| 4 | Clinician or researcher | Library access, citation help, fulltext request | none | Text link | `clinician-or-researcher` |
| 5 | Speaking or media inquiry | Interview, podcast, conference invite for Dr Whittaker | none | Text link | `speaking` |
| 6 | Partnership or affiliate | B2B collab, content partnership, affiliate inquiry | none | Text link | `partnership` |
| 7 | Major donor or grants | Large gift, foundation grant question | rrm.foundation reference | Text link | `donor-or-grants` |
| 8 | Bug or accessibility report | Site issue, broken link, a11y problem | none | Text link | `bug` |

Personas 2a and 2b share one card and one wire category. The card's self-serve content surfaces both paths so the user picks the one matching their payment source (see §"Card-level self-serve content").

### Bucket B. Pseudo-served via bridge page (1)

| # | Persona | Primary intent | Destination | Surfaces on |
|---|---|---|---|---|
| 9 | Wants clinical appointment with Dr Whittaker | Schedule with Dr Whittaker as a patient | `/schedule-with-dr-whittaker/` -> outbound to UPMC | Bridge page; one inbound link from a high-authority page (e.g., `/about/`) |

### Bucket C. Hard redirects, not on contact form (2)

| # | Persona | Primary intent | Handling | Surfaces on |
|---|---|---|---|---|
| 10 | Personal medical advice | "Should I take X?", "interpret my labs" | "We are an education organization. We cannot give personal medical advice. Talk to your clinician, or browse the FACTS About Fertility provider directory at factsaboutfertility.org/find-a-provider/." | Documented in persona doc; referenced inline on FAQ pages and medical-disclaimer page |
| 11 | Find a doctor / referral | Locate an RRM physician | FACTS About Fertility provider directory (`https://www.factsaboutfertility.org/find-a-provider/`). When/if rrmacademy.org ships its own first-party directory, this persona's destination updates. | Documented in persona doc; referenced inline where relevant |

The previous-spec phrase "the existing `/find-a-provider/` directory" was incorrect; that URL 301-redirects to the homepage. This spec replaces all such references.

## Contact form UX

### URL and shell
- URL stays `/contact/`. Inbound links and SEO unchanged.
- H1 changes from "Contact RRM Academy" to "How can we help?".
- Hero subhead: brief one-liner inviting the user to pick the path that fits.
- Sidebar info (email, mailing address, social) unchanged.
- Nonprofit footer note unchanged.

### Layout, top to bottom

1. **Hero** -- H1 "How can we help?" + one-line subhead.
2. **Three primary cards** -- typography-led, no heavy chrome. Implementation uses the HTML5 accordion pattern `<details name="contact-cards">` (Chrome 120+/Safari 17+/Firefox 130+) so opening one card auto-closes the others. JS adds the same single-open behavior for older browsers as a progressive enhancement. Cards in order:
   - "I have a question about a course"
   - "I'm a member or recurring donor"
   - "Something else / not sure where to start"

   When expanded, each card shows self-serve content as primary content, followed by a "Still need help? Send a message ->" link that sets the form's category to the card's persona, sets a visible "Sending as: <Label>" indicator above the form, and scrolls to the single form region. The link's `href` includes a category fragment (e.g., `#contact-form?category=stuc-billing`) so JS-disabled users still set the category via URL hash that the form reads on load.
3. **Other inquiries line** -- understated text-link list, no card treatment:

   > Other inquiries: clinician or researcher . speaking or media . partnership . donor or grants . bug or accessibility

   Each link's `href` includes the category fragment for JS-disabled fallback. Each link sets the form category and scrolls to the form. No self-serve disclosure -- these intents are direct-to-form.
4. **Single form region** -- one form on the page. Components:
   - **"Sending as:" indicator** above the message field. Default state: "Sending as: Choose a topic above" with the submit button disabled. Once a category is set (via card click, text link, URL hash, or the explicit fallback `<select>` below), this updates to "Sending as: <Label> [change]" and submit enables. The "[change]" link smooth-scrolls back to the cards and resets selection.
   - **JS-disabled fallback `<select name="category-fallback">`** rendered inline below the indicator with `<noscript>` guard, OR always rendered with JS hiding it when category is set. Options match the wire enum. Allows a JS-disabled or screen-reader user to pick a category without card interaction. On non-JS submission, the form action is `/api/contact/submit` and the select is the category source.
   - **Form fields:** message (required, 10-5000 chars), first name (required), last name (optional), email (required). The form has a hidden `category` input that mirrors the indicator state.
5. **Sidebar info + nonprofit note** -- unchanged.

### Form-state rules

- Opening or expanding a card updates the indicator to that card's category. Closing all cards (no card open) reverts the indicator to "Choose a topic above" and disables submit.
- Clicking a "Send a message" link (inside any card or text link) sets the indicator + scrolls + focuses the first empty field. The hidden `category` input is updated synchronously.
- The "[change]" link in the indicator scrolls back to the cards and re-collapses any open card; user must re-pick.
- If the user has typed a message and changes category mid-flow (clicks a different card or text link), do NOT clear the message; do show the indicator update so the change is visible. The user can override via the "[change]" affordance.
- A logged-in user's prefilled `firstName`, `lastName`, and `email` fields are always editable. The submitted email is authoritative; the server records the session-state-at-submit (logged-in user ID or null) separately in the SES email body and AE blob for triage purposes.
- Submit button is disabled until all of: a category is selected (not the default "Choose a topic above" state), Turnstile has loaded (or 10s grace period elapsed), and required fields pass HTML5 validation. If Turnstile times out, the indicator changes to "Spam check unavailable -- email contact@rrmacademy.org instead" with a `mailto:` link that includes a `?subject=` matching the chosen category.

### Card-level self-serve content

| Card | Self-serve block content (above "Still need help?" link) |
|---|---|
| Course question | Brief instruction to check `/account` -> My courses for access and certificates (note: requires login). Note the FAQ section on courses. Form fallback for content questions or login problems. |
| Member or recurring donor | Two paths: (1) STUC members and Stripe-backed recurring donors -> log in to `/account` -> Manage subscription. (2) PayPal recurring donors -> log in to PayPal -> Settings -> Payments -> Manage automatic payments. Form fallback for portal failures, refund disputes, or migrations. |
| Something else | Links to `/ask` for "is RRM right for me" type questions (note: requires free account), `/faqs`, current pillar guides (`/what-is-rrm/`, `/naprotechnology/`, `/femm/`, `/neofertility/`), and `/endo-survey`. Form fallback for genuinely-unique inquiries. |

### Auth-aware behavior

- On page load, the form makes a single client-side `fetch('/api/auth/session')` request. If it returns `{ user: { firstName, lastName, email } }`, the form prefills these fields. On 401, network error, or shape mismatch, the form leaves fields empty (no error UI; treat unauthenticated as the default). The card list is static regardless of auth state.
- Prefill is non-authoritative. The user can edit any prefilled field. The server does not cross-check `body.email` against session email; whatever the user submits is what the server uses for `Reply-To`.
- The server endpoint (`/api/contact/submit`) re-validates the session at submit time (if a session cookie is present). The submit-time session state (logged-in user ID or null) is recorded separately in the SES email body and the AE blob, so triage can detect mismatches between the submitted name/email and the active session (e.g., shared computer, expired session).
- Implementation note: `/contact/` is a static Astro page; middleware does not validate session for it. The session check for prefill is therefore a client-side fetch, not a server-side render. Verify that `GET /api/auth/session` returns `firstName`, `lastName`, and `email` before locking implementation.

### Visual

Lightweight per Brian's preference. No filled card backgrounds, no thick borders. Use:
- `<details name="contact-cards">` for the accordion (single-open by default in modern browsers; small JS shim for older browsers).
- Typography hierarchy: card label is a heading-scale element; description is a smaller secondary line.
- Hover/focus state: subtle, e.g., underline on summary or background tint on focus only.
- Text links in the "Other inquiries" line use the standard accent color and are inline, separated by a thin divider character.
- The "Sending as:" indicator is a small inline badge using the existing accent color, with an `aria-live="polite"` region so screen readers announce category changes.
- All scroll-into-view behavior MUST respect `prefers-reduced-motion`: when `window.matchMedia('(prefers-reduced-motion: reduce)').matches` is true, use `behavior: 'auto'` (instant) instead of `'smooth'`.

Final visual styling is at the discretion of the implementing pass and must follow `docs/design/design-system.json` tokens. No hardcoded colors, spacing, or fonts.

## Bridge page primitive

### First instance

`src/pages/schedule-with-dr-whittaker.astro`. Approximately 150 words. Indexable. Captures branded navigational queries ("schedule with Dr Whittaker", "Dr Whittaker appointment", "Dr Whittaker endometriosis surgery").

### Content rules

- States: Dr Whittaker is a board-certified OBGYN who practices clinically separate from RRM Academy. RRM Academy is her education project.
- States: clinical scheduling is handled by her current practice (UPMC).
- Provides one outbound CTA -- a link to her UPMC profile page (which carries phone, address, scheduling instructions).
- Does not list her phone, address, or office details directly. Those live on UPMC's site, which is the canonical source.
- Does not mention Lunira PLLC, future-tense practice changes, or anything that implies movement.
- The UPMC URL appears in EXACTLY ONE place: the `outboundUrl` prop value passed to the `BridgePagePrimitive` from `schedule-with-dr-whittaker.astro`. The persona doc references the bridge-page route (`/schedule-with-dr-whittaker/`), not the UPMC URL. JSON-LD on the bridge page references UPMC via a stable `@id` (see below). Implementation must verify by grep that no other source file references the UPMC URL string before declaring the spec satisfied.
- When Lunira launches, the swap is: change the `outboundUrl` prop value, change the body copy framing, optionally add Lunira to `ssot/organization.json` if entity-graph linkage is desired. The "low-friction" claim covers `outboundUrl` + body copy (two edits in one file). Anything else is documented separately.

### JSON-LD

`WebPage` schema with description tuned for branded queries. `BreadcrumbList`. The bridge page references Dr Whittaker via her existing canonical Person `@id` (`https://rrmacademy.org/#naomi-whittaker`, defined in `about.astro`). It does NOT inline Person properties.

UPMC `MedicalBusiness` reference is OPTIONAL but if included, both `about.astro`'s existing UPMC declaration (line 54-66) and the bridge page MUST reference UPMC via a single `@id` defined in `ssot/organization.json` (e.g., `https://rrmacademy.org/#upmc-divine-mercy`). Inline duplicate UPMC `MedicalBusiness` declarations are forbidden -- one canonical node, multiple references. If `ssot/organization.json` does not yet declare UPMC, do not add the optional reference (defer until SSOT updates).

JSON-LD must be emitted via `<script type="application/ld+json" set:html={JSON.stringify(jsonLd)}>`. Direct template-literal interpolation of props into JSON-LD is forbidden. Astro's `set:html` + `JSON.stringify` is the safe pattern.

### Reusable component

`src/components/BridgePagePrimitive.astro`. TypeScript prop interface:

```ts
interface BridgePageProps {
  title: string;                 // page title and H1, required
  intent?: string;               // one-line description for meta + on-page subhead
  outboundLabel: string;         // CTA button label, required
  outboundUrl: string;           // destination URL, required, MUST start with https:// or http:// or /
  outboundRel?: string;          // defaults computed from outboundUrl host
  subjectPersonId?: string;      // optional Person @id for JSON-LD (e.g., Whittaker's canonical @id)
}
```

Validation rules:
- `outboundUrl` MUST match `/^(https?:\/\/|\/)/`. Any other prefix (e.g., `javascript:`, `data:`, `file:`) throws at build time.
- `outboundRel`: if `outboundUrl` host differs from `rrmacademy.org`, default to `'noopener noreferrer external'`. If on-site (starts with `/`), default to empty string.
- `body` is provided as a slot; content is implementer's responsibility but MUST stay under 200 words and MUST NOT include phone numbers, street addresses, or scheduling instructions (those live on the destination site). The component does not enforce this at build time; it's a content-rules contract, not a code contract.

The primitive renders the full page shell including BaseLayout, hero, body, single CTA, and the standard sidebar/footer. Future bridge pages reuse this primitive without bespoke styling work.

### Mixed-case URL handling

The bridge page URL is canonical lowercase (`/schedule-with-dr-whittaker/`). Mixed-case variants (e.g., `/Schedule-With-Dr-Whittaker/`) should 301-redirect to the canonical form to preserve any inbound link weight. Implementation: extend the existing case-canonicalizer pattern in `_middleware.js` (currently scoped to `/library*`) to include bridge page paths, OR confirm rrm-router handles bridge pages. If neither, accept 404 on case-mismatch as out-of-scope and document.

### Linkage

The bridge page is referenced from:
- `docs/personas/rrm-academy-personas.md` -- documented as the destination for persona #9.
- `src/pages/about.astro` -- Dr Whittaker's bio is rendered via the shared `TeamCard.astro` component, not as inline copy. Add the contextual link either (a) as a conditional slot inside `TeamCard.astro` keyed on `member.id === 'naomi-whittaker'`, OR (b) as a standalone paragraph after the team-grid section. Implementer's call. Copy: "Looking to schedule with Dr Whittaker as a patient? See here."

The bridge page is NOT referenced from the contact form. The contact form does not surface persona #9 -- if a user lands on `/contact/` looking for a clinical appointment, they are not the target user and the catch-all card does not need to mention scheduling. The bridge page captures this audience upstream via search.

Bylines on commentary and library pages (`src/components/AuthorByline.astro`) are intentionally NOT modified. Adding "About scheduling" to every Whittaker byline across the site would feel pushy and dilute the byline's purpose. One contextual link from the about page is enough.

### Link permanence

Add `scripts/check-bridge-links.mjs` -- a small script that registered bridge pages MUST have at least one internal inbound link. Script reads a small config (`docs/personas/bridge-pages.json`) listing registered bridge URLs, greps `src/` for inbound links, fails if any registered bridge has zero inbound links. Wire to CI in the deploy workflow as a non-blocking warning (does not fail the build, but logs loudly). Future refactors that drop the inbound link will trip the warning visibly.

### Future bridge candidates (named, not built)

- `/find-a-napro-doctor-near-me/` -- captures "NaPro doctor near me" long-tail queries; funnels to the FACTS About Fertility directory until a first-party directory ships.
- `/find-an-endometriosis-surgeon/` -- captures "RRM endometriosis surgeon" queries; funnels likewise.
- Additional candidates surface from SEO research over time.

These are documented in the persona doc as future work. Not in this spec.

## API contract

### `POST /api/contact/submit` (modified)

Adds two new fields to the request body. `category` is OPTIONAL on the wire (back-compat for cached pages mid-deploy); the server defaults to `other` when absent.

**Request:**
```json
{
  "name": "string (firstName concatenated with lastName, client-side)",
  "email": "string",
  "message": "string (10-5000 chars)",
  "category": "course | stuc-billing | clinician-or-researcher | speaking | partnership | donor-or-grants | bug | other",
  "category_source": "card | text-link | select | hash | default",
  "website": "string (honeypot)",
  "turnstileToken": "string"
}
```

**Wire field semantics:**
- `name`: server-side wire field. The form has separate `firstName` (required) and `lastName` (optional) inputs for UX; client concatenates `${firstName} ${lastName}`.trim() into `name` before POST. Server accepts `name` only.
- `category`: optional. If present and not in enum allowlist, return 400 `{ error: 'invalid_category' }`. If absent, default to `other` server-side.
- `category_source`: optional. Records how the category was set, for analytics distinguishing user-chosen categories from defaults. Enum: `card` (user clicked a primary card's "Send a message" link), `text-link` (user clicked an "Other inquiries" text link), `select` (user picked the JS-disabled fallback select), `hash` (URL hash carried the category from a prior page load or paste), `default` (no category set; server filled in `other`). Defaults to `default` when absent.

**Enum SSOT:** A single TypeScript constant exported from `src/lib/contact-categories.ts`, imported by both `src/pages/contact.astro` (for the form's category select fallback options + click handlers) AND `functions/api/contact/submit.js` (for enum validation + label map). The persona doc's `contact_form_category` field MUST match this enum. CI script `scripts/check-persona-enum-sync.mjs` enforces the match across all three.

**Validation:**
- `category` validation MUST go through `validateBody`. If `_validate.js` lacks `enum` support, extend it. Do not write an ad-hoc post-validation check (sibling-divergent from every other field; project's #1 bug class).
- All other validation unchanged: Turnstile, honeypot, ELV email check, rate limiting, length caps, structural email regex.
- ELV is fail-open by design (per CLAUDE.md). This spec preserves that semantics; not a regression.

**Email subject construction:**
- Format: `[Contact][<CATEGORY_LABEL>] <sanitized first 80 chars of message, ellipsised if longer>`.
- `[Contact]` outer prefix is preserved from the current behavior so existing Gmail filters keying on `subject:[Contact]` continue to match. Category prefix is added inside.
- `CATEGORY_LABEL` is uppercase: `[COURSE]`, `[STUC-BILLING]`, `[CLINICIAN-OR-RESEARCHER]`, `[SPEAKING]`, `[PARTNERSHIP]`, `[DONOR-OR-GRANTS]`, `[BUG]`, `[OTHER]`.
- Message sanitization (mandatory before slicing): strip control chars and bidirectional Unicode controls via `message.replace(/[\r\n\x00-\x1f\x7f‪-‮⁦-⁩]/g, ' ')`, collapse whitespace runs to single space, trim. Then take `.slice(0, 80)`. If the post-slice string is empty, fall back to `(no preview)`. If the original message length exceeds 80 chars, append `…` (single character) to the slice; final subject body length is at most 81 chars.
- Body of the SES email is unchanged in shape (sender name, email, full message, turnstile/auth metadata as today). The body does add the new fields: `category`, `category_source`, and `auth_state_at_submit` (logged-in user ID or null).

**Honeypot ordering:**
- Honeypot, turnstile, ELV, rate-limit checks run BEFORE category validation. A request that trips honeypot returns 200 silently (current behavior) without writing to AE.
- AE blob writes happen only after ALL validation passes (after ELV check), only on the success path.

**Persistence:**
- No new D1 tables. The contact form does not persist to D1 today and does not start now. Email is the system of record.

**Analytics:**
- The current `submit.js` writes to Analytics Engine via the shared `_log.js` helper. The spec adds `category` and `category_source` to the AE blob set. Implementation must:
  - Read `_log.js` first to determine whether the blob signature can absorb two new fields (current schema: `blobs[worker, event, action, status, detail]`; doubles include `count, httpStatus, duration`).
  - If blobs are at or near the named-position limit, extend `_log.js` signature in a backward-compatible way (e.g., add an optional `extra: Record<string, string>` parameter that pushes into trailing blob slots).
  - Verify rrm-observatory's existing AE queries against `worker_events` are not broken by the schema change (search `~/iCode/projects/rrm-observatory/` for queries that fix-position blob slots).
  - This change is NOT one-line; treat it as a small cross-cutting change with explicit verification steps.

### Frontend wiring

The single form region uses a hidden `<input type="hidden" name="category" value="">` element (no preset; empty value disables submit). The category is set imperatively via JS when:
- A primary card's "Send a message" link is clicked (sets category for that card; `category_source = 'card'`).
- An "Other inquiries" text link is clicked (sets category for that link; `category_source = 'text-link'`).
- The user picks an option in the visible JS-disabled fallback `<select>` (sets category; `category_source = 'select'`).
- The page loads with a URL hash matching `#contact-form?category=<value>` (sets category; `category_source = 'hash'`).

All four trigger paths update the visible "Sending as:" indicator + enable submit.

After setting, the JS smooth-scrolls (respecting `prefers-reduced-motion`) to the form region and focuses the first empty required field (firstName if logged out, message if logged in and prefilled).

If the user clicks a different trigger after setting category once, the indicator updates to the new value, the form does NOT clear typed content, and submit remains enabled.

### Direct-form-access UX

Users who scroll past the cards and submit without clicking any trigger see the indicator "Sending as: Choose a topic above" with submit disabled. They can either (a) scroll up and click a card or text link, OR (b) use the visible JS-disabled fallback `<select>` (which is rendered even with JS for this exact path). Direct submission with `category_source = 'default'` is not possible; the server still defaults absent `category` to `other` for back-compat with cached pages mid-deploy, but the live frontend always sends a category.

## Email routing

- All submissions: `contact@rrmacademy.org` (current).
- No new aliases for now. If volume per category warrants, set up Gmail filters or per-category SES routing later. The category prefix in the subject line is the hook.
- Existing Gmail filters keying on `subject:[Contact]` continue to match because `[Contact]` is preserved as the outer prefix. Pre-deploy operational checklist: audit Brian's Gmail filters, confirm `[Contact]` matching still works, optionally add per-category sub-filters (e.g., `subject:[STUC-BILLING]` -> label "STUC billing").

## Security and infrastructure

- Turnstile, honeypot, ELV check, rate limiting, length caps remain in place. Modifying `submit.js` triggers the security guard hash check; run `npm run guard:update` after the edit.
- Make all `submit.js` edits in a single change before running `guard:update`. The category enum + AE blob extension are two related changes; do them together, regenerate the manifest once.
- The new `category` and `category_source` fields do not introduce new attack surface; enum validation is server-side and rejects everything not in the allowlist.
- ELV remains fail-open by design (CLAUDE.md): ELV errors/timeouts allow the email through. This spec preserves that semantics. Documented for explicitness.
- Subject-line construction uses the sanitization pipeline above; CR/LF/control/bidi characters cannot reach the SES API.
- `outboundUrl` prop on the bridge primitive is build-time-validated against the protocol allowlist; `javascript:` and other dangerous schemes throw at build.

## Pre-implementation verification

Before implementation begins, the implementer must verify the following (block on resolution):

1. `functions/api/_validate.js` -- does it support an `enum` validator type? If not, extending it is part of this spec; budget the change.
2. `functions/api/_log.js` -- what is the `log()` signature? Can two new blobs be added without breaking siblings? If the change requires a signature update, identify all callers (grep `_log.js` imports across `~/iCode/projects/rrm-academy-cf/functions/`).
3. `~/iCode/projects/rrm-observatory/` -- search for queries against `worker_events` that fix-position blob slots. Confirm they tolerate the schema extension.
4. `GET /api/auth/session` -- read the endpoint and confirm it returns `firstName`, `lastName`, and `email` (or document the field shape and adjust prefill code accordingly).
5. `ssot/organization.json` -- does it currently declare UPMC as a node? If not, the optional `MedicalBusiness` JSON-LD reference on the bridge page is deferred (do not add it inline; defer until the SSOT updates).
6. Brian's Gmail filters -- list filters that key on `subject:[Contact]`. Confirm none will break under the new `[Contact][CATEGORY] ...` format.
7. Live `/find-a-provider/` URL -- confirm it still 301s to homepage (current state) before locking spec language.

## Deploy ordering

The category field is wire-OPTIONAL with server-side default `other`. This makes the deploy order-independent:

- If server deploys first: cached pages POST without `category`; server defaults to `other`; emails get `[Contact][OTHER]` prefix; no spurious 4xx errors.
- If client deploys first (rare on Pages, where Functions and static deploy together): client sends `category`; if server is older (no enum validation yet), `category` is ignored as an unknown field; emails carry the old subject format. Mid-deploy submissions lose the new category prefix but no failures.
- Once both deploy: full functionality.

This design preserves the existing `[Contact]` outer prefix specifically to avoid breaking Brian's existing Gmail filters during the deploy window.

## Files touched

### New

- `docs/personas/rrm-academy-personas.md` -- persona artifact with machine-readable fields per persona.
- `docs/personas/bridge-pages.json` -- registry of bridge pages for `check-bridge-links.mjs`.
- `src/pages/schedule-with-dr-whittaker.astro` -- first bridge page instance.
- `src/components/BridgePagePrimitive.astro` -- reusable bridge component with prop validation.
- `src/lib/contact-categories.ts` -- single SSOT for the category enum and label map; imported by `contact.astro` and `submit.js`.
- `scripts/check-persona-enum-sync.mjs` -- CI gate ensuring persona doc, contact form, and submit.js enum stay in sync.
- `scripts/check-bridge-links.mjs` -- non-blocking warning if any registered bridge page has zero inbound links.

### Modified

- `src/pages/contact.astro` -- full rewrite of form region (3 cards via `<details name>`, text-link line, "Sending as:" indicator, JS-disabled fallback select, single form). Hero, sidebar, and nonprofit note retained but updated heading text.
- `functions/api/contact/submit.js` -- add `category` + `category_source` fields, enum validation via `validateBody`, subject construction with sanitization, `auth_state_at_submit` capture, AE blob extension. All `submit.js` edits in a single change before regenerating guard manifest.
- `functions/api/_validate.js` -- add `enum` validator type if missing (verified pre-implementation).
- `functions/api/_log.js` -- extend signature to absorb `category` + `category_source` blobs (or equivalent backward-compatible mechanism, verified pre-implementation).
- `functions/_middleware.js` -- extend the `/library*` case-canonicalizer pattern to include bridge page paths (or document why this is deferred).
- `scripts/guard-manifest.json` -- regenerated by `npm run guard:update` after submit.js changes are complete.
- `src/pages/about.astro` OR `src/components/TeamCard.astro` -- one contextual inbound link to the bridge page below Dr Whittaker's bio. Implementer's call on placement (TeamCard conditional slot vs standalone paragraph).

### Possibly modified

- `src/styles/` -- new disclosure / text-link / "Sending as:" indicator patterns may need a small addition. If the existing design system covers them, no change.
- `.github/workflows/deploy.yml` -- if `check-persona-enum-sync.mjs` is wired as a deploy gate (recommended). If `check-bridge-links.mjs` is wired as a non-blocking warning step.
- `ssot/organization.json` -- only if the optional UPMC `MedicalBusiness` JSON-LD reference is added to the bridge page. Otherwise no change.

## Out of scope (named, not built)

- Per-category email aliases.
- Future bridge pages (find-a-doctor variants).
- A first-party RRM Academy provider directory at `/find-a-provider/`. Until built, find-a-doctor persona points to FACTS About Fertility.
- Homepage CTAs that route by persona.
- Account self-service UI improvements.
- Persona-aware behavior on other surfaces (e.g., adapting `/ask` phrasing per persona).
- UTM/attribution capture on bridge-page outbound clicks.
- Active monitoring of UPMC URL link-rot. Manual deploy-time check is the spec's only verification.
- Adding "About scheduling" to every Whittaker byline across the site.
- Splitting the `clinician-or-researcher` and `donor-or-grants` enum values into separate categories. Lossy by design; documented.

## Open questions

None known after /arise --deep review. If implementation surfaces ambiguity, defer to:
1. The persona doc for who the user is.
2. The design system SSOT for visual tokens.
3. The existing contact form for unchanged behavior (security, sidebar, nonprofit note).
4. The pre-implementation verification checklist for unverified assumptions.

## Success criteria

1. `/contact/` renders the new layout: 3 disclosure cards (single-open accordion) + text-link line + visible "Sending as:" indicator + JS-disabled fallback select + single form. Form submits with the correct `category` AND `category_source` values.
2. Each card's self-serve content surfaces the documented links. "Still need help?" disclosure scrolls to the form (respecting `prefers-reduced-motion`) with category preset.
3. Each "Other inquiries" text link scrolls to the form with the correct category preset.
4. The "Sending as:" indicator updates and announces (`aria-live`) on each category change.
5. JS-disabled users can submit with a category via the visible fallback `<select>`.
6. URL hash `#contact-form?category=<value>` on page load preselects the category and is recorded as `category_source = 'hash'`.
7. `POST /api/contact/submit` accepts absent `category` (defaults to `other`), accepts valid enum values, rejects invalid values with 400. Subject lines have the `[Contact][CATEGORY]` prefix with sanitized message slice. AE blob includes `category` and `category_source`.
8. Logged-in user visiting `/contact/` sees `firstName`, `lastName`, and `email` prefilled from the session (via client-side `/api/auth/session` fetch); fields are editable; submit-time auth state is recorded separately.
9. `/schedule-with-dr-whittaker/` renders, has UPMC outbound link from the prop, indexes with the right meta and JSON-LD (using `set:html={JSON.stringify(...)}`), references Whittaker via `@id` not inline Person properties.
10. `BridgePagePrimitive` rejects `outboundUrl` values outside the `https?://|/` protocol allowlist at build time.
11. At least one high-authority page (`/about/` or `TeamCard`) carries a small contextual inbound link to the bridge page.
12. `docs/personas/rrm-academy-personas.md` exists, documents all 11 personas with bucket assignments, intents, destinations, contact-form behavior, and machine-readable fields.
13. `scripts/check-persona-enum-sync.mjs` passes (persona doc, `contact-categories.ts`, and `submit.js` enum match).
14. `scripts/check-bridge-links.mjs` passes (the new bridge page has at least one inbound link).
15. Security guard passes (`npm run guard`). Type check passes.
16. No reference to `/find-a-provider/` as an existing first-party URL anywhere in the spec, persona doc, or new code. (Verifies the C1 fix.)
17. Subject lines never contain CR/LF/control/bidi characters regardless of message content.

## Decisions log

- Deliverable scope: persona doc + contact form + first bridge page. (Q1: B.)
- Persona inventory across CAN-serve / pseudo-serve / hard-redirect buckets. (Q2.)
- Bridge pages are the right pattern for navigational query capture; the term is "bridge page" / "intent capture page". (Q3.)
- Bridge page handles the UPMC-only constraint with minimal content designed for swap. (Q3 follow-up.)
- Contact form UX: persona disclosure pattern, lightweight typography over heavy cards. (Q4: B with lightweight constraint.)
- Self-serve first, form as fallback disclosure for personas that have a self-serve path. (Q5: B.)
- Patient-curious folded into "Something else" catch-all. (Q6: B.)
- Three primary cards + five secondary text links for visual hierarchy. (Q7 from Brian.)
- Bridge page primitive must be reusable for future find-a-doctor variants. (Q6 follow-up from Brian.)

### v2 (post-/arise --deep) decisions

- `/find-a-provider/` is not an existing first-party URL; replace with FACTS directory until rrmacademy.org ships its own. (C1 from /arise.)
- Auth prefill is client-side `fetch('/api/auth/session')`, not server-side render. (H1.)
- Wire shape: form has separate firstName/lastName inputs; client concatenates into `name` for POST. (H2.)
- Enum values renamed to `clinician-or-researcher` and `donor-or-grants` to match UI labels exactly. (H3.)
- Category becomes wire-OPTIONAL with server default `other` for deploy compatibility; frontend always sends a value via one of four sources. (H4, H11, L4.)
- New `category_source` field separates user-chosen categories from defaults in analytics. (H4.)
- JS-disabled fallback: visible `<select>` rendered alongside cards; URL hash `#contact-form?category=<value>` also sets the category. (H5.)
- Subject sanitization mandatory: strip control, CRLF, and Unicode bidi controls before slicing. (H6, L3.)
- AE blob writes only on success path, after all validation. (H7.)
- Enum SSOT: single `src/lib/contact-categories.ts`, CI-checked across persona doc + form + submit. (H8, L9.)
- `<details name="contact-cards">` accordion enforces single-open. (H10.)
- `validateBody` is the validation surface for `category`; `_validate.js` extended with `enum` if needed. (H12, N1.)
- Visible "Sending as:" indicator above message field; updates on every category change with `aria-live`; submit disabled until set. (H4, H9, M9, M19.)
- Subject prefix preserves existing `[Contact]` outer wrapper so existing Gmail filters continue to match. (M18.)
- `_log.js` signature change for AE blob extension is treated as a small cross-cutting verification, not a one-line change. (M5.)
- `outboundUrl` prop in `BridgePagePrimitive` validates against `https?://|/` protocol allowlist at build. (M6.)
- `body` slot has a 200-word soft cap and content rules (no phone/address/scheduling). (M7.)
- All scroll-into-view respects `prefers-reduced-motion`. (M8.)
- `<details name>` accordion + JS shim for older browsers; `aria-live` announces category changes. (H10, M9.)
- Bridge page mixed-case URLs canonicalize via `_middleware.js` extension. (M10.)
- Persona doc has machine-readable section with named fields. (M11.)
- Submit-time session state recorded separately for auth-mismatch triage. (M12.)
- Turnstile timeout falls back to `mailto:` link with category-keyed subject. (M13.)
- UPMC `@id` SSOT lives in `ssot/organization.json` if entity-graph linkage is added; inline duplicates forbidden. (M14.)
- JSON-LD uses `set:html={JSON.stringify(...)}` pattern; no template-literal interpolation of props. (M15.)
- Bridge page link permanence enforced by `scripts/check-bridge-links.mjs` (non-blocking warning). (M16.)
- UTM preservation on bridge-page outbound CTA is explicitly out of scope. (M17.)
- STUC card surfaces both Stripe portal and PayPal direct paths in self-serve content. (M2.)
- Submitted email is authoritative; server records session state separately. (TRACER-C HIGH 75.)
- "Something else" card sets `category=other`; patient-curious is folded in by design. (L9.)
- `about.astro` placement: implementer chooses TeamCard conditional slot OR standalone paragraph. (L1.)
- 80-char ellipsis: slice to 80, append single `…` if message exceeded 80; final body length max 81. (L2.)
- ELV fail-open documented as preserved-by-design, not a regression. (L6.)
- STUC self-serve auth-required is acknowledged in card copy. (L7.)
- `/ask` auth-required is acknowledged in "Something else" card copy. (L8.)
- Pre-implementation verification checklist captures `_validate.js`, `_log.js`, observatory queries, session endpoint shape, organization SSOT, Gmail filters, and `/find-a-provider/` status. (N1, M5, M18, N2, others.)
- Mobile subject preview eaten by category prefix is acknowledged tradeoff. (N3.)
- `submit.js` edits batched then guard:updated once. (N4.)
