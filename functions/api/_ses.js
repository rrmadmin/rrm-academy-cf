import { AwsClient } from 'aws4fetch';

async function insertEmailLog(db, { event, email, category, source, subject, detail, send_id }) {
  try {
    await db.prepare(
      'INSERT INTO email_log (event, email, category, source, subject, detail, send_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      event,
      email.toLowerCase(),
      category,
      source,
      subject || null,
      detail ? String(detail).slice(0, 500) : null,
      send_id || null,
    ).run();
  } catch {
    // best-effort -- never crash the caller
  }
}

export async function logEmailFailure(db, { email, category, source, subject, detail }) {
  if (!db) return;
  await insertEmailLog(db, { event: 'failed', email, category, source, subject, detail });
}

export async function sendEmail(env, { from, to, subject, html, text, replyTo, log }) {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS SES credentials not configured');
  }
  const region = env.AWS_SES_REGION || 'us-east-1';
  const aws = new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region,
    service: 'ses',
  });

  const payload = {
    FromEmailAddress: from,
    Destination: { ToAddresses: Array.isArray(to) ? to : [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {},
      },
    },
  };

  if (html) payload.Content.Simple.Body.Html = { Data: html, Charset: 'UTF-8' };
  if (text) payload.Content.Simple.Body.Text = { Data: text, Charset: 'UTF-8' };
  if (replyTo) payload.ReplyToAddresses = [replyTo];

  const res = await aws.fetch(
    `https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error('SES error:', res.status, body);
    throw new Error(`SES request failed (${res.status})`);
  }

  const data = await res.json();
  const messageId = data?.MessageId || null;

  if (log?.db) {
    const recipient = Array.isArray(to) ? to[0] : to;
    await insertEmailLog(log.db, {
      event: 'send',
      email: recipient,
      category: log.category || 'transactional',
      source: log.source || '',
      subject,
      detail: messageId,
      send_id: messageId,
    });
  }

  return { messageId };
}

/**
 * Send a raw MIME email via SESv2. Supports custom headers (List-Unsubscribe, etc.).
 * Used for newsletter sends. Transactional emails should use sendEmail() (Simple format).
 */
export async function sendRawEmail(env, { from, to, subject, html, text, replyTo, headers, configurationSet, log }) {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS SES credentials not configured');
  }
  const region = env.AWS_SES_REGION || 'us-east-1';
  const aws = new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region,
    service: 'ses',
  });

  const boundary = `----=_Part_${crypto.randomUUID().replace(/-/g, '')}`;
  const toAddr = Array.isArray(to) ? to.join(', ') : to;

  const messageId = `<${crypto.randomUUID()}@mail.rrmacademy.org>`;

  let rawHeaders = [
    `From: ${from}`,
    `To: ${toAddr}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Precedence: bulk',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (replyTo) rawHeaders.push(`Reply-To: ${replyTo}`);
  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      rawHeaders.push(`${name}: ${value}`);
    }
  }

  let body = rawHeaders.join('\r\n') + '\r\n\r\n';

  if (text) {
    body += `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n`;
  }
  if (html) {
    body += `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n`;
  }
  body += `--${boundary}--\r\n`;

  // Base64 encode for SES Raw format (safe for non-ASCII via TextEncoder)
  const bytes = new TextEncoder().encode(body);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const rawData = btoa(binary);

  const payload = {
    Content: { Raw: { Data: rawData } },
  };
  if (configurationSet) {
    payload.ConfigurationSetName = configurationSet;
  }

  const res = await aws.fetch(
    `https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    console.error('SES raw error:', res.status, errBody);
    throw new Error(`SES raw request failed (${res.status})`);
  }

  const data = await res.json();
  const sesMessageId = data?.MessageId || null;

  if (log?.db) {
    const recipient = Array.isArray(to) ? to[0] : to;
    await insertEmailLog(log.db, {
      event: 'send',
      email: recipient,
      category: log.category || 'newsletter',
      source: log.source || '',
      subject,
      detail: sesMessageId,
      send_id: sesMessageId,
    });
  }

  return { messageId: sesMessageId };
}
