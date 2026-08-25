# RRM Academy plan of action

**Written 2026-08-24, off the SEO capability audit run the same day.**

## The premise

An 80-leaf SEO taxonomy was mapped against the estate. 26 leaves came back GAP
or PARTIAL on the first pass. An adversarial pass killed every one of them: four
upgraded straight to COVERED, and **zero survived as a true gap**.

So the plan below contains no new capability. Every line is finishing something
that already exists. The estate's problem is not missing instruments, it is
instruments that were built and never wired, content that was written and never
merged, and outreach that was drafted and never sent.

One structural note, because it explains why the first audit pass was wrong
about everything: capabilities here are filed under names that do not say SEO.
The vague-anchor linter lives in a Google-docs-style skill. The RUM tag is
edge-injected and invisible to a source grep. Broken-link reclamation shipped as
`byitsfruit-router`. Any future inventory that greps SEO vocabulary will
under-report the same way.

---

## Done today

**7 comparison pages published, then taken down the same evening.** They went
live off `held/compare-and-method-guides` without the content review the hold
existed to wait for, and were pulled a few hours later. Do not plan against
them being live.

Current state as of 2026-08-25:

- **`/ivf-alternatives/` is dead permanently.** Killed on Brian's call. It
  presented IUI, donor sperm, donor eggs, embryo adoption and surrogacy as
  options in RRM Academy's own voice, 25 references against zero in the other
  six, and its own SSOT note recorded the premise as "neutral on
  donor/adoption/surrogacy". Removed from the repo, from the held branch, and
  from `rrm-router`'s `ASTRO_ROUTES` and `MARKDOWN_MAP`; the path is a permanent
  `GONE_EXACT` 410. **A future page at this URL must be written from scratch.**
- **The other six are held, not dead**, at 410 pending Naomi's review:
  `/naprotechnology-vs-ivf/`, `/rrm-vs-ivf-comparison/`,
  `/best-treatment-for-endometriosis/`, `/best-pcos-treatment-for-pregnancy/`,
  `/endometriosis-excision-vs-ablation/`,
  `/progesterone-for-recurrent-miscarriage/`. Removed from the repo and from
  `ssot/guides.json`; their `ASTRO_ROUTES` wiring is deliberately left in place
  so a republish is a `GONE_EXACT` deletion rather than a re-plumb.

The audit ranked this the single highest-yield item because the Ad Grants
"Long-Tail Questions" campaign runs a dedicated **IVF-Alternatives** ad group
with bare `ivf` deliberately kept out of negatives. That reasoning no longer
supports building this page: the organic answer to that intent was the page that
turned out to be off-message. Verified 2026-08-25 that no ad and no sitelink
asset in the account points at any of the seven, and all 11 live ad destinations
return 200, so there is no paid exposure to fix. If that intent is still worth
answering organically, it needs a page written to RRM Academy's actual position
on donor gametes, not a restore.

Not merged, deliberately: the 5 FABM method guides on that branch, which had
already shipped by another path and are live. Merging would have reverted them
to an 857-commit-old version.

---

## P0. Send the off-page asks

**Why first:** citation authority is RRM Academy's entire strategic thesis, and
the off-page flywheel has never turned once. Nothing here needs building.
Prospect lists, templates, tracker, media kit, live intake page and a ranked
start list all exist and are finished.

| Item | State | Action |
|---|---|---|
| iirrm.org, factsaboutfertility.org, irrma.org | Zero links to rrmacademy.org. Asks unchecked in `backlink-analysis-2026-03-01.md:170-171` since March | Send. Owned-adjacent relationships, not cold outreach, no artifact needed |
| `drafts/author-outreach-tracker.json` | n=23, all `not_contacted`, 23 finished emails in Naomi's voice sitting beside them | Release as one batch, let the tracker work |
| 20-podcast prospect list (vault) | Per-episode URLs plus a runbook, unworked | Start after the author batch, so the tracker pattern is proven first |
| Press pipeline | "Releases fired: 0" against a 6-12/year target | Pick one real story. The 7 new comparison pages are not a story; the survey data might be |
| `/partners/` | Live with schema, intake, approval flow, badge kit, anti-link-scheme policy. One partner, zero confirmed reciprocal inbound | Work the three orgs above through it |

**Sequencing matters.** Send the three friendly-org asks first as a live test of
deliverability and of the `/partners/` flow, before the 23-email batch commits
the author list.

**Link and mention reclamation is the highest-yield unstarted item you own.**
`linkbuilding-kb` start item #2, with published conversion evidence behind it:
97.4% of lost links die on still-live pages, unlinked-mention asks convert 33%+,
data citations up to 70%. It wants to be a standing quarterly queue, not a
one-off.

## P1. Unblock the decay signal

`rrm-observatory/src/daemons/wave3/gsc-indexing-delta.js` returns
`{status:ok, shortReason:scaffold_pending}`, is `enabled:false`, and appears zero
times in `_manifest.js`. Its sibling `gsc-visibility.js` states in its own header
that it is stateless and keeps no prior-window history.

That one unwritten `run()` is why there is no GSC index-coverage week-over-week
trend, no per-URL content decay queue, and no automatic qualification for the
refresh machinery that otherwise runs daily. The D1 `gsc_index_snapshot` table
and both thresholds (fail on excluded +5% WoW, warn on indexed -2% WoW) are
already specified inside the scaffold.

