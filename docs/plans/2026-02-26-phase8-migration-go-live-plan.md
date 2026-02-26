# Phase 8 Migration & Go-Live Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Import 4,000+ Wix members into D1, add Google OAuth, migrate community content, and switch Stripe to live mode.

**Architecture:** Member data flows from 6 Wix CSV exports through a Node.js import script into D1 (users, labels, enrollments). Google OAuth adds a second auth path via CF Pages Functions. Community content from Wix Groups is imported into the existing community_post/comment tables with a new channel column. Stripe goes live by swapping CF Pages secrets.

**Tech Stack:** Cloudflare D1 (SQLite), CF Pages Functions (JS), Google OAuth 2.0, Stripe API, Node.js import scripts, Astro SSG

**Design doc:** `docs/plans/2026-02-26-phase8-migration-go-live-design.md`

---

## Layer 1: Foundation

### Task 1: D1 Schema Migration

**Files:**
- Create: `migrations/003-member-migration.sql`
- Modify: `schema.sql` (append new table + columns)

**Step 1: Write the migration SQL**

Create `migrations/003-member-migration.sql`:

```sql
-- Labels system (informational metadata, not access control)
CREATE TABLE IF NOT EXISTS user_label (
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(user_id, label)
);
CREATE INDEX IF NOT EXISTS idx_user_label_label ON user_label(label);

-- User table additions for OAuth and migration tracking
ALTER TABLE user ADD COLUMN google_id TEXT;
ALTER TABLE user ADD COLUMN wix_member_id TEXT;
ALTER TABLE user ADD COLUMN blocked INTEGER DEFAULT 0;

-- Community channels (stuc=active, members/masterclass=admin archives)
ALTER TABLE community_post ADD COLUMN channel TEXT NOT NULL DEFAULT 'stuc';
CREATE INDEX IF NOT EXISTS idx_community_post_channel ON community_post(channel, created_at);
```

**Step 2: Apply migration to remote D1**

Run:
```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
npx wrangler d1 execute rrm-auth --remote --file=migrations/003-member-migration.sql
```

Expected: `Executed N commands` with no errors.

**Step 3: Verify columns exist**

Run:
```bash
npx wrangler d1 execute rrm-auth --remote --command "PRAGMA table_info(user);"
npx wrangler d1 execute rrm-auth --remote --command "PRAGMA table_info(user_label);"
npx wrangler d1 execute rrm-auth --remote --command "PRAGMA table_info(community_post);"
```

Expected: `google_id`, `wix_member_id`, `blocked` columns on user. `user_label` table exists. `channel` column on community_post.

**Step 4: Update schema.sql to match**

Append the user_label table definition and add the new columns to the user CREATE TABLE statement so schema.sql stays in sync with the live database.

**Step 5: Commit**

```bash
git add migrations/003-member-migration.sql schema.sql
git commit -m "schema: add user_label table, google_id, wix_member_id, blocked, community channel"
```

---

### Task 2: Member Import Script

**Files:**
- Create: `scripts/import-wix-members.mjs`
- Input: `~/Downloads/contacts (1).csv` through `contacts (6).csv`

**Step 1: Write the import script**

Create `scripts/import-wix-members.mjs`. The script must:

1. Read all 6 CSV files, dedup on email (union labels across files)
2. For each contact, generate:
   - `INSERT INTO user` (id=UUID, email, name, first_name, last_name, hashed_password='', email_verified=1, wix_member_id from CSV `# User ID` column, blocked=1 if labels contain "Spam 🛑", created_at from CSV `Created At (UTC+0)`, role='member')
   - `INSERT INTO user_label` for each semicolon-delimited label
   - `INSERT INTO enrollment` where labels match courses (see label→course_id mapping below)
3. Handle collision with existing D1 users (4 accounts): if email matches, skip user INSERT, still add labels and enrollments
4. Output SQL file for batch execution via `wrangler d1 execute`

