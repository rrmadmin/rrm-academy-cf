# Getting Started Pillars Implementation Plan (2-Pillar Suite)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two new pillar pages at `/getting-started/` (patient) and `/for-providers/` (clinician) on rrmacademy.org, with the cross-pillar audience-router rail flipping from inert placeholder to live link when the second pillar ships.

**Architecture:** Static Astro pages built from `src/pages/<slug>/index.astro` using the established pillar template (BaseLayout + AppShellChrome via `<MaybeShell>`, `<SectionTocChips>` for mobile TOC). Cross-pillar rails use a shared `<AudienceRail>` Astro component with two modes (inert + live). 28 D-decisions in the v1.3 spec lock the design; this plan implements them mechanically. Cross-cutting prerequisites land in `rrm-library-worker` (errata_count column + PubMed parser) and rrm-academy-cf scripts (gate helpers, citation cron). Phase 1 ships patient pillar standalone (with inert provider rail); Phase 2 ships provider pillar in a single PR that also flips patient pillar's rail live.

**Tech Stack:** Astro 5.3 (static), Cloudflare Pages Functions, D1 (rrm-library + rrm-auth), GitHub Actions, `<MaybeShell>` + `<SectionTocChips>` shell components, `ssot/pillars.json` SSOT, `scripts/gates/*.mjs` deterministic gates, `/pillar-create` skill for drafting, `/rrm-ingest` skill for citation ingest, `/arise --deep` for pre-merge review.

**Spec:** `docs/superpowers/specs/2026-05-14-getting-started-pillars-design.md` (v1.3, 591 lines)

---

## Plan Amendments (2026-05-14, post-`brian` agent review)

The `brian` agent returned **CONDITIONALLY APPROVE** (10/15 checklist passed) with 13 required fixes before autonomous execution. This block documents all fixes; the original task text below remains for reference but is overridden by this section where they conflict.

### Autonomy Contract

**Cleared for autonomous (lights-off) execution tonight:** Tasks 4, 6, 7, 8, 9, 10. All are local-repo, no external API, no production state, git-revert-safe. Subagent-driven execution per the chosen path.

**Brian-supervised only — DO NOT execute without explicit go-ahead in the session:** Tasks 1, 2, 3, 5, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22. Reasons: remote D1 schema change (1), cross-repo deploys (2, 14, 21), live API token use (3, 11, 16), human-content draft review (13, 19, 20), single-source-of-truth registry edits with CI floor (12, 18), PR merge to main (15, 22). The original /arise-deep specifications still apply; the deferral is operational, not architectural.

**Abort triggers (any subagent at any task):**
- "permission denied" / "401" / "403" from any wrangler / curl / op command
- D1 schema mismatch or column-already-exists
- Wrangler interactive auth prompt
- Test suite regression on previously-passing tests
- Any check that would otherwise be skipped because tooling is missing

On abort: subagent reports BLOCKED with the exact stderr line and current task step; controller stops and surfaces to Brian. No retry loops.

### Per-Task Fixes (apply when the underlying task is later executed under supervision)

**Task 1 Step 5 — ALTER TABLE recovery (Critical):** D1 ALTER TABLE is not idempotent and has no transactional rollback. Before applying remotely:
1. Run a remote `PRAGMA table_info(article)` and grep for `errata_count`. If present, skip the ALTER TABLE statement; the migration was partially applied. Proceed to the index-create only.
2. If only `errata_count` exists but `last_errata_date` does not, apply just the second ALTER TABLE (separate file `migrations/0XX-add-errata-tracking-step2.sql`).
3. Recovery from "column already exists" is **not** retry-on-failure — it is **inspect-and-resume**. Document the partial-state in the commit message.

**Tasks 14 + 21 — Replace `npx wrangler deploy` in rrm-router (Critical):** Wrangler interactive auth hangs in lights-off contexts. Use the CF API + token pattern instead. The rrm-router deploy is gated as Brian-supervised regardless; when it runs under supervision, prefer:
```bash
source ~/.zshrc
CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/CF - Worker Deploy - account/credential') \
CLOUDFLARE_ACCOUNT_ID=$(op read 'op://Automation/CF - Worker Deploy - account/account_id') \
npx wrangler@4.86.0 deploy --no-bundle
```
If wrangler still prompts: fall back to `curl -X PUT https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/workers/scripts/rrm-router` with the multipart-form-data body. Document the chosen path in the PR.

**Tasks 3 + 11 — `op read` preamble (Serious):** Every shell that calls `op read` must first `source ~/.zshrc` so the 1Password service-account token is in env. Prepend to every Bash step that calls `op read`:
```bash
source ~/.zshrc && op read 'op://...'
```

**Task 5 — Actually implement SES (Serious):** Task 5 as written leaves SES notification as a `// TODO send SES email` comment. Replace with an aws4fetch call mirroring the existing pattern in `functions/api/_ses.js` (read that file first; do not invent the signature). The cron workflow runs in GitHub Actions, not in CF Pages, so it uses `aws4fetch` directly with the same `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SES_REGION` repo secrets that the cleanup cron already uses. If those secrets are not set in the rrm-academy-cf repo, do not implement the notification; instead, leave the script writing a `docs/citation-alerts-<date>.md` artifact and have the cron workflow upload-artifact + open a GitHub issue via `gh issue create`.

**Tasks 13 + 19 Step 4 — Formal PAUSE markers (Serious):** Both checkpoints are human-review gates buried in checkbox lists. Convert to:
```
> ⏸ PAUSE — HUMAN REVIEW REQUIRED ⏸
>
> Do not continue to Step 5. The /pillar-create skill has emitted a draft .astro file at:
>   src/pages/getting-started/index.astro  (Task 13)
>   src/pages/for-providers/index.astro    (Task 19)
>
> Brian must read the draft end-to-end, run /arise --deep on the draft, and either
> (a) request edits — restart at Step 4
> (b) approve as-is — proceed to Step 5
>
> No subagent may proceed past this marker without explicit "approved" from Brian.
```

**Task 11 Step 3 — Fix broken slug-extraction (Serious):** The literal `"..."` placeholder must be replaced. The correct pattern, mirroring `/rrm-ingest` skill output:
```bash
source ~/.zshrc
SLUG=$(rrm-cli search "Fuldeore endometriosis prevalence" --limit=1 --format=json | jq -r '.[0].slug')
test -n "$SLUG" && test "$SLUG" != "null" || { echo "ABORT: slug lookup failed"; exit 1; }
echo "Resolved slug: $SLUG"
```

**Task 3 Step 6 — Conditional file commit (Serious):** The flagged-errata markdown is created conditionally (only when `errata_count > 0` for any cited PMID). The commit step must check existence before staging:
```bash
if [ -f docs/errata-flagged-2026-05-14.md ]; then
  git add docs/errata-flagged-2026-05-14.md
fi
git add scripts/backfill-errata.mjs
git commit -m "feat(library): backfill errata data for pillar suite citations"
```

**Task 4 Step 6 — Replace "adjust based on current build chain" with a deterministic decision rule (Serious):** Read `package.json` `scripts.build` field; if it includes `&& node scripts/build-og-index.mjs`, insert `&& node scripts/build-pillar-reviews.mjs` after `build-og-index.mjs` and before any subsequent `&&`. If `build-og-index.mjs` is not chained in `build`, append `build-pillar-reviews.mjs` directly to `astro build` (i.e., `astro build && node scripts/build-pillar-reviews.mjs && npx pagefind --site dist`). Verify with `npm run build` locally; expected: pillar reviews JSON emitted to `src/data/pillar-reviews.json`. No guessing — the decision is mechanical.

**Task 15 Step 7 — IndexNow convention (Minor):** Read `~/iCode/projects/rrm-academy-cf/scripts/indexnow-ping.mjs` if it exists; otherwise use `curl -X POST 'https://api.indexnow.org/IndexNow' -H 'Content-Type: application/json' -d '{"host":"rrmacademy.org","key":"<key>","urlList":["https://rrmacademy.org/getting-started/"]}'` — the key is at `op read 'op://Automation/IndexNow Key/credential'` (verify path before relying). If neither the script nor the key exists, skip the IndexNow ping and document the skip in the PR description.

**Task 15 Step 5 — Replace `sleep 180` with poll (Minor):**
```bash
gh run watch --exit-status $(gh run list -L 1 --workflow=deploy.yml --json databaseId -q '.[0].databaseId')
```
or, if the deploy is triggered via `repository_dispatch`:
```bash
until curl -fsSL -o /dev/null -w '%{http_code}' https://rrmacademy.org/getting-started/ | grep -q 200; do sleep 15; done
```

**Task 3 backfill — Remove unused `@miniflare/d1` import (Minor):** The import was a stub. Delete it; the script uses `npx wrangler d1 execute` exclusively.

### Cleared-tier execution authorization (Tasks 4, 6, 7, 8, 9, 10)

These tasks add net-new files only (no modification of guarded files, no SQL writes, no external API calls, no CI workflow edits). All are git-revert-safe via `git checkout HEAD -- <new-file>` / `rm <new-file>`. Subagents in this tier may proceed end-to-end without re-checking in with the controller, provided the abort triggers above do not fire.

### Byline pattern lock (post-cleared-tier patch, per spec D49 / 2026-05-14)

Brian directive 2026-05-14: both new pillars use the canonical glossary-style author-byline pattern. Authoritative DOM template (matches `src/pages/glossary/index.astro` lines 260-271):

```html
<div class="author-byline">
  <div class="author-avatar-stack">
    <img src="/apple-touch-icon.png" alt="" aria-hidden="true" class="author-byline__photo" width="48" height="48" />
    <img src="/images/authors/naomi-whittaker.webp" alt="" aria-hidden="true" class="author-byline__photo" width="48" height="48" />
  </div>
  <div class="author-byline__text has-reviewer">
    <span class="byline-author">By <strong>RRM Academy</strong></span>
    <span class="byline-reviewer">Reviewed by <strong><a href="/commentary/rrm-spotlight-naomi-whittaker-md/">Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI</a></strong></span>
    <LastUpdated path="/getting-started/" prefix="Updated" class="byline-date" />
  </div>
</div>
```

Propagation table:

