#!/usr/bin/env python3
"""
fact-check-canonical.py -- Canonical-facts-constrained fact checker.

Loads one or more canonical-facts JSON SSOTs, sends the draft + the SSOT(s)
to Perplexity Sonar Pro, and asks the model to flag:
  (a) claims that contradict a canonical fact
  (b) numerical/statistical/PMID/DOI claims absent from the canonical set
  (c) citations without a traceable source in the canonical set

The canonical JSONs are LOADED INTO THE PROMPT as strict context. Perplexity
is instructed to use its own web search ONLY to verify that canonical claims
are accurate, NOT to introduce new facts from the web.

Usage:
    # Check the S-MAP outline against NaPro + RRM canonicals
    ./scripts/fact-check-canonical.py drafts/s-map-technique-outline.md \\
        --canonical naprotechnology --canonical rrm

    # Dry-run (print prompt, don't call API)
    ./scripts/fact-check-canonical.py drafts/my-draft.md \\
        --canonical rrm --dry-run

    # Multiple entities + output path
    ./scripts/fact-check-canonical.py drafts/x.md \\
        --canonical rrm --canonical napro \\
        --out docs/fact-check-results/x-result.md
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent

# Canonical-facts locations by entity slug. Matches scripts/lib/canonical-facts-schema.mjs.
CANONICAL_PATHS = {
    "naprotechnology": PROJECT_DIR / "docs/fact-check/naprotechnology-canonical-facts.json",
    "napro": PROJECT_DIR / "docs/fact-check/naprotechnology-canonical-facts.json",
    "rrm": PROJECT_DIR / "docs/fact-check/rrm-canonical-facts.json",
    "creighton": PROJECT_DIR / "docs/fact-check/creighton-canonical-facts.json",
    "neofertility": PROJECT_DIR.parent / "neofertility-ie/docs/fact-check/neofertility-canonical-facts.json",
}

DEFAULT_RESULTS_DIR = PROJECT_DIR / "docs/fact-check-results"
API_URL = "https://api.perplexity.ai/chat/completions"
MODEL = "sonar-pro"
RATE_LIMIT_SECONDS = 3

SYSTEM_PROMPT = """\
You are a medical-content fact-checker for RRM Academy (rrmacademy.org), a \
restorative-reproductive-medicine nonprofit education platform. Your standard \
is peer-review-defensible.

## Step 1: EXTRACT EVERY CLAIM FROM THE DRAFT

A "claim" is ANY of the following when it appears in the draft — whether in \
prose, bullets, headings, tables, figure captions, or outline form:

- A numerical value (percentage, rate, count, ratio, incidence, probability, \
  p-value, age, dose, duration, length, diameter, N, follow-up period).
- A named study, author, institution, textbook, chapter, or trial.
- A PMID, DOI, PMC ID, trial registration number, or any citation.
- A year attached to a publication, presentation, or event.
- A clinical outcome statement ("X was cured", "Y achieved pregnancy", \
  "Z was in remission", "X is genetically distinct from Y").
- A statistical inference ("likelihood of N cases by one surgeon is 1e-10").
- An attribution ("technique coined by Dr. X", "method described by Dr. Y").
- A specific lesion/mass size, tumor stage, grade, or pathology finding.

Do NOT skip claims just because they are in bullet lists or under outline \
headers. An outline is still full of claims.

You MUST list every claim you extract. If the draft is long, still aim for \
>30 extracted claims. If you extract fewer than 10, re-read the draft — you \
missed claims.

## Step 2: VERDICT EACH CLAIM AGAINST THE CANONICAL SET

For every extracted claim, assign exactly one verdict:

- **PASS**: claim matches a canonical fact in the provided set. Quote the \
  matching fact id (e.g. `fact-rec7HZUCrTabOFGSOjr0-3`).
- **MISMATCH**: claim contradicts a canonical fact. Quote both sides.
- **UNSOURCED**: claim is specific/numerical/cited but has NO match in the \
  canonical set. Must be added to canon or removed from draft.
- **TANGENTIAL**: genuinely non-verifiable editorial framing only (opinion, \
  rhetorical question, definition, teaching analogy). Use sparingly.

