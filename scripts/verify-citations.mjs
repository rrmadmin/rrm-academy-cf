/**
 * Citation Verifier for RRM Academy Blog Posts
 *
 * Every external link in a blog post is a citation on a medical education site.
 * This script extracts all URLs, PMIDs, and DOIs, then verifies each one using
 * an API cascade:
 *
 *   1. PMID → NCBI E-utilities API (ground truth for PubMed IDs)
 *   2. DOI  → CrossRef API + doi.org fallback (ground truth for DOIs)
 *   3. URL  → HTTP GET (checks page exists, reads title, detects soft 404)
 *   4. Any failure → Perplexity Sonar Pro (live web search as final arbiter)
 *
 * Usage:
 *   node scripts/verify-citations.mjs                    # verify all posts
 *   node scripts/verify-citations.mjs --record recXXX    # verify single post by Airtable ID
 *   node scripts/verify-citations.mjs --slug my-post     # verify single post by slug
 *   node scripts/verify-citations.mjs --debug            # show raw Perplexity responses
 *
 * Env:
 *   OPENROUTER_API_KEY  -- if set, used directly. Otherwise reads from 1Password.
 *
 * Exit code 1 if any citation fails verification. Designed to run in CI.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POSTS_PATH = join(__dirname, '..', 'src', 'data', 'posts.json');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'perplexity/sonar-pro';

const SKIP_DOMAINS = [
  'rrmacademy.org',
  'www.rrmacademy.org',
  'library.rrmacademy.org',
];

// --- API Key (lazy, only fetched if Perplexity fallback is needed) ---

let _apiKey = null;
function getApiKey() {
  if (_apiKey) return _apiKey;
  if (process.env.OPENROUTER_API_KEY) { _apiKey = process.env.OPENROUTER_API_KEY; return _apiKey; }
  try {
    _apiKey = execFileSync('op', ['read', 'op://Automation/OpenClaw OpenRouter API/credential'], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return _apiKey;
  } catch {
    console.error('Warning: Cannot load OpenRouter API key. Perplexity fallback disabled.');
    return null;
  }
}

// --- Extraction ---

function extractAllURLs(content) {
  const matches = content.matchAll(/https?:\/\/[^\s\)\]"'<>]+/g);
  return [...matches].map(m => m[0].replace(/[).,;:!?]+$/, ''));
}

function extractInlinePMIDs(content) {
  const matches = content.matchAll(/PMID[:\s]+(\d{6,9})/gi);
  return [...matches].map(m => `PMID:${m[1]}`);
}

function extractInlineDOIs(content) {
  const matches = content.matchAll(/\bdoi[:\s]+(10\.\d{4,}\/[^\s\)\]"',;]+)/gi);
  return [...matches].map(m => `DOI:${m[1].replace(/[)\].,;:]+$/, '')}`);
}

function isInternal(url) {
  try { return SKIP_DOMAINS.includes(new URL(url).hostname); } catch { return false; }
}

// Classify a citation string into { type, id, url }
function classify(citation) {
  // PubMed URL
  const pmidUrl = citation.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/);
  if (pmidUrl) return { type: 'pmid', id: pmidUrl[1], url: citation };

  // PMC URL (contains PMCID)
  const pmcUrl = citation.match(/pmc\.ncbi\.nlm\.nih\.gov\/articles\/(PMC\d+)/);
  if (pmcUrl) return { type: 'pmc', id: pmcUrl[1], url: citation };

  // Inline PMID
  const pmidInline = citation.match(/^PMID:(\d+)$/);
  if (pmidInline) return { type: 'pmid', id: pmidInline[1], url: null };

  // DOI URL
  const doiUrl = citation.match(/doi\.org\/(10\.\d{4,}\/[^\s\)\]"',;]+)/);
  if (doiUrl) return { type: 'doi', id: doiUrl[1].replace(/[)\].,;:]+$/, ''), url: citation };

  // Inline DOI
  const doiInline = citation.match(/^DOI:(10\..+)$/);
  if (doiInline) return { type: 'doi', id: doiInline[1], url: null };

  // Plain URL
  if (citation.startsWith('http')) return { type: 'url', id: null, url: citation };

  return { type: 'unknown', id: null, url: citation };
}

// --- Tier 1: NCBI API (PMIDs) ---

async function verifyPMID(pmid) {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    const result = data.result?.[pmid];
    if (!result || result.error) return null;
    return `${result.title} (${result.source})`;
  } catch { return null; }
}

// PMC articles: verify via NCBI
async function verifyPMC(pmcid) {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pmc&id=${pmcid.replace('PMC','')}&retmode=json`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    const id = pmcid.replace('PMC', '');
    const result = data.result?.[id];
    if (!result || result.error) return null;
    return `${result.title} (PMC)`;
  } catch { return null; }
}

// --- Tier 2: CrossRef API (DOIs) ---

async function verifyDOI(doi) {
  const crUrl = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  try {
    const resp = await fetch(crUrl, {
      headers: { 'User-Agent': 'RRMAcademy-CitationVerifier/1.0 (mailto:administrator@rrmacademy.org)' },
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const data = await resp.json();
      return data.message?.title?.[0] || '(resolved via CrossRef)';
    }
    // Fallback: doi.org HEAD
    if (resp.status === 404) {
      const doiResp = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, {
        method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000),
      });
      if (doiResp.ok) return '(resolved via doi.org)';
    }
    return null;
  } catch { return null; }
}

// --- Tier 3: Direct HTTP GET ---

async function verifyHTTP(url) {
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RRMAcademy-CitationVerifier/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/pdf,*/*',
      },
    });
    if (resp.status >= 400) return null;

    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const text = await resp.text();
      const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch?.[1]?.trim() || '';
      const lower = text.toLowerCase();

      // Soft 404 detection
      if (
        (lower.includes('page not found') || lower.includes('404 ')) &&
        (title.includes('404') || title.includes('Not Found') || title.includes('Page not found'))
      ) return null;

      // Very short pages with no real content
      if (text.length < 500 && !title) return null;

      return title || 'page exists';
    }
    if (contentType.includes('application/pdf')) return 'PDF document';
    return 'page exists';
  } catch { return null; }
}

