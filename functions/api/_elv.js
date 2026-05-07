/**
 * EmailListVerify (ELV) integration for real-time email verification.
 *
 * Called at every email entry point (signup, contact, survey, newsletter,
 * checkout webhook). Verifies the mailbox exists via SMTP probing and
 * upserts a contact + tag in D1 for the CRM.
 *
 * ELV statuses:
 *   ok, ok_for_all       -> sendable
 *   accept_all, unknown,
 *   risky, role           -> risky (allow, but flag)
 *   email_disabled,
 *   spamtrap, disposable,
 *   invalid               -> block
 *   antispam_system,
 *   dead_server,
 *   smtp_protocol,
 *   invalid_mx            -> risky (allow, but flag)
 *   error                 -> fail-open (allow)
 *
 * Env vars required:
 *   ELV_API_KEY  -- EmailListVerify API key
 *   DB           -- D1 binding
 */

// Statuses that mean "do not send to this address"
const BLOCK_STATUSES = new Set([
  'email_disabled', 'spamtrap', 'disposable', 'invalid',
]);

// Statuses that are clearly safe
const SAFE_STATUSES = new Set(['ok', 'ok_for_all']);

/**
 * Verify a single email via ELV API.
 * Returns { status, blocked, reason }.
 *
 * - blocked: true  -> reject the email (spamtrap, disabled, disposable, invalid)
 * - blocked: false -> allow (ok, risky, unknown, error/timeout)
 *
 * Fail-open: if ELV is down or times out, we allow the email through.
 * The 7-layer local validator already caught syntax/MX/disposable issues.
 */
export async function verifyEmailELV(email, env) {
  if (!env.ELV_API_KEY) {
    // ELV not configured -- fail-open
    return { status: 'skipped', blocked: false, reason: 'ELV not configured' };
  }

  try {
    const url = `https://apps.emaillistverify.com/api/verifyEmail?secret=${env.ELV_API_KEY}&email=${encodeURIComponent(email)}&timeout=15`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(18000) });

    if (!resp.ok) {
      return { status: 'error', blocked: false, reason: `HTTP ${resp.status}` };
    }

    const status = (await resp.text()).trim().toLowerCase();

    if (BLOCK_STATUSES.has(status)) {
      return { status, blocked: true, reason: statusMessage(status) };
    }

    return { status, blocked: false, reason: null };
  } catch (err) {
    // Timeout or network error -- fail-open
    return { status: 'error', blocked: false, reason: err.message };
  }
}

/**
 * Verify email AND upsert a CRM contact + ELV tag in D1.
 * Use this at entry points where we want to track the contact (signup, checkout, etc.).
 * For endpoints that don't create contacts (login, forgot-password), use verifyEmailELV directly.
 */
export async function verifyAndTagEmail(email, env, { firstName, lastName, source } = {}) {
  const result = await verifyEmailELV(email, env);

  // Tag in D1 (non-blocking, best-effort)
  let contactId = null;
  if (env.DB && result.status !== 'skipped') {
    try {
      // Upsert contact — RETURNING id eliminates the separate SELECT (2 RTs instead of 3).
      // contact_tag depends on the returned id so it cannot be batched with the upsert.
      const contact = await env.DB.prepare(
        `INSERT INTO contact (id, email, first_name, last_name, source)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           first_name = COALESCE(NULLIF(excluded.first_name, ''), contact.first_name),
           last_name = COALESCE(NULLIF(excluded.last_name, ''), contact.last_name),
           updated_at = datetime('now')
         RETURNING id`
      ).bind(
        crypto.randomUUID(), email, firstName || '', lastName || '', source || 'website'
      ).first();

      contactId = contact?.id || null;

      if (contactId) {
        await env.DB.prepare(
          `INSERT INTO contact_tag (contact_id, tag, source)
           VALUES (?, ?, 'emaillistverify')
           ON CONFLICT(contact_id, tag) DO UPDATE SET source = excluded.source`
        ).bind(contactId, `elv:${result.status}`).run();
      }
    } catch {
      // Non-fatal -- don't block the user action over a CRM tag failure
    }
  }

  return { ...result, contactId };
}

function statusMessage(status) {
  switch (status) {
    case 'spamtrap': return 'This email address cannot be used. Please use a different email.';
    case 'email_disabled': return 'This email mailbox does not exist or is disabled. Please check for typos.';
    case 'disposable': return 'Disposable email addresses are not allowed. Please use a permanent email.';
    case 'invalid': return 'This email address is invalid. Please check for typos.';
    default: return 'This email address cannot be verified. Please use a different email.';
  }
}
