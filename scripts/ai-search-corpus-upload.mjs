// scripts/ai-search-corpus-upload.mjs
//
// Phase 1c of /ask v2 AI Search rebuild.
// Plan: docs/plans/2026-04-20-ask-v2-ai-search-rebuild.md
//
// Reads src/data/articles.json + posts.json + faqs.json + glossary.json + pillar
// constants and uploads each as an indexable item to the rrm-academy-search-articles
// AI Search instance. Persists key↔item_id↔content_hash mapping in D1 ai_search_docs
// for orphan reconciliation.
//
// CREDENTIAL INVENTORY:
//   CLOUDFLARE_API_TOKEN
//     1Password: op://Automation/Cloudflare API Token - AI Search Phase 1 (account-scoped)/credential
//     For AI Search items API
//   D1_API_TOKEN (optional; defaults to CLOUDFLARE_API_TOKEN)
//     1Password: op://Automation/Cloudflare API Token - Claude Code Full Access/credential
//     For D1 ai_search_docs reads/writes via REST API
//   CF_ACCOUNT_ID  (default: ecf2c5bc8b5ebd634bcb587b3890910a)
//   D1_DATABASE_ID (default: 22742c9c-77fa-4344-abda-7e7e8b0da9de — rrm-auth)
//
// USAGE:
//   export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/Cloudflare API Token - AI Search Phase 1 (account-scoped)/credential')
//   export D1_API_TOKEN=$(op read 'op://Automation/Cloudflare API Token - Claude Code Full Access/credential')
//   node scripts/ai-search-corpus-upload.mjs --dry-run
//   node scripts/ai-search-corpus-upload.mjs --limit 5
//   node scripts/ai-search-corpus-upload.mjs --full-rebuild
//   node scripts/ai-search-corpus-upload.mjs --single-record /library/<slug>.md
//   node scripts/ai-search-corpus-upload.mjs --reconcile --execute --max-delete 50
//
// ABORT PATH:
//   Ctrl-C at any point. The D1 row is only written AFTER successful upload+poll, so
//   partially-completed uploads leave AI Search items without D1 rows. Run --reconcile
//   to detect and clean those (matches by listing AI Search items vs D1 keys).

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || 'ecf2c5bc8b5ebd634bcb587b3890910a';
const D1_DB_ID = process.env.D1_DATABASE_ID || '22742c9c-77fa-4344-abda-7e7e8b0da9de';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const D1_TOKEN = process.env.D1_API_TOKEN || TOKEN;
const NAMESPACE = 'rrm-academy-search';
const INSTANCE = 'rrm-academy-search-articles';
// CF AI Search rejects keys above ~128 chars (verified empirically 2026-04-28: 128 works, 134 fails).
// Plan said ~140; production shows actual cap is lower. Cap at 125 for safety margin.
const KEY_MAX = 125;
const SLUG_TRUNC = 100;
const POLL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1500;
const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 30_000;