// --- Tier 4: Perplexity (final arbiter) ---

async function verifyViaPerplexity(citations, debug) {
  const apiKey = getApiKey();
  if (!apiKey) return citations.map(() => null);

  const citationList = citations.map((c, i) => `${i + 1}. ${c}`).join('\n');

  const prompt = `Verify whether each of the following URLs/citations is REAL (the page exists with real content) or FAKE (fabricated, dead, or nonexistent).

For each, respond with EXACTLY this format:
[number]. REAL or FAKE -- one sentence about what the page contains or why it's fake

Citations:
${citationList}

Be strict. Only mark REAL if you can confirm the page exists. If you cannot access or find it, mark FAKE.`;

  try {
    const resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: 'You are a citation verification assistant. Confirm whether URLs and references point to real, existing content. Be strict: if you cannot confirm it exists, say FAKE.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`    Perplexity API error: HTTP ${resp.status} -- ${body.slice(0, 150)}`);
      return citations.map(() => null);
    }

    const data = await resp.json();
    const answer = data.choices?.[0]?.message?.content || '';
    if (debug) console.log(`\n    [DEBUG] Perplexity response:\n${answer}\n`);

    // Parse results
    return citations.map((_, i) => {
      const num = i + 1;
      const pattern = new RegExp(`${num}\\.\\s*(REAL|FAKE)\\s*[-—:]\\s*(.+)`, 'i');
      const match = answer.match(pattern);
      if (!match) return null;
      return {
        valid: match[1].toUpperCase() === 'REAL',
        detail: match[2].trim(),
      };
    });
  } catch (e) {
    console.error(`    Perplexity error: ${e.message}`);
    return citations.map(() => null);
  }
}

