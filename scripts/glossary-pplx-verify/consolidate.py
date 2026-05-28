#!/usr/bin/env python3
"""Consolidate 13 batch dropfiles + 10-row calibration dropfile into:
  1. A unified findings dataset
  2. Sheet column writes (AL pplx_verify_status, AM pplx_verify_findings, AN pplx_verified_at, AO pplx_verifier)
  3. A markdown summary report at ~/iCode/projects/rrm-academy-cf/docs/glossary-pplx-verify-2026-05-27.md
  4. A cross-term hallucination index (same fabricated PMID/DOI across multiple terms)
  5. A consolidated sheet-curation drift report

Usage:
  python3 /tmp/glossary-pplx-verify/consolidate.py [--dry-run] [--no-write-sheet]
"""

import json
import os
import sys
import subprocess
import urllib.request
import urllib.parse
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

DROPDIR = Path("/tmp/glossary-pplx-verify")
SHEET_ID = "1JNFrImZyp6O17NqNKsdwbvz5tF6K56yXXZ4uxzT2zvk"
TAB = "Glossary"
TODAY = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
REPORT_DATE = datetime.utcnow().strftime("%Y-%m-%d")
REPORT_PATH = Path.home() / "iCode/projects/rrm-academy-cf/docs/glossary-pplx-verify-{}.md".format(REPORT_DATE)

DRY_RUN = "--dry-run" in sys.argv
WRITE_SHEET = "--no-write-sheet" not in sys.argv


def get_token():
    return subprocess.run(
        ["gcloud", "auth", "application-default", "print-access-token"],
        capture_output=True, text=True, check=True
    ).stdout.strip()


def sheets_call(method, path, body=None, token=None):
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("x-goog-user-project", "rrm-academy")
    if data:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as r:
        body = r.read().decode()
        return json.loads(body) if body else {}


def collect_batches():
    """Read all batch-result.json + calibration.json into one list of rows."""
    batches = []
    # Calibration first
    calib = DROPDIR / "calibration.json"
    if calib.exists():
        with open(calib) as f:
            batches.append(("calibration", json.load(f)))
    # Production batches
    expected = ["I", "II", "III", "IV", "V", "VI-A", "VI-B", "VII", "VIII", "Q-1", "Q-2", "Q-3", "Q-4"]
    for name in expected:
        path = DROPDIR / f"batch-{name}-result.json"
        if not path.exists():
            print(f"  MISSING: {path}", file=sys.stderr)
            continue
        with open(path) as f:
            batches.append((name, json.load(f)))
    return batches


def collect_sheet_curation():
    issues = []
    for path in DROPDIR.glob("sheet-curation-issues-*.json"):
        with open(path) as f:
            data = json.load(f)
        for issue in data.get("issues", []):
            issue["_batch"] = data.get("batch_name", path.stem)
            issues.append(issue)
    return issues