// Wraps fetch() with an AbortController + per-request timeout. Without this,
// a hung CF API connection (TCP accepted, no response) blocks the calling
// loop indefinitely. POLL_TIMEOUT_MS gates the outer poll loop but cannot
// recover from an inner fetch that never settles.
async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
function parseIntFlag(name, defaultValue) {
  const raw = flagValue(name);
  if (raw === undefined) return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`[ERROR] ${name} must be a non-negative integer; got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  return n;
}
const DRY_RUN = flag('--dry-run');
const LIMIT = flagValue('--limit') !== undefined ? parseIntFlag('--limit', null) : null;
const FULL_REBUILD = flag('--full-rebuild');
const SINGLE_RECORD = flagValue('--single-record');
const RECONCILE = flag('--reconcile');
const EXECUTE = flag('--execute');
const MAX_DELETE = parseIntFlag('--max-delete', 0);
const TYPE_FILTER = flagValue('--type'); // article | post | faq | glossary | pillar

const RUN_STARTED_AT = new Date().toISOString();

// 6 pillar pages (hardcoded — these are Astro pages, not D1)
const PILLARS = [
  { slug: 'what-is-rrm', title: 'What is Restorative Reproductive Medicine?', body: 'See https://rrmacademy.org/what-is-rrm/ — pillar guide on Restorative Reproductive Medicine principles, scope, and methods.' },
  { slug: 'naprotechnology', title: 'NaProTechnology', body: 'See https://rrmacademy.org/naprotechnology/ — pillar guide on Natural Procreative Technology developed by Dr Thomas Hilgers.' },
  { slug: 'common-questions-about-rrm', title: 'Common Questions about RRM', body: 'See https://rrmacademy.org/common-questions-about-rrm/ — pillar FAQ collection.' },
  { slug: 'femm', title: 'FEMM Health', body: 'See https://rrmacademy.org/femm/ — pillar guide on Fertility Education & Medical Management.' },
  { slug: 'neofertility', title: 'NeoFertility', body: 'See https://rrmacademy.org/neofertility/ — pillar guide on Dr Phil Boyle\'s NeoFertility approach.' },
  { slug: 'glossary', title: 'RRM Glossary', body: 'See https://rrmacademy.org/glossary/ — controlled vocabulary of RRM terms with definitions and references.' },
];

function log(...parts) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${parts.join(' ')}`);
}
function err(...parts) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}][ERROR] ${parts.join(' ')}`);
}

// ----------------- key construction -----------------

function sha8(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 8);
}
function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

function buildKey(prefix, slug) {
  // prefix like "/library/" or "/commentary/"
  const naive = `${prefix}${slug}.md`;
  if (naive.length <= KEY_MAX) return { key: naive, fullSlug: null };
  // Truncate slug, append sha8 of full slug for uniqueness
  const truncated = slug.slice(0, SLUG_TRUNC);
  const hashed = `${prefix}${truncated}-${sha8(slug)}.md`;
  return { key: hashed, fullSlug: slug };
}

// ----------------- frontmatter strip -----------------

function stripFrontmatter(content) {
  if (!content) return '';
  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---\n', 4);
    if (end > 0) return content.slice(end + 5);
  }
  return content;
}

function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

// ----------------- record → upload-payload -----------------

const SKIP_COUNTERS = {
  article_no_relevance: 0,
  article_no_domain: 0,
  article_invalid_relevance: 0,
};

function buildArticleDoc(article) {
  if (!article.rrmRelevance) { SKIP_COUNTERS.article_no_relevance++; return null; }
  if (!article.domain) { SKIP_COUNTERS.article_no_domain++; return null; }

  const relevanceDigit = parseInt(article.rrmRelevance, 10);
  if (!Number.isFinite(relevanceDigit)) { SKIP_COUNTERS.article_invalid_relevance++; return null; }

  const { key, fullSlug } = buildKey('/library/', article.slug);

  const lines = [`# ${article.title}`, ''];
  if (article.authors) lines.push(`Authors: ${article.authors}`);
  if (article.journal && article.year) lines.push(`Source: ${article.journal} (${article.year})`);
  else if (article.journal) lines.push(`Source: ${article.journal}`);
  if (Array.isArray(article.topics) && article.topics.length) {
    lines.push(`Topics: ${article.topics.join('; ')}.`);
  }
  if (article.abstract) {
    lines.push('');
    lines.push(article.abstract);
  }
  const body = lines.join('\n');

  const metadata = {
    type: 'article',
    domain: String(article.domain),
    rrm_relevance: String(relevanceDigit),
    is_open_access: article.isOpenAccess ? 'true' : 'false',
  };
  if (article.year != null && Number.isFinite(article.year)) metadata.year = String(article.year);

  return { key, fullSlug, body, sourceType: 'article', metadata };
}

