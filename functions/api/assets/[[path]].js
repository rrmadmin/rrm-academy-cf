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
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
};

export async function onRequestGet({ params, env }) {
  // [[path]] catch-all: CF Pages returns params.path as an array of segments
  const raw = params.path;
  const key = Array.isArray(raw) ? raw.join('/') : raw;
  if (!key) return new Response('Not Found', { status: 404 });

  const object = await env.R2_ASSETS.get(key);
  if (!object) return new Response('Not Found', { status: 404 });

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