def main():
    batches = collect_batches()
    if not batches:
        print("No dropfiles found — agents may still be running.", file=sys.stderr)
        sys.exit(1)

    all_rows = []
    batch_meta = []
    for batch_name, data in batches:
        meta = {
            "batch": batch_name,
            "rows_processed": data.get("rows_processed", 0),
            "verified": data.get("verified_count", 0),
            "warn": data.get("warn_count", 0),
            "fail": data.get("fail_count", 0),
            "pplx_used": data.get("perplexity_queries_used", 0),
            "curl_checks": data.get("curl_citation_checks", 0),
            "wall_seconds": data.get("wall_clock_seconds", 0),
        }
        batch_meta.append(meta)
        for r in data.get("rows", []):
            r["_batch"] = batch_name
            all_rows.append(r)

    total = len(all_rows)
    by_status = Counter(r.get("status", "unknown") for r in all_rows)
    by_severity = Counter()
    by_category = Counter()
    for r in all_rows:
        for f in r.get("findings", []):
            by_severity[f.get("severity", "?")] += 1
            by_category[f.get("category", "?")] += 1

    # Cross-term: same fabricated PMID/DOI cited across multiple terms
    pmid_terms = defaultdict(set)
    doi_terms = defaultdict(set)
    for r in all_rows:
        slug = r.get("slug", r.get("id", "?"))
        for f in r.get("findings", []):
            if f.get("category") == "hallucinated_citation":
                ev = f.get("evidence_source", "") + " " + f.get("evidence_verbatim", "")
                # Crude PMID/DOI extraction
                import re
                for m in re.finditer(r"PMID[:\s]*(\d{6,10})", ev + " " + f.get("claim_verbatim", "")):
                    pmid_terms[m.group(1)].add(slug)
                for m in re.finditer(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+", ev + " " + f.get("claim_verbatim", ""), re.I):
                    doi_terms[m.group(0)].add(slug)
    repeated_pmids = {p: list(t) for p, t in pmid_terms.items() if len(t) > 1}
    repeated_dois = {d: list(t) for d, t in doi_terms.items() if len(t) > 1}

    print("=" * 70)
    print(f"GLOSSARY PERPLEXITY-DEFINITION VERIFICATION  -  {REPORT_DATE}")
    print("=" * 70)
    print(f"Total rows processed: {total}")
    print(f"  verified: {by_status.get('verified', 0)}")
    print(f"  warn:     {by_status.get('warn', 0)}")
    print(f"  fail:     {by_status.get('fail', 0)}")
    print(f"Findings by severity: {dict(by_severity)}")
    print(f"Findings by category: {dict(by_category)}")
    print(f"Repeated fabricated PMIDs (multi-term): {len(repeated_pmids)}")
    print(f"Repeated fabricated DOIs (multi-term):  {len(repeated_dois)}")

    sheet_curation = collect_sheet_curation()
    print(f"Sheet-curation drift findings: {len(sheet_curation)}")

    # Sheet writes
    if WRITE_SHEET and not DRY_RUN:
        token = get_token()
        # Build batch update of cell ranges
        data_payload = []
        for r in all_rows:
            row_index = r.get("row_index")
            if not row_index:
                continue
            status = r.get("status", "unknown")
            findings_summary = json.dumps(r.get("findings", []), separators=(",", ":"))
            # Sheet cell max 50k chars — truncate gracefully
            if len(findings_summary) > 45000:
                findings_summary = findings_summary[:44900] + '..."TRUNCATED"]'
            verifier = f"{r.get('_batch', '?')}-{r.get('run_id', '?')[:32]}"
            data_payload.append({
                "range": f"{TAB}!AL{row_index}:AO{row_index}",
                "values": [[status, findings_summary, TODAY, verifier]],
            })

        # Chunk into batches of 100 (API limit)
        for i in range(0, len(data_payload), 100):
            chunk = data_payload[i:i+100]
            body = {"valueInputOption": "RAW", "data": chunk}
            sheets_call("POST", f"/values:batchUpdate", body, token)
            print(f"  wrote sheet rows {i+1}..{i+len(chunk)}")
        print(f"Sheet write complete: {len(data_payload)} rows updated")
    else:
        print(f"(Skipping Sheet write — DRY_RUN={DRY_RUN}, WRITE_SHEET={WRITE_SHEET})")

    # Markdown report
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(REPORT_PATH, "w") as out:
        out.write(f"# Glossary Perplexity-Definition Verification — {REPORT_DATE}\n\n")
        out.write(f"**Source**: Google Sheet `RRM Academy Glossary -- External Sourcing` (`{SHEET_ID}`)\n\n")
        out.write(f"**Scope**: All 336 rows with Perplexity definitions (col J), across 13 parallel sub-agent batches + 10-row calibration.\n\n")
        out.write("## Summary\n\n")
        out.write(f"| Status | Count |\n|---|---|\n")
        for s in ("verified", "warn", "fail"):
            out.write(f"| **{s}** | {by_status.get(s, 0)} |\n")
        out.write(f"| **TOTAL** | {total} |\n\n")
        out.write("### Findings by severity\n\n")
        out.write("| Severity | Count |\n|---|---|\n")
        for sev in ("P0", "P1", "P2", "P3"):
            out.write(f"| **{sev}** | {by_severity.get(sev, 0)} |\n")
        out.write("\n### Findings by category\n\n")
        out.write("| Category | Count |\n|---|---|\n")
        for cat, n in by_category.most_common():
            out.write(f"| `{cat}` | {n} |\n")
        out.write("\n### Cost + runtime per batch\n\n")
        out.write("| Batch | Rows | V/W/F | PPLX | curl | Wall(s) |\n|---|---|---|---|---|---|\n")
        for b in batch_meta:
            out.write(f"| {b['batch']} | {b['rows_processed']} | {b['verified']}/{b['warn']}/{b['fail']} | {b['pplx_used']} | {b['curl_checks']} | {b['wall_seconds']} |\n")
        out.write("\n## P0 findings (highest priority — drift, hallucinated citations, fabricated stats)\n\n")
        for r in sorted(all_rows, key=lambda x: x.get("row_index", 0)):
            p0s = [f for f in r.get("findings", []) if f.get("severity") == "P0"]
            if not p0s:
                continue
            out.write(f"### row {r.get('row_index')} — `{r.get('term', '?')}` ({r.get('part', '?')})\n\n")
            out.write(f"**Perplexity definition**:\n\n> {r.get('pplx_def_verbatim','')[:600]}{'...' if len(r.get('pplx_def_verbatim',''))>600 else ''}\n\n")
            for f in p0s:
                out.write(f"- **[{f.get('severity')}] {f.get('category')}**\n")
                out.write(f"  - **Claim**: {f.get('claim_verbatim', '')}\n")
                out.write(f"  - **Evidence**: {f.get('evidence_verbatim', '')[:400]}\n")
                out.write(f"  - **Source**: `{f.get('evidence_source', '')}`\n")
                out.write(f"  - **Fix**: {f.get('suggested_fix', '')}\n")
            out.write("\n")
        out.write("\n## P1 findings (broken citations)\n\n")
        for r in sorted(all_rows, key=lambda x: x.get("row_index", 0)):
            p1s = [f for f in r.get("findings", []) if f.get("severity") == "P1"]
            if not p1s:
                continue
            out.write(f"### row {r.get('row_index')} — `{r.get('term', '?')}` ({r.get('part', '?')})\n\n")
            for f in p1s:
                out.write(f"- **{f.get('category')}**: {f.get('claim_verbatim', '')[:200]}\n")
                out.write(f"  - Evidence: {f.get('evidence_verbatim', '')[:300]}\n")
                out.write(f"  - Fix: {f.get('suggested_fix', '')}\n")
            out.write("\n")
        out.write("\n## P2 findings (drift / consensus_conflict / unverified / protocol_leak)\n\n")
        # Group P2 by category
        p2_by_cat = defaultdict(list)
        for r in all_rows:
            for f in r.get("findings", []):
                if f.get("severity") == "P2":
                    p2_by_cat[f.get("category", "?")].append((r, f))
        for cat, items in p2_by_cat.items():
            out.write(f"### {cat} ({len(items)})\n\n")
            for r, f in items[:30]:
                out.write(f"- row {r.get('row_index')} `{r.get('term', '?')}`: {f.get('claim_verbatim', '')[:200]}\n")
            if len(items) > 30:
                out.write(f"- ... +{len(items)-30} more\n")
            out.write("\n")
        out.write("\n## Cross-term: repeated fabricated citations\n\n")
        out.write("If Perplexity invented the same fake PMID across multiple terms, the failure mode is systematic.\n\n")
        if repeated_pmids:
            out.write("### Repeated PMIDs\n\n")
            for pmid, terms in sorted(repeated_pmids.items(), key=lambda x: -len(x[1])):
                out.write(f"- PMID `{pmid}` cited in: {', '.join(sorted(terms))}\n")
            out.write("\n")
        if repeated_dois:
            out.write("### Repeated DOIs\n\n")
            for doi, terms in sorted(repeated_dois.items(), key=lambda x: -len(x[1])):
                out.write(f"- DOI `{doi}` cited in: {', '.join(sorted(terms))}\n")
            out.write("\n")
        out.write("\n## Sheet-curation drift (separate from Perplexity issues)\n\n")
        if sheet_curation:
            out.write("These are issues with the authoritative columns themselves (MeSH, ICD, rrm_canonical_match, etc.) — not Perplexity bugs but worth fixing in the Sheet.\n\n")
            for issue in sheet_curation:
                out.write(f"- row {issue.get('row_index')} `{issue.get('term', '?')}` col {issue.get('column', '?')}\n")
                out.write(f"  - Issue: {issue.get('issue', '')}\n")
                out.write(f"  - Current: `{issue.get('current_value_verbatim', '')[:200]}`\n")
                out.write(f"  - Fix: {issue.get('suggested_fix', '')}\n\n")
        else:
            out.write("None reported.\n")
        out.write("\n## Verified rows (clean — no findings)\n\n")
        clean = [r for r in all_rows if r.get("status") == "verified"]
        out.write(f"{len(clean)} rows passed all checks. (Not enumerated here; see Sheet col AL = `verified`.)\n")

    print(f"\nReport written: {REPORT_PATH}")
    print(f"Sheet write: {'SKIPPED' if (DRY_RUN or not WRITE_SHEET) else 'DONE'}")


if __name__ == "__main__":
    main()
