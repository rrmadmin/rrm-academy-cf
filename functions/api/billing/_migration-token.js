/**
 * Magic-link migration token: HMAC-SHA256 over base64url(JSON{wix_sub_id, exp}).
 * Reusable token (no DB burn). Email-binding gate enforced at landing-page interstitial,
 * not at validate time. Validator returns reason ∈ {malformed, forged, expired} for telemetry.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(buf) {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signMigrationToken(payload, secret) {
  const json = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(enc.encode(json));
  const sig = await hmac(secret, payloadB64);
  const sigB64 = b64urlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}

export async function validateMigrationToken(token, secret) {
  if (typeof token !== 'string' || token.length < 8) {
    return { ok: false, reason: 'malformed' };
  }
  const dot = token.lastIndexOf('.');
  if (dot < 1 || dot >= token.length - 1) {
    return { ok: false, reason: 'malformed' };
  }
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  const expectedSig = await hmac(secret, payloadB64);
  const expectedB64 = b64urlEncode(expectedSig);
  if (sigB64.length !== expectedB64.length) {
    return { ok: false, reason: 'forged' };
  }
  if (!constantTimeEqual(sigB64, expectedB64)) {
    return { ok: false, reason: 'forged' };
  }

  let payload;
  try {
    payload = JSON.parse(dec.decode(b64urlDecode(payloadB64)));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (typeof payload.wix_sub_id !== 'string' ||
      !/^wxs_[a-z0-9_-]+$/i.test(payload.wix_sub_id) ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= 0) {
    return { ok: false, reason: 'malformed' };
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, wix_sub_id: payload.wix_sub_id };
}
