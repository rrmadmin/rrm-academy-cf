# PRD: Export to Zotero

## Problem

The RRM Research Library has 3,000+ articles with rich metadata (title, authors, journal, volume, issue, pages, DOI, PMID, year, abstract, topics, keywords, citations). Researchers and clinicians who use this library want to save references to Zotero (and other reference managers like Mendeley, EndNote, RefWorks) for their own research workflows.

Currently, the site has JSON-LD (`MedicalScholarlyArticle`) and Open Graph tags — but **Zotero does not read JSON-LD**. The Zotero Connector browser extension relies on Highwire Press meta tags and COinS spans, neither of which exist on the site today. There is also no way to download a citation file.

## Goal

Enable seamless Zotero integration so that:
1. Users with the Zotero Connector see the article icon on synopsis pages (one-click save)
2. Users on list/search pages see the folder icon (multi-select save)
3. Users without the extension can download citation files (RIS format, universal compatibility)
4. Users can batch-export their saved articles collection

## Non-Goals

- Zotero Web API integration (requires users to provide API keys — too much friction)
- Custom Zotero translator (fragile, unnecessary when generic translators work with proper metadata)
- BibTeX download (RIS covers all major reference managers; BibTeX can be added later if requested)

---

## Implementation

### Tier 1: Highwire Press Meta Tags (Article Pages)

**What:** Add `citation_*` meta tags to the `<head>` of every article detail page (`/library/{slug}`).

**Why:** The Zotero Connector's "Embedded Metadata" translator (priority 400) reads these tags. When present, the Connector shows an article icon in the browser toolbar. One click saves the article with full metadata. This is how PubMed, Google Scholar, JSTOR, and every major academic publisher enables Zotero support.

**Where:** `src/layouts/BaseLayout.astro` (new optional prop) or `src/pages/library/[...slug].astro` (inline in head slot).

**Tags to emit:**

| Meta Tag | Source Field | Notes |
|----------|-------------|-------|
| `citation_title` | `article.title` | Required |
| `citation_author` | `article.authors` split on `;` | One `<meta>` per author, repeatable |
| `citation_publication_date` | `article.datePublished` | Format: `YYYY/MM/DD` or `YYYY` |
| `citation_journal_title` | `article.journal` | |
| `citation_journal_abbrev` | `article.journalAbbv` | |
| `citation_volume` | `article.volume` | |
| `citation_issue` | `article.issue` | |
| `citation_firstpage` | `article.pages` split on `-` | First part |
| `citation_lastpage` | `article.pages` split on `-` | Second part |
| `citation_doi` | `article.doi` | |
| `citation_pmid` | `article.pmid` | |
| `citation_abstract` | `article.abstract` | Full abstract text |
| `citation_keywords` | `article.topics.join('; ')` | Semicolon-separated |

**Implementation notes:**
- All build-time. Zero runtime JS.
- Authors field uses `;` as delimiter (Airtable formula joins with `;`). Split and trim.
- Pages field may use `–` (en-dash) or `-` (hyphen). Handle both.
- Only emit tags when values are non-empty.

**Example output:**
```html
<meta name="citation_title" content="Endometriosis and Fertility Outcomes" />
<meta name="citation_author" content="Smith, Jane A." />
<meta name="citation_author" content="Johnson, Robert B." />
<meta name="citation_publication_date" content="2024/03/15" />
<meta name="citation_journal_title" content="Fertility and Sterility" />
<meta name="citation_volume" content="121" />
<meta name="citation_issue" content="3" />
<meta name="citation_firstpage" content="456" />
<meta name="citation_lastpage" content="467" />
<meta name="citation_doi" content="10.1016/j.fertnstert.2024.01.001" />
<meta name="citation_pmid" content="38234567" />
```

---

### Tier 2: COinS Spans (List & Search Pages)

**What:** Add invisible `<span class="Z3988">` elements inside each article card on pages that list multiple articles.

**Why:** The Zotero Connector's COinS translator (priority 310, higher than Embedded Metadata) detects these. When multiple COinS spans are on one page, Zotero shows a **folder icon** — clicking it opens a dialog where users select which articles to save. This is the standard way academic databases enable batch save from search results.

**Where:** `src/components/ArticleCard.astro` — add a COinS span inside each card.

**Format:** URL-encoded OpenURL parameters in the `title` attribute:

```html
<span class="Z3988" title="ctx_ver=Z39.88-2004&rft_val_fmt=info%3Aofi%2Ffmt%3Akev%3Amtx%3Ajournal&rft.genre=article&rft.atitle=...&rft.jtitle=...&rft.volume=...&rft.issue=...&rft.spage=...&rft.epage=...&rft.date=...&rft.au=...&rft_id=info%3Adoi%2F..."></span>
```

**Key COinS fields:**

