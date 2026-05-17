# STUC Live Calls on Cloudflare Realtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Google Meet for Save the Uterus Club (STUC) live calls with in-site video conferencing on Cloudflare Realtime, so members never leave rrmacademy.org.

**Architecture:** RealtimeKit Core SDK (vanilla JS — the site has no client framework) handles media/signaling/recording/transcription. Four CF Pages Functions under `functions/api/community/call/` create meetings, mint participant tokens, catch RealtimeKit webhooks, and report call state. Three new D1 tables in `rrm-auth` hold meeting + recording + webhook-dedup state. Two Astro pages render the live call and the gated replay. The feature is gated by a `PUBLIC_REALTIME_CALLS` GitHub variable.

**Tech Stack:** Astro 5 (static) + CF Pages Functions + D1 (`rrm-auth`) + CF Stream + `@cloudflare/realtimekit` Core SDK. Tests: `node --test` with mocks in `test/_helpers.js`.

**Source spec:** `docs/superpowers/specs/2026-05-16-cloudflare-realtime-stuc-design.md` (v2, post `/arise --deep`).

---

## Conventions used throughout

- **Endpoint code MUST be written by the `coder` agent.** Per `CLAUDE.md`, never write `functions/api/` code directly. Each endpoint task: (1) you write the failing test, (2) you dispatch the `coder` agent with the behavioral contract below, (3) you run the test, (4) commit. The contract in each task is the agent's spec.
- **Batch commits.** Per memory `feedback-batch-arise-deploys`, accumulate all task commits on ONE branch `claude/stuc-realtime-calls` and push once at the end (Task 14). Do not push between tasks.
- **Test command:** `node --test test/<file>.test.js`. Mocks: `mockRequest`, `mockDB`, `mockEnv`, `mockWaitUntil`, `parseResponse` from `test/_helpers.js`.
- **Endpoint handler shape:** export `onRequestPost` / `onRequestGet`; handler receives `{ request, env, waitUntil, data }`.
- **Response shapes:** success `{ ok: true, ... }`; error `{ ok: false, error: 'code' }` with the correct HTTP status. Mirror sibling files in `functions/api/community/`.

---

## File structure

| File | Responsibility |
|---|---|
| `migrations/022_stuc_live_calls.sql` | NEW — `stuc_meeting`, `stuc_meeting_recording`, `stuc_webhook_event` tables + indexes |
| `functions/api/community/call/_rtk.js` | NEW — shared RealtimeKit API helper (create meeting, mint token); single place for the API base URL + auth header |
| `functions/api/community/call/meeting.js` | NEW — `POST` create a meeting (staff only) |
| `functions/api/community/call/token.js` | NEW — `POST` mint a slug-scoped participant token |
| `functions/api/community/call/webhook.js` | NEW — `POST` RealtimeKit webhook sink (signed, deduped) |
| `functions/api/community/call/state.js` | NEW — `GET` slug-scoped call-state poll |
| `functions/api/community/_shared.js` | MODIFY — add `staff` entry to `TIER_DISPLAY` |
| `functions/api/community/posts.js` | MODIFY — event-post DELETE adds explicit child-row cleanup |
| `functions/events/[slug].js` | MODIFY — public CTA flag-gate + Realtime routing |
| `src/pages/community/events.astro` | MODIFY — events-list CTA routing |
| `src/pages/community/events/[slug]/live.astro` | NEW — call page (vanilla-JS island) |
| `src/pages/community/events/[slug]/replay.astro` | NEW — gated replay page |
| `test/community-call-meeting.test.js` | NEW |
| `test/community-call-token.test.js` | NEW |
| `test/community-call-webhook.test.js` | NEW |
| `test/community-call-state.test.js` | NEW |
| `test/community-shared-tiers.test.js` | NEW |

---

## Task 1: RealtimeKit account setup and presets

Not TDD-able — this is provisioning. It resolves the spec's "open items" by reading current RealtimeKit docs (`developers.cloudflare.com/realtime/realtimekit/`).

**Files:** none (account + secrets).

- [ ] **Step 1: Create a RealtimeKit organization** in the Cloudflare dashboard under the rrmacademy account (account id `ecf2c5bc8b5ebd634bcb587b3890910a`). Record the **org id** and **API key**.

- [ ] **Step 2: Store credentials in 1Password.** Create item `CF - RealtimeKit - rrmacademy` in the `Automation` vault with fields: `org_id`, `api_key`, `webhook_signing_secret`.

- [ ] **Step 3: Wire CF Pages secrets.** In the `rrm-academy` Pages project, set: `RTK_API_KEY`, `RTK_ORG_ID`, `RTK_WEBHOOK_SECRET`. Use the dashboard or `npx wrangler pages secret put RTK_API_KEY --project-name rrm-academy`.

- [ ] **Step 4: Create the two presets** via the RealtimeKit API. `stuc_host` — own camera/mic, chat, screen share, mute others, remove participant, start/stop recording, promote co-host. `stuc_participant` — own camera/mic, chat, screen share. Record the two preset names/ids. Document the exact create-API `curl` calls in a comment block at the top of `functions/api/community/call/_rtk.js` (Task 4) so the setup is reproducible.

