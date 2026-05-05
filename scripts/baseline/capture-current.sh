#!/usr/bin/env bash
# Capture the four "fast diff" baseline layers into ~/iCode/.arise-baselines/_current
# for comparison via diff.mjs. Run before `npm run baseline:diff:hard`.
set -euo pipefail

BL="${1:-$HOME/iCode/.arise-baselines/_current}"
mkdir -p "$BL"/{http,d1,agent-surface,build}

echo "[capture] http baseline -> $BL/http/http-baseline.json"
node scripts/baseline/http.mjs "$BL/http/http-baseline.json"

echo "[capture] agent-surface bytes -> $BL/agent-surface/"
bash scripts/baseline/agent-surface.sh "$BL/agent-surface"

echo "[capture] d1 row counts -> $BL/d1/"
bash scripts/baseline/d1-counts.sh "$BL/d1"

echo "[capture] arise-scan -> $BL/build/arise-scan.summary.json"
arise-scan --json . > "$BL/build/arise-scan.json"
python3 - <<EOF
import json
with open("$BL/build/arise-scan.json") as f:
    d = json.load(f)
findings = d.get('findings') or []
by_rule = {}
for x in findings:
    r = x.get('rule', 'norule') or 'norule'
    by_rule[r] = by_rule.get(r, 0) + 1
out = {
    'summary': d.get('summary'),
    'files_scanned': d.get('files_scanned'),
    'total_findings': len(findings),
    'findings_by_rule': dict(sorted(by_rule.items(), key=lambda x: -x[1])),
}
with open("$BL/build/arise-scan.summary.json", 'w') as f:
    json.dump(out, f, indent=2)
EOF

echo "[capture] done. Run: npm run baseline:diff:hard"
