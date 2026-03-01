/**
 * POST /api/newsletter/subscribe
 * Validates Turnstile token, adds subscriber to Buttondown, optionally updates D1.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://rrmacademy.org',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.BUTTONDOWN_API_KEY) {
    console.error('BUTTONDOWN_API_KEY not configured');
    return json({ ok: false, error: 'Server misconfigured' }, 500);
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  // Honeypot
  if (body.website) {
    return json({ ok: true });
  }

  // Validate email
  const email = (body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Valid email is required.' }, 400);
  }

  // Verify Turnstile token
  const turnstileToken = body.turnstileToken || '';
  if (env.CF_TURNSTILE_SECRET && turnstileToken) {
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const verifyResp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.CF_TURNSTILE_SECRET,
        response: turnstileToken,
        remoteip: ip,
      }),
    });
    const result = await verifyResp.json();
    if (!result.success) {
      return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403);
    }
  } else if (env.CF_TURNSTILE_SECRET) {
    return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403);
  }

  // Add to Buttondown
  let bdResp;
  try {
    bdResp = await fetch('https://api.buttondown.com/v1/subscribers', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${env.BUTTONDOWN_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        metadata: { source: 'website' },
        tags: ['website-signup'],
      }),
    });
  } catch (err) {
    console.error('Buttondown fetch failed:', err.message);
    return json({ ok: false, error: 'Something went wrong. Please try again.' }, 502);
  }

  if (!bdResp.ok) {
    const errBody = await bdResp.text();
    // Buttondown returns 400 if already subscribed
    if (bdResp.status === 400 && errBody.includes('already')) {
      return json({ ok: true, message: 'You are already subscribed.' });
    }
    console.error('Buttondown error:', bdResp.status, errBody);
    return json({ ok: false, error: 'Something went wrong. Please try again.' }, 502);
  }

  // Optionally update D1 newsletter_opt_in if user exists
  if (env.DB) {
    try {
      await env.DB.prepare(
        "UPDATE user SET newsletter_opt_in = 1, newsletter_opted_in_at = datetime('now') WHERE email = ? COLLATE NOCASE"
      ).bind(email).run();
    } catch (err) {
      // Non-fatal: subscriber is added to Buttondown even if D1 update fails
      console.error('D1 newsletter_opt_in update failed:', err.message);
    }
  }

  return json({ ok: true, message: 'You are subscribed!' });
}
