/**
 * GET /api/survey/validate?token=xxx
 * Checks if a survey token is valid and unused.
 * Does NOT consume the token — that happens on submit.
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
    return json({ valid: false, reason: 'server_error' }, 500);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return json({ valid: false, reason: 'missing_token' }, 400);
  }

  const data = await env.SURVEY_TOKENS.get(`token:${token}`, 'json');

  if (!data) {
    return json({ valid: false, reason: 'not_found' });
  }

  if (data.used) {
    return json({ valid: false, reason: 'used' });
  }

  return json({ valid: true, email: data.email });
}