**Label → course_id mapping:**
```js
const COURSE_LABELS = {
  'Masterclass in Endometriosis & Surgery': 'masterclass-endo-surgery',
  'Masterclass in Endometriosis and Surgery': 'masterclass-endo-surgery',
  'Long Term Endometriosis Management': 'long-term-endo-management',
  'Restorative Reproductive Medicine (RRM) vs Standard ART: A New Approach to Infertility': 'rrm-vs-ivf',
  'Postpartum Depression & Anxiety: a restorative approach to recovery': 'postpartum-depression-anxiety',
};
```

**CSV source priority** (for dedup — later files override name fields but labels are unioned):
1. `contacts (1).csv` — main site members (Source="Site Members" rows only)
2. `contacts (2).csv` — STUC members (all rows, some are Contact Import / Wix Stores)
3. `contacts (3).csv` — Masterclass members (all rows, many are Contact Import)
4. `contacts (4).csv`, `contacts (5).csv`, `contacts (6).csv` — manual lookups (all rows)

**ID generation:** Use `crypto.randomUUID().replace(/-/g, '')` to match existing 32-char hex IDs in the codebase (see `generateId()` in `functions/api/auth/_shared.js:26-30`).

**Step 2: Run the script to generate SQL**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
node scripts/import-wix-members.mjs > scripts/import-members.sql
```

Expected: SQL file with ~4000 user INSERTs, ~15000+ label INSERTs, ~200+ enrollment INSERTs. Script should print summary counts to stderr.

**Step 3: Review the SQL output**

Spot-check:
- Brian's existing account is NOT duplicated (skip on email match)
- Spam-labeled users have `blocked=1`
- Pre-Wix Masterclass members (contacts 3) get enrollment records
- STUC members from contacts (2) who are Contact Imports still get user records
- Labels are not duplicated per user

**Step 4: Apply to D1**

```bash
npx wrangler d1 execute rrm-auth --remote --file=scripts/import-members.sql
```

Note: If the file is too large for a single execution, split into batches of 500 statements.

**Step 5: Verify import**

```bash
npx wrangler d1 execute rrm-auth --remote --command "SELECT COUNT(*) as users FROM user;"
npx wrangler d1 execute rrm-auth --remote --command "SELECT COUNT(*) as labels FROM user_label;"
npx wrangler d1 execute rrm-auth --remote --command "SELECT COUNT(*) as enrollments FROM enrollment;"
npx wrangler d1 execute rrm-auth --remote --command "SELECT COUNT(*) FROM user WHERE blocked=1;"
npx wrangler d1 execute rrm-auth --remote --command "SELECT course_id, COUNT(*) as ct FROM enrollment GROUP BY course_id;"
```

Expected: ~4000+ users, 15000+ labels, 200+ enrollments, ~59 blocked.

**Step 6: Commit**

```bash
git add scripts/import-wix-members.mjs
git commit -m "feat: add Wix member import script (4000+ members, labels, enrollments)"
```

Do NOT commit the generated SQL or the CSV files.

---

### Task 3: Course Progress Enrichment

**Files:**
- Create: `scripts/enrich-course-progress.mjs`
- Input: `~/Downloads/course participants - masterclass.csv`, `~/Downloads/course participants - long term endo.csv`

**Step 1: Write the enrichment script**

The script must:

1. Read course participant CSVs (name-only, no emails)
2. Query D1 for all users with matching enrollments (use the imported users from Task 2)
3. Match participant names to users by:
   - Exact full name match against `user.name`
   - Email prefix match (display name = email prefix from contacts)
   - Hardcoded manual overrides:
     ```js
     const MANUAL_OVERRIDES = {
       'MM': 'maggievdb@gmail.com',
       'Maggie McCarthy': 'maggievdb@gmail.com',
       'mollyg242': 'mollyg242@gmail.com',
       'Molly Y': 'mollyg242@gmail.com',
       'Amelia D': 'maroonnurse@gmail.com',
       'Amelia Burke': 'maroonnurse@gmail.com',
       'Kendal Fraser - Reproductive Health Education': 'kendalfertility@gmail.com',
       'Pam Schoenfeld': 'womenfamilynutrition@gmail.com',
       'Naomi Whittaker': 'naomimwhittaker@gmail.com',
       '"Naomi Whittaker': 'naomimwhittaker@gmail.com',
     };
     ```
4. For matched users, generate SQL to update enrollment records:
   - `completed_at` — set if Status = "Finished"
   - `certificate_issued_at` — set if Certificate column contains a date
5. For matched users, generate SQL to create step_progress records:
   - Set `completed=1` for all steps if Status = "Finished"
   - If "In Progress", calculate which steps are complete based on Performance %
6. Output SQL + report unmatched names

**CSV format (course participants):**
```
"#,Name,Status,Performance %,Performance,Last Activity,Date Joined,Pricing,Certificate"
"1,john.crystal.miller,Finished,100%,Exceptional,Jan 29 2026,Dec 6 2025,Pricing Plan,Issued Jan 29 2026"
```

Note: entire rows are quote-wrapped and comma-delimited within the quotes.

**Step 2: Run against D1 user data**

This script needs to query D1 to match names against imported emails. Two approaches:
- (a) Export users first: `wrangler d1 execute --remote --command "SELECT id, email, name FROM user" --json > /tmp/users.json`, then read locally
- (b) Use the contacts CSVs as the lookup table (no D1 query needed — we already have email→name mapping)

Approach (b) is simpler. Build the name→email lookup from the same CSVs used in Task 2.

**Step 3: Apply enrichment SQL to D1**

```bash
npx wrangler d1 execute rrm-auth --remote --file=scripts/enrich-progress.sql
```

**Step 4: Verify**

```bash
npx wrangler d1 execute rrm-auth --remote --command "SELECT course_id, COUNT(*) FROM enrollment WHERE completed_at IS NOT NULL GROUP BY course_id;"
npx wrangler d1 execute rrm-auth --remote --command "SELECT COUNT(*) FROM enrollment WHERE certificate_issued_at IS NOT NULL;"
```

**Step 5: Commit**

```bash
git add scripts/enrich-course-progress.mjs
git commit -m "feat: add course progress enrichment from Wix participant data"
```

---

### Task 4: Google OAuth — Backend

**Files:**
- Create: `functions/api/auth/google.js`
- Create: `functions/api/auth/google-callback.js`
- Modify: `functions/api/auth/_shared.js` (add Google OAuth helpers)

**Step 1: Add Google OAuth helpers to _shared.js**

Add to the bottom of `functions/api/auth/_shared.js`:

```js
export function googleAuthUrl(clientId, redirectUri) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(code, clientId, clientSecret, redirectUri) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  return resp.json();
}

