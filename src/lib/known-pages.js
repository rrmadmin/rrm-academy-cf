// SSOT for the 404 "Did you mean?" suggestion index. Shared by src/pages/404.astro
// (build-time index) and scripts/check-suggest-coverage.mjs (CI guard).

// Display titles for slugs whose pretty name differs from a titlecased slug.
// Every brand/acronym slug MUST have an entry (the titlecase fallback would mis-case it).
export const TITLE_OVERRIDES = {
  'what-is-rrm': 'What is RRM',
  naprotechnology: 'NaProTechnology',
  femm: 'FEMM',
  neofertility: 'NeoFertility',
  faqs: 'FAQs',
  pcos: 'PCOS',
  'common-questions-about-rrm': 'Common Questions About RRM',
  'save-the-uterus-club': 'Save the Uterus Club',
  'endo-survey': 'Endometriosis Self-Survey',
  'art-registries-and-codes': 'ART Registries and Codes',
};

// Depth-1 routes that exist but are NOT public recovery destinations (auth, noindex,
// developer/utility). The CI guard (check-suggest-coverage.mjs) fails the build if a
// noindex page is missing from this set.
export const PRIVATE_EXCLUDE = new Set([
  'admin',
  'dev',
  'ivf-success-calculator',
  'account',
  'login',
  'signup',
  'forgot-password',
  'reset-password',
  'ask',
  'saved',
  'providers',
  'community',
  'agent-auth',
  'webhooks',
  'openapi',
  'connect',
  'mcp',
  'linkinbio',
  '500',
]);

export function deriveRoute(fileKey) {
  let rel = fileKey.replace(/^.*\/src\/pages\//, '').replace(/^src\/pages\//, '');
  if (rel === 'index.astro') return '/';
  rel = rel.replace(/\/index\.astro$/, '').replace(/\.astro$/, '');
  return '/' + rel;
}

export function routeSlug(route) {
  return route.replace(/^\/+/, '').split('/')[0];
}

export function titleFor(route) {
  const slug = routeSlug(route);
  if (TITLE_OVERRIDES[slug]) return TITLE_OVERRIDES[slug];
  return slug
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function isSuggestable(fileKey) {
  if (fileKey.includes('[')) return false; // dynamic route
  const route = deriveRoute(fileKey);
  if (route === '/') return false;
  const segs = route.replace(/^\/+/, '').split('/');
  if (segs.some((s) => s.startsWith('_'))) return false; // partial/private
  const slug = segs[0];
  if (slug === '404') return false;
  if (PRIVATE_EXCLUDE.has(slug)) return false;
  return true;
}

export function buildKnownPages(fileKeys) {
  const seen = new Set();
  const pages = [];
  for (const key of fileKeys) {
    if (!isSuggestable(key)) continue;
    const route = deriveRoute(key);
    if (seen.has(route)) continue;
    seen.add(route);
    pages.push({ path: route, title: titleFor(route) });
  }
  pages.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return pages;
}
