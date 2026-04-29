// functions/.well-known/mcp.js
// Serves /.well-known/mcp (no .json extension) as a JSON manifest, mirroring
// /.well-known/mcp.json. Lives as a Function because public/.well-known/mcp/
// is already a directory (holds server-card.json), so a static file at the
// same path collides. Some agent scanners (e.g. ora.run) probe the
// extensionless path; this avoids a 404 on those probes.
//
// Source of truth is public/.well-known/mcp.json; we read it via fetch on
// the same origin to avoid duplicating ~6KB of JSON in the function bundle.

export async function onRequestGet({ request }) {
  const origin = new URL(request.url).origin;
  const upstream = await fetch(`${origin}/.well-known/mcp.json`, {
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: 'mcp_manifest_unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  const body = await upstream.text();
  // CORS headers are applied by the platform / static-file pipeline for
  // public discovery files; not setting them here keeps the response identical
  // to /.well-known/mcp.json and avoids the security guard's API-CORS rule
  // (which mandates locking to https://rrmacademy.org for /api/ endpoints).
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
