# Fertility-Preserving Surgery Pillar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a concise, citeable `/fertility-preserving-surgery/` pillar guide on rrmacademy.org that ranks/quotes well for search engines and AI, presenting the Restorative / Specialist / Conventional surgical-quality spectrum across six conditions. Citeable, not exhaustive. Held at the go-live gate.

**Architecture:** Static Astro pillar page (`src/pages/fertility-preserving-surgery/index.astro`) rendering an SSOT data file (`src/data/fertility-preserving-surgery.json`) via `.map()` with `set:html` for inline citation HTML. Prose drafted/checked by the `gianna-copywriter` agent; AEO/schema checked by the `rrma-seo-operator` agent. JSON-LD `@graph` (Article+MedicalWebPage, BreadcrumbList, FAQPage, ItemList). Registered in the guides registry; routed via rrm-router.

**Tech Stack:** Astro 5, CF Pages, the guide-create scaffold, rrm-cli (library search), `/rrm-ingest` (library gaps), Playwright (web-page-qa render gate).

**Design source of truth:** `docs/superpowers/specs/2026-06-13-fertility-preserving-surgery-pillar-design.md`. Read it before starting.

**Posture (hard):** Held at the go-live gate. Build, draft, check, and stage on preview only. Do NOT deploy to the apex live until Brian gives an explicit go-live. Every clinical claim carries an inline `/library/` citation. No em dashes. No "Yes" leads on fertility FAQ answers. No absolutist patient copy. Patients route to `/providers/`, never to Dr. Whittaker. PCOS leads with restorative wedge resection as preferred on root-cause grounds, earned through cited hormonal/durability records, never an invented head-to-head RCT.

---

## Autonomy Contract and Revert

- **Runs without human input** through Phase 6. Phase 7 STOPS at the go-live gate and requires Brian's explicit go-live before any apex deploy.
- **Abort conditions (stop and report):** a gate fails twice and the fix is non-obvious; `/rrm-ingest` cannot source a claim (do not cite uncited claims); the page cannot render clean at mobile 393x852 + desktop; any contradiction with a HARD content rule.
- **Revert authority** (all changes are new files plus one registry edit plus one router edit; nothing is published pre-go-live, so no production rollback is needed before Phase 7):

```bash
cd ~/iCode/projects/rrm-academy-cf
rm -rf src/pages/fertility-preserving-surgery/ src/data/fertility-preserving-surgery.json
rm -f docs/research/2026-06-13-fertility-preserving-surgery-evidence.md
git checkout -- ssot/guides.json
node scripts/build-guides-data.mjs   # regenerate the gitignored src/data/guides.json
cd ~/iCode/projects/rrm-router && git checkout -- src/index.js
```

Post-go-live rollback only: `git revert <hash>` the page commit, then `gh workflow run deploy.yml`; redeploy the router without the route.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `docs/research/2026-06-13-fertility-preserving-surgery-evidence.md` | Claim ledger: every clinical claim mapped to a verified `/library/` slug + PMID, per condition | Create |
| `src/data/fertility-preserving-surgery.json` | SSOT: `tiers[]` + `conditions[]` (each with inline citation HTML) | Create |
| `src/pages/fertility-preserving-surgery/index.astro` | The pillar page: scaffold, byline, TOC, sections via `.map()`, JSON-LD | Create |
| `ssot/guides.json` | Guide registry SSOT (only registry file to edit) | Modify |
| `~/iCode/projects/rrm-router/src/index.js` | `ASTRO_ROUTES` add `/fertility-preserving-surgery` | Modify |

> `src/data/guides.json` is gitignored and regenerated from `ssot/guides.json` by `scripts/build-guides-data.mjs`. Never hand-edit it.

---

## Phase 0: Evidence pass and claim ledger (front-loaded research)

### Task 0: Build the claim ledger

**Files:**
- Create: `docs/research/2026-06-13-fertility-preserving-surgery-evidence.md`

- [ ] **Step 1: Search the library per condition.** For each of the six topics, run the rrm-cli `search` operation (intent `cite`) and record candidate `/library/` slugs:

