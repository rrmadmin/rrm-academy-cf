/**
 * /api/auth/verify-email — magic-link email verification.
 *
 *   GET  ?token=<token>   Renders a one-button "Confirm your email" page. GET is
 *                         deliberately side-effect-free so email scanners and
 *                         link prefetchers cannot silently consume the token.
 *   POST token=<token>    (form-encoded) Validates + atomically consumes the
 *                         single-use token, sets email_verified=1, mints a
 *                         session, and 303-redirects to /account — no typed code,
 *                         no separate login step.
 *
 * The legacy session + typed-code path (POST application/json { code }) is kept
 * as a dormant fallback; no UI surfaces it since the move to link-only verify.
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession, checkRateLimit,
  sessionCookie, authHintCookie, generateSessionId, sessionInsertStatement,
  hashToken, SESSION_DURATION_MS,
} from './_shared.js';
import { log } from '../_log.js';

const ACCOUNT_URL = 'https://rrmacademy.org/account/';
const LOGIN_URL = 'https://rrmacademy.org/login/';

// Verification tokens are lowercase hex from generateToken() (64 chars). Accept
// 32-64 so a future length change inside that band does not break the validator.
function isValidTokenFormat(t) {
  return typeof t === 'string' && /^[a-f0-9]{32,64}$/.test(t);
}

function htmlPage({ title, heading, body, status = 200 }) {
  const html =
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${title} — RRM Academy</title><style>` +
    `body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#faf8fb;color:#1a1a1a;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}` +
    `.card{background:#fff;border:1px solid #e6e0ea;border-radius:16px;max-width:420px;width:100%;padding:40px 32px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.04)}` +
    `h1{font-size:1.5rem;margin:0 0 12px;color:#5a4a6a}p{color:#555;line-height:1.5;margin:0 0 24px}` +
    `button,.btn{display:inline-block;background:#725E7E;color:#fff;border:none;border-radius:999px;padding:14px 28px;font-size:1rem;font-weight:600;cursor:pointer;text-decoration:none}` +
    `button:hover,.btn:hover{background:#5f4d6a}` +
    `</style></head><body><div class="card"><h1>${heading}</h1>${body}</div></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

const EXPIRED_BODY =
  `<p>Verification links expire after one hour and each one works only once. ` +
  `Log in and choose “Send verification email” on your account page to get a fresh link.</p>` +
  `<a class="btn" href="${LOGIN_URL}">Go to log in</a>`;
const INVALID_BODY =
  `<p>This verification link is malformed or incomplete. ` +
  `Log in and request a new one from your account page.</p>` +
  `<a class="btn" href="${LOGIN_URL}">Go to log in</a>`;

export async function onRequestOptions() {
  return optionsResponse();
}

// GET ?token=... — side-effect-free confirm page (no DB writes, no token consume).
export async function onRequestGet({ request, env }) {
  const db = env.DB;
  const url = new URL(request.url);
  const token = (url.searchParams.get('token') || '').trim().toLowerCase();

  if (!db || !isValidTokenFormat(token)) {
    return htmlPage({ title: 'Verification link', heading: 'This link looks invalid', body: INVALID_BODY, status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare('SELECT 1 FROM email_verification WHERE token = ? AND expires_at > ?')
    .bind(token, now).first();
  if (!row) {
    return htmlPage({ title: 'Verification link', heading: 'This link has expired', body: EXPIRED_BODY, status: 410 });
  }

  // token is already format-validated to [a-f0-9]{32,64}, so it is safe to embed.
  return htmlPage({
    title: 'Confirm your email',
    heading: 'Confirm your email address',
    body:
      `<p>Click below to verify your email and finish setting up your RRM Academy account.</p>` +
      `<form method="POST" action="/api/auth/verify-email">` +
      `<input type="hidden" name="token" value="${token}">` +
      `<button type="submit">Confirm my email</button></form>`,
  });
}

export async function onRequestPost({ request, env, waitUntil }) {
  let responseHeaders = {};
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const contentType = request.headers.get('Content-Type') || '';

    // --- Magic-link branch: form-encoded token, no session required. ---
    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const token = String(form.get('token') || '').trim().toLowerCase();

      if (!isValidTokenFormat(token)) {
        return htmlPage({ title: 'Verification', heading: 'This link looks invalid', body: INVALID_BODY, status: 400 });
      }

      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (!await checkRateLimit(env, `verify-link:${ip}`, 20, 900)) {
        return htmlPage({ title: 'Verification', heading: 'Too many attempts', body: `<p>Please wait a few minutes and click the link again.</p>`, status: 429 });
      }

      const now = Math.floor(Date.now() / 1000);

      // Pre-SELECT for user_id, then atomic single-use consume keyed on the token.
      const row = await db.prepare('SELECT user_id FROM email_verification WHERE token = ? AND expires_at > ?')
        .bind(token, now).first();
      if (!row) {
        return htmlPage({ title: 'Verification', heading: 'This link has expired', body: EXPIRED_BODY, status: 410 });
      }

      const consume = await db.prepare('DELETE FROM email_verification WHERE token = ? AND expires_at > ?')
        .bind(token, now).run();
      if (consume.meta?.changes !== 1) {
        // Already consumed (double click / concurrent race): treat as success-ish.
        return htmlPage({ title: 'Verification', heading: 'Already confirmed', body: `<p>This link was already used. You can log in now.</p><a class="btn" href="${LOGIN_URL}">Go to log in</a>`, status: 200 });
      }

      // Set verified and clear any other outstanding verification rows for this user.
      await db.prepare("UPDATE user SET email_verified = 1, updated_at = datetime('now') WHERE id = ?")
        .bind(row.user_id).run();
      await db.prepare('DELETE FROM email_verification WHERE user_id = ?').bind(row.user_id).run();

      // Mint a session so the click lands the user logged in (no separate login step).
      const sessionId = generateSessionId();
      const expiresAt = Math.floor((Date.now() + SESSION_DURATION_MS) / 1000);
      const hashedSessionId = await hashToken(sessionId);
      await sessionInsertStatement(db, hashedSessionId, row.user_id, expiresAt).run();

      const headers = new Headers({ 'Location': ACCOUNT_URL, 'Cache-Control': 'no-store' });
      headers.append('Set-Cookie', sessionCookie(sessionId, expiresAt));
      headers.append('Set-Cookie', authHintCookie(expiresAt));
      return new Response(null, { status: 303, headers });
    }

    // --- Legacy session + typed-code branch (dormant; retained as a fallback). ---
    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not authenticated.' }, 401);

    // Build renewed-cookie headers once so every return path can emit them.
    // responseHeaders is declared at the top of onRequestPost so the outer
    // catch can include any renewed-session cookies too.
    if (session.renewed) {
      responseHeaders['Set-Cookie'] = [
        sessionCookie(session.cookieId, session.expiresAt),
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
    const tokenRow = await db.prepare(
      'SELECT user_id FROM email_verification WHERE user_id = ? AND code = ? AND expires_at > ?'
    ).bind(session.userId, code, now).first();
    if (!tokenRow) {
      return json({ ok: false, error: 'Invalid or expired verification code.' }, 400, responseHeaders);
    }

    const consume = await db.prepare(
      'DELETE FROM email_verification WHERE user_id = ? AND code = ? AND expires_at > ?'
    ).bind(session.userId, code, now).run();
    if (consume.meta?.changes !== 1) {
      return json({ ok: false, error: 'Invalid or expired verification code.' }, 400, responseHeaders);
    }

    try {
      await db.prepare("UPDATE user SET email_verified = 1, updated_at = datetime('now') WHERE id = ?")
        .bind(tokenRow.user_id).run();
    } catch (phase2Err) {
      log(env, waitUntil, 'auth', 'verify_email_phase2_fail', 'error', phase2Err.message);
      return json({ ok: false, error: 'Your email was confirmed but a flag update failed. Please use the "Send verification email" link on your account page.' }, 500, responseHeaders);
    }

    return json({ ok: true }, 200, responseHeaders);
  } catch (err) {
    log(env, waitUntil, 'auth', 'verify_email_error', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500, responseHeaders);
  }
}
