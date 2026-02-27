/**
 * POST /api/contact/submit
 * Validates Turnstile token, rate-limits by IP, sends email via Resend.
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

  if (!env.RESEND_API_KEY) {
    return json({ ok: false, error: 'Server misconfigured' }, 500);
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  // Honeypot — if filled, silently accept (bots think they succeeded)
  if (body.website) {
    return json({ ok: true });
  }

  // Validate fields
  const name = (body.name || '').trim().replace(/[\x00-\x1f\x7f]/g, '');
  const email = (body.email || '').trim().toLowerCase();
  const message = (body.message || '').trim();

  if (!name || name.length > 200) {
    return json({ ok: false, error: 'Name is required.' }, 400);
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Valid email is required.' }, 400);
  }
  if (!message || message.length < 10 || message.length > 5000) {
    return json({ ok: false, error: 'Message must be between 10 and 5,000 characters.' }, 400);
  }

  // Auto-generate subject identifying the sender and source
  const subject = `Contact form: ${name}`;

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
    // Turnstile is configured but no token provided — likely a bot
    return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403);
  } else {
    console.warn('CF_TURNSTILE_SECRET not set — Turnstile verification disabled');
  }

  // Send notification email via Resend
  let emailResp;
  try {
    emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${name} via RRM Academy <contact@rrmacademy.org>`,
        to: ['administrator@rrmacademy.org'],
        reply_to: email,
        subject: `[Contact] ${name} (${email})`,
        text: [
          `Name: ${name}`,
          `Email: ${email}`,
          '',
          message,
          '',
          '---',
          `Sent from rrmacademy.org/contact at ${new Date().toISOString()}`,
        ].join('\n'),
      }),
    });
  } catch (err) {
    console.error('Resend fetch failed:', err.message);
    return json({ ok: false, error: 'Failed to send message. Please try again.' }, 502);
  }

  if (!emailResp.ok) {
    const errText = await emailResp.text();
    console.error('Resend error:', errText);
    return json({ ok: false, error: 'Failed to send message. Please try again.' }, 502);
  }

  // Send confirmation to the sender
  try {
    const confirmResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'RRM Academy <contact@rrmacademy.org>',
        to: [email],
        subject: 'We received your message — RRM Academy',
        text: [
          `Hi ${name},`,
          '',
          'Thank you for reaching out to RRM Academy. We received your message and will get back to you as soon as possible.',
          '',
          'Best regards,',
          'RRM Academy',
          'https://rrmacademy.org',
        ].join('\n'),
      }),
    });

    if (!confirmResp.ok) {
      console.error('Confirmation email failed:', await confirmResp.text());
    }
  } catch (err) {
    console.error('Confirmation email fetch failed:', err.message);
  }

  return json({ ok: true });
}