```
endometriosis excision versus ablation recurrence fertility
ovarian endometrioma cystectomy ovarian reserve AMH
ovarian wedge resection PCOS ovulation hormone outcomes
myomectomy fibroid fertility versus hysterectomy
tubal microsurgery reversal reconstruction
adhesion prevention barrier microsurgery fertility
```

Use `mcp__rrm-cli__execute` with `{operation:"search", params:{query:"<q>", intent:"cite", limit:12}}`. The PCOS query already returns 12+ wedge-resection records (verified 2026-06-13).

- [ ] **Step 2: Fill evidence gaps with Perplexity.** For any claim with no library record, run the `pplx` skill (Sonar Pro) to find the primary source, then queue it for ingest. Do NOT cite a claim with no source.

- [ ] **Step 3: Curl-verify every PMID.** For each cited PMID, confirm it resolves and the title/finding matches (Perplexity fabricates PMIDs; always verify):

```bash
curl -s "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=<PMID>&retmode=json" | jq -r '.result["<PMID>"].title'
```

- [ ] **Step 4: Ingest missing sources.** For each gap source, run `/rrm-ingest` end-to-end (ingest -> fulltext -> classify -> publish -> facts -> verify live 200). Record the resulting `/library/<slug>/`.

- [ ] **Step 5: Write the ledger.** One table per condition: `claim | tier it supports | /library/ slug | PMID | verified`. This is the single source the drafting tasks cite from. Keep claims to the contestable few per condition (the page is citeable, not exhaustive).

- [ ] **Step 6: Commit.**

```bash
git add docs/research/2026-06-13-fertility-preserving-surgery-evidence.md
git commit -m "research: claim ledger for fertility-preserving-surgery pillar"
```

---

## Phase 1: SSOT data file

### Task 1: Create the comparison SSOT

**Files:**
- Create: `src/data/fertility-preserving-surgery.json`
- Reference: `src/data/art-registries.json` (existing SSOT-driven pillar data shape)

- [ ] **Step 1: Write the data file.** Two arrays. `tiers[]` seeds the hero table + ItemList; `conditions[]` seeds the per-condition rows. `citationsHtml` carries inline `<a href="/library/<slug>/">...</a>` markup (rendered with `set:html`). Use only slugs verified in the Task 0 ledger.

```json
{
  "tiers": [
    {
      "id": "restorative",
      "rank": 1,
      "label": "Restorative reproductive (RRM) surgery",
      "shortLabel": "Restorative",
      "goal": "Remove the disease and leave the reproductive organs more functional than before.",
      "hallmarks": [
        "Complete excision or removal of disease",
        "Microsurgical, near-contiguous dissection and reconstruction",
        "Deliberate adhesion prevention (technique plus barriers)",
        "Ovarian-reserve sparing",
        "Treats the root cause, not only symptoms"
      ],
      "fertilityImpact": "Protected and often improved",
      "whoPerformsIt": "RRM / restorative reproductive surgeons"
    },
    {
      "id": "specialist",
      "rank": 2,
      "label": "Specialist surgery",
      "shortLabel": "Specialist",
      "goal": "Remove the disease competently; restorative toolkit applied inconsistently.",
      "hallmarks": [
        "Disease is removed (excision, myomectomy, cystectomy)",
        "Adhesion barriers and reconstructive closure are variable",
        "Ovarian-reserve-sparing technique is inconsistent",
        "Outcomes depend heavily on the individual surgeon"
      ],
      "fertilityImpact": "Usually preserved; surgeon-dependent",
      "whoPerformsIt": "Skilled gynecologic specialists"
    },
    {
      "id": "conventional",
      "rank": 3,
      "label": "Conventional surgery",
      "shortLabel": "Conventional",
      "goal": "Control symptoms; fertility is not the priority.",
      "hallmarks": [
        "Ablation or fulguration rather than removal of disease",
        "Reserve-depleting technique",
        "Default hysterectomy or oophorectomy where conservation was possible",
        "Fertility is frequently a casualty"
      ],
      "fertilityImpact": "Often reduced or lost",
      "whoPerformsIt": "General approach where fertility is not the goal"
    }
  ],
  "conditions": [
    {
      "id": "endometriosis",
      "name": "Endometriosis",
      "route": "/endometriosis/",
      "tier1": "Wide excision of disease with reconstruction and adhesion prevention.",
      "tier2": "Excision by a skilled surgeon, restorative toolkit applied unevenly.",
      "tier3": "Ablation or fulguration of the surface, leaving disease behind.",
      "citationsHtml": "<a href=\"/library/<excision-vs-ablation-slug>/\">...</a>"
    }
  ]
}
```