Do NOT use web search to replace canonical facts. You MAY use web search \
ONLY to verify that a canonical PMID/DOI resolves to the claimed paper. Do \
not introduce new canonical facts from the web — flag them as UNSOURCED \
instead.

## Step 3: WRITE THE REPORT

Output strict markdown in this exact structure:

# Fact-Check Report: <draft filename>
Date: <ISO date>
Canonical sets loaded: <entity list + record counts>

## Summary
- Total claims extracted: N (must be >0; if 0, you failed step 1)
- PASS: N
- MISMATCH: N  ← MUST FIX
- UNSOURCED: N ← MUST CURATE
- TANGENTIAL: N

## Extracted Claims — Full Verdict Table
| # | Claim (exact quote, trimmed) | Verdict | Canonical match (fact_id) or reason |
|---|---|---|---|
| 1 | ... | PASS | fact-... |
| 2 | ... | UNSOURCED | no canonical match; statistical |

## Mismatches (MUST FIX)
For each MISMATCH:
  **Draft claim:** <exact quote>
  **Canonical fact:** <canonical claim + fact_id>
  **Contradiction:** <one sentence>

## Unsourced Claims (MUST CURATE)
For each UNSOURCED:
  **Claim:** <exact quote>
  **Why sourcing required:** statistical / PMID / DOI / named-study / specific-rate / etc.
  **Suggested action:** "add to canonical set from [probable source]" OR \
  "remove / soften to opinion" OR "verify with curator".

## PMID / DOI / Citation Integrity Check
For every PMID/DOI/trial-ID in the draft: verify with web search that the \
citation string matches the paper. Flag any drift. If the PMID/DOI is also \
in the canonical set, confirm both the draft and the canonical entry agree.

