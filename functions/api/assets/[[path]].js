/**
 * Serve files from R2 (rrm-assets bucket).
 * URL: /api/assets/courses/workbook-endo-surgeon-guide.pdf
 */

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export async function onRequestGet({ params, env, request }) {
  // [[path]] catch-all: params.path may be a string or array depending on CF Pages version
  const raw = params.path;
  const key = Array.isArray(raw) ? raw.join('/') : raw;
  if (!key) return new Response('Not Found', { status: 404 });

  // Debug: return key info (remove after confirming fix)
  if (key === '_debug') {
    return new Response(JSON.stringify({ raw, key, type: typeof raw, isArray: Array.isArray(raw) }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const object = await env.R2_ASSETS.get(key);
  if (!object) return new Response('Not Found: ' + key, { status: 404 });

  const ext = key.split('.').pop()?.toLowerCase();
  const contentType =
    object.httpMetadata?.contentType ||
    CONTENT_TYPES[ext] ||
    'application/octet-stream';

  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
