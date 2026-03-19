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
} from './_shared.js';
import { sendGA4Event } from '../_ga4.js';
import { log } from '../_log.js';

const LOGIN_ERROR_URL = '/login?error=oauth_failed';

async function handleReturningGoogleUser(db, googleId, email) {
  const user = await db.prepare('SELECT id, email, blocked FROM user WHERE google_id = ?')
    .bind(googleId).first();
  if (!user) return null;
  if (user.blocked) return { redirect: '/login?error=account_blocked' };

  if (!user.email || user.email.toLowerCase() !== email) {
    const conflict = await db.prepare('SELECT id FROM user WHERE email = ? COLLATE NOCASE AND id != ?')
      .bind(email, user.id).first();
    if (conflict) {
      return { redirect: '/login?error=email_conflict' };
    }
    await db.prepare("UPDATE user SET email = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(email, user.id).run();
    user.email = email;
  }

  return { user };
}

async function linkGoogleToVerifiedUser(db, googleId, email, avatarUrl) {
  const user = await db.prepare('SELECT id, email, google_id, blocked FROM user WHERE email = ? COLLATE NOCASE AND email_verified = 1')
    .bind(email).first();
  if (!user) return null;
  if (user.blocked) return { redirect: '/login?error=account_blocked' };

  if (user.google_id && user.google_id !== googleId) {
    return { redirect: '/login?error=account_conflict' };
  }
  await db.prepare(
    `UPDATE user SET google_id = ?, avatar_url = COALESCE(avatar_url, ?), updated_at = datetime('now') WHERE id = ?`
  ).bind(googleId, avatarUrl, user.id).run();

  return { user };
}

async function upgradeUnverifiedUser(db, googleId, email, avatarUrl) {
  const unverified = await db.prepare('SELECT id, email, blocked FROM user WHERE email = ? COLLATE NOCASE')
    .bind(email).first();
  if (!unverified) return null;

  if (unverified.blocked) return { redirect: '/login?error=account_blocked' };
  await db.batch([
    db.prepare("UPDATE user SET google_id = ?, email_verified = 1, hashed_password = '', avatar_url = COALESCE(avatar_url, ?), updated_at = datetime('now') WHERE id = ?")
      .bind(googleId, avatarUrl, unverified.id),
    db.prepare('DELETE FROM session WHERE user_id = ?').bind(unverified.id),
  ]);

  return { user: unverified };
}

async function createNewGoogleUser(db, email, name, firstName, lastName, googleId, avatarUrl) {
  const id = generateId();
  await db.prepare(
    `INSERT INTO user (id, email, email_verified, hashed_password, name, first_name, last_name, google_id, role, avatar_url)
     VALUES (?, ?, 1, '', ?, ?, ?, ?, 'member', ?)`
  ).bind(id, email, name, firstName, lastName, googleId, avatarUrl).run();

  return { user: { id, email, blocked: 0 } };
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return redirect(LOGIN_ERROR_URL);

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      log(env, waitUntil, 'auth', 'google_auth_error', 'error', 'missing google credentials');
      return redirect(LOGIN_ERROR_URL);
    }

    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    // Handle user denying consent or other Google errors
    const error = url.searchParams.get('error');
    if (error || !code) {
      return redirect(`${SITE_URL}/login?error=oauth_denied`);
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
      return redirect(LOGIN_ERROR_URL);
    }

    // Get user profile from Google
    const profile = await getGoogleProfile(tokens.access_token);
    if (!profile.id || !profile.email) {
      log(env, waitUntil, 'auth', 'google_auth_error', 'error', 'profile missing id or email');
      return redirect(LOGIN_ERROR_URL);
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
    if (r1?.redirect) return redirect(r1.redirect);
    if (r1) ({ user } = r1);

    // 2. Check if email matches an existing account (first Google login for this user)
    if (!user) {
      const r2 = await linkGoogleToVerifiedUser(db, googleId, email, avatarUrl);
      if (r2?.redirect) return redirect(r2.redirect);
      if (r2) ({ user } = r2);
    }

    // 2b. Unverified account with this email — Google proves ownership, upgrade it
    if (!user) {
      const r3 = await upgradeUnverifiedUser(db, googleId, email, avatarUrl);
      if (r3?.redirect) return redirect(r3.redirect);
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
          if (r4retry?.redirect) return redirect(r4retry.redirect);
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
      return redirect('/login?error=account_blocked');
    }

    // Create session (same pattern as login.js)
    const session = await createSession(db, user.id);

    return new Response(null, {
      status: 302,
      headers: {
        Location: returnTo,
        'Set-Cookie': sessionCookie(session.id, session.expiresAt),
      },
    });
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    log(env, waitUntil, 'auth', 'google_auth_error', 'error', err.message);
    return redirect(LOGIN_ERROR_URL);
  }
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: { Location: location },
  });
}