Be terse inside the report, but do not skip claims. Never fabricate a \
PMID/DOI. If uncertain, mark UNSOURCED and say so.
"""


def load_canonical(entity: str) -> dict:
    path = CANONICAL_PATHS.get(entity)
    if not path or not path.exists():
        raise FileNotFoundError(f"Canonical file missing for entity '{entity}': {path}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


STOPWORDS = set(
    """
    the a an and or but of to in on for with by from at as is are was were be been being
    this that these those it its their them they he she his her we our you your us our
    if then else so not no nor also such which who whom what when where why how all any some
    each every other than more most less few many much few first second case cases patient patients
    study studies paper note notes figure figures table tables section sections page pages source sources
    """.split()
)


def tokenize(text: str) -> set[str]:
    """Lowercase, drop stopwords + short tokens, keep alphanumeric + hyphen + digits."""
    words = re.findall(r"[A-Za-z][A-Za-z0-9\-]{3,}|\b\d{4,}\b", text)
    return {w.lower() for w in words if w.lower() not in STOPWORDS}


def fact_keywords(fact: dict) -> set[str]:
    parts = [
        fact.get("claim") or "",
        fact.get("verification_notes") or "",
        (fact.get("source") or {}).get("title") or "",
        (fact.get("source") or {}).get("short_citation") or "",
        (fact.get("source") or {}).get("pmid") or "",
        (fact.get("source") or {}).get("doi") or "",
        fact.get("category") or "",
        fact.get("domain") or "",
    ]
    return tokenize(" ".join(parts))


def compact_canonical_for_prompt(doc: dict, draft_tokens: set[str] | None = None) -> list[dict]:
    """
    Return a pared-down facts list for the prompt.

    If draft_tokens is provided, keep only facts whose keyword set intersects
    the draft. Reduces prompt size dramatically when the draft covers a narrow
    topic vs the full canonical set (e.g. S-MAP draft vs 560 NaPro facts).
    """
    out = []
    for f in doc.get("facts", []):
        if draft_tokens is not None:
            if not (fact_keywords(f) & draft_tokens):
                continue
        src = f.get("source") or {}
        out.append(
            {
                "id": f.get("id"),
                "claim": f.get("claim"),
                "tradition": f.get("tradition"),
                "category": f.get("category"),
                "domain": f.get("domain"),
                "evidence_tier": f.get("evidence_tier"),
                "pmid": src.get("pmid"),
                "doi": src.get("doi"),
                "short_citation": src.get("short_citation"),
                "source_url": src.get("source_url"),
                "verification_quote": f.get("verification_notes"),
            }
        )
    return out


def get_api_key() -> str:
    # Prefer env; fall back to 1Password CLI.
    key = os.environ.get("PERPLEXITY_API_KEY")
    if key:
        return key
    try:
        key = subprocess.check_output(
            ["op", "read", "op://Automation/Perplexity API Key/credential"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        if key:
            return key
    except Exception:
        pass
    sys.exit("Perplexity API key not found in env or 1Password (Automation/Perplexity API Key).")


def call_perplexity(system: str, user: str, dry_run: bool) -> str:
    if dry_run:
        return "[dry-run] system + user prompt built; API not called."
    import urllib.request  # stdlib; no external dep

    key = get_api_key()
    body = json.dumps(
        {
            "model": MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.1,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("draft", help="Path to the markdown draft to fact-check")
    p.add_argument(
        "--canonical",
        action="append",
        required=True,
        help=f"Entity slug (repeatable). Valid: {', '.join(sorted(set(CANONICAL_PATHS)))}",
    )
    p.add_argument("--out", help="Write result to this path (default: docs/fact-check-results/)")
    p.add_argument("--dry-run", action="store_true", help="Build prompt, don't call API")
    p.add_argument(
        "--full",
        action="store_true",
        help="Send full canonical set (default: keyword-filter to draft-relevant facts)",
    )
    args = p.parse_args()

    draft_path = Path(args.draft).resolve()
    if not draft_path.exists():
        sys.exit(f"Draft not found: {draft_path}")

    with open(draft_path, "r", encoding="utf-8") as f:
        draft_text = f.read()

    # Load canonicals (dedup). Keyword-filter unless --full.
    entities = list(dict.fromkeys(args.canonical))
    draft_tokens = None if args.full else tokenize(draft_text)
    if draft_tokens is not None:
        print(f"[fact-check] draft tokens: {len(draft_tokens)} (keyword filter ON)", file=sys.stderr)
    canonical_payload = {}
    total_facts = 0
    total_available = 0
    for ent in entities:
        doc = load_canonical(ent)
        available = len(doc.get("facts", []))
        slim = compact_canonical_for_prompt(doc, draft_tokens=draft_tokens)
        canonical_payload[ent] = {
            "entity_name": doc["_meta"].get("entity_name"),
            "editorial_owner": doc["_meta"].get("editorial_owner"),
            "record_count_full": available,
            "record_count_relevant": len(slim),
            "filter_mode": "keyword" if draft_tokens is not None else "full",
            "facts": slim,
        }
        total_facts += len(slim)
        total_available += available
    print(
        f"[fact-check] sent {total_facts}/{total_available} facts to Perplexity",
        file=sys.stderr,
    )

    user_prompt = (
        f"DRAFT FILE: {draft_path.name}\n\n"
        f"CANONICAL FACTS ({len(entities)} set(s), {total_facts} facts total):\n"
        "```json\n"
        + json.dumps(canonical_payload, indent=2)
        + "\n```\n\n"
        "DRAFT CONTENT:\n"
        "```markdown\n"
        + draft_text
        + "\n```\n\n"
        "Produce the fact-check report as specified in the system prompt."
    )

    # Size guard (Perplexity Sonar Pro ~200K-token context; assume ~4 chars/token).
    approx_tokens = (len(SYSTEM_PROMPT) + len(user_prompt)) // 4
    print(f"[fact-check] entities={entities} canonical_facts={total_facts} ~tokens={approx_tokens}", file=sys.stderr)

    if not args.dry_run:
        time.sleep(RATE_LIMIT_SECONDS)
    reply = call_perplexity(SYSTEM_PROMPT, user_prompt, args.dry_run)

    # Write result.
    out_path = Path(args.out) if args.out else (
        DEFAULT_RESULTS_DIR / f"result-{draft_path.stem}-{'-'.join(entities)}.md"
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    header = (
        f"<!-- generated by fact-check-canonical.py at {datetime.now(timezone.utc).isoformat()} -->\n"
        f"<!-- draft: {draft_path} -->\n"
        f"<!-- canonical sets: {', '.join(entities)} -->\n\n"
    )
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(header + reply + "\n")
    print(f"[fact-check] wrote {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
