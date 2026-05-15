/**
 * POST /api/auth/verify-email
 * Accepts { code } and verifies the user's email address.
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession, checkRateLimit, sessionCookie,
} from './_shared.js';
import { log } from '../_log.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    // Must be logged in
    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not authenticated.' }, 401);

    if (!await checkRateLimit(env, `verify:${session.userId}`, 5, 900)) {
      return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);
    }

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    const code = (body.code || '').trim().toLowerCase();
    if (!code) return json({ ok: false, error: 'Verification code is required.' }, 400);

    const now = Math.floor(Date.now() / 1000);

    // Pre-SELECT to get user ownership without consuming the token yet.
    // Allows the DELETE + UPDATE to run as an atomic batch, preventing the
    // rugpull where token is consumed but UPDATE fails (user_id mismatch, DB error).
    const tokenRow = await db.prepare(
      'SELECT user_id FROM email_verification WHERE user_id = ? AND code = ? AND expires_at > ?'
    ).bind(session.userId, code, now).first();

    if (!tokenRow) {
      return json({ ok: false, error: 'Invalid or expired verification code.' }, 400);
    }

    // Atomic batch: consume token + verify email together.
    const results = await db.batch([
      db.prepare('DELETE FROM email_verification WHERE user_id = ? AND code = ? AND expires_at > ?')
        .bind(session.userId, code, now),
      db.prepare("UPDATE user SET email_verified = 1, updated_at = datetime('now') WHERE id = ?")
        .bind(tokenRow.user_id),
    ]);

    if (results[0].meta?.changes !== 1) {
      // Race: token was consumed concurrently between pre-SELECT and batch DELETE.
      return json({ ok: false, error: 'Invalid or expired verification code.' }, 400);
    }

    const responseHeaders = {};
    if (session.renewed) {
      responseHeaders['Set-Cookie'] = sessionCookie(session.id, session.expiresAt);
    }

    return json({ ok: true }, 200, responseHeaders);
  } catch (err) {
    log(env, waitUntil, 'auth', 'verify_email_error', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}
