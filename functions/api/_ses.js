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
