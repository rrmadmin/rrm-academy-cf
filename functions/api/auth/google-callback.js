/**
 * GET /api/auth/google-callback
 * Handles Google OAuth redirect. Exchanges code for tokens, finds or creates
 * the user, creates a session, and redirects to the original page.
 *
 * Account matching logic:
 *   1. google_id exists in DB        -> log in (returning Google user)
 *   2. email matches existing user   -> link google_id, log in (first Google login)
 *   3. no match                      -> create new account, log in (brand new user)
 */
import {
  generateId, createSession, sessionCookie,
  exchangeGoogleCode, getGoogleProfile, isSafeRedirect, SITE_URL,
  waitlistBackfillStatement, deriveSignupSource, checkRateLimit,
} from './_shared.js';
import { sendEmail, logEmailFailure } from '../_ses.js';
import { sendGA4Event } from '../_ga4.js';
import { log } from '../_log.js';

const LOGIN_ERROR_URL = '/login/?error=oauth_failed';

function isValidGoogleAvatarUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('.googleusercontent.com');
  } catch { return false; }
}

async function handleReturningGoogleUser(db, googleId, email) {
  const user = await db.prepare('SELECT id, email, blocked FROM user WHERE google_id = ?')
    .bind(googleId).first();
  if (!user) return null;
  if (user.blocked) return { redirect: '/login/?error=account_blocked' };

  if (!user.email || user.email.normalize('NFC').toLowerCase() !== email) {
    const conflict = await db.prepare('SELECT id FROM user WHERE email = ? COLLATE NOCASE AND id != ?')
      .bind(email, user.id).first();
    if (conflict) {
      return { redirect: '/login/?error=email_conflict' };
    }
    const oldEmail = user.email;
    try {
      await db.batch([
        db.prepare("UPDATE user SET email = ?, email_verified = 1, updated_at = datetime('now') WHERE id = ?")
          .bind(email, user.id),
        waitlistBackfillStatement(db, user.id, email),
      ]);
    } catch (err) {
      if (err.message?.includes('UNIQUE constraint') || err.message?.includes('idx_user_email_nocase')) {
        return { redirect: '/login/?error=email_conflict' };
      }
      throw err;
    }
    user.email = email;
    return { user, oldEmail };
  } else {
    await waitlistBackfillStatement(db, user.id, email).run();
  }

  return { user };
}

async function linkGoogleToVerifiedUser(db, googleId, email, avatarUrl) {
  const user = await db.prepare('SELECT id, email, google_id, blocked FROM user WHERE email = ? COLLATE NOCASE AND email_verified = 1')
    .bind(email).first();
  if (!user) return null;
  if (user.blocked) return { redirect: '/login/?error=account_blocked' };

  if (user.google_id && user.google_id !== googleId) {
    return { redirect: '/login/?error=account_conflict' };
  }
  const upd = await db.batch([
    db.prepare(
      `UPDATE user SET google_id = ?, avatar_url = COALESCE(avatar_url, ?), updated_at = datetime('now') WHERE id = ? AND (google_id IS NULL OR google_id = ?)`
    ).bind(googleId, avatarUrl, user.id, googleId),
    waitlistBackfillStatement(db, user.id, email),
  ]);

  if (upd[0].meta?.changes !== 1) {
    return { redirect: '/login/?error=account_conflict' };
  }

  return { user };
}

async function upgradeUnverifiedUser(db, googleId, email, avatarUrl) {
  const unverified = await db.prepare('SELECT id, email, blocked FROM user WHERE email = ? COLLATE NOCASE AND email_verified = 0')
    .bind(email).first();
  if (!unverified) return null;

  if (unverified.blocked) return { redirect: '/login/?error=account_blocked' };

  const upd = await db.prepare("UPDATE user SET google_id = ?, email_verified = 1, hashed_password = '', avatar_url = COALESCE(avatar_url, ?), updated_at = datetime('now') WHERE id = ? AND email_verified = 0")
    .bind(googleId, avatarUrl, unverified.id).run();

  if (upd.meta?.changes !== 1) {
    // Another request verified this account between our SELECT and UPDATE — fail closed
    return { redirect: LOGIN_ERROR_URL };
  }

  await db.batch([
    db.prepare('DELETE FROM session WHERE user_id = ?').bind(unverified.id),
    waitlistBackfillStatement(db, unverified.id, email),
  ]);

  return { user: unverified };
}

