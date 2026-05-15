# UTM Conventions for RRM Academy

Source of truth for every link to rrmacademy.org that originates from email, social, partners, or paid placements. Enforced by gate **AG6** in `scripts/gates/validate-analytics-pipeline.mjs`.

**Rule of thumb:** lowercase, underscores not hyphens, no spaces, ASCII only, sortable dates.

If you're tempted to capitalize a campaign name "for readability" — don't. GA4 treats `Newsletter_May_2026` and `newsletter_may_2026` as different sources. The dashboard will lie to you.

## The five UTM params

| Param | What it answers | Always required? |
|---|---|---|
| `utm_source` | Where did they come from? | Yes |
| `utm_medium` | Which channel category? | Yes |
| `utm_campaign` | Which specific campaign? | Yes for marketing; no for transactional |
| `utm_content` | Which variant / placement? | Optional |
| `utm_term` | Which keyword? (legacy paid-search slot) | Optional |

## Templates by channel

### Email — newsletter broadcast

Use for the monthly newsletter, ad-hoc broadcasts, and announcements sent to the whole list.

```
?utm_source=email
&utm_medium=newsletter
&utm_campaign=newsletter_monthly_2026-05
```

Add `&list_source=…` when the recipient was originally captured via a non-default form (endo-survey signup, course page, paywall, etc.). The `list_source` value is not a UTM — it's a separate query param that BaseLayout captures into a 30-day cookie and `_ga4-source.js` forwards as a GA4 custom dimension.

```
?utm_source=email
&utm_medium=newsletter
&utm_campaign=newsletter_monthly_2026-05
&list_source=endo_survey_signup
```

### Email — automation / drip / nurture

Use for onboarding sequences, course drips, abandoned-cart, re-engagement sequences. Anything triggered by user behavior rather than a manual send.

```
?utm_source=email
&utm_medium=email_automation
&utm_campaign=onboarding_signup_step_2
```

Always include the step number in the campaign name (`step_1`, `step_2`, …). The funnel analysis depends on it.

### Email — transactional

Use for receipts, password resets, course enrollment confirmations, donation receipts. These aren't marketing but they DO carry traffic back to the site and we want to attribute that.

```
?utm_source=email
&utm_medium=email_transactional
&utm_campaign=donation_receipt
```

```
?utm_source=email
&utm_medium=email_transactional
&utm_campaign=course_enrollment_confirm
```

```
?utm_source=email
&utm_medium=email_transactional
&utm_campaign=password_reset
```

### Instagram — bio link

Use the same source for the bio link and any custom-domain bio aggregator.

```
?utm_source=instagram
&utm_medium=social
&utm_campaign=bio_link_napro_fertility_surgeon
```

### Instagram — story or post

```
?utm_source=instagram
&utm_medium=social
&utm_campaign=ig_story_endo_awareness_2026-05
&utm_content=story_swipe_up
```

`utm_content` distinguishes story vs feed vs reel vs DM.

### External press / partner referrals

`utm_source` is the publication or partner (slugified):

```
?utm_source=acog_blog
&utm_medium=referral
&utm_campaign=press_acog_napro_overview_2026-05
```

### Paid (when ads start)

```
?utm_source=google
&utm_medium=cpc
&utm_campaign=google_ads_endo_surgery_2026-q2
&utm_content=ad_variant_a
&utm_term=endometriosis_surgery
```

## Hard rules (enforced by gate AG6)

1. **All lowercase.** `utm_campaign=Newsletter_Monthly_May_2026` is wrong.
2. **Underscores, not hyphens.** `newsletter-monthly` is wrong; `newsletter_monthly` is right. (Some platforms force-lowercase or strip hyphens, breaking attribution. Underscores are safe.)
3. **No spaces.** Spaces become `+` or `%20` and break filters in GA4 Explorations.
4. **ASCII only.** No em-dashes, smart quotes, or accented characters in UTM values.
5. **Dates in `YYYY-MM` or `YYYY-MM-DD`.** Always sortable; never `may_2026` or `2026_may`.
6. **No PII.** Don't put a user's email, name, or ID in a UTM. (Why anyone would, idk, but the gate will catch it via PII_REGEX in the endpoint.)
7. **No leading slashes or query separators inside values.** A campaign value should be a single token, not a path.

## list_source values (non-UTM)

`list_source` captures *where the subscriber was originally acquired* — not where this particular email link came from. Use these canonical values; add new ones to this doc when needed.

| Value | Meaning |
|---|---|
| `homepage` | Footer/header newsletter signup on `/` |
| `endo_survey_signup` | Captured during the endo-survey flow |
| `course_page` | Newsletter prompt on a course page (specific course = utm_content) |
| `library_article` | Newsletter prompt on a library article |
| `commentary_post` | Newsletter prompt on a commentary post |
| `pillar_page` | Newsletter prompt on a pillar guide |
| `stuc_signup` | Joined STUC and opted into newsletter as part of that flow |
| `donation_flow` | Opted into newsletter during a donation |
| `import_2024_q4` | Bulk-imported during the 2024 Q4 migration |
| `referral_form` | "A friend sent me here" form (if/when built) |

The `list_source` value should be set once when the subscriber is created (in `newsletter_subscriber` schema), then appended to every outbound email link from that subscriber's record. Saves a lot of "where did our best donors actually come from?" debugging later.

## Email-link generation

When generating a transactional email body:

1. Always include the three required UTMs on every link to rrmacademy.org.
2. Pull `list_source` from the recipient's `newsletter_subscriber` record and append it to every link.
3. For broadcast emails (newsletter monthly), use the same `utm_campaign` across every link in that send. Use `utm_content` to distinguish position within the email (`utm_content=header_image`, `utm_content=cta_button`, `utm_content=footer_link`).

## Examples

**Wrong:**
```
https://rrmacademy.org/donate/?utm_source=Email&utm_medium=Newsletter&utm_campaign=May Newsletter
```
- `Email` (capitalized)
- `May Newsletter` (space, capitalized, non-sortable date)

**Right:**
```
https://rrmacademy.org/donate/?utm_source=email&utm_medium=newsletter&utm_campaign=newsletter_monthly_2026-05&list_source=endo_survey_signup
```

## When in doubt

Run the link through the gate locally:
```bash
echo 'https://rrmacademy.org/donate/?utm_source=email&utm_medium=newsletter&utm_campaign=newsletter_monthly_2026-05' \
  | grep -oE 'utm_[a-z_]+=[^"&]+'
```
Eyeball the values. Lowercase + underscores + ASCII + no spaces = ship it.

## Why this matters

CXL puts it best (paraphrased): *"UTM tags are your source of truth. If people freestyle them, your data is garbage."* The 30 seconds it takes to read this doc once saves weeks of "why does the dashboard show three different email sources for the same campaign" later.
