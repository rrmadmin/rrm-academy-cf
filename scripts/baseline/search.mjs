#!/usr/bin/env node
// Run top-N queries through /api/search/semantic; record ordered result IDs
import { readFileSync, writeFileSync } from 'fs';

const tsv = readFileSync(process.argv[2], 'utf8').trim().split('\n');
const queries = tsv.map(l => l.split('\t')[1]).filter(Boolean).slice(0, 50);
const out = [];

for (const q of queries) {
  try {
    const url = `https://rrmacademy.org/api/search/semantic?q=${encodeURIComponent(q)}`;
    const t0 = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': 'arise-baseline/1.0' } });
    const ms = Date.now() - t0;
    const body = await res.json();
    const results = (body.results || []).map(r => ({
      url: r.url,
      type: r.type,
      score: r.score
    }));
    out.push({ query: q, status: res.status, latency_ms: ms, count: results.length, results });
    process.stderr.write(`${res.status} ${ms}ms "${q.slice(0,40)}" -> ${results.length}\n`);
    await new Promise(r => setTimeout(r, 3500));  // gentle rate
  } catch (e) {
    out.push({ query: q, error: String(e) });
  }
}
writeFileSync(process.argv[3] || '/dev/stdout', JSON.stringify(out, null, 2));
