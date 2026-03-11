/**
 * Email validation layers (free, no external APIs):
 * 1. Syntax check
 * 2. Disposable domain blocklist (~5,200 domains)
 * 3. Common domain typo suggestion
 * 4. MX record check via Cloudflare DoH
 */

import { DISPOSABLE_DOMAINS } from './_disposable-domains.js';

// Common domains and their typo variants
const DOMAIN_TYPOS = {
  'gmail.com': ['gmial.com', 'gmal.com', 'gmai.com', 'gmali.com', 'gamil.com', 'gnail.com', 'gmaill.com', 'gmil.com', 'gmail.co', 'gmail.cm', 'gmsil.com', 'gmqil.com', 'gmail.con', 'gmail.cim', 'gmail.vom', 'gmail.xom', 'gmaik.com', 'gmaikl.com', 'gmailcom', 'g]mail.com'],
  'yahoo.com': ['yaho.com', 'yahooo.com', 'yhoo.com', 'yhaoo.com', 'yahoo.co', 'yahoo.cm', 'yahoo.con', 'yaoo.com', 'tahoo.com', 'uahoo.com'],
  'hotmail.com': ['hotmal.com', 'hotmai.com', 'hotmial.com', 'hotamil.com', 'hotmail.co', 'hotmail.cm', 'hotmail.con', 'hotmaill.com', 'htmail.com', 'htomail.com'],
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

/**
 * Validate an email address through multiple layers.
 * Returns { valid, error, suggestion } where:
 * - valid: boolean
 * - error: string if invalid (user-facing message)
 * - suggestion: string if we detected a likely typo (e.g., "Did you mean user@gmail.com?")
 */
export async function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required.' };
  }

  email = email.trim().toLowerCase();

  // Layer 1: Syntax
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }

  const [local, domain] = email.split('@');
  if (!local || !domain) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }

  // Layer 2: Disposable domain check
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { valid: false, error: 'Disposable email addresses are not allowed. Please use a permanent email.' };
  }

  // Layer 3: Typo suggestion
  const correction = TYPO_CORRECTIONS.get(domain);
  if (correction) {
    const suggested = `${local}@${correction}`;
    return { valid: false, error: `Did you mean ${suggested}?`, suggestion: suggested };
  }

  // Layer 4: MX record check via Cloudflare DoH
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
    // Status 0 = NOERROR, Answer present = has MX records
    // Some domains use A-record fallback (no MX but still receive mail),
    // so also check for A records if no MX found
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
