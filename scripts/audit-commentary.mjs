#!/usr/bin/env node
// Audit D1 `posts` table completeness + R2 cover existence.
// Usage: node scripts/audit-commentary.mjs [--json] [--strict] [--update-baseline]
// Exit code 0 on pass, 1 on issues (use --strict to fail on warnings too).
//
// --update-baseline rewrites scripts/.commentary-slug-baseline.json with current slugs.
// Run after a deliberate slug rename (and after adding a 301 in rrm-router).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has('--json');
const STRICT = args.has('--strict');
const UPDATE_BASELINE = args.has('--update-baseline');

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = resolve(__dirname, '.commentary-slug-baseline.json');

// Locked pillar vocabulary. Add a new value here ONLY when Brian has
// deliberately introduced a new pillar. A typo or casing drift must fail
// the audit rather than silently extend the set.
const PILLAR_VOCAB = new Set([
  'Education - NaPro/RRM',
  'Education - Endometriosis',
  'Education - PCOS',
  'Patient Education',
  'Clinician Education',
  'Personal/Practice',
  'Research Highlight',
  'Systems Critique',
  'Empowerment',
]);

// Invisible / formatting characters that break Astro's markdown renderer
// when they land inside fenced code or at token boundaries. Detected with
// names so the warning points at the specific intruder.
const CONTROL_CHARS = [
  { name: 'ZWSP',        re: /​/g },
  { name: 'ZWNJ',        re: /‌/g },
  { name: 'ZWJ',         re: /‍/g },
  { name: 'BOM',         re: /﻿/g },
  { name: 'NBSP',        re: / /g },
  { name: 'word-joiner', re: /⁠/g },
  { name: 'CRLF',        re: /\r\n/g  },
  { name: 'CR',          re: /(?<!\n)\r(?!\n)/g },
];

const ACCOUNT_ID = 'ecf2c5bc8b5ebd634bcb587b3890910a';
const R2_BUCKET = 'rrm-assets';

function sh(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function log(level, ...parts) {
  if (JSON_OUT) return;
  const tag = { info: '  ', warn: '⚠ ', error: '✗ ', ok: '✓ ' }[level] ?? '';
  console.log(tag + parts.join(' '));
}

process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID;
if (!process.env.CLOUDFLARE_API_TOKEN) {
  try {
    process.env.CLOUDFLARE_API_TOKEN = sh('op', ['read', 'op://Automation/Cloudflare API Token - Claude Code Full Access/credential']).trim();
  } catch (err) {
    console.error('Failed to load CLOUDFLARE_API_TOKEN from 1Password:', err.message);
    process.exit(2);
  }
}

log('info', 'Querying D1 rrm-auth.posts...');
const queryOut = sh('npx', [
  'wrangler', 'd1', 'execute', 'rrm-auth', '--remote',
  '--command', `SELECT id, slug, title, content, excerpt, content_pillar, status, cover_image_url, publish_date, word_count, LENGTH(content) AS body_len, LENGTH(excerpt) AS excerpt_len, LENGTH(seo_keywords) AS keywords_len FROM posts ORDER BY publish_date DESC`,
  '--json',
]);
const d1 = JSON.parse(queryOut);
const posts = d1[0].results;

log('ok', `${posts.length} posts in D1`);

const issues = { error: [], warn: [] };

function flag(level, post, code, detail) {
  issues[level].push({ slug: post.slug, code, detail });
}

// 1. Schema sanity
for (const p of posts) {
  if (!p.slug) flag('error', p, 'missing-slug', p.id);
  if (!p.cover_image_url) flag('error', p, 'empty-cover', '');
  if (!p.publish_date) flag('error', p, 'missing-publish-date', '');
  if (!['draft', 'review', 'published', 'archived'].includes(p.status)) flag('error', p, 'bad-status', p.status);

  if (p.status === 'published') {
    if (p.body_len === 0) flag('error', p, 'empty-body', '');
    if (p.excerpt_len === 0) flag('warn', p, 'empty-excerpt', '');
    if (p.word_count === 0) flag('warn', p, 'word-count-zero', '');
    if (p.keywords_len === 0) flag('warn', p, 'empty-seo-keywords', '');
  }
}

// 2. Cover URL format
function classifyUrl(url) {
  if (!url) return 'empty';
  if (url.startsWith('/api/assets/')) return 'canonical';
  if (url.startsWith('/images/')) return 'legacy-images';
  if (url.startsWith('http')) return 'absolute';
  return 'other';
}
for (const p of posts) {
  const cls = classifyUrl(p.cover_image_url);
  if (cls !== 'canonical' && cls !== 'empty') {
    flag('warn', p, 'non-canonical-cover-url', `${cls}: ${p.cover_image_url}`);
  }
}

// 3. Slug uniqueness
const slugCounts = new Map();
for (const p of posts) slugCounts.set(p.slug, (slugCounts.get(p.slug) ?? 0) + 1);
for (const [slug, count] of slugCounts) {
  if (count > 1) issues.error.push({ slug, code: 'duplicate-slug', detail: `appears ${count}x` });
}

// 4. Control-char / invisible-char scan (content + title + excerpt).
// ZWSP inside a fenced code block breaks Astro's renderer silently.
// NBSP and CRLF cause flaky diffs and render edge cases.
for (const p of posts) {
  for (const field of ['title', 'excerpt', 'content']) {
    const val = p[field] ?? '';
    if (!val) continue;
    const hits = [];
    for (const { name, re } of CONTROL_CHARS) {
      const matches = val.match(re);
      if (matches) hits.push(`${name}x${matches.length}`);
    }
    if (hits.length > 0) {
      flag('warn', p, 'invisible-chars', `${field}: ${hits.join(', ')}`);
    }
  }
}

// 5. Pillar vocabulary lock. Empty pillar is a warning; unknown pillar
// is an error. New pillars must be added to PILLAR_VOCAB above explicitly.
for (const p of posts) {
  const pillar = p.content_pillar ?? '';
  if (p.status !== 'published') continue;
  if (pillar === '') {
    flag('warn', p, 'empty-pillar', '');
  } else if (!PILLAR_VOCAB.has(pillar)) {
    flag('error', p, 'unknown-pillar', `"${pillar}" not in vocab`);
  }
}

// 6. Slug-immutability baseline. On first run, writes baseline. On later
// runs, flags any id whose slug changed since baseline. New ids are OK.
let baseline = null;
if (existsSync(BASELINE_PATH)) {
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  } catch (err) {
    log('warn', `baseline exists but could not parse: ${err.message}`);
  }
}
if (baseline) {
  for (const p of posts) {
    const prior = baseline[p.id];
    if (prior && prior !== p.slug) {
      flag('error', p, 'slug-changed', `${prior} -> ${p.slug} (id=${p.id}). Add 301 in rrm-router before rerunning with --update-baseline.`);
    }
  }
}