| Affected task | Change |
|---|---|
| Task 8 (built tonight) | Gate code MUST depth-aware-strip `<div class="author-byline">…</div>` (the simple non-greedy regex won't work because the wrapper has nested `<div>` children). Fix landed as a follow-up commit on the same branch. New test: glossary-style byline with full Naomi credentials must allowlist clean. |
| Task 12 (supervised — ssot patient entry) | `"author": "RRM Academy"` (matches the `/art-registries-and-codes/` precedent in `ssot/pillars.json`, NOT the `"Dr. Naomi Whittaker"` value used by the existing 11 clinical pillars). |
| Task 13 (supervised — patient draft) | When invoking `/pillar-create`, pass byline directive: org-authored + clinically reviewed pattern per D49, NOT primary-Naomi-author. The author-byline `<div>` block above is the rendered output the skill should emit. JSON-LD: `author = #organization`, `reviewedBy = #naomi-whittaker`. |
| Task 18 (supervised — ssot provider entry) | `"author": "RRM Academy"` (same as Task 12). |
| Task 19 (supervised — provider draft) | Same byline directive as Task 13. |
| Task 20 (supervised — back-edit) | No byline change needed; back-edit is rail-flip only. The patient pillar's byline shipped in Phase 1 and is unchanged in Phase 2. |

In-body references to Naomi by name remain disallowed in either pillar (no "Dr. Whittaker has shown" / "Dr. Naomi recommends" / etc.). Clinical authority on the page comes through the reviewer billing in the byline + `reviewedBy` in JSON-LD, not body prose.

---

## Pre-Phase: Prerequisites (Tasks 1-5)

These must complete before Phase 1 Week 1 starts. Some live in separate repos (`rrm-library-worker`); others are scripts that future tasks call.

---

### Task 1: rrm-library-worker errata_count schema migration

**Files:**
- Create: `~/iCode/projects/rrm-library-worker/migrations/0XX-add-errata-tracking.sql`
- Modify: `~/iCode/projects/rrm-library-worker/CLAUDE.md` (document new columns)

- [ ] **Step 1: Confirm baseline schema**

Run from `~/iCode/projects/rrm-library-worker/`:
```bash
ls migrations/ | sort -n | tail -5
```
Note the highest migration number; next migration is N+1. (Example: if highest is `0014-add-foo.sql`, this migration is `0015-add-errata-tracking.sql`.)

- [ ] **Step 2: Create migration file**

Replace `0XX` with the actual next number. Path: `migrations/0XX-add-errata-tracking.sql`:

```sql
-- Migration: add errata tracking to article table
-- Phase 1 prerequisite for rrm-academy-cf 2026-05-14 pillar suite (citation accuracy watch)

ALTER TABLE article ADD COLUMN errata_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE article ADD COLUMN last_errata_date TEXT;

CREATE INDEX idx_article_errata ON article(errata_count, last_errata_date) WHERE errata_count > 0;
```

- [ ] **Step 3: Apply migration to local D1 first**

```bash
npx wrangler d1 execute rrm-library --local --file=migrations/0XX-add-errata-tracking.sql
```
Expected: `Executed N commands` with no errors.

- [ ] **Step 4: Verify local schema**

```bash
npx wrangler d1 execute rrm-library --local --command "PRAGMA table_info(article)" | grep errata
```
Expected: two rows mentioning `errata_count` and `last_errata_date`.

- [ ] **Step 5: Apply to remote D1**

```bash
npx wrangler d1 execute rrm-library --remote --file=migrations/0XX-add-errata-tracking.sql
```
Expected: `Executed N commands` with no errors. If errors mention "column already exists," the migration was partially applied; resolve before continuing.

- [ ] **Step 6: Verify remote schema**

```bash
npx wrangler d1 execute rrm-library --remote --command "PRAGMA table_info(article)" | grep errata
```
Expected: two rows confirming errata columns exist remotely.

- [ ] **Step 7: Commit**

```bash
git add migrations/0XX-add-errata-tracking.sql CLAUDE.md
git commit -m "feat(d1): add errata_count + last_errata_date to article

Phase 1 prereq for rrm-academy-cf pillar suite (citation accuracy watch).
Both local + remote D1 migrated. PubMed parser extension follows in next commit."
```

---

### Task 2: rrm-library-worker PubMed ErratumIn parser

**Files:**
- Modify: `~/iCode/projects/rrm-library-worker/src/pubmed.js`
- Test: `~/iCode/projects/rrm-library-worker/test/pubmed-errata.test.mjs`

- [ ] **Step 1: Read existing pubmed.js to understand structure**

Read `src/pubmed.js` completely. Identify the function that handles `<CommentsCorrectionsList>` (already parses `RefType="RetractionIn"` per CLAUDE.md). The new logic adds a parallel branch for `RefType="ErratumIn"`.

- [ ] **Step 2: Write the failing test**

Create `test/pubmed-errata.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseErrataFromPubMed } from '../src/pubmed.js';

test('parseErrataFromPubMed returns errata_count=0 for record with no CommentsCorrectionsList', () => {
  const xml = `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>12345</PMID></MedlineCitation></PubmedArticle></PubmedArticleSet>`;
  const result = parseErrataFromPubMed(xml, '12345');
  assert.equal(result.errata_count, 0);
  assert.equal(result.last_errata_date, null);
});

test('parseErrataFromPubMed counts a single ErratumIn entry', () => {
  const xml = `<PubmedArticleSet><PubmedArticle>
    <MedlineCitation>
      <PMID>12345</PMID>
      <CommentsCorrectionsList>
        <CommentsCorrections RefType="ErratumIn">
          <RefSource>Erratum source citation</RefSource>
          <PMID>67890</PMID>
        </CommentsCorrections>
      </CommentsCorrectionsList>
    </MedlineCitation>
    <PubmedData><History><PubMedPubDate PubStatus="pubmed"><Year>2026</Year><Month>08</Month><Day>15</Day></PubMedPubDate></History></PubmedData>
  </PubmedArticle></PubmedArticleSet>`;
  const result = parseErrataFromPubMed(xml, '12345');
  assert.equal(result.errata_count, 1);
  assert.equal(result.last_errata_date, '2026-08-15');
});

test('parseErrataFromPubMed counts multiple ErratumIn entries and picks latest date', () => {
  const xml = `<PubmedArticleSet><PubmedArticle>
    <MedlineCitation>
      <PMID>12345</PMID>
      <CommentsCorrectionsList>
        <CommentsCorrections RefType="ErratumIn"><RefSource>A</RefSource><PMID>11111</PMID></CommentsCorrections>
        <CommentsCorrections RefType="ErratumIn"><RefSource>B</RefSource><PMID>22222</PMID></CommentsCorrections>
        <CommentsCorrections RefType="RetractionIn"><RefSource>C</RefSource><PMID>33333</PMID></CommentsCorrections>
      </CommentsCorrectionsList>
    </MedlineCitation>
    <PubmedData><History>
      <PubMedPubDate PubStatus="pubmed"><Year>2026</Year><Month>03</Month><Day>10</Day></PubMedPubDate>
      <PubMedPubDate PubStatus="revised"><Year>2026</Year><Month>09</Month><Day>20</Day></PubMedPubDate>
    </History></PubmedData>
  </PubmedArticle></PubmedArticleSet>`;
  const result = parseErrataFromPubMed(xml, '12345');
  assert.equal(result.errata_count, 2, 'ErratumIn counts, RetractionIn does NOT');
  assert.equal(result.last_errata_date, '2026-09-20');
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
node --test test/pubmed-errata.test.mjs
```
Expected: FAIL with "parseErrataFromPubMed is not exported" or undefined.

- [ ] **Step 4: Implement parser**

Add to `src/pubmed.js` (export at bottom alongside existing exports):

```javascript
export function parseErrataFromPubMed(xml, pmid) {
  const result = { errata_count: 0, last_errata_date: null };
  if (!xml || typeof xml !== 'string') return result;

  // Extract CommentsCorrectionsList block (greedy match for closing tag)
  const blockMatch = xml.match(/<CommentsCorrectionsList[^>]*>([\s\S]*?)<\/CommentsCorrectionsList>/);
  if (!blockMatch) return result;

  // Count ErratumIn entries (case-sensitive RefType attribute match)
  const erratumMatches = blockMatch[1].matchAll(/<CommentsCorrections\s+RefType="ErratumIn"[^>]*>/g);
  let count = 0;
  for (const _ of erratumMatches) count += 1;
  result.errata_count = count;

  if (count === 0) return result;

  // Extract latest PubMedPubDate (prefer "revised" status, fall back to "pubmed")
  const dateMatches = [...xml.matchAll(/<PubMedPubDate\s+PubStatus="(\w+)"[^>]*>\s*<Year>(\d{4})<\/Year>\s*<Month>(\d{1,2})<\/Month>\s*<Day>(\d{1,2})<\/Day>/g)];
  const dates = dateMatches.map(m => ({
    status: m[1],
    iso: `${m[2]}-${String(m[3]).padStart(2,'0')}-${String(m[4]).padStart(2,'0')}`,
  }));
  const revised = dates.find(d => d.status === 'revised');
  const pubmed = dates.find(d => d.status === 'pubmed');
  result.last_errata_date = (revised || pubmed)?.iso || null;

  return result;
}
```

- [ ] **Step 5: Run test to verify pass**

```bash
node --test test/pubmed-errata.test.mjs
```
Expected: all 3 tests pass.

- [ ] **Step 6: Wire into enrichment cron**

Find the enrichment-cron function in `src/index.js` or `src/enrichment.js` that calls existing PubMed parsing. After it stores `is_retracted`, add:

```javascript
const errata = parseErrataFromPubMed(xmlResponse, pmid);
await env.DB.prepare(
  'UPDATE article SET errata_count = ?, last_errata_date = ? WHERE pmid = ?'
).bind(errata.errata_count, errata.last_errata_date, pmid).run();
```

(Import `parseErrataFromPubMed` at top of file if needed.)

- [ ] **Step 7: Commit**

```bash
git add src/pubmed.js src/index.js test/pubmed-errata.test.mjs
git commit -m "feat(pubmed): parse ErratumIn from CommentsCorrectionsList

Counts <CommentsCorrections RefType=ErratumIn> entries and extracts
latest revised/pubmed PubDate. Enrichment cron now populates
article.errata_count + last_errata_date alongside is_retracted.

Phase 1 prereq for rrm-academy-cf pillar suite (citation accuracy watch)."
```

---

### Task 3: Backfill errata data for existing cited PMIDs

**Files:**
- Create: `~/iCode/projects/rrm-library-worker/scripts/backfill-errata.mjs`

- [ ] **Step 1: List cited PMIDs that need backfill**

The 8 cited papers in patient pillar + 8 in provider pillar share some entries. The deduped list of PMIDs to backfill (look these up via library worker D1):
- Boyle 2025 (`rec4qqhafqb8stlnd`)
- Stanford 2021 (`recyiv7uvglmix9ex`)
- Sánchez-Méndez 2025 (`recv02qu0r8ycnzoa`)
- Peragallo Urrutia 2018 (`recd5efxu6j5ww0j8`)
- Manhart 2013 (`recpanxsmpcrgo8zq`)
- Boyle 2018 (`recior3akxtg2a6ya`)
- Stanford 2022 iNEST (`recudgdct40otosdm`)
- Duane 2022 (`recsypcebszclpsk1`)
- Fuldeore 2017, Chandra 2014, Yeung 2025, Reeder 2026 (ingested during Phase 1/2; new entries auto-populated by enrichment cron)

Query to list current values:
```bash
npx wrangler d1 execute rrm-library --remote --command "SELECT slug, pmid, doi, errata_count, last_errata_date FROM article WHERE slug IN ('restorative-reproductive-medicine-rrm-outcomes-compared-to-in-vitro-fertilization-rec4qqhafqb8stlnd', 'restorative-reproductive-medicine-for-infertility-in-two-family-medicine-clinics-recyiv7uvglmix9ex', 'natural-procreative-technology-naprotechnology-for-infertility-take-home-baby-ra-recv02qu0r8ycnzoa', 'effectiveness-of-fertility-awareness-based-methods-for-pregnancy-prevention-a-sy-recd5efxu6j5ww0j8', 'fertility-awareness-based-methods-of-family-planning-a-review-of-effectiveness-f-recpanxsmpcrgo8zq', 'healthy-singleton-pregnancies-from-restorative-reproductive-medicine-rrm-after-f-recior3akxtg2a6ya', 'international-natural-procreative-technology-evaluation-and-surveillance-of-trea-recudgdct40otosdm', 'does-a-short-luteal-phase-correlate-with-an-increased-risk-of-miscarriage-a-coho-recsypcebszclpsk1')"
```

- [ ] **Step 2: Create backfill script**

Create `scripts/backfill-errata.mjs`:

```javascript
// One-shot backfill: re-fetch PubMed XML for cited PMIDs and populate errata_count + last_errata_date.
// Run with: node scripts/backfill-errata.mjs

import { parseErrataFromPubMed } from '../src/pubmed.js';
import { D1Database } from '@miniflare/d1';

const CITED_SLUGS = [
  'restorative-reproductive-medicine-rrm-outcomes-compared-to-in-vitro-fertilization-rec4qqhafqb8stlnd',
  'restorative-reproductive-medicine-for-infertility-in-two-family-medicine-clinics-recyiv7uvglmix9ex',
  'natural-procreative-technology-naprotechnology-for-infertility-take-home-baby-ra-recv02qu0r8ycnzoa',
  'effectiveness-of-fertility-awareness-based-methods-for-pregnancy-prevention-a-sy-recd5efxu6j5ww0j8',
  'fertility-awareness-based-methods-of-family-planning-a-review-of-effectiveness-f-recpanxsmpcrgo8zq',
  'healthy-singleton-pregnancies-from-restorative-reproductive-medicine-rrm-after-f-recior3akxtg2a6ya',
  'international-natural-procreative-technology-evaluation-and-surveillance-of-trea-recudgdct40otosdm',
  'does-a-short-luteal-phase-correlate-with-an-increased-risk-of-miscarriage-a-coho-recsypcebszclpsk1',
];

async function fetchPubMedXml(pmid) {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml`;
  const headers = process.env.NCBI_API_KEY ? { 'api-key': process.env.NCBI_API_KEY } : {};
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`PubMed fetch failed: ${r.status}`);
  return r.text();
}

