#!/usr/bin/env python3
"""Build a self-contained side-by-side review HTML for the 5 P0 v2 drafts."""
import json, html
from pathlib import Path

DATA = json.loads(Path('/tmp/glossary-pplx-verify/p0-review-data.json').read_text())

def esc(s): return html.escape(s or '')

def render_findings(json_str):
    """Render col AM findings JSON as a compact list of P0 items only."""
    try:
        finds = json.loads(json_str)
    except Exception:
        return '<p class="muted">(no findings JSON)</p>'
    p0s = [f for f in finds if f.get('severity') == 'P0']
    if not p0s:
        return '<p class="muted">(no P0 findings)</p>'
    parts = []
    for f in p0s:
        parts.append(
            f'<div class="finding">'
            f'<div class="finding-head"><span class="badge p0">P0</span> <span class="cat">{esc(f.get("category",""))}</span></div>'
            f'<div class="finding-row"><b>Claim:</b> {esc(f.get("claim_verbatim",""))[:500]}</div>'
            f'<div class="finding-row"><b>Evidence:</b> {esc(f.get("evidence_verbatim",""))[:500]}</div>'
            f'<div class="finding-row"><b>Source:</b> <code>{esc(f.get("evidence_source",""))[:200]}</code></div>'
            f'<div class="finding-row"><b>Suggested fix:</b> {esc(f.get("suggested_fix",""))[:500]}</div>'
            f'</div>'
        )
    return '\n'.join(parts)

def render_row_section(rec):
    pplx_paragraphs = ''.join(f'<p>{esc(p)}</p>' for p in (rec['pplx_def'] or '').split('\n\n') if p.strip())
    if not pplx_paragraphs:
        pplx_paragraphs = '<p class="muted">(empty)</p>'

    # New v2_html — render as-is (it's already HTML with the right structure)
    new_html = rec['v2_html'] or '<p class="muted">(no v2_html)</p>'

    return f'''
<section id="row-{rec['row']}" class="row">
  <header class="row-head">
    <div class="row-title">
      <span class="row-num">row {rec['row']}</span>
      <h2>{esc(rec['term'])}</h2>
      <span class="part">part {esc(rec['part']) or '?'}</span>
    </div>
    <div class="row-actions">
      <a class="sheet-link" target="_blank" rel="noopener" href="https://docs.google.com/spreadsheets/d/1JNFrImZyp6O17NqNKsdwbvz5tF6K56yXXZ4uxzT2zvk/edit#gid=1143830838&range=AJ{rec['row']}">Open in Sheet (AJ{rec['row']})</a>
    </div>
  </header>

  <div class="findings">
    <h3>Why this is being rewritten — P0 findings from audit</h3>
    {render_findings(rec['p0_findings_json'])}
  </div>

  <div class="compare">
    <div class="col col-was">
      <div class="col-head">
        <span class="col-label was">WAS — flagged Perplexity draft (col J)</span>
      </div>
      <div class="col-body prose">
        {pplx_paragraphs}
      </div>
    </div>

    <div class="col col-new">
      <div class="col-head">
        <span class="col-label new">NEW — proposed v2 draft (col AJ rendered as AK)</span>
      </div>
      <div class="col-body prose">
        {new_html}
      </div>
    </div>
  </div>

  <footer class="row-foot">
    <span class="instructions">In the Sheet, edit AJ/AK directly if needed, then set <code>AP</code> = <code>APPROVED</code> or <code>REJECTED</code>.</span>
  </footer>
</section>
'''

sections = '\n'.join(render_row_section(DATA[k]) for k in sorted(DATA.keys(), key=int))

HTML = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RRMA Glossary P0 v2 Drafts — Side-by-Side Review</title>
<style>
*, *::before, *::after {{ box-sizing: border-box; }}
html, body {{ margin: 0; overflow-x: hidden; }}
body {{
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 15px;
  line-height: 1.55;
  color: #1a1814;
  background: #f7f5f3;
  overflow-wrap: break-word;
  word-break: break-word;
}}
img, svg, video {{ max-width: 100%; height: auto; }}
table {{ width: 100%; }}

