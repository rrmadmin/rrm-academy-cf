/**
 * /api/saved — Save any workspace page for logged-in users.
 *
 * Generalized from saved-article-only to saved_page table (universal).
 * Dual-shape during the rollout window: accepts old { article/articles }
 * request shapes and returns both `pages` + `articles` keys so the
 * still-live old frontend continues working until the cleanup pass.
 *
 * GET    → list saved pages (both keys during window)
 * POST   → save one page/article, OR sync batch from localStorage
 * DELETE → unsave by url (new) or slug (legacy)
 *
 * Anonymous users use localStorage only — all paths require a session.
 *
 * spec: docs/superpowers/specs/2026-05-24-universal-saved-pages-design.md §3.4
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession,
} from './auth/_shared.js';
import { log } from './_log.js';
import { withIdempotency } from './_idempotency.js';
import { canonicalSaveUrl, pageTypeFromUrl } from '../../src/lib/saved-url.mjs';
import { GUIDE_PATHS } from '../../src/lib/saved-guides.mjs';

const MAX_TITLE_LEN = 300;
const MAX_URL_LEN = 500;
const MAX_BATCH = 100;

export async function onRequestOptions() {
  return optionsResponse();
}

// ---------------------------------------------------------------------------
// GET /api/saved
// ---------------------------------------------------------------------------
export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ error: 'service_unavailable' }, 503);

    const session = await validateSession(db, getSessionIdFromCookie(request));
    if (!session) return json({ error: 'unauthorized' }, 401);

    const { results } = await db.prepare(
      'SELECT url, title, type, saved_at FROM saved_page WHERE user_id = ? ORDER BY saved_at DESC'
    ).bind(session.userId).all();

    const pages = results.map(r => ({
      url: r.url,
      title: r.title,
      type: r.type,
      savedAt: r.saved_at,
    }));

    // Dual-emit: map article-type pages back to the legacy shape so the old
    // frontend (Header badge-sync, old saved.astro) keeps working during the
    // window. Non-article pages have no legacy slug representation — omit them.
    // Legacy consumers read .articles[].slug as a BARE article slug (no path prefix).
    const articles = pages
      .filter(p => p.type === 'article')
      .map(p => ({
        slug: p.url.replace(/^\/library\//, '').replace(/\/$/, ''),
        title: p.title,
        savedAt: p.savedAt,
      }));

    return json({ ok: true, pages, articles });
  } catch (err) {
    log(env, waitUntil, 'library', 'saved_get_error', 'error', err.message, 0, 500);
    return json({ error: 'internal_error' }, 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/saved
// ---------------------------------------------------------------------------
export async function onRequestPost(context) {
  return withIdempotency(context, _handlePost);
}

async function _handlePost({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ error: 'service_unavailable' }, 503);

    const session = await validateSession(db, getSessionIdFromCookie(request));
    if (!session) return json({ error: 'unauthorized' }, 401);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'invalid_json' }, 400); }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return json({ error: 'invalid_payload' }, 400);
    }

    // --- Batch path ---
    // Accept { pages:[...] } (new) or { articles:[...] } (legacy)
    const batchItems = Array.isArray(body.pages) ? body.pages
      : Array.isArray(body.articles) ? body.articles
      : null;

    if (batchItems !== null) {
      if (batchItems.length > MAX_BATCH) {
        return json({ error: 'too_many_items' }, 400);
      }
      // Note: each item may push up to 2 statements (saved_page + saved_article dual-write),
      // so the real batch can be up to 2× MAX_BATCH statements (200 max), still within D1 limits.

      const stmts = [];
      let synced = 0;

      for (const item of batchItems) {
        if (!item || typeof item !== 'object') continue;

        // Resolve raw url: new shape has item.url; legacy has item.slug
        let rawUrl;
        if (typeof item.url === 'string' && item.url) {
          rawUrl = item.url;
        } else if (typeof item.slug === 'string' && item.slug) {
          rawUrl = '/library/' + item.slug + '/';
        } else {
          continue;
        }

        const url = canonicalSaveUrl(rawUrl);
        if (!url || url.length > MAX_URL_LEN) continue;

        const type = pageTypeFromUrl(url, GUIDE_PATHS);
        if (!type) continue;

        const rawTitle = item.title || item.slug || '';
        const title = String(rawTitle).trim().slice(0, MAX_TITLE_LEN);
        if (!title) continue;

        const savedAt = (typeof item.savedAt === 'string' && item.savedAt)
          ? item.savedAt
          : new Date().toISOString();

        // ON CONFLICT: preserve the existing saved_at (re-sync must not churn timestamps).
        stmts.push(
          db.prepare(
            'INSERT INTO saved_page (user_id, url, title, type, saved_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, url) DO UPDATE SET title=excluded.title, type=excluded.type'
          ).bind(session.userId, url, title, type, savedAt)
        );

        // INV-10: dual-write saved_article for article-type during rollout window
        if (type === 'article') {
          const articleSlug = url.replace(/^\/library\//, '').replace(/\/$/, '');
          const articleData = JSON.stringify({ slug: articleSlug, title });
          stmts.push(
            db.prepare(
              'INSERT INTO saved_article (user_id, article_slug, article_data, saved_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, article_slug) DO UPDATE SET article_data=excluded.article_data'
            ).bind(session.userId, articleSlug, articleData, savedAt)
          );
        }

        synced++;
      }

      if (stmts.length > 0) {
        await db.batch(stmts);
      }

      // Return the full merged set (authoritative server state)
      const { results } = await db.prepare(
        'SELECT url, title, type, saved_at FROM saved_page WHERE user_id = ? ORDER BY saved_at DESC'
      ).bind(session.userId).all();

      const pages = results.map(r => ({
        url: r.url,
        title: r.title,
        type: r.type,
        savedAt: r.saved_at,
      }));

      const articles = pages
        .filter(p => p.type === 'article')
        .map(p => ({
          slug: p.url.replace(/^\/library\//, '').replace(/\/$/, ''),
          title: p.title,
          savedAt: p.savedAt,
        }));

      return json({ ok: true, synced, pages, articles });
    }

    // --- Single-save path ---
    // Accept { page:{url,title} } (new) or { article:{slug,...} } (legacy)
    let rawUrl;
    let rawTitle;

    if (body.page && typeof body.page === 'object') {
      rawUrl = body.page.url;
      rawTitle = body.page.title;
    } else if (body.article && typeof body.article === 'object') {
      const slug = body.article.slug;
      if (typeof slug !== 'string' || !slug) {
        return json({ error: 'invalid_input' }, 400);
      }
      rawUrl = '/library/' + slug + '/';
      rawTitle = body.article.title || slug;
    } else {
      return json({ error: 'invalid_payload' }, 400);
    }

    if (typeof rawUrl !== 'string' || !rawUrl) {
      return json({ error: 'invalid_input' }, 400);
    }

    const url = canonicalSaveUrl(rawUrl);
    if (!url) return json({ error: 'invalid_url' }, 400);
    if (url.length > MAX_URL_LEN) return json({ error: 'url_too_long' }, 400);

    // INV-4: server derives type, ignores body.type
    const type = pageTypeFromUrl(url, GUIDE_PATHS);
    if (!type) return json({ error: 'not_saveable' }, 400);

    const title = String(rawTitle || '').trim().slice(0, MAX_TITLE_LEN);
    if (!title) return json({ error: 'title_required' }, 400);

    const savedAt = new Date().toISOString();

    // INV-10: dual-write saved_article for article-type during rollout window
    if (type === 'article') {
      const articleSlug = url.replace(/^\/library\//, '').replace(/\/$/, '');
      const articleData = JSON.stringify({ slug: articleSlug, title });
      await db.batch([
        db.prepare(
          'INSERT OR REPLACE INTO saved_page (user_id, url, title, type, saved_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(session.userId, url, title, type, savedAt),
        db.prepare(
          'INSERT OR REPLACE INTO saved_article (user_id, article_slug, article_data, saved_at) VALUES (?, ?, ?, ?)'
        ).bind(session.userId, articleSlug, articleData, savedAt),
      ]);
    } else {
      await db.prepare(
        'INSERT OR REPLACE INTO saved_page (user_id, url, title, type, saved_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(session.userId, url, title, type, savedAt).run();
    }

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'library', 'saved_post_error', 'error', err.message, 0, 500);
    return json({ error: 'internal_error' }, 500);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/saved
// ---------------------------------------------------------------------------
export async function onRequestDelete(context) {
  return withIdempotency(context, _handleDelete);
}

async function _handleDelete({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ error: 'service_unavailable' }, 503);

    const session = await validateSession(db, getSessionIdFromCookie(request));
    if (!session) return json({ error: 'unauthorized' }, 401);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'invalid_json' }, 400); }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return json({ error: 'invalid_payload' }, 400);
    }

    // Accept { url } (new) or { slug } (legacy)
    let rawUrl;
    if (typeof body.url === 'string' && body.url) {
      rawUrl = body.url;
    } else if (typeof body.slug === 'string' && body.slug) {
      rawUrl = '/library/' + body.slug + '/';
    } else {
      return json({ error: 'invalid_input' }, 400);
    }

    const url = canonicalSaveUrl(rawUrl);
    if (!url) return json({ error: 'invalid_url' }, 400);

    // INV-10: during window, also delete from saved_article when article-type
    const type = pageTypeFromUrl(url, GUIDE_PATHS);

    if (type === 'article') {
      const articleSlug = url.replace(/^\/library\//, '').replace(/\/$/, '');
      await db.batch([
        db.prepare(
          'DELETE FROM saved_page WHERE user_id = ? AND url = ?'
        ).bind(session.userId, url),
        db.prepare(
          'DELETE FROM saved_article WHERE user_id = ? AND article_slug = ? COLLATE NOCASE'
        ).bind(session.userId, articleSlug),
      ]);
    } else {
      await db.prepare(
        'DELETE FROM saved_page WHERE user_id = ? AND url = ?'
      ).bind(session.userId, url).run();
    }

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'library', 'saved_delete_error', 'error', err.message, 0, 500);
    return json({ error: 'internal_error' }, 500);
  }
}