- [ ] **Step 5: Note the token TTL and webhook signature scheme.** From the RealtimeKit docs, record: the participant-token TTL (must be ≥ 4h — if the default is shorter, note the option to extend), the SDK event name for token expiry, the webhook signature header name + which fields are signed + the timestamp/freshness field. Write these into the `_rtk.js` header comment. These feed Tasks 5 and 6.

- [ ] **Step 6: Verify** — `curl` the RealtimeKit API with `RTK_API_KEY` to list presets; confirm both `stuc_host` and `stuc_participant` exist. No commit (no repo files changed).

---

## Task 2: D1 migration — three new tables

**Files:**
- Create: `migrations/022_stuc_live_calls.sql`

- [ ] **Step 1: Write the migration file.**

```sql
-- 022_stuc_live_calls.sql — STUC Cloudflare Realtime live-call tables.
CREATE TABLE IF NOT EXISTS stuc_meeting (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES community_post(id),
  rtk_meeting_id TEXT NOT NULL,
  host_user_id TEXT NOT NULL REFERENCES user(id),
  status TEXT NOT NULL DEFAULT 'scheduled',
  max_participants INTEGER NOT NULL DEFAULT 25,
  is_private INTEGER NOT NULL DEFAULT 0,
  meet_fallback_url TEXT,
  recording_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  ended_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stuc_meeting_post ON stuc_meeting(post_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stuc_meeting_rtk  ON stuc_meeting(rtk_meeting_id);

CREATE TABLE IF NOT EXISTS stuc_meeting_recording (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL UNIQUE REFERENCES stuc_meeting(id),
  rtk_event_id TEXT UNIQUE,
  stream_uid TEXT,
  transcript TEXT,
  duration_seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stuc_meeting_rec_meeting ON stuc_meeting_recording(meeting_id);

CREATE TABLE IF NOT EXISTS stuc_webhook_event (
  event_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Apply the migration to remote D1.**

Run: `export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/CF - D1 Operator - account/credential') && export CLOUDFLARE_ACCOUNT_ID="ecf2c5bc8b5ebd634bcb587b3890910a" && npx wrangler d1 execute rrm-auth --remote --file=migrations/022_stuc_live_calls.sql`
Expected: 3 `CREATE TABLE` + 3 `CREATE INDEX` succeed.

- [ ] **Step 3: Verify the tables exist.**

Run: `npx wrangler d1 execute rrm-auth --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'stuc_%'"`
Expected: `stuc_meeting`, `stuc_meeting_recording`, `stuc_webhook_event`.

- [ ] **Step 4: Mirror into `schema.sql`.** Append the three `CREATE TABLE` + index statements from Step 1 to the end of `schema.sql` (the canonical local schema reference), so local schema stays in sync with remote.

- [ ] **Step 5: Commit.**

```bash
git add migrations/022_stuc_live_calls.sql schema.sql
git commit -m "feat(stuc): add D1 tables for Realtime live calls"
```

---

## Task 3: Add `staff` tier to `TIER_DISPLAY`

`functions/api/community/_shared.js` is a **guarded file** — `npm run guard:update` is required after editing.

**Files:**
- Modify: `functions/api/community/_shared.js` (the `TIER_DISPLAY` object)
- Test: `test/community-shared-tiers.test.js`

- [ ] **Step 1: Write the failing test.**

```js
/**
 * Tests for TIER_DISPLAY in functions/api/community/_shared.js
 * Run with: node --test test/community-shared-tiers.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TIER_DISPLAY } from '../functions/api/community/_shared.js';

describe('TIER_DISPLAY', () => {
  it('has an entry for every tier requireMember can return', () => {
    for (const tier of ['staff', 'superhero', 'hero', 'member']) {
      assert.ok(TIER_DISPLAY[tier], `TIER_DISPLAY missing entry for "${tier}"`);
      assert.equal(typeof TIER_DISPLAY[tier], 'string');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `node --test test/community-shared-tiers.test.js`
Expected: FAIL — `TIER_DISPLAY missing entry for "staff"`.

- [ ] **Step 3: Add the `staff` entry.** In `functions/api/community/_shared.js`, change the `TIER_DISPLAY` object so it includes `staff`:

```js
export const TIER_DISPLAY = {
  staff: '🛡️ Team',
  member: '🐻 Member',
  hero: '💖 Hero',
  superhero: '🦸‍♀️ Superhero',
};
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `node --test test/community-shared-tiers.test.js`
Expected: PASS.

- [ ] **Step 5: Update the security guard manifest** (the file is guarded).

Run: `npm run guard:update`

- [ ] **Step 6: Commit.**

```bash
git add functions/api/community/_shared.js test/community-shared-tiers.test.js guard-manifest.json
git commit -m "feat(stuc): add staff tier to TIER_DISPLAY for call badges"
```

---

## Task 4: RealtimeKit helper + `POST /api/community/call/meeting`

