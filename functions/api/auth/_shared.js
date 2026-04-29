/**
 * Shared auth utilities for CF Pages Functions.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 */

// Stripe API version — keep in sync across all Stripe client instantiations.
// Update here when upgrading; all files import from this single source.
export const STRIPE_API_VERSION = '2024-12-18.acacia';

// Canonical site URL for email body links and redirects.
// NOT for CORS (which must stay hardcoded for security) or Astro pages (which use Astro.site).
export const SITE_URL = 'https://rrmacademy.org';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://rrmacademy.org',
  'Access-Control-Allow-Methods': 'POST, GET, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...headers },
  });
}

export function optionsResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// --- ID generation ---

export function generateId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function generateSessionId() {
  const bytes = new Uint8Array(25);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// --- Password hashing (PBKDF2 via Web Crypto) ---

// OWASP minimum for PBKDF2-SHA256. Originally 600K but CF Workers free plan
// has a 10ms CPU time limit — 600K iterations exceeds it. 100K fits comfortably.
// Upgrade to Workers Paid ($5/mo) allows 30s CPU and 600K+ iterations if needed.
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  // Store as: iterations$salt$hash (all base64)
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return `${PBKDF2_ITERATIONS}$${saltB64}$${hashB64}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.includes('$')) return false;
  const [iterStr, saltB64, hashB64] = stored.split('$');
  const iterations = parseInt(iterStr, 10);
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const expectedHash = atob(hashB64);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );
  const actualHash = String.fromCharCode(...new Uint8Array(hash));
  // Constant-time comparison
  if (actualHash.length !== expectedHash.length) return false;
  let mismatch = 0;
  for (let i = 0; i < actualHash.length; i++) {
    mismatch |= actualHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return mismatch === 0;
}

// --- Token hashing (for password reset tokens stored in DB) ---

export async function hashToken(token) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

// --- Session management ---

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_RENEW_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000; // 15 days

export async function createSession(db, userId) {
  const id = generateSessionId();
  const expiresAt = Math.floor((Date.now() + SESSION_DURATION_MS) / 1000);
  await db.prepare('INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(id, userId, expiresAt)
    .run();
  return { id, userId, expiresAt };
}

export async function validateSession(db, sessionId) {
  if (!sessionId) return null;
  const row = await db.prepare('SELECT id, user_id, expires_at FROM session WHERE id = ?')
    .bind(sessionId)
    .first();
  if (!row) return null;

  const now = Math.floor(Date.now() / 1000);
  if (now >= row.expires_at) {
    // Expired — clean up
    await db.prepare('DELETE FROM session WHERE id = ?').bind(sessionId).run();
    return null;
  }

  // Auto-renew if past halfway
  const remainingMs = (row.expires_at - now) * 1000;
  let renewed = false;
  if (remainingMs < SESSION_RENEW_THRESHOLD_MS) {
    const newExpiry = Math.floor((Date.now() + SESSION_DURATION_MS) / 1000);
    await db.prepare('UPDATE session SET expires_at = ? WHERE id = ?')
      .bind(newExpiry, sessionId)
      .run();
    row.expires_at = newExpiry;
    renewed = true;
  }

  return { id: row.id, userId: row.user_id, expiresAt: row.expires_at, renewed };
}

export async function invalidateSession(db, sessionId) {
  await db.prepare('DELETE FROM session WHERE id = ?').bind(sessionId).run();
}

export async function invalidateAllUserSessions(db, userId) {
  await db.prepare('DELETE FROM session WHERE user_id = ?').bind(userId).run();
}

// --- Cookie helpers ---

export function sessionCookie(sessionId, expiresAt) {
  const expires = new Date(expiresAt * 1000).toUTCString();
  return `session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expires}`;
}

export function clearSessionCookie() {
  return 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

export function getSessionIdFromCookie(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? match[1] : null;
}

// --- Turnstile verification ---

export async function verifyTurnstile(secret, token, ip, env) {
  if (!secret) return false;
  if (!token) return false;
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
    });
    const result = await resp.json();
    return result.success;
  } catch (err) {
    if (env?.EVENTS) {
      env.EVENTS.writeDataPoint({
        blobs: ['rrm-academy', 'turnstile', 'verify_network_error', 'error', (err?.message || 'unknown').slice(0, 200)],
        doubles: [0, 1, 0],
        indexes: ['verify_network_error'],
      });
    }
    return false;
  }
}

// --- Constant-time string comparison (prevents timing attacks on Bearer tokens) ---

export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let m = 0;
  for (let i = 0; i < a.length; i++) m |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return m === 0;
}

// --- Rate limiting (simple, in-memory per-isolate — good enough for low traffic) ---
// For production scale, use CF Rate Limiting rules or D1-backed counters.

const rateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 5;

export function checkRateLimit(key) {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(key, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return false;
  return true;
}

// --- Email validation ---

export function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// --- Password validation ---

export function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

// --- Redirect validation ---

export function isSafeRedirect(path) {
  try {
    const url = new URL(path, SITE_URL);
    return url.origin === SITE_URL;
  } catch {
    return false;
  }
}

// --- Role hierarchy ---

const ROLES = ['member', 'mod', 'admin', 'superadmin'];

export function roleAtLeast(userRole, minRole) {
  const minIndex = ROLES.indexOf(minRole);
  if (minIndex === -1) return false;
  return ROLES.indexOf(userRole) >= minIndex;
}

// --- Admin auth ---

/**
 * Validates session cookie and checks for superadmin role.
 * Returns { user, session } on success, or a Response (401/403/500) on failure.
 */
export async function requireSuperAdmin(request, db) {
  if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

  const sessionId = getSessionIdFromCookie(request);
  const session = await validateSession(db, sessionId);
  if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

  const user = await db.prepare(
    'SELECT id, email, name, role FROM user WHERE id = ?'
  ).bind(session.userId).first();
  if (!user) return json({ ok: false, error: 'User not found' }, 401);

  if (!roleAtLeast(user.role, 'superadmin')) {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  return { user, session };
}

// --- Course waitlist backfill ---

/**
 * Returns a prepared D1 statement that links waitlist rows for `email` to `userId`.
 * Safe to include in a db.batch() or call with .run() directly.
 * Idempotent: only touches rows where user_id IS NULL.
 */
export function waitlistBackfillStatement(db, userId, email) {
  return db.prepare(
    'UPDATE course_waitlist SET user_id = ?1 WHERE email = ?2 COLLATE NOCASE AND user_id IS NULL'
  ).bind(userId, email);
}

// --- Google OAuth helpers ---

export function googleAuthUrl(clientId, redirectUri) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(code, clientId, clientSecret, redirectUri) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error('Google token exchange failed:', resp.status, body);
    throw new Error('Google token exchange failed');
  }
  return resp.json();
}

export async function getGoogleProfile(accessToken) {
  const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error('Google profile fetch failed:', resp.status, body);
    throw new Error('Google profile fetch failed');
  }
  return resp.json();
}
