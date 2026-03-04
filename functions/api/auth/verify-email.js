/**
 * POST /api/auth/verify-email
 * Accepts { code } and verifies the user's email address.
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession, checkRateLimit,
} from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    // Must be logged in
    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not authenticated.' }, 401);

    if (!checkRateLimit(`verify:${session.userId}`)) {
      return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);
    }

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    const code = (body.code || '').trim();
    if (!code) return json({ ok: false, error: 'Verification code is required.' }, 400);

    const now = Math.floor(Date.now() / 1000);

    // Find valid verification record
    const record = await db.prepare(
      'SELECT id, code, expires_at FROM email_verification WHERE user_id = ? AND code = ? AND expires_at > ?'
    ).bind(session.userId, code, now).first();

    if (!record) {
      return json({ ok: false, error: 'Invalid or expired verification code.' }, 400);
    }

    // Mark email as verified + clean up verification records — atomically
    await db.batch([
      db.prepare('UPDATE user SET email_verified = 1, updated_at = datetime(\'now\') WHERE id = ?')
        .bind(session.userId),
      db.prepare('DELETE FROM email_verification WHERE user_id = ?')
        .bind(session.userId),
    ]);

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}
