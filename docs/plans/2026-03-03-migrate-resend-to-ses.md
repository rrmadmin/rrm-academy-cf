# Migrate Resend to Amazon SES Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all Resend API calls with Amazon SES to reduce transactional email cost from ~$20/month to ~$1/month.

**Architecture:** A shared `functions/api/_ses.js` helper wraps the SES v2 HTTP API using `aws4fetch` (a tiny SigV4 signing library compatible with the CF Workers runtime). All 6 function files import from this helper instead of calling Resend directly.

**Tech Stack:** CF Pages Functions (Workers runtime), `aws4fetch` npm package, AWS SES v2 HTTP API, IAM access keys in CF Pages environment variables.

---

## Scope

**6 files using Resend today:**
- `functions/api/survey/request.js` — survey magic links (high volume, ~300-500/day)
- `functions/api/auth/signup.js` — email verification on signup
- `functions/api/auth/forgot-password.js` — password reset links
- `functions/api/auth/resend-verification.js` — resend verification code
- `functions/api/contact/submit.js` — contact form (2 emails per submission)
- `functions/api/stripe-webhook.js` — course enrollment, membership, payment failure emails

**Sending addresses in use:**
- `survey@rrmacademy.org`
- `accounts@rrmacademy.org`
- `contact@rrmacademy.org`

---

## Phase 1: AWS Account + SES Setup (Brian — manual, ~20 mins)

> Do this before Phase 3. Sandbox removal can take up to 24h — request it first.

### Step 1.1: Create AWS account

Go to https://aws.amazon.com → Create an AWS Account. Use a dedicated email like `aws@rrmacademy.org` or your admin email. Free tier is sufficient.

### Step 1.2: Enable SES in us-east-1

In AWS Console → Services → Simple Email Service → select region **us-east-1**.

### Step 1.3: Verify domain rrmacademy.org

In SES → Verified Identities → Create Identity → Domain → `rrmacademy.org`.

Enable **DKIM signing** (Easy DKIM, RSA-2048). AWS will generate 3 CNAME records.

Copy all records — you'll need them for Phase 2.

Format will be:
```
_domainkey.rrmacademy.org CNAME <hash1>.dkim.amazonses.com
_domainkey.rrmacademy.org CNAME <hash2>.dkim.amazonses.com
_domainkey.rrmacademy.org CNAME <hash3>.dkim.amazonses.com
```
Plus a verification TXT:
```
_amazonses.rrmacademy.org TXT <verification-token>
```

### Step 1.4: Request production access (out of sandbox)

In SES → Account Dashboard → Request production access.

Fill out:
- Mail type: **Transactional**
- Website URL: `https://rrmacademy.org`
- Use case: "Send magic links for an endometriosis symptom self-survey and account verification emails for our educational platform. All recipients explicitly request emails. Volume ~300-500 survey emails/day."

Approval is usually within a few hours.

### Step 1.5: Create IAM user with minimal SES permissions

In IAM → Users → Create User → name: `rrm-ses-sender`.

Attach this inline policy (replace `YOUR_ACCOUNT_ID` and `us-east-1` if different):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:us-east-1:YOUR_ACCOUNT_ID:identity/rrmacademy.org"
    }
  ]
}
```

Then: Security credentials → Create access key → Application running outside AWS → copy both values.

### Step 1.6: Store credentials in 1Password

In 1Password Automation vault, create item `AWS SES — RRM Academy`:
- `access_key_id`: the key ID
- `secret_access_key`: the secret key
- `region`: `us-east-1`

---

## Phase 2: DNS Records in Cloudflare (I do — after Brian provides DKIM records)

Add to `rrmacademy.org` zone via Cloudflare MCP:
- 3x CNAME records for DKIM (proxied: OFF — must be DNS-only)
- 1x TXT record for domain verification

---

## Phase 3: Code Changes (I do — can be done now)

### Task 1: Install aws4fetch

**Files:**
- Modify: `package.json`

**Step 1: Install the package**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
npm install aws4fetch
```

Expected: `aws4fetch` added to `dependencies` in `package.json`.

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add aws4fetch for SES signing"
```

---

### Task 2: Create shared SES helper

**Files:**
- Create: `functions/api/_ses.js`

**Step 1: Write the helper**

```js
/**
 * Shared Amazon SES v2 email sender for CF Pages Functions.
 * Uses aws4fetch for SigV4 signing (compatible with Workers runtime).
 */
import { AwsClient } from 'aws4fetch';

