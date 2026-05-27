# Universal "Save Any Page" — Design Spec (v2, hardened)

**Date:** 2026-05-24
**Status:** REVISED after `/arise --deep` spec review (4 Opus tracers, 23 findings).
This v2 folds in all 6 root-cause fixes. Ready to implement.
**Author:** Claude (with Brian)
**Scope:** rrm-academy-cf (Astro + CF Pages Functions + D1 `rrm-auth`)

## 1. Goal

Generalize "Saved Articles" (library only) into "save any **workspace** page" — a
logged-in or anonymous user can save any shell page (library article, commentary,
FAQ, guide, glossary term, pillar) and find them at a top-level `/saved/`.

### Locked decisions (Brian)
1. Save from **workspace (shell) pages only**.
2. Saved view at top-level **`/saved/`** with a **301 from `/library/saved/`**.
3. API via the **coder agent**; spec gets `/arise --deep` first (done — this v2).
4. Terminology: "Save" / "Saved".

## 2. Current state (unchanged from v1 — accurate baseline)

- **localStorage `rrm_saved`** = display source of truth for ALL users. Article-shaped
  `Array<{slug, title, authors, journal, journalAbbv, year, doi, pmid, volume, issue,
  pages, datePublished, abstract, topics, savedAt}>`, keyed by `slug`.
- **D1 `saved_article`** (`rrm-auth`) = server mirror for logged-in users. Columns
  `user_id, article_slug, article_data` (JSON TEXT), `saved_at`. Implicit unique
  `(user_id, article_slug)`.
- **`/api/saved.js`**: `GET`→`{ok, articles}`; `POST {article}` single (`INSERT OR
  REPLACE`); `POST {articles:[]}` batch (`INSERT OR IGNORE`, max 100, ≤10 KiB/item,
  slug ≤500); `DELETE {slug}`. Session-required (401); idempotency-wrapped. Anon =
  localStorage-only.
- Save affordance only on `library/[...slug].astro` (`#save-btn`), `ArticleHero.astro`,
  `community/post/[...id].astro`. localStorage-first + fire-and-forget server mirror.
- `/library/saved` renders localStorage, merges `/api/saved` for logged-in (union by
  slug, server wins).
- Badge: `saved-count`/`saved-link` + `mobile-saved-*` in `Header.astro` (localStorage
  length). **Note: these IDs live in the global Header, which is `display:none` on
  desktop shell pages** — see §3.9.

## 3. Target design (hardened)

### 3.0 Two core model decisions (resolve the arise root causes up front)

