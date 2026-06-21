# Handoff: building out the directory fundraiser (/providers/)

Date: 2026-06-21. Repo: rrm-academy-cf. Page: src/pages/providers/index.astro.

You are picking up work on the RRM "directory fundraiser" -- the live, indexable donation
page at rrmacademy.org/providers/ that funds building the practitioner directory. Your job is
to build it out further. Before writing anything, confirm with Brian exactly what "build out"
means this round (new sections? donor social proof? milestone tiers? share/receipt flow? the
evergreen "Support Access to Care" component? design cleanup? a real end-to-end charge test?).
Do not assume scope.

## Read first
- ~/iCode/CLAUDE.md (routing) and projects/rrm-academy-cf/CLAUDE.md + STYLE-GUIDE.md
- Memory: find-a-provider-project.md, provider-directory-keep-offline.md, and (for the give
  flow) stripe-refund-data-model.md
- The page: src/pages/providers/index.astro
- The give backend: functions/api/create-checkout.js and functions/api/fund-progress.js

## What is live now
- /providers/ serves the FUNDRAISER (not the directory). H1: "Help the next generation of
  women and girls find restorative care." $10,000 goal, one-time gifts only, live Stripe
  thermometer ($25/$50/$100/$250 + custom). Indexable as of 2026-06-10.
- Recipient is the RRM Foundation, 501(c)(3), EIN 93-4594315. JSON-LD DonateAction, NGO
  "Restorative Reproductive Medicine Foundation Inc."
- Backend: create-checkout.js validates a `campaign` field then makes a Stripe PaymentIntent
  + session metadata; fund-progress.js GETs the live Stripe total for
  campaign='provider-directory' (COMMUNITY_KV 60s cache, refund net-out via
  latest_charge.amount_refunded, per-IP rate limit, fail-soft $0).
- Stat band (9-year median dx delay / up to 1 in 10 / 6+ visits) traces to the live
  /endometriosis/ pillar (Pugsley & Ballard 2007). Do not invent stats.

## Terminology rename (shipped 2026-06-21, live-verified)
The insurance word "provider" was replaced on public surfaces with role-true "Doctor / Teacher."
On this page the directory is now named "RRM Care Directory" (public hub "Find Care" at
/find-care/, which is still DARK). The footer link is "Find a Doctor or Teacher." Public
category headings for when the directory builds: Doctors / Teachers / Wellness Support.
- Use Doctor/Teacher in any NEW copy. Never "provider" or "practitioner" (Brian's hard rule:
  "provider" is an insurance term). Confirm the page reads "RRM Care Directory," not "RRM
  Provider Directory," before adding copy.
- The Stripe campaign id 'provider-directory' is BACKEND and was intentionally NOT renamed --
  fund-progress.js queries it; renaming it breaks the live thermometer.

## Hard rules (do not violate)
- Recipient is ALWAYS the RRM Foundation (EIN 93-4594315). NEVER "donate to RRM Academy."
- One-time gifts only. Do not add recurring/subscription options.
- Keep the protective-instinct frame ("so she never has to search like you did"). The public
  was never told the directory was pulled offline -- do not reference that, and do not add a
  patient "find care now" escape hatch (Brian removed it deliberately).
- Do NOT relaunch or link to the searchable directory listings. They are dark by Brian's
  standing decision. Only the fundraiser is live.
- No em dashes. Short, dense copy. Patient-facing copy gets mockup-gate review (below).

## Deploy mechanics
- The local rrm-academy-cf clone is often on a STALE branch (it was 329 commits behind
  origin/main on 2026-06-21). Do your work in a FRESH git worktree off origin/main, never the
  dirty clone:  git -C <repo> worktree add -b claude/<name> /tmp/<dir> origin/main
- Ship via ONE claude/* branch + ONE push. That triggers Security gate + "Merge Claude
  Branches" auto-merge then main "Build & Deploy" then CF Pages (~4-5 min). Verify the run
  conclusion AND curl production; do not assume merge == deployed.
- KNOWN DEPLOY RACE (hit 2026-06-21): a workflow_dispatch "Build & Deploy" can start ~1s before
  the push-triggered one, build the PRE-merge SHA, and finish LAST, making a STALE build the
  active CF Pages production deployment even though every GH Action shows green. ALWAYS verify
  the active production deployment commit after a deploy:
    curl -s -H "Authorization: Bearer $FULL" \
      ".../accounts/$ACC/pages/projects/rrm-academy/deployments?per_page=2&env=production"
  If the wrong commit is live, roll back to the correct deployment:
    POST .../pages/projects/rrm-academy/deployments/<deployment_id>/rollback   (then purge).
  Account id ecf2c5bc8b5ebd634bcb587b3890910a; zone id 88caaa4b9481e52bac74fe4e9d4787fd.
- providers/index.astro is NOT in guard-manifest.json and NOT in PAYMENT_FILES (those are
  functions/api/* only). If you touch create-checkout.js or fund-progress.js, use the `coder`
  agent and the payment-pipeline gate applies (scripts/gates/validate-payment-pipeline.mjs).
- Apex HTML is edge-cached (~1h, s-maxage=3600). After deploy, verify on the
  rrm-academy.pages.dev alias, then purge the zone (use the /cf-cache-purge skill), then
  verify the apex serves the new content. Query strings do NOT bust the CF Pages cache.
- MOCKUP GATE: never push content-publication live without Brian's explicit go-live. Stage in
  the worktree, show him the diff (and ideally a Playwright screenshot at 393x852 mobile), hold.

## Known open items
- Two pre-existing design findings on this page (impeccable hook): a side-tab accent border
  (~L501) and a width/layout animation (~L393). Candidates for cleanup if Brian wants polish.
- The give flow has never been verified end-to-end with a real charge. A $5 canary is
  available: give $5 live, confirm metadata.campaign='provider-directory' + thermometer ticks,
  then refund.
- "Support Access to Care" is a parked evergreen campaign for AFTER the directory launches
  (frame: access to care, not the directory). If you build site-wide donation callouts, make a
  reusable component off a funding-projects.json SSOT; do not hardcode. Overlaps the
  sponsor-page-project.

## First action
Ask Brian to name the specific build-out, then propose a plan (what changes, what deploys vs
stays staged, revert path) before editing.
