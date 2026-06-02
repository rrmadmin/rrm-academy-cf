# Community Link Unfurl — Design Spec

**Date:** 2026-06-02
**Status:** Approved (Brian, 2026-06-02)
**Project:** rrm-academy-cf (Save the Uterus Club community)
**Branch:** `claude/community-link-unfurl`

## Goal

When a STUC member includes a link in a community post, render a Slack/iMessage-style
preview card (image + title + description + domain) beneath the post body. The card is
fetched at render time and cached, so it works retroactively on every existing post with
no database migration.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Fetch timing | Render-time + KV cache (no schema change; retroactive to all posts) |
| Scope | Posts only (feed + single-post page). NOT comments. |
| Links per post | First unfurlable http(s) link only |
| Image delivery | Direct hotlink, **https-only** (http images dropped → text-only card). Image proxy is a future follow-up if hotlink protection breaks cards. |
| Same-site links | Unfurled too (a shared library article gets a card). Not special-cased out. |

## Non-goals

- No comment unfurling.
- No image proxying / re-hosting in v1.
- No stored preview column; nothing persisted to D1.
- No change to the existing event-only `og_image_url` field or the `/events/[slug]` share-card path. This is an orthogonal feature.

## Architecture

```
post body (client)                  /api/community/unfurl?url=     COMMUNITY_KV
  │ firstUnfurlableLink(body)               │  requireMember           │
  │ IntersectionObserver (lazy)             │  SSRF guard              │
  └── fetch ──────────────────────────────► │  KV get ─────────────────┤ hit → return
                                            │  fetch + HTMLRewriter    │
                                            │  KV put (7d / 6h neg) ───►│ miss
      ◄── { ok:true, preview:{…}|null } ────┘
  render .link-card  (or remove if null)
```

### Component 1 — `functions/api/community/unfurl.js` (NEW)

`GET /api/community/unfurl?url=<encoded>`
→ `{ ok: true, preview: { url, title, description, image, siteName, domain } | null }`

Returns the **community-sibling response shape** (`{ ok: true, … }`), per the established
community-endpoint convention (deliberate divergence from the generic `{ results }` standard;
match-siblings wins).

**Auth & rate limit**
- `requireMember(request, env)` — members + staff only. Prevents the endpoint from being an
  open SSRF proxy for anonymous callers. Returns the gate's `Response` on failure.
- `checkRateLimit(env, \`unfurl:${user.id}\`, 60, 3600)` → 429 `{ ok:false, error:'rate_limited' }`
  on exceed. Generous because KV caching means real outbound fetches are rare.

**Input validation / SSRF guard** (`isUnfurlableUrl(raw)` — stricter than the scheme-only
`isSafeUrl` in posts.js):
- Parse with `new URL`. Reject on parse failure.
- Scheme must be `https:` or `http:`.
- Reject URL userinfo (presence of `@` credentials).
- Reject IP-literal hosts: any IPv4 dotted-quad, any bracketed IPv6 `[…]`.
- Reject `localhost`, and hosts ending in `.local`, `.internal`, `.localhost`.
- Reject explicit non-default ports (allow only no-port, `:80`, `:443`).
- Hostname must contain a dot (rejects bare single-label hosts).
- `url` query param length cap 2048; reject otherwise.

**Fetch**
- `redirect: 'manual'`, follow at most **3 hops manually**, re-running `isUnfurlableUrl` on
  each `Location` (blocks redirect-to-private-IP bypass). Resolve relative `Location` against
  the current URL. Non-3xx with no `Location` → treat as final response.
- Timeout 5s via `AbortSignal.timeout(5000)`.
- Request headers: `Accept: text/html,application/xhtml+xml`, descriptive bot UA
  `RRMAcademyBot/1.0 (+https://rrmacademy.org)`.
- Only parse when final `Content-Type` starts with `text/html`. Otherwise → `preview: null`.
- Read at most ~512 KB of the response body (stream + byte cap; the `<head>` is all we need).
  Abort/stop the stream once the cap is hit.

**Parse (HTMLRewriter)**
Idiomatic CF Workers HTML parsing — no fragile regex.
- Collect, in `<head>`:
  - `meta[property="og:title|og:description|og:image|og:site_name|og:url"]` → `content`
  - `meta[name="twitter:title|twitter:description|twitter:image"]` → `content`
  - `meta[name="description"]` → `content`
  - `<title>` text
- Resolve fields with precedence:
  - `title` = og:title → twitter:title → `<title>` → null
  - `description` = og:description → twitter:description → meta description → null
  - `image` = og:image → twitter:image → null
  - `siteName` = og:site_name → final-URL hostname
  - `domain` = final-URL hostname (sans `www.`)
  - `url` = the original requested URL (the link the member can click)
- Resolve a relative `image` against the final response URL. **Drop `image` unless it is
  `https:`** (http would be mixed-content-blocked on our https page).
- If neither `title` nor `image` is found → `preview: null` (nothing worth showing).

**Cache (`COMMUNITY_KV`)**
- Key `unfurl:v1:<sha256hex(originalUrl)>` (hash via `crypto.subtle.digest`).
- Positive result TTL **7 days**.
- Negative result (`preview: null`, fetch error, timeout, non-html, SSRF reject) cached as a
  sentinel with TTL **6 hours**, so dead/unsupported links are not re-hammered.