**(M1) One canonical URL minter — `canonicalSaveUrl(path)`** — a single pure function
(shared by the save toggle, the migration script's mapping, and the API validator):
```
canonicalSaveUrl(path):
  1. take path only (drop query/hash): path.split(/[?#]/)[0]
  2. lowercase it
  3. ensure leading slash; ensure exactly one trailing slash (collapse repeats)
  4. collapse any internal '//' to '/'
  5. return null if it contains '..' or any char outside [a-z0-9/_-] after step 2
```
Every `url` that enters localStorage or D1 passes through this. Because output is
always lowercase + single-slashed, the D1 PK `(user_id, url)` is unambiguous and the
client/server agree byte-for-byte. (Fixes the casing/`//`/identity cluster — Root 1.)

**(M2) Server is authoritative on read for logged-in users; deletes propagate.**
- Anonymous: localStorage only.
- The **anon→authed transition** (login, or a save while a just-restored session
  resolves): one-time **additive** merge — push localStorage saves to the server
  (`INSERT OR IGNORE`, chunked, §3.8), then **adopt the server set as authoritative**
  (replace localStorage with the server result).
- **Logged-in steady state:** the server set is the source of truth. `/saved/` and the
  badge reconcile by **replacing** localStorage with the server set (NOT unioning), so
  an unsave on one device propagates to others on their next read. (Fixes cross-device
  resurrection — Root 2.)
- Failed server writes go to a `rrm_saved_pending` queue, flushed on the next shell
  page load (§3.6). (Fixes the unreliable mirror — Root 4.)
- During the dual-table rollback window, **DELETE propagates to `saved_article`** for
  article-type urls. (Fixes rollback resurrection — Root 2.)

### 3.1 Saved item shape
- **localStorage item** (superset, to preserve existing article metadata for RIS
  export): `{ url, title, type, savedAt, ...optionalArticleMeta }` where the legacy
  `authors/journal/year/doi/...` fields are **retained when present** (article items
  upgraded from the old shape keep them; new non-article saves simply lack them).
- **D1 `saved_page` row** (minimal, never stores the meta): `{ user_id, url, title,
  type, saved_at }`. The `/saved/` view + RIS export read the optional meta from
  localStorage when present; the server set provides only `{url, title, type, savedAt}`.
- `url` — canonical (M1), the identity key. `title` — non-empty, ≤300 chars. `type` —
  closed enum `article | commentary | faq | guide | glossary | pillar`. `savedAt` — ISO.

### 3.2 D1 schema — `saved_page`
```sql
CREATE TABLE IF NOT EXISTS saved_page (
  user_id   TEXT NOT NULL,
  url       TEXT NOT NULL,        -- always lowercase canonical (M1)
  title     TEXT NOT NULL,        -- app-layer guarantees non-empty
  type      TEXT NOT NULL,        -- closed enum, server-derived (M1/§3.5)
  saved_at  TEXT NOT NULL,        -- ISO 8601
  PRIMARY KEY (user_id, url)
);
CREATE INDEX IF NOT EXISTS idx_saved_page_user ON saved_page(user_id, saved_at DESC);
```
`url` is COLLATE BINARY and that is now SAFE because M1 guarantees lowercase — there is
no casing variance to fold. (Resolves the COLLATE-BINARY-vs-uppercase contradiction.)

### 3.3 Migration (`scripts/migrate-saved-article-to-page.mjs`, one-shot, idempotent)
Runs **AFTER** the new API deploys (§6), so any save made during the window already
dual-wrote `saved_page`; the migration backfills historical rows.
1. `CREATE TABLE IF NOT EXISTS saved_page` + index.
2. Copy each `saved_article` row → `saved_page` with **NULL-safe title in SQL**:
```sql
INSERT OR IGNORE INTO saved_page (user_id, url, title, type, saved_at)
SELECT user_id,
       '/library/' || lower(article_slug) || '/'                         AS url,
       COALESCE(NULLIF(json_extract(article_data,'$.title'),''),
                article_slug)                                            AS title,
       'article'                                                         AS type,
       saved_at
FROM saved_article
WHERE json_valid(article_data) OR article_data IS NULL;   -- skip unparseable rows safely
```
   For rows where `json_valid` is false, fall back in a second pass using
   `article_slug` as the title (never bind NULL into `title NOT NULL`).
3. **Do NOT drop `saved_article`** — retain ≥1 week for rollback (cleanup migration
   later). The `url` derivation MUST use the same `'/library/'||lower(slug)||'/'` shape
   that `canonicalSaveUrl('/library/<slug>/')` produces, so migrated and live-saved
   urls are byte-identical.
4. Report `{copied, skipped, total}`; a non-zero `skipped` is surfaced (visible stall,
   not silent).

**Client localStorage upgrade — `readSaved()` (fully defensive, never throws):**
```
readSaved():
  try:
    raw = localStorage.getItem('rrm_saved')
    arr = JSON.parse(raw || '[]')
    if not Array.isArray(arr): return []
    out = []
    for item in arr:
      if !item or typeof item !== 'object': continue          // drop junk, never throw
      if item.url:                                            // already page-shaped
        out.push(item); continue
      if typeof item.slug === 'string' && item.slug:          // legacy article → upgrade
        u = canonicalSaveUrl('/library/' + item.slug + '/')
        if !u: continue
        out.push({ url:u, title:(item.title||item.slug), type:'article',
                   savedAt:(item.savedAt||nowISO()),
                   ...pick(item, ['authors','journal','journalAbbv','year','doi','pmid',
                                  'volume','issue','pages','datePublished','abstract','topics']) })
      // items with neither url nor usable slug are dropped (documented loss; logged)
    return out
  catch: return []
```
Runs on every shell page (the toggle uses it). It is read-only here; persistence uses
the merge-on-write `writeSaved()` (§3.6) to avoid the two-tab clobber.

### 3.4 `/api/saved` — generalized (coder agent), dual-shape during the window
- **Validation helper** (shared, server-side): `validateSaveUrl(raw)` →
  `canonicalSaveUrl(raw)` then assert `^(?:/[a-z0-9_-]+)+/$`, length ≤500, no `..`,
  no `//` (belt-and-suspenders; M1 already strips). `validateType(url)` →
  **server re-derives** type via `pageTypeFromUrl(url)` (§3.5) and ignores the body's
  `type` (advisory only); reject if null. `title` → trim, reject if empty, clamp ≤300.
- `GET` → reads **`saved_page` only** (no UNION — migration + dual-write cover
  everything). Returns BOTH keys during the window: `{ ok, pages:[...], articles:[...] }`
  where `articles` is the same set mapped to the legacy shape, so the **old frontend
  (Header badge-sync, old saved.astro) keeps working** until it's replaced.
- `POST { page:{url,title} }` → single save: canonicalize+validate; `INSERT OR REPLACE
  INTO saved_page`. **During the window, also `INSERT OR REPLACE INTO saved_article`**
  for `type==='article'` (so rollback + the retained table stay consistent). Accepts the
  legacy `{ article:{slug,...} }` shape too (maps slug→url).
- `POST { pages:[...] }` (or legacy `{articles:[...]}`) → batch: per-item canonicalize+
  validate, invalid items skipped (not whole-request 400); cap **per request** at 100
  but the **client chunks** (§3.8) so >100 is not lost.
- `DELETE { url }` (or legacy `{slug}`) → `DELETE FROM saved_page`; **during the window
  also `DELETE FROM saved_article`** when the url is article-type.
- Session-required (401), `user_id` always from session, idempotency-wrapped.

### 3.5 Type derivation — `pageTypeFromUrl(path)` (pure, shared client+server)
Detail-path matchers (exactly one non-reserved segment after the prefix); index,
pagination, and reserved paths derive **null** (not saveable):
```
article    : ^/library/(?!page/|saved/)[a-z0-9_-]+/$
commentary : ^/commentary/(?!page/)[a-z0-9_-]+/$
faq        : ^/faqs/[a-z0-9_-]+/$            (the /faqs/ index → null)
glossary   : ^/glossary/[a-z0-9_-]+/$        (the /glossary/ index → null)
pillar     : path ∈ PILLAR_SET               (derived from ssot/pillars.json, NOT hardcoded)
else       : null
```
`PILLAR_SET` is built from `pillars.json` the same way `AppShellChrome.GUIDES_PATHS`
already is, so new pillars become saveable automatically. `guide` type: only the
`/guides/` index is a real page (guides don't live at `/guides/<slug>`), so a saved
"guide" is `/guides/` itself → treat as type `pillar` (drop the standalone `guide`
enum value; enum becomes `article|commentary|faq|glossary|pillar`). The toggle renders
ONLY when `pageTypeFromUrl(canonicalSaveUrl(location.pathname)) !== null` (INV-8).

### 3.6 Save affordance — one shell toggle (workspace pages only)
A single **"Save page" toggle** in `AppShellChrome` chrome (top of the main content
column), present on every shell page. Implementation notes:
- **Title source:** required `data-save-title` attribute the page sets (clean title);
  fallback `document.title.replace(/\s*\|\s*RRM Academy\s*$/,'').trim()`, and if that is
  empty, the last URL segment. Clamp ≤300 client-side (matches server).
- **url:** `canonicalSaveUrl(location.pathname)`; hide the toggle if it or
  `pageTypeFromUrl` is null.
- **`writeSaved(mutator)` — merge-on-write (fixes two-tab clobber):**
  re-read `localStorage.rrm_saved` synchronously → apply the add/remove (dedupe by
  `url`) → `try { setItem } catch (QuotaExceededError) { evict oldest by savedAt until
  it fits, cap 500 } `. Only after a successful write update the in-memory array, the
  button state, and the badge. A `storage` event listener on `rrm_saved` re-renders the
  badge/toggle in other tabs (mirror the existing `rrm_theme` cross-tab pattern).
- **Server mirror (logged-in):** single-save POST → check `res.ok`; on failure push the
  item to `rrm_saved_pending` (do NOT revert the local optimistic add — keep it local,
  retry later) and surface nothing. On a 4xx (validation) DO revert the optimistic add
  (the item is invalid and will never sync). On every shell page load when logged in,
  **flush `rrm_saved_pending`** (chunked POST) and on success clear it.
- The existing in-article `#save-btn` on `[...slug].astro` is **removed**; the shell
  toggle is the single save control across all shell pages (no per-template divergence,
  no double control).

### 3.7 `/saved/` view (new top-level page)
- New `src/pages/saved/index.astro`. Add a `saved` `ShellRoute` (extend
  `src/lib/shell-routes.ts`) and gate its chrome on **any enabled workspace route**
  (`isShellEnabled('library') || isShellEnabled('commentary') || …`) so it can never
  render chrome-less while siblings have the sidebar (fixes chrome divergence).
- Renders localStorage immediately (migrated shape), then for logged-in users fetches
  `/api/saved`, and **replaces** localStorage with the server set (authoritative, M2),
  re-renders. Grouped by `type` (Articles, Commentary, FAQs, Glossary, Pillars), each
  item a link (`href` = the validated `url`, rendered via `textContent`/`href` only —
  never innerHTML), title, type chip, remove (×). Empty states per group + global.
- **RIS "Export all"** stays, reads the optional article meta from localStorage items
  that have it; non-article items are omitted from the RIS export (only articles export
  as `TY - JOUR`). Documented: items saved on a device that never held the full card
  export as title+URL only.
- **301 `/library/saved/` → `/saved/` via rrm-router ONLY** (single rule, matches both
  slashed and unslashed old paths). No middleware duplicate. `src/pages/library/
  saved.astro` is kept building through the soak (so rollback can serve it) and removed
  in the post-soak cleanup; while the router 301 is live it shadows the built page.

### 3.8 Anonymous → login sync (chunked, then authoritative)
On the anon→authed transition, batch-POST migrated `rrm_saved` → `/api/saved {pages}`
**in chunks of ≤100** (loop until all sent, accumulate the merged set). Then **replace**
localStorage with the server's returned set (authoritative). No save is lost regardless
of count; subsequent reads are server-authoritative so deletes propagate.

### 3.9 Badge — visible on every save surface
- Keep the Header badge mechanism (`saved-count`/`mobile-saved-count`, localStorage
  length, `has-items`).
- **Add a count badge to the desktop sidebar Save iconbtn** in `AppShellChrome`
  (the global Header is `display:none` on desktop shell, so the Header badge gives no
  feedback there). Wire a `shell-saved-count` element updated by the same
  `updateBadge()` path. (Fixes the desktop-shell no-feedback gap.)

## 4. Invariants (hardened)
- **INV-1 (identity):** every `url` is `canonicalSaveUrl()` output (lowercase, single-
  slashed); no two saved items share a `url` per user; client + server + migration mint
  byte-identical urls.
- **INV-2 (anon works):** all save/unsave/list paths function with no session
  (localStorage only).
- **INV-3 (migration safety):** new API deploys before the migration runs, and the API
  dual-writes `saved_page`+`saved_article` during the window, so no save is lost in the
  gap; every `saved_article` row maps to exactly one `saved_page` row; `title` is never
  NULL/empty; legacy table retained for rollback.
- **INV-4 (type authoritative):** the server derives `type` from `url`; the body's
  `type` is advisory; non-derivable urls are rejected.
- **INV-5 (url safety):** `url` matches `^(?:/[a-z0-9_-]+)+/$`, no `//`, no `..`, no
  scheme; rendered only via `href`/`textContent`.
- **INV-6 (user scoping):** every D1 read/write filters by session `user_id`.
- **INV-7 (idempotency):** double-save/unsave/replay is a no-op (PK + idempotency
  wrapper + canonical url).
- **INV-8 (toggle gating):** the toggle is hidden when `pageTypeFromUrl(url) === null`
  (index, pagination, `/library/saved/`, non-workspace).
- **INV-9 (link integrity):** all internal nav links (4 AppShellChrome touchpoints:
  sidebar iconbtn, bottom-nav, drawer, + the `inSaved` predicate; 2 Header badge hrefs)
  target `/saved/` DIRECTLY; the 301 serves only external/old bookmarks; `/saved/`
  resolves 200 (incl. `PUBLIC_SHELL_ROUTES` updated) BEFORE any link repoints to it.
- **INV-10 (deletes propagate):** an unsave removes the row from `saved_page` AND (during
  the window) `saved_article`; logged-in reads replace (not union) localStorage with the
  server set so deletes propagate cross-device and survive rollback.
- **INV-11 (client write safety):** `readSaved()` never throws; `writeSaved()` is merge-
  on-write + quota-guarded; client validation is a strict subset of server validation
  (a client-accepted item always passes the server).

## 5. Sample records / sequences (for the implementation arise)
- **R1 (anon article):** save `/Library/Foo-REC1/` → `canonicalSaveUrl` → `/library/foo-rec1/`;
  localStorage item `{url, title, type:'article', savedAt, authors, journal, ...}`; badge 1; no net.
- **R2 (glossary, logged in):** save `/glossary/isthmocele/` → localStorage + POST
  `{page:{url, title:'Isthmocele'}}` → server derives type `glossary` → `saved_page` row.
- **R3 (legacy upgrade):** `{slug:'foo-rec1', title:'Foo', authors:'…'}` → upgraded to
  `{url:'/library/foo-rec1/', title:'Foo', type:'article', savedAt, authors:'…'}` (meta kept).
- **CMD-1 (two tabs):** tab A saves X, tab B saves Y concurrently → merge-on-write +
  storage event → both present, neither clobbered.
- **CMD-2 (>100 anon → login):** 140 saves → chunked sync (2 chunks) → all 140 on server.
- **CMD-3 (cross-device unsave):** device A unsaves X → server delete → device B reads →
  localStorage replaced with server set → X gone on B (no resurrection).
- **CMD-4 (deploy gap):** save during the API-deployed-but-pre-migration window → API
  dual-writes `saved_page` → migration later is a no-op for it → never lost.
- **CMD-5 (rollback):** unsave X under new design → DELETE hits both tables → rollback
  reverts frontend to `/library/saved` reading `saved_article` → X stays gone.
- **CMD-6 (mirror retry):** logged-in save while D1 down → optimistic local + pending
  queue → next shell page load flushes pending → server gets it.

## 6. Rollout (reordered for safety) / rollback
1. **API first** — deploy generalized `/api/saved`: dual-accepts request shapes,
   dual-emits `pages`+`articles`, writes `saved_page` + dual-writes `saved_article`
   (article-type), DELETE propagates to both, server-derives type. Backward-compatible
   with the still-live old frontend.
2. **Migration** — run `migrate-saved-article-to-page.mjs --remote`; verify
   `{skipped:0}` (or investigate). Backfills historical rows; gap saves already in
   `saved_page` via step 1's dual-write.
3. **Frontend** — shell save toggle + `writeSaved`/`readSaved` + `rrm_saved_pending`
   flush + `/saved/` page + sidebar Save count badge; repoint ALL 6 touchpoints + the
   `inSaved` predicate to `/saved/`; add router 301; **add `saved` to
   `PUBLIC_SHELL_ROUTES` in the same deploy**, gated on `https://rrmacademy.org/saved/`
   returning 200 before any repoint is announced. `/library/saved.astro` kept building.
4. **Soak ≥1 week**, then **cleanup**: drop `saved_article`, remove the API dual-write +
   `articles` dual-emit + legacy-shape acceptance, remove `/library/saved.astro` (router
   301 stays permanent).
- **Rollback (pre-cleanup):** revert frontend AND API together (or rely on the API's
  backward-compat dual-emit so an old frontend still reads `articles`). `saved_article`
  is intact + delete-propagated, so logged-in saves/unsaves are consistent; `saved_page`
  is additive and can be left.

## 7. Resolved decisions (was §7 open questions)
1. In-article `#save-btn`: **removed** (shell toggle is the single control).
2. `/saved/` 301: **rrm-router only**, single rule, both path forms.
3. Transitional GET union: **dropped** — migrate-all-up-front + dual-write, read
   `saved_page` only.
4. Title source: **required `data-save-title`** + document.title-strip fallback + non-
   empty guard.
5. Single `saved_page` table (full generalization); `saved_article` retained only for
   the rollback window.
6. Guard manifest: `/api/saved.js` is not currently guarded; **confirm during coding**
   whether accepting arbitrary same-origin urls warrants adding it (likely yes — add to
   `guard-manifest.json`). The coder agent flags this.

## 8. Out of scope
- Folders/collections/tags. Real-time cross-device sync (model is eventual; deletes DO
  propagate on next read per INV-10). Saving external/off-origin URLs.