(Populate all six conditions from the Task 0 ledger: endometriosis, ovarian-cysts-endometriomas, pcos-wedge-resection, fibroids, tubal-disease, adhesions. Keep each `tierN` to one sentence; this is a comparison grid, not prose.)

- [ ] **Step 2: Validate JSON.**

```bash
node -e "JSON.parse(require('fs').readFileSync('src/data/fertility-preserving-surgery.json','utf8')); console.log('valid JSON')"
```
Expected: `valid JSON`

- [ ] **Step 3: Commit.**

```bash
git add src/data/fertility-preserving-surgery.json
git commit -m "data: SSOT for fertility-preserving-surgery tiers + conditions"
```

---

## Phase 2: Page scaffold (conventions)

### Task 2: Scaffold the pillar with all guide conventions

**Files:**
- Create: `src/pages/fertility-preserving-surgery/index.astro`
- Reference: `src/pages/art-registries-and-codes/index.astro` (closest structural match), `guide-create` SKILL.md scaffold

- [ ] **Step 1: Copy the guide-create scaffold** into the new file with these exact conventions (verify each against `art-registries-and-codes/index.astro`):
  - imports: `BaseLayout`, `MaybeShell`, `BackToTop`, `SectionTocChips`, `LastUpdated`, `isShellEnabled`, `pageDates`, plus `import pillarData from '../../data/fertility-preserving-surgery.json'`
  - `const SHELL_ENABLED = isShellEnabled('guides')` (the shared shell key, NOT a per-slug key)
  - `const PAGE_PATH = '/fertility-preserving-surgery/'`, `PAGE_URL`, `LAST_MODIFIED` from `pageDates`
  - `TOC_ITEMS` matching the H2 anchors
  - byline block: `By RRM Academy` + `Reviewed by Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI` (the `.author-avatar-stack` + `.has-reviewer` pattern)
  - breadcrumb nav, `<SectionTocChips items={TOC_ITEMS} />` when `SHELL_ENABLED`, `article-layout--no-toc` modifier, `<BackToTop />`
  - hero tier table and per-condition rows rendered via `pillarData.tiers.map(...)` / `pillarData.conditions.map(...)` with `set:html` for `citationsHtml`

- [ ] **Step 2: Leave section bodies as labelled empty `<section id=...><h2>...</h2></section>` stubs** matching the spec section outline (Key Takeaways, Why two operations..., The three tiers, the six conditions, What sets restorative apart, How to find a surgeon, FAQ, Continue exploring). Prose comes in Phase 3.

- [ ] **Step 3: Build to verify the scaffold compiles.**

```bash
SITE_SSOT_ENABLED=0 npx astro build 2>&1 | tail -20
```
Expected: build succeeds, `/fertility-preserving-surgery/` in the route list.

- [ ] **Step 4: Commit.**

```bash
git add src/pages/fertility-preserving-surgery/index.astro
git commit -m "feat: scaffold fertility-preserving-surgery pillar (conventions + SSOT render)"
```

---

## Phase 3: Draft prose (Gianna voice, AEO intro)

### Task 3: Draft sections via the gianna-copywriter agent

**Files:**
- Modify: `src/pages/fertility-preserving-surgery/index.astro` (section bodies)