const rows = await fetch('https://rrm-library-worker.administrator-cloudflare.workers.dev/articles?slugs=' + CITED_SLUGS.join(','), {
  headers: { Authorization: `Bearer ${process.env.WORKER_AUTH_TOKEN}` }
}).then(r => r.json());

for (const row of rows.articles) {
  if (!row.pmid) {
    console.log(`SKIP ${row.slug}: no PMID`);
    continue;
  }
  const xml = await fetchPubMedXml(row.pmid);
  const errata = parseErrataFromPubMed(xml, row.pmid);
  console.log(`${row.slug}: pmid=${row.pmid} errata_count=${errata.errata_count} last_errata_date=${errata.last_errata_date}`);
  // Submit update via admin endpoint or direct D1 if running with wrangler bindings.
  await new Promise(r => setTimeout(r, 350)); // NCBI rate limit
}
```

- [ ] **Step 3: Run backfill**

Load `WORKER_AUTH_TOKEN` and `NCBI_API_KEY` from 1Password:
```bash
export WORKER_AUTH_TOKEN=$(op read "op://Automation/Library worker token/credential")
export NCBI_API_KEY=$(op read "op://Automation/NCBI API key/credential")
node scripts/backfill-errata.mjs
```
Expected: 8 lines printed, most with `errata_count=0`. Any non-zero values indicate citations that already need replacement consideration.

- [ ] **Step 4: If non-zero erratum found, flag immediately**

Any cited paper with `errata_count > 0` requires Brian's review before Phase 1 ships. Record findings in `~/iCode/projects/rrm-library-worker/docs/errata-flagged-2026-05-14.md` with PMID, slug, and date.

- [ ] **Step 5: Apply UPDATE statements via wrangler**

For each row, run:
```bash
npx wrangler d1 execute rrm-library --remote --command "UPDATE article SET errata_count = N, last_errata_date = 'YYYY-MM-DD' WHERE slug = 'SLUG'"
```
(Or modify script to call worker admin endpoint that does the UPDATE.)

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-errata.mjs docs/errata-flagged-2026-05-14.md
git commit -m "feat(backfill): populate errata_count for cited pillar PMIDs

Phase 1 prereq for rrm-academy-cf pillar suite. Re-fetched PubMed XML
for 8 currently-cited papers; populated errata_count + last_errata_date
fields added in prior commit. Any flagged errata logged for review."
```

---

### Task 4: build-pillar-reviews.mjs script + JSON emit

**Files:**
- Create: `scripts/build-pillar-reviews.mjs`
- Modify: `package.json` (add to `build` chain)
- Modify: `scripts/build-guides-data.mjs` (read pillar-reviews.json when emitting guides.json) - read this file first to understand existing patterns
- Test: `scripts/build-pillar-reviews.test.mjs`

This script extracts `lastReviewed` frontmatter from each pillar `.astro` file and emits `src/data/pillar-reviews.json` for the quarterly citation cron to compare against.

- [ ] **Step 1: Read existing build script for pattern reference**

```bash
cat scripts/build-guides-data.mjs | head -50
```
Note the file-discovery + frontmatter-parsing pattern used. Mirror it.

- [ ] **Step 2: Write the failing test**

Create `scripts/build-pillar-reviews.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLastReviewed } from './build-pillar-reviews.mjs';

test('extractLastReviewed returns ISO date from frontmatter', () => {
  const astro = `---
const lastReviewed = '2026-05-14';
const title = 'Test';
---
<h1>x</h1>`;
  assert.equal(extractLastReviewed(astro), '2026-05-14');
});

test('extractLastReviewed returns null when not present', () => {
  const astro = `---
const title = 'Test';
---
<h1>x</h1>`;
  assert.equal(extractLastReviewed(astro), null);
});

test('extractLastReviewed handles double-quoted value', () => {
  const astro = `---
const lastReviewed = "2026-05-14";
---`;
  assert.equal(extractLastReviewed(astro), '2026-05-14');
});

test('extractLastReviewed rejects malformed date', () => {
  const astro = `---
const lastReviewed = 'not-a-date';
---`;
  assert.equal(extractLastReviewed(astro), null);
});
```

- [ ] **Step 3: Run test, verify fail**

```bash
node --test scripts/build-pillar-reviews.test.mjs
```
Expected: FAIL with "extractLastReviewed is not exported."

- [ ] **Step 4: Implement build script**

Create `scripts/build-pillar-reviews.mjs`:

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SSOT_PATH = path.join(__dirname, '..', 'ssot', 'pillars.json');
const PAGES_DIR = path.join(__dirname, '..', 'src', 'pages');
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'data', 'pillar-reviews.json');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function extractLastReviewed(astroSource) {
  const match = astroSource.match(/const\s+lastReviewed\s*=\s*['"]([^'"]+)['"]/);
  if (!match) return null;
  return ISO_DATE_RE.test(match[1]) ? match[1] : null;
}

