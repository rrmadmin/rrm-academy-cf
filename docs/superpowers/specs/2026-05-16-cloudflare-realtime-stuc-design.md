# STUC Live Calls on Cloudflare Realtime — Design

**Date:** 2026-05-16
**Status:** Revised after `/arise --deep` (27 findings folded in) — pending re-review
**Project:** rrm-academy-cf
**Author:** Brian (with Claude)

## Revision log

- **2026-05-16 v1** — initial design, approved at brainstorm.
- **2026-05-16 v2** — `/arise --deep` spec trace returned 4 CRITICAL + 13 HIGH + 7 MEDIUM
  + 3 LOW. All 27 folded in. Two structural changes did most of the work:
  1. Added a v1 meeting-creation endpoint (`POST /api/community/call/meeting`). v1 is
     no longer unreachable before cutover.
  2. Dropped the `event_link` repurpose entirely. `community_post.event_link` is left
     untouched (legacy Meet URLs keep working). The live-call route is resolved from
     the event's `slug` + a `stuc_meeting` row; the staff escape-hatch Meet URL gets
     its own `meet_fallback_url` column on `stuc_meeting`.

## Goal

Replace the Google Meet setup for Save the Uterus Club (STUC) live calls with video
conferencing built on Cloudflare Realtime, so members never leave rrmacademy.org. The
call happens inside the members area, recordings and transcripts live entirely in RRM
Academy infrastructure, and member tier badges render natively in the call chat and
attendee list.

## Motivation

Four drivers, confirmed during brainstorming:

1. **On-site experience** — members stay on rrmacademy.org for the whole call.
2. **Data sovereignty / privacy** — recordings, transcripts, attendance, and chat live
   in CF infra (R2 / CF Stream / D1), not Google Workspace.
3. **Custom features** — chiefly member tier badges shown next to every name in chat
   and the participant roster.
4. **Cost / scale** — headroom for more frequent calls without Workspace per-seat cost.

## Current state (being replaced)

- STUC events created via the `/stuc-event` skill: a Google Calendar event on the STUC
  calendar with Google Meet auto-attached (DWD impersonation), auto-record /
  auto-transcribe / smart notes enabled.
- The Meet URL is stored in `community_post.event_link` (D1 `rrm-auth`).
- An SES email blast notifies ~46 STUC members.
- Members reach calls from `/community/events`; a public landing page exists at
  `/events/<slug>`.

## Confirmed requirements

| Dimension | Decision |
|---|---|
| Call format | Small roundtable, everyone on camera, ~5-25 participants |
| Broadcast/viewer split | Not needed |
| Recording | Auto-record + post-call transcript, gated member replay (full Meet parity) |
| Room entry | Logged-in STUC member joins instantly when the room is live; no lobby |
| Host model | Host is a role, not a fixed person. The event designates a host; a non-staff presenter can be made host for their event; co-host promotion covers mid-call |
| Host controls | Mute / remove participant, start / stop recording, screen share, promote co-host |
| Rollout | Soft launch (internal test call) → parallel (Meet fallback kept) → cutover |
| Timeline | No hard deadline |

## Cloudflare Realtime — product facts

CF Realtime has three layers:

- **Realtime SFU** — low-level media router. GA. $0.05/GB egress, first 1 TB/mo free.
- **RealtimeKit** — high-level SDKs (Core SDK + UI Kit), server-side recording,
  post-call Whisper transcription. Currently **free beta**. GA pricing:
  $0.002/min per audio-video participant, $0.010/min full A/V recording export,
  $0.0005/min raw RTP to R2.
- **TURN** — relay for restrictive NATs. Free with SFU.

A 25-person 60-minute call at GA pricing ≈ $3.60 all-in including recording.

## Approach decision

**Chosen: RealtimeKit Core SDK + custom RRM components.**

Use the RealtimeKit **Core SDK** for media plumbing (join, tracks, chat data channel,
participant events) and build the call UI — video grid, chat panel, participant roster
— as our own components in the rrm-academy design system. RealtimeKit's managed
server-side recording and post-call Whisper transcription handle the hard parts.