// Rate-limit helper
function rateLimited(fn, delayMs) {
  let last = 0;
  return async (...args) => {
    const now = Date.now();
    const wait = Math.max(0, last + delayMs - now);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    return fn(...args);
  };
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const debug = args.includes('--debug');
  const recordIdx = args.indexOf('--record');
  const slugIdx = args.indexOf('--slug');
  const recordId = recordIdx >= 0 ? args[recordIdx + 1] : null;
  const slugFilter = slugIdx >= 0 ? args[slugIdx + 1] : null;

  let posts;
  try {
    posts = JSON.parse(readFileSync(POSTS_PATH, 'utf8'));
  } catch (e) {
    console.error(`Cannot read ${POSTS_PATH}: ${e.message}`);
    process.exit(1);
  }

  if (recordId) {
    posts = posts.filter(p => p.id === recordId);
    if (!posts.length) { console.error(`No post with id ${recordId}`); process.exit(1); }
  }
  if (slugFilter) {
    posts = posts.filter(p => p.slug === slugFilter || p.slug?.includes(slugFilter));
    if (!posts.length) { console.error(`No post matching slug "${slugFilter}"`); process.exit(1); }
  }

  const verifyPMIDRL = rateLimited(verifyPMID, 150);
  const verifyPMCRL = rateLimited(verifyPMC, 150);
  const verifyDOIRL = rateLimited(verifyDOI, 200);
  const verifyHTTPRL = rateLimited(verifyHTTP, 100);

  let totalChecked = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let failedPosts = [];

  for (const post of posts) {
    const content = post.content || '';
    if (!content) continue;

    // Extract and dedup
    let rawCitations = [
      ...extractAllURLs(content),
      ...extractInlinePMIDs(content),
      ...extractInlineDOIs(content),
    ];
    rawCitations = [...new Set(rawCitations)];

    // Separate internal (skip) from external (verify)
    const external = rawCitations.filter(c => !c.startsWith('http') || !isInternal(c));
    const internalCount = rawCitations.length - external.length;
    if (external.length === 0) continue;

    console.log(`\n--- ${post.title} ---`);
    console.log(`    ${external.length} citation(s) to verify${internalCount ? `, ${internalCount} internal (skipped)` : ''}`);
    totalSkipped += internalCount;

    // Classify each citation
    const items = external.map(c => ({ raw: c, ...classify(c), result: null }));

    // Tier 1-3: API + HTTP cascade
    for (const item of items) {
      let title = null;

      if (item.type === 'pmid') {
        title = await verifyPMIDRL(item.id);
        if (title) item.result = { valid: true, detail: title, tier: 'NCBI' };
      } else if (item.type === 'pmc') {
        title = await verifyPMCRL(item.id);
        if (title) item.result = { valid: true, detail: title, tier: 'NCBI' };
      } else if (item.type === 'doi') {
        title = await verifyDOIRL(item.id);
        if (title) item.result = { valid: true, detail: title, tier: 'CrossRef' };
      }

      // For URLs (and PMC/PMID URLs that failed API), try HTTP GET
      if (!item.result && item.url) {
        title = await verifyHTTPRL(item.url);
        if (title) item.result = { valid: true, detail: title, tier: 'HTTP' };
      }
    }

    // Tier 4: Batch remaining failures to Perplexity
    const unresolved = items.filter(it => !it.result);
    if (unresolved.length > 0) {
      console.log(`    ${unresolved.length} unresolved -- checking with Perplexity...`);
      const pplxResults = await verifyViaPerplexity(unresolved.map(it => it.raw), debug);
      for (let i = 0; i < unresolved.length; i++) {
        const r = pplxResults[i];
        if (r) {
          unresolved[i].result = { valid: r.valid, detail: r.detail, tier: 'Perplexity' };
        } else {
          unresolved[i].result = { valid: false, detail: 'Could not verify (all tiers failed)', tier: 'none' };
        }
      }
    }

    // Report results
    let postFailed = false;
    for (const item of items) {
      totalChecked++;
      const label = item.raw.length > 80 ? item.raw.slice(0, 77) + '...' : item.raw;
      const r = item.result;

      if (r.valid) {
        console.log(`    PASS  ${label}`);
        console.log(`          [${r.tier}] ${r.detail}`);
        totalPassed++;
      } else {
        console.log(`    FAIL  ${label}`);
        console.log(`          [${r.tier}] ${r.detail}`);
        totalFailed++;
        postFailed = true;
      }
    }

    if (postFailed) failedPosts.push(post.title);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Citation verification complete');
  console.log(`  Checked: ${totalChecked}  Passed: ${totalPassed}  Failed: ${totalFailed}  Skipped: ${totalSkipped}`);

  if (failedPosts.length) {
    console.log(`\nFAILED posts (${failedPosts.length}):`);
    failedPosts.forEach(t => console.log(`   - ${t}`));
    console.log('\nDeploy blocked. Fix or remove invalid citations before publishing.');
    process.exit(1);
  } else if (totalChecked > 0) {
    console.log('\nAll citations verified.');
  } else {
    console.log('\nNo citations found to verify.');
  }
}

main();
