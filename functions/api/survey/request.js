/**
 * POST /api/survey/request
 * Accepts { email }, generates a magic-link token, stores in KV, sends email via Resend.
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

const TOKEN_TTL = 90 * 24 * 60 * 60; // 90 days in seconds
const RATE_LIMIT_SECONDS = 600;       // 10 minutes between emails to same address

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SURVEY_TOKENS) {
    return json({ ok: false, error: 'Server misconfigured' }, 500);
  }
  if (!env.RESEND_API_KEY) {
    return json({ ok: false, error: 'Server misconfigured' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Valid email required' }, 400);
  }

  // Rate limit: 1 email per 10 minutes per address
  const existing = await env.SURVEY_TOKENS.get(`email:${email}`, 'json');
  if (existing) {
    const elapsed = (Date.now() - existing.created) / 1000;
    if (elapsed < RATE_LIMIT_SECONDS) {
      return json({ ok: false, error: 'Check your inbox. A survey link was already sent.' }, 429);
    }
  }

  // Generate token
  const token = crypto.randomUUID();
  const now = Date.now();

  // Carry through UTM / userorigin params
  const url = new URL(request.url);
  const userorigin = url.searchParams.get('userorigin') || body.userorigin || '';
  const utmSource = url.searchParams.get('utm_source') || body.utm_source || '';

  // Store token → email mapping
  await env.SURVEY_TOKENS.put(
    `token:${token}`,
    JSON.stringify({ email, created: now, used: false, userorigin, utmSource }),
    { expirationTtl: TOKEN_TTL }
  );

  // Store email → token reverse lookup (for rate limiting)
  await env.SURVEY_TOKENS.put(
    `email:${email}`,
    JSON.stringify({ token, created: now }),
    { expirationTtl: RATE_LIMIT_SECONDS }
  );

  // Build magic link
  let surveyUrl = `https://rrmacademy.org/endo-survey/take?token=${token}`;
  if (userorigin) surveyUrl += `&userorigin=${encodeURIComponent(userorigin)}`;
  if (utmSource) surveyUrl += `&utm_source=${encodeURIComponent(utmSource)}`;

  // Send email via Resend
  let emailResp;
  try {
    emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'RRM Academy <survey@rrmacademy.org>',
        to: [email],
        subject: 'Your Endometriosis Symptom Self-Survey',
        html: buildEmailHtml(surveyUrl),
      }),
    });
  } catch (err) {
    console.error('Resend fetch failed:', err.message);
    await env.SURVEY_TOKENS.delete(`email:${email}`);
    return json({ ok: false, error: 'Failed to send email. Please try again.' }, 502);
  }

  if (!emailResp.ok) {
    const errText = await emailResp.text();
    console.error('Resend error:', errText);
    await env.SURVEY_TOKENS.delete(`email:${email}`);
    return json({ ok: false, error: 'Failed to send email. Please try again.' }, 502);
  }

  return json({ ok: true });
}

function buildEmailHtml(surveyUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f5f3;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="background:#ffffff;border-radius:8px;padding:40px 32px;border-top:4px solid #725e7e;">
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#313131;margin:0 0 24px;font-weight:normal;">
        Your Endometriosis Symptom Self-Survey
      </h1>
      <p style="font-size:16px;line-height:1.7;color:#636261;margin:0 0 16px;">
        Thank you for taking this step toward understanding your symptoms.
      </p>
      <p style="font-size:16px;line-height:1.7;color:#636261;margin:0 0 24px;">
        This evidence-based self-survey was developed by Dr. Naomi Whittaker, a board-certified OB/GYN specializing in endometriosis excision surgery, to help you identify symptoms that may warrant further evaluation.
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${surveyUrl}" style="display:inline-block;background:#725e7e;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:9999px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:500;">
          Take the Survey
        </a>
      </div>
      <p style="font-size:14px;line-height:1.6;color:#94918e;margin:24px 0 0;">
        This link is for your use only and can only be used once. If you did not request this survey, you can safely ignore this email.
      </p>
      <p style="font-size:12px;line-height:1.6;color:#b0adaa;margin:16px 0 0;">
        Your anonymized responses may be used for research purposes and participation in the survey indicates consent.
      </p>
    </div>
    <div style="text-align:center;padding:24px 0 0;">
      <p style="font-size:12px;color:#94918e;margin:0;">
        RRM Academy &middot; A project of the RRM Foundation, a 501(c)(3) nonprofit
      </p>
    </div>
  </div>
</body>
</html>`;
}
