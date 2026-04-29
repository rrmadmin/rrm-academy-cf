// functions/mcp/index.js
// Apex MCP endpoint -- transparent proxy to https://mcp.rrmacademy.org/mcp.
//
// Why this exists: agent scanners (notably ora.run) probe MCP at
// https://rrmacademy.org/mcp directly and don't follow the cross-origin
// `server_url` field in /.well-known/mcp.json. Without an apex endpoint,
// scanners get 404 and 11+ MCP-related rubric items fail.
//
// The actual MCP server runs as a Worker bound to mcp.rrmacademy.org. This
// proxy forwards GET/POST/OPTIONS/HEAD/DELETE, preserves Authorization,
// Content-Type, and Accept headers, and streams the response body so SSE
// responses pass through frame-by-frame for Streamable HTTP clients.
//
// Routing prerequisite: /mcp must be in rrm-router's ASTRO_ROUTES so the
// router sends apex traffic to Pages. Otherwise the router proxies it to
// the legacy Wix origin (or 404s).

const UPSTREAM_BASE = 'https://mcp.rrmacademy.org';

const FORWARD_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id',
  'user-agent',
  'origin',
];

// Hop-by-hop and response headers we strip from upstream:
// - connection / keep-alive / transfer-encoding: hop-by-hop, not safe to forward
// - set-cookie / set-cookie2: prevent cookie smuggling onto the apex domain
const STRIP_RESPONSE_HEADERS = [
  'connection',
  'keep-alive',
  'transfer-encoding',
  'set-cookie',
  'set-cookie2',
];

function jsonRpcError(status, code, message) {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code, message },
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    },
  );
}

async function proxy(request, env) {
  const incoming = new URL(request.url);
  // Forward the full path so /mcp and /mcp/sub-path both reach upstream.
  // UPSTREAM_BASE has no trailing slash; incoming.pathname starts with /.
  const upstreamUrl = UPSTREAM_BASE + incoming.pathname + incoming.search;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Forward client IP for upstream rate limiting / abuse detection.
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) headers.set('x-forwarded-for', clientIp);

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  let upstream;
  try {
    // Prefer service binding (zero-hop, no DNS, no TLS). Fall back to public
    // fetch when the binding is absent (e.g. local wrangler dev).
    if (env && env.MCP_BACKEND && typeof env.MCP_BACKEND.fetch === 'function') {
      upstream = await env.MCP_BACKEND.fetch(new Request(upstreamUrl, init));
    } else {
      upstream = await fetch(upstreamUrl, init);
    }
  } catch {
    return jsonRpcError(502, -32000, 'Upstream unavailable');
  }

  const respHeaders = new Headers(upstream.headers);
  for (const h of STRIP_RESPONSE_HEADERS) respHeaders.delete(h);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const onRequestGet = ({ request, env }) => proxy(request, env);
export const onRequestPost = ({ request, env }) => proxy(request, env);
export const onRequestOptions = ({ request, env }) => proxy(request, env);
export const onRequestDelete = ({ request, env }) => proxy(request, env);
export const onRequestHead = ({ request, env }) => proxy(request, env);
