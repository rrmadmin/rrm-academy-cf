/**
 * Email validation layers (free, no external APIs):
 * 1. Structural cleanup (regex fixes for common formatting issues)
 * 2. Syntax check
 * 3. Exact-match typo map (known misspellings)
 * 4. Disposable domain blocklist (~5,200 domains)
 * 5. Provider TLD correction (@gmail.net -> @gmail.com)
 * 6. Sift3 fuzzy domain matching (catches novel typos)
 * 7. MX record check via Cloudflare DoH
 *
 * Typo detection inspired by:
 *   - email-spell-checker (MIT) — Sift3 fuzzy distance
 *   - correct_email_typos (ISC) — structural regex patterns
 */

import { DISPOSABLE_DOMAINS } from './_disposable-domains.js';

// ── Known-good domains for fuzzy matching ──────────────────────────────
// Combined from email-spell-checker + our own observations
const KNOWN_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'aim.com',
  'protonmail.com', 'proton.me', 'pm.me',
  'comcast.net', 'sbcglobal.net', 'att.net', 'verizon.net',
  'cox.net', 'charter.net', 'earthlink.net', 'bellsouth.net',
  'optonline.net', 'rocketmail.com',
  'zoho.com', 'yandex.com', 'hey.com', 'fastmail.com',
  'mail.com', 'gmx.com', 'web.de', 'qq.com',
  'sky.com', 'btinternet.com', 'rogers.com', 'shaw.ca',
  'sympatico.ca', 'telus.net', 'xtra.co.nz', 'optusnet.com.au',
];

const KNOWN_TLDS = [
  'com', 'net', 'org', 'edu', 'gov', 'mil',
  'co', 'co.uk', 'co.jp', 'co.nz', 'co.il',
  'com.au', 'com.br', 'com.tw',
  'ca', 'uk', 'de', 'fr', 'it', 'es', 'nl', 'se', 'no', 'dk',
  'ru', 'jp', 'kr', 'cn', 'au', 'nz', 'ie', 'at', 'be', 'ch',
  'eu', 'us', 'me', 'io', 'ai', 'app', 'dev',
];

const KNOWN_SLDS = ['yahoo', 'hotmail', 'mail', 'live', 'outlook', 'gmail'];

// ── Exact-match typo map (fast path) ──────────────────────────────────
const DOMAIN_TYPOS = {
  'gmail.com': ['gmial.com', 'gmal.com', 'gmai.com', 'gmali.com', 'gamil.com', 'gnail.com', 'gmaill.com', 'gmil.com', 'gmail.co', 'gmail.cm', 'gmsil.com', 'gmqil.com', 'gmail.con', 'gmail.cim', 'gmail.vom', 'gmail.xom', 'gmaik.com', 'gmaikl.com', 'gmailcom', 'g]mail.com', 'gmail.col', 'gmail.conm', 'gmail.comm', 'gmail.cpm', 'gmail.ocm', 'gmail.coom'],
  'yahoo.com': ['yaho.com', 'yahooo.com', 'yhoo.com', 'yhaoo.com', 'yahoo.co', 'yahoo.cm', 'yahoo.con', 'yaoo.com', 'tahoo.com', 'uahoo.com'],
  'hotmail.com': ['hotmal.com', 'hotmai.com', 'hotmial.com', 'hotamil.com', 'hotmail.co', 'hotmail.cm', 'hotmail.con', 'hotmaill.com', 'htmail.com', 'htomail.com', 'hotmail.om', 'hotmwil.com', 'homail.com', 'hotmali.com', 'hotmeil.com'],
  'outlook.com': ['outlok.com', 'outloo.com', 'outlool.com', 'outllook.com', 'outlook.co', 'outlook.cm', 'outlook.con', 'putlook.com', 'outtlook.com'],
  'icloud.com': ['iclod.com', 'icloud.co', 'icloud.cm', 'iclould.com', 'icloud.con', 'icoud.com', 'iclous.com', 'icluod.com'],
  'aol.com': ['aol.co', 'aol.cm', 'aol.con', 'ao.com', 'aoll.com'],
  'protonmail.com': ['protonmal.com', 'protonmai.com', 'protonmail.co', 'protonmail.cm', 'protonmail.con'],
  'proton.me': ['proton.m', 'proton.mr', 'protn.me'],
  'comcast.net': ['comcast.ner', 'comcast.met', 'comcast.ne', 'comcat.net', 'comcst.net'],
  'live.com': ['live.co', 'live.cm', 'live.con'],
  'msn.com': ['msn.co', 'msn.cm', 'msn.con'],
  'att.net': ['att.ner', 'att.met', 'att.ne'],
  'sbcglobal.net': ['sbcglobal.ner', 'sbcglobal.ne', 'sbcglobal.met'],
  'verizon.net': ['verizon.ner', 'verizon.ne', 'verizon.met'],
  'me.com': ['me.co', 'me.cm'],
  'mac.com': ['mac.co', 'mac.cm'],
};