Creates a RealtimeKit meeting and the `stuc_meeting` row. Staff only.

**Files:**
- Create: `functions/api/community/call/_rtk.js`
- Create: `functions/api/community/call/meeting.js`
- Test: `test/community-call-meeting.test.js`

- [ ] **Step 1: Write the failing test.**

```js
/**
 * Tests for POST /api/community/call/meeting
 * Run with: node --test test/community-call-meeting.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/community/call/meeting.js';
import { mockRequest, mockDB, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';

function ctx(request, env) {
  return { request, env, waitUntil: mockWaitUntil(), data: {} };
}

describe('POST /api/community/call/meeting', () => {
  it('returns 503 when RTK_API_KEY is missing', async () => {
    const env = mockEnv({ RTK_API_KEY: undefined, DB: mockDB() });
    const req = mockRequest('POST', { body: { postId: 'p1' } });
    const res = await onRequestPost(ctx(req, env));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 503);
    assert.equal(body.ok, false);
  });

  it('returns 401 when there is no session', async () => {
    const env = mockEnv({ RTK_API_KEY: 'k', DB: mockDB({ session: { first: null } }) });
    const req = mockRequest('POST', { body: { postId: 'p1' } });
    const res = await onRequestPost(ctx(req, env));
    const { status } = await parseResponse(res);
    assert.equal(status, 401);
  });

  it('returns 400 when postId is missing', async () => {
    const env = mockEnv({ RTK_API_KEY: 'k', DB: mockDB() });
    const req = mockRequest('POST', { body: {} });
    const res = await onRequestPost(ctx(req, env));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `node --test test/community-call-meeting.test.js`
Expected: FAIL — module `functions/api/community/call/meeting.js` not found.

- [ ] **Step 3: Implement via the `coder` agent.** Dispatch the `coder` agent (`subagent_type: "coder"`) with this contract:

> Create `functions/api/community/call/_rtk.js` and `functions/api/community/call/meeting.js` in rrm-academy-cf. Read sibling files in `functions/api/community/` first — match their auth, response-shape, and error patterns.
>
> `_rtk.js` exports two async helpers over the RealtimeKit REST API: `createRtkMeeting(env, { title })` → `{ rtkMeetingId }`, and `mintRtkToken(env, { rtkMeetingId, presetName, participantId, name, picture, metadata })` → `{ token }`. Both read `env.RTK_API_KEY` / `env.RTK_ORG_ID`, wrap the `fetch` in try/catch, and throw a tagged error on non-2xx. Put the reproducible preset-create `curl` calls and the token-TTL / webhook-signature notes from plan Task 1 in a header comment.
>
> `meeting.js` exports `onRequestPost`. Behavior: if `env.RTK_API_KEY` / `env.RTK_ORG_ID` missing → `503 { ok:false, error:'service_unavailable' }`. Auth via `requireMember()` from `../_shared.js`; require staff (`roleAtLeast(user.role,'mod')`) else `403`. Parse body `{ postId, hostUserId?, isPrivate?, meetFallbackUrl? }`; `postId` required (string, ≤100 chars) else `400`. Verify the `community_post` row exists else `404`. Call `createRtkMeeting`; on throw → `503 { error:'call_provider_unavailable' }`. INSERT a `stuc_meeting` row: `id` = `crypto.randomUUID()` hex, `status='scheduled'`, `host_user_id` = `hostUserId || user.id`, `max_participants=25`, `is_private` = `isPrivate?1:0`, `meet_fallback_url` = `meetFallbackUrl||null`. Return `201 { ok:true, meeting:{ id, rtkMeetingId, status } }`. On a missing-table D1 error return `503`.

- [ ] **Step 4: Run the test to verify it passes.**

Run: `node --test test/community-call-meeting.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add functions/api/community/call/_rtk.js functions/api/community/call/meeting.js test/community-call-meeting.test.js
git commit -m "feat(stuc): add call-meeting creation endpoint"
```

---

## Task 5: `POST /api/community/call/token`

Mints a slug-scoped participant token. Closes the IDOR — the request carries an event **slug**, never a raw meeting id.

**Files:**
- Create: `functions/api/community/call/token.js`
- Test: `test/community-call-token.test.js`

- [ ] **Step 1: Write the failing test.**

```js
/**
 * Tests for POST /api/community/call/token
 * Run with: node --test test/community-call-token.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/community/call/token.js';
import { mockRequest, mockDB, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';

function ctx(request, env) {
  return { request, env, waitUntil: mockWaitUntil(), data: {} };
}

describe('POST /api/community/call/token', () => {
  it('returns 503 when RTK_API_KEY is missing', async () => {
    const env = mockEnv({ RTK_API_KEY: undefined, DB: mockDB() });
    const req = mockRequest('POST', { body: { slug: 'march-call' } });
    const res = await onRequestPost(ctx(req, env));
    const { status } = await parseResponse(res);
    assert.equal(status, 503);
  });

  it('returns 400 when slug is missing', async () => {
    const env = mockEnv({ RTK_API_KEY: 'k', DB: mockDB() });
    const req = mockRequest('POST', { body: {} });
    const res = await onRequestPost(ctx(req, env));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  });

  it('returns 404 when the slug resolves to no meeting', async () => {
    const env = mockEnv({
      RTK_API_KEY: 'k',
      DB: mockDB({ 'FROM stuc_meeting': { first: null } }),
    });
    const req = mockRequest('POST', { body: { slug: 'no-such-call' } });
    const res = await onRequestPost(ctx(req, env));
    const { status } = await parseResponse(res);
    assert.equal(status, 404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `node --test test/community-call-token.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement via the `coder` agent.** Dispatch the `coder` agent with this contract:

> Create `functions/api/community/call/token.js` in rrm-academy-cf, exporting `onRequestPost`. Read sibling files in `functions/api/community/` and `functions/api/community/call/` first.
>
> Behavior: missing `env.RTK_API_KEY` → `503 { ok:false, error:'service_unavailable' }`. Auth: `requireMember()` from `../_shared.js` — returns `{ user, tier }`. Parse body `{ slug }`; `slug` required (string, ≤120 chars, `[a-z0-9-]` shape) else `400`. Resolve the meeting with ONE query joining `community_post` (by `slug COLLATE NOCASE`) to `stuc_meeting` (by `post_id`); no row → `404`. Gate: `stuc_meeting.status` must equal `'live'` else `409 { error:'call_not_live' }`. Capacity: if a current participant count is available from RealtimeKit and ≥ `max_participants` → `409 { error:'room_full' }` (if a count is not cheaply available, skip this check and leave a `// TODO capacity` — do not fake it). Choose preset: `stuc_host` if `user.id === meeting.host_user_id` OR `roleAtLeast(user.role,'mod')`, else `stuc_participant`. Call `mintRtkToken` from `./_rtk.js` with `participantId = user.id`, `name`, `picture = user.avatar_url`, `metadata = { tier }`; on throw → `503 { error:'call_provider_unavailable' }`. Return `200 { ok:true, token, preset, rtkMeetingId }`. Missing-table D1 error → `503`.

- [ ] **Step 4: Run the test to verify it passes.**

Run: `node --test test/community-call-token.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add functions/api/community/call/token.js test/community-call-token.test.js
git commit -m "feat(stuc): add slug-scoped call-token endpoint"
```

---

## Task 6: `POST /api/community/call/webhook`

RealtimeKit webhook sink — signed, deduped, non-blocking.

**Files:**
- Create: `functions/api/community/call/webhook.js`
- Test: `test/community-call-webhook.test.js`

- [ ] **Step 1: Write the failing test.**

```js
/**
 * Tests for POST /api/community/call/webhook
 * Run with: node --test test/community-call-webhook.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/community/call/webhook.js';
import { mockRequest, mockDB, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';

function ctx(request, env) {
  return { request, env, waitUntil: mockWaitUntil(), data: {} };
}

describe('POST /api/community/call/webhook', () => {
  it('fails closed with 503 when RTK_WEBHOOK_SECRET is missing', async () => {
    const env = mockEnv({ RTK_WEBHOOK_SECRET: undefined, DB: mockDB() });
    const req = mockRequest('POST', { rawBody: '{}' });
    const res = await onRequestPost(ctx(req, env));
    const { status } = await parseResponse(res);
    assert.equal(status, 503);
  });

  it('returns 401 when the signature header is missing or invalid', async () => {
    const env = mockEnv({ RTK_WEBHOOK_SECRET: 'whsec', DB: mockDB() });
    const req = mockRequest('POST', { rawBody: '{"event":"meeting.started"}' });
    const res = await onRequestPost(ctx(req, env));
    const { status } = await parseResponse(res);
    assert.equal(status, 401);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `node --test test/community-call-webhook.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement via the `coder` agent.** Dispatch the `coder` agent with this contract:

> Create `functions/api/community/call/webhook.js` in rrm-academy-cf, exporting `onRequestPost`. Read `functions/api/stripe-webhook.js` for the signature-verify + dedup pattern, and the sibling `call/` files.
>
> Behavior: if `env.RTK_WEBHOOK_SECRET` is missing/undefined → **fail closed**, `503 { ok:false, error:'service_unavailable' }`, process nothing. Read the raw body and the RealtimeKit signature header; verify the HMAC and the timestamp freshness window (scheme from `_rtk.js` Task 1 notes); invalid/stale → `401`. Dedup: `INSERT OR IGNORE INTO stuc_webhook_event(event_id) VALUES(?)`; if `meta.changes === 0` it is a duplicate → return `200 { ok:true, deduped:true }` with no side effects. Otherwise dispatch by event type:
> - `meeting.started` / `meeting.ended` → `UPDATE stuc_meeting SET status=?, started_at|ended_at=? WHERE rtk_meeting_id=?`.
> - `recording.statusUpdate` (completed) → resolve `meeting_id` from `rtk_meeting_id`; `INSERT INTO stuc_meeting_recording(...) ON CONFLICT(meeting_id) DO UPDATE SET rtk_event_id=excluded.rtk_event_id, duration_seconds=excluded.duration_seconds`; then trigger a CF Stream copy-from-URL import of the RealtimeKit recording URL via `waitUntil(...)` and store `stream_uid` (non-blocking — the handler must return 200 before the import completes).
> - `transcript.ready` → `INSERT INTO stuc_meeting_recording(meeting_id, transcript, ...) ON CONFLICT(meeting_id) DO UPDATE SET transcript=excluded.transcript`.
> Use `db.batch()` for any multi-statement write. Always return `200 { ok:true }` on success so RealtimeKit does not retry. Missing-table D1 error → `503`.

- [ ] **Step 4: Run the test to verify it passes.**

Run: `node --test test/community-call-webhook.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**

```bash
git add functions/api/community/call/webhook.js test/community-call-webhook.test.js
git commit -m "feat(stuc): add RealtimeKit webhook sink with dedup"
```

---

## Task 7: `GET /api/community/call/state`

**Files:**
- Create: `functions/api/community/call/state.js`
- Test: `test/community-call-state.test.js`

- [ ] **Step 1: Write the failing test.**

```js
/**
 * Tests for GET /api/community/call/state
 * Run with: node --test test/community-call-state.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/community/call/state.js';
import { mockRequest, mockDB, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';

function ctx(request, env) {
  return { request, env, waitUntil: mockWaitUntil(), data: {} };
}

describe('GET /api/community/call/state', () => {
  it('returns 400 when slug query param is missing', async () => {
    const env = mockEnv({ DB: mockDB() });
    const req = mockRequest('GET', { url: 'https://rrmacademy.org/api/community/call/state' });
    const res = await onRequestGet(ctx(req, env));
    const { status } = await parseResponse(res);
    assert.equal(status, 400);
  });

  it('returns 404 when the slug resolves to no meeting', async () => {
    const env = mockEnv({ DB: mockDB({ 'FROM stuc_meeting': { first: null } }) });
    const req = mockRequest('GET', { url: 'https://rrmacademy.org/api/community/call/state?slug=ghost' });
    const res = await onRequestGet(ctx(req, env));
    const { status } = await parseResponse(res);
    assert.equal(status, 404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `node --test test/community-call-state.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement via the `coder` agent.** Dispatch the `coder` agent with this contract:

> Create `functions/api/community/call/state.js` in rrm-academy-cf, exporting `onRequestGet`. Read the sibling `call/` files first.
>
> Behavior: auth via `requireMember()` from `../_shared.js`. Read `slug` from `new URL(request.url).searchParams`; required (string, ≤120 chars) else `400`. Resolve the meeting with ONE query joining `community_post` (`slug COLLATE NOCASE`) to `stuc_meeting`; no row → `404 { ok:false, error:'not_found' }`. Return `200 { ok:true, status, participantCount }` where `status` is `scheduled|live|ended` from the row and `participantCount` is from a cheap RealtimeKit lookup if available, else `0`. Select explicit columns — never `SELECT *` on these tables. Missing-table D1 error → `503`.

- [ ] **Step 4: Run the test to verify it passes.**

Run: `node --test test/community-call-state.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**

```bash
git add functions/api/community/call/state.js test/community-call-state.test.js
git commit -m "feat(stuc): add slug-scoped call-state endpoint"
```

---

## Task 8: `posts.js` DELETE — explicit child-row cleanup

D1 does not honor `ON DELETE CASCADE`. Deleting a STUC event post must explicitly clean up the meeting + recording rows.

**Files:**
- Modify: `functions/api/community/posts.js` (the DELETE handler — `onRequestDelete` / the delete branch)

- [ ] **Step 1: Read the current DELETE handler.** Open `functions/api/community/posts.js`, find the handler that deletes a `community_post` row. Note how it currently batches deletes (it already cleans up `community_comment` / `community_reaction`).

- [ ] **Step 2: Add the child cleanup.** In the same `db.batch([...])` that deletes the post, BEFORE the `community_post` delete, add — bound to the post id being deleted:

```js
env.DB.prepare(
  `DELETE FROM stuc_meeting_recording
     WHERE meeting_id IN (SELECT id FROM stuc_meeting WHERE post_id = ?)`
).bind(postId),
env.DB.prepare('DELETE FROM stuc_meeting WHERE post_id = ?').bind(postId),
```

(Use the existing variable name for the post id from the surrounding handler — match the file.)

- [ ] **Step 3: Run the existing community-post tests** to confirm no regression.

Run: `node --test test/*.test.js`
Expected: PASS (all existing tests).

- [ ] **Step 4: Run the security guard** — `posts.js` is not guarded, but run the guard to confirm nothing else tripped.

Run: `npm run guard`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add functions/api/community/posts.js
git commit -m "fix(stuc): clean up stuc_meeting rows on event-post delete"
```

---

## Task 9: `functions/events/[slug].js` — public CTA flag-gate + Realtime routing

**Files:**
- Modify: `functions/events/[slug].js` (the `ctaForVisitor` / CTA-building section, ~lines 155-187)

- [ ] **Step 1: Read the current CTA logic.** Open `functions/events/[slug].js`. Find where `primaryHref` / `primaryLabel` / `primaryAttrs` are set from `event.event_link`. Note the `JOIN_INFO_PATTERNS` scrubber at the top.

- [ ] **Step 2: Query for a `stuc_meeting` row.** Where the function loads the event from D1, add a second query (or a JOIN) fetching `stuc_meeting.status` and `stuc_meeting.id` for the event's `post_id`. Capture it as `stucMeeting` (may be `null`).

- [ ] **Step 3: Branch the CTA on the flag + meeting presence.** Replace the CTA-building block so that:
  - When `import.meta.env.PUBLIC_REALTIME_CALLS === 'true'` AND `stucMeeting` exists: `primaryHref = SITE_ORIGIN + '/community/events/' + slug + '/live'`, `primaryLabel = 'Join Call'`, `primaryAttrs = 'rel="noopener"'` (same-site — **drop `target="_blank"`**).
  - Otherwise: keep the existing `event_link` behavior unchanged (legacy Meet URL, external, `target="_blank"`).

- [ ] **Step 4: Document the scrubber decision.** Above `JOIN_INFO_PATTERNS`, add a one-line comment: `// Realtime-era join path (/community/events/<slug>/live) is members-gated, not a credential — intentionally NOT scrubbed; only legacy Meet URLs/PINs are.`

- [ ] **Step 5: Build to verify no syntax error.**

Run: `npx wrangler pages functions build --outdir=dist-check && rm -rf dist-check`
Expected: build succeeds.

- [ ] **Step 6: Commit.**

```bash
git add functions/events/[slug].js
git commit -m "feat(stuc): route public event CTA to Realtime live page behind flag"
```

---

## Task 10: `src/pages/community/events.astro` — events-list CTA routing

**Files:**
- Modify: `src/pages/community/events.astro` (the client-side `renderUpcomingCard` / event-card rendering JS)

- [ ] **Step 1: Read the current card renderer.** Find the JS that builds each event card's "Join Call" anchor from `ev.eventLink`.

- [ ] **Step 2: Surface meeting state in the events API response.** The events list is populated from an API call (find it — likely `/api/community/posts?channel=stuc&type=event` or similar). It must now also return, per event, whether a `stuc_meeting` exists and its `status`. If the existing endpoint already JOINs nothing extra, add `stucMeetingStatus` to its SELECT (dispatch the `coder` agent for that endpoint change, same contract style as Tasks 4-7: add a LEFT JOIN to `stuc_meeting` on `post_id`, return `stucMeetingStatus` nullable).

- [ ] **Step 3: Branch the card CTA.** In `renderUpcomingCard`, when `window.__REALTIME_CALLS__ === true` (a flag value injected by the Astro frontmatter — see Step 4) AND `ev.stucMeetingStatus` is set: the "Join Call" anchor `href` becomes `/community/events/${ev.slug}/live` (same-site, no `target="_blank"`). Otherwise keep the existing `ev.eventLink` behavior.

- [ ] **Step 4: Inject the flag into the page.** In the `events.astro` frontmatter, add `const REALTIME_CALLS = import.meta.env.PUBLIC_REALTIME_CALLS === 'true';` and emit `<script define:vars={{ REALTIME_CALLS }}>window.__REALTIME_CALLS__ = REALTIME_CALLS;</script>` before the island script.

- [ ] **Step 5: Build to verify.**

Run: `npm run build`
Expected: build succeeds; `events.astro` compiles.

- [ ] **Step 6: Commit.**

```bash
git add src/pages/community/events.astro functions/api/community/posts.js
git commit -m "feat(stuc): route events-list CTA to Realtime live page behind flag"
```

---

## Task 11: `live.astro` — the call page island

The call page. Vanilla-JS island, five state blocks (`loading`, `gate`, `content`, `error`, `ended`).

**Files:**
- Create: `src/pages/community/events/[slug]/live.astro`

- [ ] **Step 1: Create the page skeleton.** Mirror `src/pages/community/events.astro` for the BaseLayout + MaybeShell wrapping and the `noindex` flag. Body markup:

```astro
---
import BaseLayout from '../../../../layouts/BaseLayout.astro';
const { slug } = Astro.params;
---
<BaseLayout title="Live Call" description="Save the Uterus Club live call." noindex>
  <div class="call-page" data-slug={slug}>
    <div id="call-loading"><p>Loading the call…</p></div>
    <div id="call-gate" hidden>
      <p>You need to be a Save the Uterus Club member to join this call.</p>
      <a href="/community/" class="btn btn--primary">Go to Community</a>
    </div>
    <div id="call-ended" hidden>
      <p>This call has ended.</p>
      <a id="call-replay-link" class="btn btn--primary">Watch the replay</a>
    </div>
    <div id="call-error" hidden>
      <p id="call-error-msg">Something went wrong joining the call.</p>
      <a href="/community/events" class="btn">Back to Events</a>
      <a id="call-fallback-link" class="btn btn--secondary" hidden>Staff fallback</a>
    </div>
    <div id="call-content" hidden>
      <div id="call-grid"></div>
      <aside id="call-side">
        <div id="call-roster"></div>
        <div id="call-chat"></div>
      </aside>
      <div id="call-hostbar" hidden></div>
    </div>
  </div>
</BaseLayout>
```

- [ ] **Step 2: Add the island script.** Append a `<script>` (type module) to `live.astro` that:
  1. Reads `slug` from `.call-page[data-slug]`.
  2. `POST /api/community/call/token` with `{ slug }`. Handle responses: `403` → show `#call-gate`; `409 call_not_live` → show `#call-ended` with the replay link `href = /community/events/<slug>/replay`; `503` → show `#call-error` with msg "The call service is temporarily unavailable."; non-200 other → `#call-error`.
  3. On `200`: dynamically `import('@cloudflare/realtimekit')`, init the Core SDK with the returned `token`, join the meeting. Wrap in try/catch — any throw → `#call-error`.
  4. Render `#call-grid` (participant video tiles), `#call-roster`, `#call-chat` from SDK participant + chat events. For each chat message and roster entry, render the tier badge by looking up the participant metadata `tier` against a small inline `TIER_BADGE` map mirroring `TIER_DISPLAY` (`staff/member/hero/superhero`); unknown tier → no badge, never `undefined`.
  5. If the joined participant's preset is `stuc_host`, unhide `#call-hostbar` and wire mute / remove / record / screen-share / promote-co-host to the SDK.
  6. Listen for the SDK token-expiry event (name from Task 1 notes) → silently re-`POST /token`; if that returns `401` → show `#call-error` with "Your session expired — sign in to rejoin."
  7. The page **always attempts the join** regardless of any cached state — liveness gating lives only on the events-page CTA, not here.

- [ ] **Step 3: Add `@cloudflare/realtimekit` to dependencies.**

Run: `npm install @cloudflare/realtimekit`
Then confirm it appears under `dependencies` in `package.json`.

- [ ] **Step 4: Build to verify.**

Run: `npm run build`
Expected: build succeeds; the route `/community/events/[slug]/live` appears in `dist/`.

- [ ] **Step 5: Commit.**

```bash
git add src/pages/community/events/[slug]/live.astro package.json package-lock.json
git commit -m "feat(stuc): add Realtime live-call page"
```

---

## Task 12: `replay.astro` — gated replay page

**Files:**
- Create: `src/pages/community/events/[slug]/replay.astro`

- [ ] **Step 1: Create the page.** Mirror the `live.astro` BaseLayout/`noindex` wrapping. It is a members-gated page. Body:

```astro
---
import BaseLayout from '../../../../layouts/BaseLayout.astro';
const { slug } = Astro.params;
---
<BaseLayout title="Call Replay" description="Save the Uterus Club call replay." noindex>
  <div class="replay-page" data-slug={slug}>
    <div id="replay-loading"><p>Loading…</p></div>
    <div id="replay-gate" hidden>
      <p>You need to be a Save the Uterus Club member to watch this replay.</p>
      <a href="/community/" class="btn btn--primary">Go to Community</a>
    </div>
    <div id="replay-processing" hidden><p>The recording is still processing — check back shortly.</p></div>
    <div id="replay-unavailable" hidden><p>No replay is available for this call.</p></div>
    <div id="replay-content" hidden>
      <div id="replay-player"></div>
      <details id="replay-transcript"><summary>Transcript</summary><div id="replay-transcript-body"></div></details>
    </div>
  </div>
</BaseLayout>
```

- [ ] **Step 2: Add a replay-data endpoint.** The replay page needs recording data. Dispatch the `coder` agent to create `functions/api/community/call/replay.js` (`onRequestGet`, contract: `requireMember()` auth; `slug` query param required → `400`; resolve meeting via `community_post.slug` JOIN `stuc_meeting`; `404` if none; if `stuc_meeting.is_private = 1` → `404` (test-call recordings never exposed); look up `stuc_meeting_recording` by `meeting_id`, selecting explicit columns; return `200 { ok:true, state }` where `state` is `'content'` with `{ streamUid, transcript }` if a `stream_uid` exists, `'processing'` if `stuc_meeting.status='ended'` but no recording/`stream_uid` yet, `'unavailable'` otherwise; missing-table → `503`).

- [ ] **Step 3: Add the replay island script.** Append a `<script>` to `replay.astro` that calls `GET /api/community/call/replay?slug=<slug>`, then: `403` → `#replay-gate`; `state==='processing'` → `#replay-processing`; `state==='unavailable'` → `#replay-unavailable`; `state==='content'` → `#replay-content`, mount the existing course CF Stream player with `streamUid` (reuse the component/embed pattern from the course lesson player) and fill `#replay-transcript-body` with the transcript text.

- [ ] **Step 4: Write the failing test for the replay endpoint** (`test/community-call-replay.test.js`) — mirror the `state.js` test: `400` on missing slug, `404` on no meeting. Run it (fails — module missing), then it passes after Step 2's agent dispatch. Order Step 2 before this if executing strictly; either way confirm `node --test test/community-call-replay.test.js` PASSES before committing.

- [ ] **Step 5: Build to verify.**

Run: `npm run build`
Expected: build succeeds; `/community/events/[slug]/replay` in `dist/`.

- [ ] **Step 6: Commit.**

```bash
git add src/pages/community/events/[slug]/replay.astro functions/api/community/call/replay.js test/community-call-replay.test.js
git commit -m "feat(stuc): add gated call-replay page"
```

---

## Task 13: Feature flag wiring

**Files:** none (GitHub variable + verification).

- [ ] **Step 1: Confirm the flag default.** `PUBLIC_REALTIME_CALLS` is read by `functions/events/[slug].js` and `events.astro` via `import.meta.env`. With the GitHub variable unset, `import.meta.env.PUBLIC_REALTIME_CALLS` is `undefined`, so every flag check (`=== 'true'`) is false — the feature is OFF by default. No code change needed; confirm by grep that all three checks compare against the string `'true'`.

Run: `grep -rn "PUBLIC_REALTIME_CALLS" functions/ src/`
Expected: every occurrence is `=== 'true'`.

- [ ] **Step 2: Ensure the build passes the variable through.** Confirm `deploy.yml` exposes repository variables to the build env, OR add `PUBLIC_REALTIME_CALLS: ${{ vars.PUBLIC_REALTIME_CALLS }}` to the build step's `env:` block (Astro only inlines `PUBLIC_`-prefixed vars that are present at build time). If `deploy.yml` is edited, note that workflow-file changes need the `WORKFLOWS_PAT` secret.

- [ ] **Step 3: Leave the flag OFF for now.** Do NOT set the GitHub variable yet — rollout phase 1 (internal test call) happens after the branch is merged and the migration is confirmed. Document the activation command in the commit message:
  `gh variable set PUBLIC_REALTIME_CALLS --body "true"` to enable; `--body "false"` (or delete) to disable.

- [ ] **Step 4: Commit** (only if `deploy.yml` was modified).

```bash
git add .github/workflows/deploy.yml
git commit -m "chore(stuc): pass PUBLIC_REALTIME_CALLS through to the build"
```

---

## Task 14: Final verification, batch push, deploy

- [ ] **Step 1: Run the full unit test suite.**

Run: `node --test test/*.test.js`
Expected: PASS — all existing tests plus the 5 new `community-call-*` / `community-shared-tiers` files.

- [ ] **Step 2: Type check.**

Run: `npm run check-types`
Expected: no new errors above baseline. If new errors, fix them or bump `scripts/type-check-baseline.json` deliberately.

- [ ] **Step 3: Security guard.**

Run: `npm run guard`
Expected: PASS (manifest already updated in Task 3).

- [ ] **Step 4: Full build.**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Run `/arise` on the new endpoint code.** The endpoint files are new code in a sibling-dense directory — run `/arise functions/api/community/call/` and squash any CRITICAL/HIGH findings before push.

- [ ] **Step 6: Confirm migration 022 is applied to remote `rrm-auth`** (done in Task 2 — re-verify).

Run: `npx wrangler d1 execute rrm-auth --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'stuc_%'"`
Expected: 3 tables.

- [ ] **Step 7: Push the branch.** All task commits are on `claude/stuc-realtime-calls`. Push once.

```bash
git push -u origin claude/stuc-realtime-calls
```

The rrm-academy-cf CI auto-merges `claude/*` to `main` and deploys. The feature stays invisible (flag off).

- [ ] **Step 8: Rollout phase 1 — internal test call.** After deploy: create a meeting via `POST /api/community/call/meeting` with `isPrivate: true`, set `PUBLIC_REALTIME_CALLS` on for a test window (`gh variable set PUBLIC_REALTIME_CALLS --body "true"`), and run an internal call (Brian, Naomi, 1-2 staff). Validate join, badges, host controls, recording, and transcript. Then proceed to the parallel phase per the spec.

---

## Self-review (completed by plan author)

- **Spec coverage:** migration (T2), `staff` badge (T3), 4 endpoints + `_rtk` helper (T4-7) + replay endpoint (T12), child-delete cleanup (T8), public CTA (T9) + events-list CTA (T10), live page (T11), replay page (T12), feature flag (T13), rollout phase 1 (T14 Step 8). All spec §sections map to a task.
- **Placeholder scan:** endpoint internals are delegated to the `coder` agent with explicit behavioral contracts (mandatory per `CLAUDE.md` — endpoint code may not be written directly); the one `// TODO capacity` in T5 is conditional and explicitly bounded ("do not fake it"). Test code, migration SQL, and Astro skeletons are fully inline.
- **Type/name consistency:** `stuc_meeting` / `stuc_meeting_recording` / `stuc_webhook_event`, `rtk_meeting_id`, `host_user_id`, `meet_fallback_url`, `is_private`, the `call_not_live` / `room_full` / `call_provider_unavailable` / `service_unavailable` error codes, and the `loading/gate/content/error/ended` block ids are used consistently across all tasks and match the spec.