async function createNewGoogleUser(db, email, name, firstName, lastName, googleId, avatarUrl, signupSource) {
  const id = generateId();
  await db.batch([
    db.prepare(
      `INSERT INTO user (id, email, email_verified, hashed_password, name, first_name, last_name, google_id, role, avatar_url, signup_source)
       VALUES (?, ?, 1, '', ?, ?, ?, ?, 'member', ?, ?)`
    ).bind(id, email, name, firstName, lastName, googleId, avatarUrl, signupSource || 'direct'),
    waitlistBackfillStatement(db, id, email),
  ]);

  return { user: { id, email } };
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return htmlRedirect(LOGIN_ERROR_URL);

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      log(env, waitUntil, 'auth', 'google_auth_error', 'error', 'missing google credentials');
      return htmlRedirect(LOGIN_ERROR_URL);
    }

    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const stateRaw = url.searchParams.get('state') || '';

    // Handle user denying consent or other Google errors
    const error = url.searchParams.get('error');
    if (error || !code) {
      return htmlRedirect(`${SITE_URL}/login/?error=oauth_denied`);
    }

    // Verify CSRF state nonce — RFC 6749 §10.12.
    // google.js set a cookie with the nonce and embedded it in state as "<nonce>:<base64-redirect>".
    const cookieHeader = request.headers.get('Cookie') || '';
    const cookieMatch = cookieHeader.match(/(?:^|;\s*)oauth_state=([^;]+)/);
    const cookieNonce = cookieMatch ? cookieMatch[1] : null;
    const colonIdx = stateRaw.indexOf(':');
    const stateNonce = colonIdx >= 0 ? stateRaw.slice(0, colonIdx) : '';
    const stateRedirectB64 = colonIdx >= 0 ? stateRaw.slice(colonIdx + 1) : '';

    if (!cookieNonce || cookieNonce !== stateNonce) {
      log(env, waitUntil, 'auth', 'oauth_state_mismatch', 'error', 'oauth state cookie mismatch');
      return htmlRedirect(LOGIN_ERROR_URL);
    }

    // Decode the return-to URL from the state parameter.
    let returnTo = '/account/';
    try {
      const decoded = atob(stateRedirectB64);
      if (isSafeRedirect(decoded)) returnTo = decoded;
    } catch { // arise-ignore silent-catch -- malformed base64 falls back to /account/
    }

    // Rate-limit by IP before billed OAuth token exchange
    const ip = request.headers.get('cf-connecting-ip');
    if (!ip) {
      log(env, waitUntil, 'auth', 'google_auth_error', 'error', 'missing ip');
      return htmlRedirect(LOGIN_ERROR_URL);
    }
    const gcbAllowed = await checkRateLimit(env, `gcb:${ip}`, 20, 60);
    if (!gcbAllowed) {
      return htmlRedirect('/login/?error=rate_limited');
    }

    // Exchange authorization code for tokens
    const redirectUri = `${SITE_URL}/api/auth/google-callback`;
    const tokens = await exchangeGoogleCode(
      code, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri
    );

    if (!tokens.access_token) {
      log(env, waitUntil, 'auth', 'google_auth_error', 'error', 'token exchange failed');
      return htmlRedirect(LOGIN_ERROR_URL);
    }

    // Get user profile from Google
    const profile = await getGoogleProfile(tokens.access_token);
    if (!profile.id || !profile.email || profile.verified_email !== true) {
      log(env, waitUntil, 'auth', 'google_auth_error', 'error', 'profile missing or unverified');
      return htmlRedirect(LOGIN_ERROR_URL);
    }

    const googleId = String(profile.id);
    const email = profile.email.normalize('NFC').toLowerCase().trim();
    const name = profile.name || '';
    const firstName = profile.given_name || '';
    const lastName = profile.family_name || '';
    const avatarUrl = isValidGoogleAvatarUrl(profile.picture) ? profile.picture : null;

    let user;

    // 1. Check if google_id already linked to an account
    const r1 = await handleReturningGoogleUser(db, googleId, email);
    if (r1?.redirect) return htmlRedirect(r1.redirect);
    if (r1) {
      ({ user } = r1);
      // Notify old email address when Google profile email changes (safety net).
      // Email is verified=1 since Google confirmed ownership at the L1 gate.
      if (r1.oldEmail && env.AWS_ACCESS_KEY_ID) {
        waitUntil(
          sendEmail(env, {
            from: 'RRM Academy <accounts@mail.rrmacademy.org>',
            to: r1.oldEmail,
            subject: 'Your RRM Academy email address was changed',
            text: [
              'Hi there,',
              '',
              `Your RRM Academy account email was updated to ${email} via Google sign-in.`,
              '',
              'If you made this change, no action is needed.',
              '',
              'If you did not authorize this change, please contact us immediately at administrator@rrmacademy.org',
              '',
              '-- RRM Academy',
            ].join('\n'),
            log: { db: env.DB, source: 'auth/google-callback', category: 'transactional' },
          }).catch(err => logEmailFailure(env.DB, {
            email: r1.oldEmail,
            category: 'transactional',
            source: 'auth/google-callback',
            subject: 'Your RRM Academy email address was changed',
            detail: err.message,
          }))
        );
      }
    }

    // 2. Check if email matches an existing account (first Google login for this user)
    if (!user) {
      const r2 = await linkGoogleToVerifiedUser(db, googleId, email, avatarUrl);
      if (r2?.redirect) return htmlRedirect(r2.redirect);
      if (r2) ({ user } = r2);
    }

    // 2b. Unverified account with this email — Google proves ownership, upgrade it
    if (!user) {
      const r3 = await upgradeUnverifiedUser(db, googleId, email, avatarUrl);
      if (r3?.redirect) return htmlRedirect(r3.redirect);
      if (r3) ({ user } = r3);
    }

    // 3. Brand new user — create account
    if (!user) {
      // Derive signup_source from referer or the decoded return-to path.
      // google-callback.js receives no body, so pass a synthetic object with
      // next set to the decoded returnTo path (same logic as signup.js).
      const signupSource = deriveSignupSource({ next: returnTo }, request);
      let r4;
      try {
        r4 = await createNewGoogleUser(db, email, name, firstName, lastName, googleId, avatarUrl, signupSource);
      } catch (err) {
        const msg = err.message || '';
        const isEmailCollision = msg.includes('idx_user_email_nocase') || /user\.email/.test(msg);
        const isGoogleIdCollision = msg.includes('UNIQUE constraint') && !isEmailCollision;

        if (isEmailCollision) {
          const r4retry = await linkGoogleToVerifiedUser(db, googleId, email, avatarUrl);
          if (r4retry?.redirect) return htmlRedirect(r4retry.redirect);
          if (r4retry) ({ user } = r4retry);
          if (!user) {
            const r4retryUnverified = await upgradeUnverifiedUser(db, googleId, email, avatarUrl);
            if (r4retryUnverified?.redirect) return htmlRedirect(r4retryUnverified.redirect);
            if (r4retryUnverified) ({ user } = r4retryUnverified);
          }
        } else if (isGoogleIdCollision) {
          const r4retry = await handleReturningGoogleUser(db, googleId, email);
          if (r4retry?.redirect) return htmlRedirect(r4retry.redirect);
          if (r4retry) ({ user } = r4retry);
        }
        if (!user) throw err;
      }
      if (r4) {
        ({ user } = r4);
        waitUntil(sendGA4Event(env, request, 'sign_up', { method: 'google' }).catch(() => {}));
      }
    }

    // Check if user is blocked
    if (user.blocked) {
      return htmlRedirect('/login/?error=account_blocked');
    }

    // Create session (same pattern as login.js)
    const session = await createSession(db, user.id);

    // Clear the CSRF nonce cookie and set the session cookie.
    return htmlRedirectWithCookies(returnTo, [
      sessionCookie(session.id, session.expiresAt),
      'oauth_state=; Path=/api/auth/google-callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    ]);
  } catch (err) {
    log(env, waitUntil, 'auth', 'google_auth_error', 'error', err.message);
    return htmlRedirect(LOGIN_ERROR_URL);
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// CF Pages _headers can convert 302 → 200, so include HTML fallback
// that performs the redirect via meta refresh + JS even if status is wrong.
function htmlRedirect(location, extraHeaders) {
  // Escape `<` to `<` in the JSON-encoded URL so a `</script>` substring
  // can't close the inline script tag (XSS sink; JSON.stringify escapes `"`
  // and `\` but NOT `<`). state-decoded `returnTo` can carry adversarial chars.
  const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${escapeHtml(location)}"></head><body><script>window.location.href=${JSON.stringify(location).replace(/</g, '\\u003c')}</script></body></html>`;
  return new Response(html, {
    status: 302,
    headers: { Location: location, 'Content-Type': 'text/html;charset=UTF-8', ...extraHeaders },
  });
}

// Variant that sets multiple Set-Cookie headers (needed for session + nonce clear).
function htmlRedirectWithCookies(location, cookies) {
  // Escape `<` to `<` in the JSON-encoded URL so a `</script>` substring
  // can't close the inline script tag (XSS sink; JSON.stringify escapes `"`
  // and `\` but NOT `<`). state-decoded `returnTo` can carry adversarial chars.
  const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${escapeHtml(location)}"></head><body><script>window.location.href=${JSON.stringify(location).replace(/</g, '\\u003c')}</script></body></html>`;
  const headers = new Headers({ Location: location, 'Content-Type': 'text/html;charset=UTF-8' });
  for (const cookie of cookies) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(html, { status: 302, headers });
}
