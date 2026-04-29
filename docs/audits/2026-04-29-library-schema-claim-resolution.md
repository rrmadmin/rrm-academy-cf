# Phase 8: Library Schema Audit Claim Resolution

**Date:** 2026-04-29
**Branch:** `claude/agent-readiness-sprint`
**Sprint phase:** 8 of 10
**Status:** RESOLVED -- audit was wrong about a non-existent URL form

## Audit claim

The 2026-04-29 agent-readiness audit claimed library article pages emit no per-article
schema, citing the URL `/library/recq2k7vegm17vudr/` as evidence.

## Live testing

### Audit URL (cited as evidence of missing schema)

| URL | HTTP | Note |
|-----|------|------|
| `https://rrmacademy.org/library/recq2k7vegm17vudr/` | 404 | Not a real article slug or recID |

The auditor hit a phantom URL. `recq2k7vegm17vudr` is not present in
`src/data/articles.json` (3,450 records). Library URLs use slug-based static
paths (`src/pages/library/[...slug].astro`), where each slug ends with a
14-char recID suffix (e.g. `-rec3jyaoqiwqeehnb`). Bare recIDs without the
slug prefix do not have static paths and 404.

### 5 random LIVE library URLs (real slug-form)

| Slug | HTTP | MedicalScholarlyArticle in HTML |
|------|------|---------------------------------|
| `ovulation-disturbances-and-exercise-training-rec3jyaoqiwqeehnb` | 200 | YES |
| `chronic-anovulation-syndrome-and-associated-neoplasia-recjnzgpgmqhsllfs` | 200 | YES |
| `women-with-minor-menstrual-irregularities-...-recqvlnrab9wbcqiz` | 200 | YES |
| `strangers-in-a-strange-land-...-recpnwimbbg3kez7m` | 200 | YES |
| `influence-of-sex-steroid-hormones-...-recieokgs2cmeds7w` | 200 | YES |

All 5 emit `"@type":"MedicalScholarlyArticle"` and `"ScholarlyArticle"` (the
Schema.org parent class) in the rendered HTML, sourced from
`buildMedicalScholarlyArticle(article)` in `src/pages/library/[...slug].astro`.

### Bare-recID URL form

| URL | HTTP | Behavior |
|-----|------|----------|
| `https://rrmacademy.org/library/recYC4E00Sw0Div60/` | 301 -> `/library/recyc4e00sw0div60/` | Mixed-case recID redirected to lowercase by `rrm-router` |
| `https://rrmacademy.org/library/recyc4e00sw0div60/` | 404 | Lowercase recID without slug prefix has no static path |

The "lowercase library URL" redirect logic in `rrm-router/src/index.js:304-310`
fires on any mixed-case path under `/library/`, including bare recIDs. After
the redirect, the lowercased URL hits Astro and 404s because no static path
exists for bare recIDs.

## Decision matrix outcome

**(a) Audit was wrong.** The cited URL `/library/recq2k7vegm17vudr/` does not
correspond to any article in the dataset. The auditor either:

1. Tested a synthetic recID without verifying it exists in `articles.json`, or
2. Hit the bare-recID URL form, which 404s by design (slug-based routing only)

Real library URLs (slug-form, 3,450 of them) all emit per-article
`MedicalScholarlyArticle` schema. This was true before Phase 7 (inline
implementation) and remains true after Phase 7 (refactored to
`buildMedicalScholarlyArticle` builder) -- parity verified on 10 articles
during the refactor commit.

## Optional improvement (out of scope for this sprint)

The bare-recID URL form (`/library/recXXXXXXXXXX/`) could be wired to redirect
to the canonical slug-form URL via `rrm-router`. This would close a small UX
gap (3rd-party agents/citers may construct recID-only URLs) but is not a
schema gap.

If implemented:

1. Add a recID-extraction regex to `rrm-router/src/index.js` ahead of the
   lowercase-redirect block.
2. Lookup `recXXX -> canonical-slug` from a static mapping (build-time export
   from `articles.json`) or from a D1 query.
3. Issue 301 to `/library/<canonical-slug>/`.

Estimated effort: 30-60 min. Not required for sprint completion.

## Files referenced

- `src/pages/library/[...slug].astro` -- Phase 7 refactored, line 9 imports `buildMedicalScholarlyArticle`
- `src/lib/identity/builders/medical-scholarly-article.mjs` (or .ts) -- builder source
- `~/iCode/projects/rrm-router/src/index.js:304-310` -- lowercase library redirect
- `src/data/articles.json` -- 3,450 records, all slug-keyed

## Conclusion

No fix needed. Audit's library schema claim was based on a phantom URL.
3,450 live library article pages emit per-article MedicalScholarlyArticle
schema as expected. Phase 7 refactor preserved this behavior with full parity.
