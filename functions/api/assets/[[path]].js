/**
 * Serve files from R2 (rrm-assets bucket).
 * URL: /api/assets/courses/workbook-endo-surgeon-guide.pdf
 */
import { getSessionIdFromCookie, validateSession } from '../auth/_shared.js';

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

const AUTH_PREFIXES = ['courses/'];

export async function onRequestGet({ request, params, env }) {
  // [[path]] catch-all: CF Pages returns params.path as an array of segments
  const raw = params.path;
  const key = Array.isArray(raw) ? raw.join('/') : raw;
  if (!key) return new Response('Not Found', { status: 404 });

  if (AUTH_PREFIXES.some(p => key.startsWith(p))) {
    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(env.DB, sessionId);
    if (!session) return new Response('Unauthorized', { status: 401 });
  }

  const object = await env.R2_ASSETS.get(key);
  if (!object) return new Response('Not Found', { status: 404 });

  const ext = key.split('.').pop()?.toLowerCase();
  const contentType =
    object.httpMetadata?.contentType ||
    CONTENT_TYPES[ext] ||
    'application/octet-stream';

  const isProtected = AUTH_PREFIXES.some(p => key.startsWith(p));
  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': isProtected
        ? 'private, no-store'
        : 'public, max-age=31536000, immutable',
    },
  });
}
