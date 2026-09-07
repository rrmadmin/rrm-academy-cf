# Handoff: populate library synopses (AI overviews) + results infographics

Written 2026-09-06 on the Blue iMac. Brian's opener: "the rrm library is ready for some custom chart images for a research paper and also some ai-overviews." Clarified: he means the per-record Synopsis block and its infographic slot on `rrmacademy.org/library/<id>/`, for papers already in the library. No paper in `research-drafts/` is involved.

## State of play (verified 2026-09-06, read-only D1 via `CF - D1 Read Only - account`)

The feature is fully built and gated per record. Almost nothing is switched on.

| Metric | Count |
|---|---|
| articles total | 5,755 |
| is_published=1 | 4,321 |
| published, rrm_relevance >= 4 | 1,427 |
| insights drafted (2026-06 opus auto-run, unreviewed) | 1,701 |
| insights_failed_reason set | 342 |
| synopsis_approved=1 (live Synopsis block) | 3 |
| infographic_approved=1 (live chart) | 2 |
| published rel 4+ with insights IS NULL | 843 |

Live examples to open first:

| Record | Synopsis | Infographic | URL |
|---|---|---|---|
| recwQFGCpCL5MQKz3 CEIBA Creighton intentions | live | `single` | https://rrmacademy.org/library/pregnancies-intentions-and-fertility-behaviors-during-use-of-the-creighton-model-fertilitycare-system-after-initial-intention-to-avoid-pregnancy-results-from-the-creighton-model-effectiveness-intentions-behaviors-rec7di5renfhqd6ch/ |
| recxjqI0gYS2Y3qzdA2w Low AMH | live | none | https://rrmacademy.org/library/low-amh-and-natural-conception-xjqI0gYS/ |
| rectoeISfF65SkdQb0Td FABM waiting conduct | live | `bars` | https://rrmacademy.org/library/fertility-awareness-methods-and-waiting-conduct-in-idiopathic-infertility-a-pros-toeisff6/ |

The third is the closest existing example of a "results chart" using the current `bars` template.

## Where the machinery lives

- Page: `rrm-academy-cf/src/pages/library/[...slug].astro`. Synopsis section renders `article.insights` (`title`, `tldr`, `key_findings[]`, `clinical_implications`, `methodology`, `rrm_context`), then `SynopsisInfographic` fed by `article.infographic`, then `ShareKit`. Slot sits inside `{article.insights && ...}`, so an infographic never shows without an approved synopsis.
- Field names: `clinical_implications`, NOT `clinical_relevance` (schema comment and the old rrm-commentary skill were wrong; the worker route rejects the legacy name).
- Data: worker `/articles` emits `insights` only when `synopsis_approved=1` and `infographic` only when `infographic_approved=1` (`rrm-library-worker/src/index.js` `mapArticleRow`); `rrm-academy-cf/src/lib/fetch-data.mjs` writes `src/data/articles.json` (gitignored, regenerated in `deploy.yml`).
- Write routes (admin scope): `POST /insights-result` (`rrm-library-worker/src/routes/insights-result.js`) and `POST /infographic-result` (sets `infographic` + `infographic_approved=1` atomically).
- Infographic spec + renderer: `rrm-academy-cf/src/lib/infographic/` (`types.mjs` TEMPLATES = single, delta, bars, ratio, correction; `validate.mjs`; `templates.mjs` `renderInfographic`; `house-style.mjs` gate runs in CI and hard-fails `npm run build`). Scripts: `scripts/infographic-render.mjs --file spec.json` (validate), `scripts/infographic-export.mjs --file spec.json --out <dir> --presets square,og`, post-build `scripts/build-infographic-assets.mjs`.
- Skill: `/rrm-infographic` (full flow, held-local by default, go-live is a separate operator step). Memories: `synopsis-approval-gate`, `library-synopsis-standard`, `infographic-pictograph-voice`, `gianna-stat-link-fidelity-gate`, `feedback-mockup-gate-before-live-publish`.
- No line chart or multi-series template exists. A time-series figure (e.g. cumulative pregnancy rate by cycle) needs a new template through `renderInfographic`, never a hand-rolled SVG.

## Agreed proof case (Brian said "pick one for me"; not yet approved as the record)

`reck8jozujuq5hshh`, 2017, "Fertility Treatment, Use of In Vitro Fertilization, and Time to Live Birth Based on Initial Provider Type". Relevance 5, fulltext in R2, commentary present, 13 extracted numeric facts, page returns 200. Two-group comparison (generalist-first vs subspecialist-first) fits the existing `bars` template with no new code: IVF use, and 5-year cumulative live birth (51.2% vs 50.7%).

Runners-up if Brian prefers: `recafrii5bljtlmgl` (2018 primary-care fertile-window study, cumulative rate by cycle, needs a line template) and `reccjc7xoaa1zwsp6` (2020 pooled cycle-length norms, bars with CI).

## Proposed plan (presented to Brian, NOT yet approved; brainstorming gate still open)

1. Gianna (`gianna-copywriter`) drafts a fresh synopsis to `library-synopsis-standard` for the proof record. Held in scratch, not written to D1. Open question for Brian: reuse the existing held draft in D1 for that record or write clean.
2. `/rrm-infographic` proposes a `bars` spec bound to the primary source, validates, verifies source, renders to scratch, shows mockup plus `share_caption` to Brian.
3. On Brian's go only: POST insights + `synopsis_approved=1`, POST spec to `/infographic-result`, dispatch a rebuild, verify on the immutable `<hash>.pages.dev` URL, then the apex.
4. Scale decision, Brian's call: re-review the 1,698 held drafts in batches (glossary-review worker is the obvious pattern for a Naomi review lane), or regenerate rel 4+ only and let the old opus drafts die.

## Rules that bind the next session

- Fable main thread must not author or ingest the clinical prose; Gianna writes, main thread runs gates (`feedback-fable-never-handles-medical-terminology`). Numbers bound to the primary source, never the synopsis paraphrase.
- Mockup gate before any live publish. Nothing writes D1 on a normal run.
- Single-record rebuilds can be reverted same day by the deploy.yml cache (memory `gh-actions-cache-exact-hit-no-save`); verify on the hash URL, and prefer a full deploy if the record does not appear.
- Read D1 with `CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/CF - D1 Read Only - account/credential')`, captured, never printed. Column names: `is_published`, `rrm_relevance`, `full_text_r2_key`.
- rrm-academy-cf clone on the iMac is clean on main except two untracked dirs (`public/courses/`, `public/faqs/`); ship via a worktree off `origin/main` if another session is active.