**Implementation note: rrm-academy-cf has no client framework.** Every interactive page
is a vanilla-JS island (`<div hidden>` blocks + `fetch`). The RealtimeKit React SDK is
NOT used. We use `@cloudflare/realtimekit`, the framework-agnostic Core SDK package, and
build the call UI in vanilla JS following the existing
`src/pages/community/events.astro` island pattern. No React is introduced.

Rejected alternatives:

- **RealtimeKit UI Kit (prebuilt components)** — fastest to ship, but the member badge
  requirement means overriding the prebuilt chat and roster, i.e. fighting the framework.
- **Raw Realtime SFU, fully custom** — cheapest at huge scale but the SFU has no
  built-in recording or transcription; weeks of extra work. Overkill for 5-25 person
  roundtables.

## Architecture

```
Member browser
  │  1. GET /community/events/<slug>/live   (Astro page, vanilla-JS island)
  │  2. POST /api/community/call/token      → mints RealtimeKit token (slug-scoped)
  ▼
RealtimeKit Core SDK (@cloudflare/realtimekit) ──media/signaling──► CF Realtime SFU
  │                                                                  │
  │  custom UI: video grid + chat + roster (vanilla JS)              │ server-side
  │                                                                  │ recording + Whisper
  ▼                                                                  ▼
CF Pages Functions (create / token / webhook / state)     RealtimeKit webhook
  │                                                                  │
  ▼                                                                  ▼
D1 rrm-auth (stuc_meeting, stuc_meeting_recording,        POST /api/community/call/webhook
              stuc_webhook_event)                          (signed; dedup; fast 200)
CF Stream (recording replay) ◄── webhook triggers async copy-from-URL import
```

RealtimeKit owns all media, signaling, recording, and transcription. The Pages Functions
do four things: create meetings (staff), mint participant tokens, catch webhooks, and
report call state. No Durable Objects and no WebSocket server are needed — the real-time
path is entirely Cloudflare's.

## Data model

New D1 migration `migrations/022_stuc_live_calls.sql` in `rrm-auth`. (Migration number
`022` confirmed free — current highest is `021_ask_saved.sql`.)

