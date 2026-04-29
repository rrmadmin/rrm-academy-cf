/**
 * GET /api/glossary/terms - Serve RRM glossary data from D1.
 *
 * Auth: Bearer LIBRARY_BUILD_TOKEN (build-time fetch only, not public).
 *
 * Query params:
 *   ?id=term_xxx  - single term by ID (any status, for preview/rebuild)
 *   ?part=I       - all published terms in that part, ordered by sort_order ASC
 *   (none)        - all published terms + all references, for full build
 */
import { json, optionsResponse, constantTimeEqual } from '../auth/_shared.js';
import { log } from '../_log.js';

const VALID_PARTS = new Set(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']);

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;

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
  const part = url.searchParams.get('part');

  if (id !== null) {
    if (typeof id !== 'string' || id.length > 100) {
      return json({ ok: false, error: 'Invalid id' }, 400);
    }

    try {
      const row = await env.DB.prepare(
        'SELECT * FROM glossary_term WHERE id = ?'
      ).bind(id).first();

      if (!row) {
        return json({ ok: false, error: 'not_found' }, 404);
      }

      return json({ ok: true, data: mapTerm(row) });
    } catch (err) {
      log(env, waitUntil, 'glossary', 'get_error', 'error', err.message, 0, 500);
      return json({ ok: false, error: 'Internal error' }, 500);
    }
  }

  if (part !== null) {
    if (typeof part !== 'string' || !VALID_PARTS.has(part)) {
      return json({ ok: false, error: 'Invalid part' }, 400);
    }

    try {
      const { results } = await env.DB.prepare(
        "SELECT * FROM glossary_term WHERE status = 'published' AND part = ? ORDER BY sort_order ASC"
      ).bind(part).all();

      return json({ ok: true, results: (results || []).map(mapTerm) });
    } catch (err) {
      log(env, waitUntil, 'glossary', 'part_error', 'error', err.message, 0, 500);
      return json({ ok: false, error: 'Internal error' }, 500);
    }
  }

  try {
    const [{ results: terms }, { results: refs }, { results: abbrs }] = await Promise.all([
      env.DB.prepare(
        "SELECT * FROM glossary_term WHERE status = 'published' ORDER BY part ASC, sort_order ASC"
      ).all(),
      env.DB.prepare(
        'SELECT * FROM glossary_reference ORDER BY ref_num ASC'
      ).all(),
      env.DB.prepare(
        'SELECT * FROM glossary_abbreviation ORDER BY sort_order ASC'
      ).all(),
    ]);

    return json({
      ok: true,
      results: {
        terms: (terms || []).map(mapTerm),
        references: (refs || []).map(mapReference),
        abbreviations: (abbrs || []).map(mapAbbreviation),
      },
    });
  } catch (err) {
    log(env, waitUntil, 'glossary', 'list_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

function mapTerm(r) {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    part: r.part,
    sortOrder: r.sort_order,
    bodyHtml: r.body_html,
    abbreviation: r.abbreviation,
    pillarLink: r.pillar_link,
    status: r.status,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
  };
}

function mapReference(r) {
  return {
    refNum: r.ref_num,
    anchorText: r.anchor_text,
    url: r.url,
    publisher: r.publisher,
    journal: r.journal,
  };
}

function mapAbbreviation(r) {
  return {
    abbreviation: r.abbreviation,
    fullTerm: r.full_term,
    termSlug: r.term_slug,
    sortOrder: r.sort_order,
  };
}