- [ ] **Step 1: Dispatch the `gianna-copywriter` agent** with the spec, the Task 0 claim ledger, and these constraints. Prompt essentials:
  - Voice: Dr. Whittaker, clinical, critical-not-rhetorical.
  - Posture: citeable, not exhaustive. ~1200 to 1800 words total. Each condition section is 2 to 4 tight sentences plus the tier row.
  - **Intro paragraph: plain English, AEO-optimized.** First two sentences must directly answer "How do fertility-preserving surgeries differ?" in a self-contained, quotable way (an AI should be able to lift them verbatim). No throat-clearing.
  - Every clinical claim carries an inline `<a href="/library/<slug>/">` from the ledger. No uncited claims.
  - Hard rules: no em dashes; no "Yes" leads on fertility FAQ answers (lead "In many cases..."); no absolutist copy ("non-negotiable", most-never stacking) -> "many/often"; patients route to `/providers/`, never Dr. Whittaker; PCOS leads with restorative wedge resection as preferred on root-cause/durability grounds with honest evidence-vintage caveat, no invented RCT.
  - Key Takeaways: 4 to 6 scannable bullets that stand alone as the one-screen answer.
  - FAQ: 4 to 6 Q&As shaped as real patient questions, each answer self-contained for FAQPage schema.

- [ ] **Step 2: Insert the returned prose** into the section stubs. Keep the SSOT-driven tier table and condition rows; prose wraps around them.

- [ ] **Step 3: Self-audit the draft** against the hard-rule checklist (grep aids):

```bash
grep -n "—" src/pages/fertility-preserving-surgery/index.astro && echo "EM DASH FOUND (fix)" || echo "no em dashes"
grep -niE ">\s*Yes[,. ]" src/pages/fertility-preserving-surgery/index.astro && echo "CHECK Yes-lead" || echo "no Yes-leads"
grep -niE "non-negotiable|never need|always required" src/pages/fertility-preserving-surgery/index.astro && echo "CHECK absolutist" || echo "no absolutist flags"
grep -niE "Whittaker|Dr\.? Naomi" src/pages/fertility-preserving-surgery/index.astro
# ^ Naomi may appear ONLY in the byline/reviewer block, never in a patient-action CTA or referral line.
```

- [ ] **Step 4: Commit.**

```bash
git add src/pages/fertility-preserving-surgery/index.astro
git commit -m "content: draft fertility-preserving-surgery pillar prose (Gianna, AEO intro)"
```

---

## Phase 4: JSON-LD and AEO (rrma-seo-operator)

### Task 4: Wire JSON-LD and run the AEO pass

**Files:**
- Modify: `src/pages/fertility-preserving-surgery/index.astro` (JSON-LD `@graph`)

- [ ] **Step 1: Author the JSON-LD `@graph`:** `['Article','MedicalWebPage']` (author `#organization`, `reviewedBy #naomi-whittaker`, `about` Thing entities, `articleSection` strings matching in-page H2 text exactly), `BreadcrumbList` (Home -> Fertility-Preserving Surgery), `FAQPage` (from Task 3 FAQ), `ItemList` (projection of `pillarData.tiers`).

- [ ] **Step 2: Verify `articleSection` matches H2s exactly.**

```bash
grep -oE "<h2[^>]*>[^<]+" src/pages/fertility-preserving-surgery/index.astro
```
Cross-check every string appears in the `articleSection` array. Mismatches break the schema.

- [ ] **Step 3: Dispatch the `rrma-seo-operator` agent** on the staged page: validate FAQ schema, MedicalWebPage/Article schema, meta title + description (<=160 chars, plain-English), OG image slug (`/og/fertility-preserving-surgery.png`), heading hierarchy, internal links, and retrieval/AEO quotability of the intro + Key Takeaways. Apply its fixes.

- [ ] **Step 4: Build and validate schema.**

