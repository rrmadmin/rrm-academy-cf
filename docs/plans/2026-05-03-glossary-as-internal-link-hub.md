# Glossary as the internal-link hub

> Status: planned, not started.
> Origin: 2026-05-03 conversation. Five course descriptions had inline `[term](/glossary/<slug>/)` markdown links. Stripped on the same day after Brian flagged that course descriptions are short marketing copy and inline glossary links pull attention sideways. The glossary's single-page anchor architecture also makes each click a full-page navigation just to scroll, which is more disruptive than helpful.

## The new direction

Invert the link graph.

- **Glossary entries** become the hubs. Each term gets an outgoing list of related courses, commentary posts, library articles, and FAQs. Visiting a glossary term gives a reader everything we have on that topic.
- **Courses** stay clean. No inline glossary links in titles, descriptions, or step bodies. Internal linking on a course detail page should be limited to:
  - "Related courses" (curated, ~3-5 per course)
  - "Cited in" backlinks from glossary/library if useful
- **Commentary / library articles** keep contextual links to glossary terms only when the term is genuinely critical to the reading. Default to plain text. Editorial discretion.
- **FAQs** likely benefit from glossary links more than long-form content, since FAQ answers are short and a defined-term link can carry weight. Defer judgment.

## Why this is right

- Course descriptions are SERP snippets and conversion copy. Every link is a leak. Brian: "courses should probably not have a bunch of internal links except to other related courses."
- The glossary is currently a single 200+-term page with anchor jumps. That's a poor click target -- a tiny anchor scroll, no chance to surface adjacent context, no rich UI for the term itself.
- Inverting the relationship lets the glossary become a real entry surface for SEO and AI retrieval. Each term answers a query like "what is [term]" + "where is [term] discussed across this site."
- The hub model also de-couples linking from copywriting. Editors can write course descriptions without thinking "should this be a link?" Instead the glossary tooling owns the discovery surface.

## Architecture sketch (to detail in a design doc later)

Three new schema additions in `rrm-auth`:

- `glossary_term_link` join table -- term_slug -> {target_type, target_id, sort_order, link_label?}
  - target_type: course | commentary | library | faq | external
  - target_id: rrm-auth course.id / posts.id / faq.id ; or rrm-library articles.id ; or external URL
- Derived "Cited in" view on each glossary term page (top of screen or right rail).
- Optional reverse view on course detail pages: "Glossary terms covered" (read-only, derived from join table).

Authoring flow: a `/glossary-update` skill workflow lets a curator add target_id rows when a new course/commentary ships. No prose editing required; just a structured link list.

Build: `fetch-glossary-data.mjs` joins term_link rows when fetching, emits enriched glossary.json with per-term outbound link arrays. Astro renders a "Discussed in" section per term.

## Out of scope (defer)

- Per-term landing pages (`/glossary/<slug>/`) -- separate decision. The hub model works either with the existing single-page glossary (anchor scrolling reveals the inline list) or with future per-term pages. Don't gate this work on that.
- Two-way sync UI in admin. Manual SQL until the join table proves itself.
- Bulk-link auto-generation from existing content (text-mining course bodies for term mentions). Could come later as a tool, but human curation first.

## What "done" looks like (acceptance criteria, future)

1. `glossary_term_link` exists in `rrm-auth`, populated for at least 25 terms with 3+ outbound links each.
2. Glossary page renders a "Discussed in" block per term with those links.
3. No course description, course step body, or commentary body links inline to `/glossary/<slug>/` or `/glossary/#<slug>`. (Current state, post-2026-05-03 strip.)
4. Either a `/courses-update` workflow or a separate `/glossary-link` skill exists for adding term -> content links without raw SQL.

## Related work

- `/glossary-update` skill at `~/.claude/skills/glossary-update/SKILL.md` -- existing skill for term editing, would extend with a link-management workflow.
- `/courses-update` skill -- enforces "courses link only to other courses" once the hub model lands. Today it allows arbitrary description content.
- 2026-05-03 strip commit (D1 SQL UPDATE on 5 course rows) -- removed 11 inline glossary links from course descriptions. No router or `_redirects` impact; descriptions just no longer reference glossary URLs.

## Out-the-door notes for future-Brian

- The 8 glossary URL redirects (`/glossary/endometriosis/` -> `/glossary/#endometriosis`) live in the rrm-router worker (`GLOSSARY_ANCHOR_REDIRECTS` map at `~/iCode/projects/rrm-router/src/index.js`). Those handle external referrers and stale Google index entries. The hub-model work doesn't change that -- those redirects are orthogonal.
- Menopause: still no anchor on the live glossary index page. Add the term first, then the redirect target stops being `/glossary/` (index) and starts being `/glossary/#menopause` (real anchor). Tracked separately.
