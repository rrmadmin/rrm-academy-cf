/**
 * GET /api/survey/validate?token=<uuid>
 * Checks whether a survey token is valid and unused.
 * Returns: { valid: true } or { valid: false, reason: 'used' | 'expired' | 'missing' }
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://rrmacademy.org',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const { request, env } = context;

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