function buildPostDoc(post) {
  if (!post?.slug || typeof post.slug !== 'string' || !post.slug.trim()) return null;
  const { key, fullSlug } = buildKey('/commentary/', post.slug);
  const lines = [`# ${post.title}`, ''];
  if (post.author) lines.push(`Author: ${post.author}`);
  if (post.contentPillar) lines.push(`Pillar: ${post.contentPillar}`);
  if (post.excerpt) {
    lines.push('');
    lines.push(post.excerpt);
  }
  if (post.content) {
    lines.push('');
    lines.push(stripFrontmatter(post.content));
  }
  let year = new Date().getFullYear();
  if (post.publishDate) {
    const parsed = new Date(post.publishDate);
    if (!isNaN(parsed.getTime())) year = parsed.getFullYear();
  }
  return {
    key,
    fullSlug,
    body: lines.join('\n'),
    sourceType: 'post',
    metadata: {
      type: 'post',
      year: String(year),
      domain: String(post.contentPillar || 'Other'),
      rrm_relevance: '5',
      is_open_access: 'true',
    },
  };
}

function buildFaqDoc(faq) {
  if (!faq?.slug || typeof faq.slug !== 'string' || !faq.slug.trim()) return null;
  const { key, fullSlug } = buildKey('/faqs/', faq.slug);
  const answer = faq.publishedAnswer || faq.basicAnswer || faq.schemaAnswer || '';
  const lines = [`# ${faq.question}`, ''];
  if (faq.category) lines.push(`Category: ${faq.category}`);
  if (answer) {
    lines.push('');
    lines.push(answer);
  }
  return {
    key,
    fullSlug,
    body: lines.join('\n'),
    sourceType: 'faq',
    metadata: {
      type: 'faq',
      year: String(new Date().getFullYear()),
      domain: String(faq.category || 'General'),
      rrm_relevance: '5',
      is_open_access: 'true',
    },
  };
}

