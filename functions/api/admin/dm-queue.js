/**
 * GET /api/admin/dm-queue
 * DM approval queue list endpoint for the rrm-dm-agent Component 2 admin
 * surface. Requires superadmin session auth.
 *
 * Tables: dm_draft, dm_thread, dm_message, dm_comment (D1 rrm-auth, dm_ prefix).
 * Written by the rrm-dm-agent Worker -- this endpoint is read-only.
 */
import { json, optionsResponse, requireSuperAdmin } from '../auth/_shared.js';
import { log } from '../_log.js';

const RECENT_MESSAGE_COUNT = 3;
const DRAFT_LIMIT = 100;

export async function onRequestOptions() {
  return optionsResponse();
}

function groupBy(rows, key) {
  const map = {};
  for (const row of rows) {
    const k = row[key];
    if (!map[k]) map[k] = [];
    map[k].push(row);
  }
  return map;
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const auth = await requireSuperAdmin(request, env.DB);
    if (auth instanceof Response) return auth;

    const db = env.DB;

    const [countsRow, draftsResult] = await Promise.all([
      db.prepare(`
        SELECT
          SUM(CASE WHEN COALESCE(t.suppressed, 0) = 0 THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN COALESCE(t.suppressed, 0) = 0 AND COALESCE(t.needs_human, 0) = 1 THEN 1 ELSE 0 END) AS needs_human,
          SUM(CASE WHEN COALESCE(t.suppressed, 0) = 1 THEN 1 ELSE 0 END) AS suppressed
        FROM dm_draft d
        LEFT JOIN dm_thread t ON t.igsid = d.thread_igsid
        WHERE d.status = 'pending'
      `).first(),
      db.prepare(`
        SELECT
          d.id, d.thread_igsid, d.source, d.source_ref, d.tier, d.intent,
          d.draft_text, d.final_text, d.status, d.window_expires_at, d.created_at,
          COALESCE(t.needs_human, 0) AS needs_human,
          t.last_inbound_at
        FROM dm_draft d
        LEFT JOIN dm_thread t ON t.igsid = d.thread_igsid
        WHERE d.status = 'pending' AND COALESCE(t.suppressed, 0) = 0
        ORDER BY d.created_at ASC
        LIMIT ?
      `).bind(DRAFT_LIMIT).all(),
    ]);

    const draftRows = draftsResult.results ?? [];

    const threadIds = [...new Set(draftRows.map(r => r.thread_igsid))];
    const commentIds = [...new Set(
      draftRows.filter(r => r.source === 'comment' && r.source_ref).map(r => r.source_ref)
    )];

    const [messagesResult, commentsResult] = await Promise.all([
      threadIds.length > 0
        ? db.prepare(`
            SELECT mid, thread_igsid, direction, text, created_at, is_ack
            FROM dm_message
            WHERE thread_igsid IN (${threadIds.map(() => '?').join(',')})
            ORDER BY thread_igsid ASC, created_at ASC
          `).bind(...threadIds).all()
        : Promise.resolve({ results: [] }),
      commentIds.length > 0
        ? db.prepare(`
            SELECT comment_id, from_username, text
            FROM dm_comment
            WHERE comment_id IN (${commentIds.map(() => '?').join(',')})
          `).bind(...commentIds).all()
        : Promise.resolve({ results: [] }),
    ]);

    const messagesByThread = groupBy(messagesResult.results ?? [], 'thread_igsid');
    const commentsById = {};
    for (const c of (commentsResult.results ?? [])) commentsById[c.comment_id] = c;

    const drafts = draftRows.map(d => {
      const recent = (messagesByThread[d.thread_igsid] || []).slice(-RECENT_MESSAGE_COUNT);
      const draft = {
        id: d.id,
        threadIgsid: d.thread_igsid,
        source: d.source,
        sourceRef: d.source_ref,
        tier: d.tier,
        intent: d.intent,
        draftText: d.draft_text,
        finalText: d.final_text,
        status: d.status,
        windowExpiresAt: d.window_expires_at,
        createdAt: d.created_at,
        needsHuman: !!d.needs_human,
        lastInboundAt: d.last_inbound_at,
        recentMessages: recent.map(m => ({
          mid: m.mid,
          direction: m.direction,
          text: m.text,
          createdAt: m.created_at,
          isAck: !!m.is_ack,
        })),
      };
      if (d.source === 'comment') {
        const comment = commentsById[d.source_ref];
        draft.fromUsername = comment?.from_username ?? null;
        draft.commentText = comment?.text ?? null;
      }
      return draft;
    });

    return json({
      ok: true,
      data: {
        drafts,
        counts: {
          pending: countsRow?.pending ?? 0,
          needsHuman: countsRow?.needs_human ?? 0,
          suppressed: countsRow?.suppressed ?? 0,
        },
      },
    }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    log(env, waitUntil, 'admin', 'dm_queue_list_error', 'error', err?.message || 'unknown', 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}
