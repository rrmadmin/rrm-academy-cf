/**
 * Compact HMAC-signed blobs shared with the rrm-mcp OAuth server.
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256 over that text).
 * The twin of this file is rrm-mcp/src/oauth/crypto.js; the two must stay
 * byte-compatible or the authorization hop breaks. Prefixed with _ so CF Pages
 * does not treat it as a route.
 */
const enc = new TextEncoder();

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : '';
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signBlob(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifyBlob(token, secret, nowS = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  let ok;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(parts[1]), enc.encode(parts[0]));
  } catch {
    return null;
  }
  if (!ok) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
  } catch {
    return null;
  }
  if (typeof payload?.exp !== 'number' || payload.exp <= nowS) return null;
  return payload;
}

export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomId(bytes = 16) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