export async function getGoogleProfile(accessToken) {
  const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return resp.json();
}
```

**Step 2: Create /api/auth/google.js (redirect to Google)**

```js
import { googleAuthUrl } from './_shared.js';

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const redirect = url.searchParams.get('redirect') || '/account/';

  const redirectUri = `${url.origin}/api/auth/google-callback`;
  const authUrl = googleAuthUrl(env.GOOGLE_CLIENT_ID, redirectUri);

  // Store the intended redirect in a short-lived cookie
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${authUrl}&state=${encodeURIComponent(redirect)}`,
      'Set-Cookie': `oauth_redirect=${encodeURIComponent(redirect)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
```

**Step 3: Create /api/auth/google-callback.js (handle redirect, create/link account)**

```js
import { exchangeGoogleCode, getGoogleProfile, generateId, generateSessionId, createSession, sessionCookie, json } from './_shared.js';

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') || '/account/';
  const error = url.searchParams.get('error');

  if (error || !code) {
    return Response.redirect(`${url.origin}/login?error=oauth_failed`, 302);
  }

  const redirectUri = `${url.origin}/api/auth/google-callback`;

  // Exchange code for tokens
  const tokens = await exchangeGoogleCode(code, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
  if (!tokens.access_token) {
    return Response.redirect(`${url.origin}/login?error=oauth_failed`, 302);
  }

  // Get Google profile
  const profile = await getGoogleProfile(tokens.access_token);
  if (!profile.email) {
    return Response.redirect(`${url.origin}/login?error=oauth_failed`, 302);
  }

  const db = env.DB;
  let user;

  // 1. Check if google_id exists in DB (returning Google user)
  const byGoogleId = await db.prepare('SELECT * FROM user WHERE google_id = ?').bind(profile.id).first();
  if (byGoogleId) {
    user = byGoogleId;
  } else {
    // 2. Check if email matches existing user (first Google login for imported/existing member)
    const byEmail = await db.prepare('SELECT * FROM user WHERE email = ?').bind(profile.email.toLowerCase()).first();
    if (byEmail) {
      // Link Google ID to existing account
      await db.prepare('UPDATE user SET google_id = ? WHERE id = ?').bind(profile.id, byEmail.id).run();
      user = byEmail;
    } else {
      // 3. Create new account
      const userId = generateId();
      await db.prepare(
        'INSERT INTO user (id, email, email_verified, hashed_password, name, first_name, last_name, google_id, role) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)'
      ).bind(
        userId,
        profile.email.toLowerCase(),
        '',  // no password — OAuth-only account
        profile.name || '',
        profile.given_name || '',
        profile.family_name || '',
        profile.id,
        'member'
      ).run();
      user = { id: userId, email: profile.email.toLowerCase(), name: profile.name, role: 'member' };
    }
  }

  // Check if blocked
  if (user.blocked) {
    return Response.redirect(`${url.origin}/login?error=account_blocked`, 302);
  }

  // Create session
  const sessionId = generateSessionId();
  await createSession(db, sessionId, user.id);

  const redirectTo = decodeURIComponent(state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectTo.startsWith('/') ? redirectTo : '/account/',
      'Set-Cookie': sessionCookie(sessionId),
    },
  });
}
```

**Step 4: Add CF Pages secrets for Google OAuth**

Brian must create Google Cloud OAuth 2.0 credentials first, then:
```bash
npx wrangler pages secret put GOOGLE_CLIENT_ID --project-name rrm-academy
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name rrm-academy
```

**Step 5: Commit**

```bash
git add functions/api/auth/google.js functions/api/auth/google-callback.js functions/api/auth/_shared.js
git commit -m "feat: add Google OAuth login (redirect + callback + account linking)"
```

---

### Task 5: Google OAuth — Frontend

**Files:**
- Modify: `src/pages/login.astro`
- Modify: `src/pages/signup.astro`

**Step 1: Add "Sign in with Google" button to login page**

In `src/pages/login.astro`, add a Google OAuth button above the email/password form. Style it consistently with the existing form. The button should be a link to `/api/auth/google` (which redirects to Google).

Include the current page's `redirect` parameter if present:
```html
<a href="/api/auth/google" class="google-btn" id="googleBtn">
  <svg><!-- Google "G" logo SVG --></svg>
  Continue with Google
