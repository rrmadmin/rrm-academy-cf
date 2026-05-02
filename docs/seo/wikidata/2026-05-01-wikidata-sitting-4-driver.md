---
title: Sitting 4 Playwright driver run (Wikidata mowsenter warmup)
created: 2026-05-01
plan: docs/superpowers/plans/2026-04-21-wikidata-warmup-sittings.md
account: mowsenter
mode: Playwright over CDP against dedicated automation profile (Brian's iMac, port 9333)
machine: Blue iMac (Tailscale 100.124.153.117)
driver: /tmp/sitting4.mjs
---

# Sitting 4 driver run

Three label/description edits with random browsing interludes between, executed via
Playwright on the dedicated `~/.cache/playwright-comet-profile` automation profile.
Brian's daily Comet on the default profile is untouched.

## Pre-flight checks (already passed 2026-05-01)

- Q2993346: zero English data on item, French label only -- needs label + desc.
- Q106406: English description present, no English label -- label only.
- Q119700870: zero English data, German label only -- needs label + desc.
- Automation profile: exited cleanly, no lock file, cookies persist from sitting 3.
- Port 9333 free; daily Comet (PID 64990) on default profile won't collide.
- Skill `~/.claude/skills/playwright-comet/launch-comet-cdp.mjs` ready.

## Edits

| # | QID | Label (en) | Description (en) |
|---|-----|------------|------------------|
| 10 | Q2993346 | `feline conjunctivitis` | `inflammation of the conjunctiva in cats` |
| 11 | Q106406 | `Gabriele Beyerlein` | (leave existing) |
| 12 | Q119700870 | `laryngeal paralysis` | `paralysis of the vocal folds` |

## Humanization rules (enforced in driver)

- Per-keystroke delay: 60-180ms jitter, character-by-character (`page.keyboard.type` with delay)
- Pre-publish re-read pause: 3-6s
- Post-publish settle: 2-4s
- Interlude between edits: minimum 180s (3 min) wall-clock, 2-3 random Special:Random visits, 2-5 wheel scrolls per visit at 250-700px / 600-1800ms jitter
- No em dashes anywhere in labels, descriptions, edit summaries, or any field
- Skip an edit (don't error) only if a value is already present from another editor; current pre-flight confirms none of the three are pre-occupied

## Verification

Each edit verified via `Special:EntityData/QID.json` API call inside the driver. Mismatches
abort the run. Final result list written to `/tmp/sitting4-results.json` with timestamps.

## Launch sequence

```bash
# 1. Reset profile crash flag (no-op if already clean)
/Users/brian/.claude/skills/playwright-comet/reset-comet-profile.sh

# 2. Spawn Comet on automation profile + CDP port 9333 (helper stays alive in background)
node /Users/brian/.claude/skills/playwright-comet/launch-comet-cdp.mjs > /tmp/cdp.url &
HELPER_PID=$!
sleep 5

# 3. Read CDP endpoint
WS=$(cat /tmp/cdp.url)

# 4. Run driver
WS=$WS node /tmp/sitting4.mjs

# 5. Tear down
kill $HELPER_PID 2>/dev/null
```

## Expected duration

- Login verify + idle: ~30s
- Edit 1 (form load + 2 typed fields + verify): ~30s
- Interlude 1: 3 min minimum
- Edit 2 (label only): ~20s
- Interlude 2: 3 min minimum
- Edit 3 (form load + 2 typed fields + verify): ~30s
- Total: ~8 minutes wall-clock

## Post-run

- Update `docs/superpowers/plans/2026-04-21-wikidata-warmup-sittings.md` Sitting 4 table with live timestamps
- Update memory `wikidata-plan-v2.md` to reflect 11 warmup edits complete
- Begin drafting User:Mowsenter COI disclosure (org-level only, no personal name) ahead of substantive NaPro/RRM work
