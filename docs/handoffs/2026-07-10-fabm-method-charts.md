# Handoff: FABM Method Chart Graphics (staged, NOT live)

Date: 2026-07-10. Session: MacBook, Fable. Status: charts BUILT + VERIFIED + Brian-approved visually ("these are beautiful, i love these colors"). Nothing is deployed. Two expert-review IG DMs are drafted and approved but NOT yet sent (blocked at IG login). Embed + deploy remains gated on Brian's go-live after expert review.

## What this is

7 branded "example chart" graphics, one per FABM method page, built to rank in Google Image Search. Motivation (from GSC, 12-mo window, sc-domain:rrmacademy.org): image search shows 13,032 impressions / 15 clicks / avg position 41; the chart-intent query cluster is the largest method-specific visual demand ("creighton model chart" ~150 imp across variants, "picture dictionary of the creighton model" ~400 imp at pos 6.3-6.8, "billings method chart" ~66 imp pos ~8-10, "femm charting" 31 imp pos 8.5, "napro progesterone chart" ~130 imp pos 3-10 [separate follow-up, protocol-adjacent, NOT in this build]). Competitor landscape for these queries is phone photos on small clinic blogs; no branded educational graphic owns them.

Charts are deterministic HTML -> chromium screenshot -> webp (rrm-page-graphic render pipeline, zero API cost). House style: Cormorant Garamond titles, #725e7e purple, paper bg, RRM Academy wordmark + page URL footer, per-method brand accent. Each chart: one illustrative example cycle in the method's own notation, phase brackets, legend, "Illustrative example, not a real patient chart" note. NO effectiveness stats, no em dashes, original visual language (no CrMS stamp iconography, no ClearBlue trade dress, no FEMM app UI).

## Assets (this branch)

`docs/handoffs/assets/2026-07-10-fabm-charts/`:
- `<slug>-chart-example.html` (editable source; re-render = free) for: creighton-model, billings-ovulation-method, sympto-thermal-method, marquette-model, boston-cross-check, twoday-method, femm
- `<slug>-chart-example.png` (2080px review render) + `.webp` (site-ready, q92)
- `summary.json` — per-chart title/dimensions/accent/description/reviewer-minors + Gianna's alt text and figcaptions (7/7)
- `contact-sheet.html` — the review package Brian approved (open next to the pngs)

Re-render command (from rrm-academy-cf root, needs its node_modules):
`cp ~/iCode/skills/rrm-page-graphic/scripts/render.mjs ./.render-tmp.mjs && node ./.render-tmp.mjs <chart>.html <outbase>; rm -f ./.render-tmp.mjs`

## Verification already done

Built by workflow wf_f8ec0e92-938 (29 + 5 agents): per chart, 3 adversarial lenses (accuracy vs OUR page's own teaching; design/house-style + 240px thumbnail legibility; IP-originality + content-safety). 0 residual blockers on all 7. Reviewer minors are recorded per chart in summary.json. Judgment calls surfaced to Brian with the renders (accepted as rendered): "infertile" phase labels kept (standard method terminology), Creighton teal gradient instead of proprietary stamp colors (deliberate), colon in on-image titles (matches search phrasing).

## Pending step 1: expert-review IG DMs (approved, unsent)

Approved texts (Brian's register: bare ask, no greeting, no honorific, no sign-off — see memory feedback-dm-outreach-minimal-register):

- To Erin Kay, DO (FEMM Medical Consultant, credited reviewer on /femm/) — IG `@drerincallaghan` (external name/bio match; VERIFY profile on-screen before sending, not confirmed in local records). Attach `femm-chart-example.png`.
  > Can you check this FEMM chart for accuracy? It's for the FEMM guide on rrmacademy.org.
- To Rebecca Vavilov, PhD (Boston Cross Check org; RRM care-team guide author) — IG `@ovawellness` (from her provider record, local-verified). Attach `boston-cross-check-chart-example.png`.
  > Can you check this Boston Cross-Check chart for accuracy? It's for the Boston Cross-Check guide on rrmacademy.org.

Mechanics: claude-in-chrome on Comet, instagram.com/direct/new. Sender = Brian's session (`brwtkr` saved profile). BLOCKED 2026-07-10: IG session expired; password prompt reached, Claude does not authenticate — Brian logs in himself, then resume. After sending: verify both messages render in-thread with image, screenshot as proof.

## Pending step 2: embed + deploy (gated on Brian's go-live after expert review)

1. Copy the 7 `.webp` to `public/images/<slug>/<slug>-chart-example.webp`.
2. Embed per page via the `/rrm-page-graphic` skill patterns — two page architectures: data-driven thin pages (billings, marquette, sympto-thermal, twoday, boston-cross-check: `scripts/embed-cards.mjs` string-replace pattern) vs inline pages (creighton-model, femm: hand-edit). Each gets `<figure class="hero-figure">`(second in-content image, below the existing at-a-glance card placement decision: place in the charting/how-it-works section, NOT replacing the existing hero card) + `ImageObject` node added to the schema graph + alt/figcaption from summary.json + width/height attrs + `dateModified` bump.
3. Image sitemap: extend `src/integrations/library-sitemaps.mjs` (or sibling custom integration) with `image:image` entries for method pages; standard @astrojs/sitemap does not emit image extensions.
4. Gates (from /rrm-page-graphic, all HARD): G1 stat fidelity (charts carry no stats by design), G2 bare `var(--token)` only + `node scripts/css-audit/audit.mjs --gate` locally (CI ratchet is stricter than pre-commit), G3 ship from clean worktree off origin/main + verify apex (asset 200 image/webp, page renders figure + ImageObject, desktop + 393x852 screenshots), G4 = this go-live gate itself.
5. Post-deploy: purge cache if needed, GSC re-submit the 7 URLs, re-check GSC image queries in ~4-6 weeks.

## Branch mechanics

Branch `held/fabm-method-charts` (deliberately NOT `claude/*`: merge.yml must not auto-merge; deploy.yml only builds main). Built in worktree /tmp/rrm-cf-fabm-charts off origin/main c1f863cf. To pick up on another machine: `git fetch origin && git checkout held/fabm-method-charts` (or worktree). Do not merge this branch as-is; the embed work (pending step 2) lands on top before any merge.
