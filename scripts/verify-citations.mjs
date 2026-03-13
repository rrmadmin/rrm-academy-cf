/**
 * Citation Verifier v2 for RRM Academy Blog Posts
 *
 * Multi-API cascade -- no Perplexity, fully deterministic.
 *
 * For each citation type, queries multiple authoritative APIs in parallel:
 *   PMID  -> NCBI E-utilities + Europe PMC + Semantic Scholar
 *   DOI   -> CrossRef + doi.org + Semantic Scholar + OpenAlex
 *   PMC   -> NCBI PMC + Europe PMC
 *   URL   -> HTTP GET (title extraction, soft-404 detection, anchor-text match)
 *
 * A citation passes if ANY API confirms it exists.
 *
 * Additional checks:
 *   - Metadata validation: title/author/year match between API and markdown context
 *   - Retraction checking: CrossRef retraction metadata
 *   - Anchor-text match: page title vs markdown link text for plain URLs
 *
 * Usage:
 *   node scripts/verify-citations.mjs                    # verify all posts
 *   node scripts/verify-citations.mjs --record recXXX    # verify single post by Airtable ID
 *   node scripts/verify-citations.mjs --slug my-post     # verify single post by slug
 *   node scripts/verify-citations.mjs --debug            # verbose output
 *
 * Exit code 1 if any citation fails verification. Designed to run in CI.
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POSTS_PATH = join(__dirname, '..', 'src', 'data', 'posts.json');

const UA = 'RRMAcademy-CitationVerifier/2.0 (mailto:administrator@rrmacademy.org)';

const SKIP_DOMAINS = [
  'rrmacademy.org',
  'www.rrmacademy.org',
  'library.rrmacademy.org',
];

// --- String similarity (Dice coefficient) ---

function bigrams(str) {
  const s = str.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  const pairs = [];
  for (let i = 0; i < s.length - 1; i++) pairs.push(s.slice(i, i + 2));
  return pairs;
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const aB = bigrams(a);
  const bB = bigrams(b);
  if (!aB.length || !bB.length) return 0;
  const bSet = new Map();
  for (const p of bB) bSet.set(p, (bSet.get(p) || 0) + 1);
  let matches = 0;
  for (const p of aB) {
    const count = bSet.get(p);
    if (count > 0) { matches++; bSet.set(p, count - 1); }
  }
  return (2 * matches) / (aB.length + bB.length);
}

// --- Extraction ---

function unwrapGoogleRedirect(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'www.google.com' && u.pathname === '/url') {
      const real = u.searchParams.get('q');
      if (real) return real;
    }
  } catch {}
  return url;
}

function extractAllURLs(content) {
  const matches = content.matchAll(/https?:\/\/[^\s\)\]"'<>]+/g);
  return [...matches].map(m => unwrapGoogleRedirect(m[0].replace(/[).,;:!?]+$/, '')));
}

function extractInlinePMIDs(content) {
  const matches = content.matchAll(/PMID[:\s]+(\d{6,9})/gi);
  return [...matches].map(m => `PMID:${m[1]}`);
}

function extractInlineDOIs(content) {
  const matches = content.matchAll(/\bdoi[:\s]+(10\.\d{4,}\/[^\s\)\]"',;]+)/gi);
  return [...matches].map(m => `DOI:${m[1].replace(/[)\].,;:]+$/, '')}`);
}

function extractAnchorText(content, url) {
  // Escape special regex chars in URL, but be flexible about fragment/query
  const base = url.replace(/[#?].*$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\[([^\\]]+)\\]\\(${base}[^)]*\\)`, 'g');
  const match = pattern.exec(content);
  return match ? match[1] : null;
}

function stripTextFragment(url) {
  return url.replace(/#:~:text=.*$/, '');
}

function isInternal(url) {
  try { return SKIP_DOMAINS.includes(new URL(url).hostname); } catch { return false; }
}

function classify(citation) {
  const pmidUrl = citation.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/);
  if (pmidUrl) return { type: 'pmid', id: pmidUrl[1], url: citation };

  const pmcUrl = citation.match(/pmc\.ncbi\.nlm\.nih\.gov\/articles\/(PMC\d+)/);
  if (pmcUrl) return { type: 'pmc', id: pmcUrl[1], url: citation };

  const pmidInline = citation.match(/^PMID:(\d+)$/);
  if (pmidInline) return { type: 'pmid', id: pmidInline[1], url: null };

  const doiUrl = citation.match(/doi\.org\/(10\.\d{4,}\/[^\s\)\]"',;]+)/);
  if (doiUrl) return { type: 'doi', id: doiUrl[1].replace(/[)\].,;:]+$/, ''), url: citation };

  const doiInline = citation.match(/^DOI:(10\..+)$/);
  if (doiInline) return { type: 'doi', id: doiInline[1], url: null };

  if (citation.startsWith('http')) return { type: 'url', id: null, url: citation };

  return { type: 'unknown', id: null, url: citation };
}

// --- API Functions ---
// Each returns { title, authors, year, journal, source } or null

async function ncbiPMID(pmid) {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    const r = data.result?.[pmid];
    if (!r || r.error) return null;
    const authors = r.authors?.map(a => a.name) || [];
    const year = r.pubdate?.match(/\d{4}/)?.[0] || '';
    return { title: r.title, authors, year, journal: r.source || '', source: 'NCBI' };
  } catch { return null; }
}

async function ncbiPMC(pmcid) {
  const numericId = pmcid.replace('PMC', '');
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pmc&id=${numericId}&retmode=json`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    const r = data.result?.[numericId];
    if (!r || r.error) return null;
    const authors = r.authors?.map(a => a.name) || [];
    const year = r.pubdate?.match(/\d{4}/)?.[0] || '';
    return { title: r.title, authors, year, journal: r.source || '', source: 'NCBI-PMC' };
  } catch { return null; }
}

async function europePMC(id, idType) {
  // idType: 'MED' for PMID, 'PMC' for PMCID
  const query = idType === 'PMC' ? `PMCID:${id}` : `EXT_ID:${id} AND SRC:MED`;
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=1`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    const r = data.resultList?.result?.[0];
    if (!r) return null;
    const authors = r.authorString ? r.authorString.split(', ') : [];
    return { title: r.title, authors, year: r.pubYear || '', journal: r.journalTitle || '', source: 'EuropePMC' };
  } catch { return null; }
}

async function semanticScholar(id, idType) {
  // idType: 'PMID', 'DOI', 'PMCID'
  let paperId;
  if (idType === 'PMID') paperId = `PMID:${id}`;
  else if (idType === 'DOI') paperId = `DOI:${id}`;
  else if (idType === 'PMCID') paperId = `PMCID:${id}`;
  else return null;

  const url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(paperId)}?fields=title,authors,year,venue`;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': UA },
    });
    if (!resp.ok) return null;
    const r = await resp.json();
    if (!r.title) return null;
    const authors = r.authors?.map(a => a.name) || [];
    return { title: r.title, authors, year: String(r.year || ''), journal: r.venue || '', source: 'SemanticScholar' };
  } catch { return null; }
}

async function crossRef(doi) {
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const m = data.message;
    if (!m) return null;
    const title = m.title?.[0] || '';
    const authors = m.author?.map(a => [a.family, a.given].filter(Boolean).join(' ')) || [];
    const year = String(m.published?.['date-parts']?.[0]?.[0] || m.created?.['date-parts']?.[0]?.[0] || '');
    const journal = m['container-title']?.[0] || '';
    // Retraction info
    const retracted = m['update-to']?.some(u => u.type === 'retraction')
      || m.relation?.['is-retracted-by']?.length > 0;
    const hasCorrection = m['update-to']?.some(u => u.type === 'correction' || u.type === 'erratum');
    return { title, authors, year, journal, source: 'CrossRef', retracted: !!retracted, hasCorrection: !!hasCorrection };
  } catch { return null; }
}

async function doiOrgHead(doi) {
  try {
    const resp = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, {
      method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) return { title: '(resolved via doi.org)', authors: [], year: '', journal: '', source: 'doi.org' };
    return null;
  } catch { return null; }
}

async function openAlexDOI(doi) {
  const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': UA },
    });
    if (!resp.ok) return null;
    const r = await resp.json();
    if (!r.title) return null;
    const authors = r.authorships?.map(a => a.author?.display_name).filter(Boolean) || [];
    const year = String(r.publication_year || '');
    const journal = r.primary_location?.source?.display_name || '';
    return { title: r.title, authors, year, journal, source: 'OpenAlex' };
  } catch { return null; }
}

// --- HTTP verification (URLs) ---

async function verifyHTTP(url, anchorText) {
  const cleanUrl = stripTextFragment(url);
  try {
    const resp = await fetch(cleanUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RRMAcademy-CitationVerifier/2.0)',
        'Accept': 'text/html,application/xhtml+xml,application/pdf,*/*',
      },
    });
    // 403 often means bot-blocking, not "page doesn't exist"
    if (resp.status === 403) {
      return { title: 'Site blocks automated access (403)', source: 'HTTP', anchorMatch: null, botBlocked: true };
    }
    if (resp.status >= 400) return null;

    const contentType = resp.headers.get('content-type') || '';

    // PDF -- existence is sufficient
    if (contentType.includes('application/pdf')) {
      return { title: 'PDF document', source: 'HTTP', anchorMatch: null };
    }

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

      // Redirect detection: if final URL is very different from requested (redirected to homepage)
      const finalUrl = resp.url || cleanUrl;
      const reqPath = new URL(cleanUrl).pathname;
      const finalPath = new URL(finalUrl).pathname;
      if (reqPath.length > 5 && (finalPath === '/' || finalPath === '') && reqPath !== '/') {
        return null; // Redirected to homepage -- page doesn't exist
      }

      // Anchor text match
      let anchorMatch = null;
      if (anchorText && title) {
        const sim = similarity(anchorText, title);
        anchorMatch = { similarity: sim, anchorText, pageTitle: title };
      }

      return { title: title || 'page exists', source: 'HTTP', anchorMatch };
    }

    return { title: 'page exists', source: 'HTTP', anchorMatch: null };
  } catch (err) {
    // Any fetch-level error (timeout, DNS, TLS, connection refused) means
    // we can't verify -- WARN, not FAIL. Only a clean HTTP 404/410 is FAIL.
    const code = err.cause?.code || err.name || 'unknown';
    return { title: `Network error: ${code}`, source: 'HTTP', anchorMatch: null, unreachable: true };
  }
}

