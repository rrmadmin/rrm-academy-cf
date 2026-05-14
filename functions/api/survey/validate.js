/**
 * GET /api/survey/validate?token=<uuid>
 * Checks whether a survey token is valid and unused.
 * Returns: { valid: true } or { valid: false, reason: 'used' | 'expired' | 'missing' }
 */
import { json, optionsResponse, checkRateLimit } from '../auth/_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) return json({ error: 'service_unavailable' }, 503);
  const svalAllowed = await checkRateLimit(env, `sval:${ip}`, 30, 60);
  if (!svalAllowed) return json({ error: 'rate_limited' }, 429);

  if (!env.SURVEY_TOKENS) {
    return json({ valid: false, reason: 'misconfigured' }, 500);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return json({ valid: false, reason: 'missing' }, 400);
  }

  const data = await env.SURVEY_TOKENS.get(`token:${token}`, 'json');

  if (!data) {
    // Token not in KV — either never existed or KV TTL expired (90 days)
    return json({ valid: false, reason: 'expired' });
  }

  if (data.used) {
    return json({ valid: false, reason: 'used' });
  }

  return json({ valid: true });
}
