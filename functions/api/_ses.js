import { AwsClient } from 'aws4fetch';

export async function sendEmail(env, { from, to, subject, html, text, replyTo }) {
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

  return res;
}

/**
 * Send a raw MIME email via SESv2. Supports custom headers (List-Unsubscribe, etc.).
 * Used for newsletter sends. Transactional emails should use sendEmail() (Simple format).
 */
export async function sendRawEmail(env, { from, to, subject, html, text, replyTo, headers, configurationSet }) {
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

  return res;
}
