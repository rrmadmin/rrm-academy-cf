#!/usr/bin/env node
// Glossary publish-readiness proof gate.
//
// Scans every glossary_term.body_html and glossary_definition_source.definition_text
// in the live D1 (rrm-auth) for "review artifacts" -- AI/scanner self-talk, FIXME
// markers, draft notes, embedded D1 record IDs, and other content that must not
// reach the public glossary page.
//
// Modes:
//   default        warn-only (exit 0). Used during the review/draft phase when
//                  these artifacts are expected and benign.
//   --strict       strict mode (exit non-zero on any finding). Used in CI prior
//                  to publishing the glossary, OR by /glossary-update Workflow B
//                  (edit existing term) before pushing body_html to D1.
//   --json         emit machine-readable JSON output (always exit 0 unless
//                  combined with --strict)
//
// Detection patterns (regex sources at top of file):
//   - [REVIEW ...], [REVIEW: ...]
//   - [FIXME ...], [TODO ...], [DRAFT ...], [NOTE ...]
//   - "(best guess from FTS, ...)" / "(best guess ...)"
//   - "MedlinePlus title:" embedded inside another quote (mismatch tag)
//   - D1 record IDs like "D1: rec...", "D1: doc...", "rec-XXX-..."
//   - "?? unsure ??", "?? confirm ??"
//   - "PLACEHOLDER", "REWRITE", "VERIFY"
//   - Vimeo URLs anywhere (Boyle archive should never leak publicly)
//   - "IIRRM Archive" label in any rendered field (private corpus)
//
// Run:
//   node scripts/gates/validate-glossary-publish-ready.mjs
//   node scripts/gates/validate-glossary-publish-ready.mjs --strict
//   node scripts/gates/validate-glossary-publish-ready.mjs --json
//
// Usage in /glossary-update Workflow B (before final D1 commit):
//   node scripts/gates/validate-glossary-publish-ready.mjs --strict --slug=<slug>
//
// Exit codes:
//   0  no violations OR warn-only mode finished
//   1  --strict and one or more violations found
//   2  D1 query / runtime error

import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const JSON_OUT = args.includes('--json');
const SLUG_FILTER = (args.find((a) => a.startsWith('--slug=')) || '').replace('--slug=', '');

// Patterns the gate scans for. Each pattern: { id, pattern, severity, why }
// severity: 'block' (must be cleared before public release)
//           'warn'  (should be cleared but not fatal)
const PATTERNS = [
  {
    id: 'review-marker',
    pattern: /\[REVIEW(?:[\s:\-][^\]]*)?\]/gi,
    severity: 'block',
    why: '[REVIEW...] markers indicate a draft note from the editor or AI; remove before public release.',
  },
  {
    id: 'best-guess',
    pattern: /\(best guess(?:[^)]*)?\)/gi,
    severity: 'block',
    why: '"(best guess...)" indicates a low-confidence FTS / scanner inference; verify and remove the parenthetical.',
  },
  {
    id: 'todo-fixme-draft',
    pattern: /\[(?:TODO|FIXME|DRAFT|NOTE|PLACEHOLDER|REWRITE|VERIFY|UNSURE|CONFIRM)(?:[\s:\-][^\]]*)?\]/gi,
    severity: 'block',
    why: 'Editor / scanner annotations should not reach the public page.',
  },
  {
    id: 'd1-record-id',
    pattern: /\bD1:\s*(?:rec|doc|cand|term)[A-Za-z0-9_-]+/g,
    severity: 'block',
    why: 'D1 record IDs are internal database identifiers and must not leak publicly.',
  },
  {
    id: 'vimeo-url',
    pattern: /https?:\/\/(?:www\.)?vimeo\.com\/[0-9]+/gi,
    severity: 'block',
    why: 'Vimeo URLs in the glossary point at the private IIRRM training archive (Boyle corpus). Public release prohibited.',
  },
  {
    id: 'iirrm-archive-label',
    pattern: /\bIIRRM\s+Archive\b/gi,
    severity: 'block',
    why: '"IIRRM Archive" is the label for Brian\'s private training corpus; do not name it on public pages.',
  },
  {
    id: 'occurrence-meta',
    pattern: /--\s*\d+\s+occurrence\(s\)\s+of/gi,
    severity: 'block',
    why: 'N-occurrence metadata is a scanner artifact (textbook/transcript match line); strip before storage or filter at render time.',
  },
  {
    id: 'embedded-mp-title',
    pattern: /MedlinePlus\s+title:/gi,
    severity: 'warn',
    why: 'Inline "MedlinePlus title:" tag suggests an unresolved fuzzy-match note; verify the article is the right one.',
  },
  {
    id: 'unsure-marker',
    pattern: /\?\?\s*(?:unsure|confirm|verify|check|todo)\s*\?\?/gi,
    severity: 'warn',
    why: '"?? marker ??" pattern often left by humans/AI to mark a passage requiring verification.',
  },
];

