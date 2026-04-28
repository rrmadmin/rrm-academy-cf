// functions/save-the-uterus-club/migrate.js
// Magic-link landing for STUC Wix→Stripe migration.
// Validates token, enforces email-binding interstitial (INV-3), renders confirm UI.
// Behind STUC_MIGRATION_UX_V2 feature flag.

import { validateMigrationToken } from '../api/billing/_migration-token.js';
import { getSessionIdFromCookie, validateSession } from '../api/auth/_shared.js';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!local || !domain) return '***';
  const visible = local.length > 2 ? local.slice(0, 2) : local[0] || '*';
  return `${visible}***@${domain}`;
}

function logEvent(env, action, indexes) {
  try {
    env.EVENTS?.writeDataPoint({
      blobs: ['billing', 'stuc-migration', action, indexes.reason || '', JSON.stringify(indexes)],
      indexes: [action]
    });
  } catch {}
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html;charset=utf-8' }
  });
}

function renderPage({ title, body, ctas }) {
  const ctaHtml = (ctas || []).map(c =>
    `<a href="${escapeHtml(c.href)}" class="btn ${c.primary ? 'btn-primary' : ''}">${escapeHtml(c.label)}</a>`
  ).join('');
  return htmlResponse(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:Georgia,serif;max-width:560px;margin:80px auto;padding:0 24px;color:#2a2a2a;line-height:1.6}
h1{font-size:24px}.btn{display:inline-block;padding:10px 18px;margin-right:10px;border-radius:8px;
text-decoration:none;border:1px solid #d4c4ab;color:#6b4d2a}.btn-primary{background:#6b4d2a;color:#fff;border-color:#6b4d2a}</style>
</head><body><h1>${escapeHtml(title)}</h1>${body}<div style="margin-top:24px">${ctaHtml}</div></body></html>`);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('t') || '';

  // Feature flag gate: when off, redirect to public STUC page.
  if (env.STUC_MIGRATION_UX_V2 !== 'true') {
    return Response.redirect(`${url.origin}/save-the-uterus-club/`, 302);
  }

  // Required env: signing secret + DB.
  if (!env.MIGRATION_TOKEN_SECRET || !env.DB) {
    return new Response(JSON.stringify({ error: 'service_unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json' }
    });
  }

  // Validate token (HMAC + expiry + payload shape).
  const validation = await validateMigrationToken(token, env.MIGRATION_TOKEN_SECRET);
  if (!validation.ok) {
    logEvent(env, 'token-invalid', { reason: validation.reason });
    return renderPage({
      title: 'This link is no longer valid',
      body: '<p>The link you clicked has expired or is malformed. You can switch over directly from your account.</p>',
      ctas: [{ href: '/account/', label: 'Go to your account', primary: true }]
    });
  }

  // Auth gate (defense-in-depth — middleware should already redirect).
  const sessionId = getSessionIdFromCookie(request);
  const session = sessionId ? await validateSession(env.DB, sessionId) : null;
  if (!session) {
    return Response.redirect(
      `${url.origin}/login/?redirect=${encodeURIComponent(url.pathname + url.search)}`,
      302
    );
  }

  const user = await env.DB.prepare(
    'SELECT id, email FROM user WHERE id = ?'
  ).bind(session.userId).first();
  if (!user) {
    return Response.redirect(`${url.origin}/login/`, 302);
  }

  // Look up the wix_subscription by PK (NOTE: PK is wix_subscription_id, not id).
  const wixSub = await env.DB.prepare(
    "SELECT wix_subscription_id, email, tier, amount_cents, next_expected_at, status, migration_status " +
    "FROM wix_subscription WHERE wix_subscription_id = ?"
  ).bind(validation.wix_sub_id).first();

  if (!wixSub) {
    logEvent(env, 'token-stale', { wix_sub_id: validation.wix_sub_id });
    return renderPage({
      title: "Donation not found",
      body: "<p>We couldn't find the donation referenced by this link. Please contact us.</p>",
      ctas: [{ href: 'mailto:administrator@rrmacademy.org', label: 'Contact us', primary: true }]
    });
  }

  if (wixSub.migration_status !== 'pending') {
    logEvent(env, 'already-migrated', { wix_sub_id: wixSub.wix_subscription_id });
    return renderPage({
      title: "You've already switched over",
      body: '<p>This donation has already been moved to our new system. Manage it from your account.</p>',
      ctas: [{ href: '/account/', label: 'Go to your account', primary: true }]
    });
  }

  // INV-3: email-binding assertion. Compares wixSub.email vs the SESSION user's email
  // (NOT data.user.email). COLLATE NOCASE behavior is mirrored here in JS via toLowerCase.
  if (String(wixSub.email).toLowerCase() !== String(user.email).toLowerCase()) {
    logEvent(env, 'binding-mismatch', { wix_sub_id: wixSub.wix_subscription_id });
    return renderPage({
      title: 'Sign in with the matching email',
      body: `<p>This link was sent to <strong>${escapeHtml(maskEmail(wixSub.email))}</strong>. You're signed in as <strong>${escapeHtml(user.email)}</strong>.</p>
<p>Please sign in with the matching email, or contact us if you've changed your email.</p>`,
      ctas: [
        { href: '/api/auth/logout?next=' + encodeURIComponent(url.pathname + url.search), label: 'Sign in with another account', primary: true },
        { href: 'mailto:administrator@rrmacademy.org?subject=Existing%20donation%20linkage', label: 'Contact us' }
      ]
    });
  }

  // Render confirmation interstitial. Click triggers JS POST to /api/create-checkout.
  const tierLabel =
    wixSub.tier === 'superhero' ? 'Uterus Super Hero' :
    wixSub.tier === 'hero' ? 'Uterus Hero' : 'Member';
  const amountStr = `$${(wixSub.amount_cents / 100).toFixed(0)}`;
  const nextDate = wixSub.next_expected_at
    ? new Date(wixSub.next_expected_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'your scheduled date';

  logEvent(env, 'interstitial-shown', { wix_sub_id: wixSub.wix_subscription_id, tier: wixSub.tier });

  // Note: wix_subscription_id is JSON-stringified into client JS to avoid quote-injection.
  return htmlResponse(`<!doctype html><html><head><meta charset="utf-8"><title>Confirm your switch</title>
<style>body{font-family:Georgia,serif;max-width:560px;margin:80px auto;padding:0 24px;color:#2a2a2a;line-height:1.6}
h1{font-size:24px}button{padding:12px 22px;background:#6b4d2a;color:#fff;border:0;border-radius:8px;font-family:inherit;font-size:15px;cursor:pointer}
button:disabled{opacity:0.6;cursor:not-allowed}</style></head><body>
<h1>Switch your donation to our new system</h1>
<p>You're about to move your <strong>${escapeHtml(tierLabel)} ${escapeHtml(amountStr)}/month</strong> donation to our new system.</p>
<p>Your next donation date stays the same: <strong>${escapeHtml(nextDate)}</strong>.</p>
<button id="continue">Continue &rarr;</button>
<script>
const btn = document.getElementById('continue');
btn.addEventListener('click', async () => {
  btn.disabled = true; btn.textContent = 'Loading...';
  try {
    const res = await fetch('/api/create-checkout', {
      method: 'POST', credentials: 'include',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({ mode: 'subscription', wix_sub_id: ${JSON.stringify(wixSub.wix_subscription_id)} })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      btn.textContent = 'Try again';
      btn.disabled = false;
      alert(err.error || 'Could not start checkout. Please try again.');
      return;
    }
    const { url: checkoutUrl } = await res.json();
    window.location.href = checkoutUrl;
  } catch (e) {
    btn.textContent = 'Try again';
    btn.disabled = false;
    alert('Network error. Please try again.');
  }
});
</script></body></html>`);
}
