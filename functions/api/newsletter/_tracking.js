/**
 * Newsletter tracking URL helpers.
 * Wraps links for click tracking, generates open pixel and unsubscribe URLs.
 */
import { SITE_URL } from '../auth/_shared.js';

function currentBucket() {
  const now = new Date();
  return `${now.getUTCFullYear()}Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
}

function prevBucket(n) {
  const now = new Date();
  const totalQuarters = now.getUTCFullYear() * 4 + Math.floor(now.getUTCMonth() / 3) - n;
  return `${Math.floor(totalQuarters / 4)}Q${(totalQuarters % 4) + 1}`;
}

export async function hmacToken(email, secret, bucket = currentBucket()) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${email}:${bucket}`));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyToken(email, secret, candidate) {
  const buckets = [currentBucket(), prevBucket(1), prevBucket(2), prevBucket(3)];
  for (const b of buckets) {
    if (candidate === await hmacToken(email, secret, b)) return true;
  }
  return false;
}

export function trackClick(sendId, subscriberId, url) {
  return `${SITE_URL}/api/newsletter/click?s=${sendId}&u=${subscriberId}&r=${encodeURIComponent(url)}`;
}

export function trackOpen(sendId, subscriberId) {
  return `${SITE_URL}/api/newsletter/open?s=${sendId}&u=${subscriberId}`;
}

export async function unsubscribeUrl(email, secret) {
  const bucket = currentBucket();
  const token = await hmacToken(email, secret, bucket);
  return `${SITE_URL}/api/newsletter/unsubscribe?e=${encodeURIComponent(email)}&t=${token}&b=${encodeURIComponent(bucket)}`;
}

/**
 * The monitored inbox a mailto unsubscribe reaches. Spec section 3 names it as
 * the Reply-To on BOTH lanes, so it is already a mailbox a human reads; a
 * mailto alternative pointing anywhere else would be an opt-out request nobody
 * sees, which is the failure the 2026-06-30 send already paid for once.
 */
export const UNSUBSCRIBE_MAILTO = 'administrator@rrmacademy.org';

/**
 * RFC 8058 one-click, plus a mailto alternative.
 *
 * ORDER IS LOAD-BEARING. `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 * refers to the FIRST URI in the header, so the https form must stay in front.
 * Put the mailto first and a Gmail one-click would open a mail composer instead
 * of POSTing, which reads to the user as a broken unsubscribe and to Google as
 * an unhonoured one.
 *
 * The mailto is an ALTERNATIVE, not a replacement: the https endpoint is what
 * honours the request immediately, in code. A mailto arrival is handled by a
 * human at administrator@, same day, well inside CAN-SPAM's ten business days.
 */
export async function unsubscribeHeaders(email, secret) {
  const url = await unsubscribeUrl(email, secret);
  return {
    'List-Unsubscribe': `<${url}>, <mailto:${UNSUBSCRIBE_MAILTO}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