| Parameter | Value | Source |
|-----------|-------|--------|
| `ctx_ver` | `Z39.88-2004` | Constant |
| `rft_val_fmt` | `info:ofi/fmt:kev:mtx:journal` | Constant for journal articles |
| `rft.genre` | `article` | Constant |
| `rft.atitle` | Article title | `article.title` |
| `rft.jtitle` | Journal name | `article.journal` |
| `rft.volume` | Volume | `article.volume` |
| `rft.issue` | Issue | `article.issue` |
| `rft.spage` | Start page | `article.pages` split |
| `rft.epage` | End page | `article.pages` split |
| `rft.date` | Date | `article.datePublished` or `article.year` |
| `rft.au` | Author (repeatable) | `article.authors` split on `;` |
| `rft_id` | `info:doi/{doi}` | `article.doi` |
| `rft_id` | `info:pmid/{pmid}` | `article.pmid` |

**Pages affected:**
- `/library` (hero recent articles, browse grid)
- `/library/page/{n}` (paginated browse)
- `/library/saved` (saved articles list)
- `/commentary` and `/commentary/page/{n}` (blog cards — use `rft.genre=blogPost`)
- Search results (dynamically rendered by Pagefind — may need JS injection)

**Implementation notes:**
- Build a helper function `buildCOinS(article): string` in a shared utility.
- The span is invisible (no content, no dimensions). It's purely machine-readable.
- Each card gets one span. A page with 50 cards has 50 spans.

---

### Tier 3: RIS Download Button (Article Pages)

**What:** Add a "Download Citation" button on each article detail page that generates and downloads an RIS file client-side.

**Why:** Works for ALL reference managers (Zotero, Mendeley, EndNote, RefWorks, Papers). No browser extension required. If the user has Zotero installed and the "Use Zotero for RIS files" preference enabled, clicking the download auto-imports into Zotero without manual file handling.

**Where:** `src/pages/library/[...slug].astro` — in the `.topbar-actions` div, next to the share and save buttons.

**Button placement:** Third icon button in the topbar actions row: `[link] [bookmark] [download]`

**Icon:** Download/export icon (arrow pointing down into a tray, or a document with arrow).

**RIS format spec:**

```
TY  - JOUR
AU  - Smith, Jane A.
AU  - Johnson, Robert B.
TI  - Endometriosis and Fertility Outcomes
T2  - Fertility and Sterility
JO  - Fertil Steril
AB  - Background: This systematic review...
DA  - 2024/03/15
PY  - 2024
VL  - 121
IS  - 3
SP  - 456
EP  - 467
DO  - 10.1016/j.fertnstert.2024.01.001
N1  - PMID: 38234567
KW  - endometriosis
KW  - fertility
UR  - https://rrmacademy.org/library/endometriosis-fertility-outcomes
ER  -
```

**Key RIS tags:**

| Tag | Field | Notes |
|-----|-------|-------|
| `TY` | Type | `JOUR` (journal article). Must be first line. |
| `AU` | Author | Repeatable. Format: `Last, First Middle` |
| `TI` | Title | |
| `T2` | Journal | Secondary title = journal name |
| `JO` | Journal abbreviation | |
| `AB` | Abstract | |
| `DA` | Date | Format: `YYYY/MM/DD` |
| `PY` | Year | |
| `VL` | Volume | |
| `IS` | Issue | |
| `SP` | Start page | |
| `EP` | End page | |
| `DO` | DOI | |
| `N1` | Notes | `PMID: {pmid}` |
| `KW` | Keyword | Repeatable |
| `UR` | URL | Canonical URL on RRM site |
| `ER` | End | Must be last line. |

**Implementation:**
- Client-side JS generates the RIS string from article data attributes (already available on the save button).
- Creates a Blob with MIME type `application/x-research-info-systems`.
- Triggers download via `URL.createObjectURL()` + temporary `<a>` element.
- Filename: `{doi-with-slashes-replaced}.ris` or `PMID-{pmid}.ris` or `{slug}.ris`.

**Data availability:** The save button already has `data-slug`, `data-title`, `data-authors`, `data-journal`, `data-year`. For the RIS download we need additional fields. Two options:
1. **Add more data attributes** to the download button (volume, issue, pages, doi, pmid, abstract, journalAbbv, topics, datePublished).
2. **Use `define:vars`** to pass the full article object to an inline script block.

Option 2 is cleaner since we already have the full `article` object in the Astro frontmatter.

---

### Tier 4: Batch Export from Saved Articles

**What:** Add an "Export All" button on `/library/saved` that downloads a single RIS file containing all saved articles.

**Why:** Researchers who bookmark articles across multiple sessions want to import their entire collection into Zotero at once.

**Where:** `src/pages/library/saved.astro` — button in the header area, next to "Clear All."

**Challenge:** The saved articles in localStorage only store minimal metadata (`slug`, `title`, `authors`, `journal`, `year`, `savedAt`). A proper RIS export needs DOI, PMID, volume, issue, pages, abstract, etc.

**Solutions (pick one):**

**Option A: Enrich saved data at save time.**
When saving an article from the synopsis page, store the full metadata needed for RIS export. This means adding more fields to the localStorage object:

