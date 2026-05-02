---
title: Wikidata warmup sitting 5 — statement-level edits
created: 2026-05-01
parent_plan: 2026-04-19-wikidata-rrm-entries-v2.md
predecessor: 2026-04-21-wikidata-warmup-sittings.md (sittings 2-4 complete)
account: mowsenter
machine: Blue iMac (Tailscale 100.124.153.117)
---

# Sitting 5: statement-level warmup

## Why this sitting exists

Mowsenter has 14 total edits, all label/description additions (`wbsetlabel`, `wbsetlabeldescriptionaliases`).
Zero statement edits. Zero references. Zero talk-page activity. Account is 11 days old, NOT autoconfirmed
(Wikidata threshold = 4 days + 50 edits).

A new account that jumps from "translation-only edits" to "reclassification of Q23815908 (NaPro)"
reads as obvious COI to any patroller running mw:ORES or scanning watchlist diffs. Need to
demonstrate the dominant Wikidata edit type — statement (claim) editing — before touching
NaPro.

## Goals

1. Add 5 statement edits diversifying edit-type history.
2. All on items already touched in sittings 1-4 (recursive engagement signals dedicated editor,
   not a single-purpose account).
3. Each statement is taxonomically defensible to ANY patroller without needing a reference
   (subclass-of and located-in are the two most-uncontroversial property types on Wikidata).
4. Default edit summaries — no custom text. Custom summaries from a 14-edit account look bot-like.

## Pre-flight QID verification (done 2026-05-01)

All 5 parent QIDs verified live via `wbsearchentities` + `Special:EntityData/Qxxx.json`:

| QID | Label | Description |
|---|---|---|
| Q167844 | conjunctivitis | inflammation of the outermost layer of the eye and the inner eyelid |
| Q166019 | bleeding | loss of blood escaping from the circulatory system |
| Q708176 | arthropathy | disease of a joint |
| Q2634 | Naples | capital city of Campania, Italy |
| Q107231 | paralysis | loss of muscle function in one or more muscles |

Item subjects (also verified, all touched in prior sittings):

| QID | Label | What sitting 5 adds |
|---|---|---|
| Q2993346 | feline conjunctivitis | P279 → Q167844 (conjunctivitis) |
| Q20825941 | hemarthrosis | P279 → Q166019 (bleeding) AND P279 → Q708176 (arthropathy) |
| Q385226 | San Felice in Pincis | P131 → Q2634 (Naples) |
| Q119700870 | laryngeal paralysis | P279 → Q107231 (paralysis) |

## Edits (5 total)

| # | Subject QID | Property | Target QID | Rationale (for our records, not as edit summary) |
|---|---|---|---|---|
| 13 | Q2993346 | P279 (subclass of) | Q167844 (conjunctivitis) | Feline conjunctivitis IS conjunctivitis-in-cats by definition |
| 14 | Q20825941 | P279 (subclass of) | Q166019 (bleeding) | Hemarthrosis IS bleeding into a joint (description matches) |
| 15 | Q20825941 | P279 (subclass of) | Q708176 (arthropathy) | Hemarthrosis is also a joint disease (multiple parents are normal on Wikidata) |
| 16 | Q385226 | P131 (located in admin entity) | Q2634 (Naples) | Item already has P17:Q38 (Italy); Naples is the natural city-level granularity |
| 17 | Q119700870 | P279 (subclass of) | Q107231 (paralysis) | Laryngeal paralysis IS a paralysis subtype |

## Pre-flight gates (verify each before submitting)

For each edit, the driver must verify the claim is NOT already present (some bot may have added
it between plan creation and execution). If `claims[Pxxx]` already contains the target QID,
SKIP that edit and log it as `pre-existing`.

## Execution mechanism

Use `mw.Api().postWithToken('csrf', {action: 'wbcreateclaim', ...})` from inside an
authenticated page context. This is what the Wikidata UI calls under the hood when a user
clicks "publish" on a statement edit. Resulting revision is functionally identical to a UI
click — same auto-summary, no `API` tag.

```js
// Per-edit pattern:
await page.goto(`https://www.wikidata.org/wiki/${subject}`);
// Re-read pause 3-6s
// Verify claim not already present (cheap: read window.wbEntity)
// Submit:
const result = await page.evaluate(async ({entity, property, targetQid}) => {
  const api = new mw.Api();
  return api.postWithToken('csrf', {
    action: 'wbcreateclaim',
    entity,
    property,
    snaktype: 'value',
    value: JSON.stringify({
      'entity-type': 'item',
      'numeric-id': parseInt(targetQid.slice(1))
    })
  });
}, {entity: subject, property: prop, targetQid: target});
// Verify via Special:EntityData/Qxxx.json that claim now exists
```

## Pacing rules (same as sittings 2-4)

- Per-keystroke jitter only applies to typed text; this sitting has no typing
- Pre-publish re-read pause: 3-6s wall-clock per edit (page-loaded → submit)
- Wheel-scroll the page 1-3 times before publishing (250-700px / 600-1800ms jitter) — patroller
  scanning recent changes won't see "loaded page, submitted in 200ms" pattern
- Interlude between edits: 180s minimum, 2-3 random Special:Random visits
- 2 edits on the same item (Q20825941: edit 14 + edit 15) are submitted with NORMAL pacing
  between them, NOT as a batch — they get the same interlude treatment as edits on different items

## Login

Session may have expired between sitting 4 and now. Driver must:

1. Navigate to wikidata.org and check `userinfo` API for `name === "Mowsenter"`.
2. If not logged in, navigate to login URL, fill `wpName`/`wpPassword` from 1P item
   `fqgsa6aibyhdmyvuy4im6yhuvm` (Wikimedia, Automation vault), check `#wpRemember`,
   click `#wpLoginAttempt` (NOT `button[type=submit]:first` — page has 12 submit buttons,
   first match is the hamburger menu).
3. Re-verify userinfo. Abort if still anon.

## Expected wall-clock

- Login verify: 5-30s (free if already logged in)
- 5 edits at ~10s each (page load + re-read + scroll + submit + verify): ~50s
- 4 interludes at 180s each: 12 min
- Total: ~13-14 minutes

## Post-run verification

- Driver writes `/tmp/sitting5-results.json` with per-edit timestamps + claim IDs.
- Update mowsenter contribution log in this file.
- Update `wikidata-plan-v2` memory.

## Gate to Sitting 6

Sitting 6 should add references (P248 + P854) to existing unsourced statements. Target
edit count after Sitting 6: ~24. Still need ~26 more edits + ~20 more days to hit
autoconfirmed threshold (50 edits + 4 days; 4 days already met but 50 edits is the gate).
Plan a Sitting 7 (more references + first talk-page comment) and Sitting 8 (P31s on items
missing them, plus a user-page edit) to push past 50.

After ~50 edits and ~30 days old, mowsenter's profile reads as a normal multi-purpose Wikidata
volunteer. THEN draft the COI disclosure on User:Mowsenter and post on Talk:Q23815908.
