/**
 * GET /api/blog/posts - Serve published blog posts from D1.
 *
 * Auth: Bearer LIBRARY_BUILD_TOKEN (build-time fetch only, not public).
 *
 * Query params:
 *   ?id=recXXX  - single post by ID (any status, for preview/rebuild)
 *   (none)      - all published posts, sorted by publish_date DESC
 */
import { json, optionsResponse, constantTimeEqual } from '../auth/_shared.js';
import { log } from '../_log.js';

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;

  try {
    if (!env.LIBRARY_BUILD_TOKEN) {
      return json({ ok: false, error: 'Server misconfigured' }, 503);
    }

    const auth = request.headers.get('Authorization');
    if (!constantTimeEqual(auth, `Bearer ${env.LIBRARY_BUILD_TOKEN}`)) {
      return json({ ok: false, error: 'Unauthorized' }, 401);
    }

    if (!env.DB) {
      return json({ ok: false, error: 'Server misconfigured' }, 503);
    }

    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (id !== null) {
      if (typeof id !== 'string' || id.length > 100) {
        return json({ ok: false, error: 'Invalid id' }, 400);
      }

      const row = await env.DB.prepare(
        'SELECT * FROM posts WHERE id = ?'
      ).bind(id).first();

      if (!row) {
        return json({ ok: false, error: 'not_found' }, 404);
      }

      return json({ ok: true, data: mapRow(row) });
    }

    const { results } = await env.DB.prepare(
      "SELECT * FROM posts WHERE status = 'published' ORDER BY publish_date DESC"
    ).all();

    return json({ ok: true, results: (results || []).map(mapRow) });
  } catch (err) {
    log(env, waitUntil, 'blog', 'posts_get_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

function mapRow(r) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    content: r.content,
    excerpt: r.excerpt,
    author: r.author,
    contentPillar: r.content_pillar,
    coverImageUrl: r.cover_image_url,
    publishDate: r.publish_date,
    wordCount: r.word_count,
    seoKeywords: r.seo_keywords,
    audioUrl: '',
    lastModified: r.updated_at,
  };
}