function main() {
  const ssot = JSON.parse(fs.readFileSync(SSOT_PATH, 'utf8'));
  const reviews = {};

  for (const pillar of ssot.pillars) {
    const filePath = path.join(PAGES_DIR, pillar.file);
    if (!fs.existsSync(filePath)) {
      console.warn(`[pillar-reviews] missing: ${filePath}`);
      reviews[pillar.slug] = null;
      continue;
    }
    const src = fs.readFileSync(filePath, 'utf8');
    const lastReviewed = extractLastReviewed(src);
    reviews[pillar.slug] = lastReviewed;
    if (!lastReviewed) {
      console.warn(`[pillar-reviews] ${pillar.slug}: no lastReviewed frontmatter`);
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(reviews, null, 2) + '\n');
  console.log(`[pillar-reviews] wrote ${Object.keys(reviews).length} entries to ${OUTPUT_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
node --test scripts/build-pillar-reviews.test.mjs
```
Expected: all 4 tests pass.

- [ ] **Step 6: Wire into npm build**

Read `package.json`. Find the `build` script. Add `node scripts/build-pillar-reviews.mjs` BEFORE `astro build`:

```json
"build": "node scripts/build-pillar-reviews.mjs && astro build && npx pagefind --site dist"
```

(Adjust based on current build chain; insert pillar-reviews after ssot-prebuild but before astro.)

- [ ] **Step 7: Test build chain end-to-end**

```bash
npm run build 2>&1 | grep pillar-reviews
```
Expected: log line indicating pillar-reviews.json was written. Check `src/data/pillar-reviews.json` exists and contains current pillar slugs.

- [ ] **Step 8: Add `src/data/pillar-reviews.json` to .gitignore**

It's a build artifact, not source-of-truth. Read .gitignore; add line `src/data/pillar-reviews.json` if not present.

- [ ] **Step 9: Commit**

```bash
git add scripts/build-pillar-reviews.mjs scripts/build-pillar-reviews.test.mjs package.json .gitignore
git commit -m "feat(build): emit pillar-reviews.json from .astro lastReviewed frontmatter

Phase 1 prereq for citation accuracy watch (quarterly erratum cron
compares against this). Build emits to src/data/pillar-reviews.json,
gitignored as a build artifact."
```

---

### Task 5: Daily citation-link cron via GitHub Actions

**Files:**
- Create: `.github/workflows/verify-pillar-citations.yml`
- Create: `scripts/cron/verify-pillar-citations.mjs`

- [ ] **Step 1: Create the cron script**

Create directory and file `scripts/cron/verify-pillar-citations.mjs`:

```javascript
// Daily cron: verify every /library/<slug>/ URL referenced on shipped pillars returns 200.
// SES email on any failure (overwatch-worker pattern).
// Runs in GitHub Actions per .github/workflows/verify-pillar-citations.yml.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SSOT_PATH = path.join(__dirname, '..', '..', 'ssot', 'pillars.json');
const PAGES_DIR = path.join(__dirname, '..', '..', 'src', 'pages');
const SITE_URL = 'https://rrmacademy.org';

const SLUG_REGEX = /\/library\/([a-z0-9-]+)\//g;

async function run() {
  const ssot = JSON.parse(fs.readFileSync(SSOT_PATH, 'utf8'));
  const failures = [];
  let checked = 0;

  for (const pillar of ssot.pillars) {
    const filePath = path.join(PAGES_DIR, pillar.file);
    if (!fs.existsSync(filePath)) continue;
    const src = fs.readFileSync(filePath, 'utf8');
    const slugs = new Set();
    for (const m of src.matchAll(SLUG_REGEX)) slugs.add(m[1]);
    if (!slugs.size) continue;

    for (const slug of slugs) {
      const url = `${SITE_URL}/library/${slug}/`;
      try {
        const r = await fetch(url, { method: 'HEAD', redirect: 'manual' });
        checked += 1;
        if (r.status !== 200) {
          failures.push({ pillar: pillar.slug, slug, status: r.status, url });
        }
      } catch (err) {
        failures.push({ pillar: pillar.slug, slug, status: 'fetch-error', error: err.message, url });
      }
      await new Promise(r => setTimeout(r, 100));
    }
  }

  console.log(`[citation-cron] checked ${checked} URLs, ${failures.length} failures`);
  if (failures.length === 0) return;

  // Send SES email via aws4fetch (or simpler: use existing functions/api/_ses.js pattern).
  const body = failures.map(f => `- ${f.pillar}: ${f.url} -> ${f.status}${f.error ? ' (' + f.error + ')' : ''}`).join('\n');
  console.error('[citation-cron] FAILURES:\n' + body);

  if (process.env.GITHUB_ACTIONS) {
    // Emit as workflow annotation
    for (const f of failures) {
      console.log(`::error file=${f.pillar}::Pillar ${f.pillar} cites broken /library/${f.slug}/ (${f.status})`);
    }
  }

  // SES dispatch via aws4fetch (paste minimal SES sendEmail call here if exporting to action env vars):
  // Or rely on GitHub Actions failure notification to administrator@rrmacademy.org via repo settings.
  process.exit(1);
}

run().catch(err => {
  console.error('[citation-cron] FATAL:', err);
  process.exit(2);
});
```

- [ ] **Step 2: Create GitHub Actions workflow**

Create `.github/workflows/verify-pillar-citations.yml`:

```yaml
name: Verify pillar citations

on:
  schedule:
    - cron: '17 7 * * *'  # 07:17 UTC daily (avoid round-hour congestion)
  workflow_dispatch:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Run citation verifier
        run: node scripts/cron/verify-pillar-citations.mjs
```

- [ ] **Step 3: Test the script locally against staging**

(Phase 1 has no shipped pillar yet, so script should report 0 failures.)

```bash
node scripts/cron/verify-pillar-citations.mjs
```
Expected: `[citation-cron] checked 0 URLs, 0 failures` (since no /library/ slugs in not-yet-shipped pillars).

- [ ] **Step 4: Configure GitHub Actions failure notification**

Verify repo settings: Settings → Notifications → administrator@rrmacademy.org receives workflow-failure emails. (Existing convention per CLAUDE.md "Down Detector" pattern.)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/verify-pillar-citations.yml scripts/cron/verify-pillar-citations.mjs
git commit -m "feat(cron): daily citation-link verifier

GitHub Actions schedule at 07:17 UTC daily. Greps every shipped
pillar's index.astro for /library/<slug>/ URLs and HEADs each against
production. SES failure notification routes via repo settings to
administrator@rrmacademy.org.

Phase 1 prereq for citation accuracy watch."
```

---

## Shared Infrastructure (Tasks 6-10)

These build the cross-cutting components and gate helpers used by both pillars.

---

### Task 6: AudienceRail.astro component (inert + live modes)

**Files:**
- Create: `src/components/AudienceRail.astro`
- Create: `src/styles/audience-rail.css` (or extend design tokens)
- Modify: `docs/design/design-system.manual.json` (add `.audience-rail--inert` token row)

- [ ] **Step 1: Read existing rail-style precedent**

Read `src/components/Header.astro` or any existing component using `.cta-card` / `.callout` to match house style.

- [ ] **Step 2: Create AudienceRail.astro**

Path: `src/components/AudienceRail.astro`:

```astro
---
/**
 * Cross-pillar audience-router rail.
 * Two modes: 'live' (target sibling exists) | 'inert' (sibling not yet shipped).
 * Inert markup follows spec §8 / D38: <span role="link" aria-disabled="true">,
 * NO aria-label override (WCAG 2.5.3 accessible-name-must-contain-visible-text).
 */
interface Props {
  href: string;          // e.g., "/for-providers/"
  text: string;          // visible text, e.g., "Are you a clinician? Read RRM For Providers"
  mode: 'live' | 'inert';
}

const { href, text, mode } = Astro.props;
---

{mode === 'live' && (
  <a class="audience-rail" href={href}>{text}</a>
)}

{mode === 'inert' && (
  <span
    class="audience-rail audience-rail--inert"
    role="link"
    aria-disabled="true"
    data-rail-state="inert"
    data-future-href={href}
  >
    {text}<span class="sr-only"> (coming soon)</span>
  </span>
)}

<style>
  .audience-rail {
    display: inline-block;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: var(--color-link);
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-border-subtle);
    transition: background 120ms ease, border-color 120ms ease;
  }

  .audience-rail:hover {
    background: var(--color-surface-hover);
    border-color: var(--color-border-strong);
  }

  .audience-rail--inert {
    color: var(--color-text-secondary);
    opacity: 0.65;
    cursor: not-allowed;
    border-style: dashed;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
```

- [ ] **Step 3: Add CSS tokens to design-system.manual.json**

Read `docs/design/design-system.manual.json` to find the components section. Add (or merge):

```json
{
  "components": {
    "audience-rail": {
      "padding": "var(--space-3) var(--space-4)",
      "border-radius": "var(--radius-md)",
      "states": {
        "live": { "color": "var(--color-link)", "border": "1px solid var(--color-border-subtle)" },
        "inert": { "color": "var(--color-text-secondary)", "opacity": "0.65", "border-style": "dashed", "cursor": "not-allowed" }
      }
    }
  }
}
```

Then run `npm run design-tokens` to regenerate `docs/design/design-system.json`.

- [ ] **Step 4: Smoke test by importing into a test page**

Create `src/pages/dev/audience-rail-smoke.astro` (gitignore later):

```astro
---
import AudienceRail from '../../components/AudienceRail.astro';
---
<html>
  <body>
    <p>Live mode:</p>
    <AudienceRail href="/for-providers/" text="Are you a clinician? Read RRM For Providers" mode="live" />
    <p>Inert mode:</p>
    <AudienceRail href="/for-providers/" text="Are you a clinician? Read RRM For Providers" mode="inert" />
  </body>
</html>
```

Run `npm run dev` and visit `http://localhost:4321/dev/audience-rail-smoke`. Verify:
- Live mode renders as `<a href>`, fully styled, clickable
- Inert mode renders as `<span role="link" aria-disabled="true" data-rail-state="inert" data-future-href="/for-providers/">` with dashed border + reduced opacity
- Screen-reader output (via macOS VoiceOver test): "Are you a clinician? Read RRM For Providers (coming soon), dimmed link"

Delete the smoke test file before commit (or add to .gitignore).

- [ ] **Step 5: Commit**

```bash
git add src/components/AudienceRail.astro docs/design/design-system.manual.json docs/design/design-system.json
git commit -m "feat(components): add AudienceRail (inert + live modes)

Cross-pillar audience-router rail per spec §8 / D38. Live mode emits
<a href>; inert mode emits <span role=link aria-disabled data-rail-state
data-future-href>, NO aria-label override (WCAG 2.5.3 compliance).
Back-edit flips inert→live by replacing entire <span> with <a>."
```

---

### Task 7: Cross-pillar rail verification helper (3-mode + inverted)

**Files:**
- Create: `scripts/gates/validate-cross-pillar-rails.mjs`
- Test: `scripts/gates/validate-cross-pillar-rails.test.mjs`

Helper supports four modes used by §12 gates:
- `--mode=back-edit --target=/X/` (gate #5a: post-back-edit, target rail must be live `<a>`)
- `--mode=no-leftovers` (gate #5b: no `data-future-href` / `data-rail-state` / `aria-disabled` anywhere)
- `--mode=new-ship --sibling=/X/` (gate #5c: new pillar must contain LIVE rail to already-shipped sibling)
- `--mode=inverted --target=/X/` (rollback: assert rail is back to inert; live `<a>` to target absent)

- [ ] **Step 1: Write failing tests**

Create `scripts/gates/validate-cross-pillar-rails.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRails } from './validate-cross-pillar-rails.mjs';

const LIVE_HTML = `<html><body><a class="audience-rail" href="/for-providers/">Are you a clinician?</a></body></html>`;
const INERT_HTML = `<html><body><span class="audience-rail audience-rail--inert" role="link" aria-disabled="true" data-rail-state="inert" data-future-href="/for-providers/">Are you a clinician?<span class="sr-only"> (coming soon)</span></span></body></html>`;
const LEFTOVER_HTML = `<html><body><a class="audience-rail" href="/for-providers/" data-future-href="/for-providers/">Are you a clinician?</a></body></html>`;

test('back-edit mode: live rail to target passes', () => {
  const r = checkRails(LIVE_HTML, { mode: 'back-edit', target: '/for-providers/' });
  assert.equal(r.ok, true);
});

test('back-edit mode: inert rail to target fails', () => {
  const r = checkRails(INERT_HTML, { mode: 'back-edit', target: '/for-providers/' });
  assert.equal(r.ok, false);
  assert.match(r.error, /not converted to live/);
});

test('no-leftovers mode: clean live rail passes', () => {
  const r = checkRails(LIVE_HTML, { mode: 'no-leftovers' });
  assert.equal(r.ok, true);
});

test('no-leftovers mode: lone data-future-href fails', () => {
  const r = checkRails(LEFTOVER_HTML, { mode: 'no-leftovers' });
  assert.equal(r.ok, false);
  assert.match(r.error, /data-future-href/);
});

test('no-leftovers mode: inert rail (during Phase 1) is legitimate; should fail no-leftovers explicitly', () => {
  // Use no-leftovers ONLY post-back-edit. Inert state has these attrs by design.
  const r = checkRails(INERT_HTML, { mode: 'no-leftovers' });
  assert.equal(r.ok, false);
});

test('new-ship mode: pillar contains live rail to already-shipped sibling', () => {
  const r = checkRails(LIVE_HTML, { mode: 'new-ship', sibling: '/for-providers/' });
  assert.equal(r.ok, true);
});

test('new-ship mode: pillar missing rail to sibling fails', () => {
  const r = checkRails('<html><body><p>no rail</p></body></html>', { mode: 'new-ship', sibling: '/getting-started/' });
  assert.equal(r.ok, false);
});

test('inverted (rollback) mode: inert rail present, live rail absent passes', () => {
  const r = checkRails(INERT_HTML, { mode: 'inverted', target: '/for-providers/' });
  assert.equal(r.ok, true);
});

test('inverted mode: live rail still present fails rollback verification', () => {
  const r = checkRails(LIVE_HTML, { mode: 'inverted', target: '/for-providers/' });
  assert.equal(r.ok, false);
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
node --test scripts/gates/validate-cross-pillar-rails.test.mjs
```
Expected: FAIL with `checkRails is not a function`.

- [ ] **Step 3: Implement validator**

Create `scripts/gates/validate-cross-pillar-rails.mjs`:

```javascript
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

export function checkRails(html, opts) {
  const { mode, target, sibling } = opts;

  const hasLiveRailTo = (href) => {
    const re = new RegExp(`<a[^>]*class="[^"]*audience-rail[^"]*"[^>]*href="${escapeRegex(href)}"`);
    return re.test(html);
  };
  const hasInertRailTo = (href) => {
    const re = new RegExp(`<span[^>]*data-rail-state="inert"[^>]*data-future-href="${escapeRegex(href)}"`);
    return re.test(html) || new RegExp(`<span[^>]*data-future-href="${escapeRegex(href)}"[^>]*data-rail-state="inert"`).test(html);
  };

  if (mode === 'back-edit') {
    if (!target) return { ok: false, error: 'back-edit mode requires --target' };
    if (!hasLiveRailTo(target)) return { ok: false, error: `back-edit not converted to live: no <a class="audience-rail" href="${target}">` };
    return { ok: true };
  }

  if (mode === 'no-leftovers') {
    if (/data-future-href/.test(html)) return { ok: false, error: 'data-future-href attribute lingers post-back-edit' };
    if (/data-rail-state/.test(html)) return { ok: false, error: 'data-rail-state attribute lingers post-back-edit' };
    if (/aria-disabled="true"/.test(html) && /audience-rail/.test(html)) return { ok: false, error: 'aria-disabled="true" lingers on audience-rail element' };
    return { ok: true };
  }

  if (mode === 'new-ship') {
    if (!sibling) return { ok: false, error: 'new-ship mode requires --sibling' };
    if (!hasLiveRailTo(sibling)) return { ok: false, error: `new pillar missing live rail to already-shipped sibling: ${sibling}` };
    return { ok: true };
  }

  if (mode === 'inverted') {
    if (!target) return { ok: false, error: 'inverted mode requires --target' };
    if (hasLiveRailTo(target)) return { ok: false, error: `rollback verification failed: live rail to ${target} still present` };
    if (!hasInertRailTo(target)) return { ok: false, error: `rollback verification failed: inert rail to ${target} not restored` };
    return { ok: true };
  }

  return { ok: false, error: `unknown mode: ${mode}` };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--(\w[\w-]*)=?(.*)$/);
    if (m) out[m[1]] = m[2] || argv[++i];
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args.file || args.f;
  if (!filePath) {
    console.error('Usage: validate-cross-pillar-rails.mjs --file=dist/PILLAR/index.html --mode=MODE [--target=URL] [--sibling=URL]');
    process.exit(2);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  const html = fs.readFileSync(filePath, 'utf8');
  const result = checkRails(html, args);
  if (result.ok) {
    console.log(`OK: ${args.mode}${args.target ? ' target=' + args.target : ''}${args.sibling ? ' sibling=' + args.sibling : ''}`);
    process.exit(0);
  } else {
    console.error(`FAIL: ${result.error}`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
node --test scripts/gates/validate-cross-pillar-rails.test.mjs
```
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/gates/validate-cross-pillar-rails.mjs scripts/gates/validate-cross-pillar-rails.test.mjs
git commit -m "feat(gates): cross-pillar rail validator (4 modes)

Supports gate #5a (back-edit), #5b (no-leftovers), #5c (new-ship),
plus --inverted for rollback verification. Tested against three
canonical rail HTML shapes. Phase 1 + Phase 2 wired in §12 gates."
```

---

### Task 8: Naomi-attribution grep gate (with Whitaker typo coverage)

**Files:**
- Create: `scripts/gates/validate-naomi-attribution.mjs`
- Test: `scripts/gates/validate-naomi-attribution.test.mjs`

Per spec D42: regex covers `Whit{1,2}aker` to catch the one-t whisper-transcript typo documented in `feedback-whisper-whittaker-typo.md`. Allowlist: byline DOM area (Naomi byline is permitted on patient + provider pillars in clinical-authority context per HARD RULE).

- [ ] **Step 1: Write failing tests**

Create `scripts/gates/validate-naomi-attribution.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNaomiAttribution } from './validate-naomi-attribution.mjs';

test('patient pillar: byline area contains Naomi, body does not - pass', () => {
  const html = `<html><body>
    <div class="byline">Dr. Naomi Whittaker, MD</div>
    <article><h2>Section</h2><p>RRM is...</p></article>
  </body></html>`;
  const r = checkNaomiAttribution(html, { pillar: 'getting-started' });
  assert.equal(r.ok, true);
});

test('patient pillar: Naomi in body fails', () => {
  const html = `<html><body>
    <div class="byline">Dr. Naomi Whittaker, MD</div>
    <article><p>Dr. Whittaker has discussed...</p></article>
  </body></html>`;
  const r = checkNaomiAttribution(html, { pillar: 'getting-started' });
  assert.equal(r.ok, false);
  assert.match(r.error, /body prose contains Naomi attribution/);
});

test('patient pillar: Whitaker (one t) typo in body fails', () => {
  const html = `<html><body>
    <div class="byline">Dr. Naomi Whittaker, MD</div>
    <article><p>As Dr. Whitaker noted...</p></article>
  </body></html>`;
  const r = checkNaomiAttribution(html, { pillar: 'getting-started' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Whitaker/);
});

test('patient pillar: MIGS in body fails', () => {
  const html = `<html><body>
    <div class="byline">Dr. Naomi Whittaker, MD, MIGS</div>
    <article><p>Per MIGS guidelines...</p></article>
  </body></html>`;
  const r = checkNaomiAttribution(html, { pillar: 'getting-started' });
  assert.equal(r.ok, false);
});

test('patient pillar: ORCID in body fails', () => {
  const html = `<html><body>
    <div class="byline">Dr. Whittaker</div>
    <article><p>See 0000-0003-3706-3112 for...</p></article>
  </body></html>`;
  const r = checkNaomiAttribution(html, { pillar: 'getting-started' });
  assert.equal(r.ok, false);
});

test('provider pillar: same rules apply', () => {
  const html = `<html><body>
    <div class="byline">Dr. Naomi Whittaker</div>
    <article><p>Dr. Whittaker recommends...</p></article>
  </body></html>`;
  const r = checkNaomiAttribution(html, { pillar: 'for-providers' });
  assert.equal(r.ok, false);
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
node --test scripts/gates/validate-naomi-attribution.test.mjs
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `scripts/gates/validate-naomi-attribution.mjs`:

```javascript
#!/usr/bin/env node
import fs from 'node:fs';

const ATTR_REGEX = /\b(Naomi|Whit{1,2}aker|MIGS|NFPMC|0000-0003-3706-3112|1881034908|rrm-spotlight-naomi-whittaker)\b/g;

export function checkNaomiAttribution(html, opts) {
  // Strip byline area (allowlisted: Naomi byline is permitted in clinical-authority context).
  // Byline is identified by class="byline" wrapper.
  const stripped = html.replace(/<[^>]*class="[^"]*\bbyline\b[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, '');
  // Also strip <header> + JSON-LD <script type="application/ld+json"> blocks (Naomi @id in author is permitted).
  const stripped2 = stripped
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<script\s+type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi, '');

  const matches = [...stripped2.matchAll(ATTR_REGEX)];
  if (matches.length === 0) return { ok: true };
  const hits = matches.map(m => m[0]).filter((v, i, a) => a.indexOf(v) === i);
  return { ok: false, error: `body prose contains Naomi attribution: ${hits.join(', ')}` };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--(\w[\w-]*)=?(.*)$/);
    if (m) out[m[1]] = m[2] || argv[++i];
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args.file || args.f;
  if (!filePath || !args.pillar) {
    console.error('Usage: validate-naomi-attribution.mjs --file=dist/PILLAR/index.html --pillar=PILLAR_SLUG');
    process.exit(2);
  }
  const html = fs.readFileSync(filePath, 'utf8');
  const result = checkNaomiAttribution(html, args);
  if (result.ok) {
    console.log(`OK: ${args.pillar} clean`);
    process.exit(0);
  } else {
    console.error(`FAIL: ${result.error}`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
node --test scripts/gates/validate-naomi-attribution.test.mjs
```
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/gates/validate-naomi-attribution.mjs scripts/gates/validate-naomi-attribution.test.mjs
git commit -m "feat(gates): Naomi-attribution validator with Whitaker typo coverage

Greps body prose (excluding byline / header / JSON-LD blocks where
Naomi attribution is permitted by HARD RULE). Regex Whit{1,2}aker
catches the one-t whisper-transcript typo per feedback-whisper-
whittaker-typo.md memory."
```

---

### Task 9: FAQ no-affirmative-lead gate (HTML-aware)

**Files:**
- Create: `scripts/gates/faq-no-affirmative-lead.mjs`
- Test: `scripts/gates/faq-no-affirmative-lead.test.mjs`

Per spec D27: parses `<dd>` FAQ-accordion answers, strips leading whitespace + opening tags, asserts first 20 chars do not match strong-affirmative regex.

- [ ] **Step 1: Write failing tests**

Create `scripts/gates/faq-no-affirmative-lead.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFaqAnswers } from './faq-no-affirmative-lead.mjs';

test('clean FAQ passes', () => {
  const html = `<dl class="faq">
    <dt>Q1?</dt><dd>In many cases, yes. But the evidence shows...</dd>
    <dt>Q2?</dt><dd>No, that is a misconception.</dd>
  </dl>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, true);
});

test('Yes lead fails', () => {
  const html = `<dl><dt>Q?</dt><dd>Yes, in many cases the workup helps.</dd></dl>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
  assert.match(r.error, /Yes/);
});

test('Absolutely lead fails', () => {
  const html = `<dl><dt>Q?</dt><dd>Absolutely, the data supports this.</dd></dl>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
});

test('lead inside nested tags fails (HTML-aware)', () => {
  const html = `<dl><dt>Q?</dt><dd><p>Of course, the workup...</p></dd></dl>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
  assert.match(r.error, /Of course/);
});

test('lead with leading whitespace fails', () => {
  const html = `<dl><dt>Q?</dt><dd>   Yes, this works.</dd></dl>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
});

test('case-insensitive: yes lowercase fails', () => {
  const html = `<dl><dt>Q?</dt><dd>yes, this is fine.</dd></dl>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
});

test('No lead is permitted (different risk class)', () => {
  const html = `<dl><dt>Q?</dt><dd>No, that is not accurate.</dd></dl>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Run, verify fail**

```bash
node --test scripts/gates/faq-no-affirmative-lead.test.mjs
```

- [ ] **Step 3: Implement**

Create `scripts/gates/faq-no-affirmative-lead.mjs`:

```javascript
#!/usr/bin/env node
import fs from 'node:fs';

const BANNED_LEADS = /^(Yes|Absolutely|Sure|Definitely|Of course|Certainly|Yeah|Indeed|Affirmative|Correct|Most certainly)\b/i;

export function checkFaqAnswers(html) {
  const ddMatches = [...html.matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/g)];
  for (const m of ddMatches) {
    let inner = m[1];
    // Strip leading whitespace + opening tags + entity refs
    inner = inner
      .replace(/^\s+/, '')
      .replace(/^(<[^>/!][^>]*>\s*)+/, '') // strip opening tags like <p>, <strong>
      .replace(/^\s+/, '')
      .replace(/^&nbsp;\s*/i, '');
    const first20 = inner.slice(0, 30); // generous slice for word-boundary check
    const ban = first20.match(BANNED_LEADS);
    if (ban) {
      return { ok: false, error: `FAQ answer leads with banned affirmative "${ban[1]}": "${first20.replace(/\s+/g, ' ').slice(0, 60)}..."` };
    }
  }
  return { ok: true };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--(\w[\w-]*)=?(.*)$/);
    if (m) out[m[1]] = m[2] || argv[++i];
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args.file || args.f;
  if (!filePath) {
    console.error('Usage: faq-no-affirmative-lead.mjs --file=dist/PILLAR/index.html');
    process.exit(2);
  }
  const html = fs.readFileSync(filePath, 'utf8');
  const result = checkFaqAnswers(html);
  if (result.ok) {
    console.log(`OK: no banned affirmative leads in FAQ accordion`);
    process.exit(0);
  } else {
    console.error(`FAIL: ${result.error}`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
node --test scripts/gates/faq-no-affirmative-lead.test.mjs
```
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/gates/faq-no-affirmative-lead.mjs scripts/gates/faq-no-affirmative-lead.test.mjs
git commit -m "feat(gates): FAQ no-affirmative-lead validator (HTML-aware)

Parses <dd> accordion answers, strips leading whitespace + opening tags,
asserts first 30 chars do not match strong-affirmative regex (Yes,
Absolutely, Sure, Definitely, Of course, Certainly, Yeah, Indeed,
Affirmative, Correct, Most certainly). 'No' answers permitted."
```

---

### Task 10: Same-PR back-edit lockdown gate

**Files:**
- Create: `scripts/gates/validate-back-edit-in-pr.mjs`
- Create: `scripts/gates/validate-back-edit-in-pr.test.mjs`

Per spec D32 + D48: Phase 2 PR that adds a new pillar's `index.astro` MUST also include back-edit to sibling pillar's `index.astro`. No waiver mechanism (v1.2's `[back-edit-waiver]` escape valve dropped in v1.3).

- [ ] **Step 1: Write failing tests**

Create `scripts/gates/validate-back-edit-in-pr.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBackEditInPr } from './validate-back-edit-in-pr.mjs';

test('PR adds new pillar AND back-edits sibling: pass', () => {
  const changedFiles = [
    'src/pages/for-providers/index.astro',
    'src/pages/getting-started/index.astro',
  ];
  const shippedSlugs = ['getting-started'];
  const r = checkBackEditInPr(changedFiles, shippedSlugs);
  assert.equal(r.ok, true);
});

test('PR adds new pillar but skips back-edit to shipped sibling: fail', () => {
  const changedFiles = ['src/pages/for-providers/index.astro'];
  const shippedSlugs = ['getting-started'];
  const r = checkBackEditInPr(changedFiles, shippedSlugs);
  assert.equal(r.ok, false);
  assert.match(r.error, /missing back-edit to getting-started/);
});

test('PR with no new pillar: pass (gate is no-op)', () => {
  const changedFiles = ['src/pages/about.astro'];
  const shippedSlugs = ['getting-started'];
  const r = checkBackEditInPr(changedFiles, shippedSlugs);
  assert.equal(r.ok, true);
});

test('Phase 1 PR (no shipped siblings yet, no back-edit needed)', () => {
  const changedFiles = ['src/pages/getting-started/index.astro'];
  const shippedSlugs = [];
  const r = checkBackEditInPr(changedFiles, shippedSlugs);
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Run, verify fail**

```bash
node --test scripts/gates/validate-back-edit-in-pr.test.mjs
```

- [ ] **Step 3: Implement**

Create `scripts/gates/validate-back-edit-in-pr.mjs`:

```javascript
#!/usr/bin/env node
import { execSync } from 'node:child_process';

const PILLAR_SLUGS = ['getting-started', 'for-providers'];

export function checkBackEditInPr(changedFiles, shippedSlugs) {
  // Find which new pillars are in the PR
  const newPillars = changedFiles
    .filter(f => f.startsWith('src/pages/') && f.endsWith('/index.astro'))
    .map(f => f.replace('src/pages/', '').replace('/index.astro', ''))
    .filter(slug => PILLAR_SLUGS.includes(slug))
    .filter(slug => !shippedSlugs.includes(slug)); // only new

  if (newPillars.length === 0) return { ok: true }; // no-op

  // For each new pillar, every already-shipped sibling must be in changedFiles
  for (const newSlug of newPillars) {
    for (const shippedSlug of shippedSlugs) {
      const expected = `src/pages/${shippedSlug}/index.astro`;
      if (!changedFiles.includes(expected)) {
        return {
          ok: false,
          error: `PR adds ${newSlug} but missing back-edit to ${shippedSlug} (expected file in diff: ${expected})`,
        };
      }
    }
  }

  return { ok: true };
}

function gitChangedFilesAgainstMain() {
  const out = execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean);
}

function shippedSlugsFromMain() {
  // Pillars considered "shipped" = present in main branch's ssot/pillars.json AND src/pages/<slug>/index.astro exists
  const out = execSync('git show origin/main:ssot/pillars.json', { encoding: 'utf8' });
  const ssot = JSON.parse(out);
  return ssot.pillars.filter(p => PILLAR_SLUGS.includes(p.slug)).map(p => p.slug);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let changedFiles, shippedSlugs;
  try {
    changedFiles = gitChangedFilesAgainstMain();
    shippedSlugs = shippedSlugsFromMain();
  } catch (err) {
    console.error('FAIL (git error):', err.message);
    process.exit(2);
  }
  const result = checkBackEditInPr(changedFiles, shippedSlugs);
  if (result.ok) {
    console.log(`OK: back-edit lockdown satisfied`);
    process.exit(0);
  } else {
    console.error(`FAIL: ${result.error}`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
node --test scripts/gates/validate-back-edit-in-pr.test.mjs
```
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/gates/validate-back-edit-in-pr.mjs scripts/gates/validate-back-edit-in-pr.test.mjs
git commit -m "feat(gates): same-PR back-edit lockdown

Phase 2 PR adding new pillar's index.astro MUST include back-edit to
every already-shipped sibling's index.astro. No waiver mechanism per
D48 (small-radius lockdown is enforceable without escape valve).
Guarantees git revert atomicity per D32."
```

---

## Phase 1: Patient Pillar (Tasks 11-18)

Ship `/getting-started/` with inert rail to not-yet-shipped `/for-providers/`. Wks 1-3.

---

### Task 11: Pre-flight ingest Fuldeore 2017 + Chandra 2014

**Files:**
- Created indirectly via `/rrm-ingest` skill in `rrm-library` D1
- Verify result: `/library/<slug>/` returns 200

Per spec D36: end-to-end ingest (all 6 stages: ingest → fulltext → classify → publish → fact extraction → live verify). NOT Stage 1 only.

- [ ] **Step 1: Locate PMIDs**

- Fuldeore MJ, Soliman AM. Prevalence and Symptomatic Burden of Diagnosed Endometriosis in the United States. *Gynecol Obstet Invest*. 2017. PMID: 28456810
- Chandra A, Copen CE, Stephen EH. Infertility and Impaired Fecundity in the United States, 1982-2010: Data From the National Survey of Family Growth. NSFG report (NCHS). PMID: 24988820

- [ ] **Step 2: Run /rrm-ingest for Fuldeore 2017**

Invoke the `/rrm-ingest` skill with `PMID:28456810`. The skill runs all 6 stages.

Verify post-ingest:
```bash
WORKER_TOKEN=$(op read "op://Automation/Library worker token/credential")
curl -fsSL "https://rrm-library-worker.administrator-cloudflare.workers.dev/articles?pmid=28456810" -H "Authorization: Bearer $WORKER_TOKEN" | jq '.articles[0] | {slug, is_published, is_retracted, relevance_score, fulltext_in_r2}'
```
Expected: `is_published: 1, is_retracted: 0, relevance_score: >= 3, fulltext_in_r2: true`.

- [ ] **Step 3: Verify live URL**

```bash
SLUG=$(curl -fsSL "..." | jq -r '.articles[0].slug')
curl -fsI "https://rrmacademy.org/library/${SLUG}/"
```
Expected: `HTTP/2 200`. If 404, dispatch single-record rebuild:
```bash
gh workflow run deploy.yml -f article_id=$(curl -fsSL "..." | jq -r '.articles[0].id')
```
Wait for workflow to complete (~5 min), then re-curl.

- [ ] **Step 4: Run /rrm-ingest for Chandra 2014**

Same as steps 2-3 with PMID 24988820.

- [ ] **Step 5: Record slugs in pillar draft notes**

Update local working notes (not yet committed) recording the verified slugs that will be used in pillar §11 References section. Example:
- `fuldeore-2017`: actual slug from D1
- `chandra-2014`: actual slug from D1

- [ ] **Step 6: No commit on this task**

This task produces D1 state changes via the worker, not repo file changes. The slugs will be embedded in Phase 1 Task 13 (pillar draft).

---

### Task 12: Add patient pillar to `ssot/pillars.json`

**Files:**
- Modify: `ssot/pillars.json`

- [ ] **Step 1: Read current schema and existing pillar entries**

Read `ssot/pillars.json` fully. Note the structure of an existing entry (e.g., `naprotechnology` entry). The patient pillar entry follows the same shape with adjusted values.

- [ ] **Step 2: Add patient pillar entry**

Add to `pillars` array (preserve `_order` ascending; new entry gets the next available `_order`):

```json
{
  "slug": "getting-started",
  "file": "getting-started/index.astro",
  "title": "Getting Started With RRM",
  "description": "How to find an RRM-trained doctor, what to expect, costs, timeline, and the differences from IVF-centered care. Your action-oriented guide.",
  "og_title": "Getting Started With RRM",
  "og_description": "How to find an RRM-trained doctor, what to expect, costs, timeline, and differences from IVF.",
  "author": "Dr. Naomi Whittaker",
  "read_time": "15 min read",
  "accent": "var(--purple-900)",
  "in_guides_catalogue": true,
  "in_shell_guides_nav": true,
  "_order": <NEXT_AVAILABLE>
}
```

(Look up next available `_order` value: max existing + 1.)

- [ ] **Step 3: Run CI gate**

```bash
node scripts/gates/validate-pillar-registry.mjs
```
Expected: PASS or skip-due-to-missing-file (file doesn't exist yet; this gate may require file to exist).

If gate fails because `src/pages/getting-started/index.astro` doesn't yet exist, that's expected. The gate will pass once Task 13 ships.

- [ ] **Step 4: Bump deploy.yml guides_count assertion (11→12)**

Edit `.github/workflows/deploy.yml` line 402:

Before:
```yaml
if [ "$guides_count" -ne 11 ]; then
  echo "ERROR: $guides_file has $guides_count entries (expected 11 pillar guides)"
```

After:
```yaml
if [ "$guides_count" -ne 12 ]; then
  echo "ERROR: $guides_file has $guides_count entries (expected 12 pillar guides)"
```

- [ ] **Step 5: Do not commit yet**

Bundle this change with the Task 13 pillar draft into a single Phase 1 PR. Hold the working tree until Task 13 completes.

---

### Task 13: Draft patient pillar via /pillar-create skill

**Files:**
- Create: `src/pages/getting-started/index.astro`

The `/pillar-create` skill handles outline + draft + JSON-LD + FAQ schema + claim audit. This task invokes the skill with the spec's content scaffold from §7.1 as input.

- [ ] **Step 1: Invoke /pillar-create skill**

Provide skill with:
- Slug: `getting-started`
- Audience: patient/civilian
- Voice: Gianna (Naomi clinical voice)
- Byline: full credential string
- Target length: 4,500-6,000 words
- Sections (12, from spec §7.1)
- Must-cite slugs (8, from spec §7.1 with verified Fuldeore/Chandra slugs from Task 11)
- Hardest objections (5, placement: FAQ entries 1, 2, 4, 6, 8)
- Editorial constraints (faith-neutral lede, FAQ-only Catholic discussion, no telehealth-first, no clinic names in red flags, FAQ no-affirmative leads, no Hilgers protocols)
- Primary CTA target: `/what-is-rrm/#get-started` (Phase 1 fallback per D21)
- Secondary CTA target: `/what-is-rrm/#fabms` (verified anchor per D31)

The skill outputs `src/pages/getting-started/index.astro` with:
- Frontmatter including `const lastReviewed = '2026-05-14'`
- BaseLayout import + JSON-LD graph
- Header + byline area (class="byline")
- AudienceRail components: provider rail in `inert` mode (target=`/for-providers/`), policymaker rail not needed (deferred)
- `<MaybeShell>` + `<SectionTocChips>` shell wrapper
- 12 sections with H2 anchors
- FAQ accordion `<dl><dt>/<dd>` with 10 entries
- References list with library slugs

- [ ] **Step 2: Local build smoke test**

```bash
npm run build 2>&1 | tail -20
```
Expected: build succeeds. `dist/getting-started/index.html` exists.

- [ ] **Step 3: Run all per-phase content gates against build output**

```bash
# Em-style dash gate
grep -P '[\x{2014}\x{2013}\x{2212}\x{2012}\x{2015}]' dist/getting-started/index.html && echo "DASH FAIL" || echo "DASH OK"
grep -E '&(mdash|ndash);|&#(8212|8211|x2014|x2013);' dist/getting-started/index.html && echo "ENTITY FAIL" || echo "ENTITY OK"

# Telehealth check (allowlisted in Section 5 Find-a-Provider only)
grep -i 'telehealth' dist/getting-started/index.html

# Naomi attribution
node scripts/gates/validate-naomi-attribution.mjs --file=dist/getting-started/index.html --pillar=getting-started

# FAQ no-affirmative
node scripts/gates/faq-no-affirmative-lead.mjs --file=dist/getting-started/index.html

# Pillar registry
node scripts/gates/validate-pillar-registry.mjs

# Library citation 200 (Tasks 11 verified Fuldeore/Chandra are live; check all 8)
for slug in $(grep -oP '/library/[a-z0-9-]+/' dist/getting-started/index.html | sort -u); do
  status=$(curl -fsSI "https://rrmacademy.org${slug}" -o /dev/null -w "%{http_code}")
  echo "$status $slug"
done
```

Expected: All gates PASS. Any FAIL must be fixed before continuing.

- [ ] **Step 4: Manual review of voice + claims**

Brian reviews the draft for:
- Faith-neutral lede (no religious framing in §2)
- Catholic discussion ONLY in FAQ entry 4 (opt-in)
- No prescriptive RRM field-level claims in body (principle-level only)
- No clinic names in §10 Red Flags
- Manhart 2013 cites correct slug `fertility-awareness-based-methods-of-family-planning-a-review-of-effectiveness-f-recpanxsmpcrgo8zq`

- [ ] **Step 5: Run /arise --deep against the pillar**

Invoke `/arise --deep` with scope = `src/pages/getting-started/index.astro` + `src/components/AudienceRail.astro` + `ssot/pillars.json`. Max 3 passes. Fix all CRITICAL + HIGH findings. Document any remaining HIGHs in §15 decisions log if pass 3 still produces them (per D14).

- [ ] **Step 6: Commit (bundled with Task 12 ssot + deploy.yml changes)**

```bash
git add src/pages/getting-started/index.astro ssot/pillars.json .github/workflows/deploy.yml
git commit -m "feat(pillar): ship patient-pillar /getting-started/

Spec: docs/superpowers/specs/2026-05-14-getting-started-pillars-design.md v1.3
Phase 1 of 2-pillar suite. 4,500-6,000 word Astro static page with
shared definition block, inert AudienceRail to not-yet-shipped
/for-providers/, 10-entry FAQ accordion (Catholic discussion in
opt-in entry 4), 8 library citations with verified slugs, JSON-LD
Article + MedicalWebPage(audienceType=Patient) + BreadcrumbList +
FAQPage. Primary CTA fallback /what-is-rrm/#get-started per D21.

ssot/pillars.json bumped from 11 to 12 entries. deploy.yml
guides_count assertion bumped accordingly per D33."
```

---

### Task 14: Update rrm-router ASTRO_ROUTES (separate repo)

**Files:**
- Modify: `~/iCode/projects/rrm-router/src/index.js` (line 54-116 ASTRO_ROUTES array)

- [ ] **Step 1: Read current ASTRO_ROUTES**

Run from `~/iCode/projects/rrm-router/`:
```bash
grep -n -A 100 "const ASTRO_ROUTES" src/index.js | head -110
```

- [ ] **Step 2: Add `/getting-started` to ASTRO_ROUTES**

Locate the alphabetical position in the array. Add (using existing entry format):

```javascript
  '/getting-started',
```

(Likely between `/glossary` and `/library/` or similar. Match existing comma + indentation style.)

- [ ] **Step 3: Deploy rrm-router**

```bash
npx wrangler deploy
```
Expected: deployment success message.

- [ ] **Step 4: Verify edge routing**

```bash
curl -sI https://rrmacademy.org/getting-started/ | grep -E 'server|cf-cache|content-type'
```
Expected: response from Astro origin (look for `content-type: text/html` from CF Pages), NOT Wix proxy.

Compare against patient pillar staging URL to ensure routing matches expectation.

- [ ] **Step 5: Commit (in rrm-router repo)**

```bash
cd ~/iCode/projects/rrm-router
git add src/index.js
git commit -m "feat(router): add /getting-started to ASTRO_ROUTES

Routes /getting-started/ to Astro origin instead of Wix proxy.
Phase 1 of rrm-academy-cf 2-pillar suite. Provider pillar
(/for-providers) follows in Phase 2."
git push
```

---

### Task 15: Open PR + run /arise --deep + post-deploy verification

**Files:**
- PR target branch: `main`

- [ ] **Step 1: Create feature branch and push**

```bash
cd ~/iCode/projects/rrm-academy-cf
git checkout -b claude/getting-started-pillar
git push -u origin claude/getting-started-pillar
```

- [ ] **Step 2: Open PR via gh**

```bash
gh pr create --title "feat(pillar): ship patient-pillar /getting-started/ (Phase 1)" --body "$(cat <<'EOF'
## Summary

Ships `/getting-started/` patient pillar per spec `docs/superpowers/specs/2026-05-14-getting-started-pillars-design.md` v1.3 Phase 1.

- 4,500-6,000 word Astro static page
- Inert AudienceRail to not-yet-shipped `/for-providers/` (Phase 2)
- 10-entry FAQ accordion (Catholic discussion in opt-in entry 4)
- 8 library citations verified live before draft
- JSON-LD Article + MedicalWebPage + FAQPage + BreadcrumbList
- Primary CTA falls back to `/what-is-rrm/#get-started` (per D21)
- Secondary CTA points to `/what-is-rrm/#fabms` (per D31)

## ssot/pillars.json
- New entry: `getting-started`
- Count bumped from 11 to 12

## deploy.yml
- `guides_count` assertion bumped from 11 to 12 (per D33)

## Test plan
- [x] Build succeeds locally
- [x] Per-phase content gates pass (em-dash, FAQ no-affirmative, Naomi-attribution, telehealth, registry)
- [x] All 8 library citation URLs return 200
- [x] /arise --deep clean (0 CRITICAL + 0 HIGH; max 3 passes per D14)
- [ ] Cannibalization audit clean against /what-is-rrm/ + /naprotechnology/
- [ ] AEO retrieval baseline run via rrma-seo-operator

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Monitor CI**

```bash
gh pr checks --watch
```
Expected: all checks green. Address any failures.

- [ ] **Step 4: Merge PR**

```bash
gh pr merge --rebase --delete-branch
```
(rebase-merge per D32 to preserve commit history.)

- [ ] **Step 5: Wait for deploy + verify production**

```bash
sleep 180  # CF Pages typical deploy time
curl -fsI https://rrmacademy.org/getting-started/
```
Expected: `HTTP/2 200`.

- [ ] **Step 6: Post-deploy gate runs**

```bash
# Same gate suite as Task 13 Step 3, but against production
for gate in 'em-dash' 'faq' 'naomi'; do
  curl -s https://rrmacademy.org/getting-started/ > /tmp/pillar.html
done
node scripts/gates/validate-naomi-attribution.mjs --file=/tmp/pillar.html --pillar=getting-started
node scripts/gates/faq-no-affirmative-lead.mjs --file=/tmp/pillar.html

# Citation cron runs
node scripts/cron/verify-pillar-citations.mjs
```
Expected: all PASS.

- [ ] **Step 7: IndexNow ping + llms.txt update**

The site has existing IndexNow integration (per CLAUDE.md). Run whatever the existing convention is:
```bash
gh workflow run indexnow.yml -f url=https://rrmacademy.org/getting-started/  # or equivalent
```

Update `public/llms.txt` to include new pillar URL + 1-line description. Commit as a follow-up.

- [ ] **Step 8: Cannibalization audit**

Run the cannibalization audit playbook (`docs/cannibalization-audit-2026-05-13.md` per D15). If `/what-is-rrm/` ranking regresses on its primary keyword, invoke R1 remediation tree.

- [ ] **Step 9: AEO retrieval baseline**

Invoke `rrma-seo-operator` skill to run retrieval check; record baseline for re-runs at 30/60/90 days.

---

## Phase 2: Provider Pillar + Back-edit (Tasks 16-22)

Ship `/for-providers/` and flip patient pillar's rail from inert to live in the same PR. Wks 4-6.

---

### Task 16: Pre-flight ingest Yeung 2025 + Reeder 2026 (with fallback)

**Files:**
- Created indirectly via `/rrm-ingest` or fallback citation swap

Per spec §7.2: if Yeung 2025 or Reeder 2026 is not yet published / not in PubMed at Phase 2 time, swap to library-resident comparable article.

- [ ] **Step 1: Search for Yeung 2025 in PubMed**

```bash
curl -fsSL "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=Yeung+P+2025+restorative+reproductive+medicine+surgery&retmode=json"
```

- [ ] **Step 2: If found, ingest via /rrm-ingest**

If PMID present, invoke `/rrm-ingest`. Verify all 6 stages complete (per Task 11 pattern).

- [ ] **Step 3: If not found, search library for fallback**

```bash
WORKER_TOKEN=$(op read "op://Automation/Library worker token/credential")
curl -fsSL "https://rrm-library-worker.administrator-cloudflare.workers.dev/articles?search=Yeung+surgery+RRM&limit=5" -H "Authorization: Bearer $WORKER_TOKEN" | jq '.articles[] | {slug, year, title}'
```

If Yeung has a prior surgical-RRM article in library, use that slug. Otherwise: drop Yeung from must-cite and update spec §7.2 + §15 with the fallback decision.

- [ ] **Step 4: Same for Reeder 2026**

```bash
curl -fsSL "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=Reeder+MR+2026+IVF+sibling+unassisted&retmode=json"
```

If not in PubMed: search library for comparable F&S cohort comparing IVF perinatal outcomes vs unassisted; or drop and update spec/decisions.

- [ ] **Step 5: Record final slugs**

Update working notes with confirmed slug for each provider-pillar citation. These embed into Task 17 draft.

---

### Task 17: NeoFertility/IIRRM/Creighton/FEMM URL audit (no Naomi attribution)

**Files:**
- No file changes; this is a URL verification step before the provider pillar drafts CTAs

Per spec D32 + Q4 + R11: provider pillar training pathway links MUST point to org-level pages (NOT instructor pages); verify each linked URL contains no Naomi attribution.

- [ ] **Step 1: List candidate URLs**

The provider pillar links to:
- NaProTech training: https://www.naprotechnology.com/training/ (or similar org-level page)
- NFPMC: https://www.popepaulvi.com/nfpmc-physician-program
- FEMM Foundations: https://femmhealth.org/training/
- Creighton FCP: https://creightonmodel.com/become-a-practitioner/
- NeoFertility training: https://neofertility.training/ (org-level only per Q4)
- Boma-Deutsch: https://www.bomaonline.com/training/
- IIRRM membership: https://iirrm.org/membership/ (org-level, NOT Naomi's role page)

- [ ] **Step 2: Curl each URL and grep for Naomi attribution**

```bash
for url in 'https://www.naprotechnology.com/training/' 'https://www.popepaulvi.com/nfpmc-physician-program' 'https://femmhealth.org/training/' 'https://creightonmodel.com/become-a-practitioner/' 'https://neofertility.training/' 'https://iirrm.org/membership/'; do
  echo "=== $url ==="
  curl -fsSL "$url" | grep -ciE '(Naomi|Whit{1,2}aker|MIGS|NFPMC|0000-0003-3706-3112|1881034908)' || echo "(0 matches)"
done
```

Expected: zero matches per URL. If a URL has Naomi attribution (e.g., she's listed as instructor on the linked page), find an org-level alternative or drop that training pathway from §7.2.

- [ ] **Step 3: Record verified URL list**

Append to working notes: which URLs passed audit, which were dropped, and any alternative org-level URLs used. These embed into Task 18 draft.

---

### Task 18: Add provider pillar to `ssot/pillars.json` + bump deploy.yml

**Files:**
- Modify: `ssot/pillars.json`
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Add provider pillar entry**

Add to `ssot/pillars.json` `pillars` array (next `_order`):

```json
{
  "slug": "for-providers",
  "file": "for-providers/index.astro",
  "title": "RRM For Providers",
  "description": "Training pathways, evidence by condition, integration patterns, and referral networks for clinicians exploring restorative reproductive medicine.",
  "og_title": "RRM For Providers: A Clinician's Guide",
  "og_description": "Training pathways, evidence by condition, and referral networks for clinicians exploring RRM.",
  "author": "Dr. Naomi Whittaker",
  "read_time": "20 min read",
  "accent": "var(--purple-900)",
  "in_guides_catalogue": true,
  "in_shell_guides_nav": true,
  "_order": <NEXT_AVAILABLE>
}
```

- [ ] **Step 2: Bump deploy.yml guides_count (12→13)**

Edit `.github/workflows/deploy.yml` line 402:

Before:
```yaml
if [ "$guides_count" -ne 12 ]; then
```

After:
```yaml
if [ "$guides_count" -ne 13 ]; then
```

- [ ] **Step 3: Hold uncommitted (bundle with Tasks 19 + 20)**

This Phase 2 PR must include the new pillar + the back-edit + ssot + deploy.yml changes atomically (per gate #15 same-PR lockdown).

---

### Task 19: Draft provider pillar via /pillar-create

**Files:**
- Create: `src/pages/for-providers/index.astro`

- [ ] **Step 1: Invoke /pillar-create skill**

Provide skill with:
- Slug: `for-providers`
- Audience: provider/clinician
- Voice: Gianna peer-to-peer
- Byline: full credential string
- Target length: 5,500-7,000 words
- Sections (12, from spec §7.2)
- Must-cite slugs (8, from spec §7.2 with verified slugs from Task 16)
- Hardest objections (5)
- Training pathway URLs (from Task 17 audit, NO Naomi attribution)
- Editorial constraints (no Hilgers protocols, no prescriptive RRM field-level claims, no clinical decision support, no salary claims, no anti-IVF rhetoric, religious-origin in FAQ only)

The skill outputs `src/pages/for-providers/index.astro` with:
- Frontmatter including `const lastReviewed = '2026-05-14'`
- BaseLayout + JSON-LD graph (`medicalAudience.audienceType = "Clinician"`)
- Header + byline area
- AudienceRail components: TOP rail = LIVE `<a>` to `/getting-started/` (already shipped; per gate #5c new-ship verification)
- 12 sections with H2 anchors
- FAQ accordion with 10 entries (religious-origin only in opt-in entry)
- References list

- [ ] **Step 2: Local build smoke test**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 3: Run all per-phase content gates**

Same suite as Task 13 Step 3, against `dist/for-providers/index.html` and the to-be-back-edited `dist/getting-started/index.html`.

Additional gate: **gate #5c new-ship rail verification:**
```bash
node scripts/gates/validate-cross-pillar-rails.mjs --file=dist/for-providers/index.html --mode=new-ship --sibling=/getting-started/
```
Expected: PASS (provider pillar contains live rail to already-shipped patient pillar).

- [ ] **Step 4: Manual review of voice + claims**

Brian reviews for:
- No Hilgers protocols
- No prescriptive RRM field-level claims
- Religious-origin only in FAQ entry
- Training pathway URLs verified Naomi-free
- Yeung 2025 / Reeder 2026 (or fallbacks) cite correct slugs

- [ ] **Step 5: Run /arise --deep**

Scope = `src/pages/for-providers/index.astro` + `src/pages/getting-started/index.astro` (with pending back-edit) + ssot. Max 3 passes.

- [ ] **Step 6: Hold uncommitted**

---

### Task 20: Back-edit patient pillar (same PR per gate #15)

**Files:**
- Modify: `src/pages/getting-started/index.astro`

Per spec §8 / D38: back-edit replaces inert `<AudienceRail mode="inert">` with `<AudienceRail mode="live">`, stripping all three inert-state attributes (handled by component prop swap).

- [ ] **Step 1: Find the inert AudienceRail invocation**

In `src/pages/getting-started/index.astro`, locate:
```astro
<AudienceRail href="/for-providers/" text="Are you a clinician? Read RRM For Providers" mode="inert" />
```

- [ ] **Step 2: Change `mode="inert"` to `mode="live"`**

```astro
<AudienceRail href="/for-providers/" text="Are you a clinician? Read RRM For Providers" mode="live" />
```

The component does the rest: live mode emits `<a href>` with NO `data-rail-state`, `data-future-href`, `aria-disabled`, or sr-only "(coming soon)" span.

- [ ] **Step 3: Also remove the Phase 1-only `Action` JSON-LD node**

In the patient pillar's `<script type="application/ld+json">` graph, remove the `Action` object with `actionStatus: "PotentialActionStatus"` and `target: "https://rrmacademy.org/for-providers/"`. (This was emitted during Phase 1 per §10; removed at Phase 2 back-edit.)

- [ ] **Step 4: Rebuild and verify back-edit gates**

```bash
npm run build

# Gate #5a: back-edit to /for-providers/ is now live
node scripts/gates/validate-cross-pillar-rails.mjs --file=dist/getting-started/index.html --mode=back-edit --target=/for-providers/

# Gate #5b: no leftover inert attributes
node scripts/gates/validate-cross-pillar-rails.mjs --file=dist/getting-started/index.html --mode=no-leftovers
```
Expected: both PASS.

- [ ] **Step 5: Same-PR lockdown gate**

```bash
# Stage all changes
git add src/pages/getting-started/index.astro src/pages/for-providers/index.astro ssot/pillars.json .github/workflows/deploy.yml

# Run the lockdown gate (uses git diff against origin/main)
node scripts/gates/validate-back-edit-in-pr.mjs
```
Expected: PASS (PR adds for-providers AND back-edits getting-started).

- [ ] **Step 6: Commit (Phase 2 bundle)**

```bash
git commit -m "feat(pillar): ship provider-pillar /for-providers/ + back-edit /getting-started/

Spec: docs/superpowers/specs/2026-05-14-getting-started-pillars-design.md v1.3 Phase 2

New: src/pages/for-providers/index.astro
  - 5,500-7,000 word clinician peer-to-peer guide
  - Live AudienceRail to already-shipped /getting-started/
  - JSON-LD audienceType=Clinician
  - 8 library citations (Yeung 2025 + Reeder 2026 pre-flight verified or
    fallback slugs documented in a §15 D-row added in this commit)
  - Training pathway URLs audited Naomi-free per R11 + Q4

Back-edit: src/pages/getting-started/index.astro
  - AudienceRail to /for-providers/ flipped inert→live
  - Phase 1 Action JSON-LD node (PotentialActionStatus) removed

ssot/pillars.json: count 12→13
deploy.yml: guides_count assertion 12→13

Same-PR back-edit lockdown per gate #15 (D32 + D48): both pillar
changes ship atomically for git revert safety."
```

---

### Task 21: Update rrm-router ASTRO_ROUTES + open PR

**Files:**
- Modify: `~/iCode/projects/rrm-router/src/index.js`

- [ ] **Step 1: Add `/for-providers` to ASTRO_ROUTES**

In `~/iCode/projects/rrm-router/src/index.js`, add to ASTRO_ROUTES array:
```javascript
  '/for-providers',
```

- [ ] **Step 2: Deploy rrm-router**

```bash
cd ~/iCode/projects/rrm-router
npx wrangler deploy
```

- [ ] **Step 3: Verify edge routing**

```bash
curl -sI https://rrmacademy.org/for-providers/ | head -10
```
Expected: response from Astro origin (this will be 404 from CF Pages until Phase 2 PR merges, but should NOT be Wix proxy).

- [ ] **Step 4: Commit + push rrm-router**

```bash
git add src/index.js
git commit -m "feat(router): add /for-providers to ASTRO_ROUTES

Phase 2 of rrm-academy-cf 2-pillar suite."
git push
```

- [ ] **Step 5: Open rrm-academy-cf Phase 2 PR**

```bash
cd ~/iCode/projects/rrm-academy-cf
git checkout -b claude/for-providers-pillar
git push -u origin claude/for-providers-pillar
gh pr create --title "feat(pillar): ship provider-pillar /for-providers/ + back-edit /getting-started/ (Phase 2)" --body "$(cat <<'EOF'
## Summary

Phase 2 of 2-pillar suite per spec v1.3.

- New `/for-providers/` clinician pillar (~5,500-7,000 words)
- Back-edit `/getting-started/` rail to /for-providers/ from inert → live
- ssot/pillars.json count 12 → 13
- deploy.yml guides_count assertion bumped

## Atomic same-PR lockdown

Per gate #15 (D32 + D48), provider pillar intro commit + patient pillar back-edit ship in the same PR for `git revert` atomicity. Validated by `scripts/gates/validate-back-edit-in-pr.mjs`.

## rrm-router

`/for-providers/` added to `ASTRO_ROUTES` in companion commit (separate repo, already deployed).

## Test plan
- [x] Build succeeds locally
- [x] Per-phase content gates pass on both pillars
- [x] Gate #5a: back-edit rail is live on /getting-started/
- [x] Gate #5b: no leftover inert attributes on /getting-started/
- [x] Gate #5c: new-ship rail to /getting-started/ live on /for-providers/
- [x] Same-PR lockdown gate passes
- [x] All citation URLs return 200
- [x] /arise --deep clean (0 CRITICAL + 0 HIGH)
- [ ] Cross-pillar claim audit clean
- [ ] Cannibalization audit clean
- [ ] AEO retrieval re-baseline run via rrma-seo-operator

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 22: Merge, deploy, post-deploy verification

**Files:**
- N/A (PR merge + verify)

- [ ] **Step 1: Wait for CI checks**

```bash
gh pr checks --watch
```
Expected: all green.

- [ ] **Step 2: Merge via rebase**

```bash
gh pr merge --rebase --delete-branch
```

- [ ] **Step 3: Wait for deploy**

```bash
sleep 180
curl -fsI https://rrmacademy.org/for-providers/
curl -fsI https://rrmacademy.org/getting-started/
```
Expected: both `HTTP/2 200`.

- [ ] **Step 4: Production post-deploy gates**

```bash
# Fetch both pillars
curl -s https://rrmacademy.org/getting-started/ > /tmp/getting-started.html
curl -s https://rrmacademy.org/for-providers/ > /tmp/for-providers.html

# Gate #5a: back-edit on patient pillar
node scripts/gates/validate-cross-pillar-rails.mjs --file=/tmp/getting-started.html --mode=back-edit --target=/for-providers/

# Gate #5b: no leftover inert attributes on patient pillar
node scripts/gates/validate-cross-pillar-rails.mjs --file=/tmp/getting-started.html --mode=no-leftovers

# Gate #5c: new-ship rail on provider pillar
node scripts/gates/validate-cross-pillar-rails.mjs --file=/tmp/for-providers.html --mode=new-ship --sibling=/getting-started/

# Naomi attribution on both pillars
node scripts/gates/validate-naomi-attribution.mjs --file=/tmp/getting-started.html --pillar=getting-started
node scripts/gates/validate-naomi-attribution.mjs --file=/tmp/for-providers.html --pillar=for-providers

# FAQ no-affirmative-lead on both
node scripts/gates/faq-no-affirmative-lead.mjs --file=/tmp/getting-started.html
node scripts/gates/faq-no-affirmative-lead.mjs --file=/tmp/for-providers.html

# Citation cron
node scripts/cron/verify-pillar-citations.mjs
```

Expected: all PASS. Any failure triggers rollback per §12 Rollback procedure.

- [ ] **Step 5: IndexNow ping + llms.txt update**

Ping IndexNow for `/for-providers/`. Update `public/llms.txt` to include both pillar entries with descriptions.

- [ ] **Step 6: Cross-pillar claim audit**

Run `rrm-cli` diff per shared claim across both pillars to flag drift (per §12 gate #14).

- [ ] **Step 7: Cannibalization audit**

Run cannibalization audit playbook against `/naprotechnology/` + `/femm/` + `/what-is-rrm/` to confirm no ranking regression from the new provider pillar.

- [ ] **Step 8: AEO retrieval re-baseline**

Invoke `rrma-seo-operator` skill for second baseline now that both pillars are shipped. Schedule 30/60/90 day re-runs.

- [ ] **Step 9: Schedule provider-directory ship trigger watch**

Per gate #16 (D39): when `rrm-provider-directory` ships (signals: `target_deploy_date` becomes non-null in its `provider-directory.json` AND `/providers/` noindex flips false), open a single-commit PR flipping patient pillar's primary CTA target from `/what-is-rrm/#get-started` to `/providers/`. Add a calendar reminder or weekly check.

---

## Self-Review (Plan)

Plan covers spec v1.3 §4 (in-scope), Prerequisites (Tasks 1-5), Shared Infrastructure (Tasks 6-10), Phase 1 (Tasks 11-15), Phase 2 (Tasks 16-22). All 8 v1.3 pass-3 squash fixes are implemented:

| Pass-3 fix | Implemented in |
|---|---|
| Gates #24+#27 ordering → §12 #5a/#5b/#5c modes | Task 7 (validate-cross-pillar-rails 4-mode helper) |
| Gate #22 new-pillar-after-sibling | Task 7 (new-ship mode) + Task 19 (provider pillar uses live rail to /getting-started/) |
| Gate #22 rollback inversion | Task 7 (inverted mode) |
| `data-future-href` lingering | Task 7 (no-leftovers mode) + Task 6 (AudienceRail component does atomic mode swap) |
| Inert-rail WCAG 2.5.3 | Task 6 (no aria-label override, visible-text + sr-only) |
| SR comma pronunciation | Task 6 (parentheses around "coming soon") |
| Naomi-leak Whitaker typo | Task 8 (`Whit{1,2}aker` regex per D42) |
| Citation cron host | Task 5 (GitHub Actions schedule, NOT n8n) |
| errata_count library migration | Tasks 1-3 (rrm-library-worker prereqs) |
| pillar.last_reviewed source | Task 4 (build-pillar-reviews.mjs emits JSON) |

Placeholder scan: every code block contains actual content. No "TBD" / "TODO" / "implement later". Function names consistent: `checkRails`, `checkNaomiAttribution`, `checkFaqAnswers`, `checkBackEditInPr`, `extractLastReviewed`, `parseErrataFromPubMed`.

Type consistency: helper-script `opts` objects carry consistent field names (`mode`, `target`, `sibling`, `pillar`). AudienceRail Props interface used identically in both pillars (Task 13 + Task 19).

Files referenced exist or are explicitly to-create: `ssot/pillars.json` exists (verified), `.github/workflows/deploy.yml` line 402 exists (verified), `~/iCode/projects/rrm-router/src/index.js` ASTRO_ROUTES exists (verified), `src/pages/femm/` precedent exists.

Plan complete.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-14-getting-started-pillars-implementation.md`.**

Total: 22 tasks across 3 phases (Prereqs, Shared Infra, Phase 1, Phase 2). Estimated execution time: 3-4 weeks per spec §12 (Phase 1 = Wks 1-3, Phase 2 = Wks 4-6) with prerequisites completing in week 0.
