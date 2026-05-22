/**
 * POST /api/ask/sandbox
 *
 * Canned sandbox response for integration testing.
 * No auth, no rate limit, no DB, no LLM invocation.
 * Use to validate client parsing before integrating with /api/ask.
 */

const SANDBOX_RESPONSE = {
  sandbox: true,
  answer: 'Sandbox response. /api/ask returns answers grounded in the RRM Library. See /openapi/ for the production shape.',
  citations: [
    { url: 'https://rrmacademy.org/llms.txt', title: 'llms.txt' },
    { url: 'https://rrmacademy.org/openapi/', title: 'OpenAPI docs' },
  ],
};

const SANDBOX_CORS = {
  'Access-Control-Allow-Origin': 'https://rrmacademy.org',
  'Access-Control-Allow-Credentials': 'true',
};

function sseSandbox() {
  const body = `retry: 60000\n\ndata: ${JSON.stringify(SANDBOX_RESPONSE)}\n\ndata: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Sandbox': 'true',
      ...SANDBOX_CORS,
    },
  });
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...SANDBOX_CORS,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export function onRequestPost(context) {
  const { request } = context;
  const accept = request.headers.get('Accept') || '';
  const wantsSSE = accept.includes('text/event-stream') || accept.includes('application/x-ndjson');
  if (wantsSSE) {
    return sseSandbox();
  }
  return new Response(JSON.stringify(SANDBOX_RESPONSE), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Sandbox': 'true', ...SANDBOX_CORS },
  });
}

export function onRequest(context) {
  if (context.request.method === 'OPTIONS') return onRequestOptions();
  if (context.request.method === 'POST') return onRequestPost(context);
  return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS', ...SANDBOX_CORS },
  });
}