</a>
<div class="divider"><span>or</span></div>
```

Update the Google button href with JS to pass through the redirect param:
```js
const params = new URLSearchParams(window.location.search);
const redirect = params.get('redirect');
if (redirect) {
  document.getElementById('googleBtn').href = `/api/auth/google?redirect=${encodeURIComponent(redirect)}`;
}
```

**Step 2: Add "Sign up with Google" button to signup page**

Same pattern in `src/pages/signup.astro`. Button links to `/api/auth/google`. Google-created accounts skip email verification (they're already Google-verified).

**Step 3: Handle OAuth error messages on login page**

Add to the login page JS:
```js
const error = params.get('error');
if (error === 'oauth_failed') {
  // Show "Google sign-in failed. Please try again or use email."
}
if (error === 'account_blocked') {
  // Show "This account has been blocked."
}
```

**Step 4: Test locally**

Google OAuth won't work on localhost (redirect URI mismatch). Test on the deployed site after pushing.

**Step 5: Commit**

```bash
git add src/pages/login.astro src/pages/signup.astro
git commit -m "feat: add Google OAuth buttons to login and signup pages"
```

---

### Task 6: Community Channel Support

**Files:**
- Modify: `functions/api/community/posts.js` — filter by channel on GET, set channel on POST
- Modify: `functions/api/community/comments.js` — no change needed (comments reference post_id)
- Modify: `functions/api/community/reactions.js` — no change needed
- Modify: `src/pages/community/index.astro` — pass channel param
- Create: `src/pages/community/archive/members.astro`
- Create: `src/pages/community/archive/masterclass.astro`

**Step 1: Update posts API to support channel filtering**

In `functions/api/community/posts.js`, modify the GET handler:

The SQL query that fetches posts needs a WHERE clause for channel:
```js
const channel = url.searchParams.get('channel') || 'stuc';
// Add to the SELECT query: WHERE channel = ?
```

The POST handler needs to set channel on new posts:
```js
const channel = body.channel || 'stuc';
// Add to the INSERT: channel column
```

**Step 2: Update community index page**

In `src/pages/community/index.astro`, the fetch to `/api/community/posts` should include `?channel=stuc`.

**Step 3: Create archive pages**

Create `src/pages/community/archive/members.astro` and `src/pages/community/archive/masterclass.astro`. These pages:
- Check user role is admin or superadmin (redirect to /community if not)
- Fetch posts with `?channel=members` or `?channel=masterclass`
- Display posts read-only (no compose box, no comment form)
- Show a banner: "Archive of RRM Academy Members group from Wix (June 2024 – February 2026)"
- Set `noindex, nofollow` meta tag

**Step 4: Add admin check to archive access**

In the archive pages, check session and role before rendering:
```js
const sessionResp = await fetch(`${Astro.url.origin}/api/auth/session`, { headers: { cookie: Astro.request.headers.get('cookie') || '' } });
const sessionData = await sessionResp.json();
if (!sessionData.user || !['admin', 'superadmin'].includes(sessionData.user.role)) {
  return Astro.redirect('/community');
}
```

**Step 5: Commit**

```bash
git add functions/api/community/posts.js src/pages/community/index.astro src/pages/community/archive/
git commit -m "feat: add community channels (stuc active, members/masterclass admin-only archives)"
```

---

## Layer 2: Content + Testing

### Task 7: STUC Community Content Import

**Files:**
- Create: `scripts/import-stuc-posts.mjs`
- Input: STUC post data (73 posts, provided as structured text in design doc)

**Step 1: Create structured JSON from scraped text**

Convert the 73 STUC posts from the scrape output into a JSON file `scripts/data/stuc-posts.json`. Each post:
```json
{
  "author_name": "Brian Whittaker",
  "author_role": "Super Hero",
  "title": "Post title",
  "body": "Post content",
  "type": "discussion",
  "created_at": "2026-02-24T00:00:00Z",
  "tags": ["🌟 Live Call 🎥"],
  "comments": [
    {
      "author_name": "OvaWellness",
      "content": "Comment text",
      "created_at": "2026-02-24T01:00:00Z"
    }
  ]
}
```

Map Wix tags to community_post `type`:
- "🌟 Live Call 🎥" → `event`
- "▶️ Call Recordings 🎧" or "✍️ Call Notes 📝" → `resource`
- "Guide" → `resource`
- No tag → `discussion`
- Member join posts → `discussion` (with a flag or prefix in body)

**Step 2: Write the import script**

`scripts/import-stuc-posts.mjs` must:
1. Read `scripts/data/stuc-posts.json`
2. Read the user table export (or contacts CSVs) to match author names to user IDs
3. For matched authors: use their user_id
4. For unmatched authors: use a system account. Create one if it doesn't exist:
   ```sql
   INSERT INTO user (id, email, hashed_password, name, role, email_verified)
   VALUES ('rrm-archive-system', 'system@rrmacademy.org', '', 'RRM Academy', 'member', 1);
   ```
   Then format post body as: `**Originally posted by {author_name}:**\n\n{body}`
5. Set `channel = 'stuc'` on all posts
6. Generate SQL for posts + comments with original timestamps
7. Output to `scripts/import-stuc-posts.sql`

**Step 3: Apply to D1**

```bash
npx wrangler d1 execute rrm-auth --remote --file=scripts/import-stuc-posts.sql
```

**Step 4: Verify on live site**

Navigate to `https://rrmacademy.org/community` and verify posts appear with correct timestamps, authors, and content.