```bash
SITE_SSOT_ENABLED=0 npx astro build 2>&1 | tail -5
node -e "const h=require('fs').readFileSync('dist/fertility-preserving-surgery/index.html','utf8'); const m=h.match(/<script type=\"application\/ld\+json\">([\s\S]*?)<\/script>/g)||[]; m.forEach(s=>JSON.parse(s.replace(/<[^>]+>/g,''))); console.log('JSON-LD blocks valid:', m.length)"
```
Expected: all JSON-LD blocks parse.

- [ ] **Step 5: Commit.**

```bash
git add src/pages/fertility-preserving-surgery/index.astro
git commit -m "seo: JSON-LD @graph + AEO pass for fertility-preserving-surgery pillar"
```

---

## Phase 5: Registry and routing

### Task 5: Register the guide and add the route

**Files:**
- Modify: `ssot/guides.json` (the ONLY registry file to edit)
- Modify: `~/iCode/projects/rrm-router/src/index.js`

- [ ] **Step 1: Append ONE entry to `ssot/guides.json` only.** Do NOT touch `src/data/guides.json` (gitignored, auto-generated, derives `url` and `sectionHeadings` itself). Copy the field shape of the existing `rrm-success-rates` entry. Do NOT add `url` or `sectionHeadings`.

```json
{
  "slug": "fertility-preserving-surgery",
  "category": "compare",
  "file": "fertility-preserving-surgery/index.astro",
  "title": "Fertility-Preserving Surgery: Restorative, Specialist, and Conventional Approaches Compared",
  "description": "<=160 chars, plain English, what the guide compares>",
  "og_title": "<short OG title>",
  "og_description": "<=160 chars>",
  "author": "RRM Academy",
  "read_time": "<n> min read",
  "accent": "var(--purple-700)",
  "in_guides_catalogue": true,
  "in_shell_guides_nav": true,
  "_order": <next integer after current max>,
  "pageTitle": "Fertility-Preserving Surgery: Restorative, Specialist, and Conventional Approaches Compared",
  "pageDescription": "<=160 chars>",
  "pageH1": "Fertility-Preserving Surgery: Restorative, Specialist, and Conventional Approaches Compared",
  "breadcrumbName": "Fertility-Preserving Surgery",
  "authorId": "#organization",
  "reviewer": { "name": "Dr. Naomi Whittaker, MD", "id": "#naomi-whittaker" },
  "usesGuideLayout": true
}
```

- [ ] **Step 2: Regenerate the build-side registry and confirm it validates.**

```bash
node scripts/build-guides-data.mjs
node -e "const g=require('./src/data/guides.json'); console.log('entry present:', g.some(x=>x.slug==='fertility-preserving-surgery'))"
```
Expected: `entry present: true`.

- [ ] **Step 3: Add the route** `/fertility-preserving-surgery` to the `ASTRO_ROUTES` array in `rrm-router/src/index.js` (same pattern as other root pillars). Without this the page 404s on the apex even after the Pages deploy.

- [ ] **Step 4: Build to confirm the registry renders on `/guides/`.**

```bash
SITE_SSOT_ENABLED=0 npx astro build 2>&1 | tail -5
grep -c "fertility-preserving-surgery" dist/guides/index.html
```
Expected: count >= 1.

- [ ] **Step 5: Commit (rrm-academy-cf side; `ssot/guides.json` only, never the gitignored generated file).**

```bash
git add ssot/guides.json
git commit -m "guides: register fertility-preserving-surgery in guides registry"
```

(The rrm-router change is committed/deployed in its own repo at go-live, Task 7.)

---

## Phase 6: Gates and verification

### Task 6: Run all gates against the staged page

- [ ] **Step 1: Lint + design tokens.**

```bash
npm run lint && npm run design-tokens:check
```
Expected: both pass.

- [ ] **Step 2: web-page-qa render gate.** Serve the built page and screenshot at mobile (393x852) and desktop; confirm no horizontal overflow, the tier table is responsive, and the layout holds.

```bash
npx wrangler pages dev dist --port 8788 &
# then drive Playwright per the web-page-qa skill at http://localhost:8788/fertility-preserving-surgery/
```

