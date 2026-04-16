# Educational Partners Program: Design Spec

**Date:** 2026-04-16
**Status:** Approved, ready for implementation plan
**Scope:** RRM Academy Educational Partners program (Friend tier MVP + v2 vision)
**Owner:** Brian

## 1. Purpose

A public-facing program that recognizes clinics, practices, and organizations aligned with restorative reproductive medicine principles. It:

1. Gives aligned clinics a credible way to signal RRM alignment on their own sites.
2. Gives RRM Academy an authority network of backlinks from real medical domains.
3. Gives patients a trust shortcut: if a clinic is listed here, they affirm a defined set of RRM principles.

The program is triggered by NeoFertility.ie needing a footer tagline; it generalizes that one-off into a repeatable program.

## 2. Program structure

Three tiers, qualification escalating with tier. Only Friend tier ships in MVP.

### Friend of RRM Academy (MVP)

- **Gate:** Self-attested principle affirmation. No editorial review.
- **Gets:** Badge + listing on `/partners/`, permission to use the canonical tagline, access to the partner asset kit, backlink from the program page.
- **Gives:** Backlink to rrmacademy.org, public affirmation of the four principles, agreement to stop using the tagline if ever found promoting prohibited practices.

### RRM Academy Partner (v2, deferred)

- **Gate:** Clinic has at least one provider listed in the RRM Academy practitioner directory.
- **Gets:** Friend benefits, plus dedicated partner profile page, quarterly partner spotlight, course discount codes for their patients, affiliate revenue share on course referrals.
- **Gives:** Content contribution (1-2 pieces/year: case studies, patient stories, provider Q&A), participation in partner calls.

### RRM Academy Accredited (v2, deferred)

- **Gate:** Editorial review of the clinic's public materials (website copy, FAQs, treatment protocols) against RRM Academy editorial rules.
- **Gets:** Partner benefits, plus "Accredited by RRM Academy" seal, priority directory ranking, co-marketing opportunities.
- **Gives:** Annual editorial renewal, commitment to refer patients to Academy education, quarterly content contribution.

Whittaker AI managed services: separate commercial product. Accredited partners may receive a preferred rate, but accreditation is NOT tied to purchasing Whittaker AI services.

## 3. The four principles (Friend tier affirmation)

Applicants affirm all four:

1. **FABM-informed diagnosis.** Fertility awareness-based methods are used for cycle tracking, diagnosis, and protocol design, including evaluation of male-factor contributors.
2. **Excision over ablation when surgery is indicated.** When endometriosis surgery is indicated, surgical excision is preferred over ablation. Clinics may take a medical-first approach to endometriosis management; this principle applies only to surgical choice.
3. **RRM as primary path.** Restorative reproductive medicine is offered as the primary fertility pathway. IVF is not promoted as a first-line option.
4. **Patient education as standard of care.** Patients are taught to understand their own cycles, symptoms, and treatment rationale.

Friend tier is self-attested. An applicant who later misrepresents alignment loses the designation.

## 4. Canonical tagline language

Permitted phrasings for Friends (choose one; rotate naturally, do not use all on one site):

- "Educational partner of RRM Academy"
- "Proud educational partner of RRM Academy"
- "[Clinic Name] is an educational partner of RRM Academy"
- "Learn more about restorative reproductive medicine at RRM Academy"
- "[Clinic Name] partners with RRM Academy on patient education"

**Link target:** `https://rrmacademy.org/partners/` ONLY. Partners must not link back to pillar pages (`/naprotechnology/`, `/what-is-rrm/`, etc.) or to the homepage using branded anchors. Deep-linking from many partner sites with controlled anchors is the fingerprint of a link scheme.

**Permitted anchor text (rotate for variety across partner sites):**

- "RRM Academy"
- "restorative reproductive medicine"
- "learn more at RRM Academy"
- "[Clinic] educational partner page"
- `https://rrmacademy.org/partners/` (naked URL)

**Placement:** Footer or About section, not hero/homepage above the fold.

**Prohibited phrasings:**

- "Accredited by RRM Academy" (reserved for Accredited tier)
- "Certified by RRM Academy"
- "In partnership with RRM Academy" (implies business relationship)
- "Managed by RRM Academy" (implies operational control)
- Any phrasing that implies clinical oversight or endorsement of specific treatments

## 5. /partners/ page IA

Single page at `https://rrmacademy.org/partners/`. Structure:

