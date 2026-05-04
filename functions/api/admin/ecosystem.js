/**
 * GET /api/admin/ecosystem
 * Returns the ecosystem SSOT JSON from D1 system_config table.
 * Protected by ADMIN_API_SECRET Bearer token (constant-time comparison).
 *
 * Storage format: `gz:<base64-gzip>` (current) or raw JSON (legacy).
 * The sync script (scripts/sync-ecosystem.mjs) writes gzip-compressed because
 * the raw JSON exceeds D1's 100KB-per-statement limit.
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { log } from '../_log.js';

export function onRequestOptions() {
  return optionsResponse();
}

async function decodeEcosystemValue(value) {
  if (typeof value !== 'string') {
    throw new Error('value not a string');
  }
  if (!value.startsWith('gz:')) {
    return value;
  }
  const b64 = value.slice(3);
  const binStr = atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  const decompressed = new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  );
  return decompressed.text();
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

  let body;
  try {
    body = await decodeEcosystemValue(row.value);
  } catch (err) {
    log(env, waitUntil, 'admin', 'ecosystem_decode_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Decode error' }, 500);
  }

  log(env, waitUntil, 'admin', 'ecosystem_read', 'ok', '');

  return new Response(body, {
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
