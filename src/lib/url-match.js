// Pure, DOM-free matcher for the 404 "Did you mean?" suggestions.
// Imported by src/pages/404.astro (client bundle) and test/url-match.test.js.

export const THRESHOLD = 0.72; // minimum score to surface a suggestion
export const PREFIX_FLOOR = 0.82; // floor when one path is a prefix of the other
export const MIN_PREFIX_LEN = 3; // prefix floor applies only when shared prefix >= 3 chars

export function normalize(path) {
  if (typeof path !== 'string' || !path) return '';
  // strip query/hash on the RAW input, before decoding, so an encoded %23/%3F inside a
  // slug is treated as a literal slug character rather than a delimiter.
  let p = path.split('?')[0].split('#')[0];
  try {
    p = decodeURIComponent(p);
  } catch {
    // malformed percent-encoding: keep the stripped raw string
  }
  return p.toLowerCase().replace(/^\/+/, '').replace(/\/+$/, '');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[bl];
}

export function score(badPath, candidatePath) {
  const b = normalize(badPath);
  const c = normalize(candidatePath);
  if (!b || !c) return 0;
  const maxLen = Math.max(b.length, c.length);
  let s = maxLen === 0 ? 0 : 1 - levenshtein(b, c) / maxLen;
  if ((c.startsWith(b) || b.startsWith(c)) && Math.min(b.length, c.length) >= MIN_PREFIX_LEN) {
    s = Math.max(s, PREFIX_FLOOR);
  }
  return Math.min(s, 1);
}

export function bestMatches(badPath, index, { threshold = THRESHOLD, limit = 3 } = {}) {
  const nb = normalize(badPath);
  if (!nb || !Array.isArray(index)) return [];
  const scored = [];
  for (const entry of index) {
    if (!entry || typeof entry.path !== 'string') continue;
    if (normalize(entry.path) === nb) continue; // never suggest the path that 404'd
    const s = score(badPath, entry.path);
    if (s >= threshold) scored.push({ path: entry.path, title: entry.title, score: s });
  }
  const rawSim = (candNorm) =>
    1 - levenshtein(nb, candNorm) / Math.max(nb.length, candNorm.length || 1);
  scored.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    const rx = rawSim(normalize(x.path));
    const ry = rawSim(normalize(y.path));
    if (ry !== rx) return ry - rx;
    const lx = normalize(x.path).length;
    const ly = normalize(y.path).length;
    if (lx !== ly) return lx - ly;
    return x.path < y.path ? -1 : x.path > y.path ? 1 : 0;
  });
  return scored.slice(0, limit);
}
