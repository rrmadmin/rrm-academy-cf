#!/usr/bin/env python3
"""Inventory P0 findings across all batches, bucket by fixability."""
import json, re, glob, os
from collections import Counter, defaultdict

DROPDIR = "/tmp/glossary-pplx-verify"

# Collect all P0 findings
findings = []
for path in sorted(glob.glob(f"{DROPDIR}/batch-*-result.json")) + [f"{DROPDIR}/calibration.json"]:
    with open(path) as f:
        data = json.load(f)
    for row in data.get("rows", []):
        for fnd in row.get("findings", []):
            if fnd.get("severity") != "P0":
                continue
            findings.append({
                "row_index": row.get("row_index"),
                "term": row.get("term", ""),
                "slug": row.get("slug", ""),
                "part": row.get("part", ""),
                "category": fnd.get("category", ""),
                "claim": fnd.get("claim_verbatim", ""),
                "evidence": fnd.get("evidence_verbatim", ""),
                "evidence_source": fnd.get("evidence_source", ""),
                "suggested_fix": fnd.get("suggested_fix", ""),
            })

print(f"Total P0 findings: {len(findings)}")
print(f"By category: {dict(Counter(f['category'] for f in findings))}")
print()

# Categorize each P0 by fixability
buckets = defaultdict(list)

# Regex helpers
PMID_RE = re.compile(r"PMID[:\s]*(\d{6,10})", re.IGNORECASE)
DOI_RE = re.compile(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.IGNORECASE)

# Phrases that mean "agent gave a clear corrected PMID/DOI"
FIX_HAS_CORRECT_PMID = re.compile(r"(real|correct|replace with|use(?:\s+the)?(?:\s+correct)?)\s+PMID\s*[:#]?\s*(\d{6,10})", re.IGNORECASE)
DROP_CLAIM = re.compile(r"\b(drop|remove|delete|omit)\s+(the\s+)?(citation|claim|reference)\b", re.IGNORECASE)
NO_PAPER_EXISTS = re.compile(r"(does not exist|no paper matching|doesn't exist|fabricated entirely|invented entirely)", re.IGNORECASE)

for fnd in findings:
    fix = fnd["suggested_fix"]
    cat = fnd["category"]
    if cat == "hallucinated_citation":
        m = FIX_HAS_CORRECT_PMID.search(fix)
        if m:
            fnd["correct_pmid"] = m.group(2)
            buckets["auto_fixable_pmid_swap"].append(fnd)
        elif NO_PAPER_EXISTS.search(fix) or NO_PAPER_EXISTS.search(fnd["evidence"]):
            buckets["drop_no_real_paper"].append(fnd)
        elif DROP_CLAIM.search(fix):
            buckets["drop_or_replace_no_pmid"].append(fnd)
        else:
            buckets["citation_needs_brian"].append(fnd)
    elif cat == "drift":
        buckets["drift_needs_brian"].append(fnd)
    elif cat == "fabricated_stat":
        buckets["fabricated_stat"].append(fnd)
    else:
        buckets["other_p0"].append(fnd)

# Cross-term repeats: same PMID in same hallucinated_citation finding
pmid_repeats = defaultdict(list)
for fnd in findings:
    if fnd["category"] != "hallucinated_citation":
        continue
    # Extract PMID from the claim itself
    m = PMID_RE.search(fnd["claim"])
    if m:
        pmid_repeats[m.group(1)].append((fnd["row_index"], fnd["term"]))
repeated_pmids = {p: rows for p, rows in pmid_repeats.items() if len(rows) > 1}

print("BUCKETS:")
for name, items in buckets.items():
    print(f"  {name:35} {len(items):3} findings")

print(f"\nCross-term repeated PMIDs (1 PMID -> N rows): {len(repeated_pmids)}")
for pmid, rows in sorted(repeated_pmids.items(), key=lambda x: -len(x[1])):
    rs = ", ".join([f"r{r}:{t[:30]}" for r, t in rows])
    print(f"  PMID {pmid}: {rs}")

# Save buckets to file for Brian-triage step
with open(f"{DROPDIR}/p0-buckets.json", "w") as f:
    out = {name: items for name, items in buckets.items()}
    out["_cross_term_repeated_pmids"] = repeated_pmids
    json.dump(out, f, indent=2)
print(f"\nSaved buckets to {DROPDIR}/p0-buckets.json")

# Print a few examples per bucket
print("\n=== SAMPLES ===")
for name in ["auto_fixable_pmid_swap", "drop_no_real_paper", "drift_needs_brian", "fabricated_stat"]:
    items = buckets.get(name, [])
    print(f"\n--- {name} ({len(items)}) ---")
    for fnd in items[:3]:
        print(f"  row {fnd['row_index']:3} [{fnd['part']}] {fnd['term']}")
        print(f"    claim: {fnd['claim'][:120]}")
        print(f"    fix:   {fnd['suggested_fix'][:200]}")
        if "correct_pmid" in fnd:
            print(f"    -> swap to PMID {fnd['correct_pmid']}")
