# Google Ad Grants — Website Policy Audit + Conversion-Tracking Verification

- **Site:** https://rrmacademy.org
- **Grant account:** 426-226-8858 (`4262268858`)
- **Date:** 2026-07-16
- **Method:** deterministic scout (curl/PSI/HTML signals) + 6-dimension adversarially-verified fan-out audit (18 agents), plus an independent end-to-end conversion-tracking trace and a live Data Manager `validateOnly` smoke test.

---

## Verdict

**Likely to pass re-review. Zero confirmed website-policy violations survived adversarial verification.** Mission is clear, nonprofit identity is fully disclosed, content is deep and original, there are no ad-network tags or affiliate links, and the commerce path is on-site and mission-aligned. The single most likely reviewer-flag surface is not on-page content at all but the **unmeasured real-device mobile experience** (only a proxy speed check ran today; PSI quota was exhausted).

## Ranked punch-list (zero blockers)

There are **zero blockers and zero confirmed website-policy violations.** Residual reviewer-concern / account-hygiene items only:

1. **Mobile speed — RESOLVED [pass].** Live Google Lighthouse v13.0.1 mobile test via Cloudflare Observatory (Iowa node), 2026-07-16T23:31Z: **performance score 88/100** (`categories.performance.score = 0.88`, verified against the raw Cloudflare-hosted Lighthouse JSON). FCP 1.3s (green), LCP 1.9s (green), CLS 0 (green), Speed Index 2.2s, TTI 3.7s, TBT 470ms (the only sub-90 metric, from inline scripts). No Ad Grants speed concern. Test id `59a2aca1-d46e-421f-a5ac-e3b0aa5cb208` (viewable in CF dashboard → Speed/Observatory).
2. **`/ask/` AI tool page is thin (171 words)** [low/high] — but it carries `<meta name="robots" content="noindex,nofollow">`, so it is off the indexed/landing surface. **Fix:** none needed; never point an ad or sitelink at `/ask/`.
3. **Commercial-purpose optics from paid courses** [low/high] — `/courses/`: 3 paid ($19 / $199 / $1200) vs 10 free, on top of an entirely free library/guides/glossary/FAQs/quiz/tools. Overwhelmingly free and mission-related. **Fix:** none needed; keep ad landing pages pointed at free educational URLs, not checkout.

## Confirmed compliant

- **No ad-network tags:** zero `adsbygoogle|pagead2|googlesyndication|doubleclick|ca-pub-` anywhere.
- **No affiliate/referral params** on any enroll/buy link; only clean external vendor/partner homepages.
- **On-site checkout:** first-party Stripe (`/api/courses`, `/account`), no off-site cart.
- **Mission clarity:** homepage hero defines RRM; "A project of the Restorative Reproductive Medicine Foundation, a 501(c)(3) nonprofit (EIN 93-4594315)."
- **Nonprofit identity + trust:** sitewide footer discloses 501(c)(3), legal entity "Restorative Reproductive Medicine Foundation Inc.," EIN 93-4594315, address 3401 Hartzdale Dr Ste 103B PMB 3518, Camp Hill, PA 17011; About page names board + Candid seal.
- **Deep original content:** PCOS ~4,500w, Isthmocele ~8,500w, TwoDay 2,202w, Boston Cross-Check 2,425w, ART Registries 7,643w; 22 pillar guides, 25 commentary posts; no thin indexed page found.
- **Legal pages live:** Privacy Policy (Effective June 26, 2026) + Terms of Use, both 200 with substantive content.
- **Working contact:** `contact@rrmacademy.org`, mailing address, functional form.
- **Links healthy:** all nav/footer/content internal paths 200; only a benign `/ask`→`/ask/` trailing-slash 301.
- **No misleading/prohibited claims:** condition pages disclaim cure/guarantee; self-assessment states "This is not a diagnosis"; every page carries a consult-a-provider disclaimer; efficacy figures cited to named studies.
- **Technical:** HTTPS enforced + HSTS (max-age 31536000, preload), HTTP 200 sitewide, Brotli, strong CSP, viewport meta, self-hosted fonts.

## Do this before re-submitting

1. **Mobile speed — DONE.** Live Cloudflare Observatory Lighthouse v13.0.1 mobile = **88/100** (2026-07-16). Optionally spot-check the top 3 ad landing pages the same way, but the homepage passes.
2. **Confirm SSL sitewide** (account-level; already observed HTTPS-enforced with 200s; verify no mixed-content on ad landing pages).
3. **Point ads/sitelinks only at free educational URLs** (guides, library, FAQs, tools) — never `/ask/` or course checkout.
4. **Account-level structure** (separate from website policy; common false-positive cause): ≥1 campaign with an ad group of 2+ active ads, 2+ sitelinks, valid geo-targeting. — *Verified present as of this audit (Brand/Endo campaigns each carry 2+ ads/group + sitelinks + US geo).*
5. **Conversion tracking** — *Verified working; see addendum below. This box is checked.*
6. **If denied then reversed to "activated" within ~an hour, treat it as an automated false-positive** — do not change the site; only act on a denial that persists past the automated recheck.

---

## Addendum — Conversion-tracking verification (2026-07-16)

The audit's generic "enable conversion tracking" reminder is superseded by an independent end-to-end verification done the same day. Conversion tracking is **built, deployed, and live**; the account's 0 conversions are a traffic/funnel fact, not a tracking failure.

| Layer | Status | Evidence |
|-------|--------|----------|
| **Front — gclid capture** | ✅ live | `BaseLayout.astro:264-275` sets a 30-day gclid cookie sitewide; the capture script (`new URLSearchParams(location.search).get('gclid')` + cookie set) is confirmed present in the freshly-fetched production homepage HTML. |
| **Middle — trigger** | ✅ wired | `functions/api/_google-ads.js` fires `sendGoogleAdsConversion` via `waitUntil` after a successful D1 write, on all three endpoints: `newsletter/subscribe.js:133`, `quiz/request.js:191`, `endo-quiz/request.js:160`. Reads the gclid cookie server-side (validated regex). |
| **Back — Google acceptance** | ✅ 200 today | Live `validateOnly` Data Manager `events:ingest` smoke test returned **HTTP 200** (`requestId v-bc53588c-...`) for account `4262268858`, Endo action `7671519551`, production request shape. Nothing recorded. |

**Conversion action IDs (type UPLOAD_CLICKS, all ENABLED + primary):** Newsletter `7671519545`, FABM Quiz `7671519548`, Endo Quiz `7671519551` — all match the deployed code.

**Root cause of 0 conversions:** no ad-attributed completion has happened yet (`quiz_result` = 0 rows all-time; no `source='ads'` rows). Traffic is thin (FABM was dark ~12 days until 2026-07-15; Endo is new). The pipeline will upload automatically once a real ad click reaches a quiz/newsletter completion. **Action is traffic/volume, not code.**

**One residual (low risk):** the specific CF Pages `GOOGLE_ADS_*` secrets could not be re-listed today (no `CLOUDFLARE_API_TOKEN` in the audit shell). They were confirmed present with a 200 smoke test on 2026-07-13, the code is deployed on `main`, and a datamanager-scoped token was proven working today.
