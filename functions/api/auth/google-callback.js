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
  waitlistBackfillStatement,
} from './_shared.js';
import { sendGA4Event } from '../_ga4.js';
import { log } from '../_log.js';

const LOGIN_ERROR_URL = '/login/?error=oauth_failed';

async function handleReturningGoogleUser(db, googleId, email) {
  const user = await db.prepare('SELECT id, email, blocked FROM user WHERE google_id = ?')
    .bind(googleId).first();
  if (!user) return null;
  if (user.blocked) return { redirect: '/login/?error=account_blocked' };

  if (!user.email || user.email.toLowerCase() !== email) {
    const conflict = await db.prepare('SELECT id FROM user WHERE email = ? COLLATE NOCASE AND id != ?')
      .bind(email, user.id).first();
    if (conflict) {
      return { redirect: '/login/?error=email_conflict' };
    }
    await db.batch([
      db.prepare("UPDATE user SET email = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(email, user.id),
      waitlistBackfillStatement(db, user.id, email),
    ]);
    user.email = email;
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
  await db.batch([
    db.prepare(
      `UPDATE user SET google_id = ?, avatar_url = COALESCE(avatar_url, ?), updated_at = datetime('now') WHERE id = ?`
    ).bind(googleId, avatarUrl, user.id),
    waitlistBackfillStatement(db, user.id, email),
  ]);

  return { user };
}

async function upgradeUnverifiedUser(db, googleId, email, avatarUrl) {
  const unverified = await db.prepare('SELECT id, email, blocked FROM user WHERE email = ? COLLATE NOCASE')
    .bind(email).first();
  if (!unverified) return null;

  if (unverified.blocked) return { redirect: '/login/?error=account_blocked' };
  await db.batch([
    db.prepare("UPDATE user SET google_id = ?, email_verified = 1, hashed_password = '', avatar_url = COALESCE(avatar_url, ?), updated_at = datetime('now') WHERE id = ?")
      .bind(googleId, avatarUrl, unverified.id),
    db.prepare('DELETE FROM session WHERE user_id = ?').bind(unverified.id),
    waitlistBackfillStatement(db, unverified.id, email),
  ]);

  return { user: unverified };
}

async function createNewGoogleUser(db, email, name, firstName, lastName, googleId, avatarUrl) {
  const id = generateId();
  await db.batch([
    db.prepare(
      `INSERT INTO user (id, email, email_verified, hashed_password, name, first_name, last_name, google_id, role, avatar_url)
       VALUES (?, ?, 1, '', ?, ?, ?, ?, 'member', ?)`
    ).bind(id, email, name, firstName, lastName, googleId, avatarUrl),
    waitlistBackfillStatement(db, id, email),
  ]);

  return { user: { id, email, blocked: 0 } };
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
    const state = url.searchParams.get('state');

    // Handle user denying consent or other Google errors
    const error = url.searchParams.get('error');
    if (error || !code) {
      return htmlRedirect(`${SITE_URL}/login/?error=oauth_denied`);
    }

    // Determine where to send the user after login (prevent open redirects)
    const returnTo = (state && isSafeRedirect(state)) ? state : '/account/';

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
    const email = profile.email.toLowerCase().trim();
    const name = profile.name || '';
    const firstName = profile.given_name || '';
    const lastName = profile.family_name || '';
    const avatarUrl = profile.picture || null;

    let user;

    // 1. Check if google_id already linked to an account
    const r1 = await handleReturningGoogleUser(db, googleId, email);
    if (r1?.redirect) return htmlRedirect(r1.redirect);
    if (r1) ({ user } = r1);

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
      let r4;
      try {
        r4 = await createNewGoogleUser(db, email, name, firstName, lastName, googleId, avatarUrl);
      } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint')) {
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

    return htmlRedirect(returnTo, {
      'Set-Cookie': sessionCookie(session.id, session.expiresAt),
    });
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
  const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${escapeHtml(location)}"></head><body><script>window.location.href=${JSON.stringify(location)}</script></body></html>`;
  return new Response(html, {
    status: 302,
    headers: { Location: location, 'Content-Type': 'text/html;charset=UTF-8', ...extraHeaders },
  });
}
