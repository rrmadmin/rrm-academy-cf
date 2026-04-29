// functions/mcp/index.js
// Apex MCP endpoint -- transparent proxy to https://mcp.rrmacademy.org/mcp.
//
// Why this exists: agent scanners (notably ora.run) probe MCP at
// https://rrmacademy.org/mcp directly and don't follow the cross-origin
// `server_url` field in /.well-known/mcp.json. Without an apex endpoint,
// scanners get 404 and 11+ MCP-related rubric items fail.
//
// The actual MCP server runs as a Worker bound to mcp.rrmacademy.org. This
// proxy forwards GET/POST/OPTIONS, preserves Authorization, Content-Type, and
// Accept headers, and streams the response body so SSE responses pass through
// frame-by-frame for Streamable HTTP clients.
//
// Routing prerequisite: /mcp must be in rrm-router's ASTRO_ROUTES so the
// router sends apex traffic to Pages. Otherwise the router proxies it to
// the legacy Wix origin (or 404s).

const UPSTREAM = 'https://mcp.rrmacademy.org/mcp';

const FORWARD_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id',
];

async function proxy(request) {
  const incoming = new URL(request.url);
  const upstreamUrl = UPSTREAM + incoming.search;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  const upstream = await fetch(upstreamUrl, init);
  // Surface the upstream body and status verbatim. CF Workers fetch returns
  // a streaming Response, so SSE bodies forward frame-by-frame without
  // buffering the whole stream.
  const respHeaders = new Headers(upstream.headers);
  // Strip hop-by-hop headers that don't apply to the proxied response.
  ['connection', 'keep-alive', 'transfer-encoding'].forEach((h) => respHeaders.delete(h));
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const onRequestGet = ({ request }) => proxy(request);
export const onRequestPost = ({ request }) => proxy(request);
export const onRequestOptions = ({ request }) => proxy(request);
export const onRequestDelete = ({ request }) => proxy(request);
