#!/usr/bin/env python3
"""Build candidate triage HTML — 136 rows grouped by classifier bucket (KEEP / NEEDS-BRIAN / MERGE / REJECT)."""
import json, html
from pathlib import Path

CLASSIFICATION = json.loads(Path('/tmp/glossary-pplx-verify/candidates-classification.json').read_text())
DATA = json.loads(Path('/tmp/glossary-pplx-verify/candidates-data.json').read_text())

# Index candidates by row
by_row = {c['row']: c for c in DATA['candidates']}
existing_by_slug = {t['slug']: t for t in DATA['existing_terms']}

def esc(s): return html.escape(s or '')

PART_LABELS = {
    'I': 'I — Foundational', 'II': 'II — FABM/charting', 'III': 'III — NaProTechnology',
    'IV': 'IV — Diagnostic', 'V': 'V — Surgical', 'VI': 'VI — Conditions',
    'VII': 'VII — Roles/Institutions', 'VIII': 'VIII — Mainstream contrasts',
}

def render_row(c):
    cls = c.get('classification', 'NEEDS-BRIAN')
    data = by_row.get(c['row'], {})
    pplx = data.get('pplx_def', '')
    pplx_html = '<br>'.join([esc(p) for p in pplx.split('\n\n')[:3]]) if pplx else '<span class="muted">(empty)</span>'

    signals = []
    if data.get('rrm_canon_has'): signals.append('<span class="sig sig-canon">RRM canonical</span>')
    if data.get('rrm_txt_has'):   signals.append('<span class="sig sig-textbook">Hilgers textbook</span>')
    if data.get('boyle_has'):     signals.append('<span class="sig sig-boyle">Boyle transcript</span>')
    if data.get('mp_def'):        signals.append('<span class="sig sig-ext">MedlinePlus</span>')
    if data.get('mesh_scope'):    signals.append('<span class="sig sig-ext">MeSH</span>')
    if data.get('icd10'):         signals.append('<span class="sig sig-ext">ICD-10</span>')
    if data.get('nci_def'):       signals.append('<span class="sig sig-ext">NCI</span>')

    badge_class = 'b-' + cls.lower().replace('-', '_')
    extra = ''
    if cls == 'KEEP' and c.get('suggested_part'):
        extra = f'<span class="badge-part">Part {esc(c["suggested_part"])}</span>'
    elif cls == 'MERGE' and c.get('merge_into_slug'):
        existing = existing_by_slug.get(c['merge_into_slug'], {})
        extra = f'<span class="badge-merge">merge into <code>{esc(c["merge_into_slug"])}</code></span>'

    return f'''
<section id="row-{c['row']}" class="card cls-{cls.lower().replace('-','_')}">
  <header class="card-head">
    <span class="row-num">row {c['row']}</span>
    <h3>{esc(c['term'])}</h3>
    {f'<span class="abbr">({esc(data.get("abbr",""))})</span>' if data.get('abbr') else ''}
    <span class="badge {badge_class}">{esc(cls)}</span>
    {extra}
    <a class="sheet-link" target="_blank" rel="noopener" href="https://docs.google.com/spreadsheets/d/1JNFrImZyp6O17NqNKsdwbvz5tF6K56yXXZ4uxzT2zvk/edit#gid=1143830838&range=B{c['row']}">→ Sheet B{c['row']}</a>
  </header>
  <div class="card-body">
    <div class="signals">{''.join(signals) if signals else '<span class="muted">no in-sheet auth signals</span>'}</div>
    <div class="rationale"><strong>Why this bucket:</strong> {esc(c.get('rationale',''))}</div>
    <details class="pplx">
      <summary>Perplexity definition (col J)</summary>
      <div class="prose">{pplx_html}</div>
    </details>
  </div>
</section>
'''

# Group by classification
buckets = {'KEEP': [], 'NEEDS-BRIAN': [], 'MERGE': [], 'REJECT': []}
for c in CLASSIFICATION['classifications']:
    buckets[c.get('classification', 'NEEDS-BRIAN')].append(c)

# Within KEEP, sort by suggested_part
for c in buckets['KEEP']:
    c['_sort'] = c.get('suggested_part', 'Z')
buckets['KEEP'].sort(key=lambda x: (x['_sort'], x['term']))

counts = CLASSIFICATION.get('counts', {})