function buildGlossaryDoc(term) {
  if (!term?.slug || typeof term.slug !== 'string' || !term.slug.trim()) return null;
  const { key, fullSlug } = buildKey('/glossary/', term.slug);
  const lines = [`# ${term.name}`, ''];
  if (term.abbreviation) lines.push(`Abbreviation: ${term.abbreviation}`);
  if (term.bodyHtml) {
    lines.push('');
    lines.push(decodeEntities(term.bodyHtml.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
  }
  return {
    key,
    fullSlug,
    body: lines.join('\n'),
    sourceType: 'glossary',
    metadata: {
      type: 'glossary',
      year: String(new Date().getFullYear()),
      domain: 'Glossary',
      rrm_relevance: '5',
      is_open_access: 'true',
    },
  };
}

function buildPillarDoc(pillar) {
  if (!pillar?.slug || typeof pillar.slug !== 'string' || !pillar.slug.trim()) return null;
  const { key, fullSlug } = buildKey('/', pillar.slug);
  const body = `# ${pillar.title}\n\n${pillar.body}`;
  return {
    key,
    fullSlug,
    body,
    sourceType: 'pillar',
    metadata: {
      type: 'pillar',
      year: String(new Date().getFullYear()),
      domain: 'Pillar',
      rrm_relevance: '5',
      is_open_access: 'true',
    },
  };
}

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

function computeContentHash(doc) {
  return sha256(stableStringify({ body: doc.body, metadata: doc.metadata }));
}

// ----------------- D1 REST API -----------------

async function d1Query(sql, params = [], attempt = 0) {
  const r = await fetchWithTimeout(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${D1_DB_ID}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${D1_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    if (r.status >= 500 && attempt < 3) {
      await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
      return d1Query(sql, params, attempt + 1);
    }
    throw new Error(`D1 query non-JSON: ${r.status}: ${text.slice(0, 300)}`);
  }
  const errs = json.errors || [];
  const rateLimited = r.status === 429 || r.status >= 500 || errs.some((e) => e.code === 429 || e.code === 971 || (e.message || '').toLowerCase().includes('rate'));
  if (rateLimited && attempt < 4) {
    await new Promise((res) => setTimeout(res, 750 * 2 ** attempt));
    return d1Query(sql, params, attempt + 1);
  }
  if (!r.ok || json.success === false) {
    throw new Error(`D1 query failed: ${JSON.stringify(json.errors || text.slice(0, 300))}`);
  }
  return json.result?.[0]?.results || [];
}

async function d1GetDoc(key) {
  const rows = await d1Query('SELECT key, item_id, content_hash, full_slug FROM ai_search_docs WHERE key = ?1', [key]);
  return rows[0] || null;
}

async function d1UpsertDoc({ key, itemId, contentHash, sourceType, fullSlug }) {
  await d1Query(
    `INSERT INTO ai_search_docs (key, item_id, instance_id, content_hash, source_type, full_slug, indexed_at, last_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
     ON CONFLICT(key) DO UPDATE SET
       item_id = excluded.item_id,
       content_hash = excluded.content_hash,
       full_slug = excluded.full_slug,
       indexed_at = excluded.indexed_at,
       last_seen_at = excluded.last_seen_at`,
    [key, itemId, INSTANCE, contentHash, sourceType, fullSlug, RUN_STARTED_AT],
  );
}

async function d1BumpLastSeen(key) {
  await d1Query('UPDATE ai_search_docs SET last_seen_at = ?2 WHERE key = ?1', [key, RUN_STARTED_AT]);
}

async function d1ListOrphans() {
  return d1Query(
    'SELECT key, item_id FROM ai_search_docs WHERE last_seen_at < ?1 ORDER BY last_seen_at ASC',
    [RUN_STARTED_AT],
  );
}

async function d1DeleteDoc(key) {
  await d1Query('DELETE FROM ai_search_docs WHERE key = ?1', [key]);
}

// ----------------- AI Search items API -----------------

const ITEMS_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai-search/namespaces/${NAMESPACE}/instances/${INSTANCE}/items`;

async function uploadItem({ key, body, metadata }, attempt = 0) {
  const form = new FormData();
  const blob = new Blob([body], { type: 'text/markdown' });
  form.append('file', blob, key);
  form.append('metadata', JSON.stringify(metadata));
  const r = await fetchWithTimeout(ITEMS_BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: form,
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    if (r.status >= 500 && attempt < 3) {
      await new Promise((res) => setTimeout(res, 750 * 2 ** attempt));
      return uploadItem({ key, body, metadata }, attempt + 1);
    }
    throw new Error(`upload non-JSON ${r.status}: ${text.slice(0, 300)}`);
  }
  const errs = json.errors || [];
  const rateLimited = r.status === 429 || r.status >= 500 || errs.some((e) => e.code === 10429 || e.code === 971 || (e.message || '').toLowerCase().includes('rate'));
  if (rateLimited && attempt < 4) {
    await new Promise((res) => setTimeout(res, 750 * 2 ** attempt));
    return uploadItem({ key, body, metadata }, attempt + 1);
  }
  if (!r.ok || json.success === false) {
    throw new Error(`upload failed for ${key}: ${JSON.stringify(json.errors || text.slice(0, 300))}`);
  }
  return json.result;
}

async function pollItem(itemId) {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const r = await fetchWithTimeout(`${ITEMS_BASE}/${itemId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const json = await r.json();
    const status = json?.result?.status;
    if (status === 'completed') return json.result;
    if (status === 'failed' || json?.result?.error) {
      throw new Error(`item ${itemId} failed: ${json?.result?.error || 'unknown'}`);
    }
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
  }
  throw new Error(`poll timeout for item ${itemId} after ${POLL_TIMEOUT_MS}ms`);
}

async function uploadAndPoll(doc) {
  // Upload returns immediately with item_id and status='queued'.
  // The CF AI Search async indexer moves items through queued→running→completed
  // but items are already searchable in `running` state. Polling to `completed`
  // adds many minutes per doc with no benefit to retrieval. Skip the poll.
  // The background indexer eventually flips status; we don't store it in D1.
  return uploadItem(doc);
}

async function deleteItem(itemId) {
  const r = await fetchWithTimeout(`${ITEMS_BASE}/${itemId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok && r.status !== 404) {
    throw new Error(`deleteItem ${itemId} -> ${r.status}`);
  }
  return true;
}

// ----------------- batch with concurrency cap -----------------

async function processBatch(docs, processor) {
  const results = [];
  for (let i = 0; i < docs.length; i += CONCURRENCY) {
    const chunk = docs.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.allSettled(chunk.map((doc) => processor(doc)));
    results.push(...chunkResults);
    log(`  progress: ${Math.min(i + CONCURRENCY, docs.length)}/${docs.length}`);
  }
  return results;
}

// ----------------- main flow -----------------

async function readDataFiles() {
  const articlesPath = join(REPO_ROOT, 'src/data/articles.json');
  const postsPath = join(REPO_ROOT, 'src/data/posts.json');
  const faqsPath = join(REPO_ROOT, 'src/data/faqs.json');
  const glossaryPath = join(REPO_ROOT, 'src/data/glossary.json');

  const articles = existsSync(articlesPath) ? JSON.parse(readFileSync(articlesPath, 'utf8')) : [];
  const posts = existsSync(postsPath) ? JSON.parse(readFileSync(postsPath, 'utf8')) : [];
  const faqs = existsSync(faqsPath) ? JSON.parse(readFileSync(faqsPath, 'utf8')) : [];
  const glossary = existsSync(glossaryPath) ? JSON.parse(readFileSync(glossaryPath, 'utf8')) : { terms: [] };

  return { articles, posts, faqs, glossaryTerms: glossary.terms || [] };
}

function buildAllDocs(data, typeFilter) {
  const docs = [];
  if (!typeFilter || typeFilter === 'article') {
    for (const a of data.articles) {
      const d = buildArticleDoc(a);
      if (d) docs.push(d);
    }
  }
  if (!typeFilter || typeFilter === 'post') {
    for (const p of data.posts) {
      const d = buildPostDoc(p);
      if (d) docs.push(d);
    }
  }
  if (!typeFilter || typeFilter === 'faq') {
    for (const f of data.faqs) {
      const d = buildFaqDoc(f);
      if (d) docs.push(d);
    }
  }
  if (!typeFilter || typeFilter === 'glossary') {
    for (const t of data.glossaryTerms) {
      const d = buildGlossaryDoc(t);
      if (d) docs.push(d);
    }
  }
  if (!typeFilter || typeFilter === 'pillar') {
    for (const p of PILLARS) {
      const d = buildPillarDoc(p);
      if (d) docs.push(d);
    }
  }
  return docs;
}

async function processDoc(doc) {
  const newHash = computeContentHash(doc);
  const existing = await d1GetDoc(doc.key);
  if (existing && existing.content_hash === newHash) {
    await d1BumpLastSeen(doc.key);
    return { key: doc.key, action: 'skip-unchanged' };
  }
  if (DRY_RUN) {
    return { key: doc.key, action: existing ? 'would-update' : 'would-create', sourceType: doc.sourceType };
  }
  const result = await uploadAndPoll(doc);
  try {
    await d1UpsertDoc({
      key: doc.key,
      itemId: result.id,
      contentHash: newHash,
      sourceType: doc.sourceType,
      fullSlug: doc.fullSlug,
    });
  } catch (e) {
    err(`D1 write failed for ${doc.key} after CF upload (item ${result.id}); rolling back CF item`);
    await deleteItem(result.id).catch((rbErr) => err(`rollback also failed: ${rbErr.message}`));
    throw e;
  }
  return { key: doc.key, action: existing ? 'updated' : 'created', itemId: result.id };
}

async function runReconcile() {
  log('reconcile pass: looking for orphans (last_seen_at < this run)');
  if (TYPE_FILTER) {
    err('refusing to reconcile while --type filter is active: orphan detection cannot distinguish removed-from-source from not-processed-this-run');
    process.exit(1);
  }
  // Sanity guard: reconcile should run AFTER an upload pass, where last_seen_at
  // has been bumped to RUN_STARTED_AT for every eligible record. If virtually
  // every D1 row looks orphan, it means we're running reconcile standalone
  // (without a preceding upload pass) — refuse rather than nuke the index.
  const totalRows = await d1Query('SELECT COUNT(*) AS n FROM ai_search_docs');
  const total = totalRows[0]?.n ?? 0;
  const orphans = await d1ListOrphans();
  log(`found ${orphans.length} orphans of ${total} rows`);
  if (total > 0 && orphans.length / total > 0.5) {
    err('refusing to run reconcile: more than 50% of rows look orphan, which means an upload pass did NOT precede this reconcile.');
    err('Run the loader without --reconcile first (e.g. node scripts/ai-search-corpus-upload.mjs), then add --reconcile to the SAME invocation, or use --full-rebuild.');
    process.exit(1);
  }
  if (orphans.length === 0) return;
  if (orphans.length > 0 && !EXECUTE) {
    log('DRY-RUN (default for reconcile). Add --execute --max-delete N to actually delete.');
    for (const o of orphans.slice(0, 20)) {
      log(`  would-delete ${o.key} item_id=${o.item_id}`);
    }
    return;
  }
  if (orphans.length > MAX_DELETE) {
    err(`refusing to delete ${orphans.length} orphans (--max-delete=${MAX_DELETE}). Bump --max-delete or investigate.`);
    process.exit(1);
  }
  let deleted = 0;
  for (const o of orphans) {
    try {
      await deleteItem(o.item_id);
      await d1DeleteDoc(o.key);
      deleted++;
      log(`  deleted ${o.key}`);
    } catch (e) {
      err(`  failed to delete ${o.key}: ${e.message}`);
    }
  }
  log(`reconcile complete: deleted ${deleted}/${orphans.length}`);
}

async function main() {
  if (!TOKEN) {
    err('CLOUDFLARE_API_TOKEN not set. See CREDENTIAL INVENTORY at top of file.');
    process.exit(1);
  }

  log(`account: ${ACCOUNT_ID}`);
  log(`namespace: ${NAMESPACE}`);
  log(`instance: ${INSTANCE}`);
  log(`run started: ${RUN_STARTED_AT}`);
  if (DRY_RUN) log('DRY-RUN — no AI Search uploads, no D1 writes');

  if (RECONCILE) {
    await runReconcile();
    return;
  }

  const data = await readDataFiles();
  log(`loaded: ${data.articles.length} articles, ${data.posts.length} posts, ${data.faqs.length} faqs, ${data.glossaryTerms.length} glossary terms, ${PILLARS.length} pillars`);

  let docs = buildAllDocs(data, TYPE_FILTER);
  log(`built ${docs.length} indexable docs after type filter (filter=${TYPE_FILTER || 'none'})`);
  const skipped = Object.entries(SKIP_COUNTERS).filter(([, v]) => v > 0);
  if (skipped.length) {
    log(`skipped: ${skipped.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }

  if (SINGLE_RECORD) {
    docs = docs.filter((d) =>
      d.key === SINGLE_RECORD ||
      d.fullSlug === SINGLE_RECORD ||
      (d.fullSlug && `/library/${d.fullSlug}.md` === SINGLE_RECORD) ||
      (d.fullSlug && `/commentary/${d.fullSlug}.md` === SINGLE_RECORD)
    );
    if (docs.length === 0) {
      err(`single-record key ${SINGLE_RECORD} not found in built docs (matched against key, fullSlug, /library/<slug>.md, /commentary/<slug>.md)`);
      process.exit(1);
    }
    log(`single-record mode: matched key=${docs[0].key}`);
  }

  if (LIMIT) {
    docs = docs.slice(0, LIMIT);
    log(`--limit=${LIMIT} applied`);
  }

  log(`processing ${docs.length} docs with concurrency=${CONCURRENCY}`);
  const results = await processBatch(docs, processDoc);

  const counts = { created: 0, updated: 0, 'skip-unchanged': 0, 'would-create': 0, 'would-update': 0, failed: 0 };
  const failures = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      counts[results[i].value.action] = (counts[results[i].value.action] || 0) + 1;
    } else {
      counts.failed++;
      failures.push({ key: docs[i].key, error: results[i].reason?.message });
    }
  }

  log('SUMMARY:');
  for (const [k, v] of Object.entries(counts)) if (v > 0) log(`  ${k}: ${v}`);
  if (failures.length > 0) {
    err(`${failures.length} failures:`);
    for (const f of failures.slice(0, 20)) err(`  ${f.key}: ${f.error}`);
    process.exit(1);
  }

  if (FULL_REBUILD && !DRY_RUN) {
    log('post-rebuild reconcile (dry-run)');
    await runReconcile();
  }

  log('DONE');
}

main().catch((e) => {
  err(e.message);
  process.exit(1);
});