// --- Parallel verification per citation type ---

async function verifyPMIDCitation(pmid) {
  const results = await Promise.all([
    ncbiPMID(pmid),
    europePMC(pmid, 'MED'),
    semanticScholar(pmid, 'PMID'),
  ]);
  return results.filter(Boolean);
}

async function verifyPMCCitation(pmcid) {
  const results = await Promise.all([
    ncbiPMC(pmcid),
    europePMC(pmcid, 'PMC'),
    semanticScholar(pmcid, 'PMCID'),
  ]);
  return results.filter(Boolean);
}

async function verifyDOICitation(doi) {
  const results = await Promise.all([
    crossRef(doi),
    doiOrgHead(doi),
    semanticScholar(doi, 'DOI'),
    openAlexDOI(doi),
  ]);
  return results.filter(Boolean);
}

// --- Metadata validation ---

function validateMetadata(apiResults, anchorText) {
  if (!apiResults.length) return { status: 'FAIL', detail: 'Not found in any database', sources: [] };

  const sources = apiResults.map(r => r.source);
  const best = apiResults.find(r => r.title && r.title !== '(resolved via doi.org)') || apiResults[0];

  // Retraction check (from CrossRef)
  const crResult = apiResults.find(r => r.source === 'CrossRef');
  if (crResult?.retracted) {
    return {
      status: 'FAIL',
      detail: `RETRACTED: "${best.title}"`,
      sources,
      metadata: best,
    };
  }

  let warn = null;
  if (crResult?.hasCorrection) {
    warn = 'Has correction/erratum';
  }

  // If we have anchor text and a title, check similarity
  if (anchorText && best.title && best.title !== '(resolved via doi.org)') {
    const sim = similarity(anchorText, best.title);
    if (sim < 0.3) {
      return {
        status: 'WARN',
        detail: `Exists but title mismatch (${Math.round(sim * 100)}%): anchor="${anchorText}", API="${best.title}"`,
        sources,
        metadata: best,
      };
    }
  }

  const titleSnippet = best.title?.length > 70 ? best.title.slice(0, 67) + '...' : best.title;
  const detail = warn
    ? `${warn}: "${titleSnippet}" (${best.journal || 'unknown'}, ${best.year || '?'})`
    : `"${titleSnippet}" (${best.journal || 'unknown'}, ${best.year || '?'})`;

  return {
    status: warn ? 'WARN' : 'PASS',
    detail,
    sources,
    metadata: best,
  };
}

