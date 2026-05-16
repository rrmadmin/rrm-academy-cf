# STUC Live Calls on Cloudflare Realtime — Design

**Date:** 2026-05-16
**Status:** Approved (brainstorm complete) — pending implementation plan
**Project:** rrm-academy-cf
**Author:** Brian (with Claude)

## Goal

Replace the Google Meet setup for Save the Uterus Club (STUC) live calls with
video conferencing built on Cloudflare Realtime, so members never leave
rrmacademy.org. The call happens inside the members area, recordings and
transcripts live entirely in RRM Academy infrastructure, and member tier
badges render natively in the call chat and attendee list.

## Motivation

Four drivers, all confirmed during brainstorming:

1. **On-site experience** — members stay on rrmacademy.org for the whole call.
2. **Data sovereignty / privacy** — recordings, transcripts, attendance, and
   chat live in CF infra (R2 / CF Stream / D1), not Google Workspace.
3. **Custom features** — things Meet cannot do, chiefly member tier badges
   shown next to every name in chat and the participant roster.
4. **Cost / scale** — headroom for more frequent or larger calls without
   Workspace per-seat cost. CF Realtime is effectively free at STUC volume.

## Current state (being replaced)

- STUC events created via the `/stuc-event` skill: a Google Calendar event on
  the STUC calendar with Google Meet auto-attached (DWD impersonation), with
  auto-record, auto-transcribe, and smart notes enabled.
- The Meet URL is stored in `community_post.event_link` (D1 `rrm-auth`).
- An SES email blast notifies ~46 STUC members.
- Members reach calls from `/community/events`; a public landing page exists
  at `/events/<slug>`.

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

Use the RealtimeKit **Core SDK** for media plumbing (join, tracks, chat data
channel, participant events) and build the call UI — video grid, chat panel,
participant roster — as our own components in the rrm-academy design system.
RealtimeKit's managed server-side recording and post-call Whisper transcription
handle the hard parts.

**Critical implementation note: rrm-academy-cf has no client framework.** Every
interactive page is a vanilla-JS island (`<div hidden>` blocks + `fetch`). The
RealtimeKit React SDK is therefore NOT used. We use `@cloudflare/realtimekit`,
the framework-agnostic Core SDK package, and build the call UI in vanilla JS
following the existing `src/pages/community/events.astro` island pattern. No
React is introduced into the site.

Rejected alternatives:

- **RealtimeKit UI Kit (prebuilt components)** — fastest to ship, but the member
  badge requirement means overriding the prebuilt chat and roster, i.e. fighting
  the framework and drifting back toward custom anyway.
- **Raw Realtime SFU, fully custom** — cheapest at huge scale but the SFU has no
  built-in recording or transcription; weeks of extra work to rebuild what
  RealtimeKit gives for free. Overkill for 5-25 person roundtables.

## Architecture

```
Member browser
  │  1. GET /community/events/<slug>/live   (Astro page, vanilla-JS island)
  │  2. POST /api/community/call/token      → mints RealtimeKit auth token
  ▼
RealtimeKit Core SDK (@cloudflare/realtimekit) ──media/signaling──► CF Realtime SFU
  │                                                                  │
  │  custom UI: video grid + chat + roster (vanilla JS)              │ server-side
  │                                                                  │ recording + Whisper
  ▼                                                                  ▼
CF Pages Functions (token mint, webhook sink)            RealtimeKit webhook
  │                                                                  │
  ▼                                                                  ▼
D1 rrm-auth (stuc_meeting, stuc_meeting_recording)  ◄──  POST /api/community/call/webhook
CF Stream (recording replay) ◄── webhook pushes completed MP4
```

RealtimeKit owns all media, signaling, recording, and transcription. The Pages
Functions do only two things: mint participant tokens and catch webhooks. No
Durable Objects and no WebSocket server are needed — the real-time path is
entirely Cloudflare's.

## Data model

New D1 migration `migrations/022_stuc_live_calls.sql` in `rrm-auth`:

```sql
CREATE TABLE IF NOT EXISTS stuc_meeting (
  id TEXT PRIMARY KEY,                          -- our id (openssl rand -hex 16)
  post_id TEXT REFERENCES community_post(id),   -- the event announcement row
  rtk_meeting_id TEXT NOT NULL,                 -- RealtimeKit meeting id
  host_user_id TEXT REFERENCES user(id),        -- designated host; nullable (staff fallback)
  status TEXT NOT NULL DEFAULT 'scheduled',     -- scheduled | live | ended
  recording_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS stuc_meeting_recording (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES stuc_meeting(id),
  stream_uid TEXT,                              -- CF Stream uid for gated replay
  transcript TEXT,                              -- post-call Whisper output
  duration_seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stuc_meeting_post ON stuc_meeting(post_id);
CREATE INDEX IF NOT EXISTS idx_stuc_meeting_rec_meeting ON stuc_meeting_recording(meeting_id);
```

The existing `community_post` event row remains the announcement / landing
record. `community_post.event_link` is repurposed: instead of a Meet URL it
points at `/community/events/<slug>/live`. During the parallel-rollout phase a
Meet URL may still occupy `event_link` as the fallback.

## Endpoints

All new endpoints live under `functions/api/community/call/` and MUST be written
via the `coder` agent (reads siblings, runs arise-scanner proof gates, applies
review gates R1-R6).

