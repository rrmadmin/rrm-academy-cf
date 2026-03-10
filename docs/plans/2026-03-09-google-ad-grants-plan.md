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
- [x] At least 2-3 fresh blog posts published (4 posts Feb 14 - Mar 6, plus 4th in progress)
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

## Traffic Analytics (Wix, Mar 2025 - Mar 2026)

Baseline traffic data from the Wix site before full migration to Astro/Cloudflare. Use this to inform Ad Grants campaign strategy and keyword selection.

### Top 20 Pages by Sessions

| Page | Sessions | Uniques | Notes |
|---|---|---|---|
| `/` (homepage) | 6,096 | 4,372 | Brand + organic entry point |
| `/3-tier-endometriosis-symptom-self-survey` | 4,912 | 4,099 | Mostly IG direct (Naomi's 625k+ following). Proves massive demand |
| `/my-files/...` (downloads) | 2,990 | 2,422 | Course materials / PDF downloads |
| `/post/naprotechnology-surgery-...` | 2,135 | 1,480 | Top organic blog post by far |
| `/library` | 1,977 | 1,214 | Strong organic interest in research |
| `/post/rrm-spotlight-naomi-whittaker-md` | 1,298 | 1,075 | People search for Naomi by name |
| `/course/masterclass-in-endometriosis-and-surgery` | 1,139 | 900 | Top course page |
| `/course/rrm-vs-ivf` | 1,055 | 809 | High-intent searchers comparing approaches |
| `/courses` | 1,003 | 739 | Course catalog browse intent |
| `/save-the-uterus-club` | 753 | 535 | Membership/donation page |
| `/post/rrm-spotlight-patrick-p-yeung-jr-md` | 450 | 300 | Physician search |
| `/about` | 386 | 293 | |
| `/commentary` | 385 | 217 | Blog index |
| `/course/long-term-endometriosis-management` | 374 | 310 | Second most popular course |
| `/post/rrm-explained-...` | 239 | 180 | Educational explainer |
| `/post/understanding-endometriosis-...` | 209 | 141 | Endo awareness content |
| `/post/glossary-of-rrm` | 191 | 130 | Reference/educational |
| `/contact` | 190 | 158 | |
| `/search` | 165 | 118 | People actively searching the site |
| `/plans-pricing` | 155 | 143 | Pricing intent |

### Traffic by Source (12 months)

| Source | Sessions | Uniques | Notes |
|---|---|---|---|
| Direct | 14,692 | 10,614 | Bookmarks, typed URLs, IG bio links |
| Instagram | 6,936 | 6,240 | Naomi's 625k+ following. Primary social driver |
| Google | 6,891 | 5,881 | Organic search. This is what Ad Grants amplifies |
| Facebook | 1,691 | 1,329 | Organic social shares |
| linkinbio.rrmacademy.org | 1,229 | 1,146 | IG link-in-bio referrals |
| DuckDuckGo | 705 | 348 | Privacy-focused searchers |
| byitsfruit.org | 445 | 377 | Referral partner |
| Bing | 416 | 365 | |
| Twitter | 122 | 112 | |
| ChatGPT | 68 | 62 | AI referral traffic already happening |

### Top Pages by Google Organic Only

These are the pages Google already sends traffic to. Ad Grants campaigns should amplify these proven winners.

| Page | Google Sessions | Google Uniques |
|---|---|---|
| NaPro surgery blog post | 1,169 | 995 |
| Homepage | 966 | 798 |
| Naomi Whittaker spotlight | 880 | 760 |
| Research Library | 359 | 311 |
| Endo Self-Survey | 313 | 274 |
| Yeung spotlight | 269 | 209 |
| Courses index | 244 | 192 |
| Endo Masterclass (course) | 163 | 134 |
| RRM vs IVF (course) | 107 | 88 |
| Long-term Endo Management (course) | 104 | 93 |
| RRM Explained post | 102 | 85 |
| Understanding Endometriosis post | 101 | 69 |
| About | 100 | 94 |
| Phil Boyle spotlight | 92 | 81 |
| Commentary index | 51 | 46 |
| PCOS personal journey post | 36 | 35 |
| Edinburgh PPD scale (library) | 34 | 19 |
| Endo symptom survey (old URL) | 31 | 30 |
| PPD course | 24 | 19 |

### Notable Long-Tail Library Pages

Individual library articles getting organic search traffic (15-58 sessions each):
- COVID + conception study (58 sessions)
- Edinburgh postnatal depression scale (46)
- Creighton Model picture dictionary (45)
- Isthmocele surgical treatment (17)
- NaProTechnology and conscientious OBGYN (17)
- Luteinized unruptured follicle syndrome (23)
- Male infertility (15)

### Campaign Strategy Analysis

**What the data tells us:**

1. **Google organic is already the #3 traffic source at 6,891 sessions.** Ad Grants amplifies exactly this channel. Even a modest 2x lift from paid search = 13,000+ additional sessions/year for free.

2. **NaPro surgery blog post gets 1,169 sessions from Google alone** -- by far the top organic page. People are searching for NaPro surgical options. This validates Campaign 3 (Courses) keywords.

3. **Naomi Whittaker spotlight gets 880 Google sessions.** People search for her by name. Brand campaign (Campaign 4) will capture this with 15-30% CTR, anchoring the account average above 5%.

4. **Endo survey gets 313 Google sessions organically** plus 2,281 from IG. Search demand exists independently of IG -- "endometriosis symptom quiz" and "do I have endometriosis" are proven keywords. Ad Grants will add incremental volume.

5. **Course pages collectively get 638 Google sessions** (masterclass 163, RRM vs IVF 107, long-term endo 104, courses index 244). High-intent, low-competition keywords.

6. **Research library gets 359 Google sessions** plus strong referral traffic from byitsfruit.org (445 sessions). Clinicians and researchers are finding the library organically.

7. **Postpartum is an underserved opportunity.** PPD course (24 Google), PPD blog post (63 from linkinbio), Edinburgh scale library article (34 Google). Small but consistent demand with room to grow.

8. **ChatGPT already sends 68 sessions.** AI referral traffic is real and growing. AEO/GEO work compounds on top of Ad Grants.

### Recommended Campaign Updates (based on data)

**Campaign 5: Postpartum (NEW)**
- Ad groups: PPD recovery seekers, postpartum anxiety
- Keywords: "postpartum depression natural treatment", "postpartum anxiety recovery without medication", "postpartum depression help"
- Landing page: /courses/postpartum-depression-anxiety/

**Negative keywords to add across all campaigns:**
- "near me", "cost", "insurance", "free IVF", "IVF success rates", "IVF clinic"
- "reddit", "forum", "facebook group" (low conversion intent)
- "salary", "job", "hiring" (wrong audience)

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
