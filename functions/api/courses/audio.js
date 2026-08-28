/**
 * GET /api/courses/audio?stepId=
 *
 * Gated byte path for the audio rendition (spec 3.3, Honen Phase 4). Reuses
 * _rendition-access.js verbatim, so the trust anchor (3.3.1), the gate matrix
 * (3.3.2) and the step-lock are the SAME code the JSON rendition endpoint runs:
 * members -> requireMember(); paid -> active enrollment in the resolved course;
 * free -> session only. The stored r2_key never reaches the client and the
 * bucket's public host is never handed out -- the bytes are streamed through
 * this function, so access is re-decided on every request.
 *
 * Range is passed through to R2 so the player can seek (206 + Content-Range);
 * a full request answers 200 + Accept-Ranges. Error taxonomy mirrors
 * rendition.js: 401 unauthenticated, 403 gate, 404 for a draft / archived /
 * missing rendition (and for an R2 object that is gone), 500 for corrupt
 * stored content, 502 R2 unreachable, 503 no bucket binding.
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession,
} from '../auth/_shared.js';
import { log } from '../_log.js';
import { resolvePublishedRendition } from './_rendition-access.js';

// Same shape the admin writer validates on the way in
// (admin/courses/[id]/steps/[stepId]/renditions.js). Re-asserted here so a key
// written before that validator, or edited around it, can never address an
// object outside courses/audio/.
const R2_KEY_RE = /^courses\/audio\/[a-z0-9][a-z0-9-]*\.mp3$/;

const MAX_RANGE_HEADER = 200;

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const bucket = env.R2_ASSETS;
    if (!bucket) return json({ ok: false, error: 'service_unavailable' }, 503);

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    const url = new URL(request.url);
    const stepId = url.searchParams.get('stepId');
    if (!stepId || typeof stepId !== 'string' || stepId.length > 100) {
      return json({ ok: false, error: 'invalid_step' }, 400);
    }

    const gate = await resolvePublishedRendition({ request, env, session, stepId, format: 'audio' });
    if (gate.denied) return gate.denied;

    let key;
    try {
      key = JSON.parse(gate.row.content_json)?.r2_key;
    } catch (err) {
      log(env, waitUntil, 'courses', 'audio_parse_error', 'error', `${stepId}: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'server_error' }, 500);
    }
    if (typeof key !== 'string' || !R2_KEY_RE.test(key)) {
      log(env, waitUntil, 'courses', 'audio_key_invalid', 'error', `${stepId}: stored r2_key rejected`, 0, 500);
      return json({ ok: false, error: 'server_error' }, 500);
    }

    let range = parseRange(request.headers.get('Range'));

    let object;
    try {
      object = range ? await bucket.get(key, { range }) : await bucket.get(key);
    } catch (err) {
      // A rejected ranged read is almost always an unsatisfiable range. RFC 9110
      // lets a server ignore Range, so retry whole-object rather than failing the
      // playback; a second failure is a real R2 fault.
      if (!range) {
        log(env, waitUntil, 'courses', 'audio_r2_error', 'error', `${key}: ${err.message}`, 0, 502);
        return json({ ok: false, error: 'upstream_error' }, 502);
      }
      range = null;
      try {
        object = await bucket.get(key);
      } catch (retryErr) {
        log(env, waitUntil, 'courses', 'audio_r2_error', 'error', `${key}: ${retryErr.message}`, 0, 502);
        return json({ ok: false, error: 'upstream_error' }, 502);
      }
    }
    if (!object) return json({ ok: false, error: 'rendition_not_available' }, 404);

    const size = typeof object.size === 'number' ? object.size : null;
    const served = range && size !== null ? servedRange(object.range || range, size) : null;

    const headers = new Headers({
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'private, no-store',
      'Accept-Ranges': 'bytes',
    });
    if (object.httpEtag) headers.set('ETag', object.httpEtag);

    if (served && served.length > 0) {
      headers.set('Content-Range', `bytes ${served.start}-${served.start + served.length - 1}/${size}`);
      headers.set('Content-Length', String(served.length));
      return new Response(object.body, { status: 206, headers });
    }

    if (size !== null) headers.set('Content-Length', String(size));
    return new Response(object.body, { status: 200, headers });
  } catch (err) {
    log(env, waitUntil, 'courses', 'audio_error', 'error', `GET: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

/**
 * Single-range `bytes=` parser -> an R2 range option. Anything this does not
 * understand (multi-range, another unit, a malformed or oversized header)
 * returns null, which serves the whole object -- the RFC 9110 "ignore Range"
 * path, never an error.
 */
function parseRange(header) {
  if (!header || typeof header !== 'string' || header.length > MAX_RANGE_HEADER) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { suffix };
  }
  const offset = Number(rawStart);
  if (!Number.isSafeInteger(offset) || offset < 0) return null;
  if (rawEnd === '') return { offset };
  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end) || end < offset) return null;
  return { offset, length: end - offset + 1 };
}

/**
 * Normalize whatever R2 echoes back (offset/length or suffix) into the absolute
 * start + length the Content-Range header needs, clamped to the object size.
 */
function servedRange(r, size) {
  if (!r) return null;
  if (typeof r.suffix === 'number') {
    const length = Math.min(r.suffix, size);
    return { start: size - length, length };
  }
  const start = Math.min(r.offset ?? 0, size);
  const length = r.length != null ? Math.min(r.length, size - start) : size - start;
  return { start, length };
}
