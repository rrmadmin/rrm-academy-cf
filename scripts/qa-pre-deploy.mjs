#!/usr/bin/env node
/**
 * Pre-deploy content QA. Runs between fetch-all and Astro build.
 * Non-blocking: writes qa-pre-summary.json and exits 0 even on findings.
 *
 * Pipeline:
 *   1. Pull most-recent snapshot per content type from R2 (snapshots/data/<type>/).
 *   2. Diff against just-fetched src/data/<type>.json -> changed/new record IDs.
 *   3. Run deterministic checks on changed records (looksDirty, sanitizer-would-change).
 *   4. If ANTHROPIC_API_KEY is set, escalate up to 50 flagged records to Sonnet.
 *   5. Emit qa-pre-summary.json for the Observatory webhook step.
 *
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN required.
 *      ANTHROPIC_API_KEY optional (Sonnet escalation).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sanitizeMarkdown } from '../src/lib/markdown-sanitize.mjs';
import { sanitizeHtml, looksDirty } from '../src/lib/html-sanitize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');
const OUT_PATH = join(__dirname, '..', 'qa-pre-summary.json');

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const BUCKET = 'rrm-assets';

const MAX_SONNET_CALLS = Number(process.env.QA_MAX_SONNET || 50);
const SONNET_MODEL = 'claude-sonnet-4-6';

const TYPES = [
  { type: 'posts',    file: 'posts.json',    prefix: 'snapshots/data/posts/',    field: 'content',          sanitize: sanitizeMarkdown, kind: 'markdown' },
  { type: 'articles', file: 'articles.json', prefix: 'snapshots/data/articles/', field: 'abstract',         sanitize: sanitizeMarkdown, kind: 'markdown' },
  { type: 'faqs',     file: 'faqs.json',     prefix: 'snapshots/data/faqs/',     field: 'publishedAnswer',  sanitize: sanitizeHtml,     kind: 'html' },
  // glossary has nested {terms: [...]} -- handled below
  { type: 'glossary', file: 'glossary.json', prefix: 'snapshots/data/glossary/', field: 'bodyHtml',         sanitize: sanitizeHtml,     kind: 'html', nested: 'terms' },
];

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN required');
  process.exit(0); // non-blocking
}

const r2Headers = { 'Authorization': `Bearer ${API_TOKEN}` };

async function r2List(prefix) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects?prefix=${encodeURIComponent(prefix)}&limit=100`;
  try {
    const res = await fetch(url, { headers: r2Headers });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.result || []).map((o) => o.key).sort();
  } catch (err) {
    console.warn(`[qa-pre] r2List(${prefix}) failed: ${err.message}`);
    return [];
  }
}

async function r2Get(key) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, { headers: r2Headers });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    console.warn(`[qa-pre] r2Get(${key}) failed: ${err.message}`);
    return null;
  }
}

function indexBy(records, key) {
  const out = new Map();
  for (const r of records) {
    if (r && r[key] != null) out.set(r[key], r);
  }
  return out;
}

function sliceForLLM(s, max = 4000) {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max) + '…';
}

async function callSonnet(systemPrompt, userPrompt) {
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: SONNET_MODEL,
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
  } catch (err) {
    return { error: `sonnet network: ${err.message}` };
  }
  if (!res.ok) {
    return { error: `sonnet ${res.status}` };
  }
  const data = await res.json();
  let text = data?.content?.[0]?.text || '';
  // Strip code fences if present.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) text = fenceMatch[1];
  // Try direct parse first, fall back to first {...} extraction.
  try {
    return JSON.parse(text.trim());
  } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { error: 'no json in response', raw: text.slice(0, 200) };
  try {
    return JSON.parse(m[0]);
  } catch (e) {
    return { error: 'invalid json', raw: m[0].slice(0, 200) };
  }
}

const SONNET_SYSTEM = `You are reviewing prose from rrmacademy.org for formatting defects only.
Do NOT critique content, accuracy, or style. Only formatting.
Look for: orphan markdown markers (** or _), raw [text](url) leaking past the parser,
missing space around inline links, doubled punctuation, encoding artifacts
(&amp;amp;, &nbsp; in attribute), broken section labels.
Return a single JSON object only: {"defects":[{"type":"string","snippet":"string","severity":"low|medium|high"}],"clean":boolean}
No prose, no markdown, just the JSON.`;

async function escalate(record, type, field) {
  const value = record[field] || '';
  const userPrompt = `${field}:\n${sliceForLLM(value, 6000)}`;
  return await callSonnet(SONNET_SYSTEM, userPrompt);
}

function loadCurrent(spec) {
  const path = join(DATA_DIR, spec.file);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return spec.nested ? (parsed[spec.nested] || []) : parsed;
  } catch {
    return null;
  }
}

async function loadPrevSnapshot(spec) {
  const keys = await r2List(spec.prefix);
  if (keys.length === 0) return null;
  const last = keys[keys.length - 1];
  const text = await r2Get(last);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return spec.nested ? (parsed[spec.nested] || []) : parsed;
  } catch {
    return null;
  }
}

function findChangedRecords(current, prev, idKey, field) {
  const prevIdx = prev ? indexBy(prev, idKey) : new Map();
  const changed = [];
  for (const rec of current || []) {
    const id = rec[idKey];
    if (!id) continue;
    const before = prevIdx.get(id);
    if (!before) {
      changed.push({ id, record: rec, reason: 'new' });
      continue;
    }
    if ((before[field] || '') !== (rec[field] || '')) {
      changed.push({ id, record: rec, reason: 'modified' });
    }
  }
  return changed;
}

async function main() {
  const summary = {
    ranAt: new Date().toISOString(),
    sonnetCallsBudget: ANTHROPIC_KEY ? MAX_SONNET_CALLS : 0,
    sonnetCallsUsed: 0,
    estCostUsd: 0,
    byType: {},
    totalDefects: 0,
  };

  for (const spec of TYPES) {
    const current = loadCurrent(spec);
    if (!current) {
      summary.byType[spec.type] = { error: 'data file missing' };
      continue;
    }
    const prev = await loadPrevSnapshot(spec);
    const changed = findChangedRecords(current, prev, 'id', spec.field);

    const flagged = [];
    for (const ch of changed) {
      const value = ch.record[spec.field];
      if (typeof value !== 'string' || value.length === 0) continue;
      const wouldChange = spec.sanitize(value) !== value;
      const dirty = spec.kind === 'html' ? looksDirty(value) : false;
      if (wouldChange || dirty) {
        flagged.push({ id: ch.id, reason: ch.reason, deterministic: { wouldChange, dirty } });
      }
    }

    const typeReport = {
      total: current.length,
      changedSinceLast: changed.length,
      deterministicallyFlagged: flagged.length,
      defects: [],
    };

    if (ANTHROPIC_KEY && flagged.length > 0 && summary.sonnetCallsUsed < MAX_SONNET_CALLS) {
      const toEscalate = flagged.slice(0, MAX_SONNET_CALLS - summary.sonnetCallsUsed);
      for (const f of toEscalate) {
        const rec = current.find((r) => r.id === f.id);
        if (!rec) continue;
        const result = await escalate(rec, spec.type, spec.field);
        summary.sonnetCallsUsed++;
        if (result.error) {
          typeReport.defects.push({ id: f.id, sonnetError: result.error });
          continue;
        }
        if (Array.isArray(result.defects) && result.defects.length > 0) {
          typeReport.defects.push({ id: f.id, defects: result.defects });
          summary.totalDefects += result.defects.length;
        }
      }
    } else if (!ANTHROPIC_KEY) {
      // no LLM -- report deterministic flags as defects directly
      for (const f of flagged) {
        typeReport.defects.push({ id: f.id, defects: [{ type: 'deterministic-flag', severity: 'low' }] });
        summary.totalDefects += 1;
      }
    }

    summary.byType[spec.type] = typeReport;
  }

  // Sonnet 4.6 ~$3 input / $15 output per 1M tokens. Per call assume ~2k input + 200 output = ~$0.009.
  summary.estCostUsd = +(summary.sonnetCallsUsed * 0.009).toFixed(4);

  writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
  console.log(`[qa-pre] wrote ${OUT_PATH}: ${summary.totalDefects} defects, ${summary.sonnetCallsUsed} sonnet calls (~$${summary.estCostUsd})`);
}

main().catch((err) => {
  // never block: emit a summary noting the failure
  console.warn(`[qa-pre] error: ${err.message}`);
  writeFileSync(OUT_PATH, JSON.stringify({ ranAt: new Date().toISOString(), error: err.message }, null, 2));
  process.exit(0);
});
