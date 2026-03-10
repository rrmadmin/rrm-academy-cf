/**
 * Newsletter tracking URL helpers.
 * Wraps links for click tracking, generates open pixel and unsubscribe URLs.
 */
import { SITE_URL } from '../auth/_shared.js';

export async function hmacToken(email, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

export function trackClick(sendId, subscriberId, url) {
  return `${SITE_URL}/api/newsletter/click?s=${sendId}&u=${subscriberId}&r=${encodeURIComponent(url)}`;
}

export function trackOpen(sendId, subscriberId) {
  return `${SITE_URL}/api/newsletter/open?s=${sendId}&u=${subscriberId}`;
}

export async function unsubscribeUrl(email, secret) {
  const token = await hmacToken(email, secret);
  return `${SITE_URL}/api/newsletter/unsubscribe?e=${encodeURIComponent(email)}&t=${token}`;
}

export async function unsubscribeHeaders(email, secret) {
  const url = await unsubscribeUrl(email, secret);
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
