/**
 * GET /api/admin/ecosystem
 * Returns the ecosystem SSOT JSON from D1 system_config table.
 * Protected by ADMIN_API_SECRET Bearer token (constant-time comparison).
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { log } from '../_log.js';

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.ADMIN_API_SECRET) {
    return json({ ok: false, error: 'Not configured' }, 503);
  }

  const auth = request.headers.get('Authorization') || '';
  const expected = `Bearer ${env.ADMIN_API_SECRET}`;
  const authBytes = new TextEncoder().encode(auth);
  const expectedBytes = new TextEncoder().encode(expected);
  let mismatch = authBytes.length !== expectedBytes.length ? 1 : 0;
  const len = Math.min(authBytes.length, expectedBytes.length);
  for (let i = 0; i < len; i++) {
    mismatch |= authBytes[i] ^ expectedBytes[i];
  }
  if (mismatch !== 0) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'Database not configured' }, 503);
  }

  let row;
  try {
    row = await env.DB.prepare(
      "SELECT value FROM system_config WHERE key = 'ecosystem-map' LIMIT 1"
    ).first();
  } catch (err) {
    log(env, waitUntil, 'admin', 'ecosystem_read_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Database error' }, 500);
  }

  if (!row) {
    return json({ ok: false, error: 'Ecosystem map not configured' }, 404);
  }

  log(env, waitUntil, 'admin', 'ecosystem_read', 'ok', '');

  return new Response(row.value, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://rrmacademy.org',
      'Access-Control-Allow-Methods': 'POST, GET, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}
