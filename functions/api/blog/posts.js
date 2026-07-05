/**
 * GET /api/blog/posts - Serve published blog posts from D1.
 *
 * Auth: Bearer LIBRARY_BUILD_TOKEN (build-time fetch only, not public).
 *
 * Query params:
 *   ?id=recXXX  - single post by ID (any status, for preview/rebuild)
 *   (none)      - all published posts, sorted by publish_date DESC
 *   ?limit=N    - optional page size (1-200); omit for all posts (default)
 *   ?offset=N   - optional row offset (>= 0); only honored alongside limit
 */
import { json, optionsResponse, constantTimeEqual } from '../auth/_shared.js';
import { log } from '../_log.js';

// Explicit projection: exactly the columns mapRow() emits. Never SELECT * --
// future wide columns (or blobs) added to `posts` must be opted in here,
// keeping per-row payloads bounded as the corpus grows.
const POST_COLUMNS =
  'id, slug, title, content, excerpt, author, content_pillar, ' +
  'cover_image_url, publish_date, word_count, seo_keywords, updated_at';

const MAX_LIMIT = 200;

function parseNonNegativeInt(value, max) {
  if (value === null) return null;
  if (!/^\d{1,7}$/.test(value)) return NaN;
  const n = Number(value);
  if (!Number.isInteger(n) || n > max) return NaN;
  return n;
}

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
        `SELECT ${POST_COLUMNS} FROM posts WHERE id = ?`
      ).bind(id).first();

      if (!row) {
        return json({ ok: false, error: 'not_found' }, 404);
      }

      return json({ ok: true, data: mapRow(row) });
    }

    // Optional pagination. Default (no params) returns all published posts,
    // preserving the original contract for fetch-blog-data.mjs.
    const limit = parseNonNegativeInt(url.searchParams.get('limit'), MAX_LIMIT);
    const offset = parseNonNegativeInt(url.searchParams.get('offset'), 1000000);
    if (Number.isNaN(limit) || limit === 0) {
      return json({ ok: false, error: 'Invalid limit' }, 400);
    }
    if (Number.isNaN(offset)) {
      return json({ ok: false, error: 'Invalid offset' }, 400);
    }
    if (offset !== null && limit === null) {
      return json({ ok: false, error: 'offset requires limit' }, 400);
    }

    let query =
      `SELECT ${POST_COLUMNS} FROM posts WHERE status = 'published' ORDER BY publish_date DESC`;
    const binds = [];
    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      binds.push(limit, offset === null ? 0 : offset);
    }

    const { results } = await env.DB.prepare(query).bind(...binds).all();

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
