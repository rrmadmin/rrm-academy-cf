# STUC Community Pre-Launch Features -- Design

**Goal:** Add the four moderation and engagement features required before the Save the Uterus Club community can launch: reporting/flagging, user banning, comment editing, and email notifications.

**Context:** The community MVP is complete (feed, posts, comments, reactions, members page, tier badges, achievement badges, avatars). 45 members. Cloudflare Workers + D1 + R2. SES email already wired for contact form.

---

## 1. Reporting / Flagging

### Schema

New table `community_flag`:

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| user_id | TEXT FK -> user | Reporter |
| target_type | TEXT | 'post' or 'comment' |
| target_id | TEXT | FK to post or comment |
| reason | TEXT | inappropriate, spam, harassment, other |
| note | TEXT | Optional free text from reporter |
| status | TEXT | pending, resolved, dismissed (default: pending) |
| resolved_by | TEXT | FK -> user (mod/admin who resolved) |
| resolved_at | TEXT | Timestamp |
| created_at | TEXT | Default datetime('now') |

Unique constraint: `(user_id, target_type, target_id)` -- one flag per user per target.

### API

- `POST /api/community/flags` -- create flag (any member)
- `GET /api/community/flags` -- list pending flags (mod+ only)
- `PATCH /api/community/flags` -- resolve or dismiss (admin+ only)

### Behavior

On flag creation, send an email to all mod+ users via SES:
- Subject: `[STUC] Content flagged: {reason}`
- Body: reporter name, target type, content preview (truncated), reason, optional note, direct link to content

### UI

Flag icon on each post and comment. Click opens modal with:
- Reason dropdown (Inappropriate, Spam, Harassment, Other)
- Optional note textarea
- Submit button

Confirmation toast after submission. Disable flag button if user already flagged that item.

---

## 2. User Banning

### Permissions

Admin+ only. Mods cannot ban.

### API

- `POST /api/community/ban` -- set `user.blocked = 1`
  - Body: `{ userId, deleteContent?: boolean }`
  - If `deleteContent` is true, bulk-delete all posts and comments by that user
  - Delete active sessions for the user (immediate logout)
- `POST /api/community/unban` -- set `user.blocked = 0`
  - Body: `{ userId }`

### Existing infrastructure

The `user.blocked` column already exists. Login and OAuth handlers already reject blocked users. The members page already excludes blocked users. No schema changes needed.

### UI

On the members page, admins see a "Ban" action on each member card. Confirmation dialog:
- "Ban {name}? This blocks their login immediately."
- Checkbox: "Also remove all their posts and comments"
- Confirm / Cancel buttons

Unbanning: same location, shows "Unban" for blocked users (admin must query blocked users or have a separate view).

---

## 3. Comment Editing

### Schema change

Add `updated_at` column to `community_comment` table (TEXT, nullable, default NULL).

### API

`PATCH /api/community/comments` -- edit comment content
- Body: `{ commentId, content }`
- Author only (not mod/admin -- they should delete, not edit others' words)
- Sets `updated_at = datetime('now')`
- Content max length: same as create (10000 chars)

### UI

"Edit" button on own comments, next to "Delete". Click replaces comment text with editable textarea + Save/Cancel buttons. After save, display "(edited)" label next to the comment timestamp.

---

## 4. Email Notifications

### Triggers

1. **New post** in STUC channel -- email all STUC members (minus the author, minus opted-out users)
2. **Reply to your post or comment** -- email the parent author (if not opted out, and not the replier themselves)

### Schema change

Add `community_email_opt_out` column to `user` table (INTEGER, default 0). `1` = opted out of all community emails.

### Email format

- From: `noreply@rrmacademy.org` (or existing SES-verified sender)
- New post subject: `[Save the Uterus Club] New post: {title}`
- Reply subject: `[Save the Uterus Club] {name} replied to your {post|comment}`
- Body: HTML with content preview (first 200 chars) + "View in community" link
- Plain text fallback

### Rate protection

New post emails batch within a 15-minute window. If multiple posts are created within 15 minutes, combine into a single digest email. Reply notifications send immediately (low volume, targeted).

Implementation: use a simple timestamp check -- before sending "new post" emails, check if a notification was sent in the last 15 minutes. If so, skip (the next post will trigger the batch). Alternatively, a lightweight KV flag.

### Opt-out UI

Toggle in the community feed header area (visible to logged-in members):
- "Email notifications" on/off toggle
- Defaults to on (opted in)

---

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Flag behavior | Record + email mods | Small community, auto-hide is overkill, dashboard-only means missed flags |
| Who can ban | Admin+ only | Banning is high-impact for a paid community; mods should escalate |
| Flag notification recipients | All mod+ users | That's what mods are for |
| Comment edit time limit | None (show "edited" label) | Trust is high at 45 members; label keeps things honest |
| Email notification scope | New posts + replies to your content | Keeps people engaged without noise |
| Email opt-out | Global toggle (on/off) | Simple; per-type toggles are overkill for 45 people |
| New post email batching | 15-minute window | Prevents spam from rapid posting |

---

## Non-goals

- Moderation dashboard / admin panel (flags list via API is sufficient for now)
- Suspension / temporary timeout (only permanent ban)
- Audit log of moderation actions (can add later)
- Per-channel notification settings
- Push notifications / in-app notifications