/**
 * @param {object} env - CF Pages environment (must have AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
 * @param {object} opts
 * @param {string} opts.from - Sender address, e.g. "Name <addr@domain.com>"
 * @param {string|string[]} opts.to - Recipient(s)
 * @param {string} opts.subject
 * @param {string} [opts.html] - HTML body
 * @param {string} [opts.text] - Plain text body
 * @param {string} [opts.replyTo] - Reply-to address
 * @returns {Promise<Response>}
 */
export async function sendEmail(env, { from, to, subject, html, text, replyTo }) {
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
    const err = await res.text();
    throw new Error(`SES error ${res.status}: ${err}`);
  }

  return res;
}
```

**Step 2: Commit**

```bash
git add functions/api/_ses.js
git commit -m "feat: add shared SES email helper"
```

---

### Task 3: Update functions/api/survey/request.js

**Files:**
- Modify: `functions/api/survey/request.js`

**Step 1: Replace the Resend block**

At top of file, add import:
```js
import { sendEmail } from '../_ses.js';
```

Replace the guard check:
```js
// OLD
if (!env.RESEND_API_KEY) {
  return json({ ok: false, error: 'Server misconfigured' }, 500);
}

// NEW
if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
  return json({ ok: false, error: 'Server misconfigured' }, 500);
}
```

Replace the send block (lines 86-112):
```js
// Send email via SES
try {
  await sendEmail(env, {
    from: 'RRM Academy <survey@rrmacademy.org>',
    to: email,
    subject: 'Your Endometriosis Symptom Self-Survey',
    html: buildEmailHtml(surveyUrl),
  });
} catch (err) {
  console.error('SES send failed:', err.message);
  await env.SURVEY_TOKENS.delete(`email:${email}`);
  return json({ ok: false, error: 'Failed to send email. Please try again.' }, 502);
}
```

**Step 2: Commit**

```bash
git add functions/api/survey/request.js
git commit -m "feat: migrate survey/request to SES"
```

---

### Task 4: Update functions/api/auth/signup.js

**Files:**
- Modify: `functions/api/auth/signup.js`

**Step 1: Replace the Resend block**

Add import at top:
```js
import { sendEmail } from '../_ses.js';
```

Replace the email block (lines 83-116):
```js
// Send verification email (fire-and-forget)
if (env.AWS_ACCESS_KEY_ID) {
  sendEmail(env, {
    from: 'RRM Academy <accounts@rrmacademy.org>',
    to: email,
    subject: 'Verify your email — RRM Academy',
    text: [
      `Hi ${firstName},`,
      '',
      'Welcome to RRM Academy! Please verify your email by entering this code:',
      '',
      `    ${code}`,
      '',
      'This code expires in 1 hour.',
      '',
      'If you did not create an account, you can safely ignore this email.',
      '',
      'Best regards,',
      'RRM Academy',
      'https://rrmacademy.org',
    ].join('\n'),
  }).catch(err => console.error('Verification email failed:', err.message));
}
```

**Step 2: Commit**

```bash
git add functions/api/auth/signup.js
git commit -m "feat: migrate auth/signup to SES"
```

---

### Task 5: Update functions/api/auth/forgot-password.js

**Files:**
- Modify: `functions/api/auth/forgot-password.js`

**Step 1: Replace the Resend block**

Add import at top:
```js
import { sendEmail } from '../_ses.js';
```

Change guard condition (line 41):
```js
// OLD
if (user && env.RESEND_API_KEY) {

// NEW
if (user && env.AWS_ACCESS_KEY_ID) {
```

Replace the fetch block (lines 58-89):
```js
try {
  await sendEmail(env, {
    from: 'RRM Academy <accounts@rrmacademy.org>',
    to: email,
    subject: 'Reset your password — RRM Academy',
    text: [
      `Hi ${user.name || 'there'},`,
      '',
      'We received a request to reset your RRM Academy password. Click the link below to set a new password:',
      '',
      resetUrl,
      '',
      'This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.',
      '',
      'Best regards,',
      'RRM Academy',
      'https://rrmacademy.org',
    ].join('\n'),
  });
} catch (emailErr) {
  console.error('Password reset email send failed:', emailErr);
}
```

**Step 2: Commit**

```bash
git add functions/api/auth/forgot-password.js
git commit -m "feat: migrate auth/forgot-password to SES"
```

---

### Task 6: Update functions/api/auth/resend-verification.js

**Files:**
- Modify: `functions/api/auth/resend-verification.js`

**Step 1: Replace the Resend block**

Add import at top:
```js
import { sendEmail } from '../_ses.js';
```

Change guard (line 46):
```js
// OLD
if (env.RESEND_API_KEY) {

// NEW
if (env.AWS_ACCESS_KEY_ID) {
```

Replace the fetch block (lines 48-74):
```js
try {
  await sendEmail(env, {
    from: 'RRM Academy <accounts@rrmacademy.org>',
    to: user.email,
    subject: 'Your verification code — RRM Academy',
    text: [
      `Hi ${user.name || 'there'},`,
      '',
      'Here is your new verification code:',
      '',
      `    ${code}`,
      '',
      'This code expires in 1 hour.',
      '',
      'Best regards,',
      'RRM Academy',
      'https://rrmacademy.org',
    ].join('\n'),
  });
} catch {
  // Email send failed — user can request resend later
}
```

**Step 2: Commit**

```bash
git add functions/api/auth/resend-verification.js
git commit -m "feat: migrate auth/resend-verification to SES"
```

---

### Task 7: Update functions/api/contact/submit.js

**Files:**
- Modify: `functions/api/contact/submit.js`

**Step 1: Replace the Resend blocks**

Add import at top:
```js
import { sendEmail } from '../_ses.js';
```

Change guard (line 26):
```js
// OLD
if (!env.RESEND_API_KEY) {

// NEW
if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
```

Replace first email fetch block (lines 87-113):
```js
try {
  await sendEmail(env, {
    from: 'RRM Academy <contact@rrmacademy.org>',
    to: 'administrator@rrmacademy.org',
    replyTo: email,
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
  });
} catch (err) {
  console.error('Contact email failed:', err.message);
  return json({ ok: false, error: 'Failed to send message. Please try again.' }, 502);
}
```

Replace second email fetch block (lines 122-150):
```js
try {
  await sendEmail(env, {
    from: 'RRM Academy <contact@rrmacademy.org>',
    to: email,
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
  });
} catch (err) {
  console.error('Confirmation email failed:', err.message);
}
```

**Step 2: Commit**

```bash
git add functions/api/contact/submit.js
git commit -m "feat: migrate contact/submit to SES"
```

---

### Task 8: Update functions/api/stripe-webhook.js

**Files:**
- Modify: `functions/api/stripe-webhook.js`

**Step 1: Read the file first, then replace**

The file has a local `sendEmail(apiKey, opts)` helper function. Replace it with an import and update all call sites.

Add import at top:
```js
import { sendEmail as sesSendEmail } from './_ses.js';
```

Find the local `sendEmail` function and delete it. Then find all calls to `sendEmail(env.RESEND_API_KEY, { to, subject, text })` and replace with `sesSendEmail(env, { from: 'RRM Academy <accounts@rrmacademy.org>', to, subject, text })`.

For the inline `fetch('https://api.resend.com/emails', ...)` blocks, replace similarly using `sesSendEmail`.

The enrollment confirmation `from` should be `accounts@rrmacademy.org`. The payment failed email `from` should be `accounts@rrmacademy.org`.

Also update the guard conditions from `env.RESEND_API_KEY` to `env.AWS_ACCESS_KEY_ID`.

**Step 2: Commit**

```bash
git add functions/api/stripe-webhook.js
git commit -m "feat: migrate stripe-webhook to SES"
```

---

## Phase 4: CF Pages Environment Variables (Brian — manual)

In Cloudflare Dashboard → Pages → rrm-academy → Settings → Environment Variables:

**Add (Production + Preview):**
| Variable | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | from 1Password |
| `AWS_SECRET_ACCESS_KEY` | from 1Password |
| `AWS_SES_REGION` | `us-east-1` |

**Remove:**
| Variable |
|---|
| `RESEND_API_KEY` |

---

## Phase 5: Deploy + Test

### Step 5.1: Build and deploy

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
npm run build
CLOUDFLARE_ACCOUNT_ID="ecf2c5bc8b5ebd634bcb587b3890910a" npx wrangler pages deploy dist --project-name rrm-academy
```

### Step 5.2: Test survey email

Go to `https://rrmacademy.org/endo-survey` and submit a test email address. Verify the magic link email arrives via SES.

### Step 5.3: Test contact form

Submit the contact form at `https://rrmacademy.org/contact`. Verify both the admin notification and the user confirmation arrive.

### Step 5.4: Monitor SES console

In AWS SES → Account Dashboard, verify send metrics show successful deliveries, no bounces or complaints.

---

## Rollback

If SES has issues before sandbox removal is approved (sends fail to external addresses):
1. Re-add `RESEND_API_KEY` to CF Pages env vars
2. Revert code: `git revert HEAD~8..HEAD` and redeploy

After sandbox removal is approved, SES sends to all external addresses without restriction.

---

## Cost Estimate

At 10,000 emails/month: **$1.00/month** (SES: $0.10 per 1,000).
vs Resend Pro: **$20/month**.