- KV read failure is non-fatal → proceed to live fetch (mirrors `requireMember`'s KV pattern).

**Errors**
- SSRF/validation failure → `400 { ok:false, error:'invalid_url' }` (NOT cached as negative
  unless it parsed as a URL but failed the safety policy — those are cached negative to absorb
  repeat render calls).
- Upstream fetch failure/timeout → `200 { ok:true, preview:null }` (caller just shows no card),
  negative-cached.
- Internal error → `500 { ok:false, error:'Internal error' }`, logged via `log()`.

### Component 2 — `src/pages/community/index.astro` (EDIT — feed)

- **`firstUnfurlableLink(body)`** helper (client): return the first link in raw body text that is
  a bare/markdown http(s) URL or a bare domain (promoted to `https://`), **excluding**:
  - markdown-image targets `![alt](url)` (already inlined by `linkify` rule 1),
  - `/api/assets/…` internal asset paths (already inlined),
  - returns `null` when none.
  Reuses the URL shapes already recognized by `linkify` (rules 2–4) so detection stays
  consistent with what gets turned into a clickable link.
- In `renderPostCard`, after `bodyEl` is appended (current line ~748–760): if
  `firstUnfurlableLink(post.body)` is non-null, append an empty
  `<div class="link-card" data-link-card hidden>` placeholder and register it with a module-level
  **IntersectionObserver**.
- On intersect (card scrolls into view): `fetch('/api/community/unfurl?url=' + encodeURIComponent(link))`,
  unobserve, then:
  - `preview` null/absent → remove the placeholder (no card).
  - `preview.image` present → full card (media + text), `hidden` removed.
  - `preview.image` absent → text-only card (domain + title [+ desc]).
- **Render is XSS-safe:** `textContent` for `domain`/`title`/`description`; `img.src` set to the
  endpoint-validated https `image`; card is one `<a href=preview.url target="_blank" rel="noopener noreferrer">`.
  `img` carries `loading="lazy"`, `referrerpolicy="no-referrer"`, and an `onerror` that falls back
  to the text-only layout.
- **CSS** added to the existing `<style is:global>` block (runtime-created elements require global,
  not scoped, styles — same reason `.post-card__*` rules live there). Use design-system tokens
  only (verify against `docs/design/design-system.json`; no phantom tokens).

### Component 3 — `src/pages/community/post/[...id].astro` (EDIT — single post)

Same `firstUnfurlableLink` + `.link-card` render + IntersectionObserver applied to `renderPost`'s
body element (current `bodyEl.innerHTML = linkify(post.body)` at ~line 479). This file already
carries its own copy of `linkify` (the codebase duplicates it across both community surfaces);
we **match that sibling pattern** and duplicate the small card-render helper here rather than
introduce a shared module. Card CSS added to this file's `<style>` block.

> Duplication note: `firstUnfurlableLink` + the card renderer (~40 lines) are duplicated across
> the two `.astro` files, consistent with the existing duplicated `linkify`. If a third surface
> ever needs it, extract to a shared client module then.

## Card layout

```
┌───────────────────────────────────────────┐
│ ┌────────┐  RRMACADEMY.ORG                  │
│ │  img   │  Endometriosis: A Restorative…   │
│ │ thumb  │  Short description from og:desc…  │
│ └────────┘                                  │
└───────────────────────────────────────────┘
```
- Horizontal (thumbnail left ~96–120px square, text right) on desktop; stacks vertically on
  mobile (≤520px). Title clamps to 2 lines, description to 2 lines, domain uppercased/muted.
- Whole card is a single clickable `<a target="_blank" rel="noopener noreferrer">`.
- Text-only variant (no image): same card, media column omitted.

## Security & ops checklist

- Endpoint is **not** in the security guard-manifest (auth/billing/middleware/stripe). `posts.js`
  isn't either. → **no `npm run guard:update`.**
- arise-scan pre-commit must pass (data-loss findings block; this endpoint has no writes).
- No D1 migration. No new wrangler binding (`COMMUNITY_KV` already bound).
- New `functions/api/` code is authored via the **`coder` agent** (mandatory), which reads
  sibling endpoints (`posts.js`, `upload.js`, `reactions.js`) first.

## Testing / verification

- `node --check functions/api/community/unfurl.js`.
- `npm run check-types` — no new errors beyond baseline (client `<script>` additions may add the
  usual benign DOM-null noise; keep it minimal).
- `npm run design-tokens:audit` — CLEAN (no phantom tokens) after CSS additions.
- Local: `npx wrangler pages dev dist` is the faithful CF Pages repro; exercise the endpoint with
  a known-good URL (e.g. an rrmacademy.org library article) and confirm card render.
- Post-deploy (go-live gated): Playwright at desktop 1280 + mobile 393×852 — confirm card renders,
  no horizontal overflow, text-only fallback works, dead link → no card.

## Rollout

- All work on `claude/community-link-unfurl`, **not pushed until Brian gives go-live** (claude/*
  auto-merges + deploys on push).
- Revert is trivial: the feature is additive (new endpoint file + additive `.astro` blocks);
  removing the `.link-card` render block and the endpoint fully reverts it.

## Future follow-ups (out of scope)

- Image proxy `/api/community/unfurl/image?url=` (SSRF-guarded, image/* + size cap, edge-cached)
  if third-party hotlink protection or privacy (member IP leakage to third parties) becomes a concern.
- Optional comment unfurling.
- Optional "remove preview" affordance for the author.
