/**
 * /api/saved — Saved articles CRUD for logged-in users.
 *
 * GET    → list all saved articles for the authenticated user
 * POST   → save an article (or sync multiple from localStorage)
 * DELETE → unsave an article by slug
 *
 * Anonymous users continue using localStorage only — these endpoints
 * require a valid session cookie.
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession,
} from './auth/_shared.js';
import { log } from './_log.js';
import { withIdempotency } from './_idempotency.js';

export async function onRequestOptions() {
  return optionsResponse();
}

// --- GET /api/saved ---
export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const session = await validateSession(db, getSessionIdFromCookie(request));
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    const { results } = await db.prepare(
      'SELECT article_slug, article_data, saved_at FROM saved_article WHERE user_id = ? ORDER BY saved_at DESC'
    ).bind(session.userId).all();

    const articles = results.map(r => {
      try { return { ...JSON.parse(r.article_data), savedAt: r.saved_at }; }
      catch { return null; }
    }).filter(Boolean);

    return json({ ok: true, articles });
  } catch (err) {
    log(env, waitUntil, 'library', 'saved_get_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- POST /api/saved ---
// Body: { article: {...} }           — save one article
// Body: { articles: [{...}, ...] }   — sync batch from localStorage
export async function onRequestPost(context) {
  return withIdempotency(context, _handlePost);
}

async function _handlePost({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const session = await validateSession(db, getSessionIdFromCookie(request));
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    // Batch sync (merge localStorage → D1)
    if (Array.isArray(body.articles)) {
      if (body.articles.length > 100) {
        return json({ ok: false, error: 'Too many articles (max 100)' }, 400);
      }
      const stmts = [];
      for (const article of body.articles) {
        if (typeof article.slug !== 'string' || !article.slug || article.slug.length > 500) continue;
        const serialized = JSON.stringify(article);
        if (serialized.length > 10240) continue;
        stmts.push(
          db.prepare(
            'INSERT OR IGNORE INTO saved_article (user_id, article_slug, article_data, saved_at) VALUES (?, ?, ?, ?)'
          ).bind(
            session.userId,
            article.slug,
            serialized,
            article.savedAt || new Date().toISOString()
          )
        );
      }
      if (stmts.length > 0) {
        await db.batch(stmts);
      }
      // Return the merged set
      const { results } = await db.prepare(
        'SELECT article_slug, article_data, saved_at FROM saved_article WHERE user_id = ? ORDER BY saved_at DESC'
      ).bind(session.userId).all();
      const articles = results.map(r => {
        try { return { ...JSON.parse(r.article_data), savedAt: r.saved_at }; }
        catch { return null; }
      }).filter(Boolean);

      return json({ ok: true, synced: stmts.length, articles });
    }

    // Single save
    const article = body.article;
    if (!article || typeof article.slug !== 'string' || !article.slug) {
      return json({ ok: false, error: 'Missing article or slug' }, 400);
    }
    if (article.slug.length > 500) {
      return json({ ok: false, error: 'slug_too_long' }, 400);
    }
    const serialized = JSON.stringify(article);
    if (serialized.length > 10240) {
      return json({ ok: false, error: 'article_too_large' }, 400);
    }

    await db.prepare(
      'INSERT OR REPLACE INTO saved_article (user_id, article_slug, article_data, saved_at) VALUES (?, ?, ?, ?)'
    ).bind(
      session.userId,
      article.slug,
      serialized,
      article.savedAt || new Date().toISOString()
    ).run();

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'library', 'saved_post_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- DELETE /api/saved ---
// Body: { slug: "..." }
export async function onRequestDelete(context) {
  return withIdempotency(context, _handleDelete);
}

async function _handleDelete({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const session = await validateSession(db, getSessionIdFromCookie(request));
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    if (!body.slug) {
      return json({ ok: false, error: 'Missing slug' }, 400);
    }

    await db.prepare(
      'DELETE FROM saved_article WHERE user_id = ? AND article_slug = ?'
    ).bind(session.userId, body.slug).run();

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'library', 'saved_delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