- **Direct-answer opener (25-35 words):** One-sentence definition at the top of the page so LLMs and AI Overviews can cite it cleanly. Example: "An RRM Academy Educational Partner is a clinic or organization that publicly affirms the principles of restorative reproductive medicine and agrees to a defined alignment standard."
- **Hero:** Program purpose in one paragraph (Whittaker voice).
- **Three-tier overview:** Friend (active), Partner (coming soon), Accredited (coming soon). Shows the direction even though only Friend is live.
- **Principles affirmation:** The four principles, displayed as a visible standard so patients understand what the badge means.
- **Friend partners listing:** Card per partner with clinic name, location, short blurb (1-2 sentences), site link (rel="external", follow), primary RRM provider name with directory link if they have one. Wrapped in `ItemList` JSON-LD for AEO.
- **Apply CTA, application form.**
- **FAQ (three questions, 80-120 words each, rendered as `FAQPage` JSON-LD for AEO citation):**
  - "What is an RRM Academy Educational Partner?" Canonical definition, longer form than the direct-answer opener, covers what alignment means.
  - "How is a Friend partner different from an Accredited clinic?" Explains the tier structure and why editorial review exists at the Accredited level.
  - "Does RRM Academy endorse the clinical practice of its partners?" Clarifies that Friend tier is principle-affirmation, not endorsement of specific treatments or outcomes.
- **Partner asset kit:** Download links for badge SVG, logo guidelines, tagline rules PDF.

No individual partner detail pages in MVP. Revisit when the Friend list exceeds ~10 partners.

## 6. Application & approval flow

1. **Apply.** Applicant submits form at `/partners/apply/`. Fields:
   - Clinic/organization name
   - Public website URL
   - Country + city
   - Primary RRM provider name + credential (NPI for US, professional registration number otherwise)
   - Affirmation checkboxes (one per principle, all four required)
   - Contact email
   - Notes (optional free text)

2. **Pending.** Form writes to D1 `partners` table with `status = 'pending'`.

3. **Review.** Admin dashboard shows pending applications. Brian reviews manually: confirms the clinic exists, confirms the named provider exists, spot-checks the public website against a fixed red-flag checklist. No deep editorial review at Friend tier. **Friend-tier rejection red flags (any one is grounds for rejection):**
   a. IVF promoted as first-line fertility option on a primary landing page (homepage, services index, fertility overview).
   b. Hormonal suppression framed as curative for endometriosis (rather than symptom management).
   c. Charting or FABM dismissed or absent from diagnostic workflow.
   d. Public materials explicitly recommend donor gametes or surrogacy as primary paths.
   e. Provider named on the application cannot be verified as practicing at the clinic.

4. **Approve or reject.**
   - **Approve:** `status = 'active'`, `approved_at = now`. Partner appears on `/partners/` at next build. Welcome email sent with asset kit link, tagline rules, and thank-you.
   - **Reject:** `status = 'rejected'`. Rejection email sent with reason.

5. **Revoke.** Admin can flip `status = 'revoked'` at any time with a reason in notes. Partner disappears from `/partners/` at next build. Revoked partner is emailed notice and asked to remove the tagline within 14 days. No public shaming; the record is just gone.

## 7. Data model

New D1 table on `rrm-auth` database (not `rrm-library`, since this is operational data, not research):

```sql
CREATE TABLE partners (
  id TEXT PRIMARY KEY,              -- recXXX format, matches existing convention
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,        -- URL-safe, auto-derived from name
  site_url TEXT NOT NULL,
  country TEXT NOT NULL,
  city TEXT,
  provider_name TEXT NOT NULL,
  provider_credential TEXT NOT NULL,   -- NPI or professional registration
  provider_directory_id TEXT,           -- FK to practitioner directory if listed
  blurb TEXT,                           -- 1-2 sentence description for /partners/
  affirmations TEXT NOT NULL,           -- JSON: { "fabm_diagnosis": true, "excision_over_suppression": true, ... }
  contact_email TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'friend', -- 'friend' | 'partner' | 'accredited'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'active' | 'rejected' | 'revoked'
  notes TEXT,                           -- admin notes, rejection/revocation reason
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX idx_partners_status ON partners(status);
CREATE INDEX idx_partners_slug ON partners(slug);
```

**Build-time fetch:** New script `src/lib/fetch-partners-data.mjs` pulls `status = 'active'` rows via a `GET /api/partners` endpoint (auth-gated with build token), writes to `src/data/partners.json`, Astro renders at build time.

**CI regression guard:** Add `partners` to `.baselines.json` (min 0 at MVP launch, climbs with each approved partner; max drop = 1 to catch accidental deletions).

