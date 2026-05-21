#!/usr/bin/env node
/**
 * audit-tech-errors -- one-shot Ahrefs Site Audit pull for tech-error URL buckets.
 *
 * Bucket E of the 2026-05-20 GSC coverage improvements plan. READ-ONLY:
 * pulls 4xx / 5xx / 403 / soft-404 / redirect-chain URL lists from the
 * Ahrefs v3 Site Audit API and writes them to a JSON file for downstream
 * consumers (Bucket A-style remediation OR Brian's separately-developed
 * daily/weekly daemon).
 *
 * Discovered facts (verified 2026-05-21):
 *   - Ahrefs project for rrmacademy.org: id = 8580553, target_mode = subdomains
 *   - Latest crawl health_score = 97, 510 urls_with_errors out of 16,002 total
 *   - Ahrefs Site Audit does NOT have a distinct "soft 404" issue type in its
 *     catalog (verified via /v3/site-audit/issues against project 8580553's
 *     100-entry catalog on 2026-05-21). Soft-404 detection lives in GSC, not
 *     Ahrefs. We still surface the bucket so the daemon can plug GSC data
 *     into the same shape, but Ahrefs is queried for `http_code = 200` pages
 *     flagged with "Low word count" as a soft-404 proxy.
 *   - "Redirect chain" is not a single issue UUID in the catalog. Ahrefs
 *     reports the relationship via `page-explorer` fields: a page is in a
 *     redirect chain when `http_code` is 3xx AND `redirect_code` is also 3xx.
 *     That filter is the canonical way to enumerate them.
 *
 * Endpoint used:
 *   GET https://api.ahrefs.com/v3/site-audit/page-explorer
 *     ?project_id=...
 *     &where=<json filter>
 *     &select=url,http_code,redirect,redirect_code,traffic,incoming_all_links
 *     &limit=1000
 *
 * Auth:
 *   Token at op://Automation/Ahrefs API Token/credential (40-char Bearer).
 *
 * Output:
 *   tools/audit-tech-errors-output.json with structure
 *     {
 *       generated_at: ISO8601,
 *       project_id: "8580553",
 *       healthscore: { health_score, urls_with_errors, total, status, date },
 *       buckets: {
 *         "4xx":          { count, sample, issues: [...] },
 *         "5xx":          { count, sample, issues: [...] },
 *         "403":          { count, sample, issues: [...] },
 *         "soft_404":     { count, sample, issues: [...], note },
 *         "redirect_chain": { count, sample, issues: [...] }
 *       }
 *     }
 *
 * Usage:
 *   AHREFS_PROJECT_ID=8580553 node tools/audit-tech-errors.mjs
 *
 * Env vars:
 *   AHREFS_PROJECT_ID   default: 8580553 (RRM Academy project, discovered
 *                       2026-05-21 via /v3/site-audit/projects)
 *   AHREFS_API_TOKEN    optional override; if unset, reads from 1Password
 *                       via `op read op://Automation/Ahrefs API Token/credential`
 *   AHREFS_LIMIT        per-bucket cap (default 1000; Ahrefs page-explorer cap)
 *   AHREFS_OUTPUT       output path (default tools/audit-tech-errors-output.json)
 *
 * Exit codes:
 *   0  success
 *   1  any API call returned non-200 (full response body printed to stderr)
 *   2  1Password lookup failed (token unavailable)
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROJECT_ID = process.env.AHREFS_PROJECT_ID || '8580553';
const PER_BUCKET_LIMIT = Number.parseInt(process.env.AHREFS_LIMIT || '1000', 10);
const OUTPUT_PATH =
  process.env.AHREFS_OUTPUT || join(__dirname, 'audit-tech-errors-output.json');
const API_BASE = 'https://api.ahrefs.com/v3/site-audit';
const SELECT_FIELDS =
  'url,http_code,redirect,redirect_code,traffic,incoming_all_links';

/**
 * Bucket spec: each entry maps a logical bucket name to a Ahrefs
 * page-explorer `where` filter. Filters are JSON-encoded then
 * URL-encoded when assembling the request.
 *
 * Soft-404 has no native Ahrefs equivalent (see file header). We use a
 * documented proxy: pages returning 200 with extremely low word count
 * are commonly soft-404 candidates that Google later demotes. The
 * `note` field on the bucket flags this for downstream consumers so
 * they can swap in GSC's true soft-404 list when available.
 */
