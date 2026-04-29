// functions/save-the-uterus-club/migrate/index.js
// Magic-link landing for STUC Wix→Stripe migration.
// Validates token, enforces email-binding interstitial (INV-3), renders confirm UI.
// Behind STUC_MIGRATION_UX_V2 feature flag.

import { validateMigrationToken } from '../../api/billing/_migration-token.js';
import { getSessionIdFromCookie, validateSession, SITE_URL } from '../../api/auth/_shared.js';

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
  } catch {
    // AE telemetry is best-effort; never break user flow on logging failure
  }
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html;charset=utf-8' }
  });
}

function renderShell({ title, content }) {
  return htmlResponse(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0 16px;
      background: #f7f5f3;
      font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
      font-size: 15px;
      line-height: 1.6;
      color: #313131;
    }
    .page-wrap {
      max-width: 600px;
      margin: clamp(24px, 8vh, 64px) auto;
    }
    .site-header {
      text-align: center;
      padding: 0 0 8px;
      font-family: 'Cormorant Garamond', Georgia, 'Times New Roman', serif;
      font-weight: 600;
      font-size: 1.625rem;
      color: #313131;
      letter-spacing: normal;
      line-height: 1.4;
      margin-bottom: 24px;
    }
    .site-header a {
      color: inherit;
      text-decoration: none;
    }
    .card {
      background: #ffffff;
      border: 1px solid #dddbd8;
      border-radius: 8px;
      padding: 32px 28px;
    }
    h1 {
      font-family: 'Cormorant Garamond', Georgia, 'Times New Roman', serif;
      font-weight: 600;
      font-size: 1.5rem;
      color: #313131;
      margin: 0 0 16px 0;
      line-height: 1.3;
    }
    p {
      color: #313131;
      margin: 0 0 14px 0;
    }
    p.secondary {
      color: #636261;
      font-size: 0.9rem;
    }
    .actions {
      margin-top: 24px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    .btn-primary {
      display: inline-block;
      padding: 12px 22px;
      background: #725e7e;
      color: #ffffff;
      text-decoration: none;
      border: none;
      border-radius: 6px;
      font-family: inherit;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      line-height: 1.4;
      transition: background 0.15s;
    }
    .btn-primary:hover { background: #4c3e54; }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-secondary {
      display: inline-block;
      padding: 12px 22px;
      background: transparent;
      color: #313131;
      text-decoration: none;
      border: 1px solid #dddbd8;
      border-radius: 6px;
      font-family: inherit;
      font-size: 15px;
      font-weight: 400;
      cursor: pointer;
      line-height: 1.4;
      transition: border-color 0.15s;
    }
    .btn-secondary:hover { border-color: #725e7e; }
    .error-region {
      display: none;
      margin-top: 16px;
      padding: 12px 16px;
      background: #fff8f8;
      border: 1px solid #e8c5c5;
      border-radius: 6px;
      color: #5c2a2a;
      font-size: 0.9rem;
      line-height: 1.5;
    }
    .off-amount-panel {
      display: none;
      margin-top: 20px;
      padding: 20px;
      background: #faf9f8;
      border: 1px solid #dddbd8;
      border-radius: 6px;
    }
    .off-amount-panel h2 {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-weight: 600;
      font-size: 1.125rem;
      color: #313131;
      margin: 0 0 10px 0;
    }
    .site-footer {
      text-align: center;
      padding: 32px 16px 24px;
      color: #636261;
      font-size: 13px;
      line-height: 1.5;
      margin-top: 0;
    }
    .site-footer a {
      color: #636261;
      text-decoration: underline;
    }
    .site-footer a:hover { color: #313131; }
  </style>
</head>
<body>
  <div class="page-wrap">
    <div class="site-header">
      <a href="/">RRM Academy</a>
    </div>
    ${content}
    <footer class="site-footer">
      A project of the <strong>RRM Foundation</strong> &mdash; 501(c)(3), EIN: 93-4594315<br>
      <a href="/privacy-policy/">Privacy</a>
      &nbsp;&middot;&nbsp;
      <a href="/terms-of-use/">Terms</a>
      &nbsp;&middot;&nbsp;
      <a href="mailto:administrator@rrmacademy.org">Contact</a>
    </footer>
  </div>
</body>
</html>`);
}

function renderPage({ title, body, ctas }) {
  const ctaHtml = (ctas || []).map(c =>
    `<a href="${escapeHtml(c.href)}" class="${c.primary ? 'btn-primary' : 'btn-secondary'}">${escapeHtml(c.label)}</a>`
  ).join('');
  return renderShell({
    title,
    content: `<div class="card">
      <h1>${escapeHtml(title)}</h1>
      ${body}
      <div class="actions">${ctaHtml}</div>
    </div>`
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('t') || '';

  // Feature flag gate: when off, redirect to public STUC page.
  // Use SITE_URL (canonical rrmacademy.org) instead of url.origin — when this
  // Function runs behind the rrm-router service binding, url.origin is
  // rrm-academy.pages.dev, which 404s on direct hits.
  if (env.STUC_MIGRATION_UX_V2 !== 'true') {
    return Response.redirect(`${SITE_URL}/save-the-uterus-club/`, 302);
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
      body: `<p>The link you clicked has expired or wasn't valid. To switch your donation over, please email us &mdash; we'll send a fresh link within one business day.</p>`,
      ctas: [
        {
          href: 'mailto:administrator@rrmacademy.org?subject=New%20switch-over%20link%20please&body=My%20previous%20switch-over%20link%20expired.%20Please%20send%20me%20a%20new%20one.',
          label: 'Email us for a new link',
          primary: true
        },
        { href: '/account/', label: 'Go to your account', primary: false }
      ]
    });
  }

  // Auth gate (defense-in-depth — middleware should already redirect).
  const sessionId = getSessionIdFromCookie(request);
  const session = sessionId ? await validateSession(env.DB, sessionId) : null;
  if (!session) {
    return Response.redirect(
      `${SITE_URL}/login/?redirect=${encodeURIComponent(url.pathname + url.search)}`,
      302
    );
  }

  const user = await env.DB.prepare(
    'SELECT id, email FROM user WHERE id = ?'
  ).bind(session.userId).first();
  if (!user) {
    return Response.redirect(`${SITE_URL}/login/`, 302);
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
      body: `<p>We couldn't find the donation linked to this address. To get a fresh link, please email us &mdash; we'll sort it out within one business day.</p>`,
      ctas: [
        {
          href: 'mailto:administrator@rrmacademy.org?subject=New%20switch-over%20link%20please&body=My%20previous%20switch-over%20link%20expired.%20Please%20send%20me%20a%20new%20one.',
          label: 'Email us for a new link',
          primary: true
        },
        { href: '/account/', label: 'Go to your account', primary: false }
      ]
    });
  }

  if (wixSub.migration_status !== 'pending') {
    logEvent(env, 'already-migrated', { wix_sub_id: wixSub.wix_subscription_id });
    return renderPage({
      title: "You've already switched over",
      body: `<p>Your donation is now running through our new payment system. You won't be double-charged &mdash; we set the bridge up so your previous donation is cancelled by our team within 24 hours of your switch.</p>
<p class="secondary">If you see two charges in the same month, please email us.</p>`,
      ctas: [
        { href: '/account/', label: 'Go to your account', primary: true },
        {
          href: 'mailto:administrator@rrmacademy.org?subject=Possible%20double%20charge',
          label: 'Email us about a charge',
          primary: false
        }
      ]
    });
  }

  // INV-3: email-binding assertion. Compares wixSub.email vs the SESSION user's email
  // (NOT data.user.email). COLLATE NOCASE behavior is mirrored here in JS via toLowerCase.
  if (String(wixSub.email).toLowerCase() !== String(user.email).toLowerCase()) {
    logEvent(env, 'binding-mismatch', { wix_sub_id: wixSub.wix_subscription_id });
    return renderPage({
      title: 'Sign in with the matching email',
      body: `<p>This link was sent to <strong>${escapeHtml(maskEmail(wixSub.email))}</strong>. You're signed in as <strong>${escapeHtml(user.email)}</strong>.</p>
<p>Please sign in with the matching email, or contact us if you've changed your email address.</p>`,
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
  const amountDollars = (wixSub.amount_cents / 100).toFixed(0);
  const amountStr = `$${amountDollars}`;

  // Past-date detection: if next_expected_at is null, in the past, or within 24 hours, treat as stale.
  const nextSec = wixSub.next_expected_at
    ? Math.floor(new Date(wixSub.next_expected_at).getTime() / 1000)
    : null;
  const nowSec = Math.floor(Date.now() / 1000);
  const nextDateStale = nextSec !== null && nextSec < nowSec + 86400;

  const nextDateFormatted = wixSub.next_expected_at
    ? new Date(wixSub.next_expected_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  let dateBlock;
  if (nextDateStale && nextDateFormatted) {
    dateBlock = `<p>Your scheduled donation date (<strong>${escapeHtml(nextDateFormatted)}</strong>) has already passed. To keep supporting STUC, we'll start a fresh monthly subscription billed today. Going forward, you'll be charged on the same day each month.</p>`;
  } else if (nextDateFormatted) {
    dateBlock = `<p>Your next donation date stays the same: <strong>${escapeHtml(nextDateFormatted)}</strong>. Your card won't be charged today &mdash; this is a bridge, not a free trial. Stripe begins charging on <strong>${escapeHtml(nextDateFormatted)}</strong>.</p>`;
  } else {
    dateBlock = `<p>We'll set up your monthly donation now.</p>`;
  }

  logEvent(env, 'interstitial-shown', { wix_sub_id: wixSub.wix_subscription_id, tier: wixSub.tier });

  // Note: wix_subscription_id is JSON-stringified into client JS to avoid quote-injection.
  const wixSubIdJson = JSON.stringify(wixSub.wix_subscription_id);
  const amountDollarsJson = JSON.stringify(amountDollars);

  return renderShell({
    title: 'Switch your donation',
    content: `<div class="card">
  <h1>Switch your donation</h1>
  <p>You're about to move your <strong>${escapeHtml(tierLabel)} ${escapeHtml(amountStr)}/month</strong> donation to our payment system.</p>
  ${dateBlock}
  <div id="error-region" class="error-region" role="alert" aria-live="polite"></div>
  <div id="off-amount-panel" class="off-amount-panel">
    <h2>Your donation is at a custom amount</h2>
    <p>Your current donation is <strong id="off-amount-display"></strong>/month, which isn't one of our three standard tiers.</p>
    <div class="actions">
      <button id="btn-continue-off-amount" class="btn-primary">Continue at <span id="off-amount-btn-label"></span>/month</button>
      <a id="off-amount-email-link" href="#" class="btn-secondary">Email us to switch tiers</a>
    </div>
  </div>
  <div class="actions" id="main-actions">
    <button id="btn-continue" class="btn-primary">Switch my donation</button>
  </div>
</div>
<script>
(function () {
  var wixSubId = ${wixSubIdJson};
  var amountDollars = ${amountDollarsJson};

  var btnContinue = document.getElementById('btn-continue');
  var errorRegion = document.getElementById('error-region');
  var offAmountPanel = document.getElementById('off-amount-panel');
  var mainActions = document.getElementById('main-actions');
  var btnOffAmount = document.getElementById('btn-continue-off-amount');

  function showError(msg) {
    errorRegion.textContent = msg;
    errorRegion.style.display = 'block';
  }

  function hideError() {
    errorRegion.style.display = 'none';
    errorRegion.textContent = '';
  }

  function showOffAmount(amount_cents) {
    var dollars = (amount_cents / 100).toFixed(0);
    document.getElementById('off-amount-display').textContent = '$' + dollars;
    document.getElementById('off-amount-btn-label').textContent = '$' + dollars;
    var emailBody = encodeURIComponent(
      "I'd like to change my $" + dollars + "/month donation to a standard tier. My donation ID: " + wixSubId
    );
    document.getElementById('off-amount-email-link').href =
      'mailto:administrator@rrmacademy.org?subject=Switch%20my%20donation%20tier&body=' + emailBody;
    offAmountPanel.style.display = 'block';
    mainActions.style.display = 'none';
  }

  async function doCheckout(acknowledgeOffAmount) {
    hideError();
    var payload = { mode: 'subscription', wix_sub_id: wixSubId };
    if (acknowledgeOffAmount) payload.acknowledge_off_amount = true;

    var res;
    try {
      res = await fetch('/api/create-checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      showError('We couldn’t start your checkout. Try again, or email administrator@rrmacademy.org if this keeps happening.');
      return null;
    }

    if (res.status === 412) {
      var errData = await res.json().catch(function () { return {}; });
      if (errData.error === 'off_amount') {
        showOffAmount(errData.amount_cents);
        return null;
      }
    }

    if (!res.ok) {
      var errBody = await res.json().catch(function () { return {}; });
      var code = errBody.error || '';
      var msg;
      if (code === 'migration_in_progress') {
        msg = 'We’re already starting your switch. Refresh this page in a minute and try again.';
      } else if (res.status === 503) {
        msg = 'Our payment system is briefly unavailable. Try again in a moment.';
      } else {
        msg = 'We couldn’t start your checkout. Try again, or email administrator@rrmacademy.org if this keeps happening.';
      }
      showError(msg);
      return null;
    }

    var data = await res.json().catch(function () { return {}; });
    return data.url || null;
  }

  btnContinue.addEventListener('click', async function () {
    btnContinue.disabled = true;
    btnContinue.textContent = 'Starting your checkout…';
    var checkoutUrl = await doCheckout(false);
    if (checkoutUrl) {
      window.location.href = checkoutUrl;
    } else {
      btnContinue.textContent = 'Switch my donation';
      btnContinue.disabled = false;
    }
  });

  btnOffAmount.addEventListener('click', async function () {
    btnOffAmount.disabled = true;
    btnOffAmount.textContent = 'Starting your checkout…';
    var checkoutUrl = await doCheckout(true);
    if (checkoutUrl) {
      window.location.href = checkoutUrl;
    } else {
      btnOffAmount.textContent = 'Continue at $' + amountDollars + '/month';
      btnOffAmount.disabled = false;
    }
  });
})();
</script>`
  });
}
