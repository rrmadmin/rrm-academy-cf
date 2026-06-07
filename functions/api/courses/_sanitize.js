/**
 * Allowlist HTML sanitizer for reading renditions (spec 3.2).
 * Escape-by-default: any tag token that is not an allowed tag with clean
 * attributes is HTML-escaped, not dropped, so content survives but markup
 * cannot execute. Iterates to a fixpoint so nested-tag smuggling cannot
 * reassemble a tag after one pass. Defense-in-depth under admin-role auth;
 * also applied to AI-generated HTML before any write (spec section 6).
 * Prefixed with _ so CF Pages does not treat it as a route handler.
 */

const ALLOWED_TAGS = new Set([
  'p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'br',
  'a', 'blockquote', 'figure', 'figcaption', 'img', 'aside', 'div',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre', 'span',
]);

// Per-tag attribute allowlist. 'class' is allowed on aside/div/span ONLY for
// the spec 3.2 component classes (filtered to ALLOWED_CLASSES below, so an
// arbitrary class can never target site CSS/JS hooks); href/src are
// protocol-checked below.
const ALLOWED_CLASSES = new Set(['key-insight', 'misconception', 'fun-fact', 'term-card', 'callout']);

const ALLOWED_ATTRS = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  aside: new Set(['class']),
  div: new Set(['class']),
  span: new Set(['class']),
  th: new Set(['scope']),
  td: new Set(['colspan', 'rowspan']),
};

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(value) {
  const v = value.trim();
  if (v.startsWith('/') && !v.startsWith('//')) return true; // site-relative
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Sanitize one tag token. Returns the clean tag string, or null if the token
 *  is not an acceptable tag (caller escapes it). */
function sanitizeTag(token) {
  const m = token.match(/^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)(\/?)>$/);
  if (!m) return null;
  const [, closing, rawName, rawAttrs, selfClose] = m;
  const name = rawName.toLowerCase();
  if (!ALLOWED_TAGS.has(name)) return null;
  if (closing) return `</${name}>`;

  const allowed = ALLOWED_ATTRS[name] || new Set();
  const cleanAttrs = [];
  if (rawAttrs.length > 2000) {
    return `<${name}${selfClose ? ' /' : ''}>`;
  }
  const attrRe = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let am;
  while ((am = attrRe.exec(rawAttrs)) !== null) {
    const attrName = am[1].toLowerCase();
    const attrValue = am[3] !== undefined ? am[3] : am[4];
    if (!allowed.has(attrName)) continue;
    if (attrName.startsWith('on')) continue;
    if ((attrName === 'href' || attrName === 'src') && !safeUrl(attrValue)) continue;
    if (attrValue.includes('<') || attrValue.includes('>')) continue;
    if (attrName === 'class') {
      const kept = attrValue.split(/\s+/).filter((cls) => ALLOWED_CLASSES.has(cls));
      if (kept.length === 0) continue;
      cleanAttrs.push(`class="${kept.join(' ')}"`);
      continue;
    }
    cleanAttrs.push(`${attrName}="${attrValue.replace(/"/g, '&quot;')}"`);
  }
  const attrStr = cleanAttrs.length ? ' ' + cleanAttrs.join(' ') : '';
  return `<${name}${attrStr}${selfClose ? ' /' : ''}>`;
}

function sanitizeOnce(html) {
  return html.replace(/<[^>]*>?/g, (token) => {
    if (!token.endsWith('>')) return escapeHtml(token); // unterminated '<'
    const clean = sanitizeTag(token);
    return clean !== null ? clean : escapeHtml(token);
  });
}

export function sanitizeHtml(html) {
  if (typeof html !== 'string') return '';
  let prev = html;
  for (let i = 0; i < 5; i++) {
    const next = sanitizeOnce(prev);
    if (next === prev) return next;
    prev = next;
  }
  return prev;
}

/** Word count for reading renditions: strip tags, normalize whitespace.
 *  Mirrors the computeWordCount convention (thin-page pattern). */
export function computeWordCount(html) {
  if (typeof html !== 'string') return 0;
  const text = html.replace(/<[^>]*>/g, ' ');
  return text.trim().split(/\s+/).filter(Boolean).length;
}
