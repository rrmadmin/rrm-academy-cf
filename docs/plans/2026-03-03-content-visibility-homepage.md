# content-visibility: auto — Homepage Performance Test

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply `content-visibility: auto` to below-fold homepage sections, measure mobile PageSpeed before/after to decide whether to keep the change.

**Architecture:** Add two CSS properties to `.hp-section` in `index.astro`'s scoped `<style>` block. No JS, no new files, no component changes. Hero (`hp-hero`) is explicitly excluded. Before/after screenshots via Playwright at mobile viewport. Three PageSpeed Insights API calls each way, averaged per metric.

**Tech Stack:** Astro 5.3, Cloudflare Pages, Google PageSpeed Insights API (no key required for 3 calls), Playwright MCP

**Key Risk:** CLS (Cumulative Layout Shift). If `contain-intrinsic-size` estimates are wrong, scroll jump = bad UX. We watch CLS before/after. If CLS increases, revert.

**Metrics to capture each run:** Performance score, LCP, FCP, TBT, CLS, Speed Index

---

### Task 1: Baseline Screenshots (mobile + desktop)

**Before touching any code** — capture the live site state.

**Files:** None modified

**Step 1: Screenshot mobile viewport (390×844)**

Use Playwright:
- Navigate to `https://rrmacademy.org/`
- Resize to 390×844
- Screenshot → save as `docs/plans/before-mobile.png`
- Scroll to bottom, screenshot → `docs/plans/before-mobile-scroll.png`

**Step 2: Screenshot desktop viewport (1440×900)**

- Resize to 1440×900
- Screenshot → `docs/plans/before-desktop.png`

---

### Task 2: Baseline PageSpeed (3 runs, mobile strategy)

**Files:** None modified

**Step 1: Run 3 PageSpeed API calls**

```bash
for i in 1 2 3; do
  curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://rrmacademy.org/&strategy=mobile" \
    | jq '{
        score: .lighthouseResult.categories.performance.score,
        lcp: .lighthouseResult.audits["largest-contentful-paint"].displayValue,
        fcp: .lighthouseResult.audits["first-contentful-paint"].displayValue,
        tbt: .lighthouseResult.audits["total-blocking-time"].displayValue,
        cls: .lighthouseResult.audits["cumulative-layout-shift"].displayValue,
        si:  .lighthouseResult.audits["speed-index"].displayValue
      }' > docs/plans/before-psi-run${i}.json
  echo "Run ${i} done"
  sleep 5
done
```

**Step 2: Average the results**

```bash
jq -s '{
  score: (map(.score) | add / length),
  lcp:   [.[].lcp],
  fcp:   [.[].fcp],
  tbt:   [.[].tbt],
  cls:   [.[].cls],
  si:    [.[].si]
}' docs/plans/before-psi-run{1,2,3}.json > docs/plans/before-avg.json
cat docs/plans/before-avg.json
```

Record the averaged score and CLS value — **CLS is the go/no-go metric after changes.**

---

### Task 3: Apply content-visibility

**Files:**
- Modify: `src/pages/index.astro` — inside the `<style>` block, `.hp-section` rule

**The homepage has 9 `.hp-section` elements below `.hp-hero`. All are candidates.**

**Step 1: Find the current `.hp-section` rule**

In `src/pages/index.astro`, around line 396:
```css
/* Sections — letter-line handled by global .page-body */
.hp-section {
  padding: 0;
}
```

**Step 2: Add the two properties**

```css
/* Sections — letter-line handled by global .page-body */
.hp-section {
  padding: 0;
  content-visibility: auto;
  contain-intrinsic-size: auto 480px;
}
```

**Why 480px?** Sections are text-heavy with `.container--narrow`. On mobile at 390px width:
- Short sections (Latest Insights, CTA): ~300px
- Medium sections (Intro, Analogy): ~450px
- Long sections (How RRM Works, You Are in the Right Place): ~700px+

