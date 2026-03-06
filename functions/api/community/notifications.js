/**
 * PATCH /api/community/notifications -- toggle email opt-out
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { requireMember } from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPatch({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const { emailOptOut } = body;
    if (typeof emailOptOut !== 'boolean') {
      return json({ ok: false, error: 'emailOptOut must be boolean' }, 400);
    }

    const db = env.DB;
    await db.prepare('UPDATE user SET community_email_opt_out = ? WHERE id = ?')
      .bind(emailOptOut ? 1 : 0, user.id).run();

    return json({ ok: true, emailOptOut });
  } catch (err) {
    console.error('community notifications PATCH error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