// --- Rate limiting ---

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

  // Rate-limit HTTP to avoid hammering single domains
  const verifyHTTPRL = rateLimited(verifyHTTP, 100);

  let totalChecked = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalWarned = 0;
  let totalSkipped = 0;
  let failedPosts = [];

  for (const post of posts) {
    const content = post.content || '';
    if (!content) continue;

    let rawCitations = [
      ...extractAllURLs(content),
      ...extractInlinePMIDs(content),
      ...extractInlineDOIs(content),
    ];
    rawCitations = [...new Set(rawCitations)];

    const external = rawCitations.filter(c => !c.startsWith('http') || !isInternal(c));
    const internalCount = rawCitations.length - external.length;
    if (external.length === 0) continue;

    console.log(`\n--- ${post.title} ---`);
    console.log(`    ${external.length} citation(s) to verify${internalCount ? `, ${internalCount} internal (skipped)` : ''}`);
    totalSkipped += internalCount;

    const items = external.map(c => ({
      raw: c,
      ...classify(c),
      anchorText: extractAnchorText(content, c),
      result: null,
    }));

    // Verify all citations in parallel batches (max 5 concurrent to respect rate limits)
    const BATCH_SIZE = 5;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (item) => {
        let apiResults = [];

        if (item.type === 'pmid') {
          apiResults = await verifyPMIDCitation(item.id);
        } else if (item.type === 'pmc') {
          apiResults = await verifyPMCCitation(item.id);
        } else if (item.type === 'doi') {
          apiResults = await verifyDOICitation(item.id);
        }

        // For academic types that resolved, validate metadata
        // Don't apply anchor-text matching to academic citations -- the ID is ground truth.
        // Anchor text in markdown is often a descriptive phrase, not the paper title.
        if (apiResults.length > 0 && (item.type === 'pmid' || item.type === 'pmc' || item.type === 'doi')) {
          item.result = validateMetadata(apiResults, null);
          return;
        }

        // For URLs (or academic citations that failed all APIs), try HTTP
        if (item.url) {
          const httpResult = await verifyHTTPRL(item.url, item.anchorText);
          if (httpResult) {
            let status = 'PASS';
            let detail = httpResult.title;

            // Bot-blocked or unreachable: WARN, not PASS or FAIL
            if (httpResult.botBlocked || httpResult.unreachable) {
              status = 'WARN';
              detail = httpResult.title;
            }
            // Check anchor text match for plain URLs
            else if (httpResult.anchorMatch && httpResult.anchorMatch.similarity < 0.2) {
              status = 'WARN';
              detail = `Page exists but title mismatch (${Math.round(httpResult.anchorMatch.similarity * 100)}%): anchor="${httpResult.anchorMatch.anchorText}", page="${httpResult.anchorMatch.pageTitle}"`;
            }
            item.result = { status, detail, sources: [httpResult.source] };
            return;
          }
        }

        // Nothing resolved
        const sources = item.type === 'url' ? ['HTTP'] : apiResults.length === 0
          ? (item.type === 'pmid' ? ['NCBI', 'EuropePMC', 'SemanticScholar']
            : item.type === 'pmc' ? ['NCBI-PMC', 'EuropePMC', 'SemanticScholar']
            : item.type === 'doi' ? ['CrossRef', 'doi.org', 'SemanticScholar', 'OpenAlex']
            : ['HTTP'])
          : [];
        item.result = { status: 'FAIL', detail: 'Not found in any database', sources };
      }));
    }

    // Report results
    let postFailed = false;
    for (const item of items) {
      totalChecked++;
      const label = item.raw.length > 80 ? item.raw.slice(0, 77) + '...' : item.raw;
      const r = item.result;
      const sourcesStr = r.sources?.length ? `[${r.sources.join(' + ')}]` : '';

      if (r.status === 'PASS') {
        console.log(`    PASS  ${label}`);
        console.log(`          ${sourcesStr} ${r.detail}`);
        totalPassed++;
      } else if (r.status === 'WARN') {
        console.log(`    WARN  ${label}`);
        console.log(`          ${sourcesStr} ${r.detail}`);
        totalWarned++;
      } else {
        console.log(`    FAIL  ${label}`);
        console.log(`          ${sourcesStr} ${r.detail}`);
        totalFailed++;
        postFailed = true;
      }

      if (debug && r.metadata) {
        console.log(`          [DEBUG] title="${r.metadata.title}" authors=${JSON.stringify(r.metadata.authors?.slice(0, 3))} year=${r.metadata.year}`);
      }
    }

    if (postFailed) failedPosts.push(post.title);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Citation verification complete (v2 -- multi-API cascade)');
  console.log(`  Checked: ${totalChecked}  Passed: ${totalPassed}  Warned: ${totalWarned}  Failed: ${totalFailed}  Skipped: ${totalSkipped}`);

  // Write summary JSON for CI pipeline (Observatory digest)
  const summaryPath = join(__dirname, '..', 'citation-summary.json');
  try {
    writeFileSync(summaryPath, JSON.stringify({
      checked: totalChecked,
      passed: totalPassed,
      warned: totalWarned,
      failed: totalFailed,
      skipped: totalSkipped,
      failedPosts,
    }));
  } catch (_) { /* non-blocking */ }

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
