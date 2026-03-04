# Migrate Resend to Amazon SES Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all Resend API calls with Amazon SES to reduce transactional email cost from ~$20/month to ~$1/month.

**Architecture:** A shared `functions/api/_ses.js` helper wraps the SES v2 HTTP API using `aws4fetch` (a tiny SigV4 signing library compatible with the CF Workers runtime). All 6 function files import from this helper instead of calling Resend directly.

**Tech Stack:** CF Pages Functions (Workers runtime), `aws4fetch` npm package, AWS SES v2 HTTP API, IAM access keys in CF Pages environment variables, Playwright for AWS/CF console automation.

---

**Autonomy Contract:**
- Runs without human input: YES — after Brian creates AWS account and is logged into Comet
- Abort conditions:
  - Playwright cannot locate expected AWS Console element → stop, report exact URL + selector that failed
  - IAM access key generation fails → stop, report error
  - Captured DKIM records look malformed (not matching `*.dkim.amazonses.com`) → stop, report
  - `npm run build` exits non-zero → stop, do not push
  - CF Pages env var save fails → stop, report
- Revert authority: agent may `git revert` code commits automatically if build fails
- Human required: **AWS account creation only** (credit card, phone verification, CAPTCHAs)

**Credentials inventory:**
- AWS Console: Brian logged into Comet before handoff
- Cloudflare MCP: available (full-access token, account ID `ecf2c5bc8b5ebd634bcb587b3890910a`)
- 1Password: `source ~/.zshrc && op item create` (service account, no fingerprint)
- CF Pages dashboard: Playwright via Comet (Brian logged in)

**Error paths:**
| Failure | Signal | Response |
|---------|--------|----------|
| AWS Console layout changed | Playwright element not found | Stop, report URL + selector |
| SES domain verification stuck | Status not "Pending" after submit | Stop, report |
| DKIM records malformed | Record doesn't end in `.dkim.amazonses.com` | Stop, report |
| Sandbox removal form not found | Playwright timeout | Stop, report |
| `npm run build` fails | Non-zero exit | Stop, do not push |
| CF Pages save fails | Playwright error or no success toast | Stop, report |
| Smoke test returns non-200 | HTTP status or `ok: false` | Stop, report response body |

**Go/no-go metric:** Playwright submits survey form at `https://rrmacademy.org/endo-survey` with a test email → response body contains `{"ok":true}`. A 502 means SES rejected; anything else is a different failure. Pass = `ok: true`. Fail = anything else.

---

## Scope

**6 files using Resend:**
- `functions/api/survey/request.js` — survey magic links (~300-500/day)
- `functions/api/auth/signup.js` — email verification on signup
- `functions/api/auth/forgot-password.js` — password reset links
- `functions/api/auth/resend-verification.js` — resend verification code
- `functions/api/contact/submit.js` — contact form (2 emails per submission)
- `functions/api/stripe-webhook.js` — enrollment, membership, payment failure emails

**Sending addresses:**
- `survey@rrmacademy.org`
- `accounts@rrmacademy.org`
- `contact@rrmacademy.org`

---

## Phase 1: Brian creates AWS account (manual, ~5 mins)

Go to https://aws.amazon.com → Create an AWS Account. Use `aws@rrmacademy.org` or admin email. Complete credit card + phone verification. Sign in to AWS Console when done.

**Handoff:** Brian is logged into AWS Console in Comet. Playwright takes over from here.

---

## Phase 2: Playwright — SES domain verification

**Step 1: Navigate to SES**

```
open -a "Comet" "https://us-east-1.console.aws.amazon.com/ses/home?region=us-east-1#/verified-identities"
```

**Step 2: Create domain identity**

Playwright clicks "Create identity" → selects "Domain" → enters `rrmacademy.org` → enables "Easy DKIM" → RSA-2048 → clicks "Create identity".

**Step 3: Capture DKIM records**

After creation, the console shows 3 CNAME records. Playwright reads and stores:
- 3x CNAME: `<hash>._domainkey.rrmacademy.org` → `<hash>.dkim.amazonses.com`
- 1x TXT: `_amazonses.rrmacademy.org` → `<verification-token>`