```sql
CREATE TABLE IF NOT EXISTS stuc_meeting (
  id TEXT PRIMARY KEY,                              -- openssl rand -hex 16
  post_id TEXT NOT NULL REFERENCES community_post(id),  -- the event announcement row (1:1)
  rtk_meeting_id TEXT NOT NULL,                     -- RealtimeKit meeting id
  host_user_id TEXT NOT NULL REFERENCES user(id),   -- designated host; defaults to creator
  status TEXT NOT NULL DEFAULT 'scheduled',         -- scheduled | live | ended
  max_participants INTEGER NOT NULL DEFAULT 25,
  is_private INTEGER NOT NULL DEFAULT 0,            -- 1 = internal test call (excluded from member replay)
  meet_fallback_url TEXT,                           -- staff-invoked escape hatch; never surfaced to members
  recording_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  ended_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stuc_meeting_post ON stuc_meeting(post_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stuc_meeting_rtk  ON stuc_meeting(rtk_meeting_id);

CREATE TABLE IF NOT EXISTS stuc_meeting_recording (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL UNIQUE REFERENCES stuc_meeting(id),  -- one recording per meeting
  rtk_event_id TEXT UNIQUE,                         -- RealtimeKit recording event id
  stream_uid TEXT,                                  -- CF Stream uid for gated replay
  transcript TEXT,                                  -- post-call Whisper output
  duration_seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stuc_meeting_rec_meeting ON stuc_meeting_recording(meeting_id);

CREATE TABLE IF NOT EXISTS stuc_webhook_event (
  event_id TEXT PRIMARY KEY,                        -- RealtimeKit webhook event id
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Design contracts encoded in the schema (each closes an `/arise` finding):

- **`post_id` NOT NULL + UNIQUE** — every meeting has exactly one announcement post;
  no orphaned, UI-unreachable meetings. The live route and replay route both resolve
  from `community_post.slug` via this 1:1 link.
- **`rtk_meeting_id` UNIQUE** — the webhook correlates by RealtimeKit meeting id; the
  unique index makes that lookup indexed and guarantees the `UPDATE ... WHERE
  rtk_meeting_id = ?` hits exactly one row.
- **`host_user_id` NOT NULL, defaults to the creating staff member** — a call can never
  be leaderless. Creation is staff-authed, so the creator is always a valid host; the
  staff `stuc_host` preset and co-host promotion handle reassignment.
- **`stuc_meeting_recording.meeting_id` UNIQUE + `rtk_event_id` UNIQUE** — the recording
  insert is idempotent; a retried `recording.statusUpdate` cannot create a duplicate row.
- **`stuc_webhook_event`** — every inbound webhook id is recorded with `INSERT OR IGNORE`;
  a duplicate or replayed delivery is detected and short-circuited before any side effect.
- **`max_participants`** — `/token` enforces a hard cap (default 25, the design envelope).
- **`is_private`** — internal test-call recordings are excluded from the member replay
  surface.

`community_post.event_link` is **NOT touched** by this feature. Legacy events keep their
Meet URLs there and keep working. The CF Realtime live route is never stored in
`event_link`; it is derived at render time as `/community/events/<slug>/live` whenever a
`stuc_meeting` row exists for the post and the feature flag is on.

`transcript` is stored as D1 `TEXT`. A 60-minute multi-speaker Whisper transcript is
~50-150 KB, within D1's row-size limit. To avoid dragging it through unrelated queries,
list/state queries MUST select explicit columns — never `SELECT *` on
`stuc_meeting_recording`.

## Endpoints

All new endpoints live under `functions/api/community/call/` and MUST be written via the
`coder` agent (reads siblings, runs arise-scanner proof gates, applies review gates
R1-R6). Every endpoint returns `503 { error: 'service_unavailable' }` on a missing-table
D1 error, so a deploy that lands before migration 022 fails loud, not silent.

### `POST /api/community/call/meeting` — create a meeting (NEW)

- **Auth:** staff only (`roleAtLeast(role, 'mod')`).
- **Body:** `{ postId, hostUserId?, isPrivate?, meetFallbackUrl? }`.
- **Behavior:** calls the RealtimeKit create-meeting API (in try/catch → `503
  { error: 'call_provider_unavailable' }` on throw/5xx), then inserts a `stuc_meeting`
  row at `status='scheduled'` with `rtk_meeting_id` from the API response.
  `host_user_id` defaults to the authenticated creator when `hostUserId` is omitted.
- **Why:** this is the v1 meeting-creation path. Without it, `/token` has no row to look
  up and the internal test call + parallel rollout cannot happen. At cutover the
  `/stuc-event` skill is updated to call this endpoint instead of creating a Meet space.

### `POST /api/community/call/token` — mint a participant token (REVISED)

- **Auth:** `requireMember()`.
- **Body:** `{ slug }` — the event slug, NOT a raw meeting id. The endpoint resolves the
  `stuc_meeting` row via `community_post.slug` + `post_id`. A member can only ever obtain
  a token for the meeting behind a slug they name; there is no caller-supplied meeting id.
- **Gates:**
  - `stuc_meeting.status` must be `live` → otherwise `409 { error: 'call_not_live' }`.
    (Scheduled and ended meetings reject token requests.)
  - Current participant count `< max_participants` → otherwise
    `409 { error: 'room_full' }`.
- **Behavior:** selects the **preset** by role — `stuc_host` if the user is the meeting's
  `host_user_id` or has staff role, otherwise `stuc_participant`. Calls the RealtimeKit
  token API (try/catch → `503 { error: 'call_provider_unavailable' }`). The RealtimeKit
  **participant id is `user.id`**, so a member opening two tabs is one identity, not two
  roster tiles. Embeds `name`, `picture` (`user.avatar_url`), and `tier` as participant
  metadata.
- **Token TTL:** the minted token's TTL MUST exceed the maximum expected call length
  (set ≥ 4 hours). The island also listens for the SDK token-expiry event and silently
  re-calls `/token` to refresh; if the refresh returns `401` (session expired) the island
  shows the session-expired state (see Front-end).

### `POST /api/community/call/webhook` — RealtimeKit webhook sink (REVISED)

- **Auth:** RealtimeKit webhook signature. If the signing-secret env var is missing or
  undefined, the handler **fails closed** — returns `503 { error: 'service_unavailable' }`
  and processes nothing. An invalid signature returns `401`. The signature MUST cover a
  timestamp; deliveries outside a freshness window are rejected.
- **Dedup:** the handler first does `INSERT OR IGNORE INTO stuc_webhook_event(event_id)`.
  If no row was inserted (duplicate / replayed delivery), it returns `200` immediately
  without side effects.
- **Events handled:** `meeting.started`, `meeting.ended`, `recording.statusUpdate`,
  `transcript.ready`. `meeting.started` / `meeting.ended` update
  `stuc_meeting.status` / `started_at` / `ended_at` (correlated by `rtk_meeting_id`).
- **Recording + transcript:** both `recording.statusUpdate=completed` and
  `transcript.ready` write `stuc_meeting_recording` via `INSERT ... ON CONFLICT(meeting_id)
  DO UPDATE` — whichever webhook arrives first creates the row, the other patches its
  column. Neither depends on the other's ordering.
- **CF Stream import is non-blocking.** The webhook does NOT stream the MP4 bytes
  itself. It records the RealtimeKit recording URL and triggers CF Stream's
  copy-from-URL import (Stream pulls the file asynchronously). The webhook returns `200`
  before any large transfer, so it never times out and never triggers a retry cascade.

### `GET /api/community/call/state?slug=` — call state poll (REVISED)

- **Auth:** `requireMember()`.
- **Param:** `slug` — the event slug. The meeting id is resolved server-side; it is never
  a caller-supplied value. Unknown slug → `404 { error: 'not_found' }`.
- **Returns:** `{ status, participantCount }` where `status` is
  `scheduled | live | ended`. The `ended` value lets the live page render its
  ended-state UI and the events page render the right CTA.

### RealtimeKit presets

Two permission presets are defined once via the RealtimeKit API (exact create payloads
go in the implementation plan):

- **`stuc_host`** — own camera/mic, chat, screen share, plus: mute others, remove
  participant, start/stop recording, promote co-host.
- **`stuc_participant`** — own camera/mic, chat, screen share.

Co-host promotion mid-call: the host triggers a preset change on the target participant
through the Core SDK / RealtimeKit API.

## Front-end — the call page

New Astro route `src/pages/community/events/[slug]/live.astro`. It is a vanilla-JS
island following the existing `events.astro` structure, with **five** state blocks
(the base pattern has only loading/gate/content — the error and ended blocks are new
and required):

- `#call-loading` — initial state.
- `#call-gate` — non-members get the "join STUC" CTA.
- `#call-content` — members only; the live call UI.
- `#call-error` — shown when the Core SDK fails to load, `/token` returns a non-200
  (distinguishing `503 call_provider_unavailable` → "the call service is having
  trouble" from `403` → not a member), or `join()` rejects. Includes an escape link to
  `/community/events`. If the meeting has a `meet_fallback_url` and the member is staff,
  the staff-only fallback link is shown here.
- `#call-ended` — shown when `/state` reports `status='ended'`; links to the replay page.

The `/live` page **always permits the join attempt** (token mint + SDK join) regardless
of `status` — `status='live'` gating lives only on the events-page "Join Call"
affordance, not on `/live` itself. This avoids the chicken-and-egg deadlock where the
first joiner could never join because the room only goes `live` on first join. (The
`/token` `409 call_not_live` gate still applies; the live page handles that 409 in
`#call-ended` / a "not started yet" message.)

The island:

- Imports the `@cloudflare/realtimekit` Core SDK, calls `/api/community/call/token` with
  the page slug, and joins the meeting.
- Renders three custom panels styled only with tokens from
  `docs/design/design-system.json`:
  - **Video grid** — participant tiles with active-speaker highlight.
  - **Chat panel** — RealtimeKit chat data channel; each message rendered by our code,
    so the sender's tier badge sits inline.
  - **Roster** — participant list with the same badge.
- Shows a host-only control bar (mute / remove / record / screen share / promote
  co-host) when the joined participant's preset is `stuc_host`.
- Listens for the SDK token-expiry event and silently re-mints via `/token`.

## Member badges

`requireMember()` returns `tier` — `staff` / `superhero` / `hero` / `member`. The
`/token` endpoint stamps `tier` into RealtimeKit participant metadata. Because the call
island renders chat and roster itself, the badge renders next to every name.

**`TIER_DISPLAY` in `functions/api/community/_shared.js` currently maps only `member` /
`hero` / `superhero` — it has NO `staff` entry.** This migration adds a `staff` entry
(e.g. `staff: '🛡️ Team'`). `_shared.js` is a guarded file, so `npm run guard:update`
runs after the edit. The badge renderer also falls back to no badge (never `undefined`
text, never a throw) for any tier value not in the map.

## Recording, transcript, replay

RealtimeKit auto-records each call server-side (preset-driven). On
`recording.statusUpdate=completed`, the webhook records the recording URL and triggers a
CF Stream copy-from-URL import (asynchronous; the webhook does not block). CF Stream
infrastructure, a `/api/stream/token` endpoint, and the course video player already
exist and are reused. Post-call Whisper transcription arrives via the `transcript.ready`
webhook and is stored in `stuc_meeting_recording.transcript`.

A gated **replay** page lives at `src/pages/community/events/[slug]/replay.astro`,
members-only, reusing the existing course Stream player component. Replay states:

- `stuc_meeting.status='ended'` and a `stuc_meeting_recording` row with a `stream_uid`
  exists → render the player.
- `status='ended'` but no recording row / no `stream_uid` yet → render "Recording is
  processing — check back shortly" (never a bare 404).
- `stuc_meeting.is_private = 1` → the replay page returns the members gate / 404; internal
  test-call recordings are never exposed on the member replay surface.

## Files changed (inventory)

| File | Change |
|---|---|
| `migrations/022_stuc_live_calls.sql` | NEW — 3 tables + indexes |
| `functions/api/community/call/meeting.js` | NEW — create endpoint |
| `functions/api/community/call/token.js` | NEW — token mint |
| `functions/api/community/call/webhook.js` | NEW — webhook sink |
| `functions/api/community/call/state.js` | NEW — state poll |
| `src/pages/community/events/[slug]/live.astro` | NEW — call page island |
| `src/pages/community/events/[slug]/replay.astro` | NEW — gated replay |
| `functions/api/community/_shared.js` | MODIFY — add `staff` to `TIER_DISPLAY` (guarded → `guard:update`) |
| `functions/api/community/posts.js` | MODIFY — event-post DELETE handler adds explicit `db.batch()` cleanup of `stuc_meeting_recording` then `stuc_meeting` by `post_id` (D1 CASCADE is inert) |
| `functions/events/[slug].js` | MODIFY — public `/events/<slug>` CTA: flag-gate, route "Join Call" to `/community/events/<slug>/live` when a `stuc_meeting` row exists, same-site (no `target="_blank"`); confirm `JOIN_INFO_PATTERNS` is still correct for the Realtime era (the members-gated live path is not a credential and is acceptable in public metadata — documented, not stripped) |
| `src/pages/community/events.astro` | MODIFY — events list CTA routes to `/live` when a `stuc_meeting` row exists and the flag is on |

## Feature flag and rollout

A `PUBLIC_REALTIME_CALLS` GitHub Actions variable gates the feature, mirroring the App
Shell `PUBLIC_SHELL_ROUTES` pattern:

- The flag gates **only the event-page CTA routing** (`functions/events/[slug].js` and
  `events.astro` deciding whether "Join Call" points at the legacy Meet URL or at
  `/community/events/<slug>/live`).
- The flag does **NOT** gate `/live`, `/token`, `/webhook`, or `/state`. A call that is
  already live stays reachable for reconnection regardless of flag state, and the webhook
  keeps recording. Flipping the flag mid-call does not end the call.

Rollout phases (all phases have a working creation path via `POST
/api/community/call/meeting`):

1. **Internal test call** — Brian, Naomi, 1-2 staff. Create the meeting with
   `is_private = 1` so the recording never reaches the member replay surface. Validate
   devices, recording, and transcript end to end.
2. **Parallel** — 2-3 real STUC calls. The escape hatch is `stuc_meeting.meet_fallback_url`
   — a Meet URL invoked **by staff only** if the CF call fails on the night. It is never
   surfaced to members, so the call cannot split into two member-facing rooms.
3. **Cutover** — the `/stuc-event` skill is updated to call `POST
   /api/community/call/meeting` instead of creating a Meet space. `meet_fallback_url` is
   left null for new events once RealtimeKit is proven.

**Deploy ordering:** migration 022 MUST be applied to `rrm-auth` before the endpoint PR
merges. The endpoints' missing-table → 503 behavior is the backstop if ordering slips.

## Host model

Host is a role, not a fixed person. `stuc_meeting.host_user_id` is NOT NULL and defaults
to the creating staff member, so every call has a host from creation. The `/token`
preset logic grants `stuc_host` to the designated host OR any staff member, so a staff
attendee is always able to record and moderate even if the designated host is absent.
Co-host promotion (host changes a participant's preset mid-call) covers reassignment. A
non-staff presenter can be made the designated host for their event by passing
`hostUserId` to the creation endpoint.

## Out of scope (YAGNI for v1)

Breakout rooms, polls, virtual backgrounds, waiting-room/lobby (instant entry chosen),
viewer/broadcast split (roundtable only), live in-call captions (post-call transcript
only), mobile-native apps (responsive web only), an attendance table (replay is
members-only, not attendee-gated, per the confirmed requirement; `is_private` handles the
test-call exclusion).

## Risks

- **RealtimeKit is in beta.** Mitigated by the feature flag, the parallel rollout, the
  `meet_fallback_url` staff escape hatch, and the `#call-error` in-page state that gives
  a stranded member a way out. The underlying Realtime SFU is GA; only the convenience
  layer is beta.
- **GA pricing.** Free during beta; ~$3-4 per call at GA. Negligible, noted.
- **`functions/api/community/_shared.js` is a guarded file.** Adding the `staff` entry to
  `TIER_DISPLAY` requires `npm run guard:update` before committing. New endpoints under
  `functions/api/community/call/` are unguarded but must follow the same coding standards;
  the `coder` agent enforces this.
- **Unbounded attendance vs the 25-person design envelope.** The eligible population
  (~46 members + staff) exceeds the roundtable envelope. `max_participants` (default 25)
  + the `/token` `409 room_full` gate cap a single room. If demand routinely exceeds 25,
  the viewer/broadcast split (currently out of scope) would need to be reconsidered.

## Open items for the implementation plan

- RealtimeKit account setup: API key provisioning, 1Password storage, CF Pages secret
  wiring, webhook signing secret. (The webhook fails closed until the secret is wired.)
- Exact RealtimeKit preset create-API payloads for `stuc_host` / `stuc_participant`.
- RealtimeKit recording → CF Stream copy-from-URL mechanics and the exact webhook payload
  fields (recording URL, event id, meeting id).
- RealtimeKit token TTL default and the SDK token-expiry event name for the refresh path.
- RealtimeKit webhook signature scheme: which fields are signed, timestamp/freshness
  window length.
- Test strategy: an internal-test-call checklist; E2E coverage for the `/live` island
  state machine (loading → gate → content → error → ended).
