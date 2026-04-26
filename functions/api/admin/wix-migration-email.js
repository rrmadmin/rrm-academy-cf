/**
 * POST /api/admin/wix-migration-email
 * One-off campaign endpoint: send (or dry-run) the Wix-to-Stripe migration
 * outreach email to active STUC donors who have not yet migrated.
 *
 * Body:
 *   dryRun:     boolean (required) -- true=preview only, false=live send
 *   remindOnly: boolean (optional) -- true=reminder mode (sent 13+ days ago)
 *   emails:     string[] (optional) -- override recipient list (cap 100, dedup)
 *
 * Fail-safe: missing or non-boolean dryRun forces dryRun=true.
 */
import { json, optionsResponse, SITE_URL } from '../auth/_shared.js';
import { log } from '../_log.js';
import { validateBody } from '../_validate.js';
import { sendRawEmail } from '../_ses.js';

const BATCH_DELAY_MS = 200;
const BATCH_SIZE = 5;
const MAX_PREVIEW = 5;

const TIER_LABELS = { member: 'Member', hero: 'Uterus Hero', superhero: 'Super Hero' };
const TIER_BUTTON_LABELS = {
  member: 'Become a Member',
  hero: 'Become a Hero',
  superhero: 'Become a Super Hero',
};
const TIER_AMOUNTS = { member: 9, hero: 19, superhero: 99 };
const STANDARD_CENTS = new Set([900, 1900, 9900]);

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

  if (!env.AWS_ACCESS_KEY_ID) {
    return json({ ok: false, error: 'service_unavailable' }, 503);
  }

  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const result = validateBody(body, {
    dryRun:     { type: 'boolean', required: true },
    remindOnly: { type: 'boolean', required: false },
  });

  let dryRun = true;
  if (!result.valid || typeof result.data?.dryRun !== 'boolean') {
    dryRun = true;
  } else {
    dryRun = result.data.dryRun;
  }
  const remindOnly = result.valid ? (result.data?.remindOnly === true) : false;

  const rawEmails = body?.emails;
  let overrideEmails = null;
  if (rawEmails !== undefined) {
    if (!Array.isArray(rawEmails)) {
      return json({ ok: false, error: 'emails must be an array' }, 400);
    }
    if (rawEmails.length === 0) {
      return json({ ok: false, error: 'emails array must not be empty' }, 400);
    }
    if (rawEmails.length > 100) {
      return json({ ok: false, error: 'emails array exceeds cap of 100' }, 400);
    }
    for (const e of rawEmails) {
      if (typeof e !== 'string' || e.length > 254) {
        return json({ ok: false, error: 'emails must be an array of strings' }, 400);
      }
    }
    const seen = new Set();
    overrideEmails = rawEmails
      .map(e => e.trim().toLowerCase())
      .filter(e => { if (seen.has(e)) return false; seen.add(e); return true; });
  }

  const db = env.DB;

  let donors;
  try {
    if (overrideEmails) {
      const placeholders = overrideEmails.map(() => '?').join(',');
      const res = await db.prepare(
        `SELECT wix_subscription_id, email, first_name, tier, amount_cents
         FROM wix_subscription
         WHERE email IN (${placeholders}) COLLATE NOCASE
           AND status='active' AND migration_status='pending'`
      ).bind(...overrideEmails).all();
      donors = res.results || [];
    } else if (remindOnly) {
      const res = await db.prepare(
        "SELECT wix_subscription_id, email, first_name, tier, amount_cents " +
        "FROM wix_subscription " +
        "WHERE status='active' AND migration_status='pending' " +
        "  AND migration_email_sent_at IS NOT NULL " +
        "  AND migration_email_sent_at < datetime('now','-13 days') " +
        "ORDER BY migration_email_sent_at ASC"
      ).all();
      donors = res.results || [];
    } else {
      const res = await db.prepare(
        "SELECT wix_subscription_id, email, first_name, tier, amount_cents " +
        "FROM wix_subscription " +
        "WHERE status='active' AND migration_status='pending' " +
        "  AND migration_email_sent_at IS NULL " +
        "ORDER BY started_at ASC"
      ).all();
      donors = res.results || [];
    }
  } catch (queryErr) {
    log(env, waitUntil, 'admin', 'wix_migration_email_query_fail', 'error', queryErr.message, 0, 500);
    return json({ ok: false, error: 'query_failed' }, 500);
  }

  const previews = [];
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < donors.length; i += BATCH_SIZE) {
    const batch = donors.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(batch.map(async (donor) => {
      const { text, html } = renderMigrationEmail(donor);

      if (dryRun) {
        if (previews.length < MAX_PREVIEW) {
          previews.push({ email: donor.email, tier: donor.tier, text, html });
        }
        return donor.wix_subscription_id;
      }

      await sendRawEmail(env, {
        from: '"RRM Academy" <newsletter@mail.rrmacademy.org>',
        to: donor.email,
        subject: 'Action needed: migrate your STUC subscription (60 seconds)',
        replyTo: 'administrator@rrmacademy.org',
        text,
        html,
        log: { db, source: 'admin/wix-migration-email', category: 'transactional' },
      });

      await db.prepare(
        "UPDATE wix_subscription " +
        "SET migration_email_sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') " +
        "WHERE wix_subscription_id=?"
      ).bind(donor.wix_subscription_id).run();

      return donor.wix_subscription_id;
    }));

    if (!dryRun) {
      sent += results.filter(r => r.status === 'fulfilled').length;
      failed += results.filter(r => r.status === 'rejected').length;
      results.filter(r => r.status === 'rejected').forEach(r => {
        log(env, waitUntil, 'admin', 'wix_migration_send_error', 'error',
          r.reason?.message || 'unknown', 0, 0);
      });

      if (i + BATCH_SIZE < donors.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }
  }

  if (dryRun) {
    return json({
      ok: true,
      dryRun: true,
      totalCandidates: donors.length,
      previewCount: previews.length,
      previews,
    });
  }

  log(env, waitUntil, 'admin', 'wix_migration_email_sent', 'ok',
    `sent=${sent} failed=${failed} remindOnly=${remindOnly}`, 0, 200);

  return json({ ok: true, dryRun: false, sent, failed, total: donors.length });
}

