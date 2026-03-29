/**
 * Serve files from R2 (rrm-assets bucket).
 * URL: /api/assets/courses/workbook-endo-surgeon-guide.pdf
 */
import { getSessionIdFromCookie, validateSession } from '../auth/_shared.js';
import { getCourseBySlug } from '../courses/_shared.js';

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
const PUBLIC_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg']);

export async function onRequestGet({ request, params, env }) {
  // [[path]] catch-all: CF Pages returns params.path as an array of segments
  const raw = params.path;
  const key = Array.isArray(raw) ? raw.join('/') : raw;
  if (!key || key.includes('..')) return new Response('Not Found', { status: 404 });

  const ext = key.split('.').pop()?.toLowerCase();
  const isImage = PUBLIC_IMAGE_EXTS.has(ext);
  const inAuthPrefix = AUTH_PREFIXES.some(p => key.startsWith(p));

  // course-covers/ is outside AUTH_PREFIXES -- public by design.
  // For files under courses/ (lesson attachments), only non-image
  // files (PDFs, workbooks) require auth; images are public.
  if (inAuthPrefix && !isImage) {
    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(env.DB, sessionId);
    if (!session) return new Response('Unauthorized', { status: 401 });

    // Extract course slug from key: courses/{slug}/... and verify enrollment
    const keyParts = key.split('/');
    if (keyParts[0] === 'courses' && keyParts[1]) {
      const course = getCourseBySlug(keyParts[1]);
      if (course && !course.isFree) {
        const enrollment = await env.DB.prepare(
          'SELECT id FROM enrollment WHERE user_id = ? AND course_id = ? AND revoked_at IS NULL'
        ).bind(session.userId, course.id).first();
        if (!enrollment) return new Response('Forbidden', { status: 403 });
      }
    }
  }

  let object;
  try {
    object = await env.R2_ASSETS.get(key);
  } catch {
    return new Response('Service Unavailable', { status: 502 });
  }
  if (!object) return new Response('Not Found', { status: 404 });

  const contentType =
    object.httpMetadata?.contentType ||
    CONTENT_TYPES[ext] ||
    'application/octet-stream';

  const isProtected = inAuthPrefix && !isImage;
  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': isProtected
        ? 'private, no-store'
        : 'public, max-age=31536000, immutable',
    },
  });
}