**Step 5: Commit**

```bash
git add scripts/import-stuc-posts.mjs scripts/data/stuc-posts.json
git commit -m "feat: import 73 STUC community posts from Wix Groups"
```

---

### Task 8: RRM Academy Members & Masterclass Archive Import

**Files:**
- Create: `scripts/import-archive-posts.mjs`
- Input: RRM Academy Members posts (~197) and Masterclass posts (~18), scraped by Brian via Claude in Chrome

**Step 1: Wait for Brian to provide scraped data**

Brian will scrape RRM Academy Members (~197 posts) and Masterclass Members (~18 posts) group discussions using Claude in Chrome. The output format should match the STUC scrape format.

**Step 2: Create JSON files**

- `scripts/data/rrm-academy-posts.json`
- `scripts/data/masterclass-posts.json`

**Step 3: Write import script**

Same pattern as Task 7, but with `channel = 'members'` and `channel = 'masterclass'` respectively.

**Step 4: Apply to D1 and verify**

Navigate to archive pages (admin-only) to verify.

**Step 5: Commit**

```bash
git add scripts/import-archive-posts.mjs scripts/data/rrm-academy-posts.json scripts/data/masterclass-posts.json
git commit -m "feat: import RRM Academy Members and Masterclass archive posts"
```

---