```javascript
{
  slug: "endometriosis-fertility",
  title: "Endometriosis and Fertility Outcomes",
  authors: "Smith, Jane A.; Johnson, Robert B.",
  journal: "Fertility and Sterility",
  journalAbbv: "Fertil Steril",
  year: "2024",
  datePublished: "2024-03-15",
  volume: "121",
  issue: "3",
  pages: "456-467",
  doi: "10.1016/j.fertnstert.2024.01.001",
  pmid: "38234567",
  abstract: "Background: ...",
  topics: ["endometriosis", "fertility"],
  savedAt: "2026-02-22T..."
}
```

**Pros:** Export works instantly, no network calls. Works offline.
**Cons:** Increases localStorage usage (~1-2KB per article instead of ~200B). For 100 saved articles that's ~200KB, well within the 5-10MB localStorage limit.

**Option B: Build-time JSON index.**
Generate a static JSON file at build time (`/library/articles-index.json`) containing all articles with export-relevant fields. The saved page fetches this file and matches by slug.

**Pros:** Saved data stays minimal. Always has latest metadata.
**Cons:** JSON file for 3,000 articles with abstracts would be ~5-10MB. Too large.

**Option C: Slim build-time index (no abstracts).**
Same as B but exclude abstracts. Reduces to ~500KB-1MB. Fetch on demand when user clicks "Export All."

**Recommended: Option A** — enrich at save time. It's the simplest, works offline, and localStorage can handle it. Existing saved articles (with minimal data) get a graceful fallback: export whatever fields are available, skip the rest. New saves include full metadata.

**RIS batch format:** Multiple `TY...ER` blocks concatenated in one `.ris` file. Filename: `rrm-library-saved-{count}-articles.ris`.

---

## File Changes

| File | Change | Tier |
|------|--------|------|
| `src/layouts/BaseLayout.astro` | Add `citationMeta` prop for Highwire tags in `<head>` | 1 |
| `src/pages/library/[...slug].astro` | Pass citation meta to BaseLayout; add RIS download button + script | 1, 3 |
| `src/components/ArticleCard.astro` | Add COinS `<span class="Z3988">` inside each card | 2 |
| `src/pages/library/saved.astro` | Add "Export All" button + RIS batch generation script | 4 |
| `src/pages/library/[...slug].astro` (save script) | Enrich saved article data with full metadata for future batch export | 4 |

No new dependencies. No backend. No API keys. Everything is build-time HTML or client-side JS.

---

## Verification

1. **Tier 1 — Highwire tags:**
   - Install Zotero Connector browser extension
   - Visit any `/library/{slug}` page
   - Connector icon should change to an article icon (not generic webpage icon)
   - Click it → article appears in Zotero with full metadata (title, authors, journal, DOI, etc.)
   - Verify in page source: `<meta name="citation_title" ...>` present in `<head>`

2. **Tier 2 — COinS:**
   - Visit `/library` or `/library/page/2`
   - Connector icon should show a folder icon (multiple items detected)
   - Click it → dialog shows list of articles on the page with checkboxes
   - Select a few → they import into Zotero with metadata
   - Verify in page source: `<span class="Z3988" title="ctx_ver=...">` inside each article card

3. **Tier 3 — RIS download:**
   - Visit any article page
   - Click the download/citation button
   - Browser downloads a `.ris` file
   - Open the file in a text editor → valid RIS format with all metadata
   - If Zotero is installed: file auto-imports (or import via File → Import)
   - Test with Mendeley, EndNote, or RefWorks for universal compatibility

4. **Tier 4 — Batch export:**
   - Save 3-5 articles from different synopsis pages
   - Go to `/library/saved`
   - Click "Export All"
   - Browser downloads a single `.ris` file with multiple records
   - Import into Zotero → all articles appear

---

## Priority & Effort

| Tier | Feature | Effort | Impact | Dependencies |
|------|---------|--------|--------|-------------|
| 1 | Highwire meta tags | ~30 min | High — Zotero Connector auto-detect | None |
| 2 | COinS spans | ~30 min | High — Multi-select on list pages | None |
| 3 | RIS download button | ~45 min | Medium — Universal export | None |
| 4 | Batch export + enriched saves | ~1 hr | Medium — Power user feature | Tier 3 (reuses RIS generation) |

Tiers 1-2 are build-time only (zero runtime JS). Can ship independently.
Tiers 3-4 add small client-side scripts. Can ship independently.

---

## References

- [Zotero: Exposing Metadata for Developers](https://www.zotero.org/support/dev/exposing_metadata)
- [Zotero Web API v3](https://www.zotero.org/support/dev/web_api/v3/basics)
- [Princeton CDH: Zotero Integration Guide](https://cdh.princeton.edu/blog/2025/11/11/making-research-easier-to-save-a-guide-to-zotero-integration-for-academic-websites/)
- [RIS Format Reference](https://handwiki.org/wiki/RIS_(file_format))
- [COinS (ContextObjects in Spans) Spec](https://en.wikipedia.org/wiki/COinS)
