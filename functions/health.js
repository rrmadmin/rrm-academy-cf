// functions/health.js
// GET /health -- unauthenticated liveness probe.
//
// Contract: public/openapi.json (operationId: health_check) declares a 200
// text/plain response whose body is the literal string `ok` (schema
// HealthStatus: { type: "string", enum: ["ok"] }). Match the spec exactly.
//
// Deliberately dependency-free: no imports, no env access, no bindings.
// This handler must NEVER 500 -- it is the thing monitors call to decide
// whether everything else is broken.
//
// Cache-Control: no-store so probes always hit origin (never a cached "ok"
// masking an outage).
//
// Routing prerequisite: /health must be in rrm-router's ASTRO_ROUTES so the
// router sends apex traffic to Pages. Otherwise the router proxies it to
// the legacy Wix origin (same prerequisite as /mcp -- see functions/mcp/index.js).

const HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'no-store',
};

export function onRequestGet() {
  return new Response('ok', { status: 200, headers: HEADERS });
}

export function onRequestHead() {
  return new Response(null, { status: 200, headers: HEADERS });
}