### Task 9: STUC Community Testing & Fixes

**Step 1: Brian tests the STUC community feed**

Brian navigates to `https://rrmacademy.org/community` and critiques:
- Post display, comments, reactions
- Compose flow
- Event display
- Mobile responsiveness
- Imported content appearance

**Step 2: Fix issues**

Address each issue Brian identifies. This task is iterative.

**Step 3: Brian approves**

Explicit approval before moving to Layer 3.

---

## Layer 3: Go Live

### Task 10: Stripe Live Activation

**Files:**
- No code changes — CF Pages secret updates only

**Step 1: Verify current CF Pages Stripe keys are test mode**

Brian confirms the current `STRIPE_SECRET_KEY` in CF Pages is a test key. The live key is in 1Password at `op://Automation/RRMA Stripe API/credential` and starts with `sk_live_`.

**Step 2: Get the live webhook signing secret**

The webhook endpoint `we_1T4bPBAYnsgNHm0HZvGhdOZw` is already live and pointing at `https://rrmacademy.org/api/stripe-webhook`. Get its signing secret from Stripe dashboard or:

```bash
source ~/.zshrc
STRIPE_KEY=$(op read 'op://Automation/RRMA Stripe API/credential')
curl -s 'https://api.stripe.com/v1/webhook_endpoints/we_1T4bPBAYnsgNHm0HZvGhdOZw' -u "$STRIPE_KEY:" | python3 -c "import sys,json; print(json.load(sys.stdin).get('secret','NOT RETURNED - check dashboard'))"
```

Note: Stripe API doesn't return webhook secrets after creation. Brian may need to retrieve from Stripe Dashboard → Developers → Webhooks → Signing secret, or create a new webhook endpoint to get a fresh secret.

**Step 3: Swap CF Pages secrets to live values**

```bash
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name rrm-academy
# Paste the sk_live_* key

npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name rrm-academy
# Paste the live whsec_* value
```