| Endpoint | Auth | Behavior |
|---|---|---|
| `POST /api/community/call/token` | `requireMember()` | Mints a RealtimeKit participant token. Selects the **preset** by role: `stuc_host` if the user is the meeting's `host_user_id` or has staff role (`roleAtLeast(role,'mod')`), otherwise `stuc_participant`. Embeds `name`, `picture` (`user.avatar_url`), and **`tier` as participant metadata** — `tier` drives the badge. |
| `POST /api/community/call/webhook` | RealtimeKit webhook signature | Handles `meeting.started`, `meeting.ended`, `recording.statusUpdate`, `transcript.ready`. Updates `stuc_meeting.status` / `started_at` / `ended_at`. On a completed recording, pushes the MP4 to CF Stream and writes a `stuc_meeting_recording` row. On `transcript.ready`, stores the Whisper transcript. |
| `GET /api/community/call/state?meetingId=` | `requireMember()` | Lightweight poll for the landing page: whether the call is live and current participant count. |

### RealtimeKit presets

Two permission presets are defined once via the RealtimeKit API (the exact
create calls are documented in the implementation plan, not here):

- **`stuc_host`** — own camera/mic, chat, screen share, plus: mute others,
  remove participant, start/stop recording, promote co-host.
- **`stuc_participant`** — own camera/mic, chat, screen share.

Co-host promotion mid-call: the host triggers a preset change on the target
participant through the Core SDK / RealtimeKit API.

## Front-end — the call page

New Astro route `src/pages/community/events/[slug]/live.astro`. It is a
vanilla-JS island that follows the existing `events.astro` structure exactly:
`#…-loading`, `#…-gate` (non-members get the "join STUC" CTA), and `#…-content`
(members only) blocks, gated by a `requireMember()`-backed fetch.

The island:

- Imports the `@cloudflare/realtimekit` Core SDK, calls `/api/community/call/token`,
  and joins the meeting.
- Renders three custom panels styled only with tokens from
  `docs/design/design-system.json`:
  - **Video grid** — participant tiles with active-speaker highlight.
  - **Chat panel** — RealtimeKit chat data channel; each message is rendered by
    our own code, so the sender's tier badge sits inline next to the name.
  - **Roster** — participant list with the same badge.
- Shows a host-only control bar (mute / remove / record / screen share /
  promote co-host) when the joined participant's preset is `stuc_host`.

## Member badges

The badge is the reason for custom UI rather than a prebuilt embed.
`requireMember()` already returns `tier` (`staff` / `superhero` / `hero` /
`member`), and `TIER_DISPLAY` in `functions/api/community/_shared.js` already
maps those to emoji labels. The `/token` endpoint stamps `tier` into RealtimeKit
participant metadata at mint time. Because the call island renders chat and
roster itself, the badge renders next to every name in both surfaces with no
framework to fight.

## Recording, transcript, replay

RealtimeKit auto-records each call server-side (preset-driven). On
`recording.statusUpdate` = completed, the webhook pushes the MP4 into **CF
Stream** — the site already has Stream infrastructure, a `/api/stream/token`
endpoint, and the course video player, all of which are reused for replay.
Post-call Whisper transcription arrives via the `transcript.ready` webhook and
is stored in `stuc_meeting_recording.transcript`.

A gated **replay** page lives at `/community/events/<slug>/replay`,
members-only, reusing the existing course Stream player component.

## Feature flag and rollout

The feature is gated by a `PUBLIC_REALTIME_CALLS` GitHub Actions variable,
mirroring the App Shell `PUBLIC_SHELL_ROUTES` pattern:

- Flag off → the event page keeps the Meet link and "Join Call" points at Meet.
- Flag on → the event page shows the CF Realtime "Join Call" pointing at
  `/community/events/<slug>/live`.

Rollout phases:

1. **Internal test call** — Brian, Naomi, 1-2 staff. Validate devices,
   recording, and transcript end to end.
2. **Parallel** — 2-3 real STUC calls with the Meet link kept in `event_link`
   as the escape hatch.
3. **Cutover** — drop Meet; the flag stays on; the `/stuc-event` skill is
   updated to create a `stuc_meeting` (RealtimeKit meeting) instead of a Meet
   space.

## Out of scope (YAGNI for v1)

Breakout rooms, polls, virtual backgrounds, waiting-room/lobby (instant entry
chosen), viewer/broadcast split (roundtable only), live in-call captions
(post-call transcript only), and mobile-native apps (responsive web only).

## Risks

- **RealtimeKit is in beta.** Mitigated by the feature flag, the parallel
  rollout, and keeping the Meet fallback in `event_link` until RealtimeKit
  proves stable across several calls or reaches GA. The underlying Realtime SFU
  is GA; only the convenience layer is beta.
- **GA pricing.** Free during beta; ~$3-4 per call at GA. Negligible, but noted.
- **`functions/api/community/_shared.js` is a guarded file.** If a `requireHost()`
  helper is added there, `npm run guard:update` must run before committing. New
  endpoints under `functions/api/community/call/` are unguarded but must follow
  the same sibling-pattern coding standards; the `coder` agent enforces this.

## Open items for the implementation plan

- RealtimeKit account setup: API key provisioning, 1Password storage, CF Pages
  secret wiring, webhook signing secret.
- Exact RealtimeKit preset create-API payloads for `stuc_host` / `stuc_participant`.
- RealtimeKit → CF Stream upload mechanics for the completed recording.
- Whether `event_link` repurposing needs a schema comment or a new dedicated
  column to avoid ambiguity with the legacy Meet URL.
- Test strategy: an internal-test-call checklist and any E2E coverage.
