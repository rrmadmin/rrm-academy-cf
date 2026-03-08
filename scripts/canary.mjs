#!/usr/bin/env node

// Production canary — tests critical endpoints every 30 minutes via cron.
// Alerts via SES email + Telegram on failure. Silent on success.
//
// Required env vars (sourced from 1Password via cron wrapper):
//   AWS_ACCESS_KEY_ID     — SES credentials
//   AWS_SECRET_ACCESS_KEY — SES credentials
//   AWS_SES_REGION        — SES region (default: us-east-1)
//   TELEGRAM_BOT_TOKEN    — Telegram bot token for instant alerts
//   TELEGRAM_CHAT_ID      — Telegram chat ID to send alerts to
//
// Cron (every 30 min):
//   */30 * * * * /Users/brian/iCode/projects/rrm-academy-cf/scripts/canary-run.sh >> /tmp/canary.log 2>&1

const SITE = 'https://rrmacademy.org';
const ALERT_TO = 'administrator@rrmacademy.org';
const ALERT_FROM = 'RRM Canary <contact@mail.rrmacademy.org>';
const CANARY_SECRET = process.env.CANARY_SECRET || '';

const checks = [
  {
    name: 'Homepage',
    url: `${SITE}/`,
    expect: (r) => r.status === 200,
  },
  {
    name: 'Quiz API endpoint exists',
    url: `${SITE}/api/courses/quiz?courseId=masterclass-endo-surgery&stepId=mc-intro-3`,
    // 401 = endpoint exists but requires auth. 404 = endpoint missing.
    expect: (r) => r.status === 401 || r.status === 200,
  },
  {
    name: 'Survey validate endpoint exists',
    url: `${SITE}/api/survey/validate?token=canary-test`,
    // 200 with valid:false = endpoint exists. 404 = missing.
    expect: (r, body) => r.status === 200 && body && body.valid === false,
  },
  {
    name: 'Donation checkout',
    url: `${SITE}/api/create-checkout`,
    method: 'POST',
    body: JSON.stringify({ mode: 'payment', amount: 500 }),
    headers: { 'Content-Type': 'application/json', ...(CANARY_SECRET && { 'X-Canary-Token': CANARY_SECRET }) },
    expect: (r, body) => r.status === 200 && body.ok && body.url,
  },
  {
    name: 'Subscription checkout (member tier)',
    url: `${SITE}/api/create-checkout`,
    method: 'POST',
    body: JSON.stringify({ mode: 'subscription', tier: 'member' }),
    headers: { 'Content-Type': 'application/json', ...(CANARY_SECRET && { 'X-Canary-Token': CANARY_SECRET }) },
    expect: (r, body) => r.status === 200 && body.ok && body.url,
  },
  {
    name: 'Contact form (honeypot bypass)',
    url: `${SITE}/api/contact/submit`,
    method: 'POST',
    body: JSON.stringify({ name: 'Canary', email: 'canary@test.com', message: 'canary check', website: 'honeypot' }),
    headers: { 'Content-Type': 'application/json' },
    // Honeypot filled → should return 200 ok:true without sending email
    expect: (r, body) => r.status === 200 && body.ok,
  },
];

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.error('Telegram not configured — skipping');
    return;
  }

  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    if (resp.ok) {
      console.error('Telegram alert sent');
    } else {
      console.error('Telegram send failed:', await resp.text());
    }
  } catch (err) {
    console.error('Telegram fetch error:', err.message);
  }
}

async function sendEmail(subject, text) {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    console.error('No AWS SES credentials — skipping email');
    return;
  }

  try {
    const { AwsClient } = await import('aws4fetch');
    const region = process.env.AWS_SES_REGION || 'us-east-1';
    const aws = new AwsClient({ accessKeyId, secretAccessKey, region, service: 'ses' });

    const resp = await aws.fetch(
      `https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          FromEmailAddress: ALERT_FROM,
          Destination: { ToAddresses: [ALERT_TO] },
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: { Text: { Data: text, Charset: 'UTF-8' } },
            },
          },
        }),
      }
    );
    if (resp.ok) {
      console.error('Alert email sent to', ALERT_TO);
    } else {
      console.error('Email send failed:', await resp.text());
    }
  } catch (err) {
    console.error('Email fetch error:', err.message);
  }
}

async function runChecks() {
  const failures = [];
  const timestamp = new Date().toISOString();

  for (const check of checks) {
    try {
      const resp = await fetch(check.url, {
        method: check.method || 'GET',
        headers: check.headers || {},
        body: check.body || undefined,
      });

      let body = null;
      try {
        body = await resp.json();
      } catch {
        // Some responses aren't JSON
      }

      const passed = check.expect(resp, body);
      if (!passed) {
        failures.push({ name: check.name, status: resp.status, body });
      }
    } catch (err) {
      failures.push({ name: check.name, error: err.message });
    }
  }

  if (failures.length === 0) {
    console.log(`${timestamp} CANARY OK — ${checks.length}/${checks.length} checks passed`);
    return;
  }

  // Format failure report
  const report = failures.map((f) => {
    if (f.error) return `FAIL: ${f.name} — ${f.error}`;
    return `FAIL: ${f.name} — HTTP ${f.status} ${JSON.stringify(f.body || '').slice(0, 200)}`;
  }).join('\n');

  console.error(`${timestamp} CANARY ALERT — ${failures.length}/${checks.length} checks failed:\n${report}`);

  // Fire both alerts in parallel
  const telegramMsg = [
    `\u{1F6A8} <b>CANARY ALERT</b>`,
    `${failures.length} of ${checks.length} checks failed`,
    '',
    ...failures.map((f) => {
      if (f.error) return `\u{274C} <b>${f.name}</b>\n${f.error}`;
      return `\u{274C} <b>${f.name}</b>\nHTTP ${f.status}`;
    }),
    '',
    `<i>${timestamp}</i>`,
  ].join('\n');

  const emailBody = [
    `RRM Academy production canary detected ${failures.length} failure(s) at ${timestamp}:`,
    '',
    report,
    '',
    `Total: ${failures.length} failed, ${checks.length - failures.length} passed out of ${checks.length}`,
    '',
    '---',
    'Automated alert from scripts/canary.mjs',
  ].join('\n');

  await Promise.all([
    sendTelegram(telegramMsg),
    sendEmail(`[CANARY] ${failures.length} check(s) failed on rrmacademy.org`, emailBody),
  ]);
}

runChecks();
