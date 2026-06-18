# Striking-Distance AEO — Wave 1+2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the traffic-safe, additive AEO improvements for the striking-distance pages (MedicalCondition + Speakable schema, deepening internal links) and stage the new-content moves as drafts for explicit go-live.

**Architecture:** Append-only JSON-LD (new nodes into BaseLayout's `jsonLd` `@graph`, never mutate existing) + the existing `speakable` prop; markup-only internal links via the proven injector; all `.astro` edits in a clean worktree off `origin/main` with a local `npm run build` gate; D1 edits per-surface with durable revert snapshots; glossary edits via `/glossary-update`. Wave 3 (lede/title/H1 rewrites) is OUT.

**Tech Stack:** Astro 5 + CF Pages, `src/lib/schema-builders.mjs` pure builders, `test/schema-builders.test.js` node tests, `wrangler d1` (rrm-auth), `gh workflow run "Build & Deploy"`.

---

## Scope, postures, and the ship/gate split

| Posture | Pages | This plan does |
|---|---|---|
| DEFEND (5) | Naomi/Yeung/Pakiz spotlights, /donate/, /neofertility/ | additive-only: entity schema, inbound links. NO title/lede touch. |
| DEEPEN (11) | isthmocele (commentary+pillar), /femm/, NaPro-surgery, Creighton-vs-Marquette FAQ, letrozole/PCOS FAQ, cost + "what is RRM" FAQs, /naprotechnology/, /endometritis/, pcos-journey | additive schema + Speakable + cluster interlinks now; FAQ-section + Insights content = DRAFT→go-live |
| ATTACK (3) | /save-the-uterus-club/, rrm-explained, /endo-survey/ | additive parts only (destructive = Wave 3, held) |

**SHIP UNATTENDED (technical/additive — invisible JSON-LD + links, cannot lower a ranking):** Tasks 1-4 below.
**DRAFT → EXPLICIT GO-LIVE (new visible patient-facing prose):** Appendix A (not on the autonomous path).

**Already in place (Explore-confirmed, no work needed):** FAQ pages emit FAQPage; commentary emits BlogPosting + conditional full Person (Naomi, sameAs ORCID/NPI) + conditional FAQPage; library emits MedicalScholarlyArticle. So the schema gap is only **MedicalCondition** (nowhere) and **Speakable** (prop exists, underused).

## Pre-flight (run once, before any task)

- [ ] Capture the ranking baseline for slip-monitoring:
  `cp /Users/brian/Downloads/rrm-academy_overview_2026-06-17_12-51-39.csv ~/iCode/.run-log/aeo-baseline-2026-06-17.csv`
- [ ] **Slip threshold (numeric):** after deploy, re-pull ranks in ~7 days; **revert any change where a tracked keyword drops >3 positions vs baseline within 14 days.** Below that = noise.
- [ ] Create clean worktree off origin/main:
  `cd ~/iCode/projects/rrm-academy-cf && git fetch origin && git worktree add -b claude/aeo-wave1-schema /tmp/aeo-wt origin/main`
  Symlink deps + copy fresh data for the build gate:
  `ln -s ~/iCode/projects/rrm-academy-cf/node_modules /tmp/aeo-wt/node_modules && cp /tmp/sd3/*.json /tmp/aeo-wt/src/data/`
- [ ] Confirm no Person-schema collision: `grep -rn '"@type": "Person"' /tmp/aeo-wt/src/pages/` (expect only the Whittaker conditional in commentary).

## Revert (stated before execution)

- **.astro / schema (git):** `git -C ~/iCode/projects/rrm-academy-cf worktree remove --force /tmp/aeo-wt; git push origin --delete claude/aeo-wave1-schema` (pre-merge), or `git revert <sha> && push` (post-merge).
- **D1 links:** snapshot before edits → `~/iCode/.run-log/aeo-wave2-revert-2026-06-17/snapshots.json` + `revert.sql` (same mechanism proven earlier today); restore via `wrangler d1 execute rrm-auth --remote --file=revert.sql`.
- **Glossary:** edits go through `/glossary-update` (its own rollback in the skill).

---

### Task 1: `buildMedicalCondition()` pure builder (TDD)

**Files:**
- Modify: `src/lib/schema-builders.mjs` (add export)
- Test: `test/schema-builders.test.js` (add case)

- [ ] **Step 1: Write the failing test**
```js
test('buildMedicalCondition emits MedicalCondition with synonyms + ICD-10 + concept-level treatments', () => {
  const node = buildMedicalCondition({
    name: 'Uterine Isthmocele',
    alternateName: ['Cesarean Scar Defect', 'Niche'],
    icd10: 'N85.8',
    signs: ['postmenstrual spotting', 'pelvic pain', 'secondary infertility'],
    treatments: ['hysteroscopic repair', 'laparoscopic repair'],
  });
  assert.equal(node['@type'], 'MedicalCondition');
  assert.equal(node.name, 'Uterine Isthmocele');
  assert.deepEqual(node.alternateName, ['Cesarean Scar Defect', 'Niche']);
  assert.equal(node.code.codeValue, 'N85.8');
  assert.equal(node.code.codingSystem, 'ICD-10-CM');
  assert.equal(node.signOrSymptom.length, 3);
  assert.equal(node.possibleTreatment[0]['@type'], 'MedicalTherapy');
  assert.ok(!('@context' in node)); // graph-ready (no @context)
});
```
- [ ] **Step 2: Run, verify FAIL** — `cd /tmp/aeo-wt && node --test test/schema-builders.test.js` → FAIL "buildMedicalCondition is not defined"
- [ ] **Step 3: Implement minimal builder**
```js
export function buildMedicalCondition({ name, alternateName = [], icd10, signs = [], treatments = [], specialty = 'Gynecology' }) {
  const node = { '@type': 'MedicalCondition', name };
  if (alternateName.length) node.alternateName = alternateName;
  if (icd10) node.code = { '@type': 'MedicalCode', codeValue: icd10, codingSystem: 'ICD-10-CM' };
  if (signs.length) node.signOrSymptom = signs.map(s => ({ '@type': 'MedicalSignOrSymptom', name: s }));
  if (treatments.length) node.possibleTreatment = treatments.map(t => ({ '@type': 'MedicalTherapy', name: t }));
  node.relevantSpecialty = { '@type': 'MedicalSpecialty', name: specialty };
  return node;
}
```
- [ ] **Step 4: Run, verify PASS** — `node --test test/schema-builders.test.js`
- [ ] **Step 5: Commit** — `git add src/lib/schema-builders.mjs test/schema-builders.test.js && git commit -m "feat(schema): add buildMedicalCondition pure builder"`

### Task 2: MedicalCondition on the condition pillar pages

**Files:** Modify `src/pages/isthmocele/index.astro`, `src/pages/endometritis/index.astro` (append to the existing inline `@graph`; do NOT mutate the Article/MedicalWebPage nodes). Import `buildMedicalCondition` from `../../lib/schema-builders.mjs`.

- [ ] **Step 1:** In `isthmocele/index.astro`, after the existing jsonLd assembly, build the node (concept-level only, no dosing) and push it into the `@graph` array:
```js
import { buildMedicalCondition } from '../../lib/schema-builders.mjs';
const isthmoceleCondition = buildMedicalCondition({
  name: 'Uterine Isthmocele', alternateName: ['Cesarean Scar Defect', 'C-Section Scar Defect', 'Niche'],
  icd10: 'N85.8', signs: ['postmenstrual spotting', 'pelvic pain', 'secondary infertility'],
  treatments: ['hysteroscopic repair', 'laparoscopic repair'], specialty: 'Gynecology',
});
// jsonLd['@graph'].push(isthmoceleCondition)  -- adapt to the file's actual graph variable
```
- [ ] **Step 2:** Same for `endometritis/index.astro` — name 'Chronic Endometritis', alternateName ['CE'], icd10 'N71.9', signs ['abnormal uterine bleeding','pelvic pain','recurrent implantation failure','recurrent pregnancy loss'], treatments ['targeted antibiotic therapy','post-treatment re-biopsy'].
- [ ] **Step 3:** `cd /tmp/aeo-wt && npm run build` → exit 0.
- [ ] **Step 4:** Verify in dist: `grep -o '"@type":"MedicalCondition"' dist/isthmocele/index.html dist/endometritis/index.html | wc -l` → 2.
- [ ] **Step 5: Commit** — `git commit -am "feat(schema): MedicalCondition on isthmocele + endometritis pillars"`

### Task 3: Speakable on Deepen pillar + FAQ pages

**Files:** Modify the pillar pages `src/pages/femm/index.astro`, `src/pages/naprotechnology/index.astro`, `src/pages/isthmocele/index.astro`, `src/pages/endometritis/index.astro` to pass the BaseLayout `speakable` prop (selectors targeting the lead/definition + first H2). FAQ pages already have FAQPage; add `speakable` to the FAQ template's BaseLayout call pointing at the answer block.

- [ ] **Step 1:** Confirm the lead/definition selector on each pillar (inspect the rendered first content block; typically the intro `<p>` and first `<h2>`+`<p>`). Pass e.g. `speakable={['.article-lead', 'article h2:first-of-type + p']}` — adapt selectors to each page's actual markup.
- [ ] **Step 2:** `npm run build` → exit 0; `grep -o 'SpeakableSpecification' dist/femm/index.html dist/naprotechnology/index.html dist/isthmocele/index.html dist/endometritis/index.html | wc -l` → 4.
- [ ] **Step 3: Commit** — `git commit -am "feat(schema): Speakable on Deepen pillar + FAQ pages"`

### Task 4: Deepening internal links (incremental only)

**Files:** D1 (`rrm-auth` glossary/faq/posts) + pillar `.astro`. **Most cluster links were shipped earlier today (132 links, commit 3550adfc).** This task adds only the INCREMENTAL deepening links not already present.

- [ ] **Step 1:** Derive the incremental set: from the AEO cards' `internal_links`, dedupe against links already live (re-use the markup-only injector + `already_links` guard from `/tmp/inject_engine.py`). Glossary cross-links MUST use the per-term page form `/glossary/<slug>/`.
- [ ] **Step 2:** For glossary-source edits, route through `/glossary-update` (mandatory). For faq/commentary, per-surface D1 UPDATE with a fresh snapshot to `~/iCode/.run-log/aeo-wave2-revert-2026-06-17/`.
- [ ] **Step 3:** Assert change counts == expected per table (proven pattern).
- [ ] **Step 4:** No separate commit (D1).

### Task 5: Deploy + verify + monitor

- [ ] **Step 1:** Merge schema branch: push `claude/aeo-wave1-schema` (auto-merge), watch "Merge Claude Branches" → success, confirm merged to main.
- [ ] **Step 2:** Deploy: the merge triggers `Build & Deploy`; OR force `gh workflow run "Build & Deploy" --ref main`. Exact build: CI runs `npm run build`. Watch run → conclusion success. **Abort path:** if the build fails, prod is unchanged (last good build stays); report the failed run URL and halt, no retry.
- [ ] **Step 3:** Purge CF cache for changed URLs (token `op://Automation/CF - Cache Purge - rrmacademy/credential`, zone `88caaa4b9481e52bac74fe4e9d4787fd`), batches of 30, via curl (Python urllib dies on focusblock).
- [ ] **Step 4:** Verify live: `curl -s <url> | grep` each new MedicalCondition / Speakable / link present. Confirm targets 200.
- [ ] **Step 5:** Schedule the 7-day rank re-pull; apply the >3-position slip-revert rule.
- [ ] **Step 6:** Clean up worktree: `git worktree remove --force /tmp/aeo-wt`.

---

## Appendix A — DRAFT → EXPLICIT GO-LIVE (new visible content, NOT on the autonomous path)

These are the higher-impact AEO moves that add visible patient-facing prose. They are **gated** ([[feedback-mockup-gate-before-live-publish]], [[feedback-no-unsolicited-copy-on-pages]]) — drafted via **gianna-copywriter (model: sonnet)** under the RRM rules (no protocols/dosings, no absolutist patient copy, no patient-funnel-to-Naomi), presented as mockups, shipped only on explicit go-live.

- **Commentary FAQ sections** (isthmocele, NaPro-surgery): add a markdown "## Frequently Asked Questions" block with the live PAA questions → auto-triggers the commentary template's FAQPage schema. New visible Q&A copy = gated.
- **Direct-answer callouts** on Deepen pages (3-sentence "Quick Answer" under the lead). Gated.
- **Library Insights commentary** on the top high-AIO library pages (cervical cerclage, IGFBP7 hyperemesis, clomiphene antiestrogenic, etc.) — author-written extractable summary; abstract stays verbatim. Gated.
- **letrozole/PCOS FAQ**: verify the page does not frame letrozole as a step toward IUI/IVF (per brian-agent flag) before any deepening; concept-level only.

## Constraints honored throughout
- Person schema on spotlight pages: `name` = `Naomi M. Whittaker` (structured_name), `sameAs` = external authority IDs only (ORCID/NPI/Wikidata), **no `url` to a contact/scheduling endpoint**. Entity authority, never patient-funnel.
- Glossary edits → `/glossary-update` skill (mandatory).
- Additive-only (append schema, add links); zero destructive lede/title/URL changes.
- All new visible prose gated; ship only invisible JSON-LD + links unattended.
