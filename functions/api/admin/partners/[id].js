/**
 * POST /api/admin/partners/:id
 * Admin action endpoint: approve, reject, or revoke a partner application.
 * Requires superadmin session auth.
 *
 * Body: { action: 'approve' | 'reject' | 'revoke', reason?: string }
 */
// TODO: task 10 - wire _emails.js helpers
import { json, optionsResponse, requireSuperAdmin } from '../../auth/_shared.js';
import { log } from '../../_log.js';

const VALID_ACTIONS = new Set(['approve', 'reject', 'revoke']);

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequest({ request, env, params }) {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST, OPTIONS' });
  }

  try {
    const auth = await requireSuperAdmin(request, env.DB);
    if (auth instanceof Response) return auth;

    if (!env.DB) {
      return json({ error: 'service_unavailable' }, 503);
    }

    const partnerId = params.id;
    if (typeof partnerId !== 'string' || !partnerId) {
      return json({ error: 'invalid_id' }, 400);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }

    const { action, reason } = body;

    if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
      return json({ error: 'invalid_action' }, 400);
    }

    if (action === 'reject' || action === 'revoke') {
      if (typeof reason !== 'string' || reason.trim().length === 0) {
        return json({ error: 'reason_required' }, 400);
      }
      if (reason.length > 500) {
        return json({ error: 'reason_too_long' }, 400);
      }
    }

    let partner;
    try {
      partner = await env.DB.prepare(
        'SELECT id, name, slug, contact_email, status, notes, tier FROM partners WHERE id = ?'
      ).bind(partnerId).first();
    } catch (err) {
      log(env, null, 'admin', 'partner_action_fetch_error', 'error', err.message, 0, 500);
      return json({ error: 'internal_error' }, 500);
    }

    if (!partner) {
      return json({ error: 'not_found' }, 404);
    }

    if (action === 'approve' && partner.status !== 'pending') {
      return json({ error: 'invalid_state_transition' }, 409);
    }
    if (action === 'reject' && partner.status !== 'pending') {
      return json({ error: 'invalid_state_transition' }, 409);
    }
    if (action === 'revoke' && partner.status !== 'active') {
      return json({ error: 'invalid_state_transition' }, 409);
    }

    const datePrefix = new Date().toISOString().slice(0, 10);

    let newStatus;
    let updateSql;
    let updateParams;

    if (action === 'approve') {
      newStatus = 'active';
      updateSql = "UPDATE partners SET status = 'active', approved_at = datetime('now') WHERE id = ?";
      updateParams = [partnerId];
    } else if (action === 'reject') {
      newStatus = 'rejected';
      const trimmedReason = reason.trim();
      const noteEntry = `[${datePrefix}] ${trimmedReason}`;
      const newNotes = partner.notes ? `${partner.notes}\n${noteEntry}` : noteEntry;
      updateSql = "UPDATE partners SET status = 'rejected', notes = ? WHERE id = ?";
      updateParams = [newNotes, partnerId];
    } else {
      newStatus = 'revoked';
      const trimmedReason = reason.trim();
      const noteEntry = `[${datePrefix}] ${trimmedReason}`;
      const newNotes = partner.notes ? `${partner.notes}\n${noteEntry}` : noteEntry;
      updateSql = "UPDATE partners SET status = 'revoked', revoked_at = datetime('now'), notes = ? WHERE id = ?";
      updateParams = [newNotes, partnerId];
    }

    try {
      await env.DB.prepare(updateSql).bind(...updateParams).run();
    } catch (err) {
      log(env, null, 'admin', 'partner_action_update_error', 'error', err.message, 0, 500);
      return json({ error: 'internal_error' }, 500);
    }

    log(env, null, 'admin', `partner_${action}`, 'ok', partnerId, 0, 200);

    const updatedPartner = { ...partner, status: newStatus };

    // TODO: task 10 - wire _emails.js helpers
    try {
      const emails = await import('../../partners/_emails.js');
      if (action === 'approve') {
        await emails.sendPartnerWelcomeEmail(env, updatedPartner);
      } else if (action === 'reject') {
        await emails.sendPartnerRejectionEmail(env, updatedPartner, reason.trim());
      } else {
        await emails.sendPartnerRevocationEmail(env, updatedPartner, reason.trim());
      }
    } catch (emailErr) {
      log(env, null, 'admin', `partner_${action}_email_error`, 'error', emailErr.message, 0, 0);
    }

    return json({ ok: true, status: newStatus }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    log(env, null, 'admin', 'partner_action_error', 'error', err.message, 0, 500);
    return json({ error: 'internal_error' }, 500);
  }
}
