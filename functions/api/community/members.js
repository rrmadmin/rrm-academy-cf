/**
 * GET /api/community/members -- list all active STUC members
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { log } from '../_log.js';
import { requireMember, displayName, TIER_LABEL_MAP, STUC_MEMBER_WHERE } from './_shared.js';

const TIER_LABELS = Object.keys(TIER_LABEL_MAP);

const ACHIEVEMENT_LABELS = {
  'Donor 👏': 'Donor',
  'Masterclass in Endometriosis & Surgery': 'Endo Masterclass',
  'Masterclass in Endometriosis and Surgery': 'Endo Masterclass',
  'Long Term Endometriosis Management': 'Long Term Endo',
  'Restorative Reproductive Medicine (RRM) vs Standard ART: A New Approach to Infertility': 'RRM vs ART',
  'Postpartum Depression & Anxiety: a restorative approach to recovery': 'Postpartum',
};

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;

    const db = env.DB;

    const rows = await db.prepare(`
      SELECT DISTINCT u.id, u.name, u.first_name, u.last_name, u.role, u.avatar_url, u.created_at,
        (SELECT MAX(created_at) FROM (
          SELECT created_at FROM community_post WHERE author_id = u.id
          UNION ALL
          SELECT created_at FROM community_comment WHERE author_id = u.id
        )) as last_active
      FROM user u
      WHERE ${STUC_MEMBER_WHERE}
      ORDER BY last_active DESC NULLS LAST, u.created_at DESC
    `).all();

    const userIds = rows.results.map(r => r.id);
    if (!userIds.length) return json({ ok: true, members: [] });

    const labelsRows = await db.prepare(`
      SELECT ul.user_id, ul.label FROM user_label ul
      INNER JOIN user u ON u.id = ul.user_id
      WHERE ${STUC_MEMBER_WHERE}
    `).all();

    // Build label map: userId -> { tier, achievements }
    const labelMap = {};
    for (const row of labelsRows.results) {
      if (!labelMap[row.user_id]) labelMap[row.user_id] = { tier: null, achievements: [] };
      if (TIER_LABELS.includes(row.label)) {
        labelMap[row.user_id].tier = TIER_LABEL_MAP[row.label];
      }
      if (ACHIEVEMENT_LABELS[row.label]) {
        const display = ACHIEVEMENT_LABELS[row.label];
        if (!labelMap[row.user_id].achievements.includes(display)) {
          labelMap[row.user_id].achievements.push(display);
        }
      }
    }

    const members = rows.results.map(r => {
      const info = labelMap[r.id] || { tier: null, achievements: [] };
      return {
        id: r.id,
        name: r.name || displayName(r),
        role: r.role,
        avatarUrl: r.avatar_url || null,
        tier: info.tier,
        achievements: info.achievements,
        lastActive: r.last_active || null,
        joinedAt: r.created_at,
      };
    });

    return json({ ok: true, members });
  } catch (err) {
    log(env, waitUntil, 'community', 'members_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
