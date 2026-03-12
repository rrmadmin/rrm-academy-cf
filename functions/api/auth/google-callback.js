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

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return redirect(LOGIN_ERROR_URL);

    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    // Handle user denying consent or other Google errors
    const error = url.searchParams.get('error');
    if (error || !code) {
      return new Response(null, { status: 302, headers: { Location: `${SITE_URL}/login?error=oauth_denied` } });
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
      // TEMP DEBUG
      return redirect(`${LOGIN_ERROR_URL}&debug=${encodeURIComponent('no_access_token:' + JSON.stringify(tokens))}`);
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
    user = await db.prepare('SELECT id, email, blocked FROM user WHERE google_id = ?')
      .bind(googleId).first();

    if (user && user.email !== email) {
      await db.prepare("UPDATE user SET email = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(email, user.id).run();
      user.email = email;
    }

    if (!user) {
      // 2. Check if email matches an existing account (first Google login for this user)
      user = await db.prepare('SELECT id, email, blocked FROM user WHERE email = ? COLLATE NOCASE')
        .bind(email).first();

      if (user) {
        // Link Google ID to existing account; set avatar if not already set
        await db.prepare(
          `UPDATE user SET google_id = ?, avatar_url = COALESCE(avatar_url, ?), updated_at = datetime('now') WHERE id = ?`
        ).bind(googleId, avatarUrl, user.id).run();
      }
    }

    if (!user) {
      // 3. Brand new user — create account
      const id = generateId();
      await db.prepare(
        `INSERT INTO user (id, email, email_verified, hashed_password, name, first_name, last_name, google_id, role, avatar_url)
         VALUES (?, ?, 1, '', ?, ?, ?, ?, 'member', ?)`
      ).bind(id, email, name, firstName, lastName, googleId, avatarUrl).run();

      user = { id, email, blocked: 0 };
      waitUntil(sendGA4Event(env, request, 'sign_up', { method: 'google' }).catch(() => {}));
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
    // TEMP DEBUG: surface error in redirect (remove after debugging)
    return redirect(`${LOGIN_ERROR_URL}&debug=${encodeURIComponent(err.message)}`);
  }
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: { Location: location },
  });
}