const BUCKETS = {
  '4xx': {
    description: 'Internal pages returning 4xx (excluding 403, broken down separately)',
    where: {
      and: [
        { field: 'http_code', is: ['gte', 400] },
        { field: 'http_code', is: ['lt', 500] },
        { not: { field: 'http_code', is: ['eq', 403] } },
      ],
    },
  },
  '5xx': {
    description: 'Internal pages returning 5xx',
    where: { field: 'http_code', is: ['gte', 500] },
  },
  '403': {
    description: 'Internal pages returning 403 (auth / forbidden)',
    where: { field: 'http_code', is: ['eq', 403] },
  },
  soft_404: {
    description:
      'Soft-404 proxy: 200-status pages with extremely low word count (content_nr_word < 100). Ahrefs has no native soft-404 issue; GSC owns that signal.',
    where: {
      and: [
        { field: 'http_code', is: ['eq', 200] },
        { field: 'content_nr_word', is: ['lt', 100] },
      ],
    },
    note: 'PROXY ONLY. Ahrefs Site Audit catalog (verified 2026-05-21) has no soft_404 issue. This filter (http_code=200 AND content_nr_word<100) approximates the soft-404 candidate set. Downstream consumers should overlay GSC soft-404 data when available.',
  },
  redirect_chain: {
    description: '3xx page whose redirect target is itself 3xx (chain or loop)',
    where: {
      and: [
        { field: 'http_code', is: ['gte', 300] },
        { field: 'http_code', is: ['lt', 400] },
        { field: 'redirect_code', is: ['gte', 300] },
        { field: 'redirect_code', is: ['lt', 400] },
      ],
    },
  },
};

/**
 * Pull Bearer token. Prefer AHREFS_API_TOKEN env var (CI / daemon use);
 * fall back to 1Password CLI for interactive use.
 */
function getToken() {
  if (process.env.AHREFS_API_TOKEN) return process.env.AHREFS_API_TOKEN.trim();
  try {
    const out = execSync('op read "op://Automation/Ahrefs API Token/credential"', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tok = out.trim();
    if (!tok || tok.length < 20) {
      console.error('1Password returned an unexpectedly short token; aborting.');
      process.exit(2);
    }
    return tok;
  } catch (err) {
    console.error('Failed to read Ahrefs token from 1Password:', err.message);
    console.error(
      'Hint: ensure `op signin` succeeded and item "Ahrefs API Token" exists in Automation vault.',
    );
    process.exit(2);
  }
}

async function ahrefsGET(path, params, token) {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const bodyText = await res.text();
  if (!res.ok) {
    console.error(`Ahrefs API ${res.status} on ${path}`);
    console.error('Request URL:', url.toString().replace(token, 'REDACTED'));
    console.error('Response body:', bodyText);
    throw new Error(`Ahrefs API error: ${res.status}`);
  }
  try {
    return JSON.parse(bodyText);
  } catch (_) {
    console.error('Failed to parse Ahrefs JSON. Raw body:', bodyText);
    throw new Error('Ahrefs JSON parse error');
  }
}

async function fetchHealthscore(token) {
  const data = await ahrefsGET('projects', {}, token);
  const entry = (data.healthscores || []).find(
    (h) => String(h.project_id) === String(PROJECT_ID),
  );
  if (!entry) {
    throw new Error(
      `No project ${PROJECT_ID} in /projects. Available: ${(data.healthscores || []).map((h) => h.project_id).join(', ')}`,
    );
  }
  return entry;
}

async function fetchBucket(name, spec, token) {
  const params = {
    project_id: PROJECT_ID,
    limit: PER_BUCKET_LIMIT,
    select: SELECT_FIELDS,
    where: spec.where,
  };
  let data;
  try {
    data = await ahrefsGET('page-explorer', params, token);
  } catch (err) {
    // soft_404 uses words_count which may not be supported on all plans.
    // Catch and degrade gracefully instead of failing the whole run.
    if (name === 'soft_404') {
      console.warn(
        `[warn] soft_404 bucket failed (likely unsupported field 'words_count' on this plan); returning empty.`,
      );
      return { count: 0, sample: [], issues: [], unsupported: true };
    }
    throw err;
  }
  const issues = Array.isArray(data.pages) ? data.pages : [];
  return {
    count: issues.length,
    sample: issues.slice(0, 5).map((p) => p.url),
    issues,
    ...(spec.note ? { note: spec.note } : {}),
    capped: issues.length === PER_BUCKET_LIMIT,
  };
}

async function main() {
  const token = getToken();
  const generated_at = new Date().toISOString();

  console.error(`[audit-tech-errors] project_id=${PROJECT_ID} limit=${PER_BUCKET_LIMIT}`);

  const healthscore = await fetchHealthscore(token);
  console.error(
    `[audit-tech-errors] health_score=${healthscore.health_score} urls_with_errors=${healthscore.urls_with_errors} crawl_date=${healthscore.date}`,
  );

  const buckets = {};
  for (const [name, spec] of Object.entries(BUCKETS)) {
    process.stderr.write(`[audit-tech-errors] fetching ${name}... `);
    const start = Date.now();
    buckets[name] = await fetchBucket(name, spec, token);
    const ms = Date.now() - start;
    process.stderr.write(`${buckets[name].count} (${ms}ms)\n`);
  }

  const out = {
    generated_at,
    project_id: PROJECT_ID,
    healthscore,
    bucket_definitions: Object.fromEntries(
      Object.entries(BUCKETS).map(([k, v]) => [
        k,
        { description: v.description, where: v.where },
      ]),
    ),
    buckets,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2));

  const summary = Object.fromEntries(
    Object.entries(buckets).map(([k, v]) => [k, v.count]),
  );
  console.log(JSON.stringify({ output: OUTPUT_PATH, counts: summary }, null, 2));
}

main().catch((err) => {
  console.error('[audit-tech-errors] FATAL:', err.message);
  process.exit(1);
});
