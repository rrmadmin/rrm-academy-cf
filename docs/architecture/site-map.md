<!-- Extracted from CLAUDE.md 2026-07-20 (context-size offload). This file is the live inventory: keep it updated exactly as the old in-CLAUDE.md section was. -->

## Site Map

100 `.astro` pages under `src/pages/` + 2 function-served page routes. Full inventory (last synced 2026-07-02 — when adding a page, add its row here):

**Core & legal**

| Route | File |
|-------|------|
| `/` | `src/pages/index.astro` |
| `/about` | `src/pages/about.astro` |
| `/contact` | `src/pages/contact.astro` (form + Turnstile) |
| `/press` | `src/pages/press/index.astro` (press & media kit) |
| `/terms-of-use` | `src/pages/terms-of-use.astro` |
| `/privacy-policy` | `src/pages/privacy-policy.astro` |
| `/medical-disclaimer` | `src/pages/medical-disclaimer.astro` |

**Auth & account**

| Route | File |
|-------|------|
| `/login` | `src/pages/login.astro` |
| `/signup` | `src/pages/signup.astro` |
| `/account` | `src/pages/account/index.astro` (auth required) |
| `/account/mcp-keys` | `src/pages/account/mcp-keys.astro` (auth; issue/revoke MCP API keys) |
| `/forgot-password` | `src/pages/forgot-password.astro` |
| `/reset-password` | `src/pages/reset-password.astro` |

**Library**

| Route | File |
|-------|------|
| `/library` | `src/pages/library/index.astro` |
| `/library/[slug]` | `src/pages/library/[...slug].astro` |
| `/library/page/[page]` | `src/pages/library/page/[page].astro` |
| `/library/topics` | `src/pages/library/topics/index.astro` (topic-hub directory) |
| `/library/topics/[slug]` | `src/pages/library/topics/[slug].astro` (per-topic article hub) |
| `/saved/` | `src/pages/saved/index.astro` (universal saved pages, tabbed by type; legacy `/library/saved` 301s here via `public/_redirects`) |

**Commentary**

| Route | File |
|-------|------|
| `/commentary` | `src/pages/commentary/index.astro` |
| `/commentary/[slug]` | `src/pages/commentary/[...slug].astro` |
| `/commentary/page/[page]` | `src/pages/commentary/page/[page].astro` |

**FAQs**

| Route | File |
|-------|------|
| `/faqs` | `src/pages/faqs.astro` |
| `/faqs/[slug]` | `src/pages/faqs/[...slug].astro` |

**Courses**

| Route | File |
|-------|------|
| `/courses` | `src/pages/courses/index.astro` |
| `/courses/[slug]` | `src/pages/courses/[slug].astro` |
| `/courses/[slug]/[stepId]` | `src/pages/courses/[slug]/[stepId].astro` (lesson player) |

**Community**

| Route | File |
|-------|------|
| `/community` | `src/pages/community/index.astro` (Save the Uterus Club hub) |
| `/community/events` | `src/pages/community/events.astro` |
| `/community/members` | `src/pages/community/members.astro` |
| `/community/post/[id]` | `src/pages/community/post/[...id].astro` (client-rendered; single placeholder static shell) |
| `/community/areas/[slug]` | `src/pages/community/areas/[...slug].astro` (client-rendered action-area feed; single placeholder static shell) |
| `/community/archive/masterclass` | `src/pages/community/archive/masterclass.astro` (admin-only; unlinked, direct URL; API + inline script enforce bounce) |
| `/community/archive/members` | `src/pages/community/archive/members.astro` (admin-only; unlinked, direct URL; API + inline script enforce bounce) |
| `/events/[slug]` | `functions/events/[slug].js` (public shareable STUC event landing page from D1 `community_post`; strips join info for non-members) |

**Guides & pillars**

| Route | File |
|-------|------|
| `/guides` | `src/pages/guides/index.astro` (guide directory, driven by `ssot/guides.json`) |
| `/naprotechnology` | `src/pages/naprotechnology/index.astro` (pillar guide) |
| `/what-is-rrm` | `src/pages/what-is-rrm/index.astro` (pillar guide) |
| `/common-questions-about-rrm` | `src/pages/common-questions-about-rrm.astro` (pillar guide) |
| `/femm` | `src/pages/femm/index.astro` (pillar guide) |
| `/neofertility` | `src/pages/neofertility/index.astro` (pillar guide) |
| `/creighton-model` | `src/pages/creighton-model/index.astro` (method guide) |
| `/billings-ovulation-method` | `src/pages/billings-ovulation-method/index.astro` (method guide) |
| `/boston-cross-check` | `src/pages/boston-cross-check/index.astro` (method guide) |
| `/marquette-model` | `src/pages/marquette-model/index.astro` (method guide) |
| `/sympto-thermal-method` | `src/pages/sympto-thermal-method/index.astro` (method guide) |
| `/twoday-method` | `src/pages/twoday-method/index.astro` (method guide) |
| `/fertility-awareness-methods-compared` | `src/pages/fertility-awareness-methods-compared/index.astro` (FABM comparison pillar) |
| `/endometriosis` | `src/pages/endometriosis/index.astro` (condition guide) |
| `/endometritis` | `src/pages/endometritis/index.astro` (condition guide) |
| `/pcos` | `src/pages/pcos/index.astro` (condition guide, PCOS/PMOS dual-label) |
| `/miscarriage` | `src/pages/miscarriage/index.astro` (condition guide: recurrent pregnancy loss) |
| `/isthmocele` | `src/pages/isthmocele/index.astro` (condition guide) |
| `/fertility-preserving-surgery` | `src/pages/fertility-preserving-surgery/index.astro` (surgical approach comparison) |
| `/art-registries-and-codes` | `src/pages/art-registries-and-codes/index.astro` (ART registries & codes reference) |
| `/rrm-care-team` | `src/pages/rrm-care-team/index.astro` (companion page to gated-PDF-download guide by Dr. Rebecca Vavilov; standalone, does not use GuideLayout) |
| `/rrm-success-rates` | `src/pages/rrm-success-rates/index.astro` (evidence/outcome-studies pillar) |
| `/ivf-success-calculator` | `src/pages/ivf-success-calculator.astro` (interactive calculator tool; root-level, not in a pillar dir) |

