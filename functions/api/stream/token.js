/**
 * GET /api/stream/token?videoId=<streamUid>
 * Returns a signed token for Cloudflare Stream video playback.
 * Requires authenticated session (same auth as course progress API).
 *
 * Response: { ok: true, token: "eyJ..." }
 * The client embeds: https://customer-{code}.cloudflarestream.com/{token}/iframe
 */

import { validateSession } from '../auth/_shared.js';

export async function onRequestGet({ request, env }) {
  // Auth check
  const session = await validateSession(request, env);
  if (!session) {
    return new Response(JSON.stringify({ ok: false, error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const videoId = url.searchParams.get('videoId');
  if (!videoId) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const signingKeyJwk = env.STREAM_SIGNING_KEY;
  const keyId = env.STREAM_SIGNING_KEY_ID;
  if (!signingKeyJwk || !keyId) {
    return new Response(JSON.stringify({ ok: false, error: 'Stream not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const token = await generateSignedToken(signingKeyJwk, keyId, videoId);
    return new Response(JSON.stringify({ ok: true, token }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Stream token generation failed:', err.message);
    return new Response(JSON.stringify({ ok: false, error: 'Token generation failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Generate a signed JWT for Stream video access.
 * Token is valid for 1 hour with 1-hour expiry window.
 */
async function generateSignedToken(jwkJson, keyId, videoId) {
  const jwk = typeof jwkJson === 'string' ? JSON.parse(jwkJson) : jwkJson;

  // Import the private key
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: 'RS256',
    kid: keyId,
  };

  const payload = {
    sub: videoId,
    kid: keyId,
    exp: now + 3600,  // 1 hour
    nbf: now - 60,    // valid from 1 min ago (clock skew tolerance)
  };

  // Base64url encode
  const enc = new TextEncoder();
  const headerB64 = base64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)));

  // Sign
  const signingInput = enc.encode(`${headerB64}.${payloadB64}`);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, signingInput);

  return `${headerB64}.${payloadB64}.${base64url(new Uint8Array(signature))}`;
}

function base64url(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
