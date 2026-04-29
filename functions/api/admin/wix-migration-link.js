/**
 * POST /api/admin/wix-migration-link
 * Layer 4 reconciliation: manually link a wix_subscription row to a CF user account.
 * Use when a donor's Wix email differs from their CF account email (Sarah-class scenario).
 * The email-binding interstitial intentionally blocks this; admin verifies identity
 * out-of-band, then calls this endpoint to bind wix_subscription_id → user_id.
 *
 * Auth: Bearer ADMIN_API_SECRET (constant-time compare)
 * Body: { wix_subscription_id, user_id|user_email, reason?, dry_run?, force? }
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { log } from '../_log.js';
import { validateBody } from '../_validate.js';

const WIX_SUB_ID_RE = /^wxs_[a-z0-9_-]+$/i;
const USER_ID_RE = /^[a-zA-Z0-9_-]+$/;

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.ADMIN_API_SECRET) {
    return json({ ok: false, error: 'service_unavailable' }, 503);
  }

  const auth = request.headers.get('Authorization') || '';
  const expected = `Bearer ${env.ADMIN_API_SECRET}`;
  const authBytes = new TextEncoder().encode(auth);
  const expectedBytes = new TextEncoder().encode(expected);
  let mismatch = authBytes.length !== expectedBytes.length ? 1 : 0;
  const len = Math.min(authBytes.length, expectedBytes.length);
  for (let i = 0; i < len; i++) {
    mismatch |= authBytes[i] ^ expectedBytes[i];
  }
  if (mismatch !== 0) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'service_unavailable' }, 503);
  }

  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  // Validate fields that validateBody supports (string/boolean types).
  // Mutual-exclusivity of user_id vs user_email is checked manually below.
  const vResult = validateBody(body, {
    wix_subscription_id: { type: 'string', required: true, maxLength: 100 },
    reason:              { type: 'string', required: false, maxLength: 500 },
  });
  if (!vResult.valid) {
    return json({ ok: false, error: 'invalid_input', detail: vResult.error }, 400);
  }

  const wixSubscriptionId = vResult.data.wix_subscription_id;
  const reason = vResult.data.reason || null;

  // Validate wix_subscription_id format.
  if (!WIX_SUB_ID_RE.test(wixSubscriptionId)) {
    return json({ ok: false, error: 'invalid_wix_subscription_id' }, 400);
  }

  // Mutual exclusivity: exactly one of user_id / user_email required.
  const rawUserId = body.user_id;
  const rawUserEmail = body.user_email;
  const hasUserId = rawUserId !== undefined && rawUserId !== null && rawUserId !== '';
  const hasUserEmail = rawUserEmail !== undefined && rawUserEmail !== null && rawUserEmail !== '';

  if (!hasUserId && !hasUserEmail) {
    return json({ ok: false, error: 'invalid_input', detail: 'exactly one of user_id or user_email is required' }, 400);
  }
  if (hasUserId && hasUserEmail) {
    return json({ ok: false, error: 'invalid_input', detail: 'provide user_id or user_email, not both' }, 400);
  }

  // Validate user_id if provided.
  if (hasUserId) {
    if (typeof rawUserId !== 'string') {
      return json({ ok: false, error: 'invalid_input', detail: 'user_id must be a string' }, 400);
    }
    if (rawUserId.length > 100) {
      return json({ ok: false, error: 'invalid_input', detail: 'user_id is too long (max 100 characters)' }, 400);
    }
    if (!USER_ID_RE.test(rawUserId)) {
      return json({ ok: false, error: 'invalid_input', detail: 'user_id contains invalid characters' }, 400);
    }
  }

  // Validate user_email if provided.
  if (hasUserEmail) {
    if (typeof rawUserEmail !== 'string') {
      return json({ ok: false, error: 'invalid_input', detail: 'user_email must be a string' }, 400);
    }
    if (rawUserEmail.length > 254) {
      return json({ ok: false, error: 'invalid_input', detail: 'user_email is too long (max 254 characters)' }, 400);
    }
    if (!rawUserEmail.includes('@')) {
      return json({ ok: false, error: 'invalid_input', detail: 'user_email must contain @' }, 400);
    }
  }

  // Validate dry_run and force (booleans, optional).
  const dryRun = body.dry_run === true;
  const force = body.force === true;

  if (body.dry_run !== undefined && typeof body.dry_run !== 'boolean') {
    return json({ ok: false, error: 'invalid_input', detail: 'dry_run must be a boolean' }, 400);
  }
  if (body.force !== undefined && typeof body.force !== 'boolean') {
    return json({ ok: false, error: 'invalid_input', detail: 'force must be a boolean' }, 400);
  }

  const db = env.DB;

  try {
    // Step 1: Look up the wix_subscription row.
    const wixRow = await db.prepare(
      'SELECT wix_subscription_id, user_id, email, migration_status, stripe_subscription_id ' +
      'FROM wix_subscription WHERE wix_subscription_id = ?'
    ).bind(wixSubscriptionId).first();

    if (!wixRow) {
      return json({ ok: false, error: 'not_found' }, 404);
    }

    // Step 2: If user_email provided, resolve to user.id.
    let resolvedUserId = hasUserId ? rawUserId : null;
    let resolvedUserEmail = hasUserEmail ? rawUserEmail.trim().toLowerCase() : null;

    if (hasUserEmail) {
      const userRow = await db.prepare(
        'SELECT id, email FROM user WHERE email = ? COLLATE NOCASE'
      ).bind(resolvedUserEmail).first();

      if (!userRow) {
        return json({ ok: false, error: 'user_not_found' }, 404);
      }
      resolvedUserId = userRow.id;
      resolvedUserEmail = userRow.email;
    } else {
      // user_id provided — fetch the email for the response payload.
      const userRow = await db.prepare(
        'SELECT id, email FROM user WHERE id = ?'
      ).bind(resolvedUserId).first();
      if (userRow) {
        resolvedUserEmail = userRow.email;
      }
    }

    // Step 3: Pre-flight checks.
    const previousUserId = wixRow.user_id || null;
    const currentEmailOnWixSub = wixRow.email;

    // 3a: Already linked (and force not set).
    if (wixRow.user_id !== null && wixRow.user_id !== '' && !force) {
      // Fetch current user's email for informative response.
      let currentUserEmail = null;
      try {
        const cu = await db.prepare('SELECT email FROM user WHERE id = ?').bind(wixRow.user_id).first();
        currentUserEmail = cu?.email || null;
      } catch {
        // Non-fatal — response still useful without it.
      }
      return json({
        ok: false,
        error: 'already_linked',
        current_user_id: wixRow.user_id,
        current_user_email: currentUserEmail,
      }, 409);
    }

    // 3b: Already migrated.
    const migratedStatuses = new Set(['stripe_active', 'migrated', 'fully_exited']);
    if (migratedStatuses.has(wixRow.migration_status) && wixRow.stripe_subscription_id) {
      return json({
        ok: false,
        error: 'already_migrated',
        stripe_subscription_id: wixRow.stripe_subscription_id,
        migration_status: wixRow.migration_status,
      }, 409);
    }

    // 3c: Outstanding cancellation request.
    const cancelRow = await db.prepare(
      'SELECT id FROM cancellation_request ' +
      'WHERE source_subscription_id = ? AND resolved_at IS NULL'
    ).bind(wixSubscriptionId).first();

    if (cancelRow) {
      return json({
        ok: false,
        error: 'cancel_pending',
        cancellation_request_id: cancelRow.id,
      }, 409);
    }

    // Step 4: dry_run mode — return what WOULD happen without writing.
    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        would_link: {
          wix_subscription_id: wixSubscriptionId,
          user_id: resolvedUserId,
          user_email: resolvedUserEmail,
          current_email_on_wix_sub: currentEmailOnWixSub,
          reason: reason || null,
        },
      });
    }

    // Step 5: Execute the link.
    const noteEntry = `${new Date().toISOString()} admin-link user_id=${resolvedUserId} reason=${reason || 'none'}\n`;
    await db.batch([
      db.prepare(
        'UPDATE wix_subscription ' +
        "SET user_id = ?, " +
        "    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), " +
        '    migration_notes = COALESCE(migration_notes, \'\') || ? ' +
        'WHERE wix_subscription_id = ?'
      ).bind(resolvedUserId, noteEntry, wixSubscriptionId),
    ]);

    // Step 6: Emit AE event.
    env.EVENTS?.writeDataPoint({
      blobs: ['billing', 'stuc-migration', 'admin-link', wixSubscriptionId, resolvedUserId],
      indexes: ['admin-link'],
    });

    // Step 7: Audit log.
    log(env, waitUntil, 'billing', 'admin_wix_link', 'ok',
      `${wixSubscriptionId} → ${resolvedUserId} (${resolvedUserEmail}) reason=${reason || 'none'}`,
      0, 200);

    return json({
      ok: true,
      linked: {
        wix_subscription_id: wixSubscriptionId,
        user_id: resolvedUserId,
        user_email: resolvedUserEmail,
        previous_user_id: previousUserId,
        previous_email_on_wix_sub: currentEmailOnWixSub,
        reason: reason || null,
      },
    });
  } catch (err) {
    log(env, waitUntil, 'billing', 'admin_wix_link_error', 'error', 'internal error', 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}
