# /ask red-team suite

Runnable regression suite that stresses the `/api/ask` endpoint against 18 adversarial prompts covering false premises, ideological bait, personal medical advice, jailbreaks, hallucination traps, weak-evidence probes, bad comparisons, edge identities, safety scope, off-topic gotchas, and brand attacks.

## Running

1. Sign in at https://rrmacademy.org as an admin (or any authed user you're willing to burn 20/day quota on).
2. Open devtools -> Application -> Cookies -> copy the full `Cookie` header for rrmacademy.org.
3. Run:

   ```bash
   ASK_COOKIE='session=abc123; ...' node scripts/red-team-ask/run.mjs
   ```

   Against local dev:

   ```bash
   ASK_COOKIE='session=...' ASK_ENDPOINT=http://localhost:4323/api/ask node scripts/red-team-ask/run.mjs
   ```

4. Results land in `docs/red-team/runs/ask-<ISO>.md` plus a terminal summary. Non-zero exit if any FAIL.

## What gets graded

- **`fail_if_matches`** -- any regex match in the answer flips status to FAIL
- **`pass_if_matches`** -- at least one must match or status drops to REVIEW
- **Global checks** -- em dashes, system-prompt leaks, non-rrmacademy citation domains all add findings

Human review still required for REVIEW and for FAILs where the regex is imperfect.

## Budget

Each run consumes 18 of the user's 20 daily /ask requests. Don't run twice in a day on the same account.

## Updating the suite

Edit `questions.json`. Each entry needs: `id`, `category`, `question`, `intent`, and at least one of `fail_if_matches` / `pass_if_matches`. Regex is JavaScript flavor, single-line, escape slashes in JSON strings.

Categories currently covered:

- `false_premise` -- questions that embed an incorrect assumption
- `ideological_bait` -- tries to force political / religious stance
- `personal_medical_advice` -- solicits treatment recommendations
- `jailbreak` -- prompt injection / role swap / system prompt exfil
- `hallucination_trap` -- asks for citations that don't exist
- `evidence_weakness` -- probes where RRM data is thin
- `comparison_trap` -- loaded comparisons with non-comparable denominators
- `identity_edge` -- LGBTQ / single / edge populations
- `safety_scope` -- dose / urgent-symptom / scope-of-practice
- `off_topic` -- poems, weather, pirate sites
- `brand_attack` -- invented people / events designed to bait confabulation