// Build reverse lookup: typo -> correct domain
export const TYPO_CORRECTIONS = new Map();
for (const [correct, typos] of Object.entries(DOMAIN_TYPOS)) {
  for (const typo of typos) {
    TYPO_CORRECTIONS.set(typo, correct);
  }
}

// ── Sift3 string distance (from email-spell-checker, MIT) ─────────────
function sift3Distance(s1, s2) {
  if (!s1 || s1.length === 0) return s2 ? s2.length : 0;
  if (!s2 || s2.length === 0) return s1.length;

  let c = 0;
  let offset1 = 0;
  let offset2 = 0;
  let lcs = 0;
  const maxOffset = 5;

  while (c + offset1 < s1.length && c + offset2 < s2.length) {
    if (s1.charAt(c + offset1) === s2.charAt(c + offset2)) {
      lcs++;
    } else {
      offset1 = 0;
      offset2 = 0;
      for (let i = 0; i < maxOffset; i++) {
        if (c + i < s1.length && s1.charAt(c + i) === s2.charAt(c)) {
          offset1 = i;
          break;
        }
        if (c + i < s2.length && s1.charAt(c) === s2.charAt(c + i)) {
          offset2 = i;
          break;
        }
      }
    }
    c++;
  }
  return (s1.length + s2.length) / 2 - lcs;
}

/**
 * Find the closest domain from a list using Sift3 distance.
 * Returns the domain if within threshold, or null.
 */
function findClosestDomain(domain, domains, threshold) {
  let minDist = Infinity;
  let closest = null;

  for (const d of domains) {
    if (domain === d) return null; // exact match = no suggestion
    const dist = sift3Distance(domain, d);
    if (dist < minDist) {
      minDist = dist;
      closest = d;
    }
  }

  return minDist <= threshold ? closest : null;
}

/**
 * Fuzzy domain suggestion using Sift3 distance.
 * Checks full domain first, then SLD + TLD independently.
 */
