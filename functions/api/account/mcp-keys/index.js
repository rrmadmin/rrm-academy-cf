/**
 * GET  /api/account/mcp-keys  — list caller's MCP API keys
 * POST /api/account/mcp-keys  — create a new MCP API key
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession,
  hashToken, checkRateLimit,
} from '../../auth/_shared.js';
import { log } from '../../_log.js';

export async function onRequestOptions() {
  return optionsResponse();
}

// --- GET /api/account/mcp-keys ---
export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const session = await validateSession(db, getSessionIdFromCookie(request));
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    const user = await db.prepare(
      'SELECT id, blocked FROM user WHERE id = ?'
    ).bind(session.userId).first();
    if (!user) return json({ ok: false, error: 'User not found' }, 401);
    if (user.blocked) return json({ ok: false, error: 'Account suspended' }, 403);

    const { results } = await db.prepare(
      `SELECT id, label, key_preview, created_at, last_used_at, revoked_at
       FROM mcp_api_key
       WHERE user_id = ?
       ORDER BY (revoked_at IS NULL) DESC, created_at DESC`
    ).bind(session.userId).all();

    return json({ ok: true, keys: results || [] });
  } catch (err) {
    log(env, waitUntil, 'account', 'mcp_keys_list_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- POST /api/account/mcp-keys ---
export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const session = await validateSession(db, getSessionIdFromCookie(request));
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    const user = await db.prepare(
      'SELECT id, blocked FROM user WHERE id = ?'
    ).bind(session.userId).first();
    if (!user) return json({ ok: false, error: 'User not found' }, 401);
    if (user.blocked) return json({ ok: false, error: 'Account suspended' }, 403);

    if (!checkRateLimit(`mcp-key-create:${session.userId}`)) {
      return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);
    }

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return json({ ok: false, error: 'Invalid payload' }, 400);
    }

    if (typeof body.label !== 'string') {
      return json({ ok: false, error: 'label_required' }, 400);
    }
    const label = body.label.trim();
    if (!label) return json({ ok: false, error: 'label_required' }, 400);
    if (label.length > 60) return json({ ok: false, error: 'label_too_long' }, 400);

    // Enforce max 5 active keys per user
    const activeCount = await db.prepare(
      'SELECT COUNT(*) AS cnt FROM mcp_api_key WHERE user_id = ? AND revoked_at IS NULL'
    ).bind(session.userId).first();
    if ((activeCount?.cnt || 0) >= 5) {
      return json({ ok: false, error: 'max_keys_reached' }, 409);
    }

    // Generate key components
    const idBytes = new Uint8Array(12);
    crypto.getRandomValues(idBytes);
    const id = 'mcpkey_' + Array.from(idBytes, b => b.toString(16).padStart(2, '0')).join('');

    const tokenBytes = new Uint8Array(24);
    crypto.getRandomValues(tokenBytes);
    const tokenHex = Array.from(tokenBytes, b => b.toString(16).padStart(2, '0')).join('');
    const plaintext = 'rrma_mcp_' + tokenHex;

    const keyHash = await hashToken(plaintext);
    const keyPreview = plaintext.slice(0, 12);

    let row;
    try {
      row = await db.prepare(
        `INSERT INTO mcp_api_key (id, user_id, label, key_hash, key_preview, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         RETURNING id, label, key_preview, created_at`
      ).bind(id, session.userId, label, keyHash, keyPreview).first();
    } catch (err) {
      if (err.message?.includes('UNIQUE constraint')) {
        return json({ ok: false, error: 'key_collision' }, 409);
      }
      throw err;
    }

    log(env, waitUntil, 'account', 'mcp_key_created', 'ok', session.userId, 0, 201);

    return json({
      ok: true,
      id: row.id,
      label: row.label,
      plaintext,
      key_preview: row.key_preview,
      created_at: row.created_at,
    }, 201);
  } catch (err) {
    log(env, waitUntil, 'account', 'mcp_key_create_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