480px is a conservative middle estimate. The `auto` prefix means the browser remembers the real height after first render, so subsequent scroll-backs are accurate. The estimate only matters for the initial scroll.

**Step 3: Verify the hero is NOT affected**

`hp-hero` uses class `.hp-hero`, not `.hp-section`. Confirm no overlap in the HTML — hero is a `<header>`, sections are `<section>` elements. No change needed to hero.

**Step 4: Check for sticky elements inside sections**

Scan the 9 sections for any `position: sticky` children. There are none in the current markup (all sections are plain text, lists, blockquote, comparison grid). Safe to proceed.

---

### Task 4: Build and deploy

**Step 1: Build**

```bash
cd ~/iCode/projects/rrm-academy-cf && npm run build
```

Expected: build completes with no errors. Pagefind indexes after build.

**Step 2: Deploy**

```bash
CLOUDFLARE_ACCOUNT_ID="ecf2c5bc8b5ebd634bcb587b3890910a" npx wrangler pages deploy dist --project-name rrm-academy
```

Wait for "Deployment complete" confirmation with URL.

**Step 3: Wait 30 seconds** for CDN propagation before testing.

---

### Task 5: After Screenshots (mobile + desktop)

Same viewports as Task 1, same scroll positions.

**Step 1: Screenshot mobile**
- `docs/plans/after-mobile.png`
- `docs/plans/after-mobile-scroll.png`

**Step 2: Screenshot desktop**
- `docs/plans/after-desktop.png`

**Visual check:** Look for layout shift in the after-mobile-scroll screenshot. Content should not have jumped. If sections appear to have different spacing or content overlaps, the height estimate needs adjustment.

---

### Task 6: After PageSpeed (3 runs)

Same command as Task 2 but save to `after-psi-run{1,2,3}.json`.

```bash
for i in 1 2 3; do
  curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://rrmacademy.org/&strategy=mobile" \
    | jq '{
        score: .lighthouseResult.categories.performance.score,
        lcp: .lighthouseResult.audits["largest-contentful-paint"].displayValue,
        fcp: .lighthouseResult.audits["first-contentful-paint"].displayValue,
        tbt: .lighthouseResult.audits["total-blocking-time"].displayValue,
        cls: .lighthouseResult.audits["cumulative-layout-shift"].displayValue,
        si:  .lighthouseResult.audits["speed-index"].displayValue
      }' > docs/plans/after-psi-run${i}.json
  echo "Run ${i} done"
  sleep 5
done

jq -s '{
  score: (map(.score) | add / length),
  lcp:   [.[].lcp],
  fcp:   [.[].fcp],
  tbt:   [.[].tbt],
  cls:   [.[].cls],
  si:    [.[].si]
}' docs/plans/after-psi-run{1,2,3}.json > docs/plans/after-avg.json
cat docs/plans/after-avg.json
```

---

### Task 7: Decision

**Go/No-Go criteria:**

| Metric | Keep if | Revert if |
|--------|---------|-----------|
| Performance score | same or higher | dropped > 2 points |
| CLS | same or lower | increased at all |
| LCP | same or improved | worsened > 200ms |
| Visual screenshots | no jump/shift visible | any layout shift visible |

**If keeping:** commit with message `perf: add content-visibility to homepage below-fold sections`

```bash
cd ~/iCode/projects/rrm-academy-cf
git add src/pages/index.astro
git commit -m "perf: add content-visibility to homepage below-fold sections

Apply content-visibility: auto + contain-intrinsic-size: auto 480px
to all .hp-section elements (below hero). Hero excluded.
Verified no CLS regression via 3x PageSpeed Insights baseline vs after.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

**If reverting:** Remove the two lines from `.hp-section`, rebuild, redeploy.

```bash
git checkout src/pages/index.astro
cd ~/iCode/projects/rrm-academy-cf && npm run build && CLOUDFLARE_ACCOUNT_ID="ecf2c5bc8b5ebd634bcb587b3890910a" npx wrangler pages deploy dist --project-name rrm-academy
```