if (UPDATE_BASELINE || !baseline) {
  const next = Object.fromEntries(posts.map(p => [p.id, p.slug]));
  writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n');
  log('ok', `baseline ${baseline ? 'updated' : 'initialized'}: ${BASELINE_PATH}`);
}

// 4. R2 object existence per slug (HEAD via edge, since CF workers.dev R2 API requires account-scoped token)
log('info', 'Verifying R2 covers via edge (HEAD /api/assets/commentary/<slug>.webp)...');
let covers_ok = 0;
let covers_missing = 0;
for (const p of posts) {
  if (p.status !== 'published') continue;
  const slug = p.slug;
  try {
    const out = sh('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `https://rrmacademy.org/api/assets/commentary/${slug}.webp`]);
    const code = out.trim();
    if (code === '200') {
      covers_ok++;
    } else {
      flag('error', p, 'cover-not-200', `http=${code}`);
      covers_missing++;
    }
  } catch (err) {
    flag('error', p, 'cover-check-failed', err.message.slice(0, 80));
    covers_missing++;
  }
}

// Output
if (JSON_OUT) {
  console.log(JSON.stringify({
    total: posts.length,
    covers_ok,
    covers_missing,
    errors: issues.error,
    warnings: issues.warn,
  }, null, 2));
} else {
  console.log();
  console.log(`=== audit summary ===`);
  console.log(`  posts:           ${posts.length}`);
  console.log(`  covers 200:      ${covers_ok}`);
  console.log(`  covers missing:  ${covers_missing}`);
  console.log(`  errors:          ${issues.error.length}`);
  console.log(`  warnings:        ${issues.warn.length}`);

  if (issues.error.length > 0) {
    console.log('\nErrors:');
    for (const i of issues.error) console.log(`  ✗ ${i.slug} [${i.code}] ${i.detail}`);
  }
  if (issues.warn.length > 0) {
    console.log('\nWarnings:');
    for (const i of issues.warn) console.log(`  ⚠ ${i.slug} [${i.code}] ${i.detail}`);
  }
}

const fail = issues.error.length > 0 || (STRICT && issues.warn.length > 0);
process.exit(fail ? 1 : 0);
