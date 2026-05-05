#!/usr/bin/env node
// Capture HTTP layer baseline: status + headers + body sha + key shape
import { writeFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';

const URLS = [
  // Pillars + key static
  '/', '/about', '/what-is-rrm/', '/naprotechnology/', '/neofertility/', '/femm/',
  '/common-questions-about-rrm/', '/save-the-uterus-club/', '/donate/',
  '/contact', '/medical-disclaimer', '/privacy-policy', '/terms-of-use',
  '/policies/', '/policies/editorial', '/policies/fact-checking', '/policies/corrections',
  '/schedule-with-dr-whittaker', '/openapi', '/linkinbio',
  // Tools
  '/ask/', '/ivf-success-calculator/', '/endo-survey/',
  // Auth surface
  '/login', '/signup', '/forgot-password',
  // Dynamic listings (first page)
  '/library/', '/library/page/2/', '/library/page/5/',
  '/commentary/', '/commentary/page/2/',
  '/courses/', '/faqs/', '/glossary/', '/guides/',
  '/community/', '/partners/',
  // Public APIs
  '/api/auth/session',
  '/api/courses',
  '/api/faqs',
  '/api/glossary/terms',
  '/api/blog/posts',
  '/api/search/semantic?q=endometriosis',
  '/api/search/semantic?q=napro',
  '/api/search/semantic?q=ovulation',
  // Agent surface (already captured separately, keep here for status diff)
  '/llms.txt', '/robots.txt', '/sitemap-index.xml',
  '/library/rss.xml', '/commentary/rss.xml',
  // Sample dynamic items (stable URLs)
  '/library/whittaker-2024-noa-prevalence/',
  '/commentary/the-rrm-research-library-just-got-better/',
  '/glossary/restorative-reproductive-medicine/',
  '/glossary/naprotechnology/',
  '/faqs/what-is-rrm/',
];

const BASE = 'https://rrmacademy.org';
const out = [];

for (const path of URLS) {
  const url = BASE + path;
  try {
    const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'arise-baseline/1.0' } });
    const body = await res.text();
    const sha = createHash('sha256').update(body).digest('hex').slice(0, 16);
    const headers = {};
    for (const [k, v] of res.headers.entries()) {
      if (['content-type', 'content-length', 'cache-control', 'cf-cache-status', 'etag', 'location', 'x-robots-tag'].includes(k.toLowerCase())) {
        headers[k.toLowerCase()] = v;
      }
    }
    let shape = null;
    if ((headers['content-type'] || '').includes('application/json')) {
      try {
        const j = JSON.parse(body);
        shape = Array.isArray(j) ? `array[${j.length}]` : (typeof j === 'object' && j ? Object.keys(j).sort().join(',') : typeof j);
      } catch { shape = 'invalid-json'; }
    }
    out.push({ url: path, status: res.status, sha256: sha, size: body.length, headers, shape });
    process.stderr.write(`${res.status} ${path} sha=${sha} size=${body.length}\n`);
  } catch (e) {
    out.push({ url: path, error: String(e) });
    process.stderr.write(`ERR ${path}: ${e.message}\n`);
  }
}

writeFileSync(process.argv[2] || '/dev/stdout', JSON.stringify(out, null, 2));
