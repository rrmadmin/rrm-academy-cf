# Commentary drafts

Staging area for **draft** commentary / blog posts for the `/commentary/` section. Nothing here is published.

The live site renders `/commentary/` from D1 (`posts` table in `rrm-auth`). Files here are working drafts for human review only. A draft becomes a post solely through the D1 publish pipeline, and only on Brian's explicit go-live (the mockup gate). Saving a file here never publishes anything.

## What goes here

- Speculative or in-progress commentary: ideas worth writing down before they are ready, alternate angles, full drafts awaiting review.
- One file per standalone draft. A subfolder per series (a set of pieces that share a source or theme).

## Frontmatter convention

Every draft starts with YAML frontmatter:

```yaml
---
status: draft          # draft | ready-for-review | approved (still not live until D1 publish)
gate: held at go-live gate; not published
title: "The headline"
slug: kebab-case-slug
author: Dr. Naomi Whittaker, MD, Board-Certified OBGYN   # or Brian Whittaker, etc.
voice: Naomi op-ed     # voice/register used
pillar: Commentary - <topic>
series: <series-name or omit>
source: <citation if data-driven>
companion_research_draft: research-drafts/<slug>   # if paired with a paper
excerpt: "One-line dek."
drafted: YYYY-MM-DD
---
```

Body below the frontmatter is the piece itself, leading with its `# Headline` and byline.

## Status of existing material

- `drafts/commentary/` (this folder) is the convention going forward.
- The flat `drafts/*-post-content.md` files are earlier, pre-convention drafts left in place.

## House rules (carried from CLAUDE.md and memory)

- No em dashes.
- `rrmacademy.org` does not route patients to Dr. Whittaker (not practicing). Patient path is `/providers/`.
- Never lead a fertility/health piece with an absolutist "Yes"; no "non-negotiable / always / never" stacking.
- Strong clinical claims need provenance; verify every stat via rrm-cli / the library before anything ships.