sections_html = ''
for bucket in ['NEEDS-BRIAN', 'KEEP', 'MERGE', 'REJECT']:
    items = buckets.get(bucket, [])
    if not items: continue
    bucket_id = bucket.lower().replace('-','_')
    sections_html += f'<section id="bucket-{bucket_id}" class="bucket bucket-{bucket_id}">'
    sections_html += f'<h2 class="bucket-head">{esc(bucket)} <span class="bucket-count">{len(items)}</span></h2>'
    if bucket == 'NEEDS-BRIAN':
        sections_html += '<p class="bucket-note">These require your judgment. The classifier deferred on each.</p>'
    elif bucket == 'KEEP':
        sections_html += '<p class="bucket-note">Suggested Part assignment per row. To accept all: set col AP for each row to APPROVED. To reject individual: change to REJECTED.</p>'
    elif bucket == 'MERGE':
        sections_html += '<p class="bucket-note">Candidate duplicates of existing v2-populated terms. Default action: REJECT the candidate row, the existing term stays.</p>'
    elif bucket == 'REJECT':
        sections_html += '<p class="bucket-note">Off-topic, noise, or out-of-scope. Default: bulk REJECT.</p>'
    for c in items:
        sections_html += render_row(c)
    sections_html += '</section>'

HTML = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RRMA Glossary Candidate Triage ({CLASSIFICATION.get("total_candidates", 0)} rows)</title>
<style>
*, *::before, *::after {{ box-sizing: border-box; }}
html, body {{ margin: 0; overflow-x: hidden; }}
body {{
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 14.5px; line-height: 1.55; color: #1a1814; background: #f7f5f3;
  overflow-wrap: break-word; word-break: break-word;
}}
img, svg, video {{ max-width: 100%; height: auto; }}

main {{ max-width: 1100px; margin: 0 auto; padding: 24px 16px 80px; }}