main {{ max-width: 1400px; margin: 0 auto; padding: 24px 16px 80px; }}
.page-head {{
  padding: 16px 0 24px;
  border-bottom: 2px solid #d8d3cc;
  margin-bottom: 24px;
}}
.page-head h1 {{ font-family: "Cormorant Garamond", Georgia, serif; font-size: 28px; margin: 0 0 8px; color: #2a2520; font-weight: 600; }}
.page-head p {{ margin: 4px 0; color: #6c655a; font-size: 14px; }}
.page-head .legend {{ display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }}
.page-head .legend span {{ font-size: 13px; padding: 3px 8px; border-radius: 4px; }}
.legend .l-was {{ background: #fde6e6; color: #7a1f1f; }}
.legend .l-new {{ background: #e2f1e6; color: #1f5a2c; }}
.legend .l-p0  {{ background: #5a1818; color: #fff; padding: 3px 8px; font-weight: 600; }}

.row {{
  background: #fff;
  border: 1px solid #d8d3cc;
  border-radius: 8px;
  margin-bottom: 32px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}}
.row-head {{
  padding: 14px 20px;
  background: #f0ebe5;
  border-bottom: 1px solid #d8d3cc;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  position: sticky;
  top: 0;
  z-index: 10;
}}
.row-title {{ display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; flex: 1; min-width: 0; }}
.row-title h2 {{ font-family: "Cormorant Garamond", Georgia, serif; font-size: 22px; font-weight: 600; margin: 0; color: #2a2520; }}
.row-num {{ font-family: "JetBrains Mono", "SF Mono", Menlo, monospace; font-size: 12px; color: #6c655a; background: #e6e0d8; padding: 2px 6px; border-radius: 3px; }}
.part {{ font-size: 12px; color: #6c655a; }}
.row-actions {{ display: flex; gap: 8px; }}
.sheet-link {{
  font-size: 13px;
  color: #1f5a8e;
  text-decoration: none;
  background: #e6f0fa;
  padding: 6px 10px;
  border-radius: 4px;
  border: 1px solid #cadcef;
}}
.sheet-link:hover {{ background: #d8e7f5; }}

.findings {{ padding: 12px 20px; border-bottom: 1px solid #ede8e1; background: #fcfaf6; }}
.findings h3 {{ font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #6c655a; margin: 0 0 10px; font-weight: 600; }}
.finding {{
  font-size: 13px;
  padding: 10px 12px;
  background: #fff;
  border-left: 3px solid #c33;
  border-radius: 0 4px 4px 0;
  margin-bottom: 8px;
}}
.finding-head {{ display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }}
.badge.p0 {{ background: #5a1818; color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 3px; font-weight: 600; letter-spacing: 0.04em; }}
.cat {{ font-family: "JetBrains Mono", "SF Mono", Menlo, monospace; font-size: 11px; color: #5a4a3a; background: #f0ebe5; padding: 2px 6px; border-radius: 3px; }}
.finding-row {{ margin: 4px 0; line-height: 1.45; }}
.finding-row b {{ color: #5a1818; font-weight: 600; }}
.finding code {{ font-family: "JetBrains Mono", "SF Mono", Menlo, monospace; font-size: 11px; background: #f0ebe5; padding: 1px 5px; border-radius: 2px; word-break: break-all; }}

.compare {{
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0;
}}
@media (max-width: 900px) {{
  .compare {{ grid-template-columns: minmax(0, 1fr); }}
}}
.col {{
  padding: 16px 20px;
  border-top: 1px solid #ede8e1;
}}
.col-was {{ background: #fef8f8; }}
.col-new {{ background: #f5faf6; }}
@media (min-width: 901px) {{
  .col-new {{ border-left: 1px solid #ede8e1; }}
}}
.col-head {{ margin-bottom: 12px; }}
.col-label {{
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 3px;
  display: inline-block;
}}
.col-label.was {{ background: #fde6e6; color: #7a1f1f; }}
.col-label.new {{ background: #e2f1e6; color: #1f5a2c; }}

.prose p {{
  margin: 0 0 12px;
  font-family: "Inter", -apple-system, sans-serif;
  font-size: 14.5px;
  line-height: 1.6;
  color: #2a2520;
}}
.prose p:last-child {{ margin-bottom: 0; }}
.prose strong {{ font-weight: 600; color: #1a1814; }}

/* Render of v2_html's RRMA-styled tags */
.prose .cite-ref a {{
  font-size: 0.7em;
  vertical-align: super;
  line-height: 1;
  text-decoration: none;
  color: #725e7e;
  font-weight: 600;
}}
.prose .gloss-xref {{
  color: #725e7e;
  text-decoration: none;
  border-bottom: 1px dotted #b09bb8;
}}
.prose .gloss-xref:hover {{ border-bottom-style: solid; }}
sup.cite-ref {{ display: inline; }}

.row-foot {{
  padding: 10px 20px;
  background: #f7f5f3;
  border-top: 1px solid #ede8e1;
  font-size: 13px;
  color: #6c655a;
}}
.row-foot code {{
  font-family: "JetBrains Mono", "SF Mono", Menlo, monospace;
  font-size: 12px;
  background: #e6e0d8;
  padding: 1px 5px;
  border-radius: 2px;
}}

.muted {{ color: #9a9285; font-style: italic; }}

/* Quick-jump nav */
.toc {{
  position: sticky;
  top: 0;
  background: #f7f5f3;
  border-bottom: 1px solid #d8d3cc;
  padding: 10px 16px;
  z-index: 20;
  margin: -24px -16px 24px;
}}
.toc-inner {{ max-width: 1400px; margin: 0 auto; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }}
.toc strong {{ font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #6c655a; }}
.toc a {{
  font-size: 13px;
  color: #1f5a8e;
  text-decoration: none;
  padding: 4px 8px;
  border-radius: 3px;
  background: #fff;
  border: 1px solid #d8d3cc;
}}
.toc a:hover {{ background: #e6f0fa; }}
</style>
</head>
<body>
<main>
  <div class="toc">
    <div class="toc-inner">
      <strong>jump:</strong>
      <a href="#row-144">144 IIRRM</a>
      <a href="#row-169">169 Live Birth</a>
      <a href="#row-173">173 Luteal Phase Defect</a>
      <a href="#row-213">213 NARPS</a>
      <a href="#row-242">242 PEARS</a>
    </div>
  </div>

  <header class="page-head">
    <h1>RRMA Glossary — P0 v2 Drafts Review</h1>
    <p>Side-by-side: flagged Perplexity definition (col J) vs proposed new v2 draft (col AJ rendered via col AK).</p>
    <p>These 5 rows had col AJ empty before this pass. Per-row P0 findings shown above each pair. Sheet stays SSOT — edit cols AJ/AK in the Sheet, then set col AP to APPROVED or REJECTED.</p>
    <div class="legend">
      <span class="l-p0">P0</span>
      <span class="l-was">WAS — flagged Perplexity</span>
      <span class="l-new">NEW — proposed v2</span>
    </div>
  </header>

  {sections}

</main>
</body>
</html>
"""

out = Path('/tmp/glossary-pplx-verify/p0-review.html')
out.write_text(HTML)
print(f"Wrote {out} ({len(HTML)} bytes)")
