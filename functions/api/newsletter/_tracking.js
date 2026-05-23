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

export async function unsubscribeHeaders(email, secret) {
  const url = await unsubscribeUrl(email, secret);
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
