// functions/.well-known/mcp.js
// Serves /.well-known/mcp (no .json extension) as a JSON manifest, mirroring
// /.well-known/mcp.json. Lives as a Function because public/.well-known/mcp/
// is already a directory (holds server-card.json), so a static file at the
// same path collides. Some agent scanners (e.g. ora.run) probe the
// extensionless path; this avoids a 404 on those probes.
//
// The JSON is bundled into the Function at build time (not fetched at
// request time) to eliminate the post-deploy cache lag where /.well-known/mcp
// could serve stale JSON for up to 5 minutes after the static file updated.

import manifest from '../../public/.well-known/mcp.json';

export const onRequestGet = () =>
  new Response(JSON.stringify(manifest), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
