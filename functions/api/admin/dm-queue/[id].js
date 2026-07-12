/**
 * POST /api/admin/dm-queue/:id
 * Admin action endpoint: approve (send, optionally edited) or reject a
 * queued dm_draft row. Requires superadmin session auth.
 *
 * Body: { action: 'approve' | 'reject', finalText?: string }
 *
 * approve never mutates dm_draft directly -- it calls the rrm-dm-agent
 * Worker's bearer-gated POST /internal/send, which owns the claim CAS, the
 * IG token, and sendTracked() logging. reject is a direct D1 CAS UPDATE.
 *
 * Env (CF Pages project secrets, set at rrm-dm-agent go-live -- until then
 * this endpoint fails closed with 503 worker_not_configured on approve):
 *   DM_AGENT_URL         -- base URL of the deployed rrm-dm-agent Worker
 *   DM_AGENT_SEND_SECRET -- shared bearer for POST /internal/send, matches
 *                           the Worker's INTERNAL_SEND_SECRET (1Password
 *                           item "RRM DM Agent - Internal Send Secret")
 */
import { json, optionsResponse, requireSuperAdmin } from '../../auth/_shared.js';
import { log } from '../../_log.js';

const VALID_ACTIONS = new Set(['approve', 'reject']);
const MAX_FINAL_TEXT_BYTES = 1000;
const MAX_DECIDED_BY_CHARS = 100;
const SEND_TIMEOUT_MS = 15000;

export async function onRequestOptions() {
  return optionsResponse();
}

function byteLength(str) {
  return new TextEncoder().encode(str).length;
}

export async function onRequest({ request, env, params }) {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405, { Allow: 'POST, OPTIONS' });
  }

  try {
    const auth = await requireSuperAdmin(request, env.DB);
    if (auth instanceof Response) return auth;

    if (!env.DB) {
      return json({ ok: false, error: 'service_unavailable' }, 503);
    }

    const draftId = params.id;
    if (typeof draftId !== 'string' || !draftId) {
      return json({ ok: false, error: 'invalid_id' }, 400);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'invalid_json' }, 400);
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return json({ ok: false, error: 'invalid_payload' }, 400);
    }

    const { action, finalText } = body;

    if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
      return json({ ok: false, error: 'invalid_action' }, 400);
    }

    const decidedBy = String(auth.user?.email || '').slice(0, MAX_DECIDED_BY_CHARS);

    if (action === 'reject') {
      return handleReject(env, draftId, decidedBy);
    }

    if (typeof finalText !== 'string') {
      return json({ ok: false, error: 'final_text_required' }, 400);
    }
    const trimmed = finalText.trim();
    if (!trimmed) {
      return json({ ok: false, error: 'final_text_required' }, 400);
    }
    const byteCount = byteLength(trimmed);
    if (byteCount > MAX_FINAL_TEXT_BYTES) {
      return json({ ok: false, error: 'final_text_too_long', bytes: byteCount, max: MAX_FINAL_TEXT_BYTES }, 422);
    }

    return handleApprove(env, draftId, trimmed, decidedBy);
  } catch (err) {
    log(env, null, 'admin', 'dm_queue_action_error', 'error', err?.message || 'unknown', 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}

async function handleReject(env, draftId, decidedBy) {
  let result;
  try {
    result = await env.DB.prepare(
      "UPDATE dm_draft SET status = 'rejected', decided_at = datetime('now'), decided_by = ? WHERE id = ? AND status = 'pending'"
    ).bind(decidedBy, draftId).run();
  } catch (err) {
    log(env, null, 'admin', 'dm_queue_reject_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  if (!result.meta || result.meta.changes === 0) {
    return json({ ok: false, error: 'already_actioned' }, 409, { 'Cache-Control': 'no-store' });
  }

  log(env, null, 'admin', 'dm_queue_reject', 'ok', draftId, 0, 200);
  return json({ ok: true, status: 'rejected' }, 200, { 'Cache-Control': 'no-store' });
}

async function handleApprove(env, draftId, finalText, decidedBy) {
  if (!env.DM_AGENT_URL || !env.DM_AGENT_SEND_SECRET) {
    return json({ ok: false, error: 'worker_not_configured' }, 503, { 'Cache-Control': 'no-store' });
  }

  const sendUrl = env.DM_AGENT_URL.replace(/\/+$/, '') + '/internal/send';

  let workerResp;
  try {
    workerResp = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.DM_AGENT_SEND_SECRET}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ draftId, finalText, decidedBy }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    log(env, null, 'admin', 'dm_queue_approve_unreachable', 'error', err?.message || 'unknown', 0, 504);
    return json({ ok: false, error: 'worker_unreachable' }, 504, { 'Cache-Control': 'no-store' });
  }

  let data;
  try {
    data = await workerResp.json();
  } catch {
    data = null;
  }

  if (workerResp.status === 200) {
    log(env, null, 'admin', 'dm_queue_approve', 'ok', draftId, 0, 200);
    return json({ ok: true, metaMessageId: data?.metaMessageId ?? null }, 200, { 'Cache-Control': 'no-store' });
  }

  if (workerResp.status === 409) {
    return json({ ok: false, error: 'already_actioned' }, 409, { 'Cache-Control': 'no-store' });
  }

  if (workerResp.status === 503) {
    return json({ ok: false, error: 'sends_disabled' }, 503, { 'Cache-Control': 'no-store' });
  }

  if (workerResp.status === 502) {
    log(env, null, 'admin', 'dm_queue_approve_send_failed', 'error', draftId, 0, 502);
    return json({ ok: false, error: 'send_failed' }, 502, { 'Cache-Control': 'no-store' });
  }

  if (workerResp.status === 401) {
    log(env, null, 'admin', 'dm_queue_approve_auth_misconfigured', 'error', 'worker rejected internal-send bearer', 0, 500);
    return json({ ok: false, error: 'worker_auth_misconfigured' }, 500, { 'Cache-Control': 'no-store' });
  }

  log(env, null, 'admin', 'dm_queue_approve_unexpected', 'error', `worker status ${workerResp.status}`, 0, workerResp.status);
  return json({ ok: false, error: 'worker_error' }, 502, { 'Cache-Control': 'no-store' });
}