Verify STRIPE_PRICE_* values match live price IDs (they should already — products were created with the live key):
- `STRIPE_PRICE_MEMBER` = `price_1T3SBpAYnsgNHm0HDmakIzcD`
- `STRIPE_PRICE_HERO` = `price_1T3SGbAYnsgNHm0HcdrG4bmx`
- `STRIPE_PRICE_SUPERHERO` = `price_1T3SICAYnsgNHm0Hh0GZer7c`

If these are already set to the live values, no change needed. If they're test price IDs, update them.

**Step 4: Test end-to-end purchase**

1. Log in as Brian (superadmin)
2. Navigate to a paid course → click purchase → complete Stripe Checkout
3. Verify: webhook fires → enrollment created in D1 → confirmation email sent
4. Navigate to STUC → subscribe to a tier → verify subscription active in Stripe
5. Check billing portal: `/account/billing` → manage subscription

**Step 5: Verify no double-charging risk**

Confirm no Wix billing is still active for any member. The enrollment-based access system (design doc Section 2) means no member loses access during the transition.

---

### Task 11: STUC Community Go-Live

**Files:**
- Modify: `src/components/Header.astro` — uncomment STUC-CUTOVER nav links
- Modify: community page templates — remove noindex/nofollow

**Step 1: Find and uncomment STUC-CUTOVER tags**

```bash
grep -rn "STUC-CUTOVER" src/ functions/
```

Uncomment all nav links tagged with `STUC-CUTOVER`.

**Step 2: Remove noindex from community pages**

In `src/pages/community/index.astro`, `events.astro`, and `post/` pages — remove or change the `noindex, nofollow` meta robots tag.

**Step 3: Deploy**

```bash
git add -A
git commit -m "feat: go live — STUC community nav links enabled, community pages indexed"
git push
```

Verify deployment succeeds in CF Pages dashboard.

**Step 4: Verify**

- Community link appears in site navigation
- Community pages are accessible to STUC subscribers
- Non-subscribers see the gate/upgrade prompt

---

### Task 12: Member Transition Communications

**Step 1: Draft welcome email**

Draft email for Brian's review:
- Subject: "RRM Academy has a new home"
- Explain: new site at rrmacademy.org, same content, better performance
- CTA: "Sign in with Google" (primary) or "Reset your password" (fallback)
- Note: all course enrollments preserved, no action needed to keep access

**Step 2: Brian reviews and approves**

**Step 3: Send via Resend**

Use the Resend API to send to all imported members (batch send, respect rate limits).

---

## Dependency Graph

```
Task 1 (Schema) ──┬── Task 2 (Member Import) ── Task 3 (Progress Enrichment)
                   │
                   ├── Task 4 (OAuth Backend) ── Task 5 (OAuth Frontend)
                   │
                   └── Task 6 (Channel Support) ── Task 7 (STUC Import)
                                                 ── Task 8 (Archive Import)

Task 7 + Task 9 (Testing) ── Task 10 (Stripe Live) ── Task 11 (Go-Live) ── Task 12 (Communications)
```

Tasks 2, 4, and 6 can run in parallel after Task 1.
Tasks 7 and 8 can run in parallel after Task 6.
Task 3 depends on Task 2.
Task 5 depends on Task 4.
Tasks 10-12 are sequential, after Brian approves Task 9.

## Brian's Manual Steps (not automatable)

1. **Create Google Cloud OAuth 2.0 credentials** — console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0 Client ID. Set redirect URI to `https://rrmacademy.org/api/auth/google-callback`.
2. **Set Google OAuth secrets in CF Pages** — `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` via wrangler.
3. **Scrape RRM Academy Members and Masterclass group discussions** via Claude in Chrome (for Task 8).
4. **Test STUC community** and provide feedback (Task 9).
5. **Swap Stripe secrets to live** (Task 10 — or delegate to Claude with confirmation).
6. **Review and approve transition email** (Task 12).