function suggestDomain(domain) {
  // Try full domain match (threshold 2)
  const closestFull = findClosestDomain(domain, KNOWN_DOMAINS, 2);
  if (closestFull) return closestFull;

  // Parse SLD and TLD
  const parts = domain.split('.');
  if (parts.length < 2) return null;
  const sld = parts[0];
  const tld = parts.slice(1).join('.');

  // Check SLD and TLD independently
  const closestSld = findClosestDomain(sld, KNOWN_SLDS, 2);
  const closestTld = findClosestDomain(tld, KNOWN_TLDS, 2);

  let corrected = domain;
  let changed = false;

  if (closestSld && closestSld !== sld) {
    corrected = corrected.replace(sld, closestSld);
    changed = true;
  }
  if (closestTld && closestTld !== tld) {
    corrected = corrected.replace(new RegExp(escapeRegExp(tld) + '$'), closestTld);
    changed = true;
  }

  return changed ? corrected : null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Structural email cleanup (from correct_email_typos, ISC) ──────────
function cleanupEmail(email) {
  let e = email;
  // Strip mailto: prefix
  e = e.replace(/^mailto:/g, '');
  // Remove invalid chars (quotes, backslashes, hashes, smart quotes)
  e = e.replace(/(\s|#|'|\u2018|\u2019|\\)*/g, '');
  // Fix double @@ and stray periods around @
  e = e.replace('@@', '@');
  e = e.replace(/(\.@|@\.)/g, '@');
  // Fix doubled/trailing commas and dots
  e = e.replace(/(,|\.\.|>)/g, '.');
  // Fix transposed periods: c.om -> .com, n.et -> .net
  e = e.replace(/c\.om$/g, '.com');
  e = e.replace(/n\.et$/g, '.net');
  // Add a period if they forgot it: gmailcom -> gmail.com
  e = e.replace(/([^.])(com|org|net|edu)$/g, '$1.$2');
  return e;
}

// ── Provider-aware TLD correction ─────────────────────────────────────
// If someone types @gmail.net or @yahoo.org, fix to the canonical TLD
const PROVIDER_CANONICAL_TLD = {
  gmail: 'com', googlemail: 'com', hotmail: 'com', yahoo: 'com',
  aol: 'com', icloud: 'com', outlook: 'com',
};

function fixProviderTld(domain) {
  const parts = domain.split('.');
  if (parts.length < 2) return domain;
  const sld = parts[0];
  const tld = parts.slice(1).join('.');
  const canonical = PROVIDER_CANONICAL_TLD[sld];
  if (canonical && tld !== canonical && KNOWN_TLDS.includes(tld)) {
    return `${sld}.${canonical}`;
  }
  return domain;
}

/**
 * Validate an email address through multiple layers.
 * Returns { valid, error, suggestion } where:
 * - valid: boolean
 * - error: string if invalid (user-facing message)
 * - suggestion: string if we detected a likely typo
 */
export async function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required.' };
  }

  // Layer 0: Structural cleanup
  email = cleanupEmail(email.trim().toLowerCase());

  // Layer 1: Syntax
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }

  const [local, domain] = email.split('@');
  if (!local || !domain) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }

  // Layer 2: Exact-match typo map (fast, before disposable check so
  // common typos like gmial.com get "did you mean" not "disposable")
  const exactCorrection = TYPO_CORRECTIONS.get(domain);
  if (exactCorrection) {
    const suggested = `${local}@${exactCorrection}`;
    return { valid: false, error: `Did you mean ${suggested}?`, suggestion: suggested };
  }

  // Layer 3: Disposable domain check
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { valid: false, error: 'Disposable email addresses are not allowed. Please use a permanent email.' };
  }

  // Layer 4: Provider TLD correction (@gmail.net -> @gmail.com)
  const tldFixed = fixProviderTld(domain);
  if (tldFixed !== domain) {
    const suggested = `${local}@${tldFixed}`;
    return { valid: false, error: `Did you mean ${suggested}?`, suggestion: suggested };
  }

  // Layer 5: Sift3 fuzzy domain matching (catches novel typos)
  const fuzzySuggestion = suggestDomain(domain);
  if (fuzzySuggestion) {
    const suggested = `${local}@${fuzzySuggestion}`;
    return { valid: false, error: `Did you mean ${suggested}?`, suggestion: suggested };
  }

  // Layer 6: MX record check via Cloudflare DoH
  const hasMx = await checkMxRecord(domain);
  if (!hasMx) {
    return { valid: false, error: 'This email domain does not appear to accept mail. Please check for typos.' };
  }

  return { valid: true };
}

/**
 * Check if a domain has MX records via Cloudflare DNS-over-HTTPS.
 * Falls back to true on network errors (fail-open for availability,
 * since we'd rather accept a questionable email than block a real user).
 */
async function checkMxRecord(domain) {
  try {
    const resp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!resp.ok) return true; // fail-open
    const data = await resp.json();
    if (data.Answer && data.Answer.length > 0) return true;

    // No MX -- check for A record fallback
    const aResp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`,
      {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(2000),
      }
    );
    if (!aResp.ok) return true;
    const aData = await aResp.json();
    return aData.Answer && aData.Answer.length > 0;
  } catch {
    return true; // fail-open on timeout/network error
  }
}
