/**
 * GET /api/stream/token?videoId=<streamUid>
 * Returns a signed token for Cloudflare Stream video playback.
 * Requires authenticated session and enrollment in the course containing the video.
 *
 * Response: { ok: true, token: "eyJ..." }
 * The client embeds: https://customer-{code}.cloudflarestream.com/{token}/iframe
 */

import {
  json, optionsResponse, getSessionIdFromCookie, validateSession,
} from '../auth/_shared.js';
import { log } from '../_log.js';
import { requireMember } from '../community/_shared.js';
import coursesData from '../../../src/data/courses.json';

const streamUidToCourses = new Map();
for (const course of coursesData) {
  for (const section of course.sections) {
    for (const step of section.steps) {
      if (step.streamUid) {
        const existing = streamUidToCourses.get(step.streamUid);
        if (existing) {
          existing.push(course);
        } else {
          streamUidToCourses.set(step.streamUid, [course]);
        }
      }
    }
  }
}

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    const url = new URL(request.url);
    const videoId = url.searchParams.get('videoId');
    if (!videoId) return json({ ok: false, error: 'Missing videoId' }, 400);

    const courses = streamUidToCourses.get(videoId);
    if (!courses) return json({ ok: false, error: 'Unknown video' }, 404);

    const needsMember = courses.some(c => c.accessType === 'members');
    if (needsMember) {
      // Live membership re-check on every token request (1h token TTL).
      // Member courses: membership IS the access grant; enrollment row alone is insufficient.
      const memberResult = await requireMember(request, env);
      if (memberResult instanceof Response) return memberResult;
    } else {
      const allFree = courses.every(c => c.isFree);
      if (!allFree) {
        const placeholders = courses.map(() => '?').join(', ');
        const enrollment = await db.prepare(
          `SELECT id FROM enrollment WHERE user_id = ? AND course_id IN (${placeholders}) AND revoked_at IS NULL`
        ).bind(session.userId, ...courses.map(c => c.id)).first();
        if (!enrollment) return json({ ok: false, error: 'Not enrolled' }, 403);
      }
    }

    const signingKeyJwk = env.STREAM_SIGNING_KEY;
    const keyId = env.STREAM_SIGNING_KEY_ID;
    if (!signingKeyJwk || !keyId) return json({ ok: false, error: 'Stream not configured' }, 500);

    const token = await generateSignedToken(signingKeyJwk, keyId, videoId);
    return json({ ok: true, token });
  } catch (err) {
    log(env, waitUntil, 'stream', 'token_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
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