Validate: all CNAME values must end in `.dkim.amazonses.com`. Abort if not.

---

## Phase 3: CF MCP — Add DNS records

Using the Cloudflare MCP (zone: `rrmacademy.org`), add:

- 3x CNAME records (proxy: OFF / DNS-only):
  - Name: `<hash1>._domainkey` → Content: `<hash1>.dkim.amazonses.com`
  - Name: `<hash2>._domainkey` → Content: `<hash2>.dkim.amazonses.com`
  - Name: `<hash3>._domainkey` → Content: `<hash3>.dkim.amazonses.com`
- 1x TXT record:
  - Name: `_amazonses` → Content: `<verification-token>`

---

## Phase 4: Playwright — Submit sandbox removal request

Navigate to:
```
https://us-east-1.console.aws.amazon.com/ses/home?region=us-east-1#/account
```

Click "Request production access". Fill form:
- Mail type: **Transactional**
- Website URL: `https://rrmacademy.org`
- Use case description:
  ```
  We send magic links for an endometriosis symptom self-survey and transactional account emails (verification codes, password resets) for an educational nonprofit platform. All recipients explicitly request emails by submitting their address. Volume is approximately 300-500 survey emails per day plus low-volume auth emails. We maintain low complaint rates through rate limiting (1 email per 10 minutes per address) and clear unsubscribe paths.
  ```
- Check "I agree to the AWS Service Terms"
- Submit

Note: Approval takes up to 24h. Code and DNS work can proceed in parallel. Production sends to external addresses will succeed only after approval.

---

## Phase 5: Playwright — Create IAM user + access keys

Navigate to:
```
https://us-east-1.console.aws.amazon.com/iam/home#/users/create
```

**Step 1: Create user**
- User name: `rrm-ses-sender`
- Select "Attach policies directly"
- Click "Create policy" (opens new tab) → JSON tab → paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:us-east-1:*:identity/rrmacademy.org"
    }
  ]
}
```
- Policy name: `rrm-ses-send-only`
- Create policy, return to user creation tab, attach the policy, create user.

**Step 2: Generate access key**

Open the user → Security credentials → Create access key → "Application running outside AWS" → Create.

Playwright reads and stores:
- Access Key ID
- Secret Access Key (only shown once — capture immediately)

---

## Phase 6: Store credentials in 1Password

```bash
source ~/.zshrc && op item create \
  --vault Automation \
  --title "AWS SES — RRM Academy" \
  --category Login \
  username="<ACCESS_KEY_ID>" \
  password="<SECRET_ACCESS_KEY>" \
  "region[text]=us-east-1"
```

---

## Phase 7: Code changes

### Task 7.1: Install aws4fetch

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
npm install aws4fetch
git add package.json package-lock.json
git commit -m "deps: add aws4fetch for SES signing"
```

---

### Task 7.2: Create shared SES helper

**Create:** `functions/api/_ses.js`

