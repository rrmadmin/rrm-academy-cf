/**
 * POST /api/auth/verify-email
 * Accepts { code } and verifies the user's email address.
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession, checkRateLimit,
  sessionCookie, authHintCookie,
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

    // Build renewed-cookie headers once so every return path can emit them.
    const responseHeaders = {};
    if (session.renewed) {
      responseHeaders['Set-Cookie'] = [
        sessionCookie(session.id, session.expiresAt),
        authHintCookie(session.expiresAt),
      ];
    }

    if (!await checkRateLimit(env, `verify:${session.userId}`, 5, 900)) {
      return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429, responseHeaders);
    }

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400, responseHeaders); }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400, responseHeaders);

    const rawCode = typeof body.code === 'string' ? body.code : '';
    const code = rawCode.trim().toLowerCase();
    if (!code) return json({ ok: false, error: 'Verification code is required.' }, 400, responseHeaders);

    const now = Math.floor(Date.now() / 1000);

    // Pre-SELECT confirms the code is valid before consuming it.
    const tokenRow = await db.prepare(
      'SELECT user_id FROM email_verification WHERE user_id = ? AND code = ? AND expires_at > ?'
    ).bind(session.userId, code, now).first();

    if (!tokenRow) {
      return json({ ok: false, error: 'Invalid or expired verification code.' }, 400, responseHeaders);
    }

    // Phase 1: Atomically consume the token (race-safe — only the first concurrent
    // caller's DELETE affects 1 row; subsequent callers see changes===0 and get 400
    // before the UPDATE runs).
    const consume = await db.prepare(
      'DELETE FROM email_verification WHERE user_id = ? AND code = ? AND expires_at > ?'
    ).bind(session.userId, code, now).run();

    if (consume.meta?.changes !== 1) {
      // Race: token was consumed concurrently between pre-SELECT and this DELETE.
      return json({ ok: false, error: 'Invalid or expired verification code.' }, 400, responseHeaders);
    }

    // Phase 2: Mark email verified. Token already consumed; if this fails (D1 transient),
    // surface an actionable message naming the resend path so the user knows what to do.
    try {
      await db.prepare("UPDATE user SET email_verified = 1, updated_at = datetime('now') WHERE id = ?")
        .bind(tokenRow.user_id).run();
    } catch (phase2Err) {
      log(env, waitUntil, 'auth', 'verify_email_phase2_fail', 'error', phase2Err.message);
      return json({ ok: false, error: 'Your code was consumed but the email-verified flag update failed. Please request a new code via the "Resend code" link.' }, 500, responseHeaders);
    }

    return json({ ok: true }, 200, responseHeaders);
  } catch (err) {
    log(env, waitUntil, 'auth', 'verify_email_error', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}