.page-head {{ padding: 16px 0 24px; border-bottom: 2px solid #d8d3cc; margin-bottom: 24px; }}
.page-head h1 {{ font-family: "Cormorant Garamond", Georgia, serif; font-size: 28px; margin: 0 0 8px; color: #2a2520; font-weight: 600; }}
.page-head p {{ margin: 4px 0; color: #6c655a; font-size: 14px; }}

.totals {{ display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }}
.totals a {{
  font-size: 13px; padding: 6px 12px; border-radius: 4px; text-decoration: none; color: #fff; font-weight: 600;
}}
.totals .keep        {{ background: #1f5a2c; }}
.totals .needs_brian {{ background: #a64b0a; }}
.totals .merge       {{ background: #5a4a8e; }}
.totals .reject      {{ background: #7a1f1f; }}

.bucket {{ margin-bottom: 40px; }}
.bucket-head {{
  font-family: "Cormorant Garamond", Georgia, serif; font-size: 24px; font-weight: 600; color: #2a2520;
  border-bottom: 1px solid #d8d3cc; padding-bottom: 8px; margin: 0 0 8px;
  position: sticky; top: 0; background: #f7f5f3; z-index: 5; padding-top: 12px;
}}
.bucket-count {{ font-size: 14px; color: #6c655a; font-weight: 400; font-family: "Inter", sans-serif; margin-left: 8px; }}
.bucket-note {{ font-size: 13px; color: #6c655a; font-style: italic; margin: 0 0 16px; }}

.card {{
  background: #fff; border: 1px solid #d8d3cc; border-radius: 6px; margin-bottom: 10px;
  overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.03);
}}
.card.cls-keep        {{ border-left: 4px solid #1f5a2c; }}
.card.cls-needs_brian {{ border-left: 4px solid #a64b0a; }}
.card.cls-merge       {{ border-left: 4px solid #5a4a8e; }}
.card.cls-reject      {{ border-left: 4px solid #7a1f1f; opacity: 0.7; }}

.card-head {{
  padding: 10px 14px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px;
  background: #fafaf7;
}}
.card-head h3 {{
  font-family: "Cormorant Garamond", Georgia, serif; font-size: 18px; font-weight: 600;
  margin: 0; color: #2a2520; flex: 1; min-width: 0;
}}
.row-num {{ font-family: "JetBrains Mono", "SF Mono", Menlo, monospace; font-size: 11px; color: #6c655a; background: #e6e0d8; padding: 2px 6px; border-radius: 3px; }}
.abbr {{ font-size: 12px; color: #6c655a; font-style: italic; }}
.badge {{ font-size: 11px; padding: 2px 7px; border-radius: 3px; font-weight: 700; letter-spacing: 0.04em; color: #fff; }}
.badge.b-keep        {{ background: #1f5a2c; }}
.badge.b-needs_brian {{ background: #a64b0a; }}
.badge.b-merge       {{ background: #5a4a8e; }}
.badge.b-reject      {{ background: #7a1f1f; }}
.badge-part {{ background: #e6e0d8; color: #2a2520; font-size: 11px; padding: 2px 6px; border-radius: 3px; font-weight: 600; }}
.badge-merge {{ background: #ece6f5; color: #3a2a5e; font-size: 11px; padding: 2px 6px; border-radius: 3px; }}
.badge-merge code {{ font-family: "JetBrains Mono", "SF Mono", Menlo, monospace; font-size: 10px; }}
.sheet-link {{
  font-size: 11px; color: #1f5a8e; text-decoration: none; background: #e6f0fa;
  padding: 3px 8px; border-radius: 3px; border: 1px solid #cadcef; white-space: nowrap;
}}

.card-body {{ padding: 8px 14px 12px; }}

.signals {{ margin-bottom: 6px; display: flex; flex-wrap: wrap; gap: 4px; }}
.sig {{ font-size: 10px; padding: 2px 6px; border-radius: 2px; font-weight: 600; letter-spacing: 0.04em; }}
.sig-canon    {{ background: #d4e9d8; color: #1f5a2c; }}
.sig-textbook {{ background: #f0e7d6; color: #6a4b1a; }}
.sig-boyle    {{ background: #e0d9e8; color: #4a3a6e; }}
.sig-ext      {{ background: #e6e0d8; color: #5a4a3a; }}

.rationale {{ font-size: 13px; line-height: 1.5; color: #3a3530; margin: 6px 0; }}
.rationale strong {{ color: #6c655a; font-weight: 600; }}

details.pplx {{ margin-top: 8px; }}
details.pplx summary {{ font-size: 12px; color: #6c655a; cursor: pointer; user-select: none; padding: 2px 0; }}
details.pplx summary:hover {{ color: #2a2520; }}
.prose {{ font-size: 13px; color: #3a3530; padding: 8px 12px; background: #fafaf7; border-radius: 4px; margin-top: 6px; line-height: 1.5; }}

.muted {{ color: #9a9285; font-style: italic; }}

.toc {{
  position: sticky; top: 0; background: #f7f5f3; border-bottom: 1px solid #d8d3cc;
  padding: 10px 16px; z-index: 20; margin: -24px -16px 24px;
}}
.toc-inner {{ max-width: 1100px; margin: 0 auto; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }}
.toc strong {{ font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #6c655a; }}
.toc a {{ font-size: 12px; color: #1f5a8e; text-decoration: none; padding: 3px 8px; border-radius: 3px; background: #fff; border: 1px solid #d8d3cc; }}
</style>
</head>
<body>
<main>
  <div class="toc">
    <div class="toc-inner">
      <strong>jump:</strong>
      <a href="#bucket-needs_brian">NEEDS-BRIAN ({counts.get('needs_brian', 0)})</a>
      <a href="#bucket-keep">KEEP ({counts.get('keep', 0)})</a>
      <a href="#bucket-merge">MERGE ({counts.get('merge', 0)})</a>
      <a href="#bucket-reject">REJECT ({counts.get('reject', 0)})</a>
    </div>
  </div>

  <header class="page-head">
    <h1>RRMA Glossary Candidate Triage</h1>
    <p>{CLASSIFICATION.get("total_candidates", 0)} candidate rows (Part column = "?", empty col AJ). Classified by RRM-relevance + duplicate-against-existing.</p>
    <p>Bar: <strong>permissive</strong>. NEEDS-BRIAN tops the list because those need your judgment. KEEPs have a suggested Part. MERGEs point to an existing slug. REJECTs are bulk-droppable.</p>
    <div class="totals">
      <a class="keep" href="#bucket-keep">KEEP: {counts.get('keep', 0)}</a>
      <a class="needs_brian" href="#bucket-needs_brian">NEEDS-BRIAN: {counts.get('needs_brian', 0)}</a>
      <a class="merge" href="#bucket-merge">MERGE: {counts.get('merge', 0)}</a>
      <a class="reject" href="#bucket-reject">REJECT: {counts.get('reject', 0)}</a>
    </div>
  </header>

  {sections_html}
</main>
</body>
</html>
'''

Path('/tmp/glossary-pplx-verify/candidates-triage.html').write_text(HTML)
print(f"Wrote /tmp/glossary-pplx-verify/candidates-triage.html ({len(HTML)} bytes)")
