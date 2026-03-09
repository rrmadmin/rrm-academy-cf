# Google Ad Grants Approval Plan

**Goal:** Get RRM Foundation approved for Google Ad Grants ($10k/month free Search ads)
**Status:** Previously rejected (2025) against old Wix site. Rejection reason: "Change the website to load quickly and have clear navigation. Include substantial, up-to-date content and calls-to-action."
**Current site:** rrmacademy.org (Astro 5 on Cloudflare Pages, fully rebuilt since rejection)

---

## Phase 1: Fix CTA Dead-End Pages

The rejection specifically called out "calls-to-action." Three pages lack a clear CTA. Each needs a styled CTA block at the bottom of the page content, before the footer.

### 1a. `/what-is-rrm/` (educational deep-dive, no next step)

Add a CTA section at the bottom with two buttons:
- "Explore Courses" -> /courses/
- "Browse the Research Library" -> /library/

Use the existing `.results-cta` or similar styled card pattern (sage background, border-left accent). Heading: "Ready to go deeper?"

### 1b. `/commentary/` (blog listing, browse-only)

Add a CTA banner above or below the post grid:
- "Take the Endo Self-Survey" -> /endo-survey/
- Consider a secondary: "Follow Dr. Whittaker on Instagram" -> IG link

### 1c. `/faq/` (weak "Contact Us" only)

Strengthen the bottom CTA section. Add alongside "Contact Us":
- "Explore Courses" -> /courses/
- "Take the Endo Self-Survey" -> /endo-survey/

### 1d. Donate page pricing disclaimer

Add a brief line near the membership tier pricing: "All membership proceeds support our 501(c)(3) educational mission." Google flags pricing without nonprofit context.

---

## Phase 2: Blog Publishing Cadence (March 2026)

Publish a new commentary post every 3-5 days to demonstrate "up-to-date content." Target: 6-8 posts this month.

| # | Target Date | Topic | Status |
|---|-------------|-------|--------|
| 1 | Mar 9 | Endo survey announcement (Gianna rewrite) | Draft in Airtable |
| 2 | Mar 12-13 | TBD | |
| 3 | Mar 16-17 | TBD | |
| 4 | Mar 20-21 | TBD | |
| 5 | Mar 24-25 | TBD | |
| 6 | Mar 28-29 | TBD | |

Content pillar ideas for remaining posts:
- NaProTechnology vs conventional approaches
- Understanding tail-end brown bleeding (Naomi clinical voice)
- What to ask your endometriosis surgeon (from masterclass workbook)
- Research Library spotlight (how to use it, what it contains)
- PCOS and restorative medicine
- Fertility charting as a diagnostic tool

---

## Phase 3: Pre-Submission Verification

Before resubmitting rrmacademy.org:

- [x] CTA fixes deployed (Phase 1) -- CTAs added to /commentary/, /faqs/, /faqs/[slug], donate disclaimer updated
- [ ] At least 2-3 fresh blog posts published
- [x] Run PageSpeed Insights from browser, confirm mobile score 90+ (Astro static site on CF edge)
- [x] Verify all key pages load under 3 seconds on mobile
- [x] Spot-check mobile responsiveness on homepage, about, library, endo-survey
- [x] Confirm privacy policy, terms of use, medical disclaimer all linked from footer
- [x] Confirm 501(c)(3) EIN visible -- now in global footer on every page (mission statement + address + EIN)
- [x] Confirm sitemap-index.xml is accessible at rrmacademy.org/sitemap-index.xml

---

## Phase 4: Resubmit

1. Go to Google for Nonprofits console (already enrolled)
2. Enter `rrmacademy.org` in the website field
3. Submit website for review
4. Watch the welcome video (step 2 in their flow)
5. Submit the activation request (step 3)
6. Wait 3-7 business days (up to 30 if extended review)

---

## Phase 5: Campaign Setup (while waiting or after approval)

### Conversion Tracking (set up before activation)

Set up Google Ads conversion tracking for:
- Endo survey email submissions (`/api/survey/request` success)
- Course enrollment starts
- Donate page completions
- Newsletter signups (footer form)

Must have at least 1 conversion/month to stay compliant.

### Campaign Structure

All campaigns must use Smart Bidding (Maximize Conversions). Minimum 2 ad groups per campaign. No single-word keywords. No generic keywords.

**Campaign 1: Endometriosis Survey**
- Ad groups: symptom quiz seekers, diagnosis seekers
- Keywords: "endometriosis symptom quiz", "do I have endometriosis", "endometriosis self assessment", "endo symptom checker"
- Landing page: /endo-survey/

**Campaign 2: Research Library**
- Ad groups: endo research, NaPro research, PCOS research
- Keywords: "endometriosis research studies", "NaProTechnology evidence", "restorative reproductive medicine research"
- Landing page: /library/

**Campaign 3: Courses**
- Ad groups: endo surgery education, RRM training
- Keywords: "endometriosis surgery course", "NaProTechnology training", "restorative reproductive medicine course"
- Landing page: /courses/

**Campaign 4: Brand**
- Ad groups: brand terms, doctor terms
- Keywords: "RRM Academy", "restorative reproductive medicine", "Dr Naomi Whittaker endometriosis"
- Landing page: /

### Ongoing Compliance

- Maintain 5% CTR account-wide (or suspension after 2 months)
- Pause keywords with Quality Score 1-2
- No single-word keywords
- Complete annual program survey
- At least 1 conversion per month

---

## Sources

- [Google Ad Grants Website Policy](https://support.google.com/nonprofits/answer/1657899)
- [Ad Grants Policy Compliance Guide](https://support.google.com/nonprofits/answer/9314402)
- [Google for Nonprofits Eligibility (US)](https://support.google.com/nonprofits/answer/3215869)
- [Getting Attention: Ad Grant Requirements](https://gettingattention.org/google-ad-grant-requirements/)