## 8. SEO & structured data

- **`/partners/` page schema stack (all JSON-LD):**
  - `CollectionPage` as the top-level page type.
  - `EducationalOrganization` (with `additionalType: "NGO"`) for RRM Academy, with `subOrganization` references to each active Friend.
  - Each Friend is typed `MedicalOrganization` (clinics are medical orgs, not generic orgs).
  - `ItemList` wrapping the partner cards, with `position` set per card.
  - `FAQPage` for the three `/partners/` FAQ entries (see §5).
  - `BreadcrumbList` via existing BaseLayout pattern (verify during build).
- **Partner profile (from their side):** Partner asset kit includes a recommended JSON-LD snippet: `MedicalOrganization` on the partner's site with `memberOf` pointing to RRM Academy's canonical `EducationalOrganization` entity.
- **Internal linking:** `/partners/` linked from:
  - Footer globally
  - About page
  - `/naprotechnology/` and `/what-is-rrm/` pillar guides ("find aligned clinicians")
  - `/find-a-provider/` (most topically relevant surface)
  - Commentary posts via "find aligned clinicians" CTAs where contextually appropriate
- **Sitemap:** `/partners/` added to `sitemap.xml`. `lastmod` is generated dynamically from `max(approved_at)` across active partners in `partners.json`, so the page re-enters Google's crawl priority when partners are added. Submit `/partners/` to GSC via URL Inspection on first publish.
- **rel attribute on outbound partner links:** `rel="external"` only. Do not use `nofollow`; these are editorial links, not sponsored.
- **No individual partner detail URLs in MVP.**

## 9. Visual / branding

Handled by frontend-design skill during build phase. Assets required:

- **Partner badge:** SVG. Two orientations (stacked, horizontal). Two color modes (light-bg, dark-bg). Sized 200px wide default, scales cleanly.
- **Asset kit page:** Downloadable ZIP containing badges + `tagline-rules.md` + `logo-usage.pdf`.
- **Colors:** RRM Academy brand palette (per `STYLE-GUIDE.md`).
- **Wordmark:** RRM Academy logo per existing brand standards. No new logo for the program itself.

## 10. Admin dashboard

Extends existing admin dashboard at `/admin/`:

- New section: "Educational Partners"
- List view: all applications, filterable by status
- Detail view: full application data, public-site spot-check links (rendered against the §6 red-flag checklist), approve/reject/revoke actions

**Audit logging is deferred to v2.** MVP stores `approved_at`, `revoked_at`, and free-text `notes` on the partner record. A dedicated `partner_audit_log` table lands with the Partner/Accredited tier workflow.

API endpoints (CF Pages Functions):

- `POST /api/partners/apply`: public, captcha-gated, creates pending record
- `GET /api/partners`: public, build-token-gated, returns active records for build
- `GET /api/admin/partners`: admin-scoped, returns all records
- `POST /api/admin/partners/[id]/approve`: admin-scoped
- `POST /api/admin/partners/[id]/reject`: admin-scoped, requires reason
- `POST /api/admin/partners/[id]/revoke`: admin-scoped, requires reason

## 11. Deferred to v2 (not built in MVP)

- Partner tier: directory gating, content contribution pipeline, affiliate revenue share, quarterly spotlight.
- Accredited tier: editorial review rubric, annual renewal workflow, accredited seal, audit logging of reviews.
- Whittaker AI preferred rate for Accredited: separate commercial decision.
- Individual partner detail pages: revisit at 10+ partners.
- Public "report a concern" form: revisit if misuse becomes real.

## 12. Launch sequence

1. Build Friend-tier program as specified.
2. Onboard NeoFertility.ie as charter partner #1 (manual record creation, skip the form).
3. NeoFertility.ie deploys footer tagline pointing to `/partners/`.
4. `/partners/` page goes live with NeoFertility listed.
5. Announce via RRM Academy blog post + email + social.
6. Open application form to public.

## 13. Success criteria

**MVP is successful if:**

- `/partners/` is live with NeoFertility.ie listed as charter Friend.
- NeoFertility.ie footer displays the canonical tagline linking back.
- Application form accepts new submissions and routes them to admin review.
- Admin can approve/reject/revoke without touching D1 directly.
- No tier confusion: every public surface is clear that Friend = self-attested, not editorial endorsement.

**Program is successful (6-month horizon) if:**

- 5+ active Friend partners listed.
- At least 3 of them send referral traffic to rrmacademy.org.
- At least 1 has expressed interest in moving to Partner tier (signaling v2 is worth building).