function renderMigrationEmail(donor) {
  const firstName = donor.first_name || 'there';
  const tier = donor.tier || 'member';
  const tierLabel = TIER_LABELS[tier] || 'Member';
  const tierButtonLabel = TIER_BUTTON_LABELS[tier] || 'Become a Member';
  const tierAmount = TIER_AMOUNTS[tier] || 9;
  const amountCents = donor.amount_cents || 0;
  const offAmount = !STANDARD_CENTS.has(amountCents);
  const currentAmount = (amountCents / 100).toFixed(2);

  const offAmountBlock = offAmount
    ? `\nA note on amount: the new tiers are $9, $19, and $99/mo. Your current monthly amount is $${currentAmount}/mo, which doesn't match a tier exactly. The closest tier is ${tierLabel} at $${tierAmount}/mo. If you'd like to keep contributing $${currentAmount}/mo or more, choose a different tier on the page.\n`
    : '';

  const text = [
    `Hi ${firstName},`,
    '',
    `Thank you for being a ${tierLabel} of the Save the Uterus Club. Your support has kept this work alive.`,
    '',
    "We're moving STUC billing off our old Wix system onto our new Stripe-powered checkout -- same monthly amount, same tier, same access. Two improvements:",
    '1. You can update your card, change your tier, or cancel directly from your account at rrmacademy.org/account -- no more emailing us.',
    '2. Receipts will be tax-clean (RRM Foundation, 501(c)(3), EIN 93-4594315).',
    '',
    'What you need to do (60 seconds):',
    '1. Go to rrmacademy.org/save-the-uterus-club/#tiers',
    `2. Click "${tierButtonLabel}" (your current tier)`,
    `3. Use the email ${donor.email} so we can match your account`,
    offAmountBlock,
    "Once you've done that, we'll cancel your old Wix subscription within 24 hours so you're never charged twice.",
    '',
    "If you've already migrated, please don't click again -- check your account at rrmacademy.org/account first to avoid creating a second subscription.",
    '',
    "If you do nothing: your old subscription keeps running for now. We'll send one reminder.",
    '',
    'Questions? Just reply to this email.',
    '',
    '-- Naomi & Brian',
    'RRM Academy',
  ].filter(l => l !== undefined).join('\n');

  const offAmountHtml = offAmount
    ? `<p><strong>A note on amount:</strong> the new tiers are $9, $19, and $99/mo. Your current monthly amount is $${currentAmount}/mo, which doesn&rsquo;t match a tier exactly. The closest tier is <strong>${escapeHtml(tierLabel)}</strong> at $${tierAmount}/mo. If you&rsquo;d like to keep contributing $${currentAmount}/mo or more, choose a different tier on the page.</p>`
    : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Migrate your STUC subscription</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a">
<p>Hi ${escapeHtml(firstName)},</p>
<p>Thank you for being a <strong>${escapeHtml(tierLabel)}</strong> of the Save the Uterus Club. Your support has kept this work alive.</p>
<p>We&rsquo;re moving STUC billing off our old Wix system onto our new Stripe-powered checkout &mdash; same monthly amount, same tier, same access. Two improvements:</p>
<ol>
<li>You can update your card, change your tier, or cancel directly from your account at <a href="${SITE_URL}/account/">rrmacademy.org/account</a> &mdash; no more emailing us.</li>
<li>Receipts will be tax-clean (RRM Foundation, 501(c)(3), EIN 93-4594315).</li>
</ol>
<p><strong>What you need to do (60 seconds):</strong></p>
<ol>
<li>Go to <a href="${SITE_URL}/save-the-uterus-club/#tiers">rrmacademy.org/save-the-uterus-club/#tiers</a></li>
<li>Click <strong>${escapeHtml(tierButtonLabel)}</strong> (your current tier)</li>
<li>Use the email <strong>${escapeHtml(donor.email)}</strong> so we can match your account</li>
</ol>
${offAmountHtml}
<p>Once you&rsquo;ve done that, we&rsquo;ll cancel your old Wix subscription within 24 hours so you&rsquo;re never charged twice.</p>
<p><strong>If you&rsquo;ve already migrated</strong>, please don&rsquo;t click again &mdash; check your account at <a href="${SITE_URL}/account/">rrmacademy.org/account</a> first to avoid creating a second subscription.</p>
<p>If you do nothing: your old subscription keeps running for now. We&rsquo;ll send one reminder.</p>
<p>Questions? Just reply to this email.</p>
<p>&mdash; Naomi &amp; Brian<br>RRM Academy</p>
</body></html>`;

  return { text, html };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
