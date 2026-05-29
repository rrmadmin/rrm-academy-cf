// Fails the build if a depth-1 src/pages route renders `noindex` but is still suggestable.
// Run by deploy.yml. Pairs with src/lib/known-pages.js (the SSOT it validates).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSuggestable, deriveRoute, routeSlug } from '../src/lib/known-pages.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pagesDir = join(root, 'src', 'pages');

function depth1Keys() {
  const keys = [];
  for (const name of readdirSync(pagesDir)) {
    const full = join(pagesDir, name);
    const st = statSync(full);
    if (st.isFile() && name.endsWith('.astro')) {
      keys.push('/src/pages/' + name);
    } else if (st.isDirectory()) {
      try {
        if (statSync(join(full, 'index.astro')).isFile()) {
          keys.push('/src/pages/' + name + '/index.astro');
        }
      } catch {
        // no index.astro in this dir; not a depth-1 route
      }
    }
  }
  return keys;
}

function rendersNoindex(fileKey) {
  const src = readFileSync(join(root, fileKey.replace(/^\//, '')), 'utf8');
  return /\bnoindex\b/.test(src);
}

const keys = depth1Keys();
const problems = [];
for (const key of keys) {
  if (key.includes('[')) continue;
  const route = deriveRoute(key);
  if (route === '/') continue;
  const slug = routeSlug(route);
  if (slug === '404' || slug.startsWith('_')) continue;
  if (rendersNoindex(key) && isSuggestable(key)) {
    problems.push(
      `${route} renders noindex but is suggestable; add "${slug}" to PRIVATE_EXCLUDE in src/lib/known-pages.js`
    );
  }
}

if (problems.length) {
  console.error('check-suggest-coverage: FAIL');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`check-suggest-coverage: OK (${keys.length} depth-1 pages checked)`);