function getCloudflareToken() {
  // Allow caller to pre-export CLOUDFLARE_API_TOKEN. Fall back to 1Password.
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  try {
    return execSync(`op read "op://Automation/CF - Worker Deploy - account/credential"`, {
      encoding: 'utf8',
    }).trim();
  } catch (e) {
    console.error('Failed to read CLOUDFLARE_API_TOKEN from env or 1Password.', e?.message ?? e);
    process.exit(2);
  }
}

function fetchD1(query, env) {
  const cmd = `npx wrangler d1 execute rrm-auth --remote --command ${JSON.stringify(query)} --json`;
  const out = execSync(cmd, { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out)[0]?.results || [];
}

function scanText(text, scope) {
  const findings = [];
  for (const rule of PATTERNS) {
    rule.pattern.lastIndex = 0;
    let m;
    while ((m = rule.pattern.exec(text)) !== null) {
      const start = Math.max(0, m.index - 40);
      const end = Math.min(text.length, m.index + m[0].length + 40);
      findings.push({
        id: rule.id,
        severity: rule.severity,
        why: rule.why,
        match: m[0],
        snippet: text.slice(start, end).replace(/\s+/g, ' ').trim(),
        scope,
      });
    }
  }
  return findings;
}

async function main() {
  const TOKEN = getCloudflareToken();
  const env = { ...process.env, CLOUDFLARE_API_TOKEN: TOKEN };

  // body_html
  const termFilter = SLUG_FILTER ? ` WHERE slug = '${SLUG_FILTER.replace(/'/g, "''")}'` : '';
  const terms = fetchD1(
    `SELECT id, slug, name, body_html, status FROM glossary_term${termFilter} ORDER BY slug`,
    env,
  );

  // definition sources (table may not exist yet during early rollout)
  let sources = [];
  // Probe whether the table exists; only skip on absence, fail-loud on transient errors.
  const tableProbe = fetchD1(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='glossary_definition_source'`,
    env,
  );
  if (tableProbe.length > 0) {
    const slugJoin = SLUG_FILTER ? ` AND t.slug = '${SLUG_FILTER.replace(/'/g, "''")}'` : '';
    sources = fetchD1(
      `SELECT s.id, s.term_id, t.slug, s.source_key, s.source_label, s.definition_text, s.attribution, s.visibility
         FROM glossary_definition_source s
         JOIN glossary_term t ON s.term_id = t.id
        WHERE s.status = 'published'${slugJoin}
        ORDER BY t.slug, s.sort_order`,
      env,
    );
  } else if (!JSON_OUT) {
    console.warn('NOTE: glossary_definition_source table not present yet (skipping source scan).');
  }

  const allFindings = [];

  for (const t of terms) {
    if (!t.body_html) continue;
    const found = scanText(t.body_html, {
      table: 'glossary_term',
      column: 'body_html',
      slug: t.slug,
      name: t.name,
      status: t.status,
    });
    allFindings.push(...found);
  }
  for (const s of sources) {
    const found = scanText(s.definition_text || '', {
      table: 'glossary_definition_source',
      column: 'definition_text',
      slug: s.slug,
      source_key: s.source_key,
      source_label: s.source_label,
    });
    allFindings.push(...found);
  }

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          mode: STRICT ? 'strict' : 'warn',
          terms_scanned: terms.length,
          sources_scanned: sources.length,
          findings: allFindings,
          summary: {
            block: allFindings.filter((f) => f.severity === 'block').length,
            warn: allFindings.filter((f) => f.severity === 'warn').length,
          },
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`\nGlossary publish-readiness gate (${STRICT ? 'STRICT' : 'warn-only'})`);
    console.log(`  Terms scanned:    ${terms.length}`);
    console.log(`  Sources scanned:  ${sources.length}`);
    console.log(`  Findings:         ${allFindings.length} (block=${allFindings.filter((f) => f.severity === 'block').length}, warn=${allFindings.filter((f) => f.severity === 'warn').length})`);

    if (allFindings.length > 0) {
      const groups = {};
      for (const f of allFindings) {
        groups[f.id] = groups[f.id] || { rule: f, items: [] };
        groups[f.id].items.push(f);
      }
      for (const g of Object.values(groups)) {
        const tag = g.rule.severity === 'block' ? '[BLOCK]' : '[WARN] ';
        console.log(`\n${tag} ${g.rule.id} -- ${g.items.length} hits`);
        console.log(`        ${g.rule.why}`);
        const samples = g.items.slice(0, 5);
        for (const f of samples) {
          const where =
            f.scope.table === 'glossary_term'
              ? `glossary/${f.scope.slug}`
              : `glossary/${f.scope.slug} -> ${f.scope.source_key}`;
          console.log(`        - ${where}`);
          console.log(`            match:   ${f.match}`);
          console.log(`            context: ...${f.snippet}...`);
        }
        if (g.items.length > 5) console.log(`          (+ ${g.items.length - 5} more)`);
      }
    } else {
      console.log('\n  All clear -- glossary content has no review artifacts.');
    }
  }

  const hasBlock = allFindings.some((f) => f.severity === 'block');
  if (STRICT && hasBlock) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('Gate failed:', e?.message ?? e);
  process.exit(2);
});