**Glossary**

| Route | File |
|-------|------|
| `/glossary` | `src/pages/glossary/index.astro` (pillar guide) |
| `/glossary/[slug]` | `src/pages/glossary/[slug].astro` (per-term page; shares body render via `GlossaryTerm` component) |

**Ask**

| Route | File |
|-------|------|
| `/ask` | `src/pages/ask.astro` (auth-gated chat UI; per-answer Save button) |
| `/ask/saved` | `src/pages/ask/saved.astro` (auth, lists user's saved Q&As) |
| `/ask/s/<token>` | `functions/ask/s/[token].js` (public HTML share view, server-rendered, noindex) |

**Fundraising & STUC**

| Route | File |
|-------|------|
| `/donate` | `src/pages/donate/index.astro` |
| `/donate/thank-you` | `src/pages/donate/thank-you.astro` |
| `/save-the-uterus-club` | `src/pages/save-the-uterus-club/index.astro` |
| `/save-the-uterus-club/thank-you` | `src/pages/save-the-uterus-club/thank-you.astro` |

**Surveys**

| Route | File |
|-------|------|
| `/endo-survey` | `src/pages/endo-survey/index.astro` |
| `/endo-survey/take` | `src/pages/endo-survey/take.astro` (handles expired-link state) |
| `/endo-quiz` | `src/pages/endo-quiz/index.astro` (Google Ads landing variant, FABM-quiz-style flow, no magic link; noindex) |
| `/endo-quiz/start` | `src/pages/endo-quiz/start/index.astro` |
| `/endo-quiz/results` | `src/pages/endo-quiz/results/index.astro` |

**Partners & providers**

| Route | File |
|-------|------|
| `/partners` | `src/pages/partners/index.astro` (educational partners directory) |
| `/partners/apply` | `src/pages/partners/apply.astro` (partner application form) |
| `/providers` | `src/pages/providers/index.astro` (find-a-provider fundraiser/directory page) |

**Original research & policies**

| Route | File |
|-------|------|
| `/original-research` | `src/pages/original-research/index.astro` (citation-authority artifact index) |
| `/original-research/lint-identity` | `src/pages/original-research/lint-identity/index.astro` |
| `/original-research/proof-gates` | `src/pages/original-research/proof-gates/index.astro` |
| `/original-research/proof-gates/patterns` | `src/pages/original-research/proof-gates/patterns/index.astro` |
| `/policies` | `src/pages/policies/index.astro` (policy index) |
| `/policies/editorial` | `src/pages/policies/editorial.astro` |
| `/policies/corrections` | `src/pages/policies/corrections.astro` |
| `/policies/fact-checking` | `src/pages/policies/fact-checking.astro` |

**Admin UI** (all session + admin/superadmin gated)

| Route | File |
|-------|------|
| `/admin` | `src/pages/admin/index.astro` (redirect stub to `/admin/backlinks/`) |
| `/admin/backlinks` | `src/pages/admin/backlinks.astro` |
| `/admin/campaign-report` | `src/pages/admin/campaign-report.astro` (campaign arrivals) |
| `/admin/community` | `src/pages/admin/community.astro` (action-area ownership) |
| `/admin/content` | `src/pages/admin/content.astro` (content performance) |
| `/admin/conversions` | `src/pages/admin/conversions.astro` |
| `/admin/email` | `src/pages/admin/email.astro` (email observatory) |
| `/admin/enrollments` | `src/pages/admin/enrollments.astro` |
| `/admin/membership` | `src/pages/admin/membership.astro` (admin-gated, NOT superadmin) |
| `/admin/partners` | `src/pages/admin/partners.astro` (partner application management) |
| `/admin/revenue` | `src/pages/admin/revenue.astro` |
| `/admin/seo` | `src/pages/admin/seo.astro` |

**Dev previews** (unlinked, sample-data harnesses)

| Route | File |
|-------|------|
| `/dev/campaign-callout-preview` | `src/pages/dev/campaign-callout-preview.astro` (CampaignCallout against sample data) |
| `/dev/providers` | `src/pages/dev/providers.astro` (provider-card preview) |
| `/dev/supporter-recognition-preview` | `src/pages/dev/supporter-recognition-preview.astro` (supporter-recognition components, sample snapshots; noindex) |

**System & agent surfaces**

| Route | File |
|-------|------|
| `/404` | `src/pages/404.astro` |
| `/500` | `src/pages/500.astro` |
| `/webhooks` | `src/pages/webhooks.astro` (webhook status + subscription channels for AI agents/devs) |
| `/openapi` | `src/pages/openapi.astro` (OpenAPI 3.1 reference, build-time imports `public/openapi.json`) |
| `/connect` | `src/pages/connect/index.astro` (MCP setup guide + developer section) |
| `/agent-auth` | `src/pages/agent-auth.astro` (API-token auth guide for AI agents) |
| `/ai-instructions` | `src/pages/ai-instructions/index.astro` (structured reference for AI assistants/answer engines) |
| `/linkinbio` | `src/pages/linkinbio.astro` |
| `/linkinbio/jointhecall` | `src/pages/linkinbio/jointhecall.astro` |