Half a day. It also closes the indexing-audit residual and is the only way to
answer whether the ~1,817 noindexed `/providers/` URLs have dropped out of the
index yet.

## P2. One-line and one-wire fixes

Cheapest work in the estate. Each is finished code sitting one edit from value.

| Thing | State | Fix |
|---|---|---|
| `seo-dashboard/scripts/gsc_signals.py:18` | `TODAY = datetime(2026, 6, 7)` hardcoded | One line. Unblocks the next row |
| `seo-dashboard/scripts/underserved_queries.py` | Scored 704 queries across 25 pages on 2026-06-09, per-query missing terms. Never re-run | Re-run once the date is fixed |
| `skills/google-devdocs-style/scripts/gstyle_lint.py` | Real vague-anchor and naked-URL linter with tests. Zero references anywhere in `projects/` or `tools/` | One npm script in the rrm-academy-cf lint chain |
| `wave3/mobile-responsiveness.js` | Written, `enabled:false` | Flip and arm |
| `wave3/multi-engine-parity.js` | Written, `enabled:false`, scaffold | Finish or delete. Do not leave a third scaffold |
| html-sitemap experiment | Deployed 2026-07-03, re-measure due 2026-07-31, no artifact exists | Re-measure or close it out |
| Keywords Everywhere CLI | Complete, synced, zero-dependency, 9 endpoints, unkeyed. No 1Password item exists | Mint the key or delete the CLI |
| `keyword-research` skill | Declares `primaryEnv AHREFS_API_KEY`; nothing exports it, the estate uses `op read` | Change the skill to `op read` |
| Anchor-text inventories | Two produced May 2026, no regenerating script | Wrap the grep that made them |

## P3. Repair the routing table

**`projects/floate-seo-kb` is not on this machine.** `iCode/CLAUDE.md` routes to
it and the governing RRMA execution-program spec lives there, including a
holdout/control-arm design nothing else in the estate specifies. Right now that
routing row points at nothing.

Clone it or strike the row. A routing table that lies is worse than a missing
entry, because the next session follows it and finds a hole.

## P4. Put a date on /providers/

~1,817 directory sub-URLs have served 302 + `x-robots-tag: noindex` since
2026-08-02 pending the rebuild. The parent `/providers/` correctly stays 200 and
indexable as a fundraiser page, and the block is dated and commented for removal
in `rrm-router/src/index.js:748-766`.

Care-intent long-tails ("napro doctor", find-a-provider phrasing) are also
deliberately excluded from Ad Grants until the directory is real. **Organic and
paid are switched off simultaneously on the highest-intent query class the site
has.** That is defensible only for a bounded window, and the window currently has
no end date. Until there is one, the cost cannot even be sized.

---

## Deliberately not on this plan

Each was checked and closed, so it stops recurring as an open question.

- **Programmatic content.** Banned by name in FSP policy and wrong for this
  corpus regardless.
- **NLP term-weighting tools** (Surfer, Clearscope, MarketMuse) and
  entity-salience APIs. Built for commercial sites competing on page-level term
  coverage. The competitive set here is PMC, NIH, ASRM and Cleveland Clinic. The
  adjacent instrument that does matter is the competitor citation and retrieval
  leaderboard, and it already runs.
- **Multilingual and hreflang.** The no-cluster decision is recorded and
  resolved. The only non-English content in scope belongs to an independent
  organization's WordPress site.
- **Outbound broken-link prospecting.** ~0.8% yield per the estate's own KB. The
  half that matters, inbound 404 reclamation, runs at 149-URL scale through
  `byitsfruit-router` with 142/149 landing on their exact article.
- **Screaming Frog and peers.** Functions already covered by daily CF zone
  GraphQL log analysis and a first-party Analytics Engine dataset.
- **Google AI Mode tracking.** Not an engineering gap. A Brand Radar toggle at
  roughly $50/mo, because a 5th surface takes 33 prompts to 165 checks against
  the free 150 cap. Decide it as a purchase.

---

## The gap that is not in any SEO taxonomy

Not one of the 80 leaves measured **donations, enrollments or leads
attributable to organic.** The estate measures visibility (rank, citations,
share-of-voice, retrieval position) far better than it measures outcome.

That asymmetry is the real finding. It is also why every item above is ranked by
argument rather than by evidence: there is no conversion series to rank them
against. Closing it is a bigger piece of work than anything on this plan and it
should be scoped separately, but it is the reason this plan cannot tell you
which of P0 and P1 earns more.

## Honest limits of the audit behind this

- Nobody read the 7 comparison pages for editorial quality. Merge-readiness was
  verified; the prose was not. The pre-commit linter did flag **14
  negation-reframe warnings** in that content, which is a real house-rule
  violation and is Gianna's lane.
- Full backlink profiles were never pulled. Three homepages were spot-checked.
  The Ahrefs credential and the `rrm-backlinks` D1 anchor corpus were available
  and would have answered it properly.
- Anything specified only in `floate-seo-kb` was unreachable, per P3.
- Where the audit says something does not exist, read it as "not found under the
  names searched". That failure mode was demonstrated 26 times in one run.