- [ ] **Step 2b:** Invoke the `web-page-qa` skill on `/fertility-preserving-surgery/` at both viewports. Fix any overflow/layout failures.

- [ ] **Step 3: Citation liveness.** Every inline `/library/` link must resolve 200 on the live site (the records were published in Task 0).

```bash
grep -oE '/library/[a-z0-9-]+/' src/pages/fertility-preserving-surgery/index.astro | sort -u | while read p; do code=$(curl -s -o /dev/null -w "%{http_code}" "https://rrmacademy.org${p}"); echo "$code $p"; done
```
Expected: all `200`. Any non-200 means fix the slug or finish the ingest.

- [ ] **Step 4: Claim audit.** Re-read the page: every clinical claim has an adjacent `/library/` citation; PCOS framing matches the spec (preferred-but-honest); no em dashes, no Yes-leads, no absolutist copy, no patient funnel to Dr. Whittaker. Record the audit result in the research doc.

- [ ] **Step 5: Commit any fixes (stage each changed file by explicit name).**

```bash
git add src/pages/fertility-preserving-surgery/index.astro \
        src/data/fertility-preserving-surgery.json \
        docs/research/2026-06-13-fertility-preserving-surgery-evidence.md
git commit -m "qa: gate fixes for fertility-preserving-surgery pillar"
```

---

## Phase 7: Stage, review, go-live (gated)

### Task 7: Present staged build; deploy only on explicit go-live

- [ ] **Step 1: Push the branch and let the preview deploy build** (preview only; this does NOT publish to the apex because the rrm-router route is not yet added/deployed). Capture the `rrm-academy.pages.dev/fertility-preserving-surgery/` preview URL plus mobile + desktop screenshots.

- [ ] **Step 2: Present to Brian for go-live**: preview URL, screenshots, the claim ledger, the Gianna + rrma-seo-operator results, and the gate results. **Stop here.** Do not proceed without an explicit go-live from Brian (`feedback-mockup-gate-before-live-publish`).

- [ ] **Step 3 (only after go-live): Deploy the page via one explicit command, then deploy the router.** Single go-live mechanism is `workflow_dispatch` (not a bare git push):

```bash
# 1) rrm-academy-cf page deploy (explicit, not "auto on push")
gh workflow run deploy.yml
# 2) rrm-router: deploy with the ASTRO_ROUTES change so the apex resolves the new path
cd ~/iCode/projects/rrm-router && npx wrangler deploy
```

- [ ] **Step 4 (post-go-live): Verify live.**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://rrmacademy.org/fertility-preserving-surgery/   # expect 200
curl -s -o /dev/null -w "%{http_code}\n" "https://rrmacademy.org/og/fertility-preserving-surgery.png"  # expect 200
```

- [ ] **Step 5 (post-go-live): Cross-link + index.** Add internal links from `/endometriosis/`, `/pcos/`, `/naprotechnology/`, and `/what-is-rrm/` to the new pillar; submit via IndexNow; confirm it appears in the sitemap.

---

## Self-Review (completed at plan-write time)

- **Spec coverage:** thesis + tier model (Tasks 1-3), six conditions incl. PCOS wedge resection (Tasks 0-3), evidence pass + verified PMIDs (Task 0), SSOT JSON (Task 1), JSON-LD @graph (Task 4), guardrails (Tasks 3, 6), byline/conventions (Task 2), registry + routing (Task 5), AEO-citeable posture + plain-English intro (Tasks 3-4), Gianna + rrma-seo-operator checks (Tasks 3-4), held-at-go-live (Task 7). All spec sections map to a task.
- **Placeholder scan:** the only intentional placeholders are `<slug>`/`<PMID>` tokens filled from the Task 0 ledger (the research pass is genuinely upstream of the data file); no "TBD"/"add validation"/"similar to Task N".
- **Type consistency:** SSOT keys (`tiers[].shortLabel`, `conditions[].tierN`, `citationsHtml`) are used identically in Tasks 1, 2, 4. Shell key `'guides'` (not a per-slug key) consistent with the App Shell rules.