```js
/**
 * Shared Amazon SES v2 email sender for CF Pages Functions.
 * Uses aws4fetch for SigV4 signing (compatible with Workers runtime).
 */
import { AwsClient } from 'aws4fetch';

/**
 * @param {object} env - CF Pages environment
 * @param {object} opts
 * @param {string} opts.from
 * @param {string|string[]} opts.to
 * @param {string} opts.subject
 * @param {string} [opts.html]
 * @param {string} [opts.text]
 * @param {string} [opts.replyTo]
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

```bash
git add functions/api/_ses.js
git commit -m "feat: add shared SES email helper"
```

---

### Task 7.3: Update functions/api/survey/request.js

Add at top:
```js
import { sendEmail } from '../_ses.js';
```

Replace guard:
```js
// OLD
if (!env.RESEND_API_KEY) {
// NEW
if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
```

Replace send block (lines 86-112):
```js
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

```bash
git add functions/api/survey/request.js
git commit -m "feat: migrate survey/request to SES"
```

---

### Task 7.4: Update functions/api/auth/signup.js

Add at top:
```js
import { sendEmail } from '../_ses.js';
```

Replace email block (lines 83-116):
```js
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

```bash
git add functions/api/auth/signup.js
git commit -m "feat: migrate auth/signup to SES"
```

---

### Task 7.5: Update functions/api/auth/forgot-password.js

Add at top:
```js
import { sendEmail } from '../_ses.js';
```

Change guard (line 41):
```js
if (user && env.AWS_ACCESS_KEY_ID) {
```

Replace fetch block (lines 58-89):
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

```bash
git add functions/api/auth/forgot-password.js
git commit -m "feat: migrate auth/forgot-password to SES"
```

---

### Task 7.6: Update functions/api/auth/resend-verification.js

Add at top:
```js
import { sendEmail } from '../_ses.js';
```

Change guard (line 46):
```js
if (env.AWS_ACCESS_KEY_ID) {
```

Replace fetch block (lines 48-74):
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

```bash
git add functions/api/auth/resend-verification.js
git commit -m "feat: migrate auth/resend-verification to SES"
```

---

### Task 7.7: Update functions/api/contact/submit.js

Add at top:
```js
import { sendEmail } from '../_ses.js';
```

Change guard (line 26):
```js
if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
```

Replace first send block:
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

Replace second send block:
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

```bash
git add functions/api/contact/submit.js
git commit -m "feat: migrate contact/submit to SES"
```

---

### Task 7.8: Update functions/api/stripe-webhook.js

Read the file first. It has a local `sendEmail(apiKey, opts)` helper and inline fetch calls.

Add import at top:
```js
import { sendEmail } from './_ses.js';
```

Delete the local `sendEmail` function entirely.

Update all call sites: replace `sendEmail(env.RESEND_API_KEY, { to, subject, text })` with `sendEmail(env, { from: 'RRM Academy <accounts@rrmacademy.org>', to, subject, text })`.

Replace all inline `fetch('https://api.resend.com/emails', ...)` blocks with equivalent `sendEmail(env, {...})` calls using `accounts@rrmacademy.org` as from address.

Replace all `env.RESEND_API_KEY` guard conditions with `env.AWS_ACCESS_KEY_ID`.

```bash
git add functions/api/stripe-webhook.js
git commit -m "feat: migrate stripe-webhook to SES"
```

---

## Phase 8: Playwright — Add CF Pages env vars

Navigate to:
```
https://dash.cloudflare.com/ecf2c5bc8b5ebd634bcb587b3890910a/pages/view/rrm-academy/settings/environment-variables
```

Add to Production environment:
| Variable | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | from 1Password item "AWS SES — RRM Academy" |
| `AWS_SECRET_ACCESS_KEY` | from 1Password item "AWS SES — RRM Academy" |
| `AWS_SES_REGION` | `us-east-1` |

Delete: `RESEND_API_KEY`

Save.

---

## Phase 9: Build + Deploy

Deploys are automated via GitHub Actions on push to main.

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
npm run build
```

If build passes (exit 0):
```bash
git push origin main
```

Monitor GitHub Actions for successful deployment before smoke test.

---

## Phase 10: Playwright smoke test

**Test 1: Survey endpoint**

POST to `https://rrmacademy.org/api/survey/request` with body `{"email":"test+ses@rrmacademy.org"}`.

Pass: response body is `{"ok":true}` with HTTP 200.
Fail: 502 (SES rejected) or 500 (misconfigured) → stop, report response body.

**Test 2: Contact form**

Playwright fills and submits the contact form at `https://rrmacademy.org/contact`.

Pass: success message appears in DOM.
Fail: error message → report.

---

## Rollback

If smoke test fails after deploy:

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
git revert HEAD~9..HEAD
git push origin main
```

Then re-add `RESEND_API_KEY` in CF Pages dashboard.

---

## Cost

At 10,000 emails/month: **~$1.00/month** vs Resend Pro **$20/month**.

Sandbox removal note: until AWS approves production access, SES only sends to verified addresses. The survey will be functional for verified test addresses immediately; full public sends resume after approval (typically a few hours to 24h).
